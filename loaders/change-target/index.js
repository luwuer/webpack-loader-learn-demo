module.exports = function(content) {
  console.log('change target loader trigger...')
  return content.replace('World', 'Webpack Loader') 
}