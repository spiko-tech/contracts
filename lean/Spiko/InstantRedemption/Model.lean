import Spiko.EVM

-- Model of contracts/token/InstantRedemption.sol. Assumptions and scope: see lean/README.md.

namespace Spiko.InstantRedemption
open Spiko.EVM

inductive Selector where
  | redeem
  | setPair
  | removePair
  | setDailyLimit
  | withdraw
  deriving Repr, DecidableEq

inductive Error where
  | evm (r : Revert)
  | external (contract : Address) -- any revert inside another contract
  | restrictedAccess (caller target : Address) (selector : Selector)
  | unknownPair (token stablecoin : Address)
  | oracleTokenMismatch (oracle token : Address)
  | oracleValueTooOld (oracle : Address)
  | outputAmountTooLow (outputAmount minOutputAmount : U256)
  | dailyLimitExceeded (user : Address) (requested remaining : U256)
  deriving Repr, DecidableEq

instance : MonadLift (Except Revert) (Except Error) where
  monadLift := Except.mapError Error.evm

/-! ## Storage -/

structure Pair where
  oracle : Address
  oracleTTL : U48
  numerator : U256 -- 10 ** stablecoin.decimals()
  denominator : U256 -- 10 ** (token.decimals() + oracle.decimals())
  deriving Repr, DecidableEq, Inhabited

structure Usage where
  day : U48
  amount : U208
  deriving Repr, DecidableEq, Inhabited

abbrev PairId := Address × Address -- (token, stablecoin)

structure State where
  pairs : PairId → Pair
  dailyLimit : PairId → Address → U256
  usage : PairId → Address → Usage

def State.init : State where
  pairs := fun _ => default
  dailyLimit := fun _ _ => 0
  usage := fun _ _ => default

/-! ## Outside world -/

abbrev RedemptionId := Address × Address × Address × U256 × U256 -- (user, input, output, inputValue, salt)

-- What calls write outside the contract.
structure World where
  ir : State
  balances : Address → Address → U256 -- token → holder
  allowances : Address → Address → Address → U256 -- token → owner → spender
  redemptionUsed : RedemptionId → Bool -- Redemption.details[id].status != NULL

structure OracleRound where
  answer : I256
  updatedAt : U256

-- What calls only read. Arbitrary per call: theorems hold for every Env.
structure Env where
  self : Address
  redemption : Address
  sender : Address
  timestamp : U256
  canCall : Address → Address → Selector → Bool -- authority.canCall(caller, target, selector)
  latestRoundData : Address → Except Error OracleRound
  oracleToken : Address → Except Error Address
  decimals : Address → Except Error U8
  canTransfer : Address → Address → Address → Bool -- token → from → to (allowlist, pause, blacklist)
  redemptionOutputs : Address → Address → Bool -- _outputs[input].contains(output)
  redemptionMinimum : Address → U256

/-! ## External contracts -/

-- OpenZeppelin ERC20._update: the credit reads the balance after the debit (src = dst is a no-op) and wraps.
def erc20Transfer (env : Env) (w : World) (token src dst : Address) (amount : U256) : Except Error World := do
  if dst = 0 then throw (Error.external token)
  unless env.canTransfer token src dst do throw (Error.external token)
  unless amount ≤ w.balances token src do throw (Error.external token)
  let b := upd2 w.balances token src (w.balances token src - amount)
  return { w with balances := upd2 b token dst (b token dst + amount) }

def erc20TransferFrom (env : Env) (w : World) (token src dst : Address) (amount : U256) : Except Error World := do
  let allowed := w.allowances token src env.self
  let w ← if allowed = maxU256 then pure w else do
    unless amount ≤ allowed do throw (Error.external token)
    pure { w with allowances := upd w.allowances token (upd2 (w.allowances token) src env.self (allowed - amount)) }
  erc20Transfer env w token src dst amount

-- Redemption.onTransferReceived, reached through token.transferAndCall(redemption, value, abi.encode(output, salt)).
def redemptionOnTransferReceived (env : Env) (w : World) (input user : Address) (value : U256) (output : Address)
    (salt : U256) : Except Error World := do
  unless env.redemptionOutputs input output do throw (Error.external env.redemption)
  unless env.redemptionMinimum input ≤ value do throw (Error.external env.redemption)
  let id : RedemptionId := (user, input, output, value, salt)
  if w.redemptionUsed id then throw (Error.external env.redemption)
  -- deadline = block.timestamp.toUint48() + MAX_DELAY (14 days), checked in uint48
  unless env.timestamp.toNat + 14 * 86400 < 2 ^ 48 do throw (Error.external env.redemption)
  return { w with redemptionUsed := upd w.redemptionUsed id true }

/-! ## The contract -/

def restricted (env : Env) (sel : Selector) : Except Error Unit := do
  unless env.canCall env.sender env.self sel do throw (Error.restrictedAccess env.sender env.self sel)

def getLatestPrice (env : Env) (oracle : Address) (oracleTTL : U48) : Except Error U256 := do
  let round ← env.latestRoundData oracle
  let deadline ← checkedAdd round.updatedAt (oracleTTL.setWidth 256)
  unless env.timestamp < deadline do throw (Error.oracleValueTooOld oracle)
  toUint256 round.answer

def previewRedeem (env : Env) (s : State) (token stablecoin : Address) (amount : U256) : Except Error U256 := do
  let pair := s.pairs (token, stablecoin)
  if pair.oracle = 0 then throw (Error.unknownPair token stablecoin)
  let price ← getLatestPrice env pair.oracle pair.oracleTTL
  let num ← checkedMul pair.numerator price
  mulDiv amount num pair.denominator

def remainingDailyLimit (env : Env) (s : State) (token stablecoin user : Address) : U256 :=
  let usage := s.usage (token, stablecoin) user
  let used : U256 := if usage.day.setWidth 256 = env.timestamp / 86400 then usage.amount.setWidth 256 else 0
  saturatingSub (s.dailyLimit (token, stablecoin) user) used

def redeem (env : Env) (w : World) (token stablecoin : Address) (amount minOutputAmount salt : U256) :
    Except Error (World × U256) := do
  restricted env .redeem
  let pairId := (token, stablecoin)
  let outputAmount ← previewRedeem env w.ir token stablecoin amount
  let minimum : U256 := if minOutputAmount = 0 then 1 else minOutputAmount
  unless minimum ≤ outputAmount do throw (Error.outputAmountTooLow outputAmount minimum)
  let remaining := remainingDailyLimit env w.ir token stablecoin env.sender
  unless outputAmount ≤ remaining do throw (Error.dailyLimitExceeded env.sender outputAmount remaining)
  let today ← toUint 48 (env.timestamp / 86400)
  let usage := w.ir.usage pairId env.sender
  let usage : Usage := if usage.day = today then usage else { day := today, amount := 0 }
  let added ← toUint 208 outputAmount
  let newAmount ← checkedAdd usage.amount added
  let w := { w with ir := { w.ir with usage := upd2 w.ir.usage pairId env.sender { usage with amount := newAmount } } }
  let w ← erc20TransferFrom env w token env.sender env.self amount
  let w ← erc20Transfer env w stablecoin env.self env.sender outputAmount
  let w ← erc20Transfer env w token env.self env.redemption amount
  let w ← redemptionOnTransferReceived env w token env.self amount stablecoin salt
  return (w, outputAmount)

def setPair (env : Env) (w : World) (token stablecoin oracle : Address) (oracleTTL : U48) : Except Error World := do
  restricted env .setPair
  let oracleTok ← env.oracleToken oracle
  unless oracleTok = token do throw (Error.oracleTokenMismatch oracle token)
  let numerator ← checkedPow 10 (← env.decimals stablecoin).toNat
  let exponent ← checkedAdd (← env.decimals token) (← env.decimals oracle)
  let denominator ← checkedPow 10 exponent.toNat
  let pair : Pair := { oracle, oracleTTL, numerator, denominator }
  return { w with ir := { w.ir with pairs := upd w.ir.pairs (token, stablecoin) pair } }

def removePair (env : Env) (w : World) (token stablecoin : Address) : Except Error World := do
  restricted env .removePair
  return { w with ir := { w.ir with pairs := upd w.ir.pairs (token, stablecoin) default } }

def setDailyLimit (env : Env) (w : World) (token stablecoin user : Address) (limit : U256) : Except Error World := do
  restricted env .setDailyLimit
  return { w with ir := { w.ir with dailyLimit := upd2 w.ir.dailyLimit (token, stablecoin) user limit } }

def withdraw (env : Env) (w : World) (token to : Address) (amount : U256) : Except Error World := do
  restricted env .withdraw
  let value := if amount = maxU256 then w.balances token env.self else amount
  erc20Transfer env w token env.self to value

end Spiko.InstantRedemption
