# BIOS String pattern extraction - bounded facts (HEAD ea4ba90ab)

Status: admitted finite source facts with the corrections and current dependency card below; earlier extraction baseline is retained for provenance. Source audit only; no execution, runtime fix, test-framework work, or repository edits. Scope is exactly `find`, `match`, `gmatch`, `gsub`, installation, and minimum dependency leaves. Existing manual Table common-length STOP and seven runtime plus BZ01 compiler questions remain OPEN. Core-nine String facts are a separate extraction.

## 1. Installation, actual signatures, dependencies

- `machine/bios/main.lua:4-6` loads base, publishes Table, then publishes `require('string')`. `machine/bios/string.lua:1-8,20-22` obtains the base String table, installs these four pattern functions into it, installs that table as the String index table, and returns it.
- Actual fixed implementation parameters: `find(source, pattern, start_arg, plain)` at `machine/bios/string/pattern.lua:420`; `match(source, pattern, start_arg)` at `:442`; `gsub(source, pattern, replacement, limit_arg)` at `:516`; `gmatch(source, pattern)` at `:550`. None is variadic and none has an upfront arity validator. Missing fixed parameters are nil; fixed nonvararg calls discard surplus arguments: TS `machine/ts/machine/cpu/cpu.ts:3275-3297`; native `machine/cpp/machine/cpu/cpu.cpp:3017-3043`.
- The descriptor advertises `string.find(s, pattern [, init])`, **omitting the implemented fourth `plain` argument**; it advertises the other three parameter lists shown above: `toolchain/ts/lua/builtin_descriptors.ts:95-98`. Descriptors are not runtime validators.
- Pattern captures at module load: base String `byte` and `sub`, Table `concat` and `unpack`, and globals `tonumber`, `tostring`, `type`: `machine/bios/string/pattern.lua:1-9`. Replacing those table fields or globals after loading does not replace these captured function references. Calls to `error` remain global lookups (`:104,244,278,322,513`).
- Captured functions can have dynamic dependencies of their own: Table concat uses global `tostring` per leaf (`machine/bios/table.lua:52-77`); base `tonumber` uses global `type` (`machine/bios/base.lua:240-249`); base `tostring` is concatenation (`machine/bios/base.lua:235-237`). Source facts here assume the installed BIOS dependencies, not arbitrary user rebinding of their nested globals.

## 2. Index unit and inherited operations

- These patterns operate on **String codepoint positions, not UTF-8 byte offsets and not grapheme clusters**. String LEN asks the pool for codepoint count: TS `machine/ts/machine/cpu/cpu.ts:2672-2678`, native `machine/cpp/machine/cpu/cpu_dispatch.inl:319-324`. `byte` returns one codepoint at a 1-based position, scanning from the start: TS `machine/ts/machine/cpu/cpu.ts:4320-4351`, native `machine/cpp/machine/cpu/cpu.cpp:2176-2207`. Thus the local name `byte` is not evidence of byte-oriented pattern matching.
- `byte` requires a String first argument; omitted/nil position means1; other positions require a Number then signed32 conversion; position<1 or beyond the codepoint range returns exactly one nil. Same TS/native ranges as above. Pattern-internal codepoint reads reach this owner directly.
- Captured base `sub` uses `#value`, normalizes nonnil endpoints with `//1`, makes negative endpoints relative to the end, clamps start below1 and end above length, returns empty if end<start, and otherwise reconstructs codepoints using char/byte: `machine/bios/string/base.lua:27-36,58-82`. Pattern-source substrings and captured result strings therefore inherit this operation rather than slicing UTF-8 bytes.
- Finite numeric `//1` floors toward negative infinity, not truncation toward zero: TS `machine/ts/spec/blua32/numeric.ts:1-5`; native `machine/cpp/spec/blua32/numeric.h:7-11`. The arithmetic leaves do not parse numeric strings: TS FLOORDIV/getNumber `machine/ts/machine/cpu/cpu.ts:2565-2586`, `machine/ts/machine/cpu/value_slots.ts:128-131`; native FLOORDIV/raw double reinterpretation/NaN canonicalization `machine/cpp/machine/cpu/cpu_dispatch.inl:208-212`, `machine/cpp/machine/cpu/value.h:125-144`.
- Do not invent stock-Lua argument errors for nil/nonnumber `source` or `pattern`: there is no pattern-level coercion or validation, only whichever shared `#`, `sub`, `byte`, comparison, arithmetic, or indexing operation is reached first (`machine/bios/string/pattern.lua:420-449,516-565`). In particular gmatch returns its closure before touching either input (`:550-553`).

## 3. Start and limit conversion

- Find and match: omitted/nil `start_arg` means1; otherwise compute `i = start_arg //1`; positive i is kept, negative i becomes `#source+i+1`, zero maps to1. **No clamp of an excessively negative result to1**: `machine/bios/string/pattern.lua:409-421,442-444`.
- Find alone immediately returns one nil when normalized start>`#source`, before checking `plain` or parsing pattern (`:420-427`). This includes start=`#source+1`, unlike the search helper which allows that candidate. Match has no such precheck (`:442-449`).
- Search helper candidate positions run from the supplied start through `#source+1` inclusively; the helper never lower-clamps start (`:367-387`). The ordinary single-character matcher rejects only positions **above** `#source`, not positions below1 (`:141-156`). Therefore do not promise sane 1-based boundaries for excessively negative initial positions; their exact procedural behavior includes below-range byte reads and base-sub relative indexing.
- For nonnil nonnumber starts, `//1` is not a conversion parser or a checked integer argument. The current tagged nonnumbers feed a NaN arithmetic value, so `i>0` and `i<0` fail and this normalizer returns1. The owning numeric sources are in section2; no pattern-authored error exists (`:409-417`). Unusual numeric magnitudes/nonfinite positions have not been executed in this extraction.
- `plain` is tested for truthiness, not equality to true (`:425`). Only nil/false are false in both runtimes: TS `machine/ts/machine/cpu/value_slots.ts:157-160`; native `machine/cpp/machine/cpu/value.h:193-197`. Thus numeric0 and empty String enable plain mode.
- Gsub: omitted/nil limit is `#source+1`; otherwise `limit_arg //1`; negative values are replaced by0. It loops while count<limit, so limit0 skips all pattern/replacement work, appends the source tail, and returns assembled source plus count0: `machine/bios/string/pattern.lua:516-547`. A nonnil nonnumber limit becomes NaN at the shared arithmetic boundary and fails both limit<0 and count<limit, likewise skipping the loop rather than producing a gsub-specific integer error. No resource/size guard is introduced by this conversion.

## 4. Plain find

- After find's own start>`#source` precheck, truthy plain dispatches to `plain_find`, without any pattern syntax interpretation or capture table (`machine/bios/string/pattern.lua:420-427`).
- Empty needle returns exactly `(start_index, start_index-1)` if that precheck permitted entry. Nonempty needle tests each candidate through `#source-#needle+1`, compares codepoint values, and returns the first `(start, inclusive_end)`; failure returns exactly one nil: `:389-407`.

## 5. Pattern syntax and matching order

### Atoms, escapes and literal characters

- Empty remaining pattern succeeds without consuming input; ordinary atom matches one codepoint; `.` matches any codepoint when source_index<=`#source` (`:141-156,255-258`). There is no newline exception.
- `%a`: ASCII A-Z/a-z; `%c`: codes<=31 or127; `%d`:0-9; `%g`:33-126; `%l`:a-z; `%p`:33-47,58-64,91-96,123-126; `%s`:space or9-13; `%u`:A-Z; `%w`:ASCII letters, digits **and underscore**; `%x`:0-9/A-F/a-f; `%z`:code0. Sources: `:13-22,26-80`. No Unicode-category/locale expansion is present.
- **Every uppercase ASCII letter after `%` complements its lowercase match**, not just listed named classes (`:42-45`). Thus `%D` complements digits and `%Q` complements the literal lowercase q. Unknown nonuppercase escape tokens match the escaped codepoint literally (`:79`); `%q` is literal q and `%0` is literal0. Use `%` before punctuation to make a literal punctuation atom (`:145-156,266-293`). `%b`, `%f`, `%1`..`%9` are special only in the outside-class matcher, described below.
- Literal fallback matches codepoint equality (`:156`). `|` has no alternation role; braces have no counted-repeat role; backslash has no pattern-escape role. Punctuation `* + - ?` is a suffix only when immediately examined after an ordinary atom; otherwise it is itself a literal atom, potentially with a following suffix (`:324-350`). This is not regular-expression syntax.
- A terminal `%` is not explicitly rejected. Special-escape dispatch first reads the missing token (`machine/bios/string/pattern.lua:266-293`); item_end then advances by2 (`:82-86`). If the ordinary single-character check is reached, it rejects positions beyond the source length before class matching (`:141-151`); otherwise class_match receives the missing token. Reached mixed numeric relational comparisons are false in the paired leaves (`machine/ts/machine/cpu/cpu.ts:2701-2736,2812-2847`; `machine/cpp/machine/cpu/cpu_dispatch.inl:356-383`). This is not a universal final outcome for malformed patterns.

### Bracket sets

- `[...]` is an ordinary one-codepoint atom; optional `^` immediately after `[` negates membership. Parser skips `%` plus its next position and stops at the first other `]`; failure to find one throws the literal `invalid string pattern` when that item is reached: `:82-105,107-139`.
- In a set, `%` tokens go through class_match, so named classes, uppercase complements and escaped literal characters work there. `%b`/`%f` are just literal b/f there and `%1` is literal1; they are not balance/frontier/backreference constructs (`:123-127` plus `:42-80`).
- A range is recognized when the current member is a single unescaped item followed by `-`; the right endpoint must also parse as a single item for a range to match. It compares numeric codepoints inclusively, not locale order. Reverse endpoints match nothing. Exact algorithm: `:115-132`.
- Important non-stock boundaries: the range condition allows the **closing `]` itself to be taken as the right endpoint** (`next_index+1 < finish_index` at `:117-122`); a trailing hyphen is not universally a literal. Escaping `%-` avoids the range trigger. An escaped left/right endpoint does not form an ordinary codepoint range; right-side escape may be consumed with no range membership (`:116-127`). Do not transplant stock-Lua `[a-]`/range rules.
- A literal unescaped `]` closes the set even as its first member (`:94-101`); use `%]` as a member. An unescaped `[` encountered while class membership is traversed is passed recursively to item_end; this is not a declared nested-set union feature and can skip subsequent text (`:116,82-105`). Use `%[` for literal membership. Empty positive sets match nothing; negated empty sets match any available source codepoint, by `:114-138`.

### Anchors and search

- A `^` **only at pattern position1** is stripped and makes find_match try only the supplied search start, not all later candidates (`:367-384`). It is relative to `start_arg` or the iterator/substitution's current search_index, not a separate absolute-source-origin assertion. A `^` elsewhere is literal.
- `$` **only at the final pattern position** requires source_index=`#source+1`; elsewhere it is literal (`:259-265`).
- Unanchored search chooses the first successful candidate in increasing index order and a new capture table is created for every candidate (`:374-384`). There is no automatic plain-search optimization.

### Repetition

- The suffix operators apply to ordinary single-match atoms: `?` tries one then zero; `*` greedy zero-or-more; `+` requires one then greedy remainder; `-` minimal zero-or-more. Greedy expansion tries longest to shortest and minimal expansion tries the rest before consuming another codepoint: `:167-197,324-348`.
- Capture delimiters, `%bxy`, `%f[set]`, and backreferences return through their own matcher branches **before suffix dispatch** (`:266-323`). No grouped/capture/balanced/frontier/backreference repetition exists; a following `*`, `+`, `?`, or `-` is processed separately as an ordinary atom. There are no alternation or counted-repeat implementations.

### Captures and backreferences

- `(...)` opens an entry with start=current source_index; `)` closes the most recent capture entry whose finish is nil; `()` instead records the numeric current position without consuming text. Capture order is opening order. Returned substring uses start through finish-1; position capture returns its number: `:199-204,294-323,355-364`.
- `%1`..`%9` refer to an existing finished, nonposition capture, compare the captured codepoints at the current position, then consume its length. Missing/open/position capture throws `invalid string pattern capture`: `:240-253,286-292`. No `%10` construct exists: `%1` followed by literal0 is parsed.
- Unmatched closing `)` throws `invalid string pattern` only when reached (`:311-322`). **Unclosed opening captures are not checked at pattern end** (`:255-258,294-309`); later extraction computes capture.finish-1 (`:199-204`). Do not claim a uniform unclosed-capture error. The closing search tests finish only, including position entries (`:312-314`), so malformed or structurally odd capture combinations must follow actual source, not a standard-Lua validity model.
- No pattern-local capture-count maximum appears. Backreferences are limited to one-digit1..9 by token dispatch even if more captures can be constructed (`:286,294-305`).

### Balance and frontier

- `%bxy` consumes a balanced region starting exactly at x, counting nested x and closing y; it returns just after the closing y at depth0. A non-x start or no closing y fails. Close is checked before open when x==y. It then continues at pattern_index+4 (`:206-225,268-274`). No explicit upfront check requires both delimiter positions to exist.
- `%f[set]` is zero-width: previous value must not belong, current value must belong. Previous is synthetic0 at source_index<=1, otherwise byte(source,source_index-1); current is byte(source,source_index) at source_index<=#source, otherwise synthetic0. The byte read applies signed32 position conversion, and a converted position<1 returns nil rather than synthetic0. Missing immediate `[` raises `invalid string pattern`; the set parser is shared. Sources: `machine/bios/string/pattern.lua:227-238,275-285`; `machine/ts/machine/cpu/cpu.ts:4320-4351`; `machine/cpp/machine/cpu/cpu.cpp:2176-2207`.

## 6. Results, iteration and Table-length STOP

- `values_for` creates a values table: if raw `#captures==0`, entry1 is the whole matched substring; otherwise entries1..`#captures` are capture values in opening order (`machine/bios/string/pattern.lua:355-365`). For a well-formed captured match these are Strings or numeric position captures (`:199-204`).
- Find failure is exactly one nil (`:422-424,429-430`). Pattern success creates `{match_start, match_finish-1}`, appends values only if raw `#captures>0`, and returns captured `unpack(out,1,#out)` (`:428-439`). No-capture success's procedural tuple is start/inclusive-end; capture success procedurally appends the captures. Match failure is exactly one nil; success forwards `unpack(values,1,#values)` (whole match when no captures; otherwise captures): `:442-449`.
- Gmatch outer call returns exactly one closure and stores only `search_index=1` as mutable iteration state; source/pattern are captured (`:550-565`). Each successful invocation returns the same values_for tuple as match; failure returns one nil. The closure has no parameters and ignores supplied arguments. It does not return the separate state/control triple of a bespoke iterator protocol.
- For a nonempty match gmatch sets next search_index=match_finish (exclusive end); for an empty match it uses match_finish+1. This update happens **before** values_for/unpack, so an extraction/result-construction failure can occur after state advancement (`:553-563`). Failure leaves state unchanged and there is no latched done flag; another invocation repeats the failed search (`:553-560`).
- Table unpack forwards exactly the selected numeric slots recursively and concat converts its selected leaves; both capture `#target` even with explicit bounds: `machine/bios/table.lua:52-98`. Tuple forwarding is not changed into a single value by the final call: host compiler `toolchain/ts/lua/compiler.ts:4392-4408`, firmware compiler `machine/bios/compiler/compiler.lua:1151-1159`; fixed-result callers can truncate/nil-pad as usual (TS `machine/ts/machine/cpu/cpu.ts:3406-3418`, native `machine/cpp/machine/cpu/cpu.cpp:3127-3139`).
- **STOP: do not advertise a proved universal TS/native tuple/output-width contract from the procedural tuples above.** Pattern itself repeatedly reads/mutates `#captures`, `#values`, and `#out` (`:161-178,185-191,295,312,355-364,432-439,453-475,490-504,521-547,562-563`) and uses Table concat/unpack. The existing mutation-maintained Table length mismatch remains: TS scan continues through hash numeric keys (`machine/ts/machine/cpu/table.ts:801-812,1426-1440`) while native refill stops at physical array capacity (`machine/cpp/machine/cpu/table.h:172-184`); LEN consumers are TS `machine/ts/machine/cpu/cpu.ts:2680-2682` and native `machine/cpp/machine/cpu/cpu_dispatch.inl:326-328`. No friendly dense example clears that owner mismatch. The facts describe each source algorithm in terms of the actual lengths it reads; no affected universal guarantee is silently promoted.

## 7. Gsub replacement semantics and progress

- Gsub collects unmatched prefix, computes values_for plus whole match, evaluates replacement, appends it, increments count, updates last_index/search_index, then appends the tail and returns **two results**, `concat(out), count`: `machine/bios/string/pattern.lua:516-547`. Count counts successful replacement attempts even when the replacement keeps the original text (`:530-535` plus `:495-511`). Table-output-length STOP above remains applicable to assembly.
- String **or Number** replacement is converted through captured tostring, then replacement text is parsed (`:24,483-489`). Literal nonpercent codepoints copy as is; `%%` emits `%`; `%0` emits the whole match; `%` plus a token convertible by captured tonumber looks up that numbered values_for entry (missing entry becomes empty String); a nonnumeric token emits the token without `%`; final lone `%` is copied literally (`:452-481`). This is permissive replacement parsing, not a stock-Lua invalid-use-of-percent check.
- The values_for table passed to replacements contains the whole match at entry1 if there are no explicit captures (`:355-359,531-533`). Therefore in that branch `%1` also refers to whole match, not an invalid capture. Numeric position captures are allowed in this replacement array and reach concat's tostring conversion (`:199-204,470-475`, `machine/bios/table.lua:52-77`).
- Table replacement key is the first values_for entry when its length>0, else whole. It performs an ordinary `replacement[key]` lookup (not rawget); nil result preserves whole, **false is converted with tostring rather than preserving whole**; every other result is likewise tostring'd. Returned text is **not** parsed again for `%` substitutions: `machine/bios/string/pattern.lua:490-500`. The table index owner permits its metatable resolution path: TS `machine/ts/machine/cpu/cpu.ts:619-653`, native `machine/cpp/machine/cpu/cpu.cpp:3243-3257`. Lookup follows Table-valued __index chains only, not Function callbacks; paired leaves are in the current dependency card below.
- Function replacement receives unpacked values_for entries if that table's length>0, else whole; so no explicit captures normally means one whole-match argument. Only its first returned value is assigned to mapped; nil or false preserves whole; all truthy values use captured tostring. Returned text is **not** reparsed for `%`: `:501-511`; fixed-result delivery leaves cited in section6 establish first-result consumption. Callback effects are ordinary observable effects.
- Other replacement types throw the exact literal `string.gsub replacement must be a string, number, function, or table.` **only when a match reaches replacement_value** (`:483-514,525-534`). Zero limit or no match does not prevalidate replacement.
- Nonempty matches resume at their exclusive end (`:535,542-544`); there is no overlap search inside the consumed span. Empty matches use a different rule: after replacement, if the **previous search_index** is already beyond `#source`, break; otherwise set search_index=match_finish+1 and **also last_index=search_index** (`:536-541`). That advances past a source codepoint without appending that skipped codepoint. Do not document standard empty-match character preservation or suppression of an empty match adjacent to a previous nonempty match: neither is implemented here.
- Gsub/gmatch both call find_match repeatedly with the advancing search index (`:526,553`). Consequently leading `^` is honored at each current search start, not treated as one absolute beginning-only substitution/iteration rule (`:367-383`).

## 8. Errors, partial effects, work and resources

- These functions do not preparse the whole pattern. Errors depend on reached candidates/branches: for example find's initial bound can return before parsing, gmatch defers parsing until closure invocation, and gsub can skip parsing/replacement entirely for limit0 (`:420-427,516-526,550-553`). Exact authored error literals are listed above; missing close bracket, frontier missing bracket, unmatched close capture, bad backreference and invalid replacement are distinct source sites. Do not invent general Lua type/arity/malformed-pattern errors.
- A replacement callback can produce guest effects before a later match/error; ordinary replacement Table lookup follows Table chains, not callbacks. No transaction or rollback wraps those effects. Gsub appends only to its private output and returns nothing if a reached operation throws; its private count is incremented only after that replacement returns (`:530-535`). Gmatch state advancement can precede extraction failure (`:557-563`).
- Matching uses recursion for pattern/capture continuation, iterative balanced scanning, backtracking greedy/minimal expansions, and one fresh capture table per candidate (`:167-197,206-225,255-387`). Captures/values/output and textual replacement pieces allocate tables; numerous `sub` calls construct single-codepoint strings via base sub; byte rescans from the String start. Sources: `:167-197,294-305,355-377,432-439,452-489,521-547`; base sub `machine/bios/string/base.lua:58-82`; byte TS/native ranges in section2. Do not label the matcher compiled, allocation-free, linear-time, or one native primitive.
- Plain_find is nested candidate/needle iteration and each codepoint read uses byte's start scan (`:389-405`). Greedy backtracking can reconsider suffixes for many candidate widths (`:167-179`); no polynomial/exponential bound is claimed without a separate analysis. Table unpack recursion is linear-depth in the selected slots; concat splits ranges recursively (`machine/bios/table.lua:52-98`).
- There is **no pattern-local explicit maximum** source length, pattern length, capture count, output length, recursion depth, callback count, or execution-time budget in this module (`machine/bios/string/pattern.lua:1-567`). Gsub's limit bounds completed replacement iterations, not inner search/backtracking work. Gmatch laziness bounds work per caller invocation only by the search it must perform, not by a library step quota. Exact exhaustion thresholds and host-performance measurements are not established here.

## 9. Explicit remaining gaps / editorial freeze boundary

1. No runtime execution, benchmark, Unicode malformed-storage audit, resource exhaustion test, or empirical weird/nonfinite-input result was performed.
2. Common Table-length producer mismatch blocks affected universal tuple/output guarantees; section6 names both owners. This file neither repairs nor clears it.
3. Malformed forms not covered by explicit authored errors (trailing `%`, incomplete `%b`, unfinished captures, odd position-capture closure combinations) are described procedurally, **not** assigned stock-Lua errors or unmeasured final results.
4. The existing seven runtime questions and BZ01 compiler question have not been evaluated or cleared by this next-slice extraction.
5. The original extraction was a finite source handoff. Current admitted pattern prose and example evidence are indexed separately; source facts alone are not publication approval.

## Current dependency and call-boundary corrections — 2026-10-18

This admitted sheet supersedes earlier broad SF1/author-gap wording. The
[separate SF1 card](bios-string-pattern-plain.md) establishes the implemented
fourth argument, descriptor omission, minimum-only diagnostic and inspected
ordinary call delivery. This is not universal editor/source-pipeline agreement.

- All API capture/result/replacement/output procedures depend on actual Table
  lengths, including ordinary String inputs. Capture insertion/closing/trimming:
  `machine/bios/string/pattern.lua:161-178,185-191,295,312`; capture values:
  `:355-364`; find tuple: `:432-439`; match/gmatch tuple: `:448-449,562-563`;
  replacement argument/assembly: `:452-475,486-504,521-547`. Table concat/unpack
  use the actual Table length: `machine/bios/table.lua:52-98`. This does not
  close the common length producer STOP.
- Replacement Table lookup follows only Table-valued `__index` chains, not
  Function-valued callbacks. Sources: `machine/ts/machine/cpu/cpu.ts:619-653`;
  `machine/ts/machine/cpu/table.ts:334-369`;
  `machine/cpp/machine/cpu/cpu.cpp:3243-3249`;
  `machine/cpp/machine/cpu/table.h:67-81,225-239`.
- A replacement Function is called before count increment/later matching and
  can perform guest effects. Only its first result reaches the scalar local;
  nil/false preserves the match. Sources: `machine/bios/string/pattern.lua:501-511,525-535`;
  `toolchain/ts/lua/compiler.ts:3889-3939`.
- Final table-unpack results are forwarded by find/match/gmatch, while gsub's
  two-expression return is fixed2 (nonfinal concat scalar plus count).
  Sources: `machine/bios/string/pattern.lua:439,449,547,563`;
  `toolchain/ts/lua/compiler.ts:4372-4408,5754-5764`;
  paired delivery `machine/ts/machine/cpu/cpu.ts:3406-3418` and
  `machine/cpp/machine/cpu/cpu.cpp:3127-3139`.
- Parentheses do not establish scalar call delivery in this source path;
  grouping is discarded at `toolchain/ts/lua/syntax/parser.ts:1345-1349`.
  Narrow inspected scalar/final callsites above do not clear CPU7, BZ01,
  common Table length or all compiler/optimization pipelines.
- Balance uses an iterative depth loop (`machine/bios/string/pattern.lua:206-225`);
  match/capture continuations recurse and greedy/minimal expansion retries them
  (`:167-197,255-350`). No measured cycle, allocation or exhaustion bound follows.

The independent contract review is in
[the source record](../reviews/bios-string-source.md). Actual example execution
is separate in [pattern example evidence](bios-string-pattern-example.md).

## Reached-error addendum

There are exactly five explicit `error(...)` call sites in the complete pattern module; three payloads. These are authored payload strings, not a complete list of possible shared-operation faults or a promise about rendered diagnostic formatting. Calls resolve global `error`, rather than a captured local; installed BIOS initially assigns `error = vm_error`. Sources: `machine/bios/string/pattern.lua:1-567`; `machine/bios/base.lua:214`.

| Site and payload | Exact reached condition | Source |
| --- | --- | --- |
| `invalid string pattern` | `item_end` was asked to parse `[` and scanning reaches the pattern end without an unescaped `]`. `%` skips the next position while scanning. | `machine/bios/string/pattern.lua:82-105` |
| `invalid string pattern capture` | A dispatched `%1` through `%9` refers to a missing capture, a capture with nil finish, or a position capture. | `machine/bios/string/pattern.lua:240-245,286-291` |
| `invalid string pattern` | Reached `%f` is not immediately followed by `[`. If it is, its set is parsed by `item_end`, including that parser's error. | `machine/bios/string/pattern.lua:275-284` |
| `invalid string pattern` | Reached `)` exhausts the reverse capture scan without finding an entry whose finish is nil. This scan checks finish only, not whether the entry is a position capture. | `machine/bios/string/pattern.lua:311-322` |
| `string.gsub replacement must be a string, number, function, or table.` | A matched substitution reaches `replacement_value`, whose captured type result selects none of String/Number, Table, or Function. | `machine/bios/string/pattern.lua:24,483-514,525-534` |

- No separate whole-pattern validation pass runs. Pattern end returns the current source index immediately; remaining pattern text is parsed as matching reaches it. Search may stop after one anchored candidate or a successful candidate. Sources: `machine/bios/string/pattern.lua:255-258,324-350,367-387`.
- A bracket atom is parsed by `item_end` before `single_match` checks whether the source position exceeds its length. Therefore source exhaustion is not a universal shield against a reached bracket syntax error. This is operation ordering, not an executed malformed-pattern result. Sources: `machine/bios/string/pattern.lua:141-154,324-350`.
- Find's initial start bound can return before examining `plain` or any pattern text. Gmatch creation returns its closure before invoking the matcher. Gsub skips the matcher/replacement while its initial `count < limit` is false, but still appends a source tail and calls concat. None is blanket validation of the unused inputs. Sources: `machine/bios/string/pattern.lua:420-428,516-547,550-553`.
- After a malformed pattern's missing `%` token reaches numeric comparisons, the paired LT/LE leaves do not manufacture a malformed-pattern/type error: their mixed-type paths leave the comparison result false. This does **not** establish a final result for every malformed pattern or clear the separate compiler questions. Sources: `machine/bios/string/pattern.lua:266-293,42-45`; `machine/ts/machine/cpu/cpu.ts:2701-2736,2812-2847`; `machine/cpp/machine/cpu/cpu_dispatch.inl:356-383`.
- Still no authored validation for a terminal `%`, both required `%b` delimiter positions, or unfinished opening captures at pattern end. Their procedural paths are respectively missing-token dispatch/class matching; two base-sub delimiter reads followed by balance scanning; and later `capture.finish - 1` during capture extraction. Do not replace those paths with stock-Lua error rules or invented final outputs. Sources: `machine/bios/string/pattern.lua:82-86,149-151,199-225,255-258,266-274,294-309,355-364`.
- The earlier syntax limits remain source facts: ordinary-atom suffix dispatch is separate from captures, balance, frontier and backreference branches; backreferences dispatch only one digit 1..9; no capture-count guard accompanies capture creation. These facts do not license a total accepted-input grammar that excludes representable malformed branches. Sources: `machine/bios/string/pattern.lua:266-350`.

## Work and resource addendum

- **Correction to the earlier sheet's section 8:** balanced nesting uses a `depth` variable and a loop, not recursive balanced matching. Pattern continuation and capture continuations recurse through `match_here`; greedy/minimal expanders repeatedly retry continuations. Sources: `machine/bios/string/pattern.lua:167-197,206-225,255-350`.
- The complete module has no explicit pattern-local source/pattern/capture/output-size cap, recursion-depth guard, work-step quota, time deadline, clock read, yield, or interrupt wait. This is an absence in this module, **not** a claim of unlimited machine/runtime resources. Sources: `machine/bios/string/pattern.lua:1-567`.
- Gsub's limit is compared only with completed replacement count. The match search and replacement call occur before count increments; the limit does not cap work within either. Gmatch's returned closure performs one search per invocation, but that search can try all remaining candidates and backtrack; laziness is not a fixed per-call work budget. Sources: `machine/bios/string/pattern.lua:367-387,516-544,550-563`.
- Plain search nests candidate and needle loops. Pattern search creates a fresh capture table per candidate; expansions can revisit continuations. A `byte` read scans source storage from its beginning in both runtimes. Base sub has whole-value and single-codepoint branches and otherwise builds a table of reconstructed codepoints. Thus do not claim constant-time codepoint access, allocation-free matching, a compiled-pattern cache, or one native pattern primitive. Sources: `machine/bios/string/pattern.lua:167-197,374-377,389-405`; `machine/ts/machine/cpu/cpu.ts:4320-4351`; `machine/cpp/machine/cpu/cpu.cpp:2176-2207`; `machine/bios/string/base.lua:58-82`.
- Table unpack recursively visits selected slots; concat recursively splits the selected range. These dependencies introduce additional work beyond finding a match. Exact allocation counts, intern/dedup behavior and GC effects are not established by these leaves. Sources: `machine/bios/table.lua:52-98`; `machine/bios/string/pattern.lua:439,449,488,504,547,563`.
- No exact cycle count, wall-clock/elapsed duration, frame bound, throughput, complexity class for arbitrary patterns, or resource-exhaustion threshold follows from this extraction. No measurement was performed. Local loop/count facts must not be promoted into those guarantees. The relevant source establishes control flow only: `machine/bios/string/pattern.lua:167-197,367-405,516-565`; its direct sub/byte/Table dependencies are cited above. Runtime scheduling, allocator/String-pool ceilings and machine-wide fault thresholds were not extracted.
