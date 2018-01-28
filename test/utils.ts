import 'mocha'
import * as assert from 'assert'

import {parseBool} from './../src/utils'

describe('utils', function() {

    it('parseBool', function() {
        assert.equal(parseBool('n'), false)
        assert.equal(parseBool(' No'), false)
        assert.equal(parseBool('oFF'), false)
        assert.equal(parseBool(false), false)
        assert.equal(parseBool(0), false)
        assert.equal(parseBool('0'), false)
        assert.equal(parseBool('Y'), true)
        assert.equal(parseBool('yes  '), true)
        assert.equal(parseBool('on'), true)
        assert.equal(parseBool(true), true)
        assert.equal(parseBool(1), true)
        assert.equal(parseBool('1'), true)
        assert.throws(() => {
            parseBool('banana')
        })
    })

})
