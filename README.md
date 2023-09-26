# contracts

- install dependencies

```sh
npm i
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

Note: use `EVM_VERSION=paris` for Sepolia or `EVM_VERSION=shanghai` for GOERLI

- deploy

```sh
npx hardhat run scripts/migrate.js --network <sepolia or goerli>
```

- verify contracts and publish source code 

```sh
npx hardhat verify --network <sepolia or goerli> <proxy address of the smart contracts to be verified> <for all contracts except PermissionManager, address of the PermissionManager>
```
