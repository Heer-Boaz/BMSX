# CPU finite Number text conversion: frozen source facts

- Revision inspected: `5a5a26e15e` (root supplied baseline `5a5a26e15`).
- Scope: central mirrored number formatters, CPU scalar-value-to-string consumers, immediate `CONCAT`/`CONCATN` consumers only.
- Evidence class: read-only source inspection. No outputs executed by this extractor; no tests run; no repository files edited.
- Mirror disposition below means source-structural agreement only, not a claim of empirical parity for every finite Number.
- Owner disagreement found in inspected scope: none. Any empirical or uninspected disagreement remains outside this sheet.

## Fixed formatter facts

| ID | Fact | One primary source range | Paired mirror disposition |
| --- | --- | --- | --- |
| NF01 | The default precision constant is **6**. This is not a promise of six printed decimal places or six visible digits. | `machine/ts/common/number_format.ts:10-13` | Agrees: `machine/cpp/common/number_format.h:11-14` (`kPrecision = 6`). |
| NF02 | The digit writer constructs exactly six base-10 digit characters from an integer, taking repeated remainder-by-10 and integer division. | `machine/ts/common/number_format.ts:56-64` | Agrees: `machine/cpp/common/number_format.h:57-62`; TS uses `Math.floor(num / 10)`, C++ unsigned integer division. |
| NF03 | A zero input bypasses normalization; positive zero prints `0`, negative zero prints `-0`. | `machine/ts/common/number_format.ts:77-80` | Agrees: `machine/cpp/common/number_format.h:64-67`; TS uses `Object.is`, C++ `std::signbit`. |
| NF04 | Nonzero negative inputs are formatted by positive magnitude with a single leading `-`; nonnegative inputs have no leading `+`. | `machine/ts/common/number_format.ts:81-87` | Agrees: `machine/cpp/common/number_format.h:68-84`. |
| NF05 | An exact integer magnitude strictly below `1000000` takes a decimal integer shortcut rather than the normalization/rounding path. | `machine/ts/common/number_format.ts:84-89` | Agrees: `machine/cpp/common/number_format.h:70-86`; TS converts the integer using `toString`, C++ emits repeated decimal remainders. |
| NF06 | Normalization starts at exponent zero. Magnitudes at least 10 are repeatedly multiplied by decimal inverse-power table entries, increasing the decimal exponent, followed by multiplication by `0.1` while still at least 10. | `machine/ts/common/number_format.ts:27-40` | Agrees: `machine/cpp/common/number_format.h:28-41`; same ordered table traversal and arithmetic. |
| NF07 | Magnitudes below 1 are repeatedly multiplied by decimal power table entries, decreasing the decimal exponent, followed by multiplication by `10` while still below 1. | `machine/ts/common/number_format.ts:41-53` | Agrees: `machine/cpp/common/number_format.h:42-54`; same ordered table traversal and arithmetic. |
| NF08 | On the normalized path the computed normalized Number is multiplied by `100000`, then passed to the rounding helper. Thus the rounding subject is the **computed normalized/scaled value**, not the original input's mathematical decimal expansion. | `machine/ts/common/number_format.ts:91-93` | Agrees: `machine/cpp/common/number_format.h:88-91`. |
| NF09 | The rounding helper rounds its nonnegative computed input down when its computed fractional part is below `0.5`, up when above `0.5`, and to the even integer when exactly `0.5`. | `machine/ts/common/number_format.ts:15-25` | Agrees: `machine/cpp/common/number_format.h:16-26`; TS floor and C++ positive unsigned conversion form the integer base. |
| NF10 | A rounded digit integer of `1000000` is replaced by `100000` and increases the decimal exponent by one **before notation selection**. | `machine/ts/common/number_format.ts:94-98` | Agrees: `machine/cpp/common/number_format.h:92-95`. |
| NF11 | Fixed notation is selected exactly when the post-carry exponent is at least `-4` and less than `6`; all other exponents select scientific notation. These are exponent tests after normalization and rounding, not direct comparisons against the original Number. | `machine/ts/common/number_format.ts:100-104` | Agrees: `machine/cpp/common/number_format.h:97-107`; C++ mutates `exp10` in place, TS names the post-carry value `adjustedExp`. |
| NF12 | In fixed notation the decimal point position is exponent plus one. Positive positions place digits before the point; the point is inserted only if the position is below the six-digit precision. | `machine/ts/common/number_format.ts:103-114` | Agrees: `machine/cpp/common/number_format.h:106-123`. |
| NF13 | Fixed notation for decimal positions zero or below starts with `0.`, inserts the required leading fractional zeros, and then appends the six-digit buffer. | `machine/ts/common/number_format.ts:115-121` | Agrees: `machine/cpp/common/number_format.h:124-137`. |
| NF14 | Fractional trailing zeros are removed, and if all fractional digits disappear, the decimal point is removed as well. Integer trailing zeros before the decimal point are not removed. | `machine/ts/common/number_format.ts:66-75` | Agrees: inline trimming in `machine/cpp/common/number_format.h:114-121` (same operation is also repeated in C++'s other notation branches). |
| NF15 | Scientific mantissas begin with the first digit, followed by a decimal point and remaining five digits, then undergo fractional-zero/point trimming. | `machine/ts/common/number_format.ts:124-128` | Agrees: `machine/cpp/common/number_format.h:142-153`. |
| NF16 | Scientific exponents use lowercase `e`, always include `+` or `-`, and use two exponent digits when the absolute exponent is below 100; three digits are emitted otherwise. The two-digit case includes a leading zero for single-digit exponents. | `machine/ts/common/number_format.ts:129-141` | Agrees: `machine/cpp/common/number_format.h:155-170`. |
| NF17 | The central default formatter accepts only the value; it has no format string, precision, width, padding, or notation-selection argument. | `machine/ts/common/number_format.ts:77-77` | Agrees: `machine/cpp/common/number_format.h:176-178`. |

## Scalar/concatenation boundary facts

| ID | Fact | One primary source range | Paired mirror disposition |
| --- | --- | --- | --- |
| NC01 | CPU Number-to-string delegates finite Numbers to the central formatter. Nonfinite Numbers are handled before delegation: NaN becomes `nan`, negative infinity becomes `-inf`, positive infinity becomes `inf`. | `machine/ts/machine/cpu/value.ts:190-196` | Agrees: `machine/cpp/machine/cpu/value.cpp:24-29`; TS recognizes nonfinite via `n-n !== 0`, C++ uses `std::isfinite`/`std::isnan`. |
| NC02 | `valueToString` routes Number values through the scalar-value conversion path. | `machine/ts/machine/cpu/value.ts:170-179` | Agrees: `machine/cpp/machine/cpu/value.cpp:32-35`; C++ calls `appendValueString`, whose Number branch is NC01. |
| NC03 | CPU `CONCAT` calls the ordinary scalar-value conversion for each operand; it supplies no configurable formatting options. | `machine/ts/machine/cpu/cpu.ts:2630-2638` | Agrees: `machine/cpp/machine/cpu/cpu_dispatch.inl:281-284`. |
| NC04 | CPU `CONCATN` concatenates the ordinary scalar-value conversions of its selected registers; it supplies no configurable formatting options. | `machine/ts/machine/cpu/cpu.ts:2643-2653` | Agrees: `machine/cpp/machine/cpu/cpu_dispatch.inl:298-302`. |

## Concrete code derivations (not executed by this extractor)

Each row is a derivation from the cited branch, **not a measured output**.

| ID | Derived example or boundary | One primary source range | Paired mirror disposition |
| --- | --- | --- | --- |
| ND01 | Inputs `0` and `-0` produce `0` and `-0`, respectively. | `machine/ts/common/number_format.ts:77-80` | Agrees: `machine/cpp/common/number_format.h:64-67`. |
| ND02 | Exact integer input `999999` produces `999999`; input `-999999` produces `-999999`. Both are below the strict integer-shortcut limit. | `machine/ts/common/number_format.ts:81-89` | Agrees: `machine/cpp/common/number_format.h:68-86`. |
| ND03 | Given post-carry exponent `-4` and buffer `100000`, fixed notation plus trimming produces `0.0001`; exponent `-5` with that buffer produces `1e-05`. This is a boundary-state derivation, not a claim that every original Number near the threshold has a particular computed exponent. | `machine/ts/common/number_format.ts:103-141` | Agrees: `machine/cpp/common/number_format.h:106-170`. |
| ND04 | Given post-carry exponent `5` and buffer `100000`, fixed notation produces `100000`; exponent `6` with that buffer produces `1e+06`. | `machine/ts/common/number_format.ts:103-141` | Agrees: `machine/cpp/common/number_format.h:106-170`. |
| ND05 | At the rounding-helper boundary, computed input `123456.5` rounds to `123456` (even base); computed input `123457.5` rounds to `123458` (odd base). These are helper inputs, **not original Number formatter inputs**. | `machine/ts/common/number_format.ts:15-25` | Agrees: `machine/cpp/common/number_format.h:16-26`. |
| ND06 | A computed rounded digit integer `1000000` carries to buffer integer `100000` and exponent plus one; therefore an exponent-5 pre-carry state crosses into exponent-6 scientific notation. | `machine/ts/common/number_format.ts:94-104` | Agrees: `machine/cpp/common/number_format.h:92-107`. |
| ND07 | Scientific exponent states `+6`, `-5`, and `-324` spell their exponent suffixes `e+06`, `e-05`, and `e-324`. | `machine/ts/common/number_format.ts:129-141` | Agrees: `machine/cpp/common/number_format.h:155-170`. |

## Explicit gaps / exclusions

- No claim that the algorithm correctly rounds an original Number to mathematical `%.6g`: normalization arithmetic precedes the tie comparison (NF06-NF09).
- No empirical output or exhaustive finite-domain parity claim is made in this sheet. Root independently measures paired owners; those measurements are separate evidence, not extractor executions.
- No direct nonfinite-input contract is extracted for `formatNumber` itself. CPU Number conversion intercepts nonfinites (NC01); arbitrary direct nonfinite calls were not executed.
- The exact configurable formatting API (`string.format`, format specifiers, explicit precision/width/flags and their Number behavior) was **not inspected**. NF17 and NC03-NC04 establish only that the default scalar/concat path has no such options. Do not copy this default contract onto configurable formatting without its own owner extraction.
- String encoding, string-pool storage, string lengths, integer printf conversions, Number parsing, locale behavior beyond these literal emitted characters, CPU representation, runtime performance, and compiler optimization effects were not extracted.
- No architecture document, PDF, existing chapter prose, full string/printf library, tests, or runtime repair was opened or performed.

## Root exact-normalization addendum

NF18. The table stage exponent order is256,128,64,32,16,8,4,2,1. Table entries
are the fixed Number literals10^k and10^-k for those k, not a configurable
formatter or calls to POW. In the initial norm>=10 branch, at each descending
stage: if norm>=10^k, multiply norm by10^-k and add k to e. Then, while norm>=10,
multiply by0.1 and increment e. In the initial norm<1 branch: if norm<10^-k,
multiply norm by10^k and subtract k from e; then, while norm<1, multiply by10
and decrement e. Magnitudes initially in[1,10) skip both branches. Each step
uses ordinary Number arithmetic, so this is not exact real-number decimal
normalization. Primary `machine/ts/common/number_format.ts:11–13,27–53`;
mirrored `machine/cpp/common/number_format.h:12–14,28–54`; both freshly read by
root before this addendum. This fills the concrete stage-order fact needed
for a reproducible rounding description, without introducing an application
encoder/helper or claiming ideal original-input decimal rounding.
