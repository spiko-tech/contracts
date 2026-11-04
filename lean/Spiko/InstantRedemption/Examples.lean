import Spiko.InstantRedemption.Model

-- Concrete runs checked at build time, with the numbers of test/instantRedemption.test.js
-- (token: 5 decimals, oracle and stablecoin: 6).

namespace Spiko.InstantRedemption.Examples
open Spiko.EVM

def ir : Address := 0x10
def redemption : Address := 0x11
def token : Address := 0x01
def stable : Address := 0x02
def oracle : Address := 0x03
def alice : Address := 0xa1
def admin : Address := 0xad
def day : Nat := 86400

def canCall (caller _target : Address) (sel : Selector) : Bool :=
  caller == admin || (caller == alice && sel == .redeem)

def env (sender : Address) (now updatedAt : Nat) (price : Int) : Env where
  self := ir
  redemption := redemption
  sender := sender
  timestamp := BitVec.ofNat 256 now
  canCall := canCall
  latestRoundData := fun o =>
    if o = oracle then .ok { answer := BitVec.ofInt 256 price, updatedAt := BitVec.ofNat 256 updatedAt }
    else .error (.external o)
  oracleToken := fun o => if o = oracle then .ok token else .error (.external o)
  decimals := fun a => if a = token then .ok 5 else if a = stable ∨ a = oracle then .ok 6 else .error (.external a)
  canTransfer := fun _ _ _ => true
  redemptionOutputs := fun i o => i == token && o == stable
  redemptionMinimum := fun _ => 0

def revertsWith {α : Type} (r : Except Error α) (e : Error) : Bool :=
  match r with
  | .error e' => e' == e
  | .ok _ => false

/-! ## setPair -/

def w₀ : World where
  ir := State.init
  balances := fun t h =>
    if t = token ∧ h = alice then 100000000 -- 1000 tokens
    else if t = stable ∧ h = ir then 500000000 -- 500 stablecoins of buffer
    else 0
  allowances := fun t o s => if t = token ∧ o = alice ∧ s = ir then maxU256 else 0
  redemptionUsed := fun _ => false

-- Falls back to w₀ on failure, which the guards below then catch.
def w₁ : World :=
  match setPair (env admin 1000 900 1032100) w₀ token stable oracle (BitVec.ofNat 48 (7 * day)) >>=
      fun w => setDailyLimit (env admin 1000 900 1032100) w token stable alice 200000000 with
  | .ok w => w
  | .error _ => w₀

#guard (w₁.ir.pairs (token, stable)).numerator == 1000000
#guard (w₁.ir.pairs (token, stable)).denominator == 100000000000
#guard revertsWith (setPair (env alice 1000 900 1032100) w₀ token stable oracle 0)
  (.restrictedAccess alice ir .setPair)
#guard revertsWith (setPair (env admin 1000 900 1032100) w₀ stable token oracle 0) (.oracleTokenMismatch oracle stable)

/-! ## previewRedeem -/

-- 100 tokens at 1.0321 give 103.21 stablecoins.
#guard (previewRedeem (env alice 1000 900 1032100) w₁.ir token stable 10000000).toOption == some 103210000
-- 0.00001 token is worth 0.000010321 stablecoins, floored to 10 units.
#guard (previewRedeem (env alice 1000 900 1032100) w₁.ir token stable 1).toOption == some 10
-- The price is valid strictly before updatedAt + oracleTTL.
#guard (previewRedeem (env alice (900 + 7 * day - 1) 900 1032100) w₁.ir token stable 1).toOption == some 10
#guard revertsWith (previewRedeem (env alice (900 + 7 * day) 900 1032100) w₁.ir token stable 1)
  (.oracleValueTooOld oracle)
#guard revertsWith (previewRedeem (env alice 1000 900 (-1)) w₁.ir token stable 1)
  (.evm (.safeCastOverflowedIntToUint (BitVec.ofInt 256 (-1))))
#guard revertsWith (previewRedeem (env alice 1000 900 1032100) w₁.ir stable token 1) (.unknownPair stable token)

/-! ## redeem -/

def r₁ := redeem (env alice 1000 900 1032100) w₁ token stable 10000000 0 0x5a17

#guard match r₁ with
  | .ok (w, out) =>
    out == 103210000 &&
    w.balances token alice == 90000000 && w.balances stable alice == 103210000 &&
    w.balances token ir == 0 && w.balances token redemption == 10000000 &&
    w.balances stable ir == 500000000 - 103210000 &&
    w.redemptionUsed (ir, token, stable, 10000000, 0x5a17) &&
    (w.ir.usage (token, stable) alice).amount == 103210000
  | .error _ => false

-- Same amount and salt the next day (so the limit check passes): Redemption rejects the request id.
#guard match r₁ with
  | .ok (w, _) => revertsWith (redeem (env alice (1000 + day) 900 1032100) w token stable 10000000 0 0x5a17)
      (.external redemption)
  | .error _ => false

-- 200 tokens are worth 206.42 stablecoins, above the 200 limit.
#guard revertsWith (redeem (env alice 1000 900 1032100) w₁ token stable 20000000 0 0)
  (.dailyLimitExceeded alice 206420000 200000000)

-- After 103.21 today, another 103.21 is refused today and accepted tomorrow.
#guard match r₁ with
  | .ok (w, _) =>
    revertsWith (redeem (env alice 1000 900 1032100) w token stable 10000000 0 1)
      (.dailyLimitExceeded alice 103210000 96790000) &&
    (redeem (env alice (1000 + day) 900 1032100) w token stable 10000000 0 1).toOption.isSome
  | .error _ => false

end Spiko.InstantRedemption.Examples
