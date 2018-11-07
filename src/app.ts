import * as assert from 'assert'
import * as Bunyan from 'bunyan'
import * as cp from 'child_process'
import * as cluster from 'cluster'
import * as config from 'config'
import * as fs from 'fs-extra'
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
import {SlackWebhook} from './slack'
import {hr2ms, parseBool} from './utils'

import githubHook from './hooks/github'
import gogsHook from './hooks/gogs'

const exec = util.promisify(cp.exec)

export const version = require('./version')
export const app = new Koa()
const router = new Router()
const workDir: string = config.has('work_dir') ? config.get('work_dir') : os.tmpdir()
const workers: cluster.Worker[] = []
let numWorkers = Number.parseInt(config.get('num_workers'), 10)
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

async function healthcheck(ctx: Koa.Context) {
    const ok = true
    const date = new Date()
    ctx.body = {ok, version, date}
}

router.get('/.well-known/healthcheck.json', healthcheck)
router.get('/', healthcheck)
router.post('/hooks/github', githubHook(queueJob))
router.post('/hooks/gogs', gogsHook(queueJob))

app.use(KoaBody())
app.use(router.routes())

/** Adds a set of BuildOptions to the job queue */
function queueJob(options: BuildOptions) {
    const id = uuid()
    queue.push({id, options, time: process.hrtime()})
    logger.info({job_id: id, options, queue_length: queue.items.length}, 'build queued')
}

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

async function isSocket(filename: string) {
    try {
        const stat = await fs.stat(filename)
        return stat.isSocket()
    } catch (error) {
        if (error.code === 'ENOENT') {
            return false
        } else {
            throw error
        }
    }
}

async function main() {
    if (cluster.isMaster) {
        logger.info({version}, 'starting server')
    }

    let sshAgent: cp.ChildProcess | undefined

    const server = http.createServer(app.callback())
    const listen = util.promisify(server.listen.bind(server))
    const close = util.promisify(server.close.bind(server))

    if (cluster.isMaster) {
        // spin up a ssh agent if none is found
        if (!process.env['SSH_AUTH_SOCK']) {
            process.env['SSH_AUTH_SOCK'] = `.ssh-agent-${ process.pid }`
        }
        const sshAuthSock = process.env['SSH_AUTH_SOCK']!
        if (!await isSocket(sshAuthSock)) {
            logger.info('starting a ssh agent on %s', sshAuthSock)
            sshAgent = cp.spawn('ssh-agent', ['-d', '-a', sshAuthSock])
        }

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

        if (sshAgent) {
            sshAgent.on('exit', () => {
                if (!exiting) {
                    logger.warn('ssh agent died prematurley')
                }
            })
        }

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
