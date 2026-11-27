# BIOS math library {#sec-bios-math}

The `math` table provides numeric functions, trigonometry, exponentials and a
random-number generator: 25 functions and 4 constants. Most functions keep the
kind of their argument (Integer or Float); the trigonometric, exponential and
logarithmic functions always return Floats.

## Use {#sec-bios-math-calling-the-library}

Call the functions as `math.name(...)`. The separate BIOS function `math/sin`
works with phase words and integer results; see
[turn-phase sine](#sec-bios-math-turn-phase-sine). Arguments must be numbers;
strings are not converted. Missing arguments are nil.

## Notation {#sec-bios-math-numeric-notation}

In the formulas, D(a, b) is `a // b` and M(a, b) is `a % b` (see the
[CPU](cpu.md#sec-cpu-values-and-numeric-instructions)), and T(x) is x rounded
towards 0. Integer arithmetic wraps; Float arithmetic rounds to single
precision after each step.

## Constants {#sec-bios-math-constants}

| Field | Value |
|---|---|
| `math.huge` | +infinity |
| `math.mininteger` | −2147483648 (`80000000H`) |
| `math.maxinteger` | 2147483647 |
| `math.pi` | 3.1415927410125732 (Float `40490FDBH`) |

## math.abs {#sec-bios-math-mathabsvalue}

```text
math.abs(x) -> |x|
```

Same kind as x. `math.abs(math.mininteger)` is `math.mininteger`. For a Float:
+0 for ±0, +infinity for ±infinity, NaN for NaN.

## math.floor {#sec-bios-math-mathfloorvalue}

```text
math.floor(x) -> number
```

x rounded down. An Integer is returned unchanged; a Float result that fits in
32 bits is returned as an Integer, otherwise as a Float. NaN and infinities stay
Floats.

## math.ceil {#sec-bios-math-mathceilvalue}

```text
math.ceil(x) -> number
```

x rounded up; otherwise as `math.floor`.

## math.round {#sec-bios-math-mathroundvalue}

```text
math.round(x) -> number
```

x rounded to the nearest integer, halves away from 0; otherwise as `math.floor`.

## math.fmod {#sec-bios-math-mathfmodleft-right}

```text
math.fmod(a, b) -> remainder
```

Remainder of a / b with the quotient rounded towards 0, so the remainder has the
sign of a. Two Integers give an Integer; b = 0 then raises an error, and
`math.fmod(0x80000000, -1)` is 0. Otherwise the result is a Float: NaN for b = 0
or infinite a; a for infinite b.

## math.modf {#sec-bios-math-mathmodfvalue}

```text
math.modf(x) -> integer part, fraction
```

| x | Results |
|---|---|
| Integer | x, +0.0 |
| Finite Float | T(x) (Integer if it fits), x − T(x) (Float) |
| ±infinity | x, +0.0 |
| NaN | NaN, NaN |

## math.min and math.max {#sec-bios-math-mathminfirst}

```text
math.min(x, ...) -> smallest
math.max(x, ...) -> largest
```

Returns one of the arguments, unchanged: starting with x, each further argument
replaces it if it is smaller (`<`) or larger (`>`). With equal values the first is
kept. Numbers compare with numbers and strings with strings; other arguments,
NaN after the first, and nil are passed over. With no first argument:
`min expects at least one argument.` or `max expects at least one argument.`

### math.max {#sec-bios-math-mathmaxfirst}

See `math.min`.

## math.tointeger {#sec-bios-math-mathtointegervalue}

```text
math.tointeger(x) -> integer or nil
```

An Integer unchanged; a Float with an exact integer value in 32-bit range as an
Integer; otherwise nil.

## math.type {#sec-bios-math-mathtypevalue}

```text
math.type(x) -> "integer", "float" or nil
```

`math.type(2.0)` is `"float"`, although `2.0 == 2`.

## math.ult {#sec-bios-math-mathultleft-right}

```text
math.ult(a, b) -> boolean
```

true if a < b as unsigned 32-bit numbers: `math.ult(0, -1)` is true. a and b
must be integers.

## math.sign {#sec-bios-math-mathsignvalue}

```text
math.sign(x) -> 1, 0 or -1
```

1 for x > 0, −1 for x < 0, 0 for ±0 and NaN (Integers).

## Time and globals {#sec-bios-math-execution-cost-and-library-bindings}

The functions are BLua code. `math.type` and `math.tointeger` take 1 cycle
plus the call. `min` and `max` take more time for more arguments. Changing a
field of `math` does not affect the other functions; `min` and `max` use the
current global `select` and `error`.

## Angles, exponentials and logarithms {#sec-bios-math-angles-and-transcendental-operations}

| Function | Result |
| --- | --- |
| `math.deg(x)` | Radians to degrees |
| `math.rad(x)` | Degrees to radians |
| `math.sin(x)`, `math.cos(x)`, `math.tan(x)` | Sine, cosine, tangent of x radians |
| `math.atan(y [, x])` | Angle in radians |
| `math.asin(x)`, `math.acos(x)` | Inverse sine and cosine, in radians |
| `math.sqrt(x)` | Square root |
| `math.exp(x)` | e^x^ |
| `math.log(x [, base])` | Logarithm (natural without base) |

All return one Float; Integer arguments are converted. The calculations below
are given in the order performed; pi is `math.pi` and h = pi × 0.5. Changing
`math` fields does not affect them.

### Units {#sec-bios-math-converting-angular-units}

```text
math.deg(x) = x * (180 / pi)
math.rad(x) = x * (pi / 180)
```

### Sine, cosine and tangent {#sec-bios-math-sine-cosine-and-tangent}

The argument is reduced correctly over the whole Float range.

| x | `sin` | `cos` | `tan` |
|---|---|---|---|
| +0 | +0 | 1.0 | +0 |
| −0 | −0 | 1.0 | −0 |
| NaN, ±infinity | NaN | NaN | NaN |

`math.tan(math.pi / 2)` is large but finite, since `math.pi / 2` is not exact.

### Turn-phase sine {#sec-bios-math-turn-phase-sine}

The BIOS function `math/sin` takes a 32-bit phase word (2^32^ = one turn) and
returns the sine × 65536 as an Integer:

```lua
local sin_phase<const> = require('math/sin')
local peak = sin_phase(0x40000000)     -- 65536 (+1)
local opposite = sin_phase(0xc0000000) -- -65536 (−1)
```

| Phase | Angle | Result |
| --- | --- | ---: |
| `00000000H` | 0 | 0 |
| `20000000H` | 1/8 turn | 46340 |
| `40000000H` | 1/4 turn | 65536 |
| `80000000H` | 1/2 turn | 0 |
| `C0000000H` | 3/4 turn | −65536 |

It uses a table of 257 values for a quarter turn, interpolating with the low
22 bits of the phase (the increment is shifted right by 22), and bit 31 for the
sign.

### Inverse angles {#sec-bios-math-inverse-angles}

```text
P(v) = (pi * 0.25 * v) + (0.273 * v * (1 - abs(v)))
A(v) = h - P(1/v)     if v > 1
       -h - P(1/v)    if v < -1
       P(v)           otherwise
```

| `math.atan(y, x)` | Result |
| --- | --- |
| x nil | A(y) |
| y or x NaN | NaN |
| x > 0 | A(y / x) |
| x < 0, y ≥ 0 | A(y / x) + pi |
| x < 0, y < 0 | A(y / x) − pi |
| x = 0, y > 0 | h |
| x = 0, y < 0 | −h |
| x = 0, y = 0 | +0 |

The rules are tested in this order. This is an approximation, not an exact
atan2.

```text
math.asin(x) = atan(x, sqrt(1 - x * x))
math.acos(x) = h - asin(x)
```

Arguments outside −1…1 give NaN.

### math.sqrt {#sec-bios-math-square-root}

| x | Result |
|---|---|
| < 0 (−infinity included) | NaN |
| ±0, +infinity | x (Integer 0 gives +0.0) |
| Other | See below |

```text
n = x; s = 1
while n >= 4: n = n * 0.25; s = s * 2
while n < 1:  n = n * 4;    s = s * 0.5
e = n
repeat 8 times: e = (e + n / e) * 0.5
result = e * s
```

### math.exp {#sec-bios-math-natural-exponential}

| x | Result |
| --- | --- |
| NaN | NaN |
| > 88.72283935546875 | +infinity |
| < −103.972076416015625 | +0 |
| < 0 | 1 / exp(−x) |
| Other | See below |

```text
ln2 = 0.69314718055994530942
inv_ln2 = 1.44269504088896340736
power = D(x * inv_ln2 + 0.5, 1)
r = x - power * ln2
term = 1; sum = 1
for divisor = 1 to 16: term = term * r / divisor; sum = sum + term
while power >= 16: sum = sum * 65536; power = power - 16
while power > 0:   sum = sum * 2;     power = power - 1
```

For x below about −88.7, exp(−x) overflows to infinity, so the result is 0
before the lower limit is reached.

### math.log {#sec-bios-math-logarithms}

N(x), the natural logarithm:

| x | Result |
| --- | --- |
| < 0 | NaN |
| ±0 | −infinity |
| +infinity | +infinity |
| Other | See below |

```text
sqrt_two = 1.41421356237309504880
sqrt_half = 0.70710678118654752440
m = x; e = 0
while m >= sqrt_two: m = m * 0.5; e = e + 1
while m < sqrt_half: m = m * 2;   e = e - 1
z = (m - 1) / (m + 1); z2 = z * z; term = z; sum = z
for d = 3, 5, …, 31: term = term * z2; sum = sum + term / d
N(x) = 2 * sum + e * ln2
```

| `math.log(x, base)` | Result |
| --- | --- |
| base nil | N(x) |
| base 10 | N(x) / 2.30258509299404568402 |
| base 2 | N(x) / ln2 |
| Other | N(x) / N(base) |

`math.log(1, 1)` is NaN.

## Random numbers {#sec-bios-math-random-numbers}

### math.random {#sec-bios-math-mathrandomlower-upper-number}

```text
math.random() -> Float in [0, 1)
math.random(m) -> Integer in [1, m]
math.random(m, n) -> Integer in [m, n]
```

The bounds must be integers within 32 bits, with m ≥ 1 or m ≤ n; otherwise an
error is raised and the generator does not advance. `random(nil, n)` is the same
as `random()`.

Each call advances the generator once. With s the new state (unsigned):

```text
random()      = (s >> 8) * 2^-24
random(m, n)  = m + T(s * (n - m + 1) / 2^32)
```

### math.randomseed {#sec-bios-math-mathrandomseedseed-nil}

```text
math.randomseed([seed])
```

Sets the state to the 32 bits of seed (an integer), or to TIME_MS if seed is nil.
Returns nil.

### Generator {#sec-bios-math-generator-state-and-update}

One 32-bit state, `12345678H` at startup, shared by all callers:

```text
state = (state * 1664525 + 1013904223) AND FFFFFFFFH
```

After `math.randomseed(0)`, the next state is `3C6EF35FH` and `math.random()`
returns 3960563 / 16777216.

## Examples {#sec-bios-math-programming-examples}

### A point on a circle {#sec-bios-math-convert-an-angle-and-form-an-offset}

```lua
local angle<const> = math.rad(30)
local dx<const> = 64 * math.cos(angle)   -- ≈ 55.4256
local dy<const> = 64 * math.sin(angle)   -- ≈ 32
local pixel_x<const> = math.round(dx)    -- 55
local pixel_y<const> = math.round(dy)    -- 32
```

### Repeating a random sequence {#sec-bios-math-repeat-a-pseudorandom-sequence}

```lua
math.randomseed(1)
local first<const> = math.random()       -- ≈ 0.236456
local die<const> = math.random(6)        -- 3
math.randomseed(1)
local replay<const> = math.random()      -- the same as first
```
