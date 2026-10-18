# Independent BIOS Math actual-source review

## Packet checkpoint — 2026-10-18

Status: bounded actual-source pass complete; no owner/spec mismatch found in T01–T09. This is not final approval of public prose. Prose packet did not exist at this checkpoint. No repository file was edited; no build, cartridge execution, historical document, architecture manuscript, or foreign-library contract was used.

Snapshot: HEAD `fd0895c39d96dc77f59d367c3a3bf9d8d428ff1d`.

SHA-256:
- `/tmp/bmsx-bios-math-transcendental-root-facts.md`: `0bd13967c327c00b386d0060bb9250edcb189de9ff48a290cac15153d1ab9ef1`
- `machine/bios/math.lua`: `d75f00a569914c101dffbc0d1ba1367226b9a350c3bb7eab4a30676cf805c7d1`
- `machine/bios/math/sin.lua`: `3b9af5922f7372568b115b94b1a35b94d0eeb9f96ac1736618bb31c69c8cb93b`

The facts packet was used only as an index. I independently opened and checked the actual function/constants/export owners in `machine/bios/math.lua:1-42,92-279,349-379`, and the entire LUT/helper in `machine/bios/math/sin.lua:1-64`.

| Subject | Actual-source result |
| --- | --- |
| Public opening | `math.lua:350-378` has 29 exported fields: constants `huge`, `maxinteger`, `mininteger`, `pi`; the other 25 are callable bindings. Existing opening's twenty-five callable entries and four numeric constants is correct. |
| Eleven signatures/returns | Each scoped body has a single fixed formal except `atan(y,x)` and `log(value,base)`; no varargs; all reached successful return expressions produce one Number. Frame copy/nil-fill discards surplus fixed arguments and supplies nil for missing fixed formals. |
| `deg`, `rad` | Exactly multiplication by retained `180/pi` or `pi/180`; no reduction or argument branch. |
| `sin`, `cos`, `tan` | Exact distinction preserved: cosine adds quarter before first word conversion; tangent word-converts the base angle first, then offsets it. Thus nonnumeric/NaN/infinite radians deduce sine 0, cosine 0, tangent 0 from these owners, not cosine 1. Tangent denominator-zero branch uses numerator sign, otherwise raw integer ratio. |
| Sine LUT | 257 listed words, endpoints 0 and 65536; mirrored odd quadrants; 22-bit interpolation; quadrant-dependent final sign. At most two LUT reads per invocation, with no magnitude-reduction loop. |
| T09 range deduction | Independently inspected the literal table: nondecreasing entries in 0..65536, largest adjacent difference 402. `402 * 0x3fffff = 1686109806 < 2147483647`; the interpolation product cannot wrap at signed word conversion. Interpolation contribution is 0..delta, helper is -65536..65536, sine/cosine are -1..1 on a 1/65536 grid; nonzero integer tangent denominator bounds its finite quotient by -65536..65536. These are range bounds, not approximation-error, exact-pole, or reachability claims. |
| `atan` | Retained polynomial and reciprocal reduction match; nil-default branch precedes NaN-self-check, then x-positive, x-negative, y-positive, y-negative, literal-zero branches in that order. `false` is not nil; `atan(1,false)` follows the positive-y axis branch. No ideal atan2/infinity guarantee inferred. |
| `asin`, `acos` | Exactly retained `atan(v,sqrt(1-v*v))` and `half_pi-asin(v)`; out-of-domain numeric values lead through the actual negative-root/NaN branch; no explicit domain error. |
| `sqrt` | Negative check; zero/+infinity return unchanged; power-of-four normalization; exactly eight Newton updates; scale multiplication. Normalization work depends on magnitude. |
| `exp` | Self-NaN test, strict overflow and underflow comparisons, negative reciprocal branch; retained floor reduction, exactly 16 series updates, variable power scaling in groups of 16 then individual powers. Reciprocal follows potentially overflowing positive scaling, so no accurate-subnormal claim is justified. |
| `log` | Natural helper checks negative, zero, +infinity in order; magnitude-dependent factor-two normalization; 15 odd-denominator updates 3..31; result `2*sum+exponent*ln2`. Public function computes natural first, then nil, 10, 2, general-base branches. False is supplied, not default. No legal-base validator. |
| Retained dependencies | Scoped bodies use lexical constants/private functions and imported sine helper, not public `math.pi`, `math.floor`, `math.sqrt`, `math.atan`, or `math.abs` lookups; none calls global `error` or does local type validation. |

Necessary mirrored boundaries were independently opened, not inferred from stock Lua:

- TS Number scalar storage: `machine/ts/machine/cpu/value_slots.ts:25-35,128-130`; C++ Number/NaN-box representation: `machine/cpp/machine/cpu/value.h:29-39,95-148`.
- Arithmetic and floor division: `machine/ts/machine/cpu/cpu.ts:2551-2586,3589-3596`; `machine/cpp/machine/cpu/cpu_dispatch.inl:171-213`; `machine/ts/spec/blua32/numeric.ts:1-5`; `machine/cpp/spec/blua32/numeric.h:7-11`.
- Equality and ordering including NaN and mixed-kind behavior: TS `cpu.ts:2692-2735,2812-2847,3546-3586`; C++ `cpu_dispatch.inl:340-384`.
- Word AND and signed right shift: TS `cpu.ts:2558-2567,2590-2604`; C++ `cpu_dispatch.inl:222-268`; C++ conversion `value.h:199-229`. Tagged nonnumbers are NaN bit patterns, so the raw C++ arithmetic/word decoder follows the documented nonnumeric deductions on these paths.
- Reached source-call fixed formals and nil-fill: TS `cpu.ts:3272-3296`; C++ `cpu.cpp:3017-3042`.

No disagreement found in those inspected paired owners. This does not audit every optimized/native path, all compiler passes, execution timing, approximation precision, or broad input parity. No extra guarantee is authorized by this checkpoint.

## Pending finite step

Review the exact final facts-only prose sentences, signature table, branches, formulas, and source/range assertions after the parent provides the merged chapter or a hashed prose packet; append its precise file hash and disposition here. Do not expand into an optimizer-wide investigation.

## Final finite prose check — 2026-10-18

Reviewed the actual merged public section `docs/book1/bios-math.md:209-544`, sentence by sentence, including all eleven signature-table rows and every branch/formula table and code block, against the actual owners independently inspected above. Also rechecked the public opening at line 3 against exports `math.lua:349-379`.

Exact reviewed hashes:

- Full merged `docs/book1/bios-math.md`: `74df24aee046551ccbb7735c2b33ec65f6fedeef4c8bb079bc13bcda3225161e`.
- Fresh `/tmp/bmsx-bios-math-transcendental-prose.md`: `23e333620d2c24e102119b1e2d83b9268510a59c9bf5b759055c740c0e3d12f0`.

The merged section matches the prose packet, apart from one separating blank line before the next chapter section. Both actual Lua source hashes still match the checkpoint.

### Source-contract disposition

No actual owner/formula mismatch found. The following precise merged ranges are source-consistent:

- `211-247`: eleven APIs and one Number per returned result; fixed-formal/nil/surplus semantics; no broad shortened-source-call promise; private retained dependencies; no function-local argument/domain errors.
- `251-260`: deg/rad factors, single multiplication, zero/infinity/NaN and nonnumeric consequences.
- `264-335`: phase scaling, exact cosine-versus-tangent offset/conversion order, tangent zero-denominator sign, nonnumeric/nonfinite table, 257-entry reflected/interpolated LUT algorithm, signed word interpretation, proven output ranges/quantization, one/two lookup counts and bounded lookup structure. No error bound or reachability guarantee is introduced.
- `339-388`: P/A formulas, all atan branch rows in exact order, false-versus-nil distinction, self-NaN handling, zero-axis positive zero, retained asin/acos calls, domain/nonnumeric NaN, magnitude-dependent square-root work, and explicit absence of ideal atan2/inverse-accuracy guarantees.
- `392-416`: sqrt initial branches, both normalization loops in source order, eight refinements, final scale, zero-sign behavior, and no fixed-total-cycle/precision guarantee.
- `420-472`: exp strict ordered cutoff tests; retained constants; D reduction; 16 update formulas; block-of-16 then individual scaling; negative reciprocal after possible intermediate overflow; nonnumeric arithmetic. No guaranteed subnormal accuracy or uniform rounding bound is claimed.
- `476-544`: natural-log ordered branches, normalization thresholds/order, exact z-series and 15 updates, final equation, natural-first base selection with nil/10/2/general order, false/general-base handling, base-one NaN, variable normalization work and stored-Number decimal caveat.
- `3`: twenty-five callables plus four numeric constants is correct.

### Documentation-reference finding (not a runtime/formula mismatch)

At `docs/book1/bios-math.md:236-237`, the phrase “Number arithmetic, word operations, and private D and T notation defined earlier” presents word operations as defined earlier in this chapter. Earlier text defines D/T/arithmetic but does not define the word conversion and signed right-shift contract; it links out to CPU operator boundaries. Separate the earlier D/T notation reference from an explicit CPU word-operation reference (or include the short exact word contract). Parent notified; no repair made by this reviewer.

This finite source review is complete for the exact hashes above, with that one reference wording finding. No builds, executions, repo edits, optimizer-wide/native-path audit, measured precision/performance result, visual layout approval, or architecture-manuscript comparison is implied.

## Narrow correction closure — 2026-10-18

Exact updated `docs/book1/bios-math.md` SHA-256: `e826c3084ad73f4a6bdea8462ddca5368dd66dfae15d146744a350b36dfeaac7`.

Disposition: PASS for the narrow source-reference and finite source-use corrections. The earlier documentation-reference finding is closed. No new owner/formula mismatch found.

- `bios-math.md:237-239` now correctly attributes Number arithmetic and D/T notation to the earlier chapter text, and explicitly links word conversion, masks and signed right shifts to `cpu.md#bitwise-operations-and-shifts`. I opened the actual target heading and contract at `cpu.md:588-604`; the anchor exists and its word conversion, signed result and arithmetic SHR description matches the paired owners already reviewed. This does not certify unrelated CPU text.
- `bios-math.md:252-254` explicitly marks the reference's text blocks as formulas/pseudocode rather than literal BLua listings. This correctly separates explanatory `*=`, colon-loop, and named-formula notation from the literal complete program below; it changes no numeric contract.
- `bios-math.md:230-235` now says explicit nil *selects* the alternate atan/log forms, not that the reader must rewrite accepted one-argument calls. It retains the finite qualification against promising every shortened source spelling. Actual nil branches were reopened at `machine/bios/math.lua:162-165,267-279`.
- I independently opened actual `carts/bios_math_manual/entry.lua:89,106,109-110`: it contains `math.atan(1)`, `math.log(1)`, `math.log(0)`, and `math.log(-1)`. The literal public listing contains those same calls at `bios-math.md:822,839,842-843`. Current entry hash is `c7b4600609c30a48c24339818f493d33660c41ef3a58bfa30765caa58666b82e`.
- A08 in `docs/book1/facts/bios-math-call-boundary.md:21` is finite evidence, not a universal source-policy exemption. I read the already captured `/tmp/bmsx-bios-math-build-layout.log`: all ordinary build phases including compile and cart lint complete and publish artifact `73cd790d03b4db17ad32f50bb79dfc8841ade31793abfa79600a5cfb20afe7d2`. I read `/tmp/bmsx-bios-math-guest-layout.log`, ending `[test] math_observations: passed`, and `/tmp/bmsx-bios-math-ordinary-layout.log:25-29`, containing the angle and logarithm observations. The actual suite source retains 84 assert statements. These are inspections of existing evidence, not reruns, and do not extend the earlier finite acceptance claim.
- The conversion-through-logarithm algorithm text is identical to the initially audited prose packet, apart from the separating blank line before the next H2. Both actual Lua source hashes remain unchanged from the initial checkpoint.

No new runtime execution, build, repository edit, broad compiler/runtime audit, visual/PDF approval, or strengthened precision/performance guarantee was performed or claimed for this addendum.
