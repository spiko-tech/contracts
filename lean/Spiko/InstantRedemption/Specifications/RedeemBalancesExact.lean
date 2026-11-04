import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- Exact effect of a redeem on every balance, with no hypotheses: the three transfers (user → this, this → user,
this → Redemption), each as a debit and a credit. Covers the edge cases (token = stablecoin, caller = this...), where
some terms cancel. Arithmetic is modulo 2²⁵⁶, as on chain. -/
theorem redeem_balances_exact (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    ∀ t holder, w'.balances t holder = w.balances t holder
      - (if t = token ∧ holder = env.sender then amount else 0) + (if t = token ∧ holder = env.self then amount else 0)
      - (if t = stablecoin ∧ holder = env.self then out else 0) + (if t = stablecoin ∧ holder = env.sender then out else 0)
      - (if t = token ∧ holder = env.self then amount else 0)
      + (if t = token ∧ holder = env.redemption then amount else 0) := by
  intro t holder
  obtain ⟨-, -, -, -, _, _, _, w₁, w₂, w₃, -, -, -, h₁, h₂, h₃, h₄⟩ := redeem_ok h
  have k₁ := erc20TransferFrom_balances h₁
  obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h₂
  obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h₃
  obtain ⟨-, -, -, -, rfl⟩ := redemptionOnTransferReceived_ok.mp h₄
  simp only [transferBalances_apply, k₁]

end Spiko.InstantRedemption
