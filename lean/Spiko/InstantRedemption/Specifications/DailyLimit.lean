import Spiko.InstantRedemption.DailyLimit

namespace Spiko.InstantRedemption
open Spiko.EVM

variable {env env₁ env₂ : Env} {s : State} {w w' : World} {pair : Pair} {round round₁ round₂ : OracleRound}
  {token stablecoin : Address} {amount a₁ a₂ minOut salt out o₁ o₂ : U256}

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

end Spiko.InstantRedemption
