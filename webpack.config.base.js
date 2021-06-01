/**
 * Base webpack config used across other specific configs
 */

import _ from 'lodash';
import path from 'path';
import webpack from 'webpack';
// import { dependencies as externals } from './app/package.json';
// import { optionalDependencies as additionalExternals } from './app/package.json';

export default {
  module: {
    rules: [{
      test: /\.jsx?$/,
      use: [{
        loader: 'babel-loader',
        options: {
          cacheDirectory: true
        }
      }],
      exclude: /node_modules/
    },
    // https://github.com/ashtuchkin/iconv-lite/issues/204#issuecomment-432048618
    {
      test: /node_modules[\/\\](iconv-lite)[\/\\].+/,
      resolve: {
        aliasFields: ['main']
      }
    }]
  },

  output: {
    path: path.join(__dirname, 'app'),
    // https://github.com/webpack/webpack/issues/1114
    libraryTarget: 'commonjs2'
  },

  /**
   * Determine the array of extensions that should be used to resolve modules.
   */
  resolve: {
    extensions: ['.js', '.jsx', '.json'],
    mainFields: ['webpack', 'browser', 'web', 'browserify', ['jam', 'main'], 'main'],
    alias: {
      superagent: 'superagent/lib/client.js',
      emitter: 'component-emitter',
      reduce  : 'reduce-component'
    }
  },
  resolveLoader: { },

  plugins: [
    new webpack.EnvironmentPlugin({
      NODE_ENV: 'production'
    }),

    new webpack.NamedModulesPlugin()
  ],

  // externals: [...Object.keys(externals || {}), ...Object.keys(additionalExternals || {})]
  externals: {
    usb: 'usb'
  }
};
