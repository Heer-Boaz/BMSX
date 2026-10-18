# BIOS time/calendar: exact String and Table-length dependency audit

Read-only source preparation, 2026-10-18. Live HEAD: `fd0895c39d96dc77f59d367c3a3bf9d8d428ff1d`; pre-existing worktree changes were not touched. No build, test, runtime repair, repository edit, architecture-document read, or PDF inspection was performed. Statements below are source observations or explicitly marked source-derived deductions, not new execution evidence or chapter approval.

## 1. Dependency ownership and binding

- BIOS installs the public `string` table before `os`: `machine/bios/main.lua:4–10`.
- `os.lua` captures the returned **String module table**, not a local copy of `string.sub`: `machine/bios/os.lua:4–6`. Every `string.sub(...)` remains an indexed call on that captured table at `os.lua:185,191,196,310–311`. Rebinding public global `string` does not change the local module-table reference; modifying that original table's `sub` field changes the field being called. This audit's path matrix describes the installed sub implementation, not arbitrary user replacement procedures.
- The String compositor obtains `string/base`, adds pattern/format/pack procedures, installs the same table as String-index owner, and returns it: `machine/bios/string.lua:1–22`.
- Base sub captures hidden byte/char primitives and `table.concat` separately: `machine/bios/string/base.lua:1–5`. Thus replacing public `table.concat`, `string.byte`, or `string.char` does not replace these already captured values. Captured concat still calls current global `tostring`: `machine/bios/table.lua:52–77`.
- `os.lua` does **not** call `string.format`, a pattern function, pack/unpack, String case mapping, or String reversal. Its String-table calls are exactly sub; its formatter uses ordinary `..`, `#` and live `tostring`: `machine/bios/os.lua:124–138,178–287,308–319`. String-module composition/import is not the same as runtime execution of every added procedure.
- `math.modf` is independently captured at `machine/bios/os.lua:5–6`; that is not a String dependency.

## 2. What the actual substring owner does

`machine/bios/string/base.lua:58–82` is decisive, not the broad statement that sub sometimes uses Tables:

1. Read `length = #value`; normalize/clamp bounds (`:58–67`, normalization `:27–36`).
2. Reversed/empty interval returns `''` (`:68–70`).
3. Full span returns the original value without byte/char or output Table (`:71–73`).
4. Singleton interval returns `char(byte(value,start_index))` without output Table (`:74–76`).
5. Only the remaining non-full multi-codepoint interval allocates output, appends using `output[#output+1]`, and calls captured concat (`:77–81`).

The concat owner reads `#target` even when explicit bounds would be supplied; sub supplies no bounds. Its default end is this length, and recursive leaves use global tostring: `machine/bios/table.lua:52–77`.

## 3. Entry-point and branch matrix

All rows concern installed defaults, with String formats unless expressly stated otherwise.

| Entry point / exact branch | Actual String/length work | Existing common Table-length dependency? |
| --- | --- | --- |
| `os.clock()` | Direct elapsed register word divided by 1000 (`machine/bios/os.lua:289–291`). | No String call and no Table LEN. |
| `os.time()` / explicit nil | Direct register word floor-divided by 1000 (`os.lua:293–306`). | No String call and no Table LEN. |
| `os.time(date_table)` | Named-field reads, arithmetic/validation, named-field normalization writes (`os.lua:293–303`; `:24–61,63–122`). Error text concatenates field names (`:32–52`). | No String-library call and no `#date_table`. Receiving or mutating a Table is not by itself a dependency on its cached sequence length. |
| `os.difftime(t2,t1)` | Captured modf, integer comparisons, subtraction (`os.lua:321–331`). | No String call and no Table LEN, including its own error branches. |
| `os.date()` / nil format | Default `'%c'`, first-codepoint sub check, then dedicated civil formatter (`os.lua:308–318`). | No internal helper Table length from sub: all slices are singleton (or empty/full-span early return). |
| `os.date('*t', timestamp)` | Initial first-codepoint sub, then fresh date-table named-field writes (`os.lua:310,313–315`; `:102–114`). | No helper Table LEN. The returned Table's named fields do not read its length. |
| `os.date(format,timestamp)` with no leading `!` | Initial `sub(format,1,1)`; formatter uses only `sub(format,index,index)` (`os.lua:310,178–200`). | No helper Table LEN for String input. Every slice is empty/full-span/singleton; this does not enter sub's general branch. |
| `os.date('!', timestamp)` | Strip is `sub('!',2)`; end 1 < start 2, so empty result. | No helper Table LEN (`base.lua:68–70`). |
| `os.date('!x', timestamp)` for a one-codepoint suffix x | Strip is `sub(format,2)` with start=end=2. | No helper Table LEN (`base.lua:74–76`). |
| `os.date('!' .. suffix,timestamp)` for suffix length >= 2 | Strip is `sub(format,2)`, a non-full interval of length >= 2. This reaches output append length and default concat length (`os.lua:310–312`; `base.lua:77–81`; `table.lua:66–77`). | **Yes: actual dependency on the common maintained Table-length owner.** This includes normal `!%c`, `!%F`, and `!*t`; stripping occurs before the `*t` branch. |
| `os.date(format,timestamp)` where format is a Table | First sub immediately evaluates `#format` (`os.lua:309–310`; `base.lua:58–59`). | **Yes: direct accepted-category Table LEN dependency**, before timestamp validation. Do not silently impose a new String-only check in documentation. |

Additional exact branch facts:

- The `!` test and stripping happen once, before timestamp normalization and the `*t` comparison: `machine/bios/os.lua:309–315`. The `!` prefix changes parsing but does not select a second timezone implementation in this source.
- Formatter source reads `#format` at every loop condition (`os.lua:184`) and takes singleton codepoints for the literal, percent code, and optional E/O-modified code (`:185,191,196`). A trailing percent/modifier can return an empty slice and then reach invalid-specifier error; this does not turn into a general substring (`:190–200,280–282`; `base.lua:65–70`).
- Weekday/month labels and conversion sets are Tables, but formatter reads named/integer entries, never their lengths (`os.lua:15–22,167–171,193–204,242–251,268–269`). These reads do not consume the disputed producer.
- Dedicated civil formatting directly concatenates pieces; it does not accumulate an output Table or call `table.concat` (`os.lua:178–287`). Padding calls current global `tostring`, checks `#text`, and prepends a String (`:124–138`); `%u` and `%w` also call live tostring (`:260–265`). Under installed tostring, this is String length, not Table length: `machine/bios/base.lua:235–237`. Arbitrarily replacing tostring can change its returned representation and behavior; captured procedures do not freeze transitive globals.
- Source-derived accepted Table-format behavior, not fresh execution: observed cached length 0 makes initial sub empty and formatter loop empty; observed cached length 1 makes first sub return the original Table and the literal formatter append convert it to `'table'`; observed cached length >=2 reaches byte's String-source error at the first singleton slice. Sources: `os.lua:309–318,182–188`; `base.lua:58–76`; paired byte owners below; paired concat text owners below. These are statements conditional on the actual cached result, **not** a promise about how any arbitrary Table obtains that result.

## 4. Directly inspected paired representation and execution owners

| Guest representation/operation | TypeScript owner | C++ owner | Relevant consequence |
| --- | --- | --- | --- |
| String LEN | `machine/ts/machine/cpu/cpu.ts:2672–2678` | `machine/cpp/machine/cpu/cpu_dispatch.inl:319–324` | Reads String pool codepoint count; does not read Table length. |
| String count production/read | `machine/ts/machine/cpu/string_pool.ts:124–128,58–59` | `machine/cpp/machine/cpu/string_pool.cpp:138–143,72–73` | Stored String codepoint count is separate from Table cache. |
| Table LEN | `machine/ts/machine/cpu/cpu.ts:2680–2682` | `machine/cpp/machine/cpu/cpu_dispatch.inl:326–328`; `machine/cpp/machine/cpu/table.cpp:547–549` | Reads maintained arrayLength/length directly. |
| Captured String byte | `machine/ts/machine/cpu/cpu.ts:4320–4351` | `machine/cpp/machine/cpu/cpu.cpp:2176–2207` | Requires guest String and walks codepoints to requested position; does not use an input Table's numeric entries. |
| Captured String char | `machine/ts/machine/cpu/cpu.ts:4353–4368` | `machine/cpp/machine/cpu/cpu.cpp:2209–2223` | Number codepoints converted U32, checked against scalar range, then interned as String. No Table-length work. |
| `..` instruction | `machine/ts/machine/cpu/cpu.ts:2607–2657` | `machine/cpp/machine/cpu/cpu_dispatch.inl:271–305` | Concatenates rendered guest values into an interned String; not BIOS table.concat. |
| Guest value text | `machine/ts/machine/cpu/value.ts:182–205` | `machine/cpp/machine/cpu/value.cpp:9–29` | String accesses String pool; Table becomes literal text `table`; default tostring is `'' .. value`. |

No TS/native edit is proposed, and these paired leaves are not a claim that all CPU questions or resource behavior are closed.

## 5. What the existing STOP actually establishes

The follow-up's existing STOP concerns generic SETT/refill across array/hash capacity, not every Table operation being known to return different results:

- `docs/manual/technical-follow-up.md:674–685` records NEWT array4/hash8; keys1..5; delete2; generic refill2; TS lengths5→1→5 versus native5→1→4, key5 retained. `:799–803` retains the common producer publication stop. `:952–954` explicitly retains it for ordinary String formatting helper Tables.
- Exact retained CPU-program evidence and its limits: `docs/book1/facts/cpu-values-execution.md:71–92`. That record expressly does not infer ordinary-cartridge reachability or intended common length (`:89–92`). It was read as retained evidence, not rerun here.
- TS generic in-array boundary store calls its cross-hash scanner: `machine/ts/machine/cpu/table.ts:801–812,1426–1440`.
- Native SETT reaches `setNumberArrayKey`: `machine/cpp/machine/cpu/cpu_dispatch.inl:152–162`; that invokes generic `setArraySlot`: `machine/cpp/machine/cpu/table.h:36–43`. This scan stops at array capacity: `table.h:172–184`. By contrast the integer slot owner calls cross-hash update: `table.h:186–195`; cross-hash update is `machine/cpp/machine/cpu/table.cpp:49–67`.
- Native rawSet can invoke the same generic array scan: `machine/cpp/machine/cpu/table.cpp:255–269`; resize/reinsertion uses rawSet and resets maintained length: `table.cpp:213–227`. TS corresponding reinsert/rawSet paths are `machine/ts/machine/cpu/table.ts:1152–1181,1188–1219`. These are why one cannot replace the common producer contract with a generic prefix assertion.

### Reached dependency versus reached known disagreement

For an ordinary leading-! String with >=2 suffix codepoints, os.date **does reach** internal `#output` and `#target`; the general substring/default-concat route therefore retains the existing shared publication dependency. That is narrower and more accurate than treating every os.date formatting call as affected.

The helper starts with a fresh empty Table and writes nonnil String fragments using `output[#output+1]`; it performs no deletion or explicit hole refill (`machine/bios/string/base.lua:77–81`). Consequently this source path does **not itself contain the retained fill1..5/delete2/refill2 sequence**. This audit provides no actual os.date reproduction of the known TS/native disagreement and must not present dependency as an observed different date result. Nor does this limited source trace clear arbitrary append/rehash behavior, the common producer STOP, or cross-runtime output for all inputs.

Non-! String dates and the special no-! `*t` path do not reach helper Table length at all. A Table supplied as format does reach its own maintained length immediately. Merely supplying/returning a calendar field Table in os.time/date does not make that path a Table-LEN consumer.

## 6. Disposition for source preparation

Preserve the existing common Table-length stop for the exact direct Table-format branch and the reached general-substring helper branch; preserve the distinction between a dependency and a demonstrated mirror disagreement. Do not claim the entire time/calendar chapter is approved or blocked solely from a function-name/module-level association. No runtime fix, workaround, narrowed input contract, new validation layer, or publication decision is inferred by this audit.
