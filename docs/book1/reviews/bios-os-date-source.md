# Independent actual-source review: BIOS `os.date`

Reviewed artifact: `/tmp/bmsx-bios-os-date-prose.md`

Exact reviewed SHA-256: `7b6da0a5435219c929c0db9b3250bf7ba2426b6c3d51ba01812a01739a1c4136`

## Result

**Bounded source PASS for the authored `os.date` control flow, table fields, calendar-decomposition formulas, conversion table, modifier sets, week formulas, supplied finite-number formatting, and listed authored errors.** Two wording qualifications below prevent treating every sentence as an unconditional runtime statement. There is also a required assembled-chapter dependency: the actual forward/inverse civil algorithms must be defined once; the symbols here do not teach them completely.

This was a read-only source comparison, not execution or a compiler/optimizer/all-state parity proof. I did not open `docs/architecture.md`, historical PDFs, or external-library specifications. No repository files were edited and no builds, tests, or emulator runs were performed. The facts packet was used as an index; the cited owners were read directly.

## Wording qualifications

### 1. Initialization binding is stronger wording than the demonstrated later Math dependency

Prose L214:

> The OS library retains the required String and Math tables and the `math.modf` function obtained when it is initialized.

Actual source:

- `machine/bios/os.lua:4`: `local string<const> = require('string')`
- `machine/bios/os.lua:5`: `local math<const> = require('math')`
- `machine/bios/os.lua:6`: `local modf<const> = math.modf`
- `machine/bios/os.lua:25`: `local integer<const> = modf(value)`
- The only `math` table references in the entire file are L5-L6. Later closures use `modf`, not `math` or `math.modf`. In contrast, the String table is referenced inside later closures at L185, L191, L196, L310-L311.

The source establishes an initialization-local Math-table binding and a retained function dependency; it does not establish that `os.date` subsequently retains or consults the Math table itself. If “retains” is intended as a reachability/lifetime or later-dependency statement, that part is not supported by these owners. This is a precision issue, not an observed timestamp-validation mismatch. The remaining L214 claims about captured `modf`, later `string.sub` field access, and uncaptured global `tostring`/`error` match source.

### 2. The numeric-format summary needs its finite-value scope

Prose L202 and L206:

> With the supplied `tostring`, numbers use the shared numeric-text conversion:

> Other values are normalized to a decimal exponent and rounded to six significant digits, with ties to even.

Actual runtime source has a preceding nonfinite branch:

- `machine/ts/machine/cpu/value.ts:190-195`: for Number, `numberValue - numberValue !== 0` returns `nan`, `-inf`, or `inf`; only the remaining values call `formatNumber(numberValue)`.
- `machine/cpp/machine/cpu/value.cpp:24-29`: nonfinite Number returns `nan`, `-inf`, or `inf`; only the remaining values call `formatNumber(number)`.

The six-significant-digit description correctly describes the finite fallback branch in `machine/ts/common/number_format.ts:91-142` and `machine/cpp/common/number_format.h:88-171`. As an unrestricted statement about the supplied `tostring` on all Numbers, “Other values” is incomplete. No successful supplied `os.date` path producing such a nonfinite padding operand was established: explicit timestamps encounter integer/bounds checks, and the default is a word read. Thus this is a numeric-summary scope qualification, not a reachable date-conversion discrepancy.

## Required assembly dependency: canonical calendar definition

Prose L73:

> Let `D(y, m, d)` denote the shared forward civil-day calculation and let `C(days)` denote its civil inverse.

Prose L157:

> They use the decomposed civil year and the `D` civil-day calculation defined above.

The source contains complete algorithms at `machine/bios/os.lua:63-73` (`days_from_civil`) and L75-L89 (`civil_from_days`). The prose at L73 only names them and mentions eras/corrections/alignment; it does not define either algorithm. Therefore:

- The L76-L83 and L160-L173 formulas agree with source **conditional on those definitions**.
- This section is not independently complete calendar teaching.
- The assembled chapter needs one canonical shared definition of both algorithms, and these references must identify it. The author's intended companion section can satisfy that obligation; duplicating the algorithms here is unnecessary.

This is a completeness/assembly gate, not a contradictory formula finding.

## Exhaustive prose-to-owner map

All factual prose ranges, formula blocks, and tables were compared. Grouped ranges below include their intervening explanatory sentences.

| Prose lines | Checked subject | Actual owners and result |
|---|---|---|
| 1-7 | Signature; one returned String or newly created Table; no explicit extra-argument processing | `machine/bios/os.lua:308-319`; ordinary non-vararg parameter copying/nil filling at TS `machine/ts/machine/cpu/cpu.ts:3272-3288`, C++ `machine/cpp/machine/cpu/cpu.cpp:3018-3035`. PASS. |
| 11-22 | Only-nil defaults; exact single-`!` stripping; `*t` selection; word-address default read; no timezone flag | `machine/bios/os.lua:8,308-318`. PASS. The `!` is removed, not preserved as a timezone branch. |
| 24-35 | Operational ordering; empty format; timestamp before conversion error; false format's LEN fault; false timestamp reaches retained modf | `machine/bios/os.lua:24-30,55-61,178-205,308-319`; `machine/bios/string/base.lua:58-61`; TS LEN `machine/ts/machine/cpu/cpu.ts:2672-2684`; C++ LEN `machine/cpp/machine/cpu/cpu_dispatch.inl:319-330`; `machine/bios/math.lua:27-32,59-62`. PASS within the stated diagnostic limit. |
| 39-53 | Captured modf's first result; truncation formula; integer error before inclusive bounds; exact strings; default bypass | `machine/bios/os.lua:6,13-14,24-30,55-61,313`; `machine/bios/math.lua:27-32,59-62`; global error binding `machine/bios/base.lua:9,214`; TS error builtin `machine/ts/machine/cpu/cpu.ts:4370-4380`; C++ `machine/cpp/machine/cpu/cpu.cpp:2225-2228`. PASS. No host-rendered exception decoration was inferred. |
| 57-71 | Fresh table; exact nine fields; calendar-field names; returned table is not supplied by caller | `machine/bios/os.lua:91-114,314-315`; NEWT TS `machine/ts/machine/cpu/cpu.ts:2545-2549`, C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:165-168`. PASS. |
| 73-86 | Civil algorithm characteristics; timestamp decomposition; weekday/day-of-year formulas; same table/string decomposition; no extra timezone/DST inference | `machine/bios/os.lua:63-114,308-318`. Formula/source PASS; canonical-algorithm assembly gate above applies. |
| 90-99 | Codepoint scanner; `%`; one modifier; complete E/O sets; rejection before dispatch; modifiers do not alter output path | `machine/bios/os.lua:19-22,167-172,178-205,206-285`; supplied `sub` at `machine/bios/string/base.lua:58-82`; TS LEN/string builtins `machine/ts/machine/cpu/cpu.ts:2672-2678,4320-4367`; C++ equivalents `machine/cpp/machine/cpu/cpu_dispatch.inl:319-324`, `machine/cpp/machine/cpu/cpu.cpp:2176-2222`. PASS for representable supplied String codepoints. |
| 103-105 | Documentary Z/S notation; current tostring; minimum total length; no truncation or sign-aware zero placement; hour12 and AMPM | `machine/bios/os.lua:124-138,180-181`. PASS. |
| 107-144 | Every conversion table row, punctuation, `%c` zero-padded day | Direct row-by-row comparison against `machine/bios/os.lua:206-279`, with ISO precomputation L201-L205 and padding L124-L138. PASS, including `%C`, `%D/%x`, `%F`, `%G/%g`, `%Y/%y`, `%m/%d/%e`, `%H/%M/%S/%I`, `%R/%r/%T/%X/%p`, `%a/%A/%h/%b/%B`, `%j/%n/%t`, `%U/%u/%V/%w/%W`, `%c/%z/%Z/%%`. |
| 146-153 | Four complete fixed name arrays, index order, no locale lookup | `machine/bios/os.lua:15-18,242-251,269`. PASS. |
| 157-175 | Sunday/Monday week formulas and first-week boundary interpretation; ISO weekday remap/candidate; exact 52/53 rule and adjacent-year rules | `machine/bios/os.lua:140-165`; civil forward owner L63-L73. PASS as authored arithmetic/formulas; canonical-algorithm assembly gate applies. |
| 179-194 | Current error; exact assembled conversion messages; absent code becomes empty; `%EO` fails as E + O | `machine/bios/os.lua:174-176,189-200,280-281`; `machine/bios/string/base.lua:58-75`; supplied global/error builtin owners above. PASS. |
| 196 | Literal embedded zero copied and scan continues; zero conversion code unsupported and retained in error String | `machine/bios/os.lua:184-200,280-285`; TS byte/char `machine/ts/machine/cpu/cpu.ts:4342-4367`; C++ `machine/cpp/machine/cpu/cpu.cpp:2196-2222`; `machine/cpp/common/utf8.h:55-60,98-101`; concat/value String handling below. PASS. |
| 200-210 | Complete-text padding; `00-1` example; supplied tostring/concat; signed zero; small exact integers; six-digit rounding; exponent formatting; limits on large years | `machine/bios/os.lua:124-138,206-219`; `machine/bios/base.lua:235-237`; TS concat/value `machine/ts/machine/cpu/cpu.ts:2630-2656`, `machine/ts/machine/cpu/value.ts:182-198`; C++ concat/value `machine/cpp/machine/cpu/cpu_dispatch.inl:271-305`, `machine/cpp/machine/cpu/value.cpp:9-29`; TS numeric formatter `machine/ts/common/number_format.ts:10-142`; C++ `machine/cpp/common/number_format.h:11-171`. PASS for finite date operands; nonfinite wording qualification above. |
| 214 | Initialization dependencies, mutable retained String-table sub field, retained modf, runtime globals | `machine/bios/os.lua:4-6,24-30,55-61,124-138,174-176,185-196,261,265,310-311`; runtime mutable global-slot dispatch TS `machine/ts/machine/cpu/cpu.ts:2351-2357`, C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:60-77`. PASS except Math-table-retention precision qualification above. |
| 216 | Table form decomposition/writes and bypasses; String form initial decomposition/growing output; ISO pair per G/g/V/OV, no call cache | `machine/bios/os.lua:22,91-114,178-205,206-287,314-318`. PASS. |
| 218-220 | Scanner increments; arithmetic calendar work; one-character padding loops; beginning-to-position byte lookup; leading-! tail slice and temporary collection/concat | `machine/bios/os.lua:63-100,124-138,184-205,283-285,310-311`; `machine/bios/string/base.lua:58-82`; TS byte iteration `machine/ts/machine/cpu/cpu.ts:4342-4350`; C++ `machine/cpp/machine/cpu/cpu.cpp:2196-2206`; codepoint-count construction TS `machine/ts/machine/cpu/string_pool.ts:124-126`, `machine/ts/common/utf8.ts:1-7`; C++ `machine/cpp/machine/cpu/string_pool.cpp:138-143`, `machine/cpp/common/utf8.h:27-53`. PASS for stated source structure, without treating it as a complexity/all-state guarantee. The table-length dependency is assigned to a separate trace and is not independently signed off here. |
| 222 | Fixed z/Z/isdst and removed ! establish no additional clock/timezone/external-compatibility promises | `machine/bios/os.lua:8,112,274-277,308-318`. PASS as a deliberate statement of this review's limits, not a claim that no other owner implements a clock. |

## Limits

- This review does not establish clock provenance, reset origin, wrap policy, external UTC/local-time meaning, actual daylight saving, locale compatibility, all-state termination, exact large-range civil arithmetic, malformed-host-string parity, heap/string limits, or host-rendered error presentation.
- No claim of complete TypeScript/C++ compiler/runtime equivalence is made. The directly needed paired dispatch/value/string/formatting/error/call source slices above agree at the bounded representation/control-flow level described.
- No non-number timestamp or non-String format diagnostics beyond the explicitly documented false-format path were exhaustively traced.
- Companion calendar teaching and the separately assigned Table-length dependency remain outside this review's independent acceptance.

## Independent merged-delta actual-source recheck

Rechecked public artifact: `docs/book1/bios-os.md`.

- Initial merged artifact inspected: SHA-256 `a01257820f451b64c62935a1061cabdd779f8b8bb4cf953d494f71d06e07b24e`.
- Exact final rechecked artifact, after the reported L319 grammar-only `defines` -> `define` correction: SHA-256 `00828fc12b74146b2f0688f4b5432bb31edbbcec8c4e68f90c881d9f0bbd851f`.
- Frozen shared-civil facts SHA-256: `52914d3b08a80fb641597823a8d2ee4b5753fb68ddb22e3ab84ca8425bb4caef`.
- Frozen shared-civil prose SHA-256: `bfe66d3cd402c9a0846f5446089e962ca40511a645c3aacec42b9fb5704bb197`.

**Narrow merged-delta source PASS. No factual mismatch found in the requested five areas.** This acceptance is limited to the current reference/delta, not the not-yet-added complete program or the independently reviewed time fragment as a whole.

### 1. Root introduction and four-call lookup table: L1-L23

- Installed `os` is directly established by `machine/bios/main.lua:10`, with the table created at `machine/bios/os.lua:7` and returned at L333.
- The table's four function assignments are exactly `clock`, `time`, `date`, and `difftime` at `machine/bios/os.lua:289-331`. Their actual bodies support the four summarized operations and contain no filesystem or process interface. They are BIOS functions, not additional clock-control registers.
- Lookup row L20 matches `machine/bios/os.lua:289-291` and the millisecond word at L8. Row L21 matches L293-L305 plus timestamp conversion L116-L122 and in-place normalized-field writes L102-L114. Row L22 matches L308-L319. Row L23 matches both modf calculations, ordered checks, and subtraction at L321-L330.
- The distinction between a sampled counter and a civil spelling is supported directly by scheduler-cycle-derived millisecond reads at TS `machine/ts/machine/devices/system/controller.ts:119-129` and C++ `machine/cpp/machine/devices/system/controller.cpp:77-81`, separately from the civil arithmetic at `machine/bios/os.lua:63-100`. No external wall-clock/RTC/calendar-origin property was inferred.
- The six linked chapter files exist; their displayed topics and the CPU `values-and-numeric-instructions` heading match the introductory navigation. This was a target/topic check, not a new independent audit of those chapters.

### 2. Shared civil-day calculations: L190-L245

The merged subsection is byte-for-byte identical to the frozen shared-civil prose. Every assignment was independently compared to actual source, rather than accepted from the facts packet:

| Public lines | Actual owner | Result |
|---|---|---|
| L192 | Number dispatch at TS `machine/ts/machine/cpu/cpu.ts:2551-2585`, C++ `machine/cpp/machine/cpu/cpu_dispatch.inl:171-211`; paired numeric helpers TS `machine/ts/spec/blua32/numeric.ts:1-12`, C++ `machine/cpp/spec/blua32/numeric.h:7-18` | Ordinary Number arithmetic and non-word `//`/`%` description matches. Documentary/non-public notation and no exact-unbounded-arithmetic promise are appropriately explicit. |
| L197-L206, forward `D` | `machine/bios/os.lua:63-73` | All constants, branches, signs, and operation groups match. The three `day_of_era` assignments preserve the source's left-associated add/subtract grouping; the split `day_of_year` preserves its divide-then-add/subtract grouping. |
| L212-L227, inverse `C` | `machine/bios/os.lua:75-89` | All constants and branches match. The successive `year_numerator` assignments preserve the numerator's source grouping before division by 365. The separate `year_days` assignments preserve the inner grouped sum/difference before `day_of_era - year_days`; this is not an algebraically reassociated expression. The day calculation still divides `(153 * month_prime + 2)` by 5 before subtraction and final addition. |
| L232-L243, month normalization and timestamp expression | `machine/bios/os.lua:116-122`, with day length L10 | Normalized year/month assignments match. Timestamp construction preserves the source's left-associated sequence: civil days times 86400, then hour term, then minute term, then second term. No exact-integer/calendar identity assumption was substituted. |
| L245 | `machine/bios/os.lua:55-61,91-100,116-122,140-165` | Final timestamp check and shared uses of the same forward/inverse owners match. |

### 3. Direct D/C anchor: L319

The link targets the actual L190 heading and now resolves the previously open canonical-algorithm teaching dependency. The shared section completely spells out the authored forward/inverse calculations once; L319 correctly identifies them as documentary notation and the common calendar calculations for table/string results (`machine/bios/os.lua:91-114,314-318`). The old assembly qualification in this review is therefore **satisfied for this exact merged artifact**. This does not elevate the formulas into an all-range exact-calendar proof.

### 4. Both earlier wording qualifications: L470-L476 and L482

- L474 now says **“Other finite values”**. That fits the finite formatter fallback in TS `machine/ts/common/number_format.ts:77-142` and C++ `machine/cpp/common/number_format.h:64-171`, without silently absorbing the preceding `nan`/`inf`/`-inf` branch at TS `machine/ts/machine/cpu/value.ts:190-195` and C++ `machine/cpp/machine/cpu/value.cpp:24-29`. Earlier numeric-summary qualification: **resolved**.
- L482 now distinguishes obtaining both tables at initialization from later retaining the String-table reference and captured modf function. This matches `machine/bios/os.lua:4-6,25,185-196,310-311`; it no longer claims a later Math-table retention dependency. Earlier Math-retention qualification: **resolved**.

### 5. Split ordinary conversion tables: L355-L410

All **34 conversion rows** are byte-for-byte identical, in the same order, to the original frozen `os.date` prose rows L109-L142 after excluding only repeated table headers/separators. They were also read against current `machine/bios/os.lua:206-279`, including its hour12/AMPM definitions at L180-L181, ISO calculation at L201-L205, and padding at L124-L138. No row, alias, literal punctuation, minimum width, sign behavior, or code set changed during table splitting. The five ordinary table groupings introduce no additional behavior.

This recheck made no repository edits, runtime/compiler/owner changes, publisher/CSS changes, builds, tests, or emulator runs. Only this `/tmp` review was appended. The original review's deliberately bounded arithmetic/parity/runtime limits continue to apply.

### Supplemental source derivation: false timestamp

At root's request, the previously deliberately untraced false-timestamp diagnostic was now narrowly traced through actual paired representation/dispatch owners. With the supplied dependencies, `os.date(format, false)` reaches the authored error **`time is not an integer`**, before the bounds check, provided format processing itself succeeds.

- `machine/bios/os.lua:313` sends false through retained `modf`, not the nil default. `machine/bios/math.lua:27-32,59-62` first tests `value < 0`, then takes `value // 1` when that comparison is false.
- That mixed Boolean/Number LT comparison is false, not a comparison fault: TS `machine/ts/machine/cpu/cpu.ts:2701-2735`; native `machine/cpp/machine/cpu/cpu_dispatch.inl:356-368`.
- Numeric operand consumption yields NaN for false: TS `machine/ts/machine/cpu/value_slots.ts:128-130` and `machine/ts/machine/cpu/cpu.ts:3589-3596`; native false is a NaN-boxed tagged value, decoded as Number bits at `machine/cpp/machine/cpu/value.h:125-144,155-157`. Floor-div dispatch and helpers at TS `machine/ts/machine/cpu/cpu.ts:2584-2585`, `machine/ts/spec/blua32/numeric.ts:1-5`, and native `machine/cpp/machine/cpu/cpu_dispatch.inl:208-211`, `machine/cpp/spec/blua32/numeric.h:7-11` therefore produce numeric NaN.
- The retained numeric NaN is unequal to Boolean false: TS equality helper `machine/ts/machine/cpu/cpu.ts:3569-3578`; native EQ dispatch `machine/cpp/machine/cpu/cpu_dispatch.inl:341-349`, with numeric NaN canonicalization at `machine/cpp/machine/cpu/value.h:132-138` distinct from the False tag.
- `machine/bios/os.lua:25-27,55-58` consequently invokes the supplied global error with `time is not an integer`, before the time bound test. This is the exact authored error value, not a specification of surrounding host presentation.

This is an additional source-derived fact, not execution evidence and not yet an acceptance of a subsequently modified public-artifact hash. It resolves only the explicitly named false-timestamp diagnostic; no broader non-number-input diagnostic promise is implied.

### Final narrow clarification integration

Exact additionally rechecked public-artifact SHA-256: `ffcd0d8a2c882ed50c31463ad112ac0bb0c113e31da524fc02d864221dcedee5`.

- Public L281 now states the source-derived false-timestamp error and its position before the bounds check exactly as established immediately above. **PASS.** No execution claim was added.
- Public L188 now identifies the existing missing/surplus-argument text as reached-call rules and links directly to the existing `blua-programs.md#known-call-argument-diagnostics` section. The target heading exists. This is a distinction/navigation clarification, not a newly specified compiler diagnostic rule. **PASS within that narrow scope.**
- The shared-civil subsection remains byte-identical to the frozen prose, and all 34 split conversion rows remain byte-identical and ordered as before. Both resolved wording qualifications and the canonical D/C anchor remain in place.

The narrow merged-delta acceptance therefore also applies to this exact clarified artifact. It does not cover any later complete-program addition.
