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
HARDFORK=paris
MODE=production

# Migration
DEBUG=migration
PRIVATE_KEY=
SEPOLIA_NODE=
ETHERSCAN=
```

Note: use `HARDFORK=paris` for Sepolia and `HARDFORK=shanghai` for GOERLI

- deploy

```sh
npx hardhat run scripts/migrate.js --network <sepolia or goerli>
```

- verify contracts and publish source code 

  ```sh
npx hardhat verify --network <sepolia or goerli> <proxy address of the smart contracts to be verified> <for all contracts except PermissionManager, address of the PermissionManager>
  ```
