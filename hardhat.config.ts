import { HardhatUserConfig } from "hardhat/config";
import yargs from "yargs/yargs";

import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";
import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import { MultiSolcUserConfig, NetworksUserConfig } from "hardhat/types";
import debug from "debug";

require("dotenv").config();

const argv = yargs(process.argv.slice(2))
  .env("")
  .options({
    // modules
    coverage: { type: "boolean", default: false },
    report: { type: "boolean", default: false },
    // compilations
    compiler: { type: "string", default: "0.8.24" },
    evmVersion: { type: "string", default: "cancun" },
    mode: {
      type: "string",
      choices: ["production", "development"],
      default: "production",
    },
    runs: { type: "number", default: 200 },
    viaIr: { type: "boolean", default: false },
    revertStrings: {
      type: "string",
      choices: ["default", "strip"],
      default: "default",
    },
    // chain
    chainId: { type: "number", default: 1337 },
    hardfork: { type: "string", default: "cancun" },
    slow: { type: "boolean", default: false },
    // APIs
    coinmarketcap: { type: "string" },
    etherscan: { type: "string" },
  })
  .parseSync();

const accounts = [
  argv.mnemonic && { mnemonic: argv.mnemonic },
  argv.privateKey && [argv.privateKey],
].find(Boolean);

const networkNames = [
  // main
  "mainnet",
  "ropsten",
  "rinkeby",
  "goerli",
  "kovan",
  "sepolia",
  // binance smart chain
  "bsc",
  "bscTestnet",
  // huobi eco chain
  "heco",
  "hecoTestnet",
  // fantom mainnet
  "opera",
  "ftmTestnet",
  // optimism
  "optimisticEthereum",
  "optimisticKovan",
  // polygon
  "polygon",
  "polygonAmoy",
  // arbitrum
  "arbitrumOne",
  "arbitrumTestnet",
  // avalanche
  "avalanche",
  "avalancheFujiTestnet",
  // moonbeam
  "moonbeam",
  "moonriver",
  "moonbaseAlpha",
  // xdai
  "xdai",
  "sokol",
];

const solidityConfig: MultiSolcUserConfig = {
  compilers: [
    {
      version: argv.compiler,
      settings: {
        evmVersion: argv.evmVersion,
        optimizer: {
          enabled: argv.mode === "production" || argv.report,
          runs: argv.runs,
        },
        viaIR: argv.viaIr,
        debug: {
          revertStrings: argv.revertStrings,
        },
      },
    },
  ],
};

const networksConfig: NetworksUserConfig = {
  hardhat: {
    chainId: argv.chainId,
    hardfork: argv.hardfork,
    mining: argv.slow ? { auto: false, interval: [3000, 6000] } : undefined,
    forking: argv.fork ? { url: argv.fork as string } : undefined,
  },
  ...Object.fromEntries(
    networkNames
      .map((name) => [name, { url: argv[`${name}Node`], accounts }] as const)
      .filter(([, { url }]) => url)
  ),
};

const config: HardhatUserConfig = {
  solidity: solidityConfig,
  networks: networksConfig,
  // @ts-ignore
  etherscan: {
    apiKey: Object.fromEntries(
      networkNames.map((name) => [name, argv.etherscan])
    ),
  },
  gasReporter: {
    enabled: argv.report,
    showMethodSig: true,
    currency: "USD",
    coinmarketcap: argv.coinmarketcap,
  },
};

debug("compilation")(JSON.stringify(solidityConfig.compilers, null, 2));

export default config;
