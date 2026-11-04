import Spiko.InstantRedemption.Specifications.PreviewRedeemOk

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- Rounding is down, by less than one unit. -/
theorem previewRedeem_floor (hp : s.pairs (token, stablecoin) = pair)
    (hr : env.latestRoundData pair.oracle = .ok round)
    (h : previewRedeem env s token stablecoin amount = .ok out) :
    out.toNat * pair.denominator.toNat ≤ amount.toNat * (pair.numerator.toNat * round.answer.toNat) ∧
      amount.toNat * (pair.numerator.toNat * round.answer.toNat) < (out.toNat + 1) * pair.denominator.toNat := by
  obtain ⟨round', hr', -, -, -, hden, hout⟩ := previewRedeem_ok hp h
  -- the oracle answered once: both rounds are the same
  obtain rfl : round' = round := Except.ok.inj (hr'.symm.trans hr)
  rw [hout]
  -- name the pieces so omega sees them as opaque numbers
  generalize amount.toNat * (pair.numerator.toNat * round'.answer.toNat) = A
  generalize pair.denominator.toNat = d at hden ⊢
  have := Nat.div_add_mod A d
  have := Nat.mod_lt A (Nat.pos_of_ne_zero hden)
  constructor
  · exact Nat.div_mul_le_self A d
  · rw [Nat.add_mul, Nat.one_mul, Nat.mul_comm (A / d) d]; omega

end Spiko.InstantRedemption
