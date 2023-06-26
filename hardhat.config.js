require('dotenv').config();
const argv = require('yargs/yargs')(process.argv.slice(2))
  .env('')
  .options({
    // modules
    coverage:      { type: 'boolean',                                          default: false          },
    report:        { type: 'boolean',                                          default: false          },
    // compilations
    compiler:      { type: 'string',                                           default: '0.8.20'       },
    hardfork:      { type: 'string',                                           default: 'arrowGlacier' },
    mode:          { type: 'string', choices: [ 'production', 'development' ], default: 'production'   },
    runs:          { type: 'number',                                           default: 200            },
    enableIr:      { type: 'boolean',                                          default: false          },
    revertStrings: { type: 'string', choices: [ 'default', 'strip'          ], default: 'default'      },
    // chain
    fork:          { type: 'string',                                                                   },
    chainId:       { type: 'number',                                           default: 1337           },
    slow:          { type: 'boolean',                                          default: false          },
    // APIs
    coinmarketcap: { type: 'string'                                                                    },
    etherscan:     { type: 'string'                                                                    },
    // extra
    verbose:       { type: 'boolean',                                          default: false          },
  })
  .argv;

require('@nomiclabs/hardhat-waffle');
require('@nomiclabs/hardhat-ethers');
require('@openzeppelin/hardhat-upgrades');
require('solidity-coverage');

argv.etherscan && require('@nomiclabs/hardhat-etherscan');
argv.report    && require('hardhat-gas-reporter');
argv.verbose   && console.table([ 'coverage', 'report', 'compiler', 'hardfork', 'mode', 'runs', 'enableIr', 'revertStrings', 'fork', 'chainId', 'slow', 'coinmarketcap', 'etherscan' ].map(key => ({ key, value: argv[key] })));

const settings = {
  optimizer: {
    enabled: argv.mode === 'production' || argv.report,
    runs: argv.runs,
  },
	viaIR: argv.enableIr,
  debug: {
    revertStrings: argv.revertStrings,
  },
};

module.exports = {
  solidity: {
    compilers: [
      { version: argv.compiler, settings },
      { version: '0.8.16',      settings },
      { version: '0.7.6',       settings },
      { version: '0.6.12',      settings },
      { version: '0.5.16',      settings },
    ],
  },
  networks: {
    hardhat: {
      chainId: argv.chainId,
      hardfork: argv.hardfork,
    },
  },
  etherscan: {
    apiKey: argv.etherscan,
  },
  gasReporter: {
    currency: 'USD',
    coinmarketcap: argv.coinmarketcap,
  },
};

const accounts = [
  argv.mnemonic   && { mnemonic: argv.mnemonic },
  argv.privateKey && [ argv.privateKey ],
].find(Boolean);

Object.assign(
  module.exports.networks,
  accounts && Object.fromEntries([
    'mainnet',
    'ropsten',
    'rinkeby',
    'goerli',
    'kovan',
    'matic',
    'mumbai',
  ].map(name => [ name, { url: argv[`${name}Node`], accounts } ]).filter(([, { url} ]) => url)),
  argv.slow && { hardhat: { mining: { auto: false, interval: [3000, 6000] }}}, // Simulate a slow chain locally
  argv.fork && { hardhat: { forking: { url: argv.fork }}}, // Simulate a mainnet fork
);
