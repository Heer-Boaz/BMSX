# BIOS String complete-program source sub-audit

**No concrete false or unsupported claim found in the bounded scope.** This
nonauthor review inspected the complete-program section of
`docs/book1/bios-string.md`, the literal ordinary cartridge, its manifest and
README, retained assertions, existing execution logs and current artifact
hashes. No build, cartridge run or paired probe was rerun by this reviewer;
execution statements below describe independently inspected retained evidence.
No architecture document or historical PDF was opened.

## Literal program and retained results

- The five complete-program Lua fences contain **37, 28, 19, 19 and 29 lines**.
  The first fence is byte-for-byte equal to
  `carts/bios_string_manual/results.lua:1-37`; concatenating the last four is
  byte-for-byte equal to `carts/bios_string_manual/cart.lua:1-95`, including
  whitespace. Thus the public program supplies all **132 source lines**, not
  pseudocode or an omitted local decoder. README:19-33 correctly supplies the
  two-module assembly order and complete literal manifest.
- Result declarations `results.lua:3-31` contain **28 named fields / 33 scalar
  word slots**, including completion. The public retained-observations table
  names every field with values matching the actual stores and assertions.
  `tests/carts/bios_string_manual/bios_string_manual_assert.lua:11-42` has
  **32 explicit scalar assertions**; :8-10 separately waits for completion.
  The independently exported BSS byte buffer is input storage, not an omitted
  retained result field.
- All nine named base exports are reached by `cart.lua:12-88`. The program uses
  the installed BIOS interface, typed BSS/readonly declarations and mapped
  views directly, without a cartridge-local codec or encoding helper.

## Actual owner checks for the shown observations

- Four codepoints versus eight encoded bytes, ASCII-only case changes and
  codepoint-indexed byte reads (`cart.lua:6-27`) agree with
  `machine/bios/string/base.lua:9-25,39-55`, paired String LEN leaves
  `machine/ts/machine/cpu/cpu.ts:2672-2685` and
  `machine/cpp/machine/cpu/cpu_dispatch.inl:319-330`, and paired byte/char
  leaves `cpu.ts:4320-4367` / `machine/cpp/machine/cpu/cpu.cpp:2176-2222`.
- The shown method route, floored relative substring bounds, zero end bound,
  clamped full span, complete-codepoint reversal and default/zero/separated
  repetition (`cart.lua:29-46`) agree with `string.lua:1-22`,
  `string/base.lua:27-36,58-120` and paired String-index reads
  `cpu.ts:629-637` / `cpu.cpp:3251-3257`. The Table-range contrast for an end
  bound of zero matches `machine/bios/table.lua:41-50,66-69,90-93`; it does not
  supply a new universal Table-length formula.
- Negative byte position, ignored third argument, fractional/signed-word
  wrapping, unsigned char wrapping and the two protected errors
  (`cart.lua:48-65`) agree with the paired byte/char leaves above and central
  native word conversion `machine/cpp/machine/cpu/value.h:199-229`. Exact
  `Invalid argument.` text is installed at `cpu.ts:505` / `cpu.cpp:380`.
- Full-span/NUL decoding and the deliberately short declared span
  (`cart.lua:67-76`) match the actual lead-driven reads in
  `machine/bios/string/utf8.lua:10-38`. Both bytes for the E9H observation are
  present at `cart.lua:7`; no unmapped-memory safety promise is made.
- The 257-byte input, decode, **source-byte rewrite after return**, retained
  codepoints 65/65/65 and source readback 90 (`cart.lua:79-91`) match decoder
  chunk construction `utf8.lua:6,37-53` and the ordinary diagnostics. The
  String is constructed from read codepoints rather than retained as a mapped
  byte view. The chapter does not turn the 256-codepoint staging chunk into a
  capacity limit. Completion precedes the literal persistent wait loop at
  `cart.lua:92-95`.

## Retained execution and artifact evidence

- `/tmp/bmsx-bios-string-tooling-build.log` and `-bios-build.log` show successful
  prerequisite builds. `-build.log` shows the debug/O3 cartridge lint,
  compilation and artifact publication. `-test.log` records
  `[test] string_operations: passed` against the named cart/system ROMs.
- `/tmp/bmsx-bios-string-ordinary.log` shows actual installed BIOS startup,
  cartridge readiness, **all nine tab-exact public diagnostic lines**, and
  timeline completion. The public block is byte-for-byte present in that log
  and README:78-87, including the final source readback 90. Timeline frame4
  (`ordinary_timeline.json:1-6`) is correctly described as an observation
  endpoint, not a boot-time or cycle guarantee. Retained integration evidence
  is not conflated with ordinary cartridge playback or native execution.
- The seven current file hashes were independently recomputed and all match
  `docs/book1/facts/bios-string-example.md`'s frozen SHA-256 table: cart ROM,
  system ROM, tooling product, two literal modules, retained test and timeline.
  Artifact metadata at
  `.bmsx/builds/artifacts/7bbc5f66760685cc2455b5127aa84aa184aa9211b6563bb21a30ea79a497987d/artifact.json:1`
  carries the same cart/system digests and debug optLevel3 recipes. Log text
  alone was not treated as proof of current artifact identity.
- `/tmp/bmsx-bios-string-probe.ts:16-113` and its final log support exactly
  **seven bodies at O0 and O3 = 14 true completions and equal decoded final
  TS/native snapshots**. The script uses the production String compositor
  with explicit console stubs, test-linked system images, 17-cycle TS grants,
  existing CPU capture/restore and the existing native coroutine runner.
  This is bounded supplemental evidence, not full BIOS boot, native ordinary
  cartridge execution, arbitrary-input coverage or physical throughput.

## Limits

This passes only the complete-program, retained-observation and recorded
execution-identity sub-audit. It does not approve the chapter as a whole or
its print output, settle arbitrary malformed encoding or resource limits,
repair runtime/compiler behavior, or close the existing common Table-length
producer STOP. No publication approval is implied.
