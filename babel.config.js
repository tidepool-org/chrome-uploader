/* eslint global-require: off */
const developmentEnvironments = ['development', 'test'];

const developmentPlugins = [require('react-hot-loader/babel')];

const productionPlugins = [
  require('babel-plugin-dev-expression'),

  // babel-preset-react-optimize
  require('@babel/plugin-transform-react-constant-elements'),
  require('@babel/plugin-transform-react-inline-elements'),
  require('babel-plugin-transform-react-remove-prop-types')
];

module.exports = api => {
  const development = api.env(developmentEnvironments);
  api.cache.never();
  return {
    presets: [
      [
        require('@babel/preset-env'),
        {
          useBuiltIns: 'usage',
          corejs: 2,
          modules: 'commonjs'
        }
      ],
      [require('@babel/preset-react'), { development }]
    ],
    retainLines: true,
    plugins: [
      // Stage 0
      require('@babel/plugin-proposal-function-bind'),

      // Stage 1
      require('@babel/plugin-proposal-export-default-from'),
      require('@babel/plugin-proposal-logical-assignment-operators'),
      [require('@babel/plugin-proposal-optional-chaining'), { loose: false }],
      [
        require('@babel/plugin-proposal-pipeline-operator'),
        { proposal: 'minimal' }
      ],
      [
        require('@babel/plugin-proposal-nullish-coalescing-operator'),
        { loose: false }
      ],
      require('@babel/plugin-proposal-do-expressions'),

      // Stage 2
      [require('@babel/plugin-proposal-decorators'), { legacy: true }],
      require('@babel/plugin-proposal-function-sent'),
      require('@babel/plugin-proposal-export-namespace-from'),
      require('@babel/plugin-proposal-numeric-separator'),
      require('@babel/plugin-proposal-throw-expressions'),

      // Stage 3
      require('@babel/plugin-syntax-dynamic-import'),
      require('@babel/plugin-syntax-import-meta'),
      [require('@babel/plugin-proposal-class-properties'), { loose: true }],
      require('@babel/plugin-proposal-json-strings'),

      ...(development ? developmentPlugins : productionPlugins),
      require('babel-plugin-add-module-exports'),
      require('@babel/plugin-transform-classes'),
    ],
    env: {
      development: {
        plugins: [
          [
            require('babel-plugin-transform-define'),
            {
              '__VERSION_SHA__': 'abcd'
            }
          ],
        ]
      },
      test: {
        plugins: [
          [
            require('babel-plugin-module-resolver'),
            {
              'root': ['./app/node_modules'],
              'alias': {
                'node-hid': './app/node_modules/node-hid',
                'serialport': './app/node_modules/serialport'
              }
            }
          ],
          require('babel-plugin-rewire'),
          [
            require('babel-plugin-transform-define'),
            {
              '__VERSION_SHA__': 'abcd',
              'process.env.DEBUG_ERROR': false
            }
          ]
        ]
      }
    }
  };
};
