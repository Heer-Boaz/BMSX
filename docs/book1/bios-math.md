# BIOS math library

The BIOS math library supplies numeric operations, angular functions and a shared pseudorandom generator. Its `math` Table contains twenty-five callable entries and four numeric constants. Numbers use binary64 arithmetic; a function preserves the input scale unless its definition states a unit or representation conversion.

## Availability and dependencies

The BIOS initializes `base`, then `os`, and installs the returned math module as the global `math`. Math-module initialization also loads the radian trigonometry module, even when only an elementary operation will be used. The elementary operations below do not call its trigonometric functions.

`math` is an ordinary table. Its entries contain function values or numeric constants. Several functions call private functions retained by the module: `fmod` and `modf` use private truncation; `tointeger` uses private truncation and the retained infinity constant; `math.type` uses the retained `tointeger` function. Changing `math.tointeger`, for example, does not change the function called by `math.type`.

The bodies of `tointeger` and `math.type` look up the public global `type`. The bodies of `min` and `max` look up the public globals `select` and `error`. Their behavior below assumes the initialized BIOS definitions of those globals; rebinding them is not a math-local operation. See [BIOS Base](bios-base.md) for those public dependencies.

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
pseudocode, not BLua source listings. The programming examples below use
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

These functions accept radian-scale Numbers and return dimensionless binary64
approximations. They do **not** convert their arguments to 32-bit phases or
quantize their results to Q16. Small angles therefore retain their floating-point
scale: `math.sin(0.000001)` is nonzero.

The BIOS reduces an argument to a nearby multiple of pi/2 and evaluates floating
polynomials on the remaining angle. The remainder has separate leading and tail
components to retain cancellation information. Large finite angles use a
multiword 2/pi reduction covering the binary64 exponent range, rather than a
remainder against a single rounded `2*pi` constant.

| Input | `math.sin` | `math.cos` | `math.tan` |
|---|---|---|---|
| `+0` | `+0` | `1` | `+0` |
| `-0` | `-0` | `1` | `-0` |
| NaN or either infinity | NaN | NaN | NaN |

These are approximations, not promises of correctly rounded real functions.
A rounded Number such as `math.pi / 2` is not an exact-real tangent pole; the
computed tangent can therefore be large and finite. Work depends on argument
magnitude and cancellation. There is no fixed whole-call cycle count.

The separately named BIOS import `require('math/sin')` is a different interface:
it accepts a **32-bit turn-phase word** and returns an **integer Q16 sine**.
A phase of `0x40000000` means one quarter-turn and returns `65536`, not `1`.
That primitive retains its quarter-wave lookup and interpolation; the three
ordinary radian functions do not call it.

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

<a id="complete-program-math-operations"></a>

## Programming examples

### Convert an angle and form an offset

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

### Repeat a pseudorandom sequence

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
