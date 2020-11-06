const loaderUtils = require('loader-utils')

module.exports = function(content) {
  console.log('change symbol loader trigger...')
  return content.replace('!', '...')
}

module.exports.pitch = function(remainingRequest) {
  console.log('change symbol loader pitch trigger...')
  return '// [Change by pitch] \n\nrequire(' + loaderUtils.stringifyRequest(this, '!' + remainingRequest) + ');'
}