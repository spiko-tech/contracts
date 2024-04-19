![ci](https://github.com/spiko-tech/contracts/actions/workflows/ci.yaml/badge.svg)

# Spiko Contracts

Welcome to the Spiko Contracts repository. Here you'll find the smart contracts powering Spiko's tokenization of securities on public blockchains. These contracts are the backbone of the first fully-licensed money market funds in the EU issued on-chain:

- **Spiko US T-Bills Money Market Fund** (USTBL)
- **Spiko EU T-Bills Money Market Fund** (EUTBL)

If you're eager to dive deeper into Spiko, explore our [website](https://www.spiko.xyz), delve into our [documentation](https://docs.spiko.xyz), and stay updated with our [blog](https://www.spiko.xyz/blog). Do not hesitate to reach out!

## Overview

The token contrat is an UUPS-upgradeable ERC-20 token leveraging OpenZeppelin's contracts. It is also ERC-1363 compliant. The redemption contract allows for token holders to redeem their fund shares. The oracle contract implements Chainlink's `AggregatorV3Interface`. A Permission Manager governs all the privileged functions of these contracts.

If you are curious about our design choices for these contracts, we've written a [blogpost](https://www.spiko.xyz/blog) on the topic.

## Third-party audit

This repository has undergone an audit conducted by security firm Trail of Bits. Their audit report is available on their [repo](https://github.com/trailofbits/publications).

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
COMPILER=0.8.24
EVM_VERSION=cancun
MODE=production

# Migration
DEBUG=migration
PRIVATE_KEY=
MAINNET_NODE=
GOERLI_NODE=
SEPOLIA_NODE=
ETHERSCAN=
```

Note: The variable `ETHERSCAN` should be used also when deploying to polygonscan (polygon/polygonAmoy) with API key coming from polygonscan.

- Add custom addresses in the `script/config.json` file for the different persmissions groups

- Deploy

```sh
pnpm hardhat run scripts/migrate.js --network <sepolia or polygonAmoy>
```

## Verification

- Verify contracts and publish source code on Etherscan

```sh
pnpm hardhat verify --network <sepolia or polygonAmoy> <proxy address of the smart contracts to be verified> <for all contracts except PermissionManager, address of the PermissionManager>
```

Note: if verification is failing with following error:

```
Failed to link proxy 0xD427D8a70945B0d4304A2B1E40Ea2A23356A5A09 with its implementation. Reason: The implementation contract at 0x5404947eee032813092f4551a0fe367bc621e8c1 does not seem to be verified. Please verify and publish the contract source before proceeding with this proxy verification.
```

You could refer to https://mumbai.polygonscan.com/proxyContractChecker
