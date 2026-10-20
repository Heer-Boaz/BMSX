# BIOS math library {#sec-bios-math}

The BIOS math library supplies numeric operations, angular functions and a shared pseudorandom generator. Its `math` Table contains twenty-five callable entries and four numeric constants. Numbers use binary64 arithmetic; a function preserves the input scale unless its definition states a unit or representation conversion.

## Calling the library {#sec-bios-math-calling-the-library}

The standard BIOS environment supplies `math` as a Table of functions and
constants. Call its functions directly. The separate named import `math/sin`
uses turn-phase words and integer Q16 results; the ordinary trigonometric
functions use radians and unscaled Numbers.

Numbers use binary64 arithmetic. Descriptions such as “integer component”
and the result `"integer"` classify a Number's value; they do not select a
second numeric type. A function preserves the input scale unless its entry
specifies a unit conversion. Register-word conversion follows the
[CPU rules](cpu.md#sec-cpu-values-and-numeric-instructions).

Missing fixed parameters arrive as nil and surplus arguments are discarded.
`min` and `max` receive a variable argument tail, including its nil positions.
The following entries state the returned count before caller result
adjustment.

## Numeric notation {#sec-bios-math-numeric-notation}

The formulas in this chapter use these explanatory operations:

- **`D(a, b)`**: BLua `a // b`. Form the binary64 quotient `q = a / b`,
  truncate it toward zero as `t`, then return `t - 1` when `t > q`, otherwise
  `t`. Floating division and rounding precede selection of the result.
- **`T(x)`**: truncate toward zero, using `-D(-x, 1)` for negative `x` and
  `D(x, 1)` otherwise.
- **`M(a, b)`**: BLua `a % b`. Form the truncation-based floating remainder
  `r`; when `r` is positive and `b` negative, or `r` negative and `b` positive,
  return `r + b`. Otherwise return `r`, including its zero sign.

Arithmetic on a non-Number yields NaN. Numeric Strings require an explicit
`tonumber` conversion. Number/Number and String/String pairs support ordering;
other kind pairs compare false. NaN is unordered and the two numeric zero
signs compare equal. See [numeric instructions](cpu.md#sec-cpu-values-and-numeric-instructions).

These rules apply to the written formulas, including overflow, division by
zero and rounding of intermediate values. In particular, `fmod` uses its
quotient formula while `ult` compares modulo results.

## Constants {#sec-bios-math-constants}

| Field | Numeric value | Meaning and limits |
|------------------|-----------------------------------------------|-----------------------------------|
| `math.huge` | Positive infinity, initialized by `1.0 / 0.0` | A numeric infinity, not a maximum finite number or an argument validator. |
| `math.mininteger` | `-9007199254740991` | The exported lower integer constant. It does not bound all numbers or all values accepted by `tointeger`. |
| `math.maxinteger` | `9007199254740991` | The exported upper integer constant. The pair is symmetric, not the asymmetric bounds of a signed 64-bit integer. |
| `math.pi` | Literal `3.141592653589793238462643383279502884`, stored as a number | The literal spelling does not imply that every displayed decimal digit survives in binary64 precision. |

These are value fields, not callable functions. They are not fixed-point constants, register words, or precision metadata. There is no exported NaN constant among the fields covered here, although several operations can produce numeric NaN.

## `math.abs(value)` {#sec-bios-math-mathabsvalue}

Returns one value: `-value` when `value < 0`, otherwise the original value.
For Numbers this gives the magnitude, preserving either zero sign. Negative
infinity becomes positive infinity; NaN and non-Number values are returned
unchanged. A missing argument therefore returns nil.

## `math.floor(value)` {#sec-bios-math-mathfloorvalue}

Returns one Number, `D(value, 1)`. For finite values it selects the lower whole
value at unit spacing in the supplied scale. Infinities and signed zero retain
their signs; NaN and non-Number input produce NaN.

## `math.ceil(value)` {#sec-bios-math-mathceilvalue}

Returns one Number, `-D(-value, 1)`. For finite values it selects the upper
whole value at unit spacing. Its infinity, signed-zero and non-Number cases
are the same as `floor`.

## `math.round(value)` {#sec-bios-math-mathroundvalue}

Returns one Number. For `value >= 0`, the result is `D(value + 0.5, 1)`;
otherwise it is `-D((-value) + 0.5, 1)`. Exact halfway values within ordinary
finite precision round away from zero. At large magnitudes, the addition of
`0.5` is itself subject to binary64 rounding.

Both zero signs produce positive zero. A negative value whose rounded
magnitude becomes zero produces negative zero. Infinities retain their signs;
NaN and non-Number inputs produce NaN.

## `math.fmod(left, right)` {#sec-bios-math-mathfmodleft-right}

Returns one Number, calculated in this order:

```text
left - (T(left / right) * right)
```

The result uses the input scale. Division can overflow before truncation,
including for finite operands. A zero divisor, an infinity operand, NaN or a
non-Number operand produces NaN. A zero numerator and finite nonzero divisor
produce positive zero, including for a negative-zero numerator.

## `math.modf(value)` {#sec-bios-math-mathmodfvalue}

Returns two Numbers: the integer component `T(value)`, then
`value - T(value)`. The first result truncates toward zero; the residual
retains its signed contribution rather than being made positive.

For either zero sign, the first result keeps that sign and the residual is
positive zero. An infinity returns that infinity followed by NaN. NaN or
non-Number input returns two NaNs. Both components use the original scale.

## `math.min(first, ...)` {#sec-bios-math-mathminfirst}

Returns one selected argument, unchanged. Selection starts with `first` and
visits each subsequent argument in order, replacing the selection only when
`candidate < selected`. Ties retain the earlier value, including its zero
sign. Nil as the first argument raises:

```text
min expects at least one argument.
```

Number candidates compare numerically; String candidates compare as Strings.
A candidate of an incomparable kind leaves the selection unchanged. An
initial NaN remains selected, and a later NaN cannot replace a numeric
selection. Explicit nil tail arguments count as arguments but do not replace
a nonnil selection. A nonnil Boolean, Table, function or Thread initially
selected remains selected.

## `math.max(first, ...)` {#sec-bios-math-mathmaxfirst}

Returns one selected argument, using the same scan and tie rules as `min`,
but replacing the selection only when `candidate > selected`. Nil as the
first argument raises:

```text
max expects at least one argument.
```

The mixed-kind, NaN and nil-tail behavior is the same as for `min`.

## `math.tointeger(value)` {#sec-bios-math-mathtointegervalue}

Returns one Number when `value` is a finite Number equal to `T(value)`;
otherwise returns one nil. Thus finite whole values are accepted, fractions
are rejected, and either zero sign is preserved. Accepted whole values may
lie outside the exported `mininteger` and `maxinteger` constants. This call
classifies integrality; use explicit word conversion for a register encoding.

## `math.type(value)` {#sec-bios-math-mathtypevalue}

Returns `"integer"` for a Number accepted by `tointeger`, `"float"` for other
Numbers, and nil for other kinds. Infinities and NaN classify as `"float"`.
Either zero sign classifies as `"integer"`. These labels describe values in
the single Number representation.

## `math.ult(left, right)` {#sec-bios-math-mathultleft-right}

Returns one Boolean:

```text
M(left, 4294967296.0) < M(right, 4294967296.0)
```

For integer inputs this compares their modulo-2^32 residues. Fractional
inputs participate directly in modulo without truncation. Equal zero residues
compare false regardless of their signs. Infinity, NaN or non-Number input
produces an unordered residue and therefore false.

## `math.sign(value)` {#sec-bios-math-mathsignvalue}

Returns one Number: `1` for `value > 0`, `-1` for `value < 0`, otherwise `0`.
This includes the corresponding signs for infinities. Either zero sign, NaN
and non-Number input produce positive zero. The result is dimensionless.

## Execution cost and library bindings {#sec-bios-math-execution-cost-and-library-bindings}

Elementary operations execute their stated arithmetic and calls. `min` and
`max` make one comparison per tail argument and repeatedly forward the tail
through `select`; selecting one final result leaves those preceding calls
in place. For `n` ordinary positive selector positions, the selected suffixes
contain `n + (n - 1) + ... + 1` values in total.

The primitive surcharges are one cycle for `type` or `select`, and two for
`error`, in addition to executed BIOS instructions and ordinary calls. Use
[CPU cycle accounting](cpu.md#sec-cpu-cycle-accounting-and-execution-boundaries) when
budgeting a complete operation.

Reassigning a Math field leaves the library's saved numeric operations and
constants unchanged. `math.type` retains its integrality operation;
`math.type` and `tointeger` read the current global `type`. `min` and `max`
read current `select` and `error`. Their entries describe the installed
[base functions](bios-base.md#sec-bios-base).

## Angles and transcendental operations {#sec-bios-math-angles-and-transcendental-operations}

Use `math.rad` and `math.deg` to change angular units, `math.sin`, `math.cos`
and `math.tan` for periodic quantities, and the inverse functions to recover
angles. `math.sqrt`, `math.exp` and `math.log` provide roots, exponentials and
logarithms. All eleven interfaces return exactly one Number.

| Interface | Meaning |
| --- | --- |
| `math.deg(value)` | Radian-scale value to degrees. |
| `math.rad(value)` | Degree-scale value to radians. |
| `math.sin(radians)` | Approximate sine. |
| `math.cos(radians)` | Approximate cosine. |
| `math.tan(radians)` | Approximate tangent. |
| `math.atan(y, x)` | Approximate angle in radians; `x == nil` selects the one-value form. |
| `math.asin(value)` | Approximate inverse sine in radians. |
| `math.acos(value)` | Approximate inverse cosine in radians. |
| `math.sqrt(value)` | Approximate square root. |
| `math.exp(value)` | Approximate natural exponential. |
| `math.log(value, base)` | Approximate logarithm; `base == nil` selects the natural logarithm. |

These are fixed-parameter interfaces, not varargs. Missing fixed parameters
have value `nil`; surplus parameters are not retained. The signatures show all
fixed parameters. An explicit `nil` selects the alternate forms `math.atan(y, nil)` and
`math.log(value, nil)`; omitting the final parameter also supplies `nil`.
No other parameter has a default.

The formulas below use the Number arithmetic and `D` and `T` notation defined
earlier. For word conversion, bit masks and signed right shifts, see
[Bitwise operations and shifts](cpu.md#sec-cpu-bitwise-operations-and-shifts).
The formulas specify the approximations and their operation order.
Rounding follows Number arithmetic at each step. Nonnumeric arguments follow
the same arithmetic rules and produce the results stated below; numeric text
requires explicit conversion.

Here `pi` is the BIOS Number constant and `h = pi * 0.5`. The calculations
use their original constants and numeric operations after public Math fields
are reassigned. Named intermediate approximations below are formula notation,
not additional Math entries.

The text blocks in this reference section are explanatory formulas and
pseudocode, not BLua source listings. The programming examples below use
BLua source.

### Converting angular units {#sec-bios-math-converting-angular-units}

The conversion functions perform one multiplication:

```text
math.deg(value): value * (180 / pi)
math.rad(value): value * (pi / 180)
```

There is no magnitude reduction or fixed-point conversion. Either zero sign
is preserved, infinities retain their sign, and NaN or a nonnumeric argument
produces NaN.

### Sine, cosine and tangent {#sec-bios-math-sine-cosine-and-tangent}

These functions accept radian-scale Numbers and return dimensionless binary64
approximations. They do **not** convert their arguments to 32-bit phases or
quantize their results to Q16. Small angles therefore retain their floating-point
scale: `math.sin(0.000001)` is nonzero.

Argument reduction covers the full finite binary64 range. Large angles are
not reduced by taking a remainder against a single rounded `2*pi` constant.

| Input | `math.sin` | `math.cos` | `math.tan` |
|---|---|---|---|
| `+0` | `+0` | `1` | `+0` |
| `-0` | `-0` | `1` | `-0` |
| NaN or either infinity | NaN | NaN | NaN |

The result is a binary64 approximation. For example, `math.pi / 2` is a
rounded Number rather than an exact tangent pole, so its tangent can be large
and finite. Argument reduction and cancellation affect the executed path and
cycle count.

### Turn-phase sine {#sec-bios-math-turn-phase-sine}

The named BIOS import `math/sin` takes one **32-bit turn-phase word** and
returns one **signed integer Q16 sine**. Use it when an angle is already stored
as a wrapping phase word, rather than converting that phase to radians:

```lua
local sin_phase<const> = require('math/sin')
local peak = sin_phase(0x40000000)     -- 65536, representing +1
local opposite = sin_phase(0xc0000000) -- -65536, representing -1
```

One complete turn spans `2^32` phase units. Bit 31 selects the negative half
of the sine wave; the low 30 bits and quadrant select a position within its
quarter-wave table. Ordinary word conversion applies to the bitwise phase
selection. The returned Number is an integer, not a floating sine in the
interval −1 through +1 and not an unsigned encoded negative word.

| Phase word | Angle | Returned Number |
| --- | --- | ---: |
| `00000000H` | 0 turns | 0 |
| `20000000H` | 1/8 turn | 46340 |
| `40000000H` | 1/4 turn | 65536 |
| `80000000H` | 1/2 turn | 0 |
| `C0000000H` | 3/4 turn | −65536 |

The quarter-wave table has 257 samples, giving 256 equal phase intervals.
Within an interval, the low 22 phase bits interpolate between its two integer
samples; the interpolated positive increment is shifted right by 22 before
the quadrant sign is applied. Results therefore retain integer Q16
quantization. The radian functions `math.sin`, `math.cos` and `math.tan` do not
use this interface.

### Inverse angles {#sec-bios-math-inverse-angles}

The private approximation used by `math.atan` is:

```text
P(v) = (pi * 0.25 * v) + (0.273 * v * (1 - abs(v)))
```


Here `abs` is the retained private absolute-value operation. Define `A(v)` by
these ordered cases:

| Condition | Result |
| --- | --- |
| `v > 1` | `h - P(1 / v)` |
| `v < -1` | `-h - P(1 / v)` |
| Otherwise | `P(v)` |



`math.atan(y, x)` selects its result using the following order. The `x < 0`
rows are considered before either remaining `y`-axis row.

| Condition | Result |
| --- | --- |
| `x == nil` | `A(y)` |
| `y ~= y` or `x ~= x` | NaN |
| `x > 0` | `A(y / x)` |
| `x < 0` and `y >= 0` | `A(y / x) + pi` |
| `x < 0`, otherwise | `A(y / x) - pi` |
| `y > 0` | `h` |
| `y < 0` | `-h` |
| Otherwise | Literal positive zero. |


The result uses radian scale. A supplied `false` is not the nil form:
`math.atan(1, false)` reaches the axis branch and returns `h`. A nonnumeric
`y` in the nil form produces NaN through `P`. Numeric NaN in the two-value
form is handled by the self-inequality checks. With numerical zero axes,
the last row returns positive zero regardless of either zero sign. These
polynomial and branch rules also determine results at infinite arguments;
the approximation is not a correctly rounded `atan2` operation.

The other inverse functions use retained private operations:

```text
math.asin(value): atan(value, sqrt(1 - (value * value)))
math.acos(value): h - asin(value)
```

Their results are in radians. Numerical inputs outside `[-1, 1]` produce NaN
through the square root and angle calculation, rather than an explicit domain
error. Missing or nonnumeric inputs likewise reach NaN through the arithmetic.
The inverse-sine calculation includes the square root's normalization and
refinements; inverse-angle work is therefore not uniformly fixed. No uniform
inverse-trigonometric accuracy or result-range guarantee is specified here.

### Square root {#sec-bios-math-square-root}

`math.sqrt(value)` first returns NaN for `value < 0`, then returns `value`
unchanged if it equals zero or positive infinity. Consequently negative
infinity produces NaN, positive infinity is preserved, and either zero sign
is preserved.


For other inputs, initialize `normalized = value` and `scale = 1`, then
perform these loops in order:

```text
while normalized >= 4: normalized *= 0.25; scale *= 2
while normalized < 1:  normalized *= 4;    scale *= 0.5
```


Set `estimate = normalized`, perform exactly eight refinements,

```text
estimate = (estimate + normalized / estimate) * 0.5
```


and return `estimate * scale`. Positive finite values are normalized using
powers of four and a power-of-two scale. The normalization work depends on
magnitude. NaN and nonnumeric inputs skip both loops and produce NaN during
refinement arithmetic. The eight refinements and the displayed scaling
specify the approximation; the executed normalization path determines its
variable part of the cycle count.


### Natural exponential {#sec-bios-math-natural-exponential}

`math.exp(value)` approximates the natural exponential. Its initial tests are
ordered:

| Condition | Result |
| --- | --- |
| `value ~= value` | NaN |
| `value > 709.782712893384` | Positive infinity. |
| `value < -745.133219101941` | Literal zero. |

The two numerical cutoffs are **strict**: equality proceeds to the
approximation. Both infinities take their corresponding cutoff branch.
After these tests, a negative value returns the reciprocal of the positive
approximation at `-value`; other values use the positive approximation
directly.


The retained constants are:

```text
ln2 = 0.69314718055994530942
inv_ln2 = 1.44269504088896340736
```


For the positive approximation at `v`, reduce the argument as follows:

```text
power = D(v * inv_ln2 + 0.5, 1)
reduced = v - power * ln2
```

Start `term = 1` and `sum = 1`. For each integer divisor from 1 through 16,
in order, perform:

```text
term = (term * reduced) / divisor
sum = sum + term
```

Set `result = sum`, then scale in this order:

```text
while power >= 16: result *= 65536; power -= 16
while power > 0:   result *= 2;     power -= 1
```

The resulting Number is the positive approximation. There are exactly 16
series updates, but the scaling work varies. Nonnumeric input passes the
initial comparisons, produces NaN in reduction and the series, and skips the
scaling loops.

For negative inputs, the positive intermediate can overflow **before** the
reciprocal is taken. The reciprocal then becomes zero even when the argument
has not crossed the explicit underflow cutoff. Applications requiring very
small exponential results must account for that limitation.


### Logarithms {#sec-bios-math-logarithms}

Use `math.log(value, nil)` for the natural logarithm, or supply a base. The
natural logarithm approximation `N(v)` first tests, in order:

| Condition | Result |
| --- | --- |
| `v < 0` | NaN |
| `v == 0` | Negative infinity. |
| `v == positive infinity` | Positive infinity. |


Thus negative infinity produces NaN and either zero sign produces negative
infinity. Otherwise initialize `exponent = 0` and `mantissa = v`. The retained
normalization constants are:

```text
sqrt_two = 1.41421356237309504880
sqrt_half = 0.70710678118654752440
```

Perform these loops in order:

```text
while mantissa >= sqrt_two: mantissa *= 0.5; exponent += 1
while mantissa < sqrt_half: mantissa *= 2;   exponent -= 1
```


Then calculate:

```text
z = (mantissa - 1) / (mantissa + 1)
z2 = z * z
term = z
sum = term
```


For denominators 3, 5, 7, ..., 31, in order, perform 15 updates:

```text
term = term * z2
sum = sum + term / denominator
```

The natural result is `(2 * sum) + (exponent * ln2)`, using the same retained
`ln2` as the exponential. NaN and nonnumeric inputs skip normalization and
produce NaN through the arithmetic.

`math.log(value, base)` calculates `natural = N(value)` **first**, before
selecting the base branch:

| Condition | Result |
| --- | --- |
| `base == nil` | `natural` |
| `base == 10` | `natural / ln10` |
| `base == 2` | `natural / ln2` |
| Otherwise | `natural / N(base)` |

Here `ln10 = 2.30258509299404568402` is another retained Number constant.
The general-base branch applies the displayed division to every supplied
base. Since `N(1)` is zero, base one causes division by zero and
`math.log(1, 1)` produces NaN. A supplied false or another nonnumeric base
produces NaN through `N(base)`; only nil selects the natural-log form.

The divisions can produce infinities, signed zeros or NaN. Natural
normalization depends on input magnitude, followed by 15 series updates;
the general-base branch may perform normalization again for the base. The
cycle count depends on the selected calculation.

All decimal constants above are rounded to their stored Number values.

## Random numbers {#sec-bios-math-random-numbers}

### `math.random([lower [, upper]])` → Number {#sec-bios-math-mathrandomlower-upper-number}

Returns exactly one Number on success. The function has two fixed parameters and no variable-argument parameter. An omitted fixed parameter arrives as nil. False is not nil and does not request an omitted-argument default. See [calls, closures, globals, and tables](cpu.md#sec-cpu-calls-closures-globals-and-tables) for the call model.

Both bound-rejection branches call the current public `error` binding. The raised String behavior below assumes its installed BIOS definition.

Every call advances the shared generator **before inspecting either bound**. Consequently, an explicit bound error consumes an update, as does a call whose result is NaN.


The branches are selected in this order:

1. If `lower` is nil, return the unit sample immediately. `upper` is not examined. Thus `random()` and `random(nil, upper)` select this branch, including `random(nil, false)`.
2. Otherwise, if `upper` is nil, truncate `lower` toward zero to obtain `upper_int`. If `upper_int < 1`, raise exactly:

   ```text
   random upper bound must be positive.
   ```

   Otherwise return:

   ```text
   trunc(value * upper_int) + 1
   ```

3. Otherwise, truncate `lower` first and `upper` second to obtain `lower_int` and `upper_int`. If `upper_int < lower_int`, raise exactly:

   ```text
   random upper bound must be greater than or equal to lower bound.
   ```

   Otherwise return:

   ```text
   lower_int + trunc(value * ((upper_int - lower_int) + 1))
   ```


Here `value` is the unit sample already generated. In these formulas, `trunc` denotes the private truncation operation, not an additional public function. For finite Numbers it truncates toward zero.

The unit sample lies in **[0, 1)**: zero is included and one is excluded. Its largest possible value is `1 - 2^-32`. For ordinary finite bounded inputs, the source-defined closed integer intervals are **[1, upper_int]** for one bound and **[lower_int, upper_int]** for two bounds. Both endpoints of those interval definitions are included. The formulas above remain authoritative: floating arithmetic and rounding do not support extending this description into a guarantee for every extreme Number, or a promise that every integer is sampled or equally likely.

`random(u)` and `random(u, nil)` use the one-bound branch. Fractional finite bounds are truncated, not rounded to the nearest integer. A one-bound zero, negative integer, or finite value that truncates below one takes the positive-bound error.

Supply finite Number bounds for a bounded integer result. Nonnumeric or NaN
bounds propagate NaN through the result formula after consuming a generator
update. With a positive-infinity upper bound, the result is positive infinity
for a positive unit sample and NaN for zero. A negative-infinity upper bound
raises the positive-bound error. These cases follow ordinary
[Number arithmetic](cpu.md#sec-cpu-values-and-numeric-instructions).

### `math.randomseed([seed])` → nil {#sec-bios-math-mathrandomseedseed-nil}

Returns **exactly one nil result**, not an empty result list. It has one fixed parameter and no variable-argument parameter.

If `seed` is nil, including an omitted parameter, the function calls the current `os.clock()` binding, multiplies that result by 1000, applies the private truncation operation, reduces it modulo `4294967296.0`, and stores it in the shared generator word. With the BIOS-defined `os.clock`, the source expression is:

```text
trunc(((*time_ms / 1000) * 1000)) % 4294967296.0
```

Here `time_ms` denotes the unsigned millisecond word sampled by the BIOS clock function. The divide-then-multiply expression is significant; it is not replaced here by a direct word value. The seed therefore depends on the sampled system counter, rather than a civil clock or an entropy source. See [[system services](system.md#sec-system)]{.content-visible when-format="html"}[Book I, Chapter 12]{.content-visible when-format="pdf"}.

Otherwise, the function stores:

```text
trunc(seed) % 4294967296.0
```

An explicit seed does not use the clock. Finite seeds are truncated toward zero, reduced using positive-modulus semantics, and stored as an unsigned word. Both `-1` and `-1.9` therefore store `FFFFFFFFH`; zero stores zero. False selects this supplied-seed branch, not the clock branch. Nonnumeric seeds, NaN, and either infinity reach a NaN modulus result and store word zero. There is no local explicit seed error.

Seeding performs no generation step or warm-up loop and returns no seed value. After seeding zero, the next unit output is exactly `1013904223 / 4294967296`.

### Generator state and update {#sec-bios-math-generator-state-and-update}

The public bindings are `math.random` and `math.randomseed`. They use one shared 32-bit generator state, initialized to `12345678H` during BIOS startup. The Math Table provides no separate state-access interface.

Each generation step reads the old word and computes:

```text
((old * 1664525) + 1013904223) % 4294967296.0
```

The result becomes the new unsigned 32-bit state. Dividing that state by `4294967296.0` gives the unit sample. Seeding replaces the same state; all callers advance and seed this one stream.


## Programming examples {#sec-bios-math-programming-examples}


### Convert an angle and form an offset {#sec-bios-math-convert-an-angle-and-form-an-offset}

The angular functions take radians. To place a point on a circle with radius
64 position units, convert the authored degree angle once and scale its sine
and cosine:

```lua
local angle<const> = math.rad(30)
local dx<const> = 64 * math.cos(angle)
local dy<const> = 64 * math.sin(angle)
local pixel_x<const> = math.round(dx)
local pixel_y<const> = math.round(dy)
```

The offsets are approximately `(55.4256,32)` position units; rounding selects
`(55,32)`. Floating results need not equal ideal decimal fractions exactly.
Choose rounding or truncation deliberately when converting a calculated
position to whole pixels. These functions do not produce GTE coefficients or
GPU packet fields; use the destination unit's documented representation.


### Repeat a pseudorandom sequence {#sec-bios-math-repeat-a-pseudorandom-sequence}

Seed the shared generator when starting a sequence. Reusing the seed repeats
its subsequent updates:

```lua
math.randomseed(1)
local first<const> = math.random()
local die<const> = math.random(6)
math.randomseed(1)
local replay<const> = math.random()
```

`first` and `replay` are equal, approximately `0.236456`; `die` is `3`.
All users of the library share this state, so an intervening call advances the
same sequence. A rejected bound also consumes an update, as specified above.
