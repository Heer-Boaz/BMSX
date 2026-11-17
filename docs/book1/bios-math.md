# BIOS math library {#sec-bios-math}

The BIOS math library supplies numeric operations, angular functions and a shared pseudorandom generator. Its `math` Table contains twenty-five callable entries and four numeric constants. Numbers have Integer and binary32 Float subtypes; a function preserves the input scale unless its definition states a unit or representation conversion.

## Calling the library {#sec-bios-math-calling-the-library}

The standard BIOS environment supplies `math` as a Table of functions and
constants. Call its functions directly. The separate named import `math/sin`
uses turn-phase words and integer Q16 results; the ordinary trigonometric
functions use radians and unscaled Numbers.

Integers and Floats are distinct Number subtypes. A function preserves the
input scale unless its entry specifies a unit conversion. Register-word
conversion follows the [CPU rules](cpu.md#sec-cpu-values-and-numeric-instructions).

Missing fixed parameters arrive as nil and surplus arguments are discarded.
`min` and `max` receive a variable argument tail, including its nil positions.
The following entries state the returned count before caller result
adjustment.

## Numeric notation {#sec-bios-math-numeric-notation}

The formulas in this chapter use these explanatory operations:

- **`D(a, b)`** means BLua `a // b`, with the Integer and Float rules of the
  CPU reference.
- **`T(x)`** means the mathematical value of `x` truncated toward zero; it is
  not an additional public function.
- **`M(a, b)`** means BLua `a % b`, with the Integer and Float rules of the
  CPU reference.

Unless an entry states otherwise, an arithmetic parameter must be a Number.
Strings require an explicit `tonumber` conversion. Integer overflow wraps;
Float arithmetic rounds to binary32. NaN is unordered and the Integer zero and
both Float zero signs compare equal. See [numeric instructions](cpu.md#sec-cpu-values-and-numeric-instructions).

These rules apply at each operation in a written formula. They do not turn a
mathematical description of a word operation into an additional public call.

## Constants {#sec-bios-math-constants}

| Field | Numeric value | Meaning and limits |
|------------------|-----------------------------------------------|-----------------------------------|
| `math.huge` | Positive infinity, initialized by `1.0 / 0.0` | A numeric infinity, not a maximum finite number or an argument validator. |
| `math.mininteger` | Integer −2147483648, word `80000000H` | The least Integer. |
| `math.maxinteger` | Integer `2147483647` | The greatest Integer. |
| `math.pi` | Float with binary32 bits `40490FDBH` | Approximately 3.1415927410125732 radians per half turn. |

These are value fields, not callable functions. They are not fixed-point constants, register words, or precision metadata. There is no exported NaN constant among the fields covered here, although several operations can produce numeric NaN.

## `math.abs(value)` {#sec-bios-math-mathabsvalue}

Returns one Number of the input subtype. For an Integer, the result is its
magnitude in 32-bit arithmetic: the minimum Integer wraps to itself. A Float
returns its magnitude, including positive zero for either zero sign, positive
infinity for either infinity, and NaN for NaN. A non-Number raises an error.

## `math.floor(value)` {#sec-bios-math-mathfloorvalue}

Returns one Number, rounded toward negative infinity. If the input is an
Integer, it is returned unchanged. If a finite Float's rounded result fits in
an Integer, the result is that Integer; otherwise it is a Float. NaN and
infinities remain Floats. A non-Number raises an error.

## `math.ceil(value)` {#sec-bios-math-mathceilvalue}

Returns one Number, rounded toward positive infinity, with the same subtype,
range and non-Number rules as `math.floor`.

## `math.round(value)` {#sec-bios-math-mathroundvalue}

Returns one Number rounded to the nearest integral value, with exact halfway
values rounded away from zero. If the input is an Integer, it is returned
unchanged. A finite Float whose rounded result fits in an Integer produces an
Integer; otherwise it produces a Float. NaN and infinities remain Floats.
A non-Number raises an error.

## `math.fmod(left, right)` {#sec-bios-math-mathfmodleft-right}

Returns the remainder of division with the quotient truncated toward zero.
A nonzero remainder has the dividend's sign. Two Integers produce an Integer;
Integer division by zero raises an error, and `math.fmod(0x80000000, -1)` is
Integer zero. Otherwise operands are converted to Float and the result is a
Float. A Float zero divisor or an infinite dividend produces NaN; a finite
Float dividend and an infinite divisor produce the dividend. A non-Number
raises an error.

## `math.modf(value)` {#sec-bios-math-mathmodfvalue}

Returns two Numbers: the value truncated toward zero, then its fractional
remainder. For an Integer input, the first result is the original Integer and
the second is Float positive zero. For a finite Float, the first result is an
Integer when its value is in Integer range, otherwise a Float; the second is a
Float. A whole Float has a positive-zero remainder. Either infinity returns
itself followed by Float positive zero. NaN returns two NaNs. A non-Number
raises an error.

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

Returns an Integer unchanged. A finite Float with an exact integral value in
the signed 32-bit Integer range produces the corresponding Integer. Every
other value produces nil; neither a fraction nor a numeric String is rounded
or parsed.

## `math.type(value)` {#sec-bios-math-mathtypevalue}

Returns `"integer"` for an Integer, `"float"` for a Float, and nil for a
non-Number. This describes the stored subtype: `math.type(2.0)` is `"float"`
although `2.0 == 2` is true. NaN and both zero signs are Floats.

## `math.ult(left, right)` {#sec-bios-math-mathultleft-right}

Returns one Boolean. Each input must be an Integer or a Float with an exact
Integer value in range. Compare their 32-bit words as unsigned: for example,
`math.ult(0, -1)` is true. An input that cannot be converted raises an error.
This interpretation does not change either input's stored value.

## `math.sign(value)` {#sec-bios-math-mathsignvalue}

Returns Integer `1` for a Number greater than zero, Integer `-1` for a Number
less than zero, and Integer `0` for either zero or NaN. The two infinities
return their respective signs. A non-Number raises an error.

## Execution cost and library bindings {#sec-bios-math-execution-cost-and-library-bindings}

Elementary operations execute their stated arithmetic and calls. `min` and
`max` make one comparison per tail argument and repeatedly forward the tail
through `select`; selecting one final result leaves those preceding calls
in place. For `n` ordinary positive selector positions, the selected suffixes
contain `n + (n - 1) + ... + 1` values in total.

The primitive surcharges are one cycle for `type`, `math.type`,
`math.tointeger` or `select`, and two for
`error`, in addition to executed BIOS instructions and ordinary calls. Use
[CPU cycle accounting](cpu.md#sec-cpu-cycle-accounting-and-execution-boundaries) when
budgeting a complete operation.

Reassigning a Math field leaves the library's saved numeric operations and
constants unchanged. `min` and `max` read current `select` and `error`. Their entries describe the
installed [base functions](bios-base.md#sec-bios-base).

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
earlier. For word conversion, bit masks and shifts, see
[Bitwise operations and shifts](cpu.md#sec-cpu-bitwise-operations-and-shifts).
The formulas specify the approximations and their operation order.
These functions convert Integer inputs to Float before their calculations and
return Floats. Rounding follows binary32 arithmetic at each step. A nonnumeric
required argument raises an error; numeric text requires explicit conversion.

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
is preserved, infinities retain their sign, and NaN produces NaN. A
nonnumeric argument raises an error.

### Sine, cosine and tangent {#sec-bios-math-sine-cosine-and-tangent}

These functions accept radian-scale Numbers and return dimensionless binary32
approximations. They do **not** convert their arguments to 32-bit phases or
quantize their results to Q16. Small angles therefore retain their floating-point
scale: `math.sin(0.000001)` is nonzero.

Argument reduction covers the full finite binary32 range. Large angles are
not reduced by taking a remainder against a single rounded `2*pi` constant.

| Input | `math.sin` | `math.cos` | `math.tan` |
|---|---|---|---|
| Float `+0` | Float `+0` | Float `1.0` | Float `+0` |
| Float `-0` | Float `-0` | Float `1.0` | Float `-0` |
| NaN or either infinity | NaN | NaN | NaN |

The result is a binary32 approximation. For example, `math.pi / 2` is a
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
| Otherwise | Float positive zero. |


The result uses radian scale. A supplied `false` is not the nil form and
raises an error. Numeric NaN in the two-value form is handled by the
self-inequality checks. With numerical zero axes, the last row returns
Float positive zero regardless of either zero sign. These
polynomial and branch rules also determine results at infinite arguments;
the approximation is not a correctly rounded `atan2` operation.

The other inverse functions use retained private operations:

```text
math.asin(value): atan(value, sqrt(1 - (value * value)))
math.acos(value): h - asin(value)
```

Their results are in radians. Numerical inputs outside `[-1, 1]` produce NaN
through the square root and angle calculation, rather than an explicit domain
error. Missing or nonnumeric inputs raise an error.
The inverse-sine calculation includes the square root's normalization and
refinements; inverse-angle work is therefore not uniformly fixed. No uniform
inverse-trigonometric accuracy or result-range guarantee is specified here.

### Square root {#sec-bios-math-square-root}

`math.sqrt(value)` converts a Number to Float, first returns NaN for
`value < 0`, then returns `value` unchanged if it equals zero or positive
infinity. Consequently negative infinity produces NaN, positive infinity is
preserved, and either Float zero sign is preserved. Integer zero produces
Float positive zero. A non-Number raises an error.


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
magnitude. NaN skips both loops and produces NaN during refinement arithmetic.
The eight refinements and the displayed scaling
specify the approximation; the executed normalization path determines its
variable part of the cycle count.


### Natural exponential {#sec-bios-math-natural-exponential}

`math.exp(value)` approximates the natural exponential. Its initial tests are
ordered:

| Condition | Result |
| --- | --- |
| `value ~= value` | NaN |
| `value > 88.72283935546875` | Positive infinity. |
| `value < -103.972076416015625` | Float positive zero. |

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
series updates, but the scaling work varies. Nonnumeric input raises an error.

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
`ln2` as the exponential. NaN skips normalization and produces NaN through
the arithmetic. A nonnumeric input raises an error.

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
raises an error; only nil selects the natural-log form.

The divisions can produce infinities, signed zeros or NaN. Natural
normalization depends on input magnitude, followed by 15 series updates;
the general-base branch may perform normalization again for the base. The
cycle count depends on the selected calculation.

All decimal constants above are rounded to their stored Number values.

## Random numbers {#sec-bios-math-random-numbers}

### `math.random([lower [, upper]])` → Number {#sec-bios-math-mathrandomlower-upper-number}

With no bound, advance the generator once and return one Float in **[0, 1)**.
With one bound, return an Integer in `[1, lower]`. With two bounds, return an
Integer in `[lower, upper]`. Both endpoints are included. Supplied bounds are
Integers or Floats with an exact Integer value in range; a nonnumeric,
fractional or out-of-range bound raises an error. A one-bound upper limit less
than one or a two-bound interval with `upper < lower` also raises an error.
A failed call does not advance the generator.

An omitted final bound arrives as nil. `random()` and `random(nil, upper)`
select the unbounded form; `random(lower, nil)` selects the one-bound form.
False is not nil and does not select an omitted-argument form.

For the unbounded form, let `s` be the new 32-bit state, interpreted as an
unsigned word. The result is the Float `(s >> 8) * 2^(-24)`, where `>>` is a
logical word shift. This calculation uses the high 24 bits and has exact
binary32 results from zero through `1 - 2^(-24)`.

For a bounded form, let `lo` and `hi` be the selected Integer endpoints, and
let `width = hi - lo + 1` be calculated mathematically, without 32-bit wrap.
The returned Integer is:

```text
lo + trunc((s * width) / 2^32)
```

The product and division in this definition are exact integer operations;
`width` can be as large as `2^32`. This specifies the mapping without
requiring a Float conversion. Each bounded call advances the generator once.
The mapping does not promise that every value is equally frequent over a
finite series of calls.

### `math.randomseed([seed])` → nil {#sec-bios-math-mathrandomseedseed-nil}

Returns exactly one nil. With an explicit seed, the argument must be an
Integer or a Float with an exact Integer value in range; its 32 bits replace
the generator state. A nonnumeric, fractional or out-of-range seed raises an
error without changing that state. Seeding does not advance the generator.

If the seed is nil, including an omitted argument, the BIOS reads the system
`TIME_MS` word and copies its 32 bits into the generator state. This is console
time, not a civil clock or an entropy source. See
[[system services](system.md#sec-system)]{.content-visible when-format="html"}[Book I, Chapter 12]{.content-visible when-format="pdf"}.

### Generator state and update {#sec-bios-math-generator-state-and-update}

The public bindings `math.random` and `math.randomseed` use one shared 32-bit
state word, initialized to `12345678H` during BIOS startup. Each generation
step reads the old word and keeps the low 32 bits of

```text
old * 1664525 + 1013904223
```

as the new state. This is wrapping word arithmetic. After seeding zero, the
next state is `3C6EF35FH` and the next unbounded Float is exactly
`3960563 / 16777216`. Seeding replaces the same state; all callers advance
and seed this one stream.


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
