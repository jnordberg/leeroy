// replaced by build-script to ${ version }-${ git shortrev }-${ date }
const pkg = require('../package')
module.exports = `${ pkg.version }-dev`
