import Spiko.EVM

-- Spec lemmas for the EVM helpers: when each one succeeds, and with what result. Proofs about contracts use these
-- instead of unfolding the helpers again.

namespace Spiko.EVM

theorem bind_ok {ε α β : Type} {x : Except ε α} {f : α → Except ε β} {b : β} :
    (x >>= f) = .ok b ↔ ∃ a, x = .ok a ∧ f a = .ok b := by
  cases x <;> simp [bind, Except.bind]

theorem throw_ne_ok {ε α : Type} {e : ε} {b : α} : (throw e : Except ε α) ≠ .ok b := by
  simp [throw, throwThe, MonadExceptOf.throw]

theorem throw_bind_ne_ok {ε α β : Type} {e : ε} {f : α → Except ε β} {b : β} :
    ((throw e : Except ε α) >>= f) ≠ .ok b := by
  simp [throw, throwThe, MonadExceptOf.throw, bind, Except.bind]

-- `unless c do throw e; rest` as it appears once unfolded.
theorem ite_throw_ok {ε α : Type} {c : Prop} [Decidable c] {x : Except ε α} {e : ε} {f : PUnit → Except ε α}
    {a : α} : (if c then x else (throw e >>= f)) = .ok a ↔ c ∧ x = .ok a := by
  split <;> simp_all [throw_bind_ne_ok]

theorem pure_ok {ε α : Type} {x y : α} : (pure x : Except ε α) = .ok y ↔ x = y := by
  simp [pure, Except.pure]

theorem ite_pure_throw_ok {ε : Type} {c : Prop} [Decidable c] {e : ε} {u : PUnit} :
    (if c then pure () else throw e : Except ε PUnit) = .ok u ↔ c := by
  split <;> simp_all [pure, Except.pure, throw_ne_ok]

theorem ite_throw_ok' {ε α : Type} {c : Prop} [Decidable c] {x : Except ε α} {e : ε} {f : PUnit → Except ε α}
    {a : α} : (if c then (throw e >>= f) else x) = .ok a ↔ ¬c ∧ x = .ok a := by
  split <;> simp_all [throw_bind_ne_ok]

theorem checkedAdd_ok {n : Nat} {a b c : BitVec n} :
    checkedAdd a b = .ok c ↔ a.toNat + b.toNat < 2 ^ n ∧ c = a + b := by
  unfold checkedAdd; split
  · simp_all [eq_comm]
  · simp only [reduceCtorEq, false_iff, not_and]; intro; omega

theorem checkedMul_ok {n : Nat} {a b c : BitVec n} :
    checkedMul a b = .ok c ↔ a.toNat * b.toNat < 2 ^ n ∧ c = a * b := by
  unfold checkedMul; split
  · simp_all [eq_comm]
  · simp only [reduceCtorEq, false_iff, not_and]; intro; omega

theorem mulDiv_ok {x y d q : U256} :
    mulDiv x y d = .ok q ↔ d.toNat ≠ 0 ∧ q.toNat = x.toNat * y.toNat / d.toNat := by
  unfold mulDiv
  split
  · simp_all
  · dsimp only
    split
    · constructor
      · intro h; cases h; simp_all [BitVec.toNat_ofNat, Nat.mod_eq_of_lt]
      · rintro ⟨-, h⟩; congr; apply BitVec.eq_of_toNat_eq; simp_all [Nat.mod_eq_of_lt]
    · simp only [reduceCtorEq, false_iff, not_and]; intro _ h; have := q.isLt; omega

theorem toUint256_ok {v u : I256} : toUint256 v = .ok u ↔ 0 ≤ v.toInt ∧ u = v := by
  unfold toUint256; split
  · simp only [reduceCtorEq, false_iff, not_and]; intro; omega
  · simp_all [eq_comm]

theorem toNat_setWidth_48 (x : U48) : (x.setWidth 256).toNat = x.toNat := by
  simp only [BitVec.toNat_setWidth]; exact Nat.mod_eq_of_lt (by have := x.isLt; omega)

theorem toUint_ok {bits : Nat} {v : U256} {r : BitVec bits} :
    toUint bits v = .ok r ↔ v.toNat < 2 ^ bits ∧ r = v.setWidth bits := by
  unfold toUint; split
  · simp_all [eq_comm]
  · simp only [reduceCtorEq, false_iff, not_and]; intro; omega

theorem saturatingSub_toNat (a b : U256) : (saturatingSub a b).toNat = a.toNat - b.toNat := by
  unfold saturatingSub; split
  · rename_i h; rw [BitVec.le_def] at h; rw [BitVec.toNat_sub_of_le (BitVec.le_def.mpr h)]
  · rename_i h; rw [BitVec.le_def] at h; show (0 : U256).toNat = _; simp; omega

end Spiko.EVM
