import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

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

end Spiko.InstantRedemption
