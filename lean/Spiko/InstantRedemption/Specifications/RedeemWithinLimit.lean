import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- After a redeem, today's usage is within the limit in force during the call. -/
theorem redeem_within_limit (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    let u := w'.ir.usage (token, stablecoin) env.sender
    u.day.toNat = env.timestamp.toNat / 86400 ∧
      u.amount.toNat ≤ (w.ir.dailyLimit (token, stablecoin) env.sender).toNat := by
  obtain ⟨-, hday, hamount, hle⟩ := redeem_usage h
  exact ⟨hday, by omega⟩

end Spiko.InstantRedemption
