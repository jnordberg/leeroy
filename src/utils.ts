
/** Convert node.js nanosecond timestamp to milliseconds. */
export function hr2ms(hrtime: [number, number]) {
    return hrtime[0] * 1e3 + hrtime[1] / 1e6
}

/** Parse boolean value from string */
export function parseBool(input: any): boolean {
    if (typeof input === 'string') {
        input = input.toLowerCase().trim()
    }
    switch (input) {
        case true:
        case 1:
        case '1':
        case 'y':
        case 'yes':
        case 'on':
            return true
        case 0:
        case false:
        case '0':
        case 'n':
        case 'no':
        case 'off':
            return false
        default:
            throw new Error(`Ambiguous boolean: ${ input }`)
    }
}
