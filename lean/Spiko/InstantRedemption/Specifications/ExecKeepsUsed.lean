import Spiko.InstantRedemption.Lemmas

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

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
