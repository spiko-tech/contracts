import Spiko.InstantRedemption.Trace
import Spiko.InstantRedemption.DailyLimit

-- The specification of InstantRedemption, with proofs.

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

/-! ## P1: pricing -/

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

/-- Rounding is down, by less than one unit. -/
theorem previewRedeem_floor (hp : s.pairs (token, stablecoin) = pair)
    (hr : env.latestRoundData pair.oracle = .ok round)
    (h : previewRedeem env s token stablecoin amount = .ok out) :
    out.toNat * pair.denominator.toNat ≤ amount.toNat * (pair.numerator.toNat * round.answer.toNat) ∧
      amount.toNat * (pair.numerator.toNat * round.answer.toNat) < (out.toNat + 1) * pair.denominator.toNat := by
  obtain ⟨round', hr', -, -, -, hden, hout⟩ := previewRedeem_ok hp h
  -- the oracle answered once: both rounds are the same
  obtain rfl : round' = round := Except.ok.inj (hr'.symm.trans hr)
  rw [hout]
  -- name the pieces so omega sees them as opaque numbers
  generalize amount.toNat * (pair.numerator.toNat * round'.answer.toNat) = A
  generalize pair.denominator.toNat = d at hden ⊢
  have := Nat.div_add_mod A d
  have := Nat.mod_lt A (Nat.pos_of_ne_zero hden)
  constructor
  · exact Nat.div_mul_le_self A d
  · rw [Nat.add_mul, Nat.one_mul, Nat.mul_comm (A / d) d]; omega

/-- More tokens never pay less. -/
theorem previewRedeem_mono_amount (h₁ : previewRedeem env s token stablecoin a₁ = .ok o₁)
    (h₂ : previewRedeem env s token stablecoin a₂ = .ok o₂) (ha : a₁ ≤ a₂) : o₁ ≤ o₂ := by
  obtain ⟨r₁, hr₁, -, -, -, -, ho₁⟩ := previewRedeem_ok rfl h₁
  obtain ⟨r₂, hr₂, -, -, -, -, ho₂⟩ := previewRedeem_ok rfl h₂
  obtain rfl : r₁ = r₂ := Except.ok.inj (hr₁.symm.trans hr₂)
  rw [BitVec.le_def] at ha ⊢
  rw [ho₁, ho₂]
  exact Nat.div_le_div_right (Nat.mul_le_mul_right _ ha)

/-- A higher price never pays less. -/
theorem previewRedeem_mono_price (hp : s.pairs (token, stablecoin) = pair)
    (hr₁ : env₁.latestRoundData pair.oracle = .ok round₁) (hr₂ : env₂.latestRoundData pair.oracle = .ok round₂)
    (hprice : round₁.answer.toNat ≤ round₂.answer.toNat)
    (h₁ : previewRedeem env₁ s token stablecoin amount = .ok o₁)
    (h₂ : previewRedeem env₂ s token stablecoin amount = .ok o₂) : o₁ ≤ o₂ := by
  obtain ⟨r₁, hr₁', -, -, -, -, ho₁⟩ := previewRedeem_ok hp h₁
  obtain ⟨r₂, hr₂', -, -, -, -, ho₂⟩ := previewRedeem_ok hp h₂
  obtain rfl : r₁ = round₁ := Except.ok.inj (hr₁'.symm.trans hr₁)
  obtain rfl : r₂ = round₂ := Except.ok.inj (hr₂'.symm.trans hr₂)
  rw [BitVec.le_def, ho₁, ho₂]
  exact Nat.div_le_div_right (Nat.mul_le_mul_left _ (Nat.mul_le_mul_left _ hprice))

/-! ## P2: daily limit -/

/-- A redeem pays at least `max(minOutputAmount, 1)`. -/
theorem redeem_output_min (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    minOut ≤ out ∧ 0 < out :=
  redeem_min h

/-- After a redeem, today's usage is within the limit in force during the call. -/
theorem redeem_within_limit (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    let u := w'.ir.usage (token, stablecoin) env.sender
    u.day.toNat = env.timestamp.toNat / 86400 ∧
      u.amount.toNat ≤ (w.ir.dailyLimit (token, stablecoin) env.sender).toNat := by
  obtain ⟨-, hday, hamount, hle⟩ := redeem_usage h
  exact ⟨hday, by omega⟩

/-- Over any sequence of calls from deployment, with time never going backwards: for every successful redeem, the
total paid to that user, on that pair, that day, up to and including it, is within the limit in force at that call. -/
theorem daily_limit (w₀ : World) (h₀ : w₀.ir = State.init) (trace : List Step)
    (htime : (trace.filterMap Step.timestamp?).Pairwise (· ≤ ·)) :
    let log := (exec w₀ trace).2
    ∀ (i : Nat) (hi : i < log.length),
      let e := log[i]
      (((log.take (i + 1)).filter fun r => decide (r.pair = e.pair ∧ r.user = e.user ∧ r.day = e.day)).map
        (·.out)).sum ≤ e.limit := by
  intro log i hi e
  have := daily_limit_aux trace w₀ [] 0 (inv_init h₀) (fun _ _ => Nat.zero_le _) htime i hi
  simp only [List.nil_append, total] at this
  exact this

/-! ## P3: conservation -/

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

/-- A redeem only changes the caller's usage on that pair. -/
theorem redeem_storage (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    w'.ir.pairs = w.ir.pairs ∧ w'.ir.dailyLimit = w.ir.dailyLimit ∧
      ∀ p u, (p, u) ≠ ((token, stablecoin), env.sender) → w'.ir.usage p u = w.ir.usage p u :=
  redeem_storage_ok h

/-! ## Liveness -/

/-- A redeem that meets every condition goes through and pays the exact price. Rules out a model (or a contract) that
reverts too often, which all the safety theorems above would accept. The conditions are sufficient, not necessary:
`token ≠ stablecoin` and `sender ≠ self` are assumed for readability. -/
theorem redeem_succeeds
    (hts : token ≠ stablecoin) (hus : env.sender ≠ env.self) (hs0 : env.sender ≠ 0) (hself0 : env.self ≠ 0) (hr0 : env.redemption ≠ 0)
    -- permission
    (hauth : env.canCall env.sender env.self .redeem = true)
    -- pricing
    (hp : w.ir.pairs (token, stablecoin) = pair) (horacle : pair.oracle ≠ 0)
    (hr : env.latestRoundData pair.oracle = .ok round)
    (hdeadline : round.updatedAt.toNat + pair.oracleTTL.toNat < 2 ^ 256)
    (hfresh : env.timestamp.toNat < round.updatedAt.toNat + pair.oracleTTL.toNat)
    (hprice : 0 ≤ round.answer.toInt)
    (hnum : pair.numerator.toNat * round.answer.toNat < 2 ^ 256) (hden : pair.denominator.toNat ≠ 0)
    (hout : out.toNat = amount.toNat * (pair.numerator.toNat * round.answer.toNat) / pair.denominator.toNat)
    (hmin : minOut ≤ out) (hpos : 0 < out)
    -- daily limit
    (hlimit : out ≤ remainingDailyLimit env w.ir token stablecoin env.sender)
    (hlimit208 : (w.ir.dailyLimit (token, stablecoin) env.sender).toNat < 2 ^ 208)
    -- tokens
    (hallow : w.allowances token env.sender env.self = maxU256 ∨ amount ≤ w.allowances token env.sender env.self)
    (hbal : amount ≤ w.balances token env.sender) (hbuffer : out ≤ w.balances stablecoin env.self)
    (hwrap : (w.balances token env.self).toNat + amount.toNat < 2 ^ 256)
    (htr₁ : env.canTransfer token env.sender env.self = true)
    (htr₂ : env.canTransfer stablecoin env.self env.sender = true)
    (htr₃ : env.canTransfer token env.self env.redemption = true)
    -- Redemption
    (houtput : env.redemptionOutputs token stablecoin = true) (hminimum : env.redemptionMinimum token ≤ amount)
    (hunused : w.redemptionUsed (env.self, token, stablecoin, amount, salt) = false)
    (hrdeadline : env.timestamp.toNat + 14 * 86400 < 2 ^ 48) :
    ∃ w', redeem env w token stablecoin amount minOut salt = .ok (w', out) := by
  have h86 : (86400 : U256).toNat = 86400 := rfl
  have hday : (env.timestamp / 86400).toNat < 2 ^ 48 := by rw [BitVec.toNat_udiv, h86]; omega
  -- the values the contract computes
  let today : U48 := (env.timestamp / 86400).setWidth 48
  let U := w.ir.usage (token, stablecoin) env.sender
  let usage' : Usage := if U.day = today then U else { day := today, amount := 0 }
  have htodayNat : today.toNat = env.timestamp.toNat / 86400 := by
    show ((env.timestamp / 86400).setWidth 48).toNat = _
    rw [BitVec.toNat_setWidth, Nat.mod_eq_of_lt hday, BitVec.toNat_udiv, h86]
  have hused : usage'.amount.toNat = usedToday w.ir env.timestamp (token, stablecoin) env.sender := by
    show (if U.day = today then U else { day := today, amount := 0 }).amount.toNat = _
    unfold usedToday
    split <;> split <;> rename_i h1 h2
    · rfl
    · exact absurd (by rw [h1, htodayNat]) h2
    · exact absurd (BitVec.eq_of_toNat_eq (by rw [htodayNat, h2])) h1
    · rfl
  -- the daily limit leaves room: used + out ≤ limit < 2^208
  rw [BitVec.le_def, remainingDailyLimit_toNat] at hlimit
  rw [BitVec.lt_def] at hpos
  have h0 : (0 : U256).toNat = 0 := rfl
  have hout208 : out.toNat < 2 ^ 208 := by omega
  have hadd208 : (out.setWidth 208).toNat = out.toNat := by rw [BitVec.toNat_setWidth, Nat.mod_eq_of_lt hout208]
  have hsum : usage'.amount.toNat + (out.setWidth 208).toNat < 2 ^ 208 := by rw [hused, hadd208]; omega
  let newU : Usage := { usage' with amount := usage'.amount + out.setWidth 208 }
  let w₀ : World := { w with ir := { w.ir with usage := upd2 w.ir.usage (token, stablecoin) env.sender newU } }
  -- the four external effects
  obtain ⟨w₁, h₁, hb₁, hu₁⟩ := erc20TransferFrom_succeeds (w := w₀) hallow hself0 htr₁ hbal
  have hbuf₁ : out ≤ w₁.balances stablecoin env.self := by
    rw [hb₁, transferBalances_apply]; simp [hts.symm]; exact hbuffer
  have h₂ := erc20Transfer_ok.mpr ⟨hs0, htr₂, hbuf₁, rfl⟩
  have hbal₂ : amount ≤ transferBalances w₁.balances stablecoin env.self env.sender out token env.self := by
    have hw₀ : w₀.balances = w.balances := rfl
    rw [transferBalances_apply, hb₁, transferBalances_apply, hw₀]
    simp [hts, hus.symm]
    rw [BitVec.le_def, BitVec.toNat_add, Nat.mod_eq_of_lt hwrap]; omega
  let w₂ : World := { w₁ with balances := transferBalances w₁.balances stablecoin env.self env.sender out }
  let w₃ : World := { w₂ with balances := transferBalances w₂.balances token env.self env.redemption amount }
  have h₃ := (erc20Transfer_ok (w := w₂) (w' := w₃)).mpr ⟨hr0, htr₃, hbal₂, rfl⟩
  have hunused₃ : w₁.redemptionUsed (env.self, token, stablecoin, amount, salt) = false := by rw [hu₁]; exact hunused
  have h₄ := (redemptionOnTransferReceived_ok (w := w₃) (w' := _)).mpr ⟨houtput, hminimum, hunused₃, hrdeadline, rfl⟩
  -- assemble the run
  refine ⟨{ w₃ with redemptionUsed := upd w₃.redemptionUsed (env.self, token, stablecoin, amount, salt) true }, ?_⟩
  simp only [redeem, restricted, bind_ok, liftM_ok, ite_pure_throw_ok, ite_throw_ok, pure_ok]
  refine ⟨(), hauth, out, previewRedeem_succeeds hp horacle hr hdeadline hfresh hprice hnum hden hout, ?_, ?_,
    today, toUint_ok.mpr ⟨hday, rfl⟩, _, toUint_ok.mpr ⟨hout208, rfl⟩, _, checkedAdd_ok.mpr ⟨hsum, rfl⟩,
    w₁, h₁, _, h₂, _, h₃, _, h₄, rfl⟩
  · rw [BitVec.le_def] at hmin ⊢
    split
    · have : (1 : U256).toNat = 1 := rfl
      omega
    · exact hmin
  · rw [BitVec.le_def, remainingDailyLimit_toNat]; exact hlimit

/-! ## P4: access control -/

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

/-! ## P5: salt -/

/-- A redeem registers its request with this contract as the owner. -/
theorem redeem_marks_used (h : redeem env w token stablecoin amount minOut salt = .ok (w', out)) :
    w'.redemptionUsed (env.self, token, stablecoin, amount, salt) = true := by
  obtain ⟨-, -, -, -, _, _, _, _, _, _, -, -, -, -, -, -, h₄⟩ := redeem_ok h
  obtain ⟨-, -, -, -, rfl⟩ := redemptionOnTransferReceived_ok.mp h₄
  simp [upd]

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

/-- Used ids stay used over any sequence of calls and external actions. -/
theorem exec_keeps_used (trace : List Step) (id : RedemptionId) (hu : w.redemptionUsed id = true) :
    (exec w trace).1.redemptionUsed id = true := by
  induction trace generalizing w with
  | nil => exact hu
  | cons step rest ih =>
    cases step with
    | external e => exact ih (e.keepsUsed w id hu)
    | call env c =>
      simp only [exec]
      split
      · rename_i w₁ r hc
        apply ih
        rcases run_cases hc with ⟨_, _, _, _, _, _, rfl, hr, -⟩ | ⟨-, -, hused⟩
        · exact redeem_keeps_used hr hu
        · rw [hused]; exact hu
      · exact ih hu

end Spiko.InstantRedemption
