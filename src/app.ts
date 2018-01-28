import * as assert from 'assert'
import * as Bunyan from 'bunyan'
import * as cluster from 'cluster'
import * as config from 'config'
import * as crypto from 'crypto'
import * as http from 'http'
import * as Koa from 'koa'
import * as KoaBody from 'koa-bodyparser'
import * as Router from 'koa-router'
import * as os from 'os'
import * as path from 'path'
import * as util from 'util'
import * as uuid from 'uuid'

import {build, BuildOptions} from './build'
import {logger} from './logger'
import {Queue} from './queue'
import {SlackWebhook} from './slack-webhook'
import {hr2ms, parseBool} from './utils'

export const version = require('./version')
export const app = new Koa()
const router = new Router()
const workDir: string = config.has('work_dir') ? config.get('work_dir') : os.tmpdir()
const workers: cluster.Worker[] = []
let numWorkers = Number.parseInt(config.get('num_workers'))
if (numWorkers === 0) {
    numWorkers = os.cpus().length
}

let slack: SlackWebhook | undefined
if (config.has('slack')) {
    const slackOptions: any = config.get('slack')
    slack = new SlackWebhook(slackOptions.url, slackOptions.channel)
}

interface BuildJob {
    id: string
    time: [number, number]
    options: BuildOptions
}

const queue = new Queue(numWorkers, async (job: BuildJob) => {
    const worker = workers.shift()
    if (!worker) {
        throw new Error('Ran out of workers')
    }
    return new Promise<void>((resolve) => {
        worker.send(job)
        worker.once('message', () => {
            workers.push(worker)
            resolve()
        })
    })
})

app.proxy = parseBool(config.get('proxy'))
app.on('error', (error) => {
    logger.error(error, 'Application error')
})

function verifySignature(secret: string, message: string, signature: string) {
    const [type, sig1] = signature.split('=')
    assert.equal(type, 'sha1', 'Only sha1 signatures are supported')
    const sig2 = crypto.createHmac('sha1', secret).update(message).digest()
    assert(crypto.timingSafeEqual(Buffer.from(sig1, 'hex'), sig2), 'Signature mismatch')
}

async function healthcheck(ctx: Koa.Context) {
    const ok = true
    const date = new Date()
    ctx.body = {ok, version, date}
}

async function githubWebhook(ctx: Koa.Context) {
    ctx.status = 200
    const signature = ctx.request.get('X-Hub-Signature')
    ctx.assert(signature, 400, 'Missing signature')
    try {
        verifySignature(config.get('github_secret'), ctx.request['rawBody'], signature)
    } catch (error) {
        logger.warn(error, 'invalid signature')
        ctx.throw('Invalid signature', 400)
    }

    const event = ctx.request.get('X-GitHub-Event')
    if (event === 'ping') {
        ctx.body = 'Pong'
        return
    } else if (event !== 'push') {
        ctx.throw('Invalid event', 400)
    }

    const payload = ctx.request['body']
    const matches = /^refs\/heads\/(.+)$/.exec(payload.ref)
    if (!matches || !matches[1]) {
        ctx.throw('No branch ref', 400)
        return
    }

    // Skip deleted branches
    if (payload.deleted) {
        return
    }

    const branch = matches[1]
    const repository = payload.repository.clone_url
    const name = payload.repository.full_name
    const tag = payload.repository.master_branch === branch ? 'latest' : branch

    const id = uuid()
    const options: BuildOptions = {
        branch, name, repository, tag
    }

    queue.push({id, options, time: process.hrtime()})
    logger.info({job_id: id, options, queue_length: queue.items.length}, 'build queued')
}

router.get('/.well-known/healthcheck.json', healthcheck)
router.get('/', healthcheck)
router.post('/hooks/github', githubWebhook)

app.use(KoaBody())
app.use(router.routes())

function run(job: BuildJob) {
    const start = process.hrtime()
    const log = logger.child({
        job_id: job.id,
        image_name: job.options.name,
        image_tag: job.options.tag,
    })
    const dir = path.join(workDir, `leeroy-${ job.id }`)

    log.info('building %s:%s', job.options.name, job.options.tag)

    const done = () => {
        if (!process.send) {
            throw new Error('Invalid worker context')
        }
        process.send('done')
    }

    build(job.options, dir, log).then(() => {
        const buildTime = hr2ms(process.hrtime(start))
        const totalTime = hr2ms(process.hrtime(job.time))
        const queueTime = totalTime - buildTime
        log.info(
            {build_time: buildTime, queue_time: queueTime},
            'build complete, took %d seconds (%ds build, %ds wait)',
            Math.round(totalTime / 1e3),
            Math.round(buildTime / 1e3),
            Math.round(queueTime / 1e3),
        )
        if (slack) {
            slack.send(
                `Built \`${ job.options.name }:${ job.options.tag }\` in ${ Math.round(buildTime / 1e3) }s`
            ).catch((slackError) => {
                logger.warn(slackError, 'unable to notify slack')
            })
        }
        done()
    }).catch((error) => {
        log.error(error, 'build failed')
        if (slack) {
            slack.send(
                `Error building \`${ job.options.name }:${ job.options.tag }\`\n` +
                '```\n' + String(error) + '\n```'
            ).catch((slackError) => {
                logger.warn(slackError, 'unable to notify slack')
            })
        }
        done()
    })
}

async function main() {
    if (cluster.isMaster) {
        logger.info({version}, 'starting server')
    }

    const server = http.createServer(app.callback())
    const listen = util.promisify(server.listen.bind(server))
    const close = util.promisify(server.close.bind(server))

    if (cluster.isMaster) {
        logger.info('spawning %d worker(s)', numWorkers)
        for (let i = 0; i < numWorkers; i++) {
            workers.push(cluster.fork())
        }
        const port = config.get('port')
        await listen(port)
        logger.info('listening on port %d', port)
    } else {
        process.on('message', run)
    }

    if (cluster.isMaster) {
        let exiting = false
        const exit = async () => {
            await close()
            // TODO: wait for queue to drain
            return 0
        }

        process.on('SIGTERM', () => {
            if (exiting) {
                return
            }
            exiting = true
            logger.info('got SIGTERM, exiting...')
            exit().then((code) => {
                process.exitCode = code
            }).catch((error) => {
                logger.fatal(error, 'unable to exit gracefully')
                setTimeout(() => process.exit(1), 1000)
            })
        })
    }
}

if (module === require.main) {
    main().catch((error) => {
        logger.fatal(error, 'unable to start')
        setTimeout(() => process.exit(1), 1000)
    })
}
