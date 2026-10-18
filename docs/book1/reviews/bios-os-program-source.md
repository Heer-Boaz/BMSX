# Independent BIOS OS complete-program/source review

Date: 2026-10-18. Checkout: `/home/boaz/BMSX`, HEAD `b23de821f2d531ea16e909951f281dae53ee67de`.

## Verdict: bounded PASS

No mismatched quoted sentence, listing, manifest, timeline, asserted result, or ordinary-output transcription was found in the assigned surface:

- `docs/book1/bios-os.md:492-725` only, beginning at **Complete program: time and calendar operations**;
- `docs/programming/getting-started.md:853-923` only, the final **Build and inspect time and calendar operations** route;
- `carts/bios_os_manual/README.md:1-123`.

The six actual cart/test files, directly necessary BIOS and paired owners, and the supplied captured-run index/logs were inspected. No architecture document or foreign PDF was opened. No repository edit, build, guest execution, test rerun, runtime fix, commit, or push was performed by this reviewer. The only written artifact is this report. Execution evidence below is explicitly the supplied captured evidence, not an independently repeated run.

## Frozen identities checked

Live SHA-256 values match the final-source identities in `/tmp/bmsx-bios-os-example-evidence.md` where that index lists them:

| File | SHA-256 |
| --- | --- |
| `docs/book1/bios-os.md` | `4e9c6dd7cc158116a42019d2b62f87844d22a54d399ae2e87147f08ff91dab14` |
| `docs/programming/getting-started.md` | `264885d9d0cdb41671bcfd7d24b80dc3c26e65971d3b21ce9166e231a9b8120f` |
| `carts/bios_os_manual/README.md` | `f571615fcd3dbbda6dbac32151ed5e4edddc7f98af47e83153b745fc8f362fd1` |
| `carts/bios_os_manual/results.lua` | `bf6aff8d4c7b73723b8ee6ac1256bf549e702d23c75fb7f7cf60bb524d2a32bb` |
| `carts/bios_os_manual/entry.lua` | `3da3013b728df086dfe5209527c8cb61e53b2ef8a858f8c5db10bf4a55d55aa2` |
| `carts/bios_os_manual/res/manifest/manifest.rommanifest` | `e60eb957e9c9ff1356a800b057537da2652e68a4021d36d32423ac61ba0f7d83` |
| `tests/carts/bios_os_manual/bios_os_manual_assert.lua` | `8b27f91e7f94b726c1c3702a08d38f6ee0e1bfedeb11234900e0d61a4814c4ce` |
| `tests/carts/bios_os_manual/ordinary_timeline.json` | `49cebe082095c99bc2a9a17e97044a2007e07414b1c90b9b4be408b80d8f4e5a` |
| `dist/bios_os_manual.debug.rom` | `53583493f125f8fc1db0ba02badc306c2c8092203f9da846f8692cf02bd35246` |

The current build log publishes artifact `241d79997e6a5c300035e81636cd50bb6d0c8fbaee418c7b3a24fec6efbe9207`. Historical `-before-print-reflow` evidence was not used as proof of the current bytes.

## Literal-fence comparisons: PASS

A read-only byte comparison extracted fenced content, retained each content newline, and concatenated entry parts directly with no inserted separator or whitespace normalization:

| Documentation content | Actual owner | Exact comparison |
| --- | --- | --- |
| Chapter results fence, lines 513-530 | `results.lua:1-18` | 434 bytes, identical |
| Chapter entry parts 1-5, lines 536-550, 556-575, 581-610, 616-641, 647-665 | `entry.lua:1-110` | 5,396 bytes joined, identical |
| Companion YAML, lines 869-871 | Actual manifest | 48 bytes, identical |
| README YAML, lines 20-22 | Actual manifest | 48 bytes, identical |
| Companion JSON, lines 897-902 | Actual ordinary timeline | 94 bytes, identical |

There are six Lua fences in the assigned chapter section: one complete 18-line results file and five parts of the complete 110-line entry. The joined entry contains exactly one `module<entry>` declaration. Its `require('results')`, typed numeric BSS, mutable observations Table, all four installed OS calls, print sequence, `completed = 1`, and final halt loop are present in the actual files, not omitted placeholders. The printed project trees name the real files. The shell commands match the supplied captured invocations and existing package scripts (`package.json:44-45,87`); no alternate implementation route is silently substituted.

## Ordinary output: PASS, separate from assertions

The raw ordinary-run span from `OS samples` through the final `OS fractional t1` is 1,301 bytes. It contains exactly **26 OS-prefixed diagnostics and one separate `C` continuation line**, in the printed order.

- README lines 72-98 match that span byte-for-byte, including all literal tab characters, the tab between `A` and `B`, unchanged doubled padding spaces, and the newline before `C`. Raw span SHA-256: `2137cef5e8d0341523e42c3350b40a258f1999e2c8009bacfba6a5063cf3663d`.
- Concatenating the chapter's two ordinary-observation text fences (lines 678-679 and 683-707) matches exactly the same captured span with **every tab replaced by one ASCII space and no other change**. This includes `A<TAB>B` becoming `A B`; `%e` padding's doubled spaces and `C`'s own line remain intact. Transcribed span SHA-256: `113330101fe57396309ed5eaffd4eb405feba2648c929c4d4c7e1a85c83d8fed`.
- Chapter lines 670-675 explicitly describe that tab transcription and correctly divide the output into the first two sampled diagnostics and the remaining 24 explicit-input diagnostics. Companion lines 911-916 and README lines 65-69 correctly decline fixed-replay claims for the samples.
- The numeric log text `1.70917e+09` is not substituted for the exact retained `1709168523`. Likewise `9.0072e+15` is rounded text for the demonstrated `9007199254740992` result. The sample `1.036 / 1 / 1` and sampled date strings are observations of the captured ordinary run only.

The timeline itself asserts no output. It contains a frame-4 description-only entry, no expected string, test predicate, input event, or screenshot request. `scripts/bootrom/platforms/input_timeline.ts:68-96,124-158` derives completion from presentation frame progression after cartridge execution becomes active; `node_tooling_entry.ts:427-441` reports completion afterward. Thus the endpoint wording in companion lines 918-923 and README lines 56-61 is appropriately bounded, not a cycle/startup guarantee or proof supplied by the timeline that the strings were correct.

## Exactly 74 assertions: PASS, separate retained execution

`tests/carts/bios_os_manual/bios_os_manual_assert.lua` has exactly 74 explicit `assert(...)` calls and one named integration case, `time_and_calendar_observations` (lines 6-8). The preceding `wait_until` checks `completed == 1` with an 8-tick bound (lines 9-11); it is not counted as another explicit assertion.

| Assertion group | Count | Actual suite lines |
| --- | ---: | --- |
| Unpinned sample properties: two integer equalities and the clock's nonnegative unsigned-word seconds range | 3 | 13-15 |
| Noon timestamp, nine normalized fields, retained extra `note` | 11 | 16-26 |
| Carried timestamp plus nine normalized fields | 10 | 27-36 |
| Epoch's nine fields | 9 | 37-45 |
| Before-epoch's nine fields | 9 | 46-54 |
| Exact fixed formatting strings, including tab/newline and E/O outputs | 11 | 55-69 |
| Six protected error statuses and exact messages | 12 | 70-81 |
| Five exact/numeric difference checks, including infinity and NaN self-inequality | 5 | 82-86 |
| Two fractional-argument statuses and exact messages | 4 | 87-90 |
| **Total** | **74** | |

The suite deliberately does not pin the three live samples to constants, compare their sampled instants with each other, or assert the sampled date strings. Its passed result is distinct from ordinary playback: `scripts/bootrom/platforms/hostrunner/test_runner.ts` uses the isolated `TestRun` route; `ide/testing/run.ts:31-45` builds a derived test cartridge and creates a fresh target. `toolchain/ts/rompack/test_cartridge.ts:127-175,199-217` retains the program modules and adds the test/dependencies before linking. The fixture is integration, not unit, so the unit-only entry replacement at lines 176-183 does not apply. This substantiates the fresh-derived-image/address caveats in the companion and README; it is not evidence of byte-identical replay of the ordinary ROM.

## Source semantics used by this particular program: PASS

The explanatory sentences in the assigned surface agree with the directly relevant actual owners:

- Installed binding: `machine/bios/main.lua:4-12` installs `os = require('os')`. Neither program module rebinds BIOS fields or adds a local calendar/time encoder.
- Sampling: `machine/bios/os.lua:8,289-305,308-318` independently reads the time word for each sampled call; omitted/nil `os.time` is distinct from a supplied civil Table. The paired time-word owners are `machine/ts/machine/devices/system/controller.ts:119-129` and `machine/cpp/machine/devices/system/controller.cpp:77-81`, both returning a uint32 millisecond reading from scheduler cycles. No native execution was inferred from inspecting the C++ owner.
- Civil conversion and mutation: `os.lua:44-61,91-122,293-303` supplies noon/zero defaults, calculates and decomposes timestamps, writes the same caller Table's computed fields, and leaves unrelated keys untouched. The program's fixed leap-day, noon, and negative-epoch cases are independently covered by the exact retained assertions and ordinary diagnostics.
- Formatting: `os.lua:15-22,124-175,178-287,308-318` supplies English names, padding, fixed zone literals, `%n`/`%t`, week/ISO-year formats, and accepted modifier sets. The concrete expected strings agree with suite lines 55-69 and the captured ordinary span. This is no claim about locale/host-zone services or every civil input.
- Protected errors: `os.lua:24-61,167-175,193-199,280-281,321-330` owns the displayed errors and their relevant ordering. Calling `difftime(1.5,0.5)` rejects `t2` first; `difftime(1,0.5)` reaches the `t1` error. No binding replacement is involved.
- Large/infinite differences: `os.lua:321-330` does integer-equality checks then subtraction, without `date`'s separate safe-range test. `machine/bios/math.lua:27-32,59-62` supplies the used `modf`; the shown integral large input, infinity, NaN result, and exact errors agree with the separate retained assertions. The text does not promise a finite-only API or wrap repair.
- Print representation: `machine/bios/base.lua:235-237,265-275` emits tabs between arguments and a final newline. `machine/ts/machine/cpu/value.ts:182-195` and `machine/cpp/machine/cpu/value.cpp:24-29` handle non-finite spellings; the paired number formatter is rooted in `machine/ts/common/number_format.ts` / `machine/cpp/common/number_format.h`. The rounded text is an output representation, not a changed retained Number.

The BIOS OS owner read for this review has SHA-256 `5cc3684c42a3ace630c57f122ed6b2caa019f8e44270f29336769e0212374bca`.

## Captured execution evidence and limits

The supplied index reports exit 0 for the tooling build, final cart build, retained suite, and separate ordinary timeline run. The logs corroborate the actual commands and expected bounded results:

| Captured log | SHA-256 | Observed evidence |
| --- | --- | --- |
| `/tmp/bmsx-bios-os-example-tooling-build.log` | `966d836aa54ab924852ba8c2bb8c03afce99f86351a5cd6a3d9aacc3cb179955` | Node headless tooling product build complete |
| `/tmp/bmsx-bios-os-example-build.log` | `a488f8c955f1ca09999eff59858320233ac2333c131c593f06f3ca09145174e2` | System/cart compile and lint stages, ordinary artifact publication and export |
| `/tmp/bmsx-bios-os-example-retained.log` | `58c333117742a87da0f77c6f2982c500ea173e543dcdd451306a052a3569a38a` | `[test] time_and_calendar_observations: passed` |
| `/tmp/bmsx-bios-os-example-ordinary.log` | `1b7e1e3942b16e5264cc09cb663f40e39b09e5b8c2673705ed531cde627fd73f` | All 26 OS diagnostics, separate C continuation, timeline completed |

The PASS is confined to source/listing fidelity, the concrete retained suite, the supplied ordinary execution transcript, and their directly relevant source explanations. It does not accept native parity, every calendar input, exact large-range arithmetic, optimizer/runtime-parser coverage, throughput/call duration, reset/persistence/origin, leading-`!` or Table-valued formats, general Table-length/string-slicing publication, SDK completeness, or whole-console behavior. CPU7, BZ01, LS01 and the stated Table boundary remain unresolved by this example. No source correction is requested within the audited surface.
