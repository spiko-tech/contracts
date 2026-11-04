import Spiko.InstantRedemption.Specifications.RedeemBalancesExact

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- Corollary for distinct addresses: a redeem moves exactly `amount` tokens from the user to Redemption and `out` stablecoins from the buffer to the
user. No other balance changes. -/
theorem redeem_balances (h : redeem env w token stablecoin amount minOut salt = .ok (w', out))
    (hts : token ≠ stablecoin) (hus : env.sender ≠ env.self) (hrs : env.redemption ≠ env.self)
    (hur : env.sender ≠ env.redemption) :
    w'.balances token env.sender = w.balances token env.sender - amount ∧
      w'.balances token env.redemption = w.balances token env.redemption + amount ∧
      w'.balances stablecoin env.sender = w.balances stablecoin env.sender + out ∧
      w'.balances stablecoin env.self = w.balances stablecoin env.self - out ∧
      ∀ t h, ¬(t = token ∧ (h = env.sender ∨ h = env.redemption)) →
        ¬(t = stablecoin ∧ (h = env.sender ∨ h = env.self)) → w'.balances t h = w.balances t h := by
  have hx := redeem_balances_exact h
  have hd := And.intro hts (And.intro hts.symm (And.intro hus (And.intro hus.symm (And.intro hrs (And.intro hrs.symm (And.intro hur hur.symm))))))
  refine ⟨?_, ?_, ?_, ?_, fun t h₁ h₂ h₃ => ?_⟩
  · rw [hx]; simp [hd]
  · rw [hx]; simp [hd]
  · rw [hx]; simp [hd]
  · rw [hx]; simp [hd]
  · rw [hx]
    by_cases ht : t = token <;> by_cases hs : t = stablecoin <;> simp_all
    all_goals exact BitVec.add_sub_cancel _ _

end Spiko.InstantRedemption
