import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-- A successful preview implies a known pair, a fresh non-negative price, a non-zero denominator, and the exact
floor formula. -/
theorem previewRedeem_ok (hp : s.pairs (token, stablecoin) = pair)
    (h : previewRedeem env s token stablecoin amount = .ok out) :
    ∃ round, env.latestRoundData pair.oracle = .ok round ∧
      pair.oracle ≠ 0 ∧
      env.timestamp.toNat < round.updatedAt.toNat + pair.oracleTTL.toNat ∧
      0 ≤ round.answer.toInt ∧
      pair.denominator.toNat ≠ 0 ∧
      out.toNat = amount.toNat * (pair.numerator.toNat * round.answer.toNat) / pair.denominator.toNat := by
  simp only [previewRedeem, getLatestPrice, hp] at h
  split at h
  · exact absurd h throw_bind_ne_ok
  simp only [bind_ok, liftM_ok, checkedAdd_ok, checkedMul_ok, mulDiv_ok, ite_throw_ok, toUint256_ok] at h
  obtain ⟨_, ⟨round, hr, _, ⟨hd, rfl⟩, hlt, hprice, rfl⟩, _, ⟨hn, rfl⟩, hden, hout⟩ := h
  rw [toNat_setWidth_48] at hd
  refine ⟨round, hr, ‹_›, ?_, hprice, hden, ?_⟩
  · rw [BitVec.lt_def, BitVec.toNat_add, toNat_setWidth_48, Nat.mod_eq_of_lt hd] at hlt; exact hlt
  · rw [hout, BitVec.toNat_mul, Nat.mod_eq_of_lt hn]

end Spiko.InstantRedemption
