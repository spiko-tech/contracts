const DEBUG = require('debug')('compilation');

require('dotenv').config();

const argv = require('yargs')()
  .env('')
  .options({
    // modules
    coverage:      { type: 'boolean', default: false },
    report:        { type: 'boolean', default: false },
    // compilations
    compiler:      { type: 'string', default: '0.8.20' },
    hardfork:      { type: 'string', default: 'london' },
    mode:          { type: 'string', choices: ['production', 'development'], default: 'production' },
    runs:          { type: 'number', default: 200 },
    viaIr:         { type: 'boolean', default: false },
    revertStrings: { type: 'string', choices: ['default', 'strip'], default: 'default' },
    // chain
    fork:          { type: 'string', },
    chainId:       { type: 'number', default: 1337 },
    slow:          { type: 'boolean', default: false },
    // APIs
    coinmarketcap: { type: 'string' },
    etherscan:     { type: 'string' },
  })
  .argv;

require('@nomiclabs/hardhat-waffle');
require('@nomiclabs/hardhat-ethers');
require('@openzeppelin/hardhat-upgrades');

argv.coverage && require('solidity-coverage');
argv.etherscan && require('@nomiclabs/hardhat-etherscan');
argv.report && require('hardhat-gas-reporter');


const accounts = [
  argv.mnemonic   && { mnemonic: argv.mnemonic },
  argv.privateKey && [argv.privateKey],
].find(Boolean);

const networkNames = [
  'mainnet',
  'goerli',
  'sepolia',
];

module.exports = {
  solidity: {
    compilers: [
      {
        version: argv.compiler,
        settings: {
          evmVersion: argv.hardfork,
          optimizer: {
            enabled: argv.mode === 'production' || argv.report,
            runs: argv.runs,
          },
          viaIR: argv.viaIr,
          debug: {
            revertStrings: argv.revertStrings,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      mining: argv.slow ? { auto: false, interval: [3000, 6000] } : undefined,
      forking: argv.fork ? { url: argv.fork } : undefined,
    },
    ...Object.fromEntries(networkNames.map(name => [name, { url: argv[`${name}Node`], accounts }]).filter(([, { url }]) => url)),
  },
  etherscan: {
    apiKey: Object.fromEntries(networkNames.map(name => [name, argv.etherscan])),
  },
  gasReporter: {
    currency: 'USD',
    coinmarketcap: argv.coinmarketcap,
  },
};

DEBUG(JSON.stringify(module.exports.solidity.compilers, null, 2))
