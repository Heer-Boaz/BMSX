# BIOS table library: independent bounded contract-source review

2026-10-18. Read-only review; only this report was written. No architecture
document or PDF was opened. No runtime, BIOS, compiler or chapter edit was made
by this reviewer. Source and recorded execution evidence were inspected; this
reviewer did not rerun build, guest or native execution commands.

## Frozen scope and disposition

Reviewed the complete opening, all six API descriptions, all small API snippets,
range/normalization tables, mutation/comparison/work statements, shared error
rows, and resource-limit section in `docs/book1/bios-table.md`. Also inspected
`bios-table{,-reference,-positions,-example}.md` facts as evidence indexes and
the necessary TS/native CPU, Table, numeric/value leaves, host/firmware return
and numeric-for producers, BIOS installation/base dependencies, and authoring
signature/minimum-arity diagnostics. This was a bounded table-contract review,
not an audit of every CPU/compiler/optimizer/GC/runtime path.

**No remaining factual failure was found in that reviewed contract scope after
the closures below. This is not publication approval.** The existing common
length-producer disagreement remains an explicit publication blocker in facts
and review JSON. Reader and print acceptance are separate decisions.

Final chapter inspected: 540 lines; SHA256
`21e9b09788cd346e78c7b5b08556c25d8be63fbc9cba941b59239916f28b1969`.

## Precise findings raised and verified closed

1. Original sentence: “Assigning nil removes the effective mapping.”
   Actual owner: `machine/ts/machine/cpu/table.ts:790-824` removes the target's
   own entry; `:349-369` follows a missing entry into a Table-valued `__index`.
   Native ordinary writes likewise address only the named Table:
   `machine/cpp/machine/cpu/cpu.cpp:3335-3340` and
   `machine/cpp/machine/cpu/table.cpp:411-430`.
   **Closed:** current chapter lines43-44 explicitly say own mapping and that
   nil does not mask an inherited mapping.

2. Original error row: “Indexing a non-Table” ->
   `Attempted to index field on a non-table value.`
   Actual owner explicitly supports String bases through the String-index
   Table: TS `machine/ts/machine/cpu/cpu.ts:629-637`; native
   `machine/cpp/machine/cpu/cpu.cpp:3243-3257`.
   **Closed:** current row says “Indexing a value with no indexing support.”
   The new String-target paragraph (chapter48-53) correctly distinguishes
   codepoint LEN, String-index Table reads, and Table-only writes; it does not
   invent character indexing or an upfront target validator.

3. Original no-tail runtime description: “both the selected position and
   value are then nil.” Actual selected first argument is nil, but the local
   computed position is NaN: `machine/bios/table.lua:19`; no-result padding
   `machine/ts/machine/cpu/cpu.ts:3406-3418`; numeric read
   `machine/ts/machine/cpu/value_slots.ts:128-131`; FLOORDIV
   `machine/ts/machine/cpu/cpu.ts:2564-2567,2584-2586`.
   **Closed:** current chapter166 distinguishes nil selected arguments from
   NaN position arithmetic. Direct `table.insert(target)` remains disallowed
   by minimum arity, while the described indirect `pcall` route reaches the
   runtime body. Descriptor: `toolchain/ts/lua/builtin_descriptors.ts:61`;
   diagnostics: `toolchain/ts/lua/semantic/diagnostics.ts:357-375,395-415`.

4. Original finite-position work statement: “With a finite numeric position,
   positional insertion performs `L - p + 1` shift assignments ...”. Finite
   magnitude alone does not guarantee advancing unit steps: numeric-for emits
   repeated ADD at `toolchain/ts/lua/compiler.ts:4518-4519`; Number ADD is
   `machine/ts/machine/cpu/cpu.ts:2569-2571` (native mirrored ADD leaf).
   Likewise the original general finite-integer balanced-concat statement
   omitted midpoint progress: `machine/bios/table.lua:61-62` uses Number
   addition/floor division, which can round a huge midpoint to an endpoint.
   **Closed:** current work paragraph278 conditions counts on normal unit-step
   loop completion; concat157 explicitly conditions balanced recursion on
   shrinking midpoint ranges and warns about very-large-finite rounding.

## Verified contract evidence

- Installation and exact six public functions: `machine/bios/main.lua:4-7`;
  `machine/bios/table.lua:1-165`. Ordinary Tables and typed byte storage are
  not conflated.
- Result widths: BIOS return sites match the chapter. Bare return/default
  fallthrough is one nil, not stock-Lua zero results: host compiler
  `toolchain/ts/lua/compiler.ts:4372-4377,5767-5771`; firmware compiler
  `machine/bios/compiler/compiler.lua:1133-1146,1738-1744`. Final expanding
  returns forward the actual tuple, including empty select results:
  host4392-4408, firmware1151-1159 and CPU fixed/open delivery.
- Pack: `table.lua:4-10`, exact live-select count, numeric positions, nil
  deletion, ordinary mutable `n`, and explicit `n` unpack recipe. No false
  `#packed == n` promise or constant total-work claim was found.
- Insert/remove: `table.lua:13-38`, argc branch versus nilness, unbounded
  ordinary keys, floor division, direction and sequence of assignments,
  unconditional old-tail clear, removed value retained before writes, one
  result, unchanged `n`, and no rollback. Small zero/gap/above-tail examples
  agree with those source procedures and the retained paired probe bodies.
- NaN positions: the revised hazards match the strict exit producers:
  host compiler4486-4521; firmware compiler1485-1567,1575-1599; TS LT
  `cpu.ts:2724-2735`; native `cpu_dispatch.inl:356-368`. With NaN exit
  operands the exit comparison remains false. Insert may make shift writes
  without reaching final insertion; remove repeatedly addresses its NaN key
  without reaching tail clear through normal loop termination. No fabricated
  arithmetic error or universal infinite-duration execution proof is claimed.
- Bounds/concat/unpack: `table.lua:41-98`, initial LEN even with explicit
  bounds, floor first, positive/negative/zero-or-NaN conversion, inclusive
  nonclamped intervals, empty concat before separator conversion, nil fields
  retaining separators, live tostring, and empty unpack forwarding select(1).
  Nonnumber numeric reads yield NaN, not parsed numeric Strings or argument
  faults. Numeric helpers: TS `machine/ts/spec/blua32/numeric.ts:1-5`, native
  `machine/cpp/spec/blua32/numeric.h:7-11`.
- Sort: `table.lua:101-163`, L<2 early return, deferred noncallable-comparator
  error, full-prefix quicksort after first prescan inversion, ordered-input
  L-1 calls, retained midpoint pivot and sequential swaps, first result and
  guest truthiness, unstable/inconsistent comparator limits and surviving
  writes on failure. Default mixed-category LT is false, not an invented
  comparison error: TS `cpu.ts:2701-2736`, native dispatch356-368.
- All six printed shared error texts match owners exactly: TS
  `cpu.ts:496-504`, native `cpu.cpp:371-379`. Reached LEN/index/write/CALL
  leaves support the narrowed labels. The chapter does not claim every bad
  argument reaches a listed error immediately.
- Resource/cost claims are negative or procedure-specific, not a new safe
  range/capacity promise: table.lua recursion/loops, tuple suffix forwarding,
  temporary Strings and callbacks are visible. No fixed total cycles,
  arbitrary-input termination, maximum safe result count or performance
  benchmark result is inferred.

## Common-length STOP remains open

Inspected the actual differing producers: TS generic store
`machine/ts/machine/cpu/table.ts:801-812,1426-1440` scans through hash-held
consecutive numeric keys. Native generic SETT reaches `setNumberArrayKey`
(`cpu_dispatch.inl:152-161`, `table.h:36-43`) and the array-capacity-limited
`setArraySlot` scan (`table.h:172-184`). Native SETI uses the different
cross-hash integer path and cannot clear this disagreement. Public rawset
reaches the corresponding generic owners.

The recorded CPU evidence at `docs/book1/facts/cpu-values-execution.md:73-92`
retains TS5->1->5 versus native5->1->4, both33 charged cycles, key5 still50.
`docs/book1/facts/bios-table.md:18-36` retains its publication STOP;
`docs/book1/reviews/bios-table.json` still has open datapath/programming
coverage and facts.passed=false. Describing procedures in terms of captured L,
normal recipes, or the final18 paired comparisons does not establish a common
universal length producer. No runtime repair is inferred.

## Evidence and public crossreferences

Read actual final scratch source and log: nine bodies, each O0/O3,18 true
completions and18 equal decoded final snapshots. The console stub prevents
using these as diagnostic evidence; they are not complete BIOS boot or native
ordinary-cart execution. The separate preserved initial position experiment
failed its bounded TS completion assertion after10000 grants of17 cycles; it
is excluded from the passing18 and establishes neither native disagreement
nor a universal nontermination theorem.

All named supporting chapter titles exist and are in the public manual
catalog: CPU, Memory, BIOS base, Protected calls and coroutines, System control
and timing, and Interrupt controller (the CPU's onward IRQ reference). For
this scope they supply the stated maintained-length/value/index/call rules,
result adjustment/select/tostring, typed BSS/views/module startup, protected
original error/earlier-write persistence, instruction charges/IRQ boundary,
and hardware fault publication. Relevant public sections inspected include
CPU391-466,596-630,705-727,824-878; Memory185-216,251-300,359-413;
base175-249; coroutines25-53,78-87; System129-205. No whole-book acceptance
is inferred from these connected contracts.

## Exact coverage boundary

The complete program, every retained field/diagnostic row, literal module
assembly and artifact hashes were preliminarily inspected, but their final
independent acceptance is deliberately delegated to the separate nonauthor
program reviewer. They are not an additional responsibility or acceptance gate
closed by this report. Reader/print/UI acceptance, arbitrary comparator
mutations, resource-exhaustion execution, huge ranges, exhaustive optimizer/GC
behavior, native ordinary-cartridge execution, and all unrelated runtime-owner
questions remain outside this bounded review.

No contract section listed in the frozen scope above remains unreviewed.
No remaining factual failure was found there after the verified closures;
the common-length publication blocker remains open exactly as stated.

## Separate complete-program closure

The nonauthor [complete-program sub-audit](bios-table-program-source.md) now
covers the final literal104 source lines, every retained field and assertion,
all14 actual ordinary diagnostic lines and all seven current artifact/source
hashes. It found no remaining failure or unchecked item in that requested scope.
Together these two bounded source passes cover the chapter's factual claims;
they do not close the common-length publication blocker. The independent
[reader review](bios-table-reader.md) and [actual-PDF review](bios-table-print.md)
retain their own precise scopes and limitations.
