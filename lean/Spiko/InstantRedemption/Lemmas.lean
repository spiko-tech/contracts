import Spiko.InstantRedemption.Trace
import Spiko.Lemmas

-- Spec lemmas for the model's functions: when each one succeeds, and with what result.

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env : Env} {w w' : World} {token stablecoin src dst : Address} {amount minOut salt out : U256}

theorem liftM_ok {α : Type} {x : Except Revert α} {a : α} :
    (liftM x : Except Error α) = .ok a ↔ x = .ok a := by
  cases x <;> simp [liftM, monadLift, MonadLift.monadLift, Except.mapError]

theorem erc20Transfer_ok : erc20Transfer env w token src dst amount = .ok w' ↔
    dst ≠ 0 ∧ env.canTransfer token src dst = true ∧ amount ≤ w.balances token src ∧
    w' = { w with balances := transferBalances w.balances token src dst amount } := by
  simp only [erc20Transfer, ite_throw_ok, ite_throw_ok', pure_ok]
  constructor
  · rintro ⟨h0, hc, hb, rfl⟩; exact ⟨h0, hc, hb, rfl⟩
  · rintro ⟨h0, hc, hb, rfl⟩; exact ⟨h0, hc, hb, rfl⟩

theorem erc20TransferFrom_keeps (h : erc20TransferFrom env w token src dst amount = .ok w') :
    w'.ir = w.ir ∧ w'.redemptionUsed = w.redemptionUsed := by
  simp only [erc20TransferFrom] at h
  split at h
  · simp only [pure_bind, erc20Transfer_ok] at h
    obtain ⟨-, -, -, rfl⟩ := h; exact ⟨rfl, rfl⟩
  · simp only [pure_bind, ite_throw_ok, erc20Transfer_ok] at h
    obtain ⟨-, -, -, -, rfl⟩ := h; exact ⟨rfl, rfl⟩

theorem redemptionOnTransferReceived_ok {input user output : Address} {value : U256} :
    redemptionOnTransferReceived env w input user value output salt = .ok w' ↔
    env.redemptionOutputs input output = true ∧ env.redemptionMinimum input ≤ value ∧
    w.redemptionUsed (user, input, output, value, salt) = false ∧
    env.timestamp.toNat + 14 * 86400 < 2 ^ 48 ∧
    w' = { w with redemptionUsed := upd w.redemptionUsed (user, input, output, value, salt) true } := by
  simp only [redemptionOnTransferReceived, ite_throw_ok, ite_throw_ok', pure_ok, Bool.not_eq_true]
  constructor
  · rintro ⟨h1, h2, h3, h4, rfl⟩; exact ⟨h1, h2, h3, h4, rfl⟩
  · rintro ⟨h1, h2, h3, h4, rfl⟩; exact ⟨h1, h2, h3, h4, rfl⟩

-- A successful redeem, flattened: every check passed and every intermediate world, in order.
theorem redeem_ok (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    env.canCall env.sender env.self .redeem = true ∧
    previewRedeem env w.ir token stablecoin amount = .ok out ∧
    (if minOut = 0 then 1 else minOut) ≤ out ∧
    out ≤ remainingDailyLimit env w.ir token stablecoin env.sender ∧
    ∃ today added newAmount w₁ w₂ w₃,
      toUint 48 (env.timestamp / 86400) = .ok today ∧
      toUint 208 out = .ok added ∧
      checkedAdd (if (w.ir.usage (token, stablecoin) env.sender).day = today
        then (w.ir.usage (token, stablecoin) env.sender).amount else 0) added = .ok newAmount ∧
      erc20TransferFrom env
        { w with ir := { w.ir with usage := upd2 w.ir.usage (token, stablecoin) env.sender ⟨today, newAmount⟩ } }
        token env.sender env.self amount = .ok w₁ ∧
      erc20Transfer env w₁ stablecoin env.self env.sender out = .ok w₂ ∧
      erc20Transfer env w₂ token env.self env.redemption amount = .ok w₃ ∧
      redemptionOnTransferReceived env w₃ token env.self amount stablecoin salt = .ok w' := by
  simp only [redeem, restricted, bind_ok, liftM_ok, ite_pure_throw_ok, ite_throw_ok, pure_ok] at h
  obtain ⟨_, hauth, o, hpreview, hmin, hlimit, today, htoday, added, hadded, newAmount, hnew, w₁, h₁, w₂, h₂, w₃, h₃,
    w₄, h₄, heq⟩ := h
  cases heq
  refine ⟨hauth, hpreview, hmin, hlimit, today, added, newAmount, w₁, w₂, w₃, htoday, hadded, ?_, ?_, h₂, h₃, h₄⟩
  all_goals by_cases hd : (w.ir.usage (token, stablecoin) env.sender).day = today <;> simp_all

theorem redeem_min (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    minOut ≤ out ∧ 0 < out := by
  obtain ⟨-, -, hmin, -⟩ := redeem_ok h
  simp only [BitVec.le_def, BitVec.lt_def] at hmin ⊢
  split at hmin <;> rename_i hm
  · subst hm; simp at hmin ⊢; omega
  · have : minOut.toNat ≠ 0 := fun h0 => hm (BitVec.eq_of_toNat_eq (by simpa using h0))
    have : (0 : U256).toNat = 0 := rfl
    omega

-- What the contract counts as already redeemed today, in Nat.
def usedToday (s : State) (timestamp : U256) (p : PairId) (u : Address) : Nat :=
  if (s.usage p u).day.toNat = timestamp.toNat / 86400 then (s.usage p u).amount.toNat else 0

theorem remainingDailyLimit_toNat {env : Env} {s : State} {t c u : Address} :
    (remainingDailyLimit env s t c u).toNat = (s.dailyLimit (t, c) u).toNat - usedToday s env.timestamp (t, c) u := by
  unfold remainingDailyLimit usedToday
  rw [saturatingSub_toNat]
  congr 1
  have h86 : (86400 : U256).toNat = 86400 := rfl
  have hday : ((s.usage (t, c) u).day.setWidth 256 = env.timestamp / 86400) ↔
      (s.usage (t, c) u).day.toNat = env.timestamp.toNat / 86400 := by
    rw [← BitVec.toNat_inj, toNat_setWidth_48, BitVec.toNat_udiv, h86]
  split <;> split <;> rename_i h1 h2
  · simp only [BitVec.toNat_setWidth]; exact Nat.mod_eq_of_lt (by have := (s.usage (t, c) u).amount.isLt; omega)
  · exact absurd (hday.mp h1) h2
  · exact absurd (hday.mpr h2) h1
  · rfl

-- The effect of a redeem on this contract's storage, in Nat: one usage slot is written, with today's day and
-- (redeemed today before + out), which stays within the limit.
theorem redeem_usage (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    let u := w'.ir.usage (token, stablecoin) env.sender
    w'.ir = { w.ir with usage := upd2 w.ir.usage (token, stablecoin) env.sender u } ∧
      u.day.toNat = env.timestamp.toNat / 86400 ∧
      u.amount.toNat = usedToday w.ir env.timestamp (token, stablecoin) env.sender + out.toNat ∧
      usedToday w.ir env.timestamp (token, stablecoin) env.sender + out.toNat ≤
        (w.ir.dailyLimit (token, stablecoin) env.sender).toNat := by
  have hpos := (redeem_min h).2
  obtain ⟨-, -, -, hlimit, today, added, newAmount, w₁, w₂, w₃, htoday, hadded, hnew, h₁, h₂, h₃, h₄⟩ := redeem_ok h
  have k₁ := (erc20TransferFrom_keeps h₁).1
  obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h₂
  obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h₃
  obtain ⟨-, -, -, -, rfl⟩ := redemptionOnTransferReceived_ok.mp h₄
  rw [toUint_ok] at htoday hadded
  obtain ⟨hts, rfl⟩ := htoday
  obtain ⟨hout, rfl⟩ := hadded
  rw [checkedAdd_ok] at hnew
  obtain ⟨hsum, rfl⟩ := hnew
  have h86 : (86400 : U256).toNat = 86400 := rfl
  have htodayNat : ((env.timestamp / 86400).setWidth 48).toNat = env.timestamp.toNat / 86400 := by
    rw [BitVec.toNat_setWidth, BitVec.toNat_udiv, h86] at *; exact Nat.mod_eq_of_lt hts
  have haddedNat : (out.setWidth 208).toNat = out.toNat := by
    rw [BitVec.toNat_setWidth]; exact Nat.mod_eq_of_lt hout
  -- the `if` in the contract and `usedToday` agree
  have hused : (if (w.ir.usage (token, stablecoin) env.sender).day = (env.timestamp / 86400).setWidth 48
      then (w.ir.usage (token, stablecoin) env.sender).amount else 0).toNat =
      usedToday w.ir env.timestamp (token, stablecoin) env.sender := by
    unfold usedToday
    split <;> split <;> rename_i h1 h2
    · rfl
    · exact absurd (by rw [h1, htodayNat]) h2
    · exact absurd (BitVec.eq_of_toNat_eq (by rw [htodayNat, h2])) h1
    · rfl
  rw [hused, haddedNat] at hsum
  have hrem := remainingDailyLimit_toNat (env := env) (s := w.ir) (t := token) (c := stablecoin) (u := env.sender)
  rw [BitVec.le_def, hrem] at hlimit
  rw [BitVec.lt_def] at hpos
  have : (0 : U256).toNat = 0 := rfl
  simp only [k₁, upd2, upd, ↓reduceIte]
  refine ⟨trivial, htodayNat, ?_, by omega⟩
  rw [BitVec.toNat_add, hused, haddedNat, Nat.mod_eq_of_lt hsum]

theorem redeem_keeps_used {t s : Address} {a m salt out : U256} {id : RedemptionId}
    (h : redeem env w t s a m salt = .ok (w', out)) (hu : w.redemptionUsed id = true) :
    w'.redemptionUsed id = true := by
  obtain ⟨-, -, -, -, _, _, _, w₁, w₂, w₃, -, -, -, h₁, h₂, h₃, h₄⟩ := redeem_ok h
  have k₁ := (erc20TransferFrom_keeps h₁).2
  obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h₂
  obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h₃
  obtain ⟨-, -, -, -, rfl⟩ := redemptionOnTransferReceived_ok.mp h₄
  simp only [upd]; split
  · rfl
  · simp only [k₁]; exact hu

-- Each call is either a redeem (logged) or an admin operation that leaves usage and used ids alone.
theorem run_cases {c : Call} {r : Option Redeemed} (hc : c.run env w = .ok (w', r)) :
    (∃ t s a m salt out, c = .redeem t s a m salt ∧ redeem env w t s a m salt = .ok (w', out) ∧
      r = some { pair := (t, s), user := env.sender, day := env.timestamp.toNat / 86400, out := out.toNat,
                 limit := (w.ir.dailyLimit (t, s) env.sender).toNat }) ∨
    (r = none ∧ w'.ir.usage = w.ir.usage ∧ w'.redemptionUsed = w.redemptionUsed) := by
  cases c with
  | redeem t s a m salt =>
    left
    simp only [Call.run, bind_ok, pure_ok, Prod.mk.injEq] at hc
    obtain ⟨⟨w₁, out⟩, h, rfl, rfl⟩ := hc
    exact ⟨t, s, a, m, salt, out, rfl, h, rfl⟩
  | setPair t s o ttl =>
    right
    simp only [Call.run, bind_ok, pure_ok, Prod.mk.injEq] at hc
    obtain ⟨w₁, h, rfl, rfl⟩ := hc
    simp only [setPair, restricted, bind_ok, ite_pure_throw_ok, liftM_ok, ite_throw_ok, pure_ok] at h
    obtain ⟨_, -, _, -, -, _, -, _, -, _, -, _, -, _, -, _, -, rfl⟩ := h
    exact ⟨rfl, rfl, rfl⟩
  | removePair t s =>
    right
    simp only [Call.run, bind_ok, pure_ok, Prod.mk.injEq] at hc
    obtain ⟨w₁, h, rfl, rfl⟩ := hc
    simp only [removePair, restricted, bind_ok, ite_pure_throw_ok, pure_ok] at h
    obtain ⟨_, -, rfl⟩ := h
    exact ⟨rfl, rfl, rfl⟩
  | setDailyLimit t s u l =>
    right
    simp only [Call.run, bind_ok, pure_ok, Prod.mk.injEq] at hc
    obtain ⟨w₁, h, rfl, rfl⟩ := hc
    simp only [setDailyLimit, restricted, bind_ok, ite_pure_throw_ok, pure_ok] at h
    obtain ⟨_, -, rfl⟩ := h
    exact ⟨rfl, rfl, rfl⟩
  | withdraw t to a =>
    right
    simp only [Call.run, bind_ok, pure_ok, Prod.mk.injEq] at hc
    obtain ⟨w₁, h, rfl, rfl⟩ := hc
    simp only [withdraw, restricted, bind_ok, ite_pure_throw_ok] at h
    obtain ⟨_, -, h⟩ := h
    obtain ⟨-, -, -, rfl⟩ := erc20Transfer_ok.mp h
    exact ⟨rfl, rfl, rfl⟩

-- A redeem only writes the caller's usage slot.
theorem redeem_storage_ok (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    w'.ir.pairs = w.ir.pairs ∧ w'.ir.dailyLimit = w.ir.dailyLimit ∧
      ∀ p u, (p, u) ≠ ((token, stablecoin), env.sender) → w'.ir.usage p u = w.ir.usage p u := by
  obtain ⟨hir, -⟩ := redeem_usage h
  refine ⟨by rw [hir], by rw [hir], fun p u hne => ?_⟩
  rw [hir]; clear hir
  simp only [upd2, upd]
  split
  · subst_vars; simp only [upd]; split
    · subst_vars; exact absurd rfl hne
    · rfl
  · rfl

end Spiko.InstantRedemption
