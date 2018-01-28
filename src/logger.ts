import * as Bunyan from 'bunyan'
import * as config from 'config'

const level: Bunyan.LogLevel = config.get('log_level')
const output: string = config.get('log_output')

let stream: Bunyan.Stream
if (output === 'stdout') {
    stream = {level, stream: process.stdout}
} else if (output === 'stderr') {
    stream = {level, stream: process.stderr}
} else {
    stream = {level, path: output}
}

export const logger = Bunyan.createLogger({
    name: config.get('name'),
    streams: [stream],
})
