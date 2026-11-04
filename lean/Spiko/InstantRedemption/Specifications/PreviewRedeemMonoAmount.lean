import Spiko.InstantRedemption.Specifications.PreviewRedeemOk

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- More tokens never pay less. -/
theorem previewRedeem_mono_amount (h₁ : previewRedeem env s token stablecoin a₁ = .ok o₁)
    (h₂ : previewRedeem env s token stablecoin a₂ = .ok o₂) (ha : a₁ ≤ a₂) : o₁ ≤ o₂ := by
  obtain ⟨r₁, hr₁, -, -, -, -, ho₁⟩ := previewRedeem_ok rfl h₁
  obtain ⟨r₂, hr₂, -, -, -, -, ho₂⟩ := previewRedeem_ok rfl h₂
  obtain rfl : r₁ = r₂ := Except.ok.inj (hr₁.symm.trans hr₂)
  rw [BitVec.le_def] at ha ⊢
  rw [ho₁, ho₂]
  exact Nat.div_le_div_right (Nat.mul_le_mul_right _ ha)

end Spiko.InstantRedemption
