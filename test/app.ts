import 'mocha'
import * as assert from 'assert'
import * as http from 'http'
import * as needle from 'needle'

import {app} from './../src/app'

describe('app', function() {
    const port = process.env['TEST_HTTP_PORT'] ? parseInt(process.env['TEST_HTTP_PORT'] as string) : 63205
    const server = http.createServer(app.callback())

    before((done) => { server.listen(port, 'localhost', done) })
    after((done) => { server.close(done) })

    it('should healthcheck', async function() {
        const response = await needle('get', `:${ port }/.well-known/healthcheck.json`)
        assert.equal(response.statusCode, 200, 'healthcheck status')
        assert(response.body.ok, 'healthcheck response')
    })

})
