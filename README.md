# contracts

- install dependencies

```sh
yarn install
```

- compile

```sh
npm run compile
```

- add `.env` file with following infos:

```sh
# Compilation
COMPILER=0.8.21
EVM_VERSION=paris
MODE=production

# Migration
DEBUG=migration
PRIVATE_KEY=
MAINNET_NODE=
GOERLI_NODE=
SEPOLIA_NODE=
ETHERSCAN=
```

Note: use `EVM_VERSION=paris` for Sepolia / Mumbai or `EVM_VERSION=shanghai` for GOERLI / Polygon and Mainnet
Note: The variable `ETHERSCAN` should be used also when deploying to polygonscan (mumbai/polygon) with API key coming from polygonscan.

- deploy

```sh
npx hardhat run scripts/migrate.js --network <sepolia or goerli>
```

- verify contracts and publish source code

```sh
npx hardhat verify --network <sepolia or goerli> <proxy address of the smart contracts to be verified> <for all contracts except PermissionManager, address of the PermissionManager>
```

Note: if verification is failing with following error:

```
Failed to link proxy 0xD427D8a70945B0d4304A2B1E40Ea2A23356A5A09 with its implementation. Reason: The implementation contract at 0x5404947eee032813092f4551a0fe367bc621e8c1 does not seem to be verified. Please verify and publish the contract source before proceeding with this proxy verification.
```

you could refer to https://mumbai.polygonscan.com/proxyContractChecker
