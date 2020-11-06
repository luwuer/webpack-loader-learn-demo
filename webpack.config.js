const path = require('path')

module.exports = {
  mode: 'development',
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: 'index.js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: [
          {
            loader: path.resolve(__dirname, 'loaders/change-action/index.js'),
            options: {
              action: 'Hi'
            }
          },
          path.resolve(__dirname, 'loaders/change-symbol/index.js'),
          path.resolve(__dirname, 'loaders/change-target/index.js')
        ]
      }
    ]
  }
}