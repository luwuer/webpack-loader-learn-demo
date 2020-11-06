
const { getOptions } = require('loader-utils')

module.exports = function(content) {
  console.log('change action loader trigger...')
  return content.replace('Hello', getOptions(this).action) 
}