import Spiko.InstantRedemption.Model

-- Replays a call sequence on the model, for test/instantRedemption.difftest.js.
-- Input: one command per line, numbers in decimal, addresses as small indices (see below).
-- Output: one line per command, `<result> | <snapshot>`, in the format the JS side builds from the chain.

open Spiko.EVM Spiko.InstantRedemption

namespace DiffTest

def addr (n : Nat) : Address := BitVec.ofNat 160 n
def u (n : Nat) : U256 := BitVec.ofNat 256 n

-- Index 0 is the zero address.
def ir := addr 1
def redemption := addr 2
def token := addr 3
def stable := addr 4
def oracle := addr 5
def admin := addr 6
def redeemer := addr 7
def alice := addr 8
def other := addr 9
def holders := [ir, redemption, admin, redeemer, alice, other]

structure Config where
  tokenDecimals : Nat
  stableDecimals : Nat
  oracleDecimals : Nat
  minimum : Nat

-- The roles and whitelist of test/fixtures.js.
def env (cfg : Config) (sender : Address) (ts : Nat) (round : OracleRound) : Env where
  self := ir
  redemption := redemption
  sender := sender
  timestamp := u ts
  canCall := fun caller _ sel => caller == admin || (caller == redeemer && sel == .redeem)
  latestRoundData := fun o => if o = oracle then .ok round else .error (.external o)
  oracleToken := fun o => if o = oracle then .ok token else .error (.external o)
  decimals := fun a =>
    if a = token then .ok (BitVec.ofNat 8 cfg.tokenDecimals)
    else if a = stable then .ok (BitVec.ofNat 8 cfg.stableDecimals)
    else if a = oracle then .ok (BitVec.ofNat 8 cfg.oracleDecimals)
    else .error (.external a)
  canTransfer := fun t src dst =>
    let whitelisted (a : Address) := a == ir || a == redemption || a == redeemer || a == alice
    t != token || (whitelisted src && whitelisted dst)
  redemptionOutputs := fun i o => i == token && o == stable
  redemptionMinimum := fun i => if i = token then u cfg.minimum else 0

def selectorName : Selector → String
  | .redeem => "redeem"
  | .setPair => "setPair"
  | .removePair => "removePair"
  | .setDailyLimit => "setDailyLimit"
  | .withdraw => "withdraw"

def render : Error → String
  | .evm .panicOverflow => "Panic(17)"
  | .evm .panicDivByZero => "Panic(18)"
  | .evm (.safeCastOverflowedUintDowncast bits v) => s!"SafeCastOverflowedUintDowncast({bits},{v.toNat})"
  | .evm (.safeCastOverflowedIntToUint v) => s!"SafeCastOverflowedIntToUint({v.toInt})"
  | .external _ => "external"
  | .restrictedAccess c t s => s!"RestrictedAccess({c.toNat},{t.toNat},{selectorName s})"
  | .unknownPair t c => s!"UnknownPair({t.toNat},{c.toNat})"
  | .oracleTokenMismatch o t => s!"OracleTokenMismatch({o.toNat},{t.toNat})"
  | .oracleValueTooOld o => s!"OracleValueTooOld({o.toNat})"
  | .outputAmountTooLow a m => s!"OutputAmountTooLow({a.toNat},{m.toNat})"
  | .dailyLimitExceeded usr r m => s!"DailyLimitExceeded({usr.toNat},{r.toNat},{m.toNat})"

-- Balances of both tokens, the redeemer's daily limit, the pair (token, stable) and the redeemer's allowance.
def snapshot (w : World) : String :=
  let bals := [token, stable].flatMap fun t => holders.map fun h => (w.balances t h).toNat
  let p := w.ir.pairs (token, stable)
  " ".intercalate ((bals ++ [(w.ir.dailyLimit (token, stable) redeemer).toNat, p.oracle.toNat, p.oracleTTL.toNat,
    p.numerator.toNat, p.denominator.toNat, (w.allowances token redeemer ir).toNat]).map toString)

-- Rebuild every map as one array lookup over the addresses in play (indices < 10). The compiled model turns
-- storage writes into closures that recompute lower layers on each lookup, so cost would grow exponentially
-- with the number of steps. The arrays are built here, in a function returning a structure: the compiler gives a
-- function returning a function extra parameters, and its `let`s would then run again on every lookup.
def small (a : Address) : Option Nat := if a.toNat < 10 then some a.toNat else none

def materialize (w : World) : World :=
  let bal := (Array.range 100).map fun i => w.balances (addr (i / 10)) (addr (i % 10))
  let alw := (Array.range 1000).map fun i => w.allowances (addr (i / 100)) (addr (i / 10 % 10)) (addr (i % 10))
  let pairs := (Array.range 100).map fun i => w.ir.pairs (addr (i / 10), addr (i % 10))
  let lim := (Array.range 1000).map fun i => w.ir.dailyLimit (addr (i / 100), addr (i / 10 % 10)) (addr (i % 10))
  let use := (Array.range 1000).map fun i => w.ir.usage (addr (i / 100), addr (i / 10 % 10)) (addr (i % 10))
  let idx2 (a b : Address) := do pure ((← small a) * 10 + (← small b))
  let idx3 (a b c : Address) := do pure ((← small a) * 100 + (← small b) * 10 + (← small c))
  { w with
    balances := fun t h => (idx2 t h).elim 0 (bal[·]!)
    allowances := fun t o s => (idx3 t o s).elim 0 (alw[·]!)
    ir := { pairs := fun (t, c) => (idx2 t c).elim default (pairs[·]!)
            dailyLimit := fun (t, c) u => (idx3 t c u).elim 0 (lim[·]!)
            usage := fun (t, c) u => (idx3 t c u).elim default (use[·]!) } }

def result {α : Type} (w : World) (r : Except Error α) (f : α → World × String) : World × String :=
  match r with
  | .ok a => f a
  | .error e => (w, render e)

def step (cfg : Config) (w : World) : String → List Nat → Option (World × String)
  | "mint", [t, h, v] =>
    some ({ w with balances := upd2 w.balances (addr t) (addr h) (w.balances (addr t) (addr h) + u v) }, "ok")
  | "approve", [t, o, s, v] =>
    some ({ w with allowances := upd w.allowances (addr t) (upd2 (w.allowances (addr t)) (addr o) (addr s) (u v)) }, "ok")
  | "redeem", [s, ts, answer, updatedAt, t, c, amount, minOut, salt] =>
    let e := env cfg (addr s) ts { answer := u answer, updatedAt := u updatedAt }
    some (result w (redeem e w (addr t) (addr c) (u amount) (u minOut) (u salt)) fun (w, out) => (w, s!"ok {out.toNat}"))
  | "setPair", [s, ts, t, c, ttl] =>
    let e := env cfg (addr s) ts { answer := 0, updatedAt := 0 }
    some (result w (setPair e w (addr t) (addr c) oracle (BitVec.ofNat 48 ttl)) fun w => (w, "ok"))
  | "removePair", [s, ts, t, c] =>
    let e := env cfg (addr s) ts { answer := 0, updatedAt := 0 }
    some (result w (removePair e w (addr t) (addr c)) fun w => (w, "ok"))
  | "setDailyLimit", [s, ts, t, c, usr, limit] =>
    let e := env cfg (addr s) ts { answer := 0, updatedAt := 0 }
    some (result w (setDailyLimit e w (addr t) (addr c) (addr usr) (u limit)) fun w => (w, "ok"))
  | "withdraw", [s, ts, t, to, amount] =>
    let e := env cfg (addr s) ts { answer := 0, updatedAt := 0 }
    some (result w (withdraw e w (addr t) (addr to) (u amount)) fun w => (w, "ok"))
  | _, _ => none

end DiffTest

open DiffTest in
def main : IO Unit := do
  let stdin ← IO.getStdin
  let stdout ← IO.getStdout
  let mut cfg : Config := ⟨0, 0, 0, 0⟩
  let mut w : World :=
    { ir := State.init, balances := fun _ _ => 0, allowances := fun _ _ _ => 0, redemptionUsed := fun _ => false }
  repeat
    let line ← stdin.getLine
    if line.isEmpty then break
    match (line.splitOn " ").map (·.trimAscii.toString) |>.filter (· ≠ "") with
    | [] => pure ()
    | cmd :: rest =>
      let some args := rest.mapM String.toNat? | throw (IO.userError s!"bad numbers: {line}")
      if cmd = "config" then
        let [td, sd, od, m] := args | throw (IO.userError s!"bad config: {line}")
        cfg := ⟨td, sd, od, m⟩
      else
        let some (w', r) := step cfg w cmd args | throw (IO.userError s!"unknown command: {line}")
        w := materialize w'
        stdout.putStrLn s!"{r} | {snapshot w}"
