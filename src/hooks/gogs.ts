import * as assert from 'assert'
import * as Bunyan from 'bunyan'
import * as config from 'config'
import * as crypto from 'crypto'
import * as Koa from 'koa'

import {BuildOptions} from './../build'
import {logger} from './../logger'

const SECRET: string = config.has('gogs_secret') ? config.get('gogs_secret') : config.get('github_secret')

function verifySignature(secret: string, message: string, signature: string) {
    const sig1 = Buffer.from(signature, 'hex')
    const sig2 = crypto.createHmac('sha256', secret).update(message).digest()
    assert(crypto.timingSafeEqual(sig1, sig2), 'Signature mismatch')
}

export default function hook(queueJob: (BuildOptions) => void)  {
    return (ctx: Koa.Context) => {
        ctx.status = 200
        const signature = ctx.request.get('X-Gogs-Signature')
        ctx.assert(signature, 400, 'Missing signature')
        try {
            verifySignature(SECRET, ctx.request['rawBody'], signature)
        } catch (error) {
            logger.warn(error, 'invalid signature')
            ctx.throw(400, 'Invalid signature')
        }

        const event = ctx.request.get('X-Gogs-Event')
        if (event === 'ping') {
            ctx.body = 'Pong'
            return
        } else if (event !== 'push') {
            ctx.throw(400, 'Invalid event')
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
        const repository = payload.repository.private ?
            payload.repository.ssh_url : payload.repository.clone_url
        const name = payload.repository.full_name
        const tag = payload.repository.default_branch === branch ? 'latest' : branch

        queueJob({branch, name, repository, tag})
    }
}
