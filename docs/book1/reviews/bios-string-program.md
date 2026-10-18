# BIOS String complete-program source sub-audit

## Current pattern and packet programs — exact final source

2026-10-18; baseline b515e804e plus this documentation/example worktree.
The chapter is SHA-256
`a7b97cbab88db05e0e2a65a871beec4872b705292e298262bf5947b8e7ea01b5`.
The two new cartridges are separate ordinary programs; neither extends another
entry or introduces a local matcher/codec/ABI helper. Existing runtime, BIOS,
compiler, test framework and publisher are unchanged.

| Program | Complete result module | Entry parts and exact assembly | Retained check | Independent ordinary output |
| --- | --- | --- | --- | --- |
| Pattern searches/substitutions | 47 lines, SHA `b4af10e7290a76adef699f49db75431a4f8b0728cae755c9a1239ab69e5ec3f0` | 30+28+11+19+30 lines plus four blank separators =122; SHA `215f1e96904e11dfd8eca819ee95a4c314516824a05567cfe0acbbc9b8e05583` |40 explicit assertions after completion wait |13 exact diagnostic lines, including the standalone final replacement-error payload |
| Packed record |42 lines, SHA `014393c2fa8c85a19d06df7a8bdde166eb49acfcae87f6958c4bdb738e678491` |29+28+19+11+26 plus four blank separators =117; SHA `c55e1f8b2541a858d798085625725fcb4db2070942ac774b5548567089bd76fa` |33 explicit assertions after completion wait |8 exact diagnostic lines |

The independently reviewed final chapter blocks reconstruct the actual files
byte-for-byte, with exactly one blank line between adjacent entry parts. The
printed manifests/timelines likewise match the actual files. Comparison words
are explicit Boolean observations; Strings are not invented raw addresses.
`completed=1` only establishes reaching the marker. The tests separately
check every non-completion result cell; the timelines themselves assert none.

Root actually ran each existing validated cart build, the supplied fresh-target
integration suite and separate ordinary playback. Final commands exited0;
the two cases are `pattern_operations` and `binary_records`. Exact source,
ROM/BIOS identities, command/log paths and literal outputs are in
[pattern example evidence](../facts/bios-string-pattern-example.md) and
[packing example evidence](../facts/bios-string-pack-example.md).
Independent reviewers read those actual source/owner leaves and logs but did
not themselves rebuild or rerun the cartridge. This is separate from ordinary
playback identity and is not native execution.

Pattern observations cover plain/pattern/codepoint positions, text/position
captures, generic iteration and anchored searches, greedy/minimal spans,
balance/frontier/backreference/complement matching, all three replacement
kinds, empty advancement and reached/deferred errors. Packing checks all33
packet codepoints, fixed header23/record33, continued positions24/34, both endian
orders and padding, exact selected f/d values, truncation/zero-padding,
embedded-zero/terminated text, larger-than-octet codepoints and three errors.
These are bounded examples, not universal grammar/numeric/resource coverage.

The independent compiled-call follow-up checked actual nested pack/char calls,
two-result direct struct assignments, typed-word stores and final unpack
forwarding at `toolchain/ts/lua/compiler.ts:3889-3939,4025-4079,4178-4231,5235-5245,5647-5690,5754-5764`
and the actual BIOS return producers. No conclusion relies on parentheses
forcing one result. Initial source proposals failed existing cached-call/export
lint; the cart was simplified and rebuilt, not the linter relaxed.

Raw final reports: `/tmp/bmsx-pattern-program-source-review.md` and
`/tmp/bmsx-pack-program-proposal-source-review.md` (its final actual-source and
combined public sections supersede the earlier proposal-only scope).
The [reader record](bios-string-reader.md) explicitly distinguishes combined
source-aware reconstruction from a fresh source-blind public-reader pass.
The common Table-length STOP, CPU7/BZ01, every native/all-input/optimizer-wide
claim and machine-resource/completion ceilings remain OPEN.

---

## Earlier formatting and base-program evidence

## Current formatting program/source-evidence review

2026-10-18. Independent, finite read-only review of the current worktree and retained artifacts. **No remaining failure found in the reviewed program/public-literal/build-and-observation contract after the wording corrections described below.** This is not an unconditional formatter or publication sign-off.

This agent did not edit repository files, build, execute guest tests, or mutate the frozen cartridge/BIOS artifacts. It inspected the supplied logs, current sources and artifact bytes. `docs/book1/facts/bios-string-format.md` was used as an owner index, not as independent proof of its own claims. No architecture document or reference PDF was opened. The full earlier formatter prose and every fact-card assertion were not independently re-audited in this program-focused pass.

### Literal source reconstruction and boundaries

- `docs/book1/bios-string.md:789-817` contains a 27-line Lua block exactly equal, including final newline, to `carts/bios_format_manual/results.lua`.
- The three entry blocks at `docs/book1/bios-string.md:827-848,863-879,894-927` contain respectively 20, 15 and 32 lines. Joining them in order **with one blank line between adjacent parts** produces the exact 69-line `carts/bios_format_manual/cart.lua`, including final newline. No omitted function, prelude, extra entry declaration or local formatter is needed.
- Initial audit finding, now corrected: plain byte concatenation of those three blocks gives 67 lines, not the asserted 69. `docs/programming/getting-started.md:386-390` now explicitly says “separating adjacent parts with one blank line”; `carts/bios_format_manual/README.md:5-6` has the same correction. This was a source-assembly wording issue, not a source/runtime change.
- The complete manifest block in the companion exactly matches `carts/bios_format_manual/res/manifest/manifest.rommanifest:1-3`: title plus one `type: rom` hardware entry. The printed JSON block exactly matches `tests/carts/bios_format_manual/ordinary_timeline.json`.
- The cart has only `require('results')` (`cart.lua:3`), a typed pointer to that module's result (`:4`), installed library/global calls, scalar observations and the normal halt loop (`:66-69`). There is no hidden API import, cartridge-local encoding/fixed-point/ABI/allocator helper, caller output-buffer address, generated game-specific support module or asset requirement in these complete source files.
- The ordinary result module declares 19 fields, all `word`, and one BSS instance (`results.lua:3-25`); it exports that instance at `:27`. Shared owner `toolchain/ts/lua/compiler/struct_types.ts:44-55` defines `word` as size/alignment 4 with Word memory access. The cart writes numeric comparison/count/codepoint observations, never guest Strings into numeric address/word fields. This is a local representation verification, not an audit of all BSS or memory behavior.

### Retained observations: all fields and all 18 assertions

The chapter table at `docs/book1/bios-string.md:931-941` covers all 19 declared fields. The completion field is used by the integration wait (`tests/carts/bios_format_manual/bios_format_manual_assert.lua:8-10`); the following 18 explicit assertions occupy `:11-28`.

| Field(s) | Actual producer | Required retained value(s) |
| --- | --- | --- |
| `completed` | `cart.lua:66` | 1 |
| `basic_match`, `sign_match`, `prefix_match` | `cart.lua:7-12` | 1, 1, 1 |
| `stars_match`, `left_match` | `cart.lua:16-19` | 1, 1 |
| `zero_integer_match`, `unsigned_match` | `cart.lua:23-26` | 1, 1 |
| `float_match`, `special_match`, `fixed_large_match` | `cart.lua:30-35` | 1, 1, 1 |
| `quote_match` | `cart.lua:39-41` | 1 |
| `nul_length`, `nul_codepoint`, `nul_trailing_codepoint` | `cart.lua:40,42-44` | 2, 0, 0 |
| `empty_integer_length`, `nonnumeric_width_match` | `cart.lua:49-50` | 0, 1 |
| `incomplete_error`, `unsupported_error` | `cart.lua:54-62` | 1, 1 |

`/tmp/bmsx-format-cart-final-test.log:5` is exactly `[test] formatted_text: passed`; its command at `:2` names the current integration suite, and `:3-4` identify both debug ROM paths. Passing here is retained derived-target execution evidence, not an ordinary-image identity claim.

The separate current unit suite `format_char_assert.lua:5-21` has seven explicit assertions covering `%c` 0, 65, 65.75, width 3; direct one-argument char versus the grouped modf call; and grouped/ungrouped select result counts. `/tmp/bmsx-format-char-final-test.log:5` is exactly `[test] format_char_call_results: passed`. The log does not expose the three diagnostic `print` lines from that suite; those values are evidenced by its asserted conditions and pass, not falsely quoted as visible unit stdout.

### Actual `%c` source chain, not stock-Lua grouping

I opened these direct owners rather than treating the fact card as proof:

1. Installed String composition obtains `string/format` and installs its member (`machine/bios/string.lua:12-20`). Format captures base char and Math modf at module initialization (`machine/bios/string/format.lua:1-9`). Base char is the VM primitive (`machine/bios/string/base.lua:1-2,39-40`).
2. Math modf explicitly returns **two results**, `integer, value - integer` (`machine/bios/math.lua:59-62`; trunc at `:27-32`).
3. The `%c` branch selects one format argument, advances the format argument index once, and calls exactly `formatted = char((modf(value)))` (`machine/bios/string/format.lua:386-390`).
4. The host parser consumes parentheses and returns the inner expression directly (`toolchain/ts/lua/syntax/parser.ts:1345-1349`). Host lowering tests the final argument for multireturn (`toolchain/ts/lua/compiler.ts:5648-5652`) and emits its all-results/open-argument call path (`:5685-5690`). The actual classifier, including the known-single-result optimization exception, is at `:5754-5764`.
5. The TS char owner iterates **all** received arguments and appends every decoded codepoint (`machine/ts/machine/cpu/cpu.ts:4353-4367`). The native consumer likewise iterates all received arguments (`machine/cpp/machine/cpu/cpu.cpp:2209-2222`); this is native source inspection, **not native playback**.

Thus the named tested pipeline forwards both modf results into one char call and constructs one two-codepoint String, not two formatter returns and not two format arguments consumed. The program, unit fixture, current chapter table and ordinary log agree. There is no authorized or actual compiler/BIOS fix in this example, and no new BZ identity or all-optimization/all-source-pipeline theorem is inferred. The existing cartridge-source grouping distinction is also stated at `docs/book1/memory.md:409`.

The initial failure is not hidden: `/tmp/bmsx-format-cart-test.log:5-8` reads `[test] formatted_text: failed`, `[test:body] assertion failed!`, and points to integration fixture line 23. `/tmp/bmsx-format-ordinary-initial.log:17` already prints a NUL length of 2. `docs/book1/facts/bios-string-format-example.md:45-51` and the README record that the original expectation was one codepoint and that it was corrected only after the actual producer/consumer chain and separate unit observations. The failed log alone identifies the old failing assertion location, not its historical RHS; I did not pretend the now-corrected current line is a retained copy of that old assertion text.

### Direct formatting algorithm checks for the program claims

The entire format owner was inspected. The finite claims illustrated by this program match its branches: sign/prefix padding `machine/bios/string/format.lua:80-106`; width then precision star selection `:324-363`; U32 and base output `:108-137,391-429`; zero precision then alternate octal `:409-427`; fixed/scientific/general construction `:150-207,232-255`; special floating text `:139-148,430-445`; visible quoting escapes `:258-280`; and the two reached explicit errors `:293-295,451-452`.

In particular, fixed whole text calls current tostring (`:150-162`), whose installed default is `machine/bios/base.lua:235-237`; ordinary TS Number text delegates to central formatNumber (`machine/ts/machine/cpu/value.ts:182-195`). The observed `1e+06` is not silently replaced by an assumed fixed-decimal grammar. Alternate general format bypasses the zero-strip branch (`format.lua:249-250`) without claiming universal safety or closure of other helper-Table paths. The nonnumeric-width and missing-integer observed paths are not recast as stock-Lua type errors: format selects raw values, modf uses arithmetic, TS numeric slot access maps non-Numbers to NaN (`machine/ts/machine/cpu/value_slots.ts:128-130`), select can emit no result (`cpu.ts:4286-4318`), and a requested missing result becomes Nil (`:3421-3439`). These owner reads explain the particular observed program cases; no broad arbitrary-input proof is asserted.

### Actual ordinary stdout, debug selection and endpoint

`docs/book1/bios-string.md:947-956` and `docs/book1/facts/bios-string-format-example.md:34-43` each contain exactly the same eight output lines, byte-for-byte, as `/tmp/bmsx-format-ordinary-final.log:13-20`. Actual argument separators are tabs, while the quoted result contains visible backslash escapes:

```text
Format fields	HP 7/10	+00042	0x00002a
Format stars	[    1.25]	[go   ]
Format integers	/0	4294967295
Format numbers	1.25/1.3e+01/100.	+INF/nan	1e+06
Format text	"A\t\""	2	0	0
Format argument paths	0	1
Format incomplete	false	string.format incomplete format specifier.
Format unsupported	false	string.format unsupported format specifier '%p'.
```

The current companion command at `docs/programming/getting-started.md:441-446` explicitly includes `--debug`; the refreshed final ordinary log `:2` records this command, `:3-4` records the exact cartridge/BIOS `.debug.rom` paths, and `:5` records `debug=true`. This resolves the earlier implicit selection ambiguity without changing the eight output lines or source/artifact hashes. The fact sheet's command is updated consistently at `docs/book1/facts/bios-string-format-example.md:31-32`. The npm script supplies the debug BIOS (`package.json:44`).

Endpoint wording now states zero-based presentation offset 4, not an elapsed-frame/time/cycle guarantee. The exact owner boundary is `scripts/bootrom/platforms/input_timeline.ts:68-95` (largest entry frame 4 yields completionFrame 5), `:127-143` (origin is first cartridge-active presentation; cartridgeFrame is presentedIndex - origin + 1), and `:155-157` (completion). Therefore completion corresponds to presented-index offset 4, the fifth presentation relative to that origin. The final log `:8,21` records arming and completion. This fixture has no event or capture request; description alone does not establish a screenshot claim. No broader timeline audit was undertaken.

### Build/result boundary and frozen identities

`/tmp/bmsx-format-cart-final-build.log:8-9` identifies `bios_format_manual`, debug -O3; `:11,25` records system/cart lint; `:17-18,24-29` records compilation/publication/export; `:30` names artifact ID `0b695c2184d8761e2a70e006b0c6ced96cb10ca2473e5d683ffddc48bf5c39d9`.

The current build owner really captures/prepares system and cart together, builds or selects the system and uses its actual imports for the cart (`scripts/rompacker/build.ts:23-79`), rather than relying on a manual BIOS prerequisite. Cart compilation includes the lint phases (`scripts/rompacker/compile.ts:36-40,138-165`); semantic compile diagnostics are gathered and rejected by the compiler (`toolchain/ts/lua/compiler.ts:6181-6185`). This supports the bounded lint/semantic checking claim, not runtime/performance certification.

The test boundary is also honest: `scripts/bootrom/platforms/hostrunner/test_runner.ts:16-33` loads source/media and uses O3 with an OffscreenMachine; `ide/testing/run.ts:38-45` builds a test cart and creates a target from its derived bytes; `toolchain/ts/rompack/test_cartridge.ts:156-182,199-217` adds suite/dependencies and changes the entry for a unit suite. This is not byte-identical ordinary playback.

All six hashes recorded at `docs/book1/facts/bios-string-format-example.md:6-11` match the actual current bytes:

| File | SHA-256 |
| --- | --- |
| `carts/bios_format_manual/results.lua` | `ab32c6d93fd8c58f6845ab8c70d41abe072a3c2a9eb86071e18b6b7075ec62ae` |
| `carts/bios_format_manual/cart.lua` | `166d4775667d8e618e5f5679bfcbeb2efcb19df1e570fb7e7efe23f0d9d2176c` |
| `tests/carts/bios_format_manual/bios_format_manual_assert.lua` | `c30bb8fe93b83a2c65c3e4daaef19e6506a0ad01af08cb43be087073cb0b82ec` |
| `tests/carts/bios_format_manual/format_char_assert.lua` | `3b7570487239d79a06c8d03fedc34ec77e95744e7efe32dc7480484c81684bdd` |
| `dist/bios_format_manual.debug.rom` | `c1f449e1c9f6eea7468ab7eef342a64e7dfcd6ab3239e849f447359c4b2cba3c` |
| `dist/system/bmsx-bios.debug.rom` | `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664` |

I also checked both ROMs in `.bmsx/builds/artifacts/0b695c2184d8761e2a70e006b0c6ced96cb10ca2473e5d683ffddc48bf5c39d9/` against their `artifact.json` output digests and the exported dist bytes; all match. Artifact ID is not confused with a ROM's digest.

Reviewed final log SHA-256 values:

- `/tmp/bmsx-format-cart-final-build.log`: `fd7ae62611bd88db227f6d6fbc188535f24a49da77cce57486b3476b3c8ecdfe`
- `/tmp/bmsx-format-cart-final-test.log`: `addea4e6dc461c3416ae696a4c3db0f506389ebb9e3ec0af4c277628e088f8ef`
- `/tmp/bmsx-format-char-final-test.log`: `bea2902ce1a7c1d895bee3ce645287d02ef2e0b87c6ec8d78ba9a414ca9783d5`
- `/tmp/bmsx-format-ordinary-final.log`: `a5ff48474c8d9885fac83a9b8a94f6ab26d04544c14dacb86e88ff49a0caf744`

`git diff --check` passed at the end of this review. The worktree also contains concurrent/out-of-scope changes; this agent did not attribute those to this finite program slice.

### Explicit limits

No remaining failure was found within the exact reviewed program/source-literal/result/log/hash contract after the assembly, debug-selection and endpoint wording clarifications. No claim is made about native end-to-end playback, all inputs, all compilation paths/optimization levels, universal common Table length, arbitrary resource limits, a physical CPU/throughput budget, the existing seven CPU questions, or BZ01 closure. The README, companion and example fact sheet retain those limits. No runtime/compiler/BIOS repair or new encoding/helper abstraction is needed or proposed by this bounded review.

---

## Earlier base-operation evidence

The following source/artifact review is retained at its earlier bounded scope;
it is not an approval of the later formatting extension or a current hash.

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
