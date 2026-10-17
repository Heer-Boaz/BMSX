# Next BIOS base slice: bounded source facts

Source baseline: `0620b06d2b` (`0620b06d2`), inspected while it was live HEAD. Final live HEAD is `24a37a1df`; the inspected BIOS/runtime/compiler files have no committed difference from that source baseline. Read-only extraction; only this scratch file written. No repository changes, implementation, chapter prose, execution, external-reference study, architecture document, or reference PDF. Scope is exactly the requested installed globals: `assert`, `rawequal`, `type`, `tostring`, `tonumber`, `next`, `pairs`, `ipairs`, `select`, `getglobal`, `setglobal`, `print`. The requested list contains twelve names, not thirteen; no thirteenth API has been invented. Protected-call/coroutine and metatable/rawget/rawset contracts remain their existing owners. Each numbered fact has one primary source path and contiguous line range. Mirror facts are separate rows rather than a second unbounded source bundle. Examples below are inspected source precedent, not newly executed evidence.

## Installation, advertised signatures, ordinary calls

- B01. BIOS entry explicitly requires `base` before publishing its other library globals. Source: `machine/bios/main.lua:4-12`.
- B02. Base captures `__bmsx_next`, `__bmsx_type`, `__bmsx_select`, and its error primitive in locals; the console dependency is also local. Source: `machine/bios/base.lua:1-12`.
- B03. Base installs `next`, `type`, `getglobal`, `setglobal`, and `select` as direct primitive aliases, not Lua wrappers. Source: `machine/bios/base.lua:205-216`.
- B04. Advertised descriptor signatures include `assert(value [, message])`, `getglobal(name)`, `setglobal(name, value)`, `ipairs(t)`; the global-access descriptions explicitly say live ordinary global registers, not Terminal variables/system registers. Source: `toolchain/ts/lua/builtin_descriptors.ts:30-35`.
- B05. Advertised descriptor signatures include `next(table [, index])`, `pairs(t)`, `print(...)`, `rawequal(v1, v2)`, `select(index, ...)`, `tonumber(value [, base])`, `tostring(value)`, `type(value)`. Source: `toolchain/ts/lua/builtin_descriptors.ts:38-49`.
- B06. Ordinary reference loads resolve their global namespace and emit GETGL or GETSYS after local/upvalue/reserved/unresolved handling; these public names are not replaced here by named host calls. Source: `toolchain/ts/lua/compiler.ts:2813-2828`.
- B07. Global resolution uses ordinary slots unless the name belongs to the explicitly supplied system-name set or the domain-specific vector rule. Source: `toolchain/ts/lua/compiler.ts:591-600`.
- B08. Ordinary dynamic call lowering evaluates its callee as a value when no module/static target applies, and evaluates every fixed argument for one result. Source: `toolchain/ts/lua/compiler.ts:5661-5683`.
- B09. A final expanding argument is compiled with open results and CALL uses open arguments; otherwise CALL encodes the fixed argument count. Source: `toolchain/ts/lua/compiler.ts:5685-5690`.
- B10. Calls/varargs, except require and proven-one-result optimized calls, are the compiler's expanding expressions. Do not infer all-result expansion in arbitrary expression positions. Source: `toolchain/ts/lua/compiler.ts:5754-5764`.
- B11. TS ordinary closure entry copies supplied fixed parameters, fills missing parameters with nil, and preserves only declared varargs after the fixed parameters; excess arguments of a non-vararg function are not parameters. Source: `machine/ts/machine/cpu/cpu.ts:3272-3296`.
- B12. C++ ordinary closure entry has the same fixed-parameter nil filling and declared-vararg shaping. Source: `machine/cpp/machine/cpu/cpu.cpp:3018-3042`.
- B13. TS fixed-result consumption truncates or nil-pads to the requested count; open-result consumption keeps the actual count, updating top exactly. Source: `machine/ts/machine/cpu/cpu.ts:3406-3418`.
- B14. Every ordinary function body receives the compiler's default return after its authored statements. Source: `toolchain/ts/lua/compiler.ts:1491-1501`.
- B15. That default return is **one nil**, not zero results: LOAD nil then RET count 1. This matters for `print`'s successful fallthrough; it is a compiled-source derivation, not an execution result measured here. Source: `toolchain/ts/lua/compiler.ts:5767-5770`.

## `assert`, `rawequal`

- A01. Actual installed signature is `assert(condition, ...)`, broader than the descriptor's message shorthand. Truthy success returns `condition, ...`: exactly the fixed condition plus every tail argument, retaining nil positions and tail count. A missing condition is the fixed parameter nil. Source: `machine/bios/base.lua:219-227`.
- A02. Failure with at least one tail argument raises **only the first tail value**, including explicit nil/false/non-string values; parentheses around `vm_select(1, ...)` force one argument to error. Failure with no tail raises the literal string `assertion failed!`. Source: `machine/bios/base.lua:219-227`.
- A03. TS truth is guest-tag truth: only Nil and False are falsey, so numeric zero and empty string are truthy. Source: `machine/ts/machine/cpu/value_slots.ts:157-160`.
- A04. C++ uses the same guest Nil/False truth rule. Source: `machine/cpp/machine/cpu/value.h:193-196`.
- A05. The TS error primitive throws the supplied first guest value unchanged; it does not stringify it. Source: `machine/ts/machine/cpu/cpu.ts:4370-4380`.
- A06. The C++ error primitive likewise throws its first guest value unchanged. Source: `machine/cpp/machine/cpu/cpu.cpp:2225-2227`.
- A07. Ordinary source precedent explicitly assigns four results from `assert(0, 'kept', nil, 7)`, counts them with select, and catches an explicit failure message. Source: `tests/carts/emptycart/bios_runtime_assert.lua:5-9`.
- A08. Actual signature `rawequal(left, right)` returns exactly one Boolean from the ordinary `==` operator; no conversion or separate metatable protocol appears in this wrapper. Missing operands become nil under B11/B12; extra arguments are not parameters. Source: `machine/bios/base.lua:230-232`.
- A09. TS equality rejects differing guest tags; same Nil/False/True tags compare equal; Numbers use numeric equality (NaN unequal, signed zeros equal); Strings/builtins use their scalar IDs; Table/Closure/Thread use guest reference identity. Source: `machine/ts/machine/cpu/cpu.ts:3569-3585`.
- A10. C++ EQ uses double equality when both operands are numeric and encoded Value equality otherwise; it does not dispatch an equality metamethod. This agrees at the guest-produced representation boundary, not a portable host-identity ABI claim. Source: `machine/cpp/machine/cpu/cpu_dispatch.inl:341-349`.
- A11. Ordinary source precedent tests same versus distinct Tables and Number/String/nil-versus-false equality through `rawequal`. Source: `tests/carts/emptycart/bios_runtime_assert.lua:11-14`.

## `type`, `tostring`

- T01. TS `type` accepts any guest category; an omitted argument is Nil and extra arguments are ignored by the dispatch. Source: `machine/ts/machine/cpu/cpu.ts:3604-3608`.
- T02. Its single result is an interned String derived from the guest tag. Source: `machine/ts/machine/cpu/cpu.ts:4194-4195`.
- T03. Exact names are `nil`, `boolean` for False/True, `number`, `string`, `thread`, `table`, and `function` for Closure/BuiltinFunction. Source: `machine/ts/machine/cpu/value.ts:149-166`.
- T04. Native tag-to-public-type names agree, including Closure/BuiltinFunction both becoming `function`. Source: `machine/cpp/machine/cpu/value.h:481-494`.
- T05. Actual installed `tostring(value)` returns exactly one String using `'' .. value`, not a separate formatter dispatch or authored `__tostring` lookup. Missing value therefore enters as nil; extra arguments are not parameters. Source: `machine/bios/base.lua:235-237`.
- T06. Two-operand concat source lowering selects CONCAT. Source: `toolchain/ts/lua/compiler.ts:5554-5559`.
- T07. TS CONCAT converts its two operands with the central scalar-value conversion, concatenates left then right, interns the result, and writes a String. Source: `machine/ts/machine/cpu/cpu.ts:2630-2640`.
- T08. C++ CONCAT performs the corresponding ordered central conversion and String interning. Source: `machine/cpp/machine/cpu/cpu_dispatch.inl:281-286`.
- T09. Exact scalar texts are `nil`, `false`, `true`, String contents unchanged, `thread`, `table`, and `function` for both callable categories; these are not addresses or structural dumps. Number NaN/infinities become `nan`, `-inf`, `inf`; finite Numbers delegate to the central formatter. Source: `machine/ts/machine/cpu/value.ts:182-205`.
- T10. Native scalar conversion agrees for every listed guest category and the nonfinite spellings. Source: `machine/cpp/machine/cpu/value.cpp:9-29`.
- T11. Finite default formatting preserves positive/negative zero as `0`/`-0`; exact integer magnitudes strictly below 1000000 use an integer shortcut. No formatting argument exists in this entrypoint. Source: `machine/ts/common/number_format.ts:77-89`.
- T12. Native finite zero/integer-shortcut handling agrees. The full six-digit normalization/rounding algorithm is already CPU-facts territory, not re-extracted into this slice. Source: `machine/cpp/common/number_format.h:64-86`.
- T13. Ordinary source precedent tests nil/Boolean, Number/String, Table/Closure `tostring` results. Source: `tests/carts/emptycart/bios_runtime_assert.lua:16-18`.
- T14. Actual BIOS code uses `type(name) == 'table'` as an ordinary public call, not a host object classifier. Source: `machine/bios/compiler/semantic.lua:10-15`.

## `tonumber`

- N01. Actual installed signature is `tonumber(value, base)`, advertised optional base. Missing base and explicit nil take the same branch: Number returns unchanged, String goes to decimal parser, every other value returns exactly one nil. Missing value is therefore also nil. Source: `machine/bios/base.lua:240-250`.
- N02. With nonnil base, value must be String or the wrapper raises exactly `bad argument #1 to tonumber (string expected)`. It computes `integer_base = base // 1`, raises `bad argument #2 to tonumber (integer expected)` when that differs from base, then raises `bad argument #2 to tonumber (base out of range)` unless it is 2..36 inclusive. Source: `machine/bios/base.lua:251-261`.
- N03. These checks occur in that order. The wrapper has **no explicit base-type check**; do not replace its arithmetic/equality path with a stock-Lua argument coercion/error promise. Its `type` and explicit `error` calls are ordinary global references, unlike captured primitive error in `assert`. Source: `machine/bios/base.lua:240-261`.
- N04. Whitespace recognition is literal code 32 or codes 9..13 inclusive; skipping is over that predicate only. Source: `machine/bios/base.lua:14-40`.
- N05. Digits are ASCII `0`..`9`, `A`..`Z`, `a`..`z`, with either alphabetic case mapping to 10..35; any other code returns nil. Source: `machine/bios/base.lua:42-53`.
- N06. Explicit-base parsing skips leading whitespace, permits one leading `+`/`-`, accumulates digits by `value * base + digit`, requires at least one valid digit, permits only trailing whitespace, and otherwise returns one nil. There is no prefix-stripping branch (so no implicit `0x` privilege for base 16). Source: `machine/bios/base.lua:67-100`.
- N07. Default String parsing permits leading whitespace and one sign. Signed `0x`/`0X` selects integer hexadecimal accumulation, requires a hex digit and then only trailing whitespace. No hex-fraction or hexadecimal-exponent branch is present. Source: `machine/bios/base.lua:102-140`.
- N08. The decimal branch accumulates decimal integer digits and, optionally, a dot followed by fractional decimal digits; at least one digit must exist across both parts. Thus source supports `.25` and `12.` as well as `12.25`, not a bare dot. Source: `machine/bios/base.lua:141-168`.
- N09. Optional `e`/`E` exponent permits one sign, requires at least one decimal exponent digit, applies decimal scaling, and then requires trailing whitespace/end. Unconsumed non-whitespace makes the parse return nil. Source: `machine/bios/base.lua:169-202`.
- N10. Decimal scaling is repeated multiply-by-10 or divide-by-10 while changing the parsed Number exponent one step at a time; there is no iteration cap, finite-value rejection, or library parse call. No bounded running-time/ideal-decimal/exhaustive numeric-range promise follows. Source: `machine/bios/base.lua:55-65`.
- N11. Actual ordinary test source exercises numeric identity, signed decimal exponent, leading fraction, explicit bases, default hex prefixes, invalid strings/Boolean, and rejection of numeric explicit-base input, fractional base, and base 37. These assertions were not run here. Source: `tests/carts/emptycart/bios_runtime_assert.lua:20-27`.
- N12. Actual BIOS lexer calls the ordinary `tonumber(text)` for parsed token text. Source: `machine/bios/compiler/lexer.lua:174-180`.

## Iteration: `next`, `pairs`, `ipairs`

- I01. `next(table [, key])` requires Table; missing/nil/non-Table target faults ITERATE_NON_TABLE. Omitted key means nil; explicit key's guest representation is passed unchanged. Only those two parameters are consumed. Source: `machine/ts/machine/cpu/cpu.ts:4173-4188`.
- I02. Native `next` agrees on Table requirement and returns exactly two results `(key, value)` on success or exactly one nil on exhaustion; no zero-result or two-nil exhaustion tuple is emitted. Source: `machine/cpp/machine/cpu/cpu.cpp:2093-2104`.
- I03. TS Table success writes exactly key/value, preserving their guest representations (array keys are Numbers). Source: `machine/ts/machine/cpu/table.ts:709-745`.
- I04. TS primitive exhaustion emits exactly one nil. Source: `machine/ts/machine/cpu/cpu.ts:4189-4191`.
- I05. For the current table storage, nil begins at live array slots ascending, then live hash slots. A continuation array slot inside capacity resumes after that slot even if it is now nil. A non-array continuation key not recognized in current continuation storage terminates rather than raising an invalid-key fault. An absent live mapping alone does not establish that absence from continuation storage. This is a storage-dependent owner algorithm, **not a universal insertion/sort/iteration-order API guarantee**. Source: `machine/ts/machine/cpu/table.ts:990-1020`.
- I06. Native Table iteration has the same array-then-hash, continuation-slot, and missing-key termination algorithm. No cross-capacity Table length conclusion is involved. Source: `machine/cpp/machine/cpu/table.cpp:574-612`.
- I07. `pairs(target)` itself accepts any supplied/missing target without validating it and returns exactly `(next, target, nil)`. It reads the current ordinary global `next`; it does not inspect `__pairs`. A bad target fails when the returned iterator runs, not when this tuple is constructed. Source: `machine/bios/base.lua:294-296`.
- I08. `ipairs(target)` itself likewise does not validate target and returns exactly `(ipairs_iterator, target, 0)`. The iterator is the captured local function, not a global name. Source: `machine/bios/base.lua:279-291`.
- I09. The ipairs iterator computes `index + 1`, performs **ordinary indexing** `target[next_index]`, returns exactly one nil when that value is nil, otherwise exactly `(next_index, value)`. False is a live value, not a stop. It does not consult length or `__ipairs`. Source: `machine/bios/base.lua:279-286`.
- I10. TS ordinary indexing accepts Table or routes String to the CPU's String-index table, with non-Table/non-String fault INDEX_NON_TABLE; a Table metatable follows ordinary index resolution. Therefore the wrapper's source must not be rewritten as a raw table-only read promise. Source: `machine/ts/machine/cpu/cpu.ts:619-652`.
- I11. Native ordinary indexing agrees on Table/String and INDEX_NON_TABLE routing. String acceptance here is not a substring/indexed-character promise. Source: `machine/cpp/machine/cpu/cpu.cpp:3243-3257`.
- I12. Generic-for compilation obtains three iterator values, repeatedly calls iterator(state, control), ends on first result nil (not generic falseyness), and stores the first result as next control. Source: `toolchain/ts/lua/compiler.ts:4528-4571`.
- I13. Actual ordinary source iterates a sequence with a nil hole via `ipairs` and expects only its first two entries. Its pairs test counts/sums all three mixed-category keys without asserting order. Source: `tests/carts/emptycart/bios_runtime_assert.lua:32-49`.
- I14. Actual ordinary source calls `next` first-class through pcall with explicit nil and tests that pairs' first return is the installed next function. Source: `tests/carts/emptycart/bios_runtime_assert.lua:51-53`.
- I15. Cartlib's actual clear-map loop repeatedly calls `next(map)` with omitted key, tests nil, then deletes that yielded mapping; it does not continue from a removed hash key. Source: `cartlib/util/clear_map.lua:1-8`.
- I16. Actual cartridge gameplay source nests ordinary `pairs(templates)` and `ipairs(template.world_entrances)` loops. Source: `carts/pietious/session.lua:9-17`.

## `select`

- S01. Exact String selector `'#'` returns one Number equal to the remaining argument count, including every nil. Any other non-Number selector, including missing/nil and other Strings, faults INVALID_ARGUMENT. Source: `machine/ts/machine/cpu/cpu.ts:4286-4303`.
- S02. Numeric selector is converted to signed 32-bit by `selectorScalar | 0`, not checked for integer/range; negative selectors are relative to end via `count + selector + 1`. Source: `machine/ts/machine/cpu/cpu.ts:4304-4307`.
- S03. Results are the selected suffix unchanged, including nils. The bounds filter only emits argument indexes 1..count, so selector zero/too-negative emits all remaining arguments and selector above count emits zero results. Source: `machine/ts/machine/cpu/cpu.ts:4308-4316`.
- S04. Native select agrees on exact '#', invalid-selector fault, toI32 conversion, negative-offset rule, and filtered suffix copying. Source: `machine/cpp/machine/cpu/cpu.cpp:2152-2173`.
- S05. Actual ordinary source counts a nil-containing tuple and assigns the selected suffix to two locals. Source: `tests/carts/emptycart/bios_runtime_assert.lua:63-66`.
- S06. Actual BIOS source loops to `select('#', ...)` and obtains each tail value with `select(index, ...)`. Source: `machine/bios/math.lua:68-73`.

## `getglobal`, `setglobal`

- G01. Getter requires an uncoerced String name or faults INVALID_ARGUMENT; returns exactly one live ordinary stored guest value, or one nil for an unknown name. Further arguments are unused. Source: `machine/ts/machine/cpu/cpu.ts:3622-3629`.
- G02. Setter requires an uncoerced String name or faults INVALID_ARGUMENT, stores its second value unchanged, and treats omitted value as nil. It emits **zero primitive results**; further arguments are unused. Fixed-result consumers can still observe caller nil padding. Source: `machine/ts/machine/cpu/cpu.ts:3631-3638`.
- G03. Native dispatch agrees on String-name checking, live getter, direct second-value setter, and zero setter results. Source: `machine/cpp/machine/cpu/cpu.cpp:1681-1688`.
- G04. Native missing primitive arguments are nil, which establishes omitted setter value and omitted-name behavior rather than reading unspecified host memory. Source: `machine/cpp/machine/cpu/value.h:337-343`.
- G05. TS setter addresses the ordinary name-to-slot map, allocates a slot for a previously unknown name even when storing nil, and writes its guest representation; system-global setter is a different map/store. Source: `machine/ts/machine/cpu/cpu.ts:2155-2181`.
- G06. Native ordinary setter similarly inserts or overwrites ordinary global slots, separate from the system setter. Source: `machine/cpp/machine/cpu/cpu.cpp:731-746`.
- G07. Native getter returns the existing ordinary slot or nil for an unknown name. Source: `machine/cpp/machine/cpu/cpu.cpp:753-758`.
- G08. Actual code precedent exists as Terminal-session source strings: set a named global, obtain a function/value with getglobal, share Table identity, store false, omit setter value, and write before a later error. This is explicitly session-evaluation precedent, not an invented cartridge example or a claim that session locals are globals. Source: `tests/conformance/terminal/run.ts:36-47`.
- G09. Ordinary embedded Lua test source writes names with setglobal. Source: `tests/helpers/frame_evaluation.ts:201-203`.
- G10. That embedded test later reads those names with getglobal while separately evaluating frame/local names. Source: `tests/helpers/frame_evaluation.ts:216-224`.

## `print`

- P01. Actual signature `print(...)` counts all arguments, writes one tab between positions (no leading/trailing separator), calls current ordinary global `select` for counting/selection and current ordinary global `tostring` for one selected value at each position, and then calls console.end_line. Explicit nil arguments are counted/printed; no arguments still end a line. There is no explicit return; B14/B15 establish successful compiled fallthrough as one nil, not a stock-Lua zero-result assertion. Source: `machine/bios/base.lua:265-275`.
- P02. `console.write` sends each extracted code to system-print MMIO and records it in the firmware history ring; it does not itself append a newline. Source: `machine/bios/tty/console.lua:19-38`.
- P03. `console.end_line` appends newline code 10 to history and writes 1 to the system-print-flush register; it is not a host file-stream API. Source: `machine/bios/tty/console.lua:40-52`.
- P04. Exact console constants include print-character MMIO 0x08010230, print-flush MMIO 0x08010234, newline 10, and an 8192-unit history capacity. Source: `machine/bios/tty/console.lua:6-13`.
- P05. Actual ordinary tests call `print('bios', nil, 7)` and `print('é')`; these are source precedent only, not captured output evidence here. Source: `tests/carts/emptycart/bios_runtime_assert.lua:29-30`.
- P06. Actual BIOS boot prints ordinary String messages through public `print`. Source: `machine/bios/main.lua:78-80`.

## Incremental machine cycles and error texts

- C01. Primitive metadata for Next/Type and GetGlobal/SetGlobal/Select uses builtin base cost 1 with perArg/perRet 0. These are alias costs, not total public-wrapper or CALL costs. Source: `machine/ts/machine/cpu/value.ts:103-142`.
- C02. Native corresponding primitive metadata agrees on those costs. Source: `machine/cpp/machine/cpu/value.h:63-93`.
- C03. TS normal builtin entry charges the primitive's base once before routing. Thus each direct alias above adds +1 builtin cycle; scanning/copy loops do not imply per-element metadata charges. Source: `machine/ts/machine/cpu/cpu.ts:3841-3848`.
- C04. Native normal builtin entry likewise charges once. Source: `machine/cpp/machine/cpu/cpu.cpp:1876-1885`.
- C05. TS public fault strings include `Attempted to iterate a non-table value.` and `Invalid argument.` for the two scoped primitive argument-fault reasons. Source: `machine/ts/machine/cpu/cpu.ts:502-505`.
- C06. Native corresponding fault strings agree. Source: `machine/cpp/machine/cpu/cpu.cpp:377-380`.

## Necessary unresolved details / limits for authorship

- U01. No source disagreement was found in the narrowly inspected primitive aliases, truth, equality, scalar conversion, normal indexing, or global maps. This does not close any existing CPU stopped question. In particular, **no Table length/cross-capacity mutation guarantee or universal iteration order may be inferred**; ipairs does not read length at all (I09), and next follows current storage (I05/I06).
- U02. Exact diagnostic promises for every representable nonnumeric/NaN/infinite `tonumber` base have not been exhaustively paired/executed. Publish the actual wrapper formula/order (N02/N03), supported Number base range, and literal wrapper errors, not a new coercion contract. Very large parsed exponents can make N10's loop unbounded in practical or representable-state terms; termination/ideal decimal arithmetic is not established.
- U03. A fixed total public cycle count for Lua wrappers (`assert`, `rawequal`, `tostring`, `tonumber`, `pairs`, `ipairs`, `print`) is not established. They are ordinary compiled code; branches, parser loops, number formatting, result shaping, indexing, and print/MMIO work must not be collapsed into the aliases' +1 cost. No throughput/GC benchmark was run.
- U04. `print`'s one-nil result is ordinary compiler source derivation (B14/B15), not a paired BIOS execution/probe. If a chapter needs observable exact-count output examples, measure the actual compiled BIOS path first. Likewise no console transcript, Unicode encoding catalogue, terminal rendering, or host-sink behavior has been empirically accepted by this extraction.
- U05. No public `_G`, file APIs, runtime require, implicit host output stream, metatable protocol compatibility, additional loader/library surface, or session/frame-local equivalence was established. Do not widen this slice by stock Lua analogy.
- U06. Inventory discrepancy is explicit: the parent's requested list is **12 names**. Counts below refer to those twelve, not an unlisted thirteenth.

Counts: 96 sourced numbered facts; 6 explicit scope/gap records; 12 public global names. Mirror disposition: no new scoped disagreement found. Existing unrelated working-tree edits preserved.

## Root follow-through: decimal arithmetic order and history units

# Bounded decimal arithmetic follow-through

Root read live24a37a1df BIOS owner. Source-only facts for the already assigned
conversion paragraph; not an independent execution or ideal-decimal guarantee.

- N13. Decimal integer value starts0 and consumes each integer digit in source
  order as value=value*10+digit. Source machine/bios/base.lua:141-151.
- N14. Fractional scanning starts divisor10; for each fractional digit, it adds
  digit/divisor to the current value, then multiplies divisor by10. This is not
  concatenating all digits into an integer followed by one final division.
  Source machine/bios/base.lua:152-164.
- N15. Decimal exponent magnitude starts0 and consumes its digits in source
  order as exponent=exponent*10+digit. The signed magnitude goes to the existing
  repeated scaling helper. Source machine/bios/base.lua:181-195.
- N16. After scaling and trailing-space/end validation, parser applies leading
  sign by returning sign*value. Source machine/bios/base.lua:194-202.

P07. History storage is declared `u8[history_capacity]`; with P04's8192 capacity,
this is8192 one-byte history entries, not8192 language Strings or a second
8192-byte SYSTEM transport queue reservation. Source
`machine/bios/tty/console.lua:15-17`. Console writes replace codes above255 by
code63 in history while separately writing the original code to the print
register. Source `machine/bios/tty/console.lua:19-38`. Transport and history
are distinct owning buffers; SYSTEM's accepted chapter defines its own queue.


## Nonauthor continuation precision

I17. The continuation-node search can recognize both a retained key and a dead
object-key identity recorded in a retained node. Therefore no live mapping for
a key does not by itself prove that next stops from that key. Source
`machine/ts/machine/cpu/table.ts:961-983`. Native has the same recognized-node
cases at `machine/cpp/machine/cpu/table.cpp:102-124`. This corrects the original
ambiguous I05/prose use of "missing"; no mutation-safe traversal promise follows.

G11. "System-global" in the ordinary global owner is the separate language
system-global map, not SYSTEM's MMIO control block. The two setter maps/stores
are separate at `machine/ts/machine/cpu/cpu.ts:2155-2181`. CPU's GETSYS/SETSYS
reference, not the SYSTEM controller's port table, owns that namespace. This
corrects an author cross-reference; it creates no cartridge import or wrapper.


## Public-reader follow-through

A12. The assert body uses captured vm_select/vm_error, not the ordinary select
and error globals. Public replacement of those two names does not replace
these captured calls. Source `machine/bios/base.lua:219-227`; capture identities
are already B02 at `machine/bios/base.lua:1-12`.

S07. Native toI32 converts through toU32: truncate finite fractional parts toward
zero, retain the low32 integer bits, and interpret signed; encoded nonfinites
return zero. Source `machine/cpp/machine/cpu/value.h:199-229`. Select applies that
conversion at `machine/cpp/machine/cpu/cpu.cpp:2164-2168`.
S08. TS Select applies the signed-word `selectorScalar | 0` conversion before
negative-offset/range handling. Source `machine/ts/machine/cpu/cpu.ts:4304-4307`.
The bounded common execution includes fractional1.9, wrapping4294967297, NaN
and positive infinity selectors; every one selects from position1 or0 as its
converted word determines. These concrete cases are execution scope, not an
exhaustive new numeric-conversion proof.
