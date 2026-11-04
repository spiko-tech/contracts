import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- A used request id makes any redeem with the same token, stablecoin, amount and salt fail, whoever calls. -/
theorem redeem_rejects_used (hu : w.redemptionUsed (env.self, token, stablecoin, amount, salt) = true) :
    ∀ r, redeem env w token stablecoin amount minOut salt ≠ .ok r := by
  rintro ⟨w', out⟩ h
  obtain ⟨-, -, -, -, _, _, _, w₁, w₂, w₃, -, -, -, h₁, h₂, h₃, h₄⟩ := redeem_ok h
  have k₁ := (erc20TransferFrom_keeps h₁).2
  obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h₂
  obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h₃
  obtain ⟨-, -, hfree, -⟩ := redemptionOnTransferReceived_ok.mp h₄
  simp_all

end Spiko.InstantRedemption
