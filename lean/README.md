# Formal model (Lean 4)

A Lean model of `contracts/token/InstantRedemption.sol` and proofs of its properties.

| File | Content |
|---|---|
| `Spiko/EVM.lean` | Solidity 0.8 semantics: 256-bit words, checked math, `mulDiv`, `SafeCast` |
| `Spiko/InstantRedemption/Model.lean` | The contract, function by function |
| `Spiko/InstantRedemption/Examples.lean` | Concrete runs checked at build time (`#guard`) |

## Setup

```sh
curl https://elan.lean-lang.org/elan-init.sh -sSf | sh -s -- -y --default-toolchain none
cd lean && lake build   # first run downloads the toolchain pinned in lean-toolchain
```

Editor: VS Code with the `lean4` extension. Open the `lean/` folder; hover any name to see its type and docs.

## Modelling choices

- One Lean function per Solidity function: `Env → World → args → Except Error result`. A revert is `.error`, so a reverted call changes nothing by construction.
- Statements run in Solidity's order, so the first failing check gives the same error on both sides.
- Mappings are functions; unset entries are zero, as in EVM storage.
- keccak is assumed collision-free on our inputs: `pairId` is `(token, stablecoin)`, a Redemption request id is the tuple it hashes.
- `Env` holds what a call only reads from other contracts (oracle answers, decimals, permissions, token transfer rules, Redemption's configuration). It is arbitrary per call, so theorems hold whatever those contracts answer.
- `World` holds what calls write: this contract's storage, ERC-20 balances and allowances, Redemption's used request ids.
- A revert inside another contract is `Error.external c`; revert reasons are only compared for this contract.
- Out of scope: UUPS upgrades, events, `Multicall` (a batch is a sequence of calls, covered by proofs over sequences).
