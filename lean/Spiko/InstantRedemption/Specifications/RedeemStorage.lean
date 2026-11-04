import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- A redeem only changes the caller's usage on that pair. -/
theorem redeem_storage (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    w'.ir.pairs = w.ir.pairs ∧ w'.ir.dailyLimit = w.ir.dailyLimit ∧
      ∀ p u, (p, u) ≠ ((token, stablecoin), env.sender) → w'.ir.usage p u = w.ir.usage p u :=
  redeem_storage_ok h

end Spiko.InstantRedemption
