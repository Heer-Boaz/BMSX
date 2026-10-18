# BIOS math library

The installed `math` Table contains twenty-five callable entries and four numeric constants. This chapter separates function contracts from the finite observations of a complete cartridge.

## Availability and dependencies

The BIOS initializes `base`, then `os`, and installs the returned math module as the global `math`. Math-module initialization also loads the sine module, even when only an elementary operation will be used. None of the elementary operations in this section calls that imported sine function.

`math` is an ordinary table. Its entries contain function values or numeric constants. Several functions call private functions retained by the module: `fmod` and `modf` use private truncation; `tointeger` uses private truncation and the retained infinity constant; `math.type` uses the retained `tointeger` function. Changing `math.tointeger`, for example, does not change the function called by `math.type`.

The bodies of `tointeger` and `math.type` look up the public global `type`. The bodies of `min` and `max` look up the public globals `select` and `error`. Their behavior below assumes the initialized BIOS definitions of those globals; rebinding them is not a math-local operation. See [BIOS Base](bios-base.md) for those public dependencies.

### Math source use

The installed `math.floor` closure returns `value // 1`, but cartridge source policy rejects recognized references to `math.floor` regardless of the argument or arithmetic purpose. Use `value // 1` directly for unit flooring in cartridge source. The [known-call minimum check](blua-programs.md#known-call-argument-diagnostics) rejects direct `math.abs()` with `math.abs expects 1 argument, but 0 were provided.` Missing-parameter behavior applies only when execution reaches a call: `pcall(math.abs)` reaches the call without forwarded arguments and returns `true, nil`.

## Numbers, arguments, and formulas

There is one numeric kind, using binary64 arithmetic, rather than separately stored integer and floating-point subtypes. A result described as an integer component or classified as `"integer"` is still a number. The operations below do not encode fixed-point values or register words unless a word conversion is explicitly stated. See [values and numeric instructions](cpu.md#values-and-numeric-instructions).

A missing fixed parameter receives `nil`. Surplus arguments to a fixed-arity function are ignored. Only `min` and `max` retain a variable argument tail, including explicit `nil` values. These call rules do not add an automatic arity fault. The result counts below describe the values returned by the function, before any adjustment by its caller; one `nil` result is not an empty return. See [calls, closures, globals, and tables](cpu.md#calls-closures-globals-and-tables).

These formulas use three pieces of notation, not additional public `math` entries:

- **`D(a, b)`**, the numerical operation performed by `a // b`: compute the binary floating-point quotient `q = a / b`; truncate `q` toward zero to obtain `t`; return `t - 1` if `t > q`, otherwise return `t`. This path has no zero-divisor, finite-value, range, or integer-word conversion branch. The equation, rather than ideal real-number floor division at every magnitude, defines the operation used here.
- **`T(x)`**, the module's private truncation: if `x < 0`, return `-D(-x, 1)`; otherwise return `D(x, 1)`. For ordinary finite numeric values this truncates toward zero. It is not an integer-word encoder.
- **`M(a, b)`**, the numerical operation performed by `a % b`: obtain the truncation-based floating remainder `r` from the remainder operation itself, not by evaluating the BIOS `fmod` expression below. If `r > 0` and `b < 0`, or if `r < 0` and `b > 0`, return `r + b`; otherwise return `r` unchanged. There is no zero-divisor or non-finite fault branch and no zero-sign normalization.

Arithmetic in these expressions does not parse strings or call `tonumber`. A non-number entering an arithmetic operation supplies numeric NaN, not its printed numeric interpretation, and there is no argument-type fault on that arithmetic path. Comparisons between a non-number and numeric zero are false. More generally, ordering supports number/number and string/string pairs; other kind pairings are false rather than invoking a comparison metamethod or raising a mixed-type ordering fault. Numeric NaN is unordered, the two zero signs compare equal, and numeric equality does not equate values of different kinds.

These operator rules matter independently of a function's name. In particular, `fmod` uses division, private truncation, multiplication, and subtraction—not `%`; `ult` uses `%`, not an integer-word unsigned-comparison instruction. For the operator and call boundaries, see [BLua operators and instruction costs](cpu.md#blua-operators-and-instruction-costs).

## Constants

| Field | Numeric value | Meaning and limits |
| --- | --- | --- |
| `math.huge` | Positive infinity, initialized by `1.0 / 0.0` | A numeric infinity, not a maximum finite number or an argument validator. |
| `math.mininteger` | `-9007199254740991` | The exported lower integer constant. It does not bound all numbers or all values accepted by `tointeger`. |
| `math.maxinteger` | `9007199254740991` | The exported upper integer constant. The pair is symmetric, not the asymmetric bounds of a signed 64-bit integer. |
| `math.pi` | Literal `3.141592653589793238462643383279502884`, stored as a number | The literal spelling does not imply that every displayed decimal digit survives in binary64 precision. |

These are value fields, not callable functions. They are not fixed-point constants, register words, or precision metadata. There is no exported NaN constant among the fields covered here, although several operations can produce numeric NaN.

## `math.abs(value)`

**Arguments:** one fixed parameter. **Returns:** exactly one value.

If `value < 0`, return `-value`; otherwise return `value` itself. The latter branch neither converts nor reconstructs its argument. For ordinary numeric input this negates a negative magnitude and otherwise preserves the supplied quantity and units.

Negative infinity becomes positive infinity. Positive infinity, NaN, `+0`, and `-0` take the unchanged branch; in particular, `-0` is preserved. Every non-number also takes that branch and is returned unchanged. Thus a missing argument returns one `nil`, and a numeric-looking string remains the original string. There is no explicit type fault or numeric-string conversion.

## `math.floor(value)`

**Arguments:** one fixed parameter. **Returns:** exactly one number.

Return `D(value, 1)`. No comparison with the integer constants or conversion to a register word occurs. The operation chooses a whole-number portion at unit spacing in the supplied numeric scale.

Either infinity retains its sign, NaN produces NaN, and either numeric zero retains its sign. A missing or non-number argument, including a numeric-looking string, produces numeric NaN through the arithmetic path, not `nil` or an argument-type fault.

## `math.ceil(value)`

**Arguments:** one fixed parameter. **Returns:** exactly one number.

Return `-D(-value, 1)`. No comparison with the integer constants or conversion to a register word occurs. Like `floor`, this operates at unit spacing in the supplied numeric scale.

Either infinity retains its sign, NaN produces NaN, and either numeric zero retains its sign. A missing or non-number argument produces numeric NaN; numeric strings are not parsed and there is no explicit argument-type fault.

## `math.round(value)`

**Arguments:** one fixed parameter. **Returns:** exactly one number.

If `value >= 0`, return `D(value + 0.5, 1)`. Otherwise return `-D((-value) + 0.5, 1)`. For ordinary small finite exact-half cases this rounds halfway values away from zero. The floating addition and the `D` equation remain part of the operation: there is no all-magnitudes ideal-rounding guarantee, range correction, or overflow correction. The numeric scale is unchanged.

Both zero signs enter the nonnegative branch and produce `+0`. For negative finite input, when `D((-value) + 0.5, 1)` produces `+0`, the final negation produces `-0`; floating addition still determines whether that intermediate zero is reached. Either infinity retains its sign. NaN fails the first comparison and produces NaN through the other branch.

A missing or non-number argument also fails the comparison against zero and produces numeric NaN through the negative branch. There is no numeric-string conversion or explicit argument-type fault.

## `math.fmod(left, right)`

**Arguments:** two fixed parameters, with no defaults. **Returns:** exactly one number.

Compute `left / right`, apply `T` to that quotient, multiply the result by `right`, and subtract that product from `left`:

```text
left - (T(left / right) * right)
```

This is not `%`, nor a call to `math.modf`. It uses the supplied numerical scale without angle, fixed-point, or integer-word conversion. There is no divisor, type, finite-value, or integer-range check.

A zero divisor, either infinity operand, or either NaN operand leads to numeric NaN through this equation. Even finite operands need not yield a finite mathematical remainder: division can overflow before truncation, and no replacement algorithm repairs it. Either missing or non-number operand likewise produces numeric NaN, not `nil` or an argument-type fault.

For a numeric zero `left` and a finite nonzero `right`, the subtraction produces `+0`, including when `left` was `-0`. The function does not preserve the numerator's zero sign by a separate rule.

## `math.modf(value)`

**Arguments:** one fixed parameter. **Returns:** exactly two numbers: integer component first, residual component second.

Compute `integer = T(value)` once, then return:

```text
integer, value - integer
```

For ordinary finite numeric input, the first component truncates toward zero and the second is the floating residual from that component. Negative inputs are not decomposed into a floor plus a positive fraction. Both components retain the supplied numeric scale; neither is a separate integer representation, and there is no gate at `mininteger` or `maxinteger`.

Positive infinity returns positive infinity followed by NaN; negative infinity returns negative infinity followed by NaN. NaN returns two NaNs. For either zero sign, the first result preserves that sign and the second is `+0`. Missing or non-number input returns two numeric NaNs, not two nils and not an argument-type fault.

## `math.min(first, ...)`

**Arguments:** one fixed parameter followed by every remaining argument. **Returns:** exactly one original selected argument, unless the installed `error` raises a fault.

If `first == nil`, call `error` with the literal string:

```text
min expects at least one argument.
```

This rejects both an omitted first argument and an explicit first `nil`, even if later arguments are nonnil. Otherwise, initialize the selected result to `first`. Obtain the tail count with `select('#', ...)`, visit tail indices from 1 through that count, and assign the first result of each `select(index, ...)` to the candidate. Replace the selected result only when `candidate < result`. Return the selected argument unchanged, without conversion or unit normalization.

Strict comparison retains the earlier selected value on a tie, including equal zero values with different signs. Numeric infinities participate in numeric ordering. A later NaN cannot replace a numeric result; an initial NaN remains selected. String/string candidates use string ordering and return an original string, not a converted number. This section does not specify a universal ordering for every malformed or raw-byte string state.

A candidate incomparable with the selected result is ignored. An initial number therefore ignores non-number candidates, and an initial string ignores non-string candidates. An initial nonnil boolean, table, function, or thread cannot be replaced by these comparisons. Tail `nil` values count as arguments but cannot replace the nonnil result. There is no per-tail type check, type homogenization, or comparison-metamethod call.

With the initialized `error`, the supplied message string is the raised value and no return follows. It is not a math-specific argument-number diagnostic or a level-adjusted message. See [BIOS Base](bios-base.md) for `select` and `error`, and [coroutines](coroutines.md) for error interception. The repeated work in this variadic scan is described below.

## `math.max(first, ...)`

**Arguments:** one fixed parameter followed by every remaining argument. **Returns:** exactly one original selected argument, unless the installed `error` raises a fault.

If `first == nil`, call `error` with the literal string:

```text
max expects at least one argument.
```

Otherwise, perform the same tail-count and `select(index, ...)` scan as `min`, but replace the selected result only when `candidate > result`. Return the selected argument unchanged.

The first-`nil` rejection, strict-tie preservation, numeric NaN and infinity behavior, string comparison scope, incomparable-tail behavior, and literal raised-value distinction are the same as for `min`. A single nonnil argument is returned as supplied. In particular, an initial NaN remains selected, equal zero values retain the earlier sign, explicit tail nils count but do not replace the result, and an initial nonnil boolean, table, function, or thread remains selected. There is no numeric conversion or unit normalization.

## `math.tointeger(value)`

**Arguments:** one fixed parameter. **Returns:** exactly one number or exactly one `nil`.

First reject the value with one `nil` if any of these short-circuit conditions holds, in this order:

1. The installed public `type(value)` is not `"number"`.
2. `value ~= value`.
3. `value == huge`.
4. `value == -huge`.

Here `huge` is the module's retained positive infinity. Missing and non-number arguments, including numeric-looking strings, take the first rejection branch; NaN is rejected by its self-inequality; either infinity is rejected by its equality condition. These are nil results, not argument-type faults.

For a value that passes, compute `integer = T(value)`. Return that number only if `integer == value`; otherwise return one `nil`. A fractional value therefore does not expose a truncated success result.

There is no comparison against `mininteger` or `maxinteger` and no 32-bit or 64-bit integer encoding. A finite representable value is accepted whenever its `T` result equals itself, even outside those constants. Numeric `-0` is accepted and its sign is preserved by `T`. Acceptance retains the numeric scale and the single number representation; it does not establish register-word convertibility.

## `math.type(value)`

**Arguments:** one fixed parameter. **Returns:** exactly one string, `"integer"` or `"float"`, or exactly one `nil`.

If the installed public `type(value)` is not `"number"`, return one `nil`. Otherwise call the module's retained `tointeger` function. If that call returns a nonnil value, return `"integer"`; otherwise return `"float"`.

Thus missing and non-number values, including numeric-looking strings, return nil. Finite whole numeric values accepted by `tointeger`, including `-0` and accepted values outside the integer constants, classify as `"integer"`. Finite fractions, infinities, and NaN classify as `"float"`.

This is a computed classification over one numeric representation, not inspection of a stored integer subtype or proof of register-word convertibility. The public name does not recursively call itself. Replacing `math.tointeger` does not change its retained call, while rebinding the public global `type` changes its nonlocal dependency.

## `math.ult(left, right)`

**Arguments:** two fixed parameters, with no defaults. **Returns:** exactly one boolean.

Return the result of:

```text
M(left, 4294967296.0) < M(right, 4294967296.0)
```

For integer numeric inputs this compares their floating modulo-2^32 residues. It is not an unsigned comparison across the full numerical interval between `mininteger` and `maxinteger`. Fractional inputs also go through modulo directly, without integer truncation. The body has no integrality test, range test, bit mask, or word conversion.

Negative nonzero remainders are adjusted by adding the positive modulus. Zero remainders retain their remainder sign, but equal zero residues do not satisfy strict less-than. Floating arithmetic still applies; there is no all-magnitudes exact-residue repair or guarantee. There is no numeric scale conversion, and the boolean result has no numeric units.

An infinity or NaN operand produces a NaN residue and therefore `false`. A missing or non-number operand likewise yields `false`, not nil or a type/arity fault. Numeric-looking strings are not parsed.

## `math.sign(value)`

**Arguments:** one fixed parameter. **Returns:** exactly one number: literal `1`, `-1`, or `0`.

If `value > 0`, return `1`. Otherwise, if `value < 0`, return `-1`. Otherwise return `0`. There is no subtraction, division, magnitude computation, or numeric conversion.

Positive and negative infinities take their respective sign branches. Both zero signs and numeric NaN return literal `0`; a `-0` result is not preserved. Every non-number, including missing/nil and numeric-looking strings, also returns `0` because both comparisons against numeric zero are false. There is no explicit fault. The result is an unscaled dimensionless branch marker, not a quantity carrying the input's units.

## Work and execution boundaries

Apart from `min` and `max`, the routines above have bounded control flow, without input-magnitude normalization loops or per-input collection traversal in their own computation. This is not an allocation-free or fixed-cycle guarantee. `fmod` and `modf` each call private `T` once. `tointeger` calls the public `type` and reaches `T` only after its rejection guard. `math.type` calls public `type` first and, for a number, calls retained `tointeger`, which calls public `type` again.

`min` and `max` have variable work beyond their comparison count. With `n` tail arguments and ordinary positive indices within the signed 32-bit selector interval, there are `n` comparisons. However, every `select(index, ...)` forwards all `n` tail arguments again. The called selector produces the entire suffix starting at that index before the single-variable assignment retains only its first result. Across the scan, suffix production therefore handles:

```text
n + (n - 1) + ... + 1
```

values. Repeated forwarding and suffix production give quadratic data movement and work in that interval, not a linear-time implementation merely because there are `n` comparisons. String comparisons add text-dependent work.

The selector converts its numeric index to a signed 32-bit word. Negative starts are translated to `count + start + 1`; selection then walks through the tail count, appending arguments at indices at least 1 and within the supplied argument list. The ordinary positive-index explanation above is not an unbounded mathematical-vararg contract. See [BIOS Base](bios-base.md) for `select`.

A caller retaining only one result does not erase the preceding suffix work. See [calls, closures, globals, and tables](cpu.md#calls-closures-globals-and-tables).

Budget charges do not measure all of that work. The initialized `type` and `select` calls have base budget charge 1, and `error` has base charge 2; their per-argument and per-result increments are zero. Those are not total costs for a `math` call, and the suffix walk remains work despite the zero per-result increment. No fixed total instruction count, cycle count, or execution-time guarantee is supplied here. See [cycle accounting and execution boundaries](cpu.md#cycle-accounting-and-execution-boundaries).

## Angles and transcendental operations

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
| `math.tan(radians)` | Ratio of the sine and cosine lookup results. |
| `math.atan(y, x)` | Approximate angle in radians; `x == nil` selects the one-value form. |
| `math.asin(value)` | Approximate inverse sine in radians. |
| `math.acos(value)` | Approximate inverse cosine in radians. |
| `math.sqrt(value)` | Approximate square root. |
| `math.exp(value)` | Approximate natural exponential. |
| `math.log(value, base)` | Approximate logarithm; `base == nil` selects the natural logarithm. |

These are fixed-parameter interfaces, not varargs. Missing fixed parameters
have value `nil`; surplus parameters are not retained. The signatures show all
fixed parameters, rather than promising acceptance of every shortened call
spelling. An explicit `nil` selects the alternate forms `math.atan(y, nil)` and
`math.log(value, nil)`; the complete program also demonstrates accepted
one-argument calls. No other parameter has a default.

The formulas below use the Number arithmetic and `D` and `T` notation defined
earlier. For word conversion, bit masks and signed right shifts, see
[Bitwise operations and shifts](cpu.md#bitwise-operations-and-shifts).
The formulas describe the actual approximations, not correctly rounded real
functions. Nonnumeric arguments follow those
arithmetic and comparison rules; numeric-looking Strings are not parsed.
These interfaces do not issue their own argument-type or domain errors.

In these formulas, `pi` is the retained BIOS Number constant, and
`h = pi * 0.5`. The constants and private operations are retained bindings:
changing public entries such as `math.pi`, `math.abs`, `math.floor`,
`math.sqrt` or `math.atan` does not redirect these internal calculations.
Names introduced below for private approximations are explanatory notation,
not additional callable interfaces.

The text blocks in this reference section are explanatory formulas and
pseudocode, not BLua source listings. The complete program below is literal
BLua source.

### Converting angular units

The conversion functions perform one multiplication:

```text
math.deg(value): value * (180 / pi)
math.rad(value): value * (pi / 180)
```

There is no magnitude reduction or fixed-point conversion. Either zero sign
is preserved, infinities retain their sign, and NaN or a nonnumeric argument
produces NaN.

### Sine, cosine and tangent

These functions use a 32-bit phase for one turn. A quarter-turn is
`Q = 0x40000000`. For each call, first calculate:

```text
s = radians * (4294967296 / (pi * 2))
```

Let `S(a)` denote the private integer sine lookup described below. The public
results are calculated as follows:

```text
math.sin(radians): S(T(s) & 0xffffffff) * (1 / 65536)
math.cos(radians): S((T(s) + Q) & 0xffffffff) * (1 / 65536)
```

For tangent, the phase is converted to a word before adding the quarter-turn:

```text
a = T(s) & 0xffffffff
u = S(a)
v = S((a + Q) & 0xffffffff)
```

If `v == 0`, `math.tan` returns negative infinity when `u < 0`, and positive
infinity otherwise. Otherwise it returns `u / v`, without first converting
both lookup results to normalized sine and cosine Numbers. A nonzero integer
denominator gives a finite result in `[-65536, 65536]`. Infinity is selected
by a zero **quantized denominator**, not by a test for an exact-real pole.

`T` discards fractional phase before wrapping. The mask retains the 32 phase
bits; it does not guarantee an unsigned Number result. In particular, cosine
adds `Q` **before** word conversion, whereas tangent adds it **after** its
first word conversion. This difference matters for nonfinite arithmetic:

| `radians` | `math.sin` | `math.cos` | `math.tan` |
| --- | --- | --- | --- |
| NaN, either infinity, or a nonnumber, including `nil` | `0` | `0` | `0` |

For sine and cosine, the nonfinite phase converts to word zero. For cosine,
the earlier addition of `Q` does not make that phase finite. Tangent instead
forms word zero first, so its denominator lookup receives a quarter-turn.
Do not substitute `math.cos(0)` for the nonnumeric cosine case.

<div class="keep-together">

The lookup uses a fixed quarter-wave table `L` with 257 word entries,
`L[0] = 0` and `L[256] = 65536`. It reflects the phase into that quarter-wave,
interpolates between adjacent entries, and applies the sign:

```text
quadrant = (a >> 30) & 3
phase = a & 0x3fffffff
```

</div>

For an odd quadrant, replace `phase` by `Q - phase`. Start with
`value = 65536`; if `phase != Q`, calculate:

```text
index = (phase >> 22) & 255
fraction = phase & 0x3fffff
base = L[index]
delta = L[index + 1] - base
value = base + ((delta * fraction) >> 22)
```

Return `0 - value` for quadrants 2 and 3, and `value` otherwise. Sine and cosine
results lie in `[-1, 1]` and are multiples of `1 / 65536`. This is table-based
linear interpolation with word arithmetic, not ideal sine or cosine. These
range and quantization bounds are not approximation-error bounds or a promise
that every value in an interval is reachable.

There is no input-magnitude reduction loop. Each lookup uses arithmetic,
branches and at most two table-word reads. Sine and cosine invoke it once;
tangent invokes it twice.

### Inverse angles

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

<div class="keep-together">

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

</div>

The result uses radian scale. A supplied `false` is not the nil form:
`math.atan(1, false)` reaches the axis branch and returns `h`. A nonnumeric
`y` in the nil form produces NaN through `P`. Numeric NaN in the two-value
form is handled by the self-inequality checks. With numerical zero axes,
the last row returns positive zero regardless of either zero sign. These
polynomial and branch rules are not an all-infinity or correctly rounded
`atan2` guarantee.

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

### Square root

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

<div class="keep-together">

and return `estimate * scale`. Positive finite values are normalized using
powers of four and a power-of-two scale. The normalization work depends on
magnitude. NaN and nonnumeric inputs skip both loops and produce NaN during
refinement arithmetic. The eight-refinement algorithm defines the
approximation; no all-input relative-error, ULP or total-cycle bound is
specified here.

</div>

### Natural exponential

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

<div class="keep-together">

The retained constants are:

```text
ln2 = 0.69314718055994530942
inv_ln2 = 1.44269504088896340736
```

</div>

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
reciprocal is taken. A zero result therefore need not have come from the
explicit underflow cutoff. Do not rely on accurate subnormal outputs or a
uniform approximation-error or correct-rounding guarantee.

<div class="keep-together">

### Logarithms

Use `math.log(value, nil)` for the natural logarithm, or supply a base. The
natural logarithm approximation `N(v)` first tests, in order:

| Condition | Result |
| --- | --- |
| `v < 0` | NaN |
| `v == 0` | Negative infinity. |
| `v == positive infinity` | Positive infinity. |

</div>

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

<div class="keep-together">

Then calculate:

```text
z = (mantissa - 1) / (mantissa + 1)
z2 = z * z
term = z
sum = term
```

</div>

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
The general-base branch does not validate bases: one, zero, negative values,
infinities and NaN all follow the displayed calculation. In particular,
`N(1)` is zero, so division for base one is by zero, and `math.log(1, 1)`
produces NaN. A supplied `false` is not the natural-log default; like other
nonnumeric bases, it produces NaN through `N(base)`.

The divisions can produce infinities, signed zeros or NaN. Natural
normalization depends on input magnitude, followed by 15 series updates;
the general-base branch may perform normalization again for the base. There
is no fixed service time or uniform accuracy bound specified here.

All decimal constants above denote their stored Number values, not a promise
that every printed decimal digit is represented exactly.

## Random numbers

### `math.random([lower [, upper]])` → Number

Returns exactly one Number on success. The function has two fixed parameters and no variable-argument parameter. An omitted fixed parameter arrives as nil. False is not nil and does not request an omitted-argument default. See [calls, closures, globals, and tables](cpu.md#calls-closures-globals-and-tables) for the call model.

Both bound-rejection branches call the current public `error` binding. The raised String behavior below assumes its installed BIOS definition.

Every call advances the shared generator **before inspecting either bound**. Consequently, an explicit bound error consumes an update, as does a call whose result is NaN.

<div class="keep-together">

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

</div>

Here `value` is the unit sample already generated. In these formulas, `trunc` denotes the private truncation operation, not an additional public function. For finite Numbers it truncates toward zero.

The unit sample lies in **[0, 1)**: zero is included and one is excluded. Its largest possible value is `1 - 2^-32`. For ordinary finite bounded inputs, the source-defined closed integer intervals are **[1, upper_int]** for one bound and **[lower_int, upper_int]** for two bounds. Both endpoints of those interval definitions are included. The formulas above remain authoritative: floating arithmetic and rounding do not support extending this description into a guarantee for every extreme Number, or a promise that every integer is sampled or equally likely.

`random(u)` and `random(u, nil)` use the one-bound branch. Fractional finite bounds are truncated, not rounded to the nearest integer. A one-bound zero, negative integer, or finite value that truncates below one takes the positive-bound error.

There are no additional local type, finite-value, integer, maximum-bound, or span checks. Nonnumeric operands—including false, Strings, and Tables—are not converted from numeric text; the reached arithmetic produces NaN rather than a local arithmetic type error. In particular, `random(false)` advances the generator and returns NaN. A NaN bound passes the less-than guard and propagates NaN through the result formula. A one-bound positive infinity produces positive infinity when the unit sample is positive, and NaN when it is zero; negative infinity takes the positive-bound error. See [values and numeric instructions](cpu.md#values-and-numeric-instructions).

### `math.randomseed([seed])` → nil

Returns **exactly one nil result**, not an empty result list. It has one fixed parameter and no variable-argument parameter.

If `seed` is nil, including an omitted parameter, the function calls the current `os.clock()` binding, multiplies that result by 1000, applies the private truncation operation, reduces it modulo `4294967296.0`, and stores it in the shared generator word. With the BIOS-defined `os.clock`, the source expression is:

```text
trunc(((*time_ms / 1000) * 1000)) % 4294967296.0
```

Here `time_ms` denotes the unsigned millisecond word sampled by the BIOS clock function. The divide-then-multiply expression is significant; it is not replaced here by a direct word value. This establishes a clock dependency, not a wall-clock or entropy guarantee. See [system services](system.md).

Otherwise, the function stores:

```text
trunc(seed) % 4294967296.0
```

An explicit seed does not use the clock. Finite seeds are truncated toward zero, reduced using positive-modulus semantics, and stored as an unsigned word. Both `-1` and `-1.9` therefore store `0xffffffff`; zero stores zero. False selects this supplied-seed branch, not the clock branch. Nonnumeric seeds, NaN, and either infinity reach a NaN modulus result and store word zero. There is no local explicit seed error.

Seeding performs no generation step or warm-up loop and returns no seed value. After seeding zero, the next unit output is exactly `1013904223 / 4294967296`.

### Generator state and update

The public bindings are `math.random` and `math.randomseed`. They use the same private four-byte word, whose declared initializer is `0x12345678`. Neither that word nor the private unit generator is returned by the Math Table.

Each generation step reads the old word and computes:

```text
((old * 1664525) + 1013904223) % 4294967296.0
```

It stores the result in the word, reads the stored unsigned word back, and divides it by `4294967296.0` to obtain the unit sample. Seeding replaces that same word. This describes shared state, not separate per-caller streams or a reset/persistence contract.

## Complete program: Math operations

This is a separate `bios_math_manual` cartridge. Save the storage listing as
`results.lua` and concatenate the five entry parts, in order, as `entry.lua`.
The [development companion](../programming/getting-started.md#build-and-inspect-math-operations)
supplies the complete tree, manifest and commands. Do not combine this entry
or `results` module with an earlier example.

The program calls all twenty-four Math functions other than `math.floor`,
reads the four constant fields, and uses `// 1` for unit flooring as required
by cartridge source policy. The `math.floor` closure itself is not called.
These are ordinary installed BIOS calls, not a cartridge math implementation.
Typed result storage follows [Memory](memory.md#typed-byte-storage-and-address-views).

### Result storage: `results.lua`

```lua
module<const>

struct bios_math_manual_result
	completed: word
	absolute: f64
	rounding: f64[6]
	fmod_value: f64
	modulo_value: f64
	integer_part: f64
	fraction_part: f64
	minimum: f64
	maximum: f64
	text_minimum: word
	abs_identity: word
	abs_text: word
	abs_missing: word
	arithmetic_nan: f64
	large_integer: f64
	fraction_rejected: word
	text_rejected: word
	classifications: word
	unsigned_wrap: word
	unsigned_fraction: word
	unsigned_equal: word
	signs: f64[3]
	abs_negative_zero: word
	floor_negative_zero: word
	ceil_negative_zero: word
	round_positive_zero: word
	modf_integer_negative_zero: word
	modf_fraction_positive_zero: word
	fmod_positive_zero: word
	min_error: word
	max_error: word
	trig: f64[6]
	angles: f64[6]
	square_root: f64
	root_negative_zero: word
	root_nan: f64
	exponentials: f64[3]
	exp_edges: f64[2]
	logarithms: f64[4]
	log_nan: f64
	trig_nonnumeric: f64[3]
	atan_false: f64
	random_seed_count: word
	random_seed_nil: word
	random_unit: f64
	random_single: f64
	random_interval: f64
	random_truncated: f64
	random_repeated: f64
	random_error: word
	random_after_error: f64
	random_two_error: word
	random_two_after_error: f64
	random_false_seed: f64
	random_false_value: f64
	random_nil_upper: f64
	integer_bounds: f64[2]
	pi: f64
	huge: f64
end

bss result: bios_math_manual_result

return { result = result }
```

Only the first entry part declares `module<entry>`. Continue the same file
through part five, preserving statement order.

### Entry 1: rounding, selection and supplied values

```lua
module<entry>

local storage<const> = require('results')
local result<const>: *bios_math_manual_result = storage.result

-- Cartridge source uses // 1 for unit flooring; math.floor is not permitted.
result.absolute = math.abs(-12.5)
result.rounding[0] = 1.75 // 1
result.rounding[1] = math.ceil(1.25)
result.rounding[2] = -1.25 // 1
result.rounding[3] = math.ceil(-1.75)
result.rounding[4] = math.round(1.5)
result.rounding[5] = math.round(-1.5)
print('Math rounding', result.absolute, result.rounding[0], result.rounding[1],
	result.rounding[2], result.rounding[3], result.rounding[4], result.rounding[5])

result.fmod_value = math.fmod(-7.5, 2)
result.modulo_value = -7.5 % 2
result.integer_part, result.fraction_part = math.modf(-3.75)
print('Math fractions', result.fmod_value, result.modulo_value,
	result.integer_part, result.fraction_part)

-- A nil tail position counts but does not replace a numeric minimum/maximum.
result.minimum = math.min(8, nil, -3, 5)
result.maximum = math.max(8, nil, -3, 5)
result.text_minimum = math.min('pear', 'apple', 'plum') == 'apple' and 1 or 0
local token<const> = { marker = 7 }
result.abs_identity = math.abs(token) == token and 1 or 0
result.abs_text = math.abs('12.5') == '12.5' and 1 or 0
local missing_ok<const>, missing_value<const> = pcall(math.abs)
result.abs_missing = missing_ok and missing_value == nil and 1 or 0
result.arithmetic_nan = '12.5' // 1
print('Math selection', result.minimum, result.maximum, result.text_minimum)
print('Math supplied values', result.abs_identity, result.abs_text,
	result.abs_missing, result.arithmetic_nan ~= result.arithmetic_nan)
print('Math missing', missing_ok, missing_value)

```

### Entry 2: classification, zero signs and errors

```lua
result.large_integer = math.tointeger(math.maxinteger + 1)
result.fraction_rejected = math.tointeger(3.75) == nil and 1 or 0
result.text_rejected = math.tointeger('3') == nil and 1 or 0
result.classifications = math.type(3) == 'integer' and math.type(3.75) == 'float'
	and math.type(math.huge) == 'float' and math.type('3') == nil and 1 or 0
result.unsigned_wrap = math.ult(-1, 1) and 1 or 0
result.unsigned_fraction = math.ult(0.5, 1) and 1 or 0
result.unsigned_equal = math.ult(4294967296, 0) and 1 or 0
result.signs[0] = math.sign(-3)
result.signs[1] = math.sign(0)
result.signs[2] = math.sign(3)
print('Math classification', result.large_integer, result.fraction_rejected,
	result.text_rejected, result.classifications)
print('Math unsigned', result.unsigned_wrap, result.unsigned_fraction,
	result.unsigned_equal)
print('Math signs', result.signs[0], result.signs[1], result.signs[2])

-- Reciprocals distinguish zero signs even when printed text does not.
local negative_zero<const> = -1 / math.huge
result.abs_negative_zero = 1 / math.abs(negative_zero) == -math.huge and 1 or 0
result.floor_negative_zero = 1 / (negative_zero // 1) == -math.huge and 1 or 0
result.ceil_negative_zero = 1 / math.ceil(negative_zero) == -math.huge and 1 or 0
result.round_positive_zero = 1 / math.round(negative_zero) == math.huge and 1 or 0
local zero_integer<const>, zero_fraction<const> = math.modf(negative_zero)
result.modf_integer_negative_zero = 1 / zero_integer == -math.huge and 1 or 0
result.modf_fraction_positive_zero = 1 / zero_fraction == math.huge and 1 or 0
result.fmod_positive_zero = 1 / math.fmod(negative_zero, 2) == math.huge and 1 or 0
print('Math modf zero reciprocals', 1 / zero_integer, 1 / zero_fraction)
print('Math zero signs', result.abs_negative_zero, result.floor_negative_zero,
	result.ceil_negative_zero, result.round_positive_zero,
	result.modf_integer_negative_zero, result.modf_fraction_positive_zero,
	result.fmod_positive_zero)

local min_ok<const>, min_error<const> = pcall(math.min, nil, 2)
local max_ok<const>, max_error<const> = pcall(math.max)
result.min_error = not min_ok and min_error == 'min expects at least one argument.'
	and 1 or 0
result.max_error = not max_ok and max_error == 'max expects at least one argument.'
	and 1 or 0
print('Math min error', min_ok, min_error)
print('Math max error', max_ok, max_error)

```

### Entry 3: angles, roots, exponentials and logarithms

```lua
-- Angles are ordinary radians; the BIOS owns the turn/lookup conversion.
result.trig[0] = math.sin(0)
result.trig[1] = math.cos(0)
result.trig[2] = math.tan(0)
result.trig[3] = math.sin(math.rad(30))
result.trig[4] = math.cos(math.rad(60))
result.trig[5] = math.tan(math.rad(45))
result.angles[0] = math.rad(180)
result.angles[1] = math.deg(math.pi)
result.angles[2] = math.atan(1)
result.angles[3] = math.atan(1, -1)
result.angles[4] = math.asin(1)
result.angles[5] = math.acos(1)
print('Math trigonometry', result.trig[0], result.trig[1], result.trig[2],
	result.trig[3], result.trig[4], result.trig[5])
print('Math angles', result.angles[0], result.angles[1], result.angles[2],
	result.angles[3], result.angles[4], result.angles[5])

result.square_root = math.sqrt(9)
result.root_negative_zero = 1 / math.sqrt(negative_zero) == -math.huge and 1 or 0
result.root_nan = math.sqrt(-1)
result.exponentials[0] = math.exp(0)
result.exponentials[1] = math.exp(1)
result.exponentials[2] = math.exp(-1)
result.exp_edges[0] = math.exp(710)
result.exp_edges[1] = math.exp(-746)
result.logarithms[0] = math.log(1)
result.logarithms[1] = math.log(8, 2)
result.logarithms[2] = math.log(100, 10)
result.logarithms[3] = math.log(0)
result.log_nan = math.log(-1)
print('Math root', result.square_root, result.root_negative_zero,
	result.root_nan ~= result.root_nan)
print('Math exponentials', result.exponentials[0], result.exponentials[1],
	result.exponentials[2], result.exp_edges[0], result.exp_edges[1])
print('Math logarithms', result.logarithms[0], result.logarithms[1],
	result.logarithms[2], result.logarithms[3], result.log_nan ~= result.log_nan)

-- Reached word conversion is not an argument-type exception or string parse.
result.trig_nonnumeric[0] = math.sin('text')
result.trig_nonnumeric[1] = math.cos('text')
result.trig_nonnumeric[2] = math.tan('text')
result.atan_false = math.atan(1, false)
print('Math nonnumeric angles', result.trig_nonnumeric[0], result.trig_nonnumeric[1],
	result.trig_nonnumeric[2], result.atan_false)

```

### Entry 4: shared random state and rejected bounds

```lua
-- Explicit seeds make this sequence independent of the clock default.
result.random_seed_count = select('#', math.randomseed(1))
result.random_unit = math.random()
result.random_single = math.random(6)
result.random_interval = math.random(-2, 2)
result.random_truncated = math.random(8.9, 8.1)
print('Math random modes', result.random_seed_count, result.random_unit,
	result.random_single, result.random_interval, result.random_truncated)
result.random_seed_nil = math.randomseed(1) == nil and 1 or 0
result.random_repeated = math.random()
print('Math random replay', result.random_seed_nil, result.random_repeated,
	result.random_repeated == result.random_unit)

-- Failed bounds consume the next draw before the protected error is returned.
local bound_ok<const>, bound_error<const> = pcall(math.random, 0)
result.random_error = not bound_ok
	and bound_error == 'random upper bound must be positive.' and 1 or 0
result.random_after_error = math.random()
print('Math random error', bound_ok, bound_error, result.random_after_error)
local interval_ok<const>, interval_error<const> = pcall(math.random, 5, 3)
result.random_two_error = not interval_ok
	and interval_error ==
		'random upper bound must be greater than or equal to lower bound.'
	and 1 or 0
result.random_two_after_error = math.random()
print('Math random interval error', interval_ok, interval_error,
	result.random_two_after_error)

-- False is a supplied seed/bound; only nil selects the missing-bound branch.
math.randomseed(false)
result.random_false_seed = math.random()
result.random_false_value = math.random(false)
result.random_nil_upper = math.random(nil, false)
print('Math random false', result.random_false_seed,
	result.random_false_value ~= result.random_false_value, result.random_nil_upper)

```

### Entry 5: constants and completion

```lua
result.integer_bounds[0] = math.mininteger
result.integer_bounds[1] = math.maxinteger
result.pi = math.pi
result.huge = math.huge
print('Math constants', result.integer_bounds[0], result.integer_bounds[1],
	result.pi, result.huge)
result.completed = 1

while true do
	halt_until_irq
end
```

<div class="keep-together">

### Ordinary observations

After normal startup, compare these twenty-four lines. Tabs separate distinct
`print` arguments; the printed Numbers use the installed text conversion.

```text
Math rounding	12.5	1	2	-2	-1	2	-2
Math fractions	-1.5	0.5	-3	-0.75
Math selection	-3	8	1
Math supplied values	1	1	1	true
Math missing	true	nil
Math classification	9.0072e+15	1	1	1
Math unsigned	0	1	0
Math signs	-1	0	1
Math modf zero reciprocals	-inf	inf
Math zero signs	1	1	1	1	1	1	1
Math min error	false	min expects at least one argument.
Math max error	false	max expects at least one argument.
Math trigonometry	0	1	0	0.499969	0.499985	1
Math angles	3.14159	180	0.785398	2.35619	1.5708	0
Math root	3	1	true
Math exponentials	1	2.71828	0.367879	inf	0
Math logarithms	0	3	2	-inf	true
Math nonnumeric angles	0	0	0	1.5708
Math random modes	1	0.236456	3	0	8
Math random replay	1	0.236456	true
```

</div>

The next two lines are shown by `print` argument so that the full error text
remains readable. Each row is one output line; a tab separates adjacent
arguments, just as in the blocks above and below.

| Argument 1 | Argument 2 | Argument 3 | Argument 4 |
| --- | --- | --- | --- |
| `Math random error` | `false` | `random upper bound must be positive.` | `0.504242` |
| `Math random interval error` | `false` | `random upper bound must be greater than or equal to lower bound.` | `0.0505436` |

The final two lines follow those two error diagnostics:

```text
Math random false	0.236068	true	0.819534
Math constants	-9.0072e+15	9.0072e+15	3.14159	inf
```

| Group | What this program establishes |
| --- | --- |
| Rounding and fractions | Unit floors use `// 1`; `ceil` and `round` use their BIOS functions. Negative `fmod` gives `-1.5`, whereas `%` gives `0.5`. `modf(-3.75)` returns `-3` then `-0.75`. |
| Selection and supplied values | Nil tail positions do not replace the numeric minimum/maximum. `abs` preserves the supplied object or String. The protected call with no forwarded argument returns `true, nil`; a numeric-looking String in arithmetic produces NaN instead of being parsed. |
| Classification and zero signs | `tointeger` accepts the represented value `9007199254740992`, beyond `maxinteger`. Rejected fractions/Strings and the four classifications have separate flags. The reciprocal observations distinguish signed zero; all seven zero-sign flags are one. |
| Text and constants | Default text prints `9.0072e+15` and `3.14159`; this is not a full-precision dump. The f64 fields retain the Number values, including exact integer constants and the larger accepted integer. |

| Group | What this program establishes |
| --- | --- |
| Trigonometry | `sin(0)`, `cos(0)` and `tan(0)` give `0,1,0`. The stored `sin(rad(30))` is `32766/65536`; `cos(rad(60))` is `32767/65536`. Their printed forms differ by one output quantum rather than both being exactly `0.5`. This is a specific lookup/phase example, not a general error bound. |
| Angle choices | Conversion gives radians for 180 degrees and degrees for pi radians. One- and two-argument atan choose different quadrants; asin and acos are also exercised. |
| Roots and exponentials | The root is three, its negative-zero input is preserved, and the negative root input produces NaN. Exponential samples include zero, positive and negative inputs plus the explicit overflow/underflow branches. |
| Logarithm options | Natural log of one, base-two log of eight and base-ten log of one hundred print `0,3,2`. Log of zero gives negative infinity; a negative input gives NaN. |
| Nonnumeric angles | The three String inputs reach the actual conversion paths and give `0,0,0`; `atan(1,false)` follows its axis branch. These are not String parsing or argument-type errors. |

| Group | What this program establishes |
| --- | --- |
| Seed and replay | The supplied-seed call returns one result. Reseeding with one returns nil and repeats the first unit sample. No clock-default seed is used. |
| Rejected bounds | Each protected bound error has consumed a draw. After replaying word one, the first rejection consumes word two and the next unit uses word three; the interval rejection consumes word four and the next unit uses word five. |
| False versus nil | False is a supplied seed and stores zero. A false bound then yields NaN after advancing, while a nil lower bound ignores its false upper bound and returns the next unit sample. |

The retained checks and ordinary playback are separate executions. Their
finite observations do not establish all-input accuracy, termination,
statistical quality, reset/persistence or a fixed cycle budget.
