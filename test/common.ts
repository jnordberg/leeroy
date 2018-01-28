import * as assert from 'assert'

export async function assertThrows(block: () => Promise<any>) {
    try {
        await block()
    } catch (error) {
        return error
    }
    assert.fail('Missing expected exception')
}
