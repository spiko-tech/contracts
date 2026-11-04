import Spiko.InstantRedemption.Specifications.PreviewRedeemOk

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- A higher price never pays less. -/
theorem previewRedeem_mono_price (hp : s.pairs (token, stablecoin) = pair)
    (hr₁ : env₁.latestRoundData pair.oracle = .ok round₁) (hr₂ : env₂.latestRoundData pair.oracle = .ok round₂)
    (hprice : round₁.answer.toNat ≤ round₂.answer.toNat)
    (h₁ : previewRedeem env₁ s token stablecoin amount = .ok o₁)
    (h₂ : previewRedeem env₂ s token stablecoin amount = .ok o₂) : o₁ ≤ o₂ := by
  obtain ⟨r₁, hr₁', -, -, -, -, ho₁⟩ := previewRedeem_ok hp h₁
  obtain ⟨r₂, hr₂', -, -, -, -, ho₂⟩ := previewRedeem_ok hp h₂
  obtain rfl : r₁ = round₁ := Except.ok.inj (hr₁'.symm.trans hr₁)
  obtain rfl : r₂ = round₂ := Except.ok.inj (hr₂'.symm.trans hr₂)
  rw [BitVec.le_def, ho₁, ho₂]
  exact Nat.div_le_div_right (Nat.mul_le_mul_left _ (Nat.mul_le_mul_left _ hprice))

end Spiko.InstantRedemption
