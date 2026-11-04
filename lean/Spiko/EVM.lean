namespace Spiko.EVM

abbrev U256 := BitVec 256
abbrev I256 := BitVec 256 -- same bits as `U256`, meant to be read with `toInt`
abbrev U208 := BitVec 208
abbrev U48 := BitVec 48
abbrev U8 := BitVec 8
abbrev Address := BitVec 160

inductive Revert where
  /-- `Panic(0x11)`: overflow in checked arithmetic. -/
  | panicOverflow
  /-- `Panic(0x12)`: division by zero. -/
  | panicDivByZero
  /-- `SafeCastOverflowedUintDowncast(bits, value)`. -/
  | safeCastOverflowedUintDowncast (bits : Nat) (value : U256)
  /-- `SafeCastOverflowedIntToUint(value)`. -/
  | safeCastOverflowedIntToUint (value : I256)
  deriving Repr, DecidableEq

-- `{n : Nat}` is an implicit argument: Lean infers the width from `a` and `b`, so one definition serves every uintN.
def checkedAdd {n : Nat} (a b : BitVec n) : Except Revert (BitVec n) :=
  if a.toNat + b.toNat < 2 ^ n then .ok (a + b) else .error .panicOverflow

def checkedMul {n : Nat} (a b : BitVec n) : Except Revert (BitVec n) :=
  if a.toNat * b.toNat < 2 ^ n then .ok (a * b) else .error .panicOverflow

-- `base ** e` with checked semantics (the exponent's type does not matter, only its value).
def checkedPow (base : U256) (e : Nat) : Except Revert U256 :=
  if base.toNat ^ e < 2 ^ 256 then .ok (BitVec.ofNat 256 (base.toNat ^ e)) else .error .panicOverflow

-- OpenZeppelin `Math.saturatingSub`: `a - b`, or 0 when `b > a`.
def saturatingSub (a b : U256) : U256 :=
  if b ≤ a then a - b else 0

def maxU256 : U256 := BitVec.allOnes 256

def mulDiv (x y d : U256) : Except Revert U256 :=
  if d.toNat = 0 then .error .panicDivByZero
  else
    let q := x.toNat * y.toNat / d.toNat
    if q < 2 ^ 256 then .ok (BitVec.ofNat 256 q) else .error .panicOverflow

def toUint (bits : Nat) (v : U256) : Except Revert (BitVec bits) :=
  if v.toNat < 2 ^ bits then .ok (v.setWidth bits) else .error (.safeCastOverflowedUintDowncast bits v)

def toUint256 (v : I256) : Except Revert U256 :=
  if v.toInt < 0 then .error (.safeCastOverflowedIntToUint v) else .ok v

-- Storage writes. Mappings are functions, so `m[a] = v` builds a new function that answers `v` at `a` and defers to
-- the old one elsewhere. `[DecidableEq α]` asks Lean for a way to test `x = a`, which `if` needs.
def upd {α β : Type} [DecidableEq α] (f : α → β) (a : α) (v : β) : α → β :=
  fun x => if x = a then v else f x

-- `m[a][b] = v`
def upd2 {α β γ : Type} [DecidableEq α] [DecidableEq β] (f : α → β → γ) (a : α) (b : β) (v : γ) : α → β → γ :=
  upd f a (upd (f a) b v)

end Spiko.EVM
