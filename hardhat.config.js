require('dotenv').config();

const { argv } = require('yargs/yargs')(process.argv.slice(2))
  .env('')
  .options({
    // modules
    coverage: { type: 'boolean', default: false },
    report: { type: 'boolean', default: false },
    // compilations
    compiler: { type: 'string', default: '0.8.24' },
    evmVersion: { type: 'string', default: 'cancun' },
    mode: { type: 'string', choices: ['production', 'development'], default: 'production' },
    runs: { type: 'number', default: 200 },
    viaIr: { type: 'boolean', default: false },
    revertStrings: { type: 'string', choices: ['default', 'strip'], default: 'default' },
    // chain
    chainId: { type: 'number', default: 1337 },
    hardfork: { type: 'string', default: 'cancun' },
    slow: { type: 'boolean', default: false },
    // APIs
    coinmarketcap: { type: 'string' },
    etherscan: { type: 'string' },
  });

require('@nomicfoundation/hardhat-toolbox');
require('@nomicfoundation/hardhat-ethers');
require('@openzeppelin/hardhat-upgrades');
require('solidity-coverage');

const accounts = [argv.mnemonic && { mnemonic: argv.mnemonic }, argv.privateKey && [argv.privateKey]].find(Boolean);

const networkNames = [
  // main
  'mainnet',
  'ropsten',
  'rinkeby',
  'goerli',
  'kovan',
  'sepolia',
  // binance smart chain
  'bsc',
  'bscTestnet',
  // huobi eco chain
  'heco',
  'hecoTestnet',
  // fantom mainnet
  'opera',
  'ftmTestnet',
  // optimism
  'optimisticEthereum',
  'optimisticKovan',
  // polygon
  'polygon',
  'polygonAmoy',
  // arbitrum
  'arbitrumOne',
  'arbitrumTestnet',
  'arbitrumSepolia',
  // avalanche
  'avalanche',
  'avalancheFujiTestnet',
  // moonbeam
  'moonbeam',
  'moonriver',
  'moonbaseAlpha',
  // xdai
  'xdai',
  'sokol',
  // base
  'base',
  'baseSepolia',
  // etherlink
  'etherlinkMainnet',
  'etherlinkTestnet',
];

module.exports = {
  solidity: {
    compilers: [
      {
        version: argv.compiler,
        settings: {
          evmVersion: argv.evmVersion,
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
      chainId: argv.chainId,
      hardfork: argv.hardfork,
      mining: argv.slow ? { auto: false, interval: [3000, 6000] } : undefined,
      forking: argv.fork ? { url: argv.fork } : undefined,
    },
    ...Object.fromEntries(
      networkNames.map((name) => [name, { url: argv[`${name}Node`], accounts }]).filter(([, { url }]) => url)
    ),
  },
  etherscan: {
    apiKey: Object.fromEntries(networkNames.map((name) => [name, argv.etherscan])),
    customChains: [
      {
        network: 'arbitrumOne',
        chainId: 42161,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api?chainid=42161',
          browserURL: 'https://arbiscan.io/api',
        },
      },
      {
        network: 'sepolia',
        chainId: 11155111,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api?chainid=11155111',
          browserURL: 'https://sepolia.etherscan.io/api',
        },
      },
      {
        network: 'baseSepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api?chainid=84532',
          browserURL: 'https://sepolia.basescan.org/api',
        },
      },
      {
        network: 'arbitrumSepolia',
        chainId: 421614,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api?chainid=421614',
          browserURL: 'https://sepolia.arbiscan.io',
        },
      },
      {
        network: 'polygonAmoy',
        chainId: 80002,
        urls: {
          apiURL: 'https://api.etherscan.io/v2/api?chainid=80002',
          browserURL: 'https://amoy.polygonscan.com',
        },
      },
      {
        network: 'etherlinkMainnet',
        chainId: 42793,
        urls: {
          apiURL: 'https://explorer.etherlink.com/api',
          browserURL: 'https://explorer.etherlink.com',
        },
      },
      {
        network: 'etherlinkTestnet',
        chainId: 128123,
        urls: {
          apiURL: 'https://testnet.explorer.etherlink.com/api',
          browserURL: 'https://testnet.explorer.etherlink.com/',
        },
      },
    ],
  },
  gasReporter: {
    enabled: argv.report,
    showMethodSig: true,
    currency: 'USD',
    coinmarketcap: argv.coinmarketcap,
  },
};

require('debug')('compilation')(JSON.stringify(module.exports.solidity.compilers, null, 2));
