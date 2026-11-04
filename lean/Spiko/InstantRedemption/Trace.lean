import Spiko.InstantRedemption.Model

-- Sequences of calls, to state properties that span several transactions.

namespace Spiko.InstantRedemption
open Spiko.EVM

inductive Call where
  | redeem (token stablecoin : Address) (amount minOutputAmount salt : U256)
  | setPair (token stablecoin oracle : Address) (oracleTTL : U48)
  | removePair (token stablecoin : Address)
  | setDailyLimit (token stablecoin user : Address) (limit : U256)
  | withdraw (token to : Address) (amount : U256)

def Call.selector : Call → Selector
  | .redeem .. => .redeem
  | .setPair .. => .setPair
  | .removePair .. => .removePair
  | .setDailyLimit .. => .setDailyLimit
  | .withdraw .. => .withdraw

-- A successful redeem, with the daily limit in force when it ran.
structure Redeemed where
  pair : PairId
  user : Address
  day : Nat
  out : Nat
  limit : Nat

def Call.run (env : Env) (w : World) : Call → Except Error (World × Option Redeemed)
  | .redeem t c a m s => do
    let (w', out) ← InstantRedemption.redeem env w t c a m s
    return (w', some { pair := (t, c), user := env.sender, day := env.timestamp.toNat / 86400, out := out.toNat,
                       limit := (w.ir.dailyLimit (t, c) env.sender).toNat })
  | .setPair t c o ttl => return (← InstantRedemption.setPair env w t c o ttl, none)
  | .removePair t c => return (← InstantRedemption.removePair env w t c, none)
  | .setDailyLimit t c u l => return (← InstantRedemption.setDailyLimit env w t c u l, none)
  | .withdraw t to a => return (← InstantRedemption.withdraw env w t to a, none)

-- Anything other contracts do between our calls: transfers, approvals, Redemption executing or canceling requests.
-- Assumption: it never touches our storage and never frees a used request id (status never goes back to NULL).
structure External where
  apply : World → World
  keepsIr : ∀ w, (apply w).ir = w.ir
  keepsUsed : ∀ w id, w.redemptionUsed id = true → (apply w).redemptionUsed id = true

inductive Step where
  | call (env : Env) (c : Call)
  | external (e : External)

def Step.timestamp? : Step → Option Nat
  | .call env _ => some env.timestamp.toNat
  | .external _ => none

-- Final world and log of successful redeems. A reverted call leaves the world unchanged.
def exec (w : World) : List Step → World × List Redeemed
  | [] => (w, [])
  | .external e :: rest => exec (e.apply w) rest
  | .call env c :: rest =>
    match c.run env w with
    | .ok (w', r) => let next := exec w' rest; (next.1, r.toList ++ next.2)
    | .error _ => exec w rest

end Spiko.InstantRedemption
