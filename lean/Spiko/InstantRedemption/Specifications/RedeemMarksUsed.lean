import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- A redeem registers its request with this contract as the owner. -/
theorem redeem_marks_used (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    w'.redemptionUsed (env.self, token, stablecoin, amount, salt) = true := by
  obtain ⟨-, -, -, -, _, _, _, _, _, _, -, -, -, -, -, -, h₄⟩ := redeem_ok h
  obtain ⟨-, -, -, -, rfl⟩ := redemptionOnTransferReceived_ok.mp h₄
  simp [upd]

end Spiko.InstantRedemption
