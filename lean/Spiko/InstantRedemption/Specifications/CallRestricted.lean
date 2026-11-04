import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- Every call fails unless the authority allows the caller. -/
theorem call_restricted (c : Call) {r : World × Option Redeemed} (h : c.run env w = .ok r) :
    env.canCall env.sender env.self c.selector = true := by
  cases c <;> simp only [Call.run, Call.selector, bind_ok] at h ⊢
  case redeem => obtain ⟨_, h, -⟩ := h; exact (redeem_ok h).1
  all_goals
    obtain ⟨_, h, -⟩ := h
    simp only [setPair, removePair, setDailyLimit, withdraw, restricted, bind_ok, ite_pure_throw_ok] at h
    obtain ⟨_, h, -⟩ := h
    exact h

end Spiko.InstantRedemption
