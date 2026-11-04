import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- A redeem pays at least `max(minOutputAmount, 1)`. -/
theorem redeem_output_min (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    minOut ≤ out ∧ 0 < out :=
  redeem_min h

end Spiko.InstantRedemption
