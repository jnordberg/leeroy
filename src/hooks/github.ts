import * as assert from 'assert'
import * as Bunyan from 'bunyan'
import * as config from 'config'
import * as crypto from 'crypto'
import * as Koa from 'koa'

import {BuildOptions} from './../build'
import {logger} from './../logger'

function verifySignature(secret: string, message: string, signature: string) {
    const [type, sig1] = signature.split('=')
    assert.equal(type, 'sha1', 'Only sha1 signatures are supported')
    const sig2 = crypto.createHmac('sha1', secret).update(message).digest()
    assert(crypto.timingSafeEqual(Buffer.from(sig1, 'hex'), sig2), 'Signature mismatch')
}

export default function hook(queueJob: (BuildOptions) => void)  {
    return (ctx: Koa.Context) => {
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

        queueJob({branch, name, repository, tag})
    }
}
