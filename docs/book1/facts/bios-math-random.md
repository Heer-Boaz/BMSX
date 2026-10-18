# Frozen source facts: BIOS Math random and randomseed

Scope: two exports only; actual source and direct numeric/word/call owners. No execution, build, test, repository edits, architecture documents, historical material, or repair recommendations used. Source inspection only. No relevant mirror disagreement was found in the inspected call/arithmetic/word paths; this is not a complete runtime-parity claim.

## Export and call/result contract

- `math.random` is `random_number(lower, upper)`; two fixed formal parameters, no varargs. Every successful branch returns one number. `math.randomseed` is `randomseed(seed)`; one fixed formal parameter, no varargs. Exports are assigned directly. Sources: `machine/bios/math.lua:321-347`, `machine/bios/math.lua:369-370`.
- At runtime, missing fixed arguments become nil; extra arguments are not copied into fixed parameters and are retained only for vararg functions. This describes VM invocation, not which calls the compiler accepts. Paired sources: `machine/ts/machine/cpu/cpu.ts:3275-3296`; `machine/cpp/machine/cpu/cpu.cpp:3017-3042`.
- **Actual compiled successful result count for `randomseed` is one nil, not zero results.** Its nil-seed branch uses bare `return`, and its supplied-seed branch falls through. The compiler emits `LOADNIL` plus `RET` with count 1 for both bare return and default return; function compilation emits that default return at fallthrough. Both runtimes interpret nonzero RET operand `b` directly as the result count. Sources: `machine/bios/math.lua:341-347`; `toolchain/ts/lua/compiler.ts:1496-1501`, `toolchain/ts/lua/compiler.ts:4372-4377`, `toolchain/ts/lua/compiler.ts:5767-5770`; paired consumers `machine/ts/machine/cpu/cpu.ts:2942-2944`, `machine/cpp/machine/cpu/cpu_dispatch.inl:506-507`.

## Private state, constants, initialization, sharing

- There is one declared module storage object, `data rng_state: word = 0x12345678`; both random generation and seeding dereference that same identifier. The module returns neither the state nor the private `next_random_unit` function. Sources: `machine/bios/math.lua:25`, `machine/bios/math.lua:316-347`, `machine/bios/math.lua:349-379`.
- `u32_mod` is `4294967296.0` (2^32). Source: `machine/bios/math.lua:23`.
- `word` has size 4, alignment 4, and `MemoryAccessKind.Word`. The compiler records a `.data` initializer and emits its word using `writeLE32`; data references load a `data_addr` relocation rather than allocating a per-call value. Sources: `toolchain/ts/lua/compiler/struct_types.ts:54`; `toolchain/ts/lua/compiler.ts:3714-3717`, `toolchain/ts/lua/compiler.ts:3800-3815`, `toolchain/ts/lua/compiler.ts:2781-2784`, `toolchain/ts/lua/compiler.ts:3182-3185`.
- The inspected compiler section-initializer generator copies data words from load address to runtime data address. This proves that initializer mechanism, not when or how often a reset/cart/session invokes it. Source: `toolchain/ts/lua/compiler.ts:1505-1533`.

## Shared arithmetic dependency

- Private `trunc(value)` first evaluates `value < 0`; negative path returns `-((-value) // 1)`, otherwise returns `value // 1`. Finite numeric values are truncated toward zero. Source: `machine/bios/math.lua:27-32`.
- `//` computes quotient, takes host truncation, then subtracts 1 only if the truncated value is greater than quotient. `%` starts with host remainder and adds the divisor only for a nonzero remainder whose sign differs from the divisor. Paired owners: `machine/ts/spec/blua32/numeric.ts:1-13`; `machine/cpp/spec/blua32/numeric.h:7-18`.

## random: algorithm, full explicit check order, range formulas

1. **Before any argument check**, call `next_random_unit()`. It reads the old word, computes `((old * 1664525) + 1013904223) % 4294967296.0`, stores that result into the word, reads the stored word again, and divides it by `4294967296.0`. Sources: `machine/bios/math.lua:316-322`.
2. Test `lower == nil`. If true, return the generated unit value immediately; `upper` is not examined, even if supplied. Source: `machine/bios/math.lua:323-325`.
3. Otherwise test `upper == nil`. If true, compute `upper_int = trunc(lower)`, then test `upper_int < 1`. If true, raise exactly `'random upper bound must be positive.'`. Otherwise return `trunc(value * upper_int) + 1`. Sources: `machine/bios/math.lua:326-332`.
4. Otherwise compute `lower_int = trunc(lower)` **first**, then `upper_int = trunc(upper)`. Test `upper_int < lower_int`; if true, raise exactly `'random upper bound must be greater than or equal to lower bound.'`. Otherwise return `lower_int + trunc(value * ((upper_int - lower_int) + 1))`. Sources: `machine/bios/math.lua:333-338`.
- These are all explicit argument/fault checks in these functions: no type, finite, integer, maximum-bound, span-overflow, or argument-count check appears there. A rejected bound has already consumed the RNG update. Sources: `machine/bios/math.lua:321-347`.
- With the stored word interpreted unsigned, unit output is `s / 2^32`, `s` in `[0, 2^32-1]`: lower endpoint 0 included, upper endpoint 1 excluded; largest possible value is `1 - 2^-32`. The recurrence's multiply/add on 32-bit state stays below 2^53 before modulo; these integer intermediates therefore do not require integer-overflow wrap semantics. Sources: `machine/bios/math.lua:23`, `machine/bios/math.lua:316-318`; paired unsigned word load/store sources in table below.
- Ordinary finite bounded modes use inclusive integer bounds **after truncation**, with exact formulas above: one bound means 1 through `trunc(lower)`; two bounds mean `trunc(lower)` through `trunc(upper)`. This is not a promise that every integer is sampled or equally likely, and not an all-binary64-extremes range guarantee: floating arithmetic and rounding in the exact formulas remain authoritative. Sources: `machine/bios/math.lua:327-338`; numeric owners above.
- Nil versus omission: runtime `random()` and `random(nil, anything)` take the unit branch; `random(u)` and `random(u, nil)` take the one-bound branch. False is not nil and does not select a default. Sources: `machine/bios/math.lua:323-338`; paired call owners above; exact-tag equality `machine/ts/machine/cpu/cpu.ts:3546-3578`, `machine/cpp/machine/cpu/cpu_dispatch.inl:341-349`.

## randomseed: full explicit check order and state update

1. Test only `seed == nil`. If true, call current `os.clock()`, multiply its result by 1000, apply private `trunc`, apply `% 4294967296.0`, and store to the RNG word; then bare-return (actual compiled result: one nil). Source: `machine/bios/math.lua:341-345`.
2. Otherwise apply `trunc(seed)`, apply `% 4294967296.0`, and store to the same word; fallthrough-return (actual compiled result: one nil). Source: `machine/bios/math.lua:346-347`; return owners above.
- No generation step, warm-up/discard loop, extra seed combination, or seed-result return appears in either branch. Sources: `machine/bios/math.lua:341-347`.
- Runtime omission and explicit nil choose the same clock branch; false chooses the supplied-seed branch. Source: `machine/bios/math.lua:342-346`; paired call/equality owners above.
- The BIOS-defined `os.clock` returns `*time_ms / 1000`, with `time_ms` typed `*word` at address `0x08010228`. Thus the default seeding source expression is `trunc(((*time_ms / 1000) * 1000)) % 2^32`, preserving the actual divide-then-multiply rounding, not replacing it with a direct register read. Sources: `machine/bios/os.lua:8`, `machine/bios/os.lua:289-291`; `machine/bios/math.lua:343`. No wall-clock, entropy, timing precision, or reset claim follows from these inspected lines.
- Finite supplied seeds are truncated toward zero, then reduced by positive-modulus semantics and stored unsigned; e.g. supplied `-1` and `-1.9` store `0xffffffff`, and supplied `0` stores zero. Derived from `machine/bios/math.lua:27-32`, `machine/bios/math.lua:346`; paired numeric and word owners below.

## Paired representation and actually reached numeric/word/bit callsites

| Reached representation / operation | TypeScript actual owner | C++ actual owner |
| --- | --- | --- |
| Guest number | Number tag plus Float64Array scalar; numeric writes canonicalize NaN: `machine/ts/machine/cpu/value.ts:8-18`, `machine/ts/machine/cpu/value.ts:48-50`; `machine/ts/machine/cpu/value_slots.ts:25-28`, `machine/ts/machine/cpu/value_slots.ts:181-185` | `Value = uint64_t`; numeric values carry binary64 bits, numeric NaN canonicalized: `machine/cpp/machine/cpu/value.h:29`, `machine/cpp/machine/cpu/value.h:95-110`, `machine/cpp/machine/cpu/value.h:132-145` |
| Nonnumeric operand entering arithmetic | `readRKNumber` checks guest Number tag, otherwise NaN; register getter likewise: `machine/ts/machine/cpu/cpu.ts:3589-3596`; `machine/ts/machine/cpu/value_slots.ts:128-130` | `asNumber` reinterprets Value bits; tagged guest values have NaN encodings: `machine/cpp/machine/cpu/value.h:95-145`; dispatch uses `asNumber` at sites below |
| ADD/SUB/MUL/DIV for recurrence, scaling and ranges; FLOORDIV/MOD for truncation and modulus; UNM for negative truncation | `machine/ts/machine/cpu/cpu.ts:2551-2585`, `machine/ts/machine/cpu/cpu.ts:2659-2662`; helpers `machine/ts/spec/blua32/numeric.ts:1-13` | `machine/cpp/machine/cpu/cpu_dispatch.inl:171-212`, `machine/cpp/machine/cpu/cpu_dispatch.inl:308-311`; helpers `machine/cpp/spec/blua32/numeric.h:7-18` |
| `<` checks in trunc and argument guards | Numeric/numeric comparison only; otherwise false for these mixed operand checks: `machine/ts/machine/cpu/cpu.ts:2701-2733` | Numeric/numeric comparison only; otherwise false for these mixed operand checks: `machine/cpp/machine/cpu/cpu_dispatch.inl:356-367` |
| Word load: state read and clock-register read | LOAD_MEM/LOAD_MEM_D Word reads unsigned mapped word: `machine/ts/machine/cpu/cpu.ts:3051-3055`, `machine/ts/machine/cpu/cpu.ts:3080-3093`; `machine/ts/machine/memory/memory.ts:426-427` | Word reads `u32`, converted to guest number: `machine/cpp/machine/cpu/cpu_dispatch.inl:554-563`, `machine/cpp/machine/cpu/cpu_dispatch.inl:621-630`; `machine/cpp/machine/memory/memory.cpp:316-317` |
| Word store: recurrence update and either seed assignment | Word stores `getNumber(a) >>> 0`: `machine/ts/machine/cpu/cpu.ts:3020-3028`, `machine/ts/machine/cpu/cpu.ts:3117-3133`; `machine/ts/machine/memory/memory.ts:434-435` | Word stores `toU32(value)`: `machine/cpp/machine/cpu/cpu_dispatch.inl:579-592`, `machine/cpp/machine/cpu/cpu_dispatch.inl:646-659`; conversion `machine/cpp/machine/cpu/value.h:199-221`; mapped store `machine/cpp/machine/memory/memory.cpp:324-325` |
| Error branch raises the literal supplied argument | `machine/ts/machine/cpu/cpu.ts:4370-4380` | `machine/cpp/machine/cpu/cpu.cpp:2225-2227` |

- The two functions have **no guest bit-operator expression** (`&`, `|`, `~`, `<<`, `>>`). The reached bit/word boundary is the unsigned-32 word-store conversion, not a bitwise PRNG algorithm. Source: `machine/bios/math.lua:316-347`; paired stores/conversion above.
- Memory lowering can emit direct or displaced load/store according to address form; the exact emitted instruction selection for a built BIOS was not inspected. Direct lowering owner: `toolchain/ts/lua/compiler.ts:5222-5245`. The table identifies both relevant consumer forms without claiming a captured binary/disassembly.

## Source-derived representable odd cases (no execution)

- Nonnumeric values, including false, are not coerced from numeric strings and do not raise local arithmetic type errors: arithmetic produces NaN in the paired owners above. Thus `random(false)` returns NaN after advancing state, not a unit default and not either explicit range error; `random(nil, false)` returns the unit sample because upper is never examined. Sources: `machine/bios/math.lua:27-32`, `machine/bios/math.lua:321-338`; paired arithmetic/equality owners above.
- NaN input to `random` passes the `<` bound guard and propagates NaN through the result formula; `random(0)`, negative one-bound integers, and finite one-bound magnitudes below 1 after truncation take the positive-bound error. Sources: `machine/bios/math.lua:27-32`, `machine/bios/math.lua:326-338`; paired arithmetic/comparison owners above.
- For one-bound `+infinity`, the guard is false: output is +infinity when unit value is positive, NaN when unit value is zero. One-bound `-infinity` takes the positive-bound error. Sources: `machine/bios/math.lua:27-32`, `machine/bios/math.lua:326-331`; paired IEEE-number/arithmetic owners above.
- Supplied NaN, either infinity, and nonnumeric seed values reach a NaN modulus result, then store unsigned word zero. No local explicit seed error is present. C++ conversion explicitly maps encoded exponent `0x7ff` to 0; TS Word store uses `>>> 0`. Sources: `machine/bios/math.lua:27-32`, `machine/bios/math.lua:346`; `machine/ts/machine/cpu/cpu.ts:3130-3133`; `machine/cpp/machine/cpu/value.h:199-207`; paired MOD owners above.
- Seeding zero does not freeze generation: next update is `(0 * 1664525 + 1013904223) % 2^32`, so the next unit output is exactly `1013904223 / 4294967296`. This is arithmetic derived from source, not a runtime trace. Sources: `machine/bios/math.lua:316-318`, `machine/bios/math.lua:346`.

## Explicit gaps / exclusions

- Exact compiler acceptance/diagnostics for omitted arguments, surplus arguments, and particular argument expressions: not extracted here; runtime parameter handling above does not imply source-call acceptance.
- Reset/session/cart/thread ownership, when section initialization runs, save-state capture/restore of this word, and persistence across cart changes: not established; no claims made.
- Exhaustive table of every two-bound combination of infinities, huge rounded finite endpoints, nonnumeric object kinds, or externally changed globals: not extracted. Exact checked formulas and paired numeric owners are supplied instead.
- Exact generated BIOS addresses/opcodes/optimizations, externally altered storage, generic memory-fault paths, and `os.clock` device evolution: not inspected.
- Period, distribution quality, endpoint reachability over a full cycle, statistical guarantees, cryptographic properties, and seeding entropy: not established.

## Independent-audit dependency addendum

- R-E01. Both bound-rejection branches call the current uncaptured public global `error`; the module does not retain a private error alias. The stated raised String behavior therefore assumes the installed BIOS error definition. Sources: `machine/bios/math.lua:329,336`; dynamic named load `toolchain/ts/lua/compiler.ts:2827-2828` and dynamic call `:5670-5690`. Independent actual-source audit supplied these reached producer facts; no implementation change.
