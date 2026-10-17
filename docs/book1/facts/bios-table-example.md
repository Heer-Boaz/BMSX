# BIOS table-library program: frozen execution facts

2026-10-18. Baseline `1e8e3f340895affb18d7ee8d2d633eb4c87554fc`.
Scope: ordinary teaching cartridge, existing-harness observation inputs,
companion README and complete program prose. No runtime, BIOS, compiler,
cartlib, publisher or shared-harness edits. Concurrent `.vscode/launch.json`
and `.vscode/tasks.json` changes remain untouched. No architecture.md or
reference PDF was opened.

Before implementing, inspected production Lua organization at
https://raw.githubusercontent.com/lua/lua/master/ltablib.c using curl.
It is only a source-organization reference, not a BMSX semantic oracle.

## Source-backed observations

- TX01. Complete source is `carts/bios_table_manual/results.lua:1-31` plus
  `carts/bios_table_manual/cart.lua:1-73`. Result storage has 23 fields,
  expanding to 31 scalar observation slots including completed. Field numbers
  use f64; count/relation fields use word. Ordinary Table values remain
  language values, not fake register words. Entry imports the exported BSS
  address with an explicit typed view. No local encoding helpers, ABI facade,
  rollback/capture/restore, defensive runtime validation or public-global
  rebinding. Manifest is
  `carts/bios_table_manual/res/manifest/manifest.rommanifest:1-3`.
- TX02. Installed table binding is `machine/bios/main.lua:4-7`. All six
  actual public functions occur in ordinary calls in
  `carts/bios_table_manual/cart.lua:7-69`. Authoring descriptors are
  `toolchain/ts/lua/builtin_descriptors.ts:60-65`; these names/signatures are
  not substituted for behavior defined by `machine/bios/table.lua`.
- TX03. Pack uses the exact argument count at `machine/bios/table.lua:4-10`.
  Program `cart.lua:6-18` packs 10,nil,30,nil; explicit unpack range 1..n
  returns four positions with both nils, retaining first10/third30 and
  n4/resultcount4. Explicit concat range1..4 gives `10||30|`. Nil fields are
  empty fragments, not literal text nil, under table.lua:52-78. Assertion
  input `tests/carts/bios_table_manual/bios_table_manual_assert.lua:11-16`.
- TX04. Program `cart.lua:20-33` starts9,3,7; positional insert at2 gives
  9,5.5,3,7; remove3 returns3; append8 then reports length4. Default ascending
  sort gives5.5,7,8,9. Default unpack has four actual results. Default-length
  concat prints5.5,7,8,9. Owner insert `table.lua:13-26`, remove:29-38,
  sort:145-163, unpack:90-98. Retained assertions:17-25. One-nil insert and
  sort counts are real select('#', ...) observations, each1; source
  fallthrough/default return producer is
  `toolchain/ts/lua/compiler.ts:5767-5771`. No claim that source bodies
  conventionally return zero values is imported from Lua.
- TX05. Program `cart.lua:35-44` negative endpoints-3,-1 produce7:8:9;
  zero endpoints0,0 produce5.5:7:8:9. Explicit reversed range3,2 gives empty
  concat String, retained String length0; unpack reversed range gives0
  results. Owner normalize:41-50, concat:66-78, unpack:90-98. Retained
  assertions:26-29. Reading #empty_text observes actual String length,
  not a truth test or nil test.
- TX06. Program `cart.lua:46-53` sorts descending using actual ordinary
  callback left>right. Retained9,8,7,5.5; default remove returns5.5 and
  remaining length3. Assertions:30-35. These are bounded examples using
  ordinary default-length paths, not an alternative universal Table length.
- TX07. Program `cart.lua:55-69` comparator increments typed count and
  normally compares for calls1..4, then raises the same failure Table on
  call5. Actual protected resultfalse; error identitysame; count5; partial
  order1,3,2. Retained assertions:36-40. Source schedule: sort prescan
  `machine/bios/table.lua:155-158` calls compare(1,3) first; quicksort pivot1
  at:103, compare(3,1) at:115, compare(1,2) and compare(1,1) at:118, then
  swap keys1/2 at:122-127. Next partition attempts compare(3,3), the fifth
  call, raising before another swap. Earlier swap is not undone. This is
  exact current call evidence, not a promised comparator visitation order or
  sorting algorithm ABI. Comparator has no mutation of the input Table.
- TX08. Program `cart.lua:70-73` records completed1 and stays in
  halt_until_irq. Retained suite wait is
  `tests/carts/bios_table_manual/bios_table_manual_assert.lua:8-10`, max8
  observation frames, followed by30 explicit scalar assertions:11-40.
  Timeline `tests/carts/bios_table_manual/ordinary_timeline.json:1-6` ends at
  presentation frame4. Neither endpoint proves a fixed boot/cycle bound.
- TX09. Paired owners were inspected, not modified. TS Table LEN directly
  reads arrayLength at `machine/ts/machine/cpu/cpu.ts:2672-2685`; native LEN
  `machine/cpp/machine/cpu/cpu_dispatch.inl:319-330` reads Table length
  `machine/cpp/machine/cpu/table.cpp:547-549`. TS generic writes
  `machine/ts/machine/cpu/table.ts:790-852` use cross-hash scan:1426-1440;
  native generic write `machine/cpp/machine/cpu/table.cpp:411-443` calls
  setArraySlot `machine/cpp/machine/cpu/table.h:172-184`, whose boundary
  scan ends at array capacity. Integer native path:186-195 calls cross-hash
  scan instead. The already recorded generic SETT/rawset boundary-refill
  disagreement is NOT fixed, bypassed as a new contract, or closed by this
  normal example. Source facts remain
  `docs/book1/facts/cpu-table-semantics.md:41-55` and
  `docs/book1/facts/cpu-values-execution.md:71-92`; public warning is
  `docs/book1/cpu.md:862-870`. Explicit tuple counts and ordinary sequence
  observations are both retained without claiming universal equality of
  maintained length and a maximal populated prefix.
- TX10. Public supporting contracts inspected: typed BSS/address views
  `docs/book1/memory.md:187-216,263-298`, ordinary values versus byte storage
  :358-382; CPU length :596-611,862-870; base expanded counts
  `docs/book1/bios-base.md:179,213-229`, printing:241-249; protected-call
  original error `docs/book1/coroutines.md:29-53`, earlier-write persistence
  `docs/book1/coroutines.md:87` and `docs/book1/bios-base.md:239`,
  one-nil ordinary returns:130. No native execution of this ordinary cart is
  claimed.

## Frozen commands and results

All commands ran at repository root, all completed exit0 after final source.

1. `npm run validate:toolchain:cart -- bios_table_manual --debug`
   Full lint+typed validation passed, debug -O3; artifact published and
   exported in2.8s on the final repeated build (same artifact ID). Log `/tmp/bmsx-bios-table-build.log`.
2. `npm run headless:test -- bios_table_manual tests/carts/bios_table_manual/bios_table_manual_assert.lua`
   `[test] table_library_observations: passed`. Log
   `/tmp/bmsx-bios-table-test.log`. This is the existing derived guest
   integration image; it is not the ordinary image timeline below.
3. `npm run headless:tooling -- --input-timeline tests/carts/bios_table_manual/ordinary_timeline.json bios_table_manual`
   Actual ordinary cartridge executed with matching installed BIOS in TS
   headless tooling. Presentation-frame4 observation completed; host log
   reports `[bootrom:headless] Input timeline completed.`. Fourteen real
   program diagnostic lines observed. Log `/tmp/bmsx-bios-table-ordinary.log`.
4. Source/chapter exact assembly and retained-field coverage checked by
   comparing all four chapter Lua fences with the actual two source files.
   Actual source maximum display width79 columns after tab expansion at4.
   `git diff --check` passed. No screenshot, native, exhaustive comparator,
   arbitrary recursion-depth/capacity or timing-performance claim is made.

One intermediate validation failed on existing cart-lint rules (staged
call-result export, empty-string comparison, if/error assertion pattern).
Only example source was revised: direct field tuple assignment; direct String
length observation; normal comparator return followed by deliberate error.
No lint/harness/runtime exception was added. Final validation above passed.

## Artifact identity and source hashes

Artifact ID:
`87949d2b9d1d696612fa6589edcf126aa20d655d0eb2f83629ffed8e88d79c77`.
Artifact metadata at
`.bmsx/builds/artifacts/87949d2b9d1d696612fa6589edcf126aa20d655d0eb2f83629ffed8e88d79c77/artifact.json`
contains the matching cart/system digests. SHA256 observations:

| File | SHA256 |
| --- | --- |
| `dist/bios_table_manual.debug.rom` | `7db6db64b504a621100923ad263bbc2b6669628a268e9b3393e0e801c76fe945` |
| `dist/system/bmsx-bios.debug.rom` | `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664` |
| `dist/host_headless_tooling.debug.js` | `a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470` |
| `carts/bios_table_manual/results.lua` | `22cc7b92dbbd233f82f8994e9a284cf9faebcb9f448758b1ab306e6d359332ee` |
| `carts/bios_table_manual/cart.lua` | `5b6faaef15fed28acdebdae6f514ca7782683a7cd04c1ef222e28ce469671f9f` |
| `tests/carts/bios_table_manual/bios_table_manual_assert.lua` | `356dd07444f39bbd2b702ccd56c645a270e8387ee1c9325112d2059e7778bc9c` |
| `tests/carts/bios_table_manual/ordinary_timeline.json` | `2f70050a865f4d706dd529d475d4e665b0f2cebdccc33f780e9c96861ad62192` |

## Exact ordinary program diagnostics

Tabs below are actual tabs. These fourteen lines follow BIOS startup and
precede the host timeline-completion line:

```text
Packed tuple	10	nil	30	nil
Tuple counts	4	4
Packed concat	10||30|
Mutation	1	3	4
Ascending	1	5.5,7,8,9
Default unpack	5.5	7	8	9
Default unpack count	4
Negative range	7:8:9
Zero range	5.5:7:8:9
Empty ranges		0
Descending	9,8,7,5.5
Removed last	5.5	3
Comparator failure	false	true	5
Partial sequence	1,3,2
```

## Newcomer prerequisite closure

The companion originally assumed that the BIOS and headless artifacts already
existed. Reader review identified that prepared-checkout boundary. The README
now supplies the existing explicit prerequisites before cartridge validation:
`npm run build:product:node-headless-tooling -- --debug` and
`npm run build:toolchain:bios -- --debug`. Root executed both successfully
(`/tmp/bmsx-bios-table-tooling-build.log`,
`/tmp/bmsx-bios-table-bios-build.log`), then reran the documented cartridge
validation, retained case and ordinary timeline. The three final exported
ROM/tooling hashes still equal those frozen above; this is not a claim of
installing the entire SDK on a fresh operating system.
