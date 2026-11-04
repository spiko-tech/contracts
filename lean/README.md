# Formal model (Lean 4)

A Lean model of `contracts/token/InstantRedemption.sol` and proofs of its properties.

| File | Content |
|---|---|
| `Spiko/EVM.lean` | Solidity 0.8 semantics: 256-bit words, checked math, `mulDiv`, `SafeCast` |
| `Spiko/InstantRedemption/Model.lean` | The contract, function by function |
| `Spiko/InstantRedemption/Examples.lean` | Concrete runs checked at build time (`#guard`) |
| `Spiko/InstantRedemption/Trace.lean` | Sequences of calls, interleaved with other contracts' actions |
| `Spiko/InstantRedemption/Specifications/` | The properties, one theorem per file, all proven (index: `Specifications.lean`; lemmas in `Lemmas.lean`, `DailyLimit.lean`) |
| `DiffTest.lean` | `difftest` executable: replays a call sequence on the model |

## Setup

```sh
curl https://elan.lean-lang.org/elan-init.sh -sSf | sh -s -- -y --default-toolchain none
cd lean && lake build   # first run downloads the toolchain pinned in lean-toolchain
```

Editor: VS Code with the `lean4` extension. Open the `lean/` folder; hover any name to see its type and docs.

## Differential test

The proofs are about the model. `test/instantRedemption.difftest.js` checks the model against the Solidity: it runs
random call sequences on the deployed contracts (Hardhat), replays them with `difftest`, and compares every step
(result or revert reason, balances, daily limit, pair).

```sh
cd lean && lake build && cd ..
LEAN_DIFFTEST=lean/.lake/build/bin/difftest npx hardhat test test/instantRedemption.difftest.js
```

`DIFFTEST_SEED`, `DIFFTEST_RUNS` and `DIFFTEST_STEPS` replay or widen the search.

## Modelling choices

- One Lean function per Solidity function: `Env → World → args → Except Error result`. A revert is `.error`, so a reverted call changes nothing by construction.
- Statements run in Solidity's order, so the first failing check gives the same error on both sides.
- Mappings are functions; unset entries are zero, as in EVM storage.
- keccak is assumed collision-free on our inputs: `pairId` is `(token, stablecoin)`, a Redemption request id is the tuple it hashes.
- `Env` holds what a call only reads from other contracts (oracle answers, decimals, permissions, token transfer rules, Redemption's configuration). It is arbitrary per call, so theorems hold whatever those contracts answer.
- `World` holds what calls write: this contract's storage, ERC-20 balances and allowances, Redemption's used request ids.
- A revert inside another contract is `Error.external c`; revert reasons are only compared for this contract.
- Out of scope: UUPS upgrades, events, `Multicall` (a batch is a sequence of calls, covered by proofs over sequences).

## Assumptions the proofs rely on

- No reentrancy: the tokens, the oracle and Redemption do not call back into this contract.
- OpenZeppelin `Math.mulDiv` computes `⌊x·y/d⌋` and reverts on overflow or `d = 0`.
- Block timestamps never decrease (`htime` in `daily_limit`).
- Other contracts never write this contract's storage, and Redemption never frees a used request id (`External`).
- Revert reasons inside other contracts and the order of the `decimals()` calls in `setPair` are not modelled; the
  differential test compares only `external` for those.
