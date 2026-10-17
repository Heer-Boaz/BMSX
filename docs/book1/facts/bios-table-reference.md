# BIOS table library: finite next-slice source facts

Prepared against runtime/BIOS/compiler baseline `24a37a1df`; parent reports those owners unchanged at `1e8e3f340`. Read-only extraction. No execution, runtime repair, repository edits, publisher work, chapter prose, architecture-document reading, or reference-PDF reading performed. Source assertions below are precedents, not newly executed results. This sheet is restricted to the six installed functions and their necessary shared leaves.

## Installation and advertised signatures

- Boot installs the module's returned table in public global `table` after loading base: `machine/bios/main.lua:4-6`.
- The module requires base, creates a new table, defines precisely `pack`, `insert`, `remove`, `concat`, `unpack`, `sort`, and returns that table: `machine/bios/table.lua:1-165`.
- Tooling advertises `table.pack(...)`, `table.insert(list [, pos], value)`, `table.remove(list [, pos])`, `table.concat(list [, sep [, i [, j]]])`, `table.unpack(list [, i [, j]])`, and `table.sort(list [, comp])`: `toolchain/ts/lua/builtin_descriptors.ts:60-65`. These descriptors do not add runtime argument validation.
- Missing fixed parameters arrive as nil; fixed-parameter functions do not retain surplus arguments, while flagged vararg functions retain the surplus count and values: TS `machine/ts/machine/cpu/cpu.ts:3275-3297`; native `machine/cpp/machine/cpu/cpu.cpp:3017-3043`.

## Essential result-count rule: do not import stock Lua

- A bare `return` compiles to one nil result, not an empty tuple: host producer `toolchain/ts/lua/compiler.ts:4372-4377`; firmware producer `machine/bios/compiler/compiler.lua:1133-1146`.
- Falling off a function also produces one nil: host producer `toolchain/ts/lua/compiler.ts:5767-5770`; firmware producer `machine/bios/compiler/compiler.lua:1738-1744`.
- A final expanding call forwards its tuple, including a genuinely empty tuple: host producer `toolchain/ts/lua/compiler.ts:4392-4408`; firmware producer `machine/bios/compiler/compiler.lua:1151-1159`.
- Thus successful `pack` returns one table; `insert` one nil; `remove` exactly one value, possibly nil; `concat` one string; `unpack` zero or the selected number of slots; `sort` one nil. Function return sites: `machine/bios/table.lua:4-9,13-26,29-38,66-78,90-98,145-163`; one-nil producer rules immediately above apply to insert/sort.

## Shared # contract — mandatory STOP, not an editorial omission

- All five target-consuming functions read `#target`: append insert at `machine/bios/table.lua:15-16`, positioned insert at `:21`, remove at `:30`, concat at `:67`, unpack at `:91`, sort at `:146`. Pack instead uses `packed.n` as its loop bound at `:5-7`.
- LEN reads the Table's mutation-maintained cached length directly, not number of mappings, largest numeric key, or a freshly searched universal sequence border: TS `machine/ts/machine/cpu/cpu.ts:2672-2685`; native `machine/cpp/machine/cpu/cpu_dispatch.inl:319-330`, `machine/cpp/machine/cpu/table.cpp:547-549`.
- **STOP: a common default target-length value is unresolved.** Native generic numeric array stores call `setArraySlot`, whose boundary-refill scan ends at physical array capacity: `machine/cpp/machine/cpu/table.h:172-184`. TS generic store calls a scan that continues through hash-held consecutive numeric keys: `machine/ts/machine/cpu/table.ts:801-812,1426-1440`.
- The affected native CPU SETT fast path really reaches that array-only setter: `machine/cpp/machine/cpu/cpu_dispatch.inl:152-161` -> `machine/cpp/machine/cpu/table.h:36-43`. The TS SETT path reaches the cross-hash store: `machine/ts/machine/cpu/cpu.ts:2502-2540,729-749` -> `machine/ts/machine/cpu/table.ts:801-812`.
- Public rawset is also affected: TS builtin invokes `target.store` at `machine/ts/machine/cpu/cpu.ts:4250-4283`; native builtin invokes `Table::set` at `machine/cpp/machine/cpu/cpu.cpp:2142-2149`, whose in-array branch uses `setArraySlot` at `machine/cpp/machine/cpu/table.cpp:411-421`. Native internal `rawSet` likewise uses it at `machine/cpp/machine/cpu/table.cpp:255-262`.
- SETI is not interchangeable evidence for this problem: native SETI uses `setIntegerArrayKey` at `machine/cpp/machine/cpu/cpu_dispatch.inl:94-101`, which calls the cross-hash `updateArrayLengthFrom` through `machine/cpp/machine/cpu/table.h:53-59,186-195`; the scanner is `machine/cpp/machine/cpu/table.cpp:49-67`.
- Library variable-key assignments are not a hypothetical unrelated path: the host compiler emits SETT for nonconstant table targets at `toolchain/ts/lua/compiler.ts:4218-4224`; the firmware compiler does the same at `machine/bios/compiler/compiler.lua:1071-1078`. Relevant library writes are pack `machine/bios/table.lua:7`; append/shift/final insert `:16,23,25`; remove `:34,36`; sort swaps `:124-125`.
- Existing retained execution evidence reports actual SETT/LEN results **TS 5 -> 1 -> 5, native 5 -> 1 -> 4**, both 33 charged cycles, for capacity4/hash8, fill1..5/delete2/refill2. This is earlier evidence, not executed by this extractor: `docs/book1/facts/cpu-values-execution.md:73-92`. Earlier fact-sheet STOP: `docs/book1/facts/cpu-table-semantics.md:45-53`.
- Editorial disposition: describe each algorithm in terms of the `L = #target` it actually captures; mark shared claims about default append/removal position, default concat/unpack end, negative/zero normalization involving L, sort extent, and final `#target` after mutations **STOP where they require this unresolved common L**. Do not silently restrict to a friendly dense-table case or assert a universal common length. Positive explicit concat/unpack bounds can establish a procedural range without establishing a universal # value; both functions still execute the length read first: `machine/bios/table.lua:66-77,90-97`.

## table.pack(...)

- Actual parameters are all varargs. It creates `{ n = select('#', ...) }`, writes indices1..n from `select(index, ...)`, returns that new table: `machine/bios/table.lua:4-9`.
- Zero arguments give n=0 and no numeric writes. Explicit nil arguments count in n and their numeric stores are nil/deletions, so n records tuple width rather than promising `#packed == n`: `machine/bios/table.lua:5-7`; select count producer TS `machine/ts/machine/cpu/cpu.ts:4286-4299`, native `machine/cpp/machine/cpu/cpu.cpp:2152-2157`.
- Missing admissible numeric keys read nil, rather than representing separately retrievable nil-valued mappings: TS `machine/ts/machine/cpu/table.ts:149-180`; native `machine/cpp/machine/cpu/table.cpp:393-408`. The constructor's n field is therefore the actionable width for preserving nils, including trailing nils.
- `select(index, ...)` produces the suffix, but the single assignment consumes its first result. Select's numeric suffix loops: TS `machine/ts/machine/cpu/cpu.ts:4304-4317`; native `machine/cpp/machine/cpu/cpu.cpp:2164-2173`. Fixed result delivery copies only the requested count: TS `machine/ts/machine/cpu/cpu.ts:3406-3418`; native `machine/cpp/machine/cpu/cpu.cpp:3127-3139`.
- Cost caution: the source makes n numeric writes, but each loop forwards the whole vararg tuple and select constructs a suffix; it is not evidence for linear total host work. Vararg copy leaf TS `machine/ts/machine/cpu/cpu.ts:2896-2916`; native `machine/cpp/machine/cpu/cpu_dispatch.inl:475-487`; suffix leaves above. No benchmark run or exact allocation/cycle bound is claimed.

## table.insert(target, ...)

- Branch selection depends on the **number** of trailing arguments, not nilness: exactly one argument after target appends that argument at `#target + 1`; `table.insert(t, nil)` follows this append branch and stores nil. Every other trailing count follows the positioned branch: `machine/bios/table.lua:13-20`.
- Positioned form obtains position from the first trailing argument using `// 1`, obtains value from the second, captures L, shifts indices L down through position inclusively to index+1, then writes value at position: `machine/bios/table.lua:19-25`.
- More than two trailing arguments do not produce an arity error; only the first two selected values participate in the positioned algorithm. No trailing arguments also enter this branch, with select yielding no values for the locals (nil-padded fixed results); there is no explicit arity/type/bounds check: `machine/bios/table.lua:13-25`; select suffix TS `machine/ts/machine/cpu/cpu.ts:4304-4317`; fixed-result nil padding `machine/ts/machine/cpu/cpu.ts:3406-3418`.
- Position is floored, not relative to end and not clamped. Position0/negative values are ordinary numeric keys and can cause shifts through those keys. Position>L skips the backwards loop and writes that key; it does not pad a checked sequence or raise a library bounds error: `machine/bios/table.lua:19-25`.
- Shift direction is descending; the final position store occurs only after the loop. The algorithm mutates in place and does not first copy the table or arrange rollback on a later fault: `machine/bios/table.lua:22-25`.
- Both append's bare return and positioned fallthrough yield one nil, using the producer rules above: `machine/bios/table.lua:15-26`.
- The append key, shift count, and resulting length depend on unresolved L; keep the shared-length STOP visible: `machine/bios/table.lua:16,21-25`.

## table.remove(target, position_arg)

- Captures L first. Omitted or explicit nil position means L; otherwise position_arg is floored with `//1`. It reads and retains `target[position]`, then shifts index position through L-1 upwards from index+1, then **always** writes nil at key L, then returns the retained value: `machine/bios/table.lua:29-37`.
- Return width is exactly one even when the retained value is nil; on an empty ordinary table the default position and final nil store use key0: `machine/bios/table.lua:30-37`. Do not document an empty tuple for this case.
- No bounds or integer-exactness check occurs. Positions0/negative can shift through those numeric keys; position>L skips shifts but still deletes keyL and returns whatever was read at the requested key. Position L+1 is not a special no-op in this implementation: `machine/bios/table.lua:31-36`.
- In-place write order is increasing shift indices, followed by deletion at the original L. A later fault does not undo earlier writes; no transactional wrapper exists in this body: `machine/bios/table.lua:33-36`.
- Default position, shift extent, tail deletion key, and final length require the unresolved shared-L STOP, not stock table.remove guarantees: `machine/bios/table.lua:30-36`.

## Shared concat/unpack index normalization

- Both capture `length = #target` even when all endpoints are explicitly supplied. Omission or explicit nil start means1; omission or nil end means L: `machine/bios/table.lua:66-69,90-93`.
- For each nonnil endpoint, compute `index = value // 1`; positive index stays unchanged, negative index becomes L+index+1, zero maps to the caller-provided zero replacement. Start's replacement is1; end's replacement isL: `machine/bios/table.lua:41-49,68-69,92-93`.
- Thus explicit start0 means1, explicit end0 meansL, and -1 meansL; negative values are floored before relative conversion. There is no clamp to1..L, and no library bounds error: `machine/bios/table.lua:41-49,66-77,90-97`.
- Numeric NaN compares neither >0 nor <0 and therefore takes the zero replacement in this helper. This is source-derived, not executed here: `machine/bios/table.lua:42-49`. Infinite/very large endpoints have no function-local finite/range cap.
- STOP common numeric results for negative/zero/default normalization wherever a common L is required: `machine/bios/table.lua:47-49,68-69,92-93`.

## table.concat(target, separator_arg, start_arg, end_arg)

- After length and normalized endpoints, if end<start it returns one empty string **before separator conversion or element reads**: `machine/bios/table.lua:66-76`.
- Omitted/nil separator becomes `''`; any other separator is passed to installed tostring, not limited to strings: `machine/bios/table.lua:73-76`.
- A leaf reads target[first]. If nil it contributes `''`; otherwise it contributes tostring(value). Intermediate joins include separators regardless of nil leaf content; therefore nil holes do not eliminate separators: `machine/bios/table.lua:53-62`.
- Nonempty range recursively splits at `(first + last) // 2`, evaluates left range, separator, right range, and returns one joined string. No n field, pairs traversal, or omission of holes is involved: `machine/bios/table.lua:53-62,77`.
- The algorithm does not mutate target. Ordinary finite integer ranges have one leaf read per selected index and balanced recursion; recursive substrings and concatenation produce intermediate strings, not a single checked linear-byte append primitive: `machine/bios/table.lua:53-62`.
- Positive explicit endpoints outside the populated portion still address those numeric keys; absent values contribute empty text. No endpoint is clamped to the cached length: `machine/bios/table.lua:41-49,53-62,66-77`.

## table.unpack(target, start_arg, end_arg)

- After shared normalization, end<start forwards `select(1)` with no following values, producing **zero results**, unlike bare return: `machine/bios/table.lua:90-97`; select loops TS `machine/ts/machine/cpu/cpu.ts:4304-4317`, native `machine/cpp/machine/cpu/cpu.cpp:2164-2173`.
- Otherwise recursively returns target[index] followed by the tuple from index+1, with one-value base case at last. For a completing finite integer interval [first,last], result count is last-first+1, including nil slots and trailing nil slots: `machine/bios/table.lua:81-87,97`.
- It reads numeric keys, not n and not iteration order. To unpack a pack result preserving trailing nils, explicit end `packed.n` is the relevant field produced by pack, rather than assuming `#packed`: `machine/bios/table.lua:5-7,81-97`.
- Recursion is one call per selected slot, not balanced; return delivery copies widening result tuples. No function-local result-count/recursion cap is checked: `machine/bios/table.lua:81-87`; paired return delivery TS `machine/ts/machine/cpu/cpu.ts:3406-3418`, native `machine/cpp/machine/cpu/cpu.cpp:3127-3139`. This is a cost warning, not an executed maximum-size claim.
- It does not mutate target. Output extent for omitted end, or relative endpoints, retains the shared-L STOP: `machine/bios/table.lua:90-97`.

## table.sort(target, compare)

- Captures L once. If L<2, returns immediately without reading/calling compare. Omitted or explicit nil compare selects default `<`; false is not absence and would be called when a comparison is needed: `machine/bios/table.lua:145-158`.
- First scans adjacent pairs from index2 while the next element is **not less** than its predecessor, using either `<` or compare(next,previous). Only when the scan finds an inversion does it invoke quicksort over1..L: `machine/bios/table.lua:150-161`.
- An already ordered list of captured length L>=2 makes L-1 adjacent comparison calls and no library swap writes; a user callback can still have its own effects. This is a source-derived procedural count, not newly measured: `machine/bios/table.lua:150-161`.
- Quicksort takes pivot value from midpoint `(first+last)//2`; scans left with target[left]<pivot and right with pivot<target[right], or the corresponding comparator calls. When left<=right, it saves left value, writes right value into left, then saved value into right, then advances both indices: `machine/bios/table.lua:101-128`.
- After partitioning it recursively handles the smaller side and loops over the other side. The code is an in-place quicksort, not table-copy sorting: `machine/bios/table.lua:130-140`.
- Comparator results are consumed in conditions: nil and false are false; all other guest values are true, including0 and empty string. It need not literally return a boolean, and only the call's condition value is used. Library conditions: `machine/bios/table.lua:115-120,156`; truthiness TS `machine/ts/machine/cpu/value_slots.ts:157-160`, native `machine/cpp/machine/cpu/value.h:193-197`.
- No comparator validation, invalid-order error, scan bounds guard, consistency check, or restore-on-error exists. A callback can run before any swap during the initial scan; a failure after previous swaps leaves their writes in place. The two writes of each swap are sequential, not atomic: `machine/bios/table.lua:101-140,150-161`.
- Do not claim arbitrary comparator mutations are stable or deterministic across a changed comparator/table, or that sorting is stable for equal keys. Source facts establish concrete comparisons/swaps, not a general callback-mutation contract: `machine/bios/table.lua:103-139`. No such mutation experiment was run here.
- Sort does not return the sorted table. All successful early and fallthrough exits yield one nil via the producer rules above: `machine/bios/table.lua:145-163`.
- The selected range is captured1..L, not recomputed after each swap. Common range/final-length claims retain the # producer STOP: `machine/bios/table.lua:146,161`.

## Required primitive contracts, conversions and errors

- Finite numeric position normalization uses floor division, including flooring negative fractions toward negative infinity. Shared owner calculates quotient, truncates it, subtracts1 when that truncation exceeds quotient: TS `machine/ts/spec/blua32/numeric.ts:1-5`; native `machine/cpp/spec/blua32/numeric.h:7-11`. This is not a table-library integer/range validator.
- Guest arithmetic numbers are JS Number scalars in the TS value model and native binary64 in the native model, not fixed-point integer ABI words: TS `machine/ts/machine/cpu/value.ts:44-50`; native `machine/cpp/machine/cpu/value.h:132-144`.
- Arithmetic does not parse numeric strings here: TS numeric read returns NaN for a nonnumber tag at `machine/ts/machine/cpu/value_slots.ts:128-131`, and constants likewise at `machine/ts/machine/cpu/cpu.ts:3589-3596`; native FLOORDIV reinterprets operands as doubles and normalizes its result at `machine/cpp/machine/cpu/cpu_dispatch.inl:208-212`, `machine/cpp/machine/cpu/value.h:132-144`. Do not invent a table-specific bad-position error for this source. Arbitrary unusual-position outcomes were not executed by this extractor.
- Array-eligible keys are positive integral numeric1..0x7fffffff; zero, negatives, fractions and nonfinite numeric keys are not array slots and go through ordinary numeric-key hashing. TS eligibility `machine/ts/machine/cpu/table.ts:1415-1424` (bound declared at `:27`); native `machine/cpp/machine/cpu/table.h:198-209`. This is a storage eligibility boundary, not an insertion/removal argument bound.
- Nil writes remove mappings. Existing in-array writes and out-of-array nil deletion: TS `machine/ts/machine/cpu/table.ts:801-824`; native `machine/cpp/machine/cpu/table.cpp:415-430`. Missing admissible keys read nil: TS `machine/ts/machine/cpu/table.ts:149-180`; native `machine/cpp/machine/cpu/table.cpp:393-408`.
- Installed tostring is `return '' .. value`, not a host-language string cast or stock Lua tostring: `machine/bios/base.lua:235-237`. CPU CONCAT/CONCATN use central conversion: TS `machine/ts/machine/cpu/cpu.ts:2607-2657`; native `machine/cpp/machine/cpu/cpu_dispatch.inl:271-305`.
- Central conversion maps nil/false/true to `nil`/`false`/`true`, Table/Thread to `table`/`thread`, both closure/builtin function to `function`, strings to their text, nonfinite numbers to `nan`/`inf`/`-inf`, finite numbers through shared formatNumber: TS `machine/ts/machine/cpu/value.ts:182-206`; native `machine/cpp/machine/cpu/value.cpp:9-29`. Concat's nil-element exception runs before tostring, so nil **element** is empty, whereas separator false becomes `false`, and nil separator remains empty: `machine/bios/table.lua:54-59,73-76`.
- Default sort `<` compares number with number numerically and string with string lexically. Other type combinations yield false in these leaves, not a stock-Lua comparison error and not tostring conversion: TS `machine/ts/machine/cpu/cpu.ts:2701-2736`; native `machine/cpp/machine/cpu/cpu_dispatch.inl:356-368`. TS lexical comparison owner `machine/ts/common/utf8.ts:36-55`; no locale/collation promise.
- Target element reads use ordinary CPU indexing, which can follow a table-valued __index chain; they are not rawget calls. TS `machine/ts/machine/cpu/cpu.ts:619-653`; native `machine/cpp/machine/cpu/cpu.cpp:3243-3257`. Writes directly mutate target without __newindex redirection: TS `machine/ts/machine/cpu/cpu.ts:729-752`; native `machine/cpp/machine/cpu/cpu.cpp:3335-3361`. No general metamethod audit is claimed.
- There are no explicit library-authored error strings or argument/bounds checks in the six bodies: `machine/bios/table.lua:4-163`. Failures come from reached shared operations/callbacks; error priority follows source operation order, not descriptors.
- Unsupported # reports `Attempted to get length of an unsupported value.`; indexing/assignment on unsupported non-table values reports `Attempted to index field on a non-table value.` / `Attempted to assign to a non-table value.`; calling a nonfunction reports `Attempted to call a non-function value.`; nil key reports `Table index is nil.`; exhausted index chain reports `Metatable __index loop detected.`; heap failure reports `Out of memory.`. Matching TS strings `machine/ts/machine/cpu/cpu.ts:496-505`; native `machine/cpp/machine/cpu/cpu.cpp:371-380`. Actual LEN, index, assignment and CALL leaves: TS `machine/ts/machine/cpu/cpu.ts:2672-2685,619-653,729-752,2918-2939`; native `machine/cpp/machine/cpu/cpu_dispatch.inl:319-330,490-503`, `machine/cpp/machine/cpu/cpu.cpp:3243-3257,3335-3361`.

## Cost and finite-scope limits

- No six-function-local maximum length, endpoint, output byte count, recursion budget, or comparator count is declared. Loops/recursion and conversions shown above determine work; massive/nonfinite ranges are not made safe by a library guard: `machine/bios/table.lua:4-163`. No termination guarantee for arbitrary representable endpoint/comparator behavior is inferred.
- Dense ordinary finite shifts perform one read/write per traversed slot; sorted fast path performs L-1 comparisons; quicksort recurses on the smaller partition; concat is balanced; unpack is linear-depth. These are procedural observations, not measured host-time claims: `machine/bios/table.lua:22-25,33-36,53-62,81-87,130-140,150-161`.
- Guest stack grows in charged heap-backed capacity rather than imposing a table.unpack-specific stock maximum: TS `machine/ts/machine/cpu/cpu.ts:523-536`; native `machine/cpp/machine/cpu/cpu.cpp:3419-3425`. Shared heap capacity is RAM byte count minus BASE_RAM_USED_SIZE, with collection before out-of-memory: TS `machine/ts/machine/cpu/lua_heap.ts:21-58`; native `machine/cpp/machine/cpu/lua_heap.cpp:11-33`. No maximum successful unpack/concat argument count was measured here.
- Select has base cost1 and no per-argument/per-result charge in its descriptor; actual suffix construction nevertheless loops. TS cost descriptor `machine/ts/machine/cpu/value.ts:109-120`, charge leaf `machine/ts/machine/cpu/cpu.ts:3841-3857`; native Select id6 `machine/cpp/spec/blua32/builtin.h:10-18`, corresponding cost row `machine/cpp/machine/cpu/value.h:63-71`, charge leaf `machine/cpp/machine/cpu/cpu.cpp:1876-1891`. Do not equate charged cycles with all host work, or claim the library is one native primitive.

## Actual usage/source-test precedents (not newly executed)

- BIOS lexer imports table.concat and joins escaped literal fragments: `machine/bios/compiler/lexer.lua:1-4,210-220`.
- BIOS binary string pack module captures table.concat/unpack: `machine/bios/string/pack.lua:1-7`; string.unpack appends the next byte position then returns unpack(out,1,#out): `machine/bios/string/pack.lua:378-383`.
- BIOS shell editor converts a byte table into string.char arguments with explicit unpack bounds1..count: `machine/bios/shell/editor.lua:161-166`.
- Game precedent: 2024 quiz joins intro/completion authored lines with an explicit newline separator: `carts/2024/quiz.lua:29-41`.
- Existing runtime assertion source covers pack('a',nil,3), positioned+append insert, middle+tail remove, and empty-remove width1: `tests/carts/emptycart/bios_runtime_assert.lua:501-512`.
- The same source covers concat nil holes/negative start/empty range, unpack nil preservation/negative start/empty width0: `tests/carts/emptycart/bios_runtime_assert.lua:514-524`.
- The same source covers numeric default sort, custom descending-length comparator, one nil result, and ordered six-element comparator count5: `tests/carts/emptycart/bios_runtime_assert.lua:526-540`.
- Firmware-call test source includes packed expansion/evaluation order and a 260-result tuple case, not a newly established universal limit: `tests/lua/firmware_call_results.test.ts:8-28`.

## Explicit handoff gaps

- Root is running paired probes and authoring examples separately. Incorporate their actual results only after they are delivered; none are claimed as executed here.
- This extractor did not execute all unusual numeric positions, nil/non-table targets, callback mutation/failure timing, massive ranges, or resource exhaustion. Algorithmic source facts above are not substituted for execution evidence.
- The blocking common contract is the actual shared # producer mismatch; retain that STOP. It is not authorization to repair the runtime, claim no usable procedural library behavior, or quietly publish a dense-only universal table contract.

## Root integration supplement: reached String operations and finite progress

- A String base is accepted by ordinary CPU indexing and resolves through the
  shared string-index Table, not character positions: TS
  `machine/ts/machine/cpu/cpu.ts:619-637,655-669`; native
  `machine/cpp/machine/cpu/cpu.cpp:3243-3273`. Public CPU reference:832.
  String LEN gives codepoint count: TS `cpu.ts:2672-2678`; native
  `machine/cpp/machine/cpu/cpu_dispatch.inl:319-324`. Writes still use the
  ordinary Table-only assignment leaves already cited above. Do not turn
  intended Table use into a nonexistent upfront target-type validator.
- Shift-work counts describe normal completion with advancing unit-step Number
  arithmetic, not every finite magnitude. The numeric-for producer increments
  with ADD (`toolchain/ts/lua/compiler.ts:4518-4519`); Number precision can stop
  that progress. Likewise finite concat endpoints alone do not ensure a smaller
  midpoint subrange (`machine/bios/table.lua:61-62`). Balanced-call-tree wording
  is conditioned on midpoint progress, not a universal safe finite range.
