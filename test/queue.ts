import 'mocha'
import * as assert from 'assert'

import {Queue} from './../src/queue'

async function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

describe('Queue', function() {

    it('should work', function(done) {
        let results: number[] = []
        let inFlight = 0
        const queue = new Queue(2, async (item: number) => {
            assert(++inFlight <= 2)
            await sleep(Math.random() * 10)
            results.push(item)
            --inFlight
            if (results.length === 6) {
                assert.equal(inFlight, 0)
                done()
            }

        })
        queue.push(1)
        queue.push(2)
        queue.push(3)
        queue.push(4)
        queue.push(5)
        queue.push(6)
    })

    it('should handle errors', function(done) {
        const queue = new Queue(2, async (item: number) => {
            throw new Error('Banana')
        })
        queue.on('error', (error) => {
            assert.equal(error.message, 'Banana')
            done()
        })
        queue.push(1)
    })


})
