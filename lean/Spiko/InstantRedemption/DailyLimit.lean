import Spiko.InstantRedemption.Lemmas

-- Proof machinery for `daily_limit`: an invariant linking the `usage` storage to the log of past redeems.

namespace Spiko.InstantRedemption
open Spiko.EVM

-- Total paid to user `u` on pair `p` during day `d`, according to log `L`.

def total (L : List Redeemed) (p : PairId) (u : Address) (d : Nat) : Nat :=
  ((L.filter fun r => decide (r.pair = p ∧ r.user = u ∧ r.day = d)).map (·.out)).sum

theorem total_append (A B : List Redeemed) (p : PairId) (u : Address) (d : Nat) :
    total (A ++ B) p u d = total A p u d + total B p u d := by
  simp [total, List.filter_append, List.map_append, List.sum_append]

theorem total_single (e : Redeemed) (p : PairId) (u : Address) (d : Nat) :
    total [e] p u d = if e.pair = p ∧ e.user = u ∧ e.day = d then e.out else 0 := by
  simp only [total, List.filter_cons, List.filter_nil]; split <;> simp_all

theorem total_eq_zero {P : List Redeemed} {p : PairId} {u : Address} {d : Nat}
    (h : ∀ r ∈ P, r.pair = p → r.user = u → r.day < d) : total P p u d = 0 := by
  simp only [total]
  rw [List.filter_eq_nil_iff.mpr]
  · rfl
  · intro r hr hd
    simp only [decide_eq_true_eq] at hd
    have := h r hr hd.1 hd.2.1; omega

variable {env : Env} {w w' : World}

-- The invariant behind daily_limit, relating storage to the log `P` emitted so far and the last timestamp `T`.
structure LimitInv (w : World) (P : List Redeemed) (T : Nat) : Prop where
  amount : ∀ p u, total P p u (w.ir.usage p u).day.toNat = (w.ir.usage p u).amount.toNat
  past : ∀ r ∈ P, r.day ≤ (w.ir.usage r.pair r.user).day.toNat
  now : ∀ p u, (w.ir.usage p u).day.toNat ≤ T / 86400

theorem inv_init (h₀ : w.ir = State.init) : LimitInv w [] 0 where
  amount p u := by rw [h₀]; rfl
  past r hr := by simp at hr
  now p u := by rw [h₀]; exact Nat.le_refl _

theorem inv_of_usage {P : List Redeemed} {T : Nat} (hu : w'.ir.usage = w.ir.usage) (hinv : LimitInv w P T) :
    LimitInv w' P T where
  amount p u := by rw [hu]; exact hinv.amount p u
  past r hr := by rw [hu]; exact hinv.past r hr
  now p u := by rw [hu]; exact hinv.now p u

theorem inv_mono {P : List Redeemed} {T T' : Nat} (hinv : LimitInv w P T) (hT : T ≤ T') : LimitInv w P T' where
  amount := hinv.amount
  past := hinv.past
  now p u := Nat.le_trans (hinv.now p u) (Nat.div_le_div_right hT)

theorem inv_redeem {P : List Redeemed} {T : Nat} {t s : Address} {a m salt out : U256}
    (hinv : LimitInv w P T) (hT : T ≤ env.timestamp.toNat) (h : redeem env w t s a m salt = .ok (w', out)) :
    let e : Redeemed := { pair := (t, s), user := env.sender, day := env.timestamp.toNat / 86400,
                          out := out.toNat, limit := (w.ir.dailyLimit (t, s) env.sender).toNat }
    LimitInv w' (P ++ [e]) env.timestamp.toNat ∧ total (P ++ [e]) e.pair e.user e.day ≤ e.limit := by
  intro e
  obtain ⟨-, hday, hamount, hle⟩ := redeem_usage h
  obtain ⟨-, -, hother⟩ := redeem_storage_ok h
  have hTd : T / 86400 ≤ env.timestamp.toNat / 86400 := Nat.div_le_div_right hT
  -- what was logged today before this call is exactly what the contract counts as used
  have hK : total P (t, s) env.sender (env.timestamp.toNat / 86400) = usedToday w.ir env.timestamp (t, s) env.sender := by
    unfold usedToday
    split
    · rename_i hd; rw [← hd]; exact hinv.amount _ _
    · rename_i hd
      apply total_eq_zero
      intro r hr hp hu
      have h1 := hinv.past r hr
      have h2 := hinv.now (t, s) env.sender
      rw [hp, hu] at h1
      omega
  have he : total [e] (t, s) env.sender (env.timestamp.toNat / 86400) = out.toNat := by
    rw [total_single]; simp [e]
  refine ⟨⟨?_, ?_, ?_⟩, ?_⟩
  · intro p u
    by_cases hpu : (p, u) = ((t, s), env.sender)
    · obtain ⟨rfl, rfl⟩ := Prod.mk.inj hpu
      rw [hday, total_append, hK, he, hamount]
    · have h0 : total [e] p u (w'.ir.usage p u).day.toNat = 0 := by
        rw [total_single]; split
        · rename_i hc; exact absurd (by rw [← hc.1, ← hc.2.1]) hpu
        · rfl
      rw [total_append, h0, hother p u hpu, hinv.amount p u, Nat.add_zero]
  · intro r hr
    rw [List.mem_append, List.mem_singleton] at hr
    rcases hr with hr | rfl
    · by_cases hpu : (r.pair, r.user) = ((t, s), env.sender)
      · obtain ⟨hp, hu⟩ := Prod.mk.inj hpu
        have h1 := hinv.past r hr
        have h2 := hinv.now (t, s) env.sender
        rw [hp, hu] at h1 ⊢; rw [hday]
        omega
      · rw [hother _ _ hpu]; exact hinv.past r hr
    · show env.timestamp.toNat / 86400 ≤ (w'.ir.usage (t, s) env.sender).day.toNat
      rw [hday]; exact Nat.le_refl _
  · intro p u
    by_cases hpu : (p, u) = ((t, s), env.sender)
    · obtain ⟨rfl, rfl⟩ := Prod.mk.inj hpu; rw [hday]; exact Nat.le_refl _
    · rw [hother p u hpu]; exact Nat.le_trans (hinv.now p u) hTd
  · show total (P ++ [e]) (t, s) env.sender (env.timestamp.toNat / 86400) ≤ _
    rw [total_append, hK, he]; exact hle

theorem daily_limit_aux (trace : List Step) : ∀ (w : World) (P : List Redeemed) (T : Nat),
    LimitInv w P T → (∀ t ∈ trace.filterMap Step.timestamp?, T ≤ t) →
    (trace.filterMap Step.timestamp?).Pairwise (· ≤ ·) →
    ∀ (i : Nat) (hi : i < (exec w trace).2.length),
      total (P ++ (exec w trace).2.take (i + 1)) (exec w trace).2[i].pair (exec w trace).2[i].user
        (exec w trace).2[i].day ≤ (exec w trace).2[i].limit := by
  induction trace with
  | nil => intro w P T _ _ _ i hi; simp [exec] at hi
  | cons step rest ih =>
    intro w P T hinv hT hsorted i hi
    cases step with
    | external e =>
      simp only [List.filterMap_cons, Step.timestamp?] at hT hsorted
      exact ih (e.apply w) P T (inv_of_usage (by rw [e.keepsIr]) hinv) hT hsorted i hi
    | call env c =>
      simp only [List.filterMap_cons, Step.timestamp?, List.pairwise_cons, List.mem_cons] at hT hsorted
      have hT₀ : T ≤ env.timestamp.toNat := hT _ (Or.inl rfl)
      have hrest := hsorted.1
      cases hrun : c.run env w with
      | error _ =>
        simp only [exec, hrun] at hi ⊢
        exact ih w P env.timestamp.toNat (inv_mono hinv hT₀) hrest hsorted.2 i hi
      | ok res =>
        obtain ⟨w₁, r⟩ := res
        simp only [exec, hrun] at hi ⊢
        rcases run_cases hrun with ⟨t, s, a, m, salt, out, rfl, hred, rfl⟩ | ⟨rfl, husage, -⟩
        · obtain ⟨hinv', hfirst⟩ := inv_redeem hinv hT₀ hred
          cases i with
          | zero => simpa using hfirst
          | succ j =>
            have := ih w₁ _ env.timestamp.toNat hinv' hrest hsorted.2 j (by simpa using hi)
            simpa [List.take_succ_cons, List.append_assoc] using this
        · simp only [Option.toList_none, List.nil_append] at hi ⊢
          exact ih w₁ P env.timestamp.toNat (inv_mono (inv_of_usage husage hinv) hT₀) hrest hsorted.2 i hi

end Spiko.InstantRedemption
