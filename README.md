![ci](https://github.com/spiko-tech/contracts/actions/workflows/ci.yaml/badge.svg)

# Spiko Contracts

Welcome to the Spiko Contracts repository. Here you'll find the smart contracts powering Spiko's tokenization of securities on public blockchains. These contracts are the backbone of the first fully-licensed money market funds in the EU issued on-chain:

- **Spiko US T-Bills Money Market Fund** (USTBL)
- **Spiko EU T-Bills Money Market Fund** (EUTBL)

If you're eager to dive deeper into Spiko, explore our [website](https://www.spiko.xyz), and stay updated with our [blog](https://www.spiko.xyz/blog). Do not hesitate to reach out!

## Overview

The token contrat is an UUPS-upgradeable ERC-20 token leveraging OpenZeppelin's contracts. It is also ERC-1363 compliant and support both ERC-2612 (ERC-20 Permit Extension) and ERC-2771 (Meta Transactions). The redemption contract allows for token holders to redeem their fund shares. The oracle contract implements Chainlink's `AggregatorV3Interface`. A Permission Manager governs all the privileged functions of these contracts.

If you are curious about our design choices for these contracts, we'll write an article on our [blog](https://www.spiko.xyz/blog) soon on the topic.

## Third-party audit

This repository has undergone an audit conducted by security firm Trail of Bits. Their audit report is available [here](https://github.com/trailofbits/publications/blob/master/reviews/2023-10-spiko-securityreview.pdf).

## Prerequisites

- Node LTS (20)
- PNPM

## Installation

- Install dependencies

```sh
pnpm install
```

- Compile

```sh
pnpm compile
```

## Run test

```sh
pnpm test
```

## Deployment

- Create an `.env` file in the root directory with the following variables:

```sh
# Compilation
COMPILER=0.8.27
EVM_VERSION=cancun
MODE=production

# Migration
DEBUG=migration
PRIVATE_KEY=
MAINNET_NODE=
SEPOLIA_NODE=
ARBITRUM_ONE_NODE=
ETHERSCAN=
```

Notes:

- `PRIVATE_KEY` must be given without the `0x` prefix. The config parser coerces `0x`-prefixed hex to a number and hardhat then rejects it (`Invalid account: Expected string, received number`).
- `ETHERSCAN` is an Etherscan V2 multichain key and covers every chain listed in `hardhat.config.js`.
- A network only exists if its `<NETWORK>_NODE` variable is set (for example `ARBITRUM_ONE_NODE` for `arbitrumOne`, `BASE_NODE` for `base`).
- Never set `FORCE`: it clears the deployment cache and redeploys every contract.

- Add custom addresses in `scripts/config-default.json` for the different permission groups

- Deploy

```sh
pnpm hardhat run scripts/migrate.js --network <sepolia or polygonAmoy>
```

`scripts/migrate.js` deploys the full stack from `scripts/config-default.json` and then writes permissions as the deployer. It only reads `config-default.json` (the `config-<chainId>.json` files are not loaded) and the permission writes require the deployer to be admin. It is therefore only suitable for a fresh deployment on a new network. To add one contract to an existing network, follow the next section.

## Deploying a single contract to an existing network

This example adds the `Archiver` on Arbitrum One (chain id 42161). The same steps apply to any network and any `PermissionManaged` UUPS contract.

1. Look up the `PermissionManager` address in `.cache-<chainId>.json` under `manager.address`. On Arbitrum One it is `0xa925C217e4c1C82Ee721eBD496d3863D5C2d829A`.

2. Deploy the proxy from the hardhat console. `args` is empty because `Archiver` has no initializer; `constructorArgs` feeds `constructor(IAuthority)`.

```sh
pnpm hardhat console --network arbitrumOne
```

```js
const managerAddress = '0xa925C217e4c1C82Ee721eBD496d3863D5C2d829A';
const factory = await ethers.getContractFactory('Archiver');
const archiver = await upgrades.deployProxy(factory, [], { kind: 'uups', constructorArgs: [managerAddress] });
await archiver.waitForDeployment();

archiver.target; // proxy address
archiver.deploymentTransaction().hash; // deployment tx hash
await upgrades.erc1967.getImplementationAddress(archiver.target); // implementation address
```

3. Record the deployment in `.cache-<chainId>.json`, next to the existing entries:

```json
"archiver": {
  "txHash": "<deployment tx hash>",
  "address": "<proxy address>"
}
```

The OpenZeppelin plugin has already added the proxy and implementation to `.openzeppelin/<network>.json`. Commit both files.

4. Grant the permission from the admin Safe. `setRequirements` is admin-only and the deployer renounced admin at the end of the initial migration. Build the calldata in the same console:

```js
const manager = await ethers.getContractAt('PermissionManager', managerAddress);
const selector = archiver.interface.getFunction('archiveEvent').selector; // 0x95499796
const config = require('./scripts/config-42161.json');
const groupId = Object.keys(config.roles).indexOf('archiver'); // 11
manager.interface.encodeFunctionData('setRequirements', [archiver.target, [selector], [groupId]]);
```

Execute the resulting calldata against the `PermissionManager` from the Safe, or use the Safe Transaction Builder with `setRequirements(address,bytes4[],uint8[])` and the three values above. The group id is the position of the role in `roles` of the config file; `admin` is 0.

Members are added afterwards with `addGroup(<address>, <groupId>)`, also from the Safe. Until then only the admin can call `archiveEvent`.

5. Verify the implementation on the explorer (the implementation address, not the proxy):

```sh
pnpm hardhat verify --network arbitrumOne <implementation address> 0xa925C217e4c1C82Ee721eBD496d3863D5C2d829A
```

6. Read back on-chain:

```js
await archiver.supportsInterface('0x95499796'); // true
await manager.getRequirements(archiver.target, '0x95499796'); // bits 0 and 11 set once the Safe tx has landed
```

## Verification

- Verify contracts and publish source code on Etherscan

```sh
pnpm hardhat verify --network <sepolia or polygonAmoy> <proxy address of the smart contracts to be verified> <for all contracts except PermissionManager, address of the PermissionManager> <address of the Forwarder>
```

Note: if verification is failing with following error:

```
Failed to link proxy 0xD427D8a70945B0d4304A2B1E40Ea2A23356A5A09 with its implementation. Reason: The implementation contract at 0x5404947eee032813092f4551a0fe367bc621e8c1 does not seem to be verified. Please verify and publish the contract source before proceeding with this proxy verification.
```

You could refer to https://mumbai.polygonscan.com/proxyContractChecker
