# BIOS table complete-program source sub-audit

**No issues found in the bounded scope.** Reviewed only `docs/book1/bios-table.md:312-540` (Complete program through EOF) against its actual sources, retained assertions, existing ordinary-execution logs and current artifact digests. This reviewer made no repository edits and performed no build, test or cart execution; execution evidence below is independently inspected retained evidence, not a new execution claim.

## Exact authored source and coverage

- All four Lua fences were extracted and compared byte-for-byte, including whitespace. `docs/book1/bios-table.md:330-360` equals all **31 lines** of `carts/bios_table_manual/results.lua:1-31`. Concatenating `docs/book1/bios-table.md:377-395,415-440,460-487` equals all **73 lines** of `carts/bios_table_manual/cart.lua:1-73` (19 + 26 + 28 lines). Total public program: **104 source lines**.
- Result storage has **23 named fields / 31 scalar slots including `completed`**, matching the complete retained-observations table at `docs/book1/bios-table.md:498-515`; no field is missing. `tests/carts/bios_table_manual/bios_table_manual_assert.lua:11-40` contains **30 explicit scalar assertions** covering the non-completion slots; `:8-10` waits for `completed == 1`. Public array order matches typed-storage indices zero onward.
- The retained values all match the actual program and assertions: tuple counts 4/4, tuple Numbers 10/30, both nil holes, pipe-bearing concat equality, insert/sort result counts 1/1, removed3/length4, ascending5.5/7/8/9, default unpack count4, negative/zero concat matches, reversed-range lengths/counts0/0, descending9/8/7/5.5, removed-last5.5/remaining3, comparison count5/error identity1, partial1/3/2. The escaped Markdown pipes at `docs/book1/bios-table.md:504` retain the intended literal `10||30|`.

## Shown operation claims

- `docs/book1/bios-table.md:365-374` matches `cart.lua:6-18` and BIOS pack/explicit unpack/concat paths at `machine/bios/table.lua:4-10,52-78,81-98`: explicit n preserves four positions including the trailing nil; concatenation emits empty nil fragments but retains separators.
- `docs/book1/bios-table.md:400-412,443-445` matches `cart.lua:20-44`, the retained assertions and the ordinary diagnostics. Shown insert/remove/append/ascending-sort/default ranges and negative/zero/reversed endpoints agree with `machine/bios/table.lua:13-50,66-98,145-163`. The public wording limits the observed length to this sequence rather than defining a universal Table-length replacement. One-nil ordinary-return counts are observed by the actual program and agree with `toolchain/ts/lua/compiler.ts:5767-5771`.
- `docs/book1/bios-table.md:449-457` matches `cart.lua:46-73`. The bounded comparator raises the same Table on call5; `machine/bios/table.lua:101-163` explains the earlier first swap and retained `1,3,2` order. BIOS `machine/bios/base.lua:8-11,213-216` installs the actual select/error/pcall primitives. Public protected-error identity and earlier-write persistence agree with `docs/book1/coroutines.md:29-50,87` and are directly observed by the assertion/output evidence. No comparator-visit ABI or rollback is promised. The completion store and persistent `halt_until_irq` loop are literal source at `cart.lua:70-73`.

## Existing command/log and exact diagnostics evidence

- `/tmp/bmsx-bios-table-build.log` records the documented `validate:toolchain:cart` debug -O3 recipe and successful publication/export of artifact `87949d2b9d1d696612fa6589edcf126aa20d655d0eb2f83629ffed8e88d79c77`.
- `/tmp/bmsx-bios-table-test.log` records `[test] table_library_observations: passed`, loading the actual named ordinary cart/system ROM paths. This remains retained integration evidence, not a claim that the derived test image is the ordinary timeline image.
- `/tmp/bmsx-bios-table-ordinary.log` records the ordinary `headless:tooling --input-timeline` command, the named cart/system ROM paths, BIOS startup, all program diagnostic lines, and `[bootrom:headless] Input timeline completed.` Timeline source `tests/carts/bios_table_manual/ordinary_timeline.json:1-6` ends at presentation frame4; no fixed boot/cycle bound is inferred.
- Extracted `docs/book1/bios-table.md:526-539` is **byte-for-byte equal to all 14 actual ordinary diagnostic lines** between `CARTRIDGE READY` and host timeline completion in that log. This includes actual tab separators and exact `Empty ranges\t\t0`, error flags `false\ttrue\t5`, nil text, numbers and partial order. It also equals frozen diagnostics `docs/book1/facts/bios-table-example.md:148-161`.

## Independently rehashed current artifacts

Every current file below equals its frozen SHA-256 at `docs/book1/facts/bios-table-example.md:132-140`:

| File | Current SHA-256 |
| --- | --- |
| `dist/bios_table_manual.debug.rom` | `7db6db64b504a621100923ad263bbc2b6669628a268e9b3393e0e801c76fe945` |
| `dist/system/bmsx-bios.debug.rom` | `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664` |
| `dist/host_headless_tooling.debug.js` | `a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470` |
| `carts/bios_table_manual/results.lua` | `22cc7b92dbbd233f82f8994e9a284cf9faebcb9f448758b1ab306e6d359332ee` |
| `carts/bios_table_manual/cart.lua` | `5b6faaef15fed28acdebdae6f514ca7782683a7cd04c1ef222e28ce469671f9f` |
| `tests/carts/bios_table_manual/bios_table_manual_assert.lua` | `356dd07444f39bbd2b702ccd56c645a270e8387ee1c9325112d2059e7778bc9c` |
| `tests/carts/bios_table_manual/ordinary_timeline.json` | `2f70050a865f4d706dd529d475d4e665b0f2cebdccc33f780e9c96861ad62192` |

The matching artifact metadata at `.bmsx/builds/artifacts/87949d2b9d1d696612fa6589edcf126aa20d655d0eb2f83629ffed8e88d79c77/artifact.json:1` carries the same cart/system ROM digests and debug optLevel3 recipe. Thus the currently present artifact hashes independently agree with the frozen rerun facts; logs alone were not used as artifact-identity proof.

## Explicit boundaries

No unchecked item remains within the requested 104-line source / 31 retained-slot / 30 assertion / 14 diagnostic-line / current-digest scope. This is not a whole-CPU, native-execution, arbitrary-comparator, timing/performance, universal Table-length, architecture, historical-PDF or publication audit. No new execution or broader correctness claim is made.
