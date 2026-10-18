# BIOS OS public-reader checkpoint

## Scope and exact public snapshot

Role: experienced developer new to BMSX, reading the public reference without implementation knowledge. This checkpoint audits the usable reference only. The known absence of the forthcoming complete ordinary program and its getting-started route is explicitly outside this checkpoint.

Read `docs/book1/bios-os.md` and `docs/programming/getting-started.md`; followed only the relevant canonical public CPU, SYSTEM, Math, String, Base, coroutines and BLua sections. Memory was consulted only through public heading/keyword locators. No architecture document, implementation owner, facts/review packet, cartridge, test, other `/tmp` packet, foreign PDF or prior agent context was opened.

**Entry publichash:** `1865e40ad89978275b9c42d1b51c710893540d73aaaea6963d53009ce019ba59`.
This is SHA-256 of the newline-terminated output of this exact command, in this order:

```sh
sha256sum docs/book1/bios-os.md docs/programming/getting-started.md
```

**Full consulted-public-set manifest hash:** `56d042a7a63e200aa3a0688ae687b87207cb478401be63672c7353df3da0492f`.
This is SHA-256 of the `sha256sum` manifest below in its printed order, including paths and newlines:

```text
00828fc12b74146b2f0688f4b5432bb31edbbcec8c4e68f90c881d9f0bbd851f  docs/book1/bios-os.md
392adb82eb675562da3cb8e368a4e25d887736dddf3f9b119fd36c9c398548a7  docs/programming/getting-started.md
c2646d2476bdedd217d97a9d4432e4077e5b45cd528374ea378f8e5aca996327  docs/book1/system.md
3b83050c8a28398079f8ffa6fc5d3439a6e8ded2cf1cd96aed6af1540b9c16e3  docs/book1/cpu.md
28089324f05ad3661ea7f8b29200392a0ec0657e13fcc968c7c3ba094b7a1230  docs/book1/memory.md
55f4f3d4b16b7af1278f76d6c216e3744ec94af97cdca90bcdecb7231982e890  docs/book1/bios-math.md
a7b97cbab88db05e0e2a65a871beec4872b705292e298262bf5947b8e7ea01b5  docs/book1/bios-string.md
fca0baa2977922446b551df44a02d2161e390e8a1e399bb249b98c55cb741505  docs/book1/bios-base.md
7becc9752745fa69d9c31aeda2811f3954029f609b349f2822cbb283fccc4a2c  docs/book1/coroutines.md
e4cc1350a40b7a4d5c491efd84cb4bf6c64702f37557ad91b45d1b0ab3b65d69  docs/book1/blua-programs.md
```

## Result

**The finite reference is usable. No blocking reference defect found.** I can select all four functions, use the civil conversion and formatting rules, and predict their ordinary ordered behavior without opening the implementation. Two nonblocking public-contract clarifications remain below.

### Function choice and clock distinction

- `os.clock()` supplies fractional seconds from its own whole-millisecond sample. It is not CPU-exclusive accounting time, and it wraps with the 32-bit millisecond word.
- `os.time()`/`os.time(nil)` supplies its own sampled whole-second quotient, not a nonwrapping seconds clock. `os.time(table)` instead computes a civil timestamp and normalizes that exact Table; it does not set the clock.
- `os.date` selects either a fresh nine-field Table or textual formatting. Its omitted/nil timestamp independently samples the word.
- `os.difftime(t2, t1)` checks whole-valued arguments and subtracts in that order; it is neither a clock read nor wrapping elapsed-time arithmetic.

The introductory distinction, individual function sections and SYSTEM timing chapter agree. I would not infer an RTC, current real date, timezone, UTC/local conversion, or cartridge-entry-zero origin from timestamp 0, `!`, `%z`, `%Z` or `isdst`. SYSTEM explicitly supplies the alternative existing wrapping elapsed-millisecond library contract, including its less-than-one-period limit.

### Fields, normalization, identity and errors

The required `year`, `month`, `day`, optional noon `hour`, and zero `min`/`sec` defaults are explicit. Nil alone means absent; false does not request a default. Exact accepted field bounds and their non-calendar nature are given. Six fields are read/validated sequentially, ignoring input `wday`, `yday`, `isdst`. Month carry and arithmetic day/time normalization are reconstructible from the documentary formulas.

For the printed 1970-01-01 midnight example I expect timestamp 0; omitting `hour` instead gives 43200. The 25-hour example gives 90000 and next-day 01:00:00. A negative timestamp of -1 decomposes to 1969-12-31 23:59:59, not day 0 with negative seconds.

I can distinguish integer equality checks, per-field bounds, and the later computed timestamp bounds. Normal input validation and decomposition complete before the first write. Success writes the nine named fields in a specified order into the same input Table, preserving unrelated fields; it does not replace it. Ordinary Table-valued inherited reads and direct writes are clear from both OS and CPU. The public reference does not suggest rollback after an ordinary write fault.

The missing-field, integer, bounds and indexing messages and precedence are sufficient to construct protected probes. In particular, an earlier bad/missing year prevents a later month lookup. `os.difftime` performs both integer-part computations before testing `t2`, then `t1`; infinities are admitted there but fail civil timestamp bounds. The retained `modf` versus late-bound public `error` distinction is explicit.

### Result selection and formatting

I can predict that `*t` and `!*t` return fresh Tables while `!!*t` returns literal `!*t` for a valid timestamp. Only one `!` is removed; it is not a timezone mode. Empty formats still select/check timestamps. Invalid format conversions are reached only after timestamp validation and decomposition.

The conversion tables define every accepted code, literal separators, fixed English names, and zero-padded `%c` day. The permitted E/O code sets are complete and modifier validation occurs before dispatch. Widths, flags, precision and repeated modifiers are not accepted. For example, `%04Y` first reaches the unsupported code `0`, whereas `%EO` consumes `O` as the code after `E` and reports the specified `%EO` message. Literal zero codepoints continue scanning; a zero conversion code is an error containing that zero.

The week formulas supply enough information to distinguish Sunday/Monday week 0 from ISO week/year boundaries. From the public formulas alone, timestamp 0 formatted as `%F %T %a %j %w %u %U %W %G-%V` gives:

```text
1970-01-01 00:00:00 Thu 001 4 4 00 00 1970-01
```

This is a paper derivation, not an observed run. The ISO candidate and 52/53-week rule also explain why 2016-01-01 uses ISO year 2015 and week 53.

Padding is minimum total text length on the current `tostring` output, not signed integer formatting or fixed width. I would expect the documented `00-1`, not `-001`. The numeric-text shortcut limit, six-significant-digit rounding, scientific notation and large-year caveats are explicit; the CPU and Base chapters provide the detailed shared conversion. Timestamp acceptance is not advertised as exact unlimited-precision calendar arithmetic.

`D`, `C`, `Z` and `S`, conditional formula expressions, and tuple assignment in the formula blocks are explicitly documentary notation, not library helpers or copyable BLua. The CPU and Math references define the Number `//` and `%` operations and distinguish them from word operations. Nothing in these formulas asks a cart author to implement a private encoding layer.

### Work and navigation

The chapter distinguishes sampled calls, fixed arithmetic normalization, in-place versus fresh Table results, growing String concatenation, repeated ISO calculations, padding loops and nonconstant-time codepoint slicing. It does not make a fixed-cycle, allocation-free or linear-time guarantee.

Every Markdown target and anchor originating in `bios-os.md` resolves within the allowed canonical public chapters; the CPU anchor and shared-civil-day anchor exist. This is not an audit of every link in all consulted chapters. Getting-started prerequisites explain the supplied-checkout workflow and BIOS preparation; the OS-specific ordinary program/build route is intentionally not judged yet.

## Nonblocking clarifications

1. **False timestamp diagnostic is simultaneously derivable and expressly withheld.** `bios-os.md:281` says no particular comparison/arithmetic diagnostic is specified for a false timestamp. However, the explicit timestamp algorithm at 285–299, linked `bios-math.md:94–106` (non-Number `modf` gives numeric NaNs), and CPU kind-sensitive equality at 725 imply that, with installed dependencies, `os.date('*t', false)` reaches the authored `time is not an integer` error. As a new reader I can derive a result but cannot tell whether the nearby disclaimer intentionally overrides that derivation. State the installed-dependency outcome or identify what part of the dependency/representation contract is intentionally excluded. This is a documentation ambiguity, not a claim about observed runtime behavior.

2. **Reached-call arity is not explicitly separated from source acceptance.** `bios-os.md:188` states missing fixed parameters are nil and no separate automatic argument-count error exists. The linked public call model is not linked here, and `blua-programs.md:309–311` separately warns that the source compiler can reject too few written arguments. The Math chapter makes that distinction concrete at 13–15. A new author reading only the OS call signatures cannot establish whether all shortened spellings, especially `os.date()`, are source-accepted or merely have defined reached-call behavior. Link the canonical known-call minimum explanation and make any intended optional source forms explicit. Passing explicit nils avoids relying on omitted source arguments; no rejection was executed or demonstrated by this audit.

## Evidence limits

This report is a public-reading and paper-derivation checkpoint only. No builds, lint/type checking, tests, cartridges, emulator/player execution or runtime observations were performed. Only public document viewing/searching and checksumming commands ran. No source-facing failure, diagnostic payload, mutation behavior, native parity, performance claim or whole-input-domain claim has been independently validated. Only this report file was written; public docs were not rewritten.

---

## Final public-only reread: complete program and build route

This second checkpoint retains the same source-blind reader context. I reread the completed public chapter and its new getting-started section, and additionally read only the explicitly permitted `carts/bios_os_manual/README.md`. I did not open the cartridge's actual source, any test or timeline file, implementation owners, architecture/facts/reviews, or another agent's packet.

### Final snapshot

```text
4e9c6dd7cc158116a42019d2b62f87844d22a54d399ae2e87147f08ff91dab14  docs/book1/bios-os.md
264885d9d0cdb41671bcfd7d24b80dc3c26e65971d3b21ce9166e231a9b8120f  docs/programming/getting-started.md
f571615fcd3dbbda6dbac32151ed5e4edddc7f98af47e83153b745fc8f362fd1  carts/bios_os_manual/README.md
```

- Final entry **publichash**: `950657d9d369bf6bd919cb3f9f36c08645b1811838babda782567e87a9aaea65`, using the same two-path SHA-256 manifest recipe as the first checkpoint.
- Three-public-file manifest hash: `b45385d65add6989f0de1a4c630d1e544d9396f799b85ac13b18423d05e53a3f`, hashing the above three-line manifest in order.
- Full consulted-public-set manifest hash: `b56ff0961d20e9dd81522c77e39bbdc4237151cc9066957b8c677ca66f826547`, using the first checkpoint's ten-file order with these updated first two files and the allowed README appended. The other eight canonical chapter hashes are unchanged.

### Acceptance and closed findings

**Accepted as a complete, reconstructible public example and supplied-checkout route. No remaining blocking or nonblocking public-reader finding.**

Both first-checkpoint clarification requests are closed in the public text:

1. `bios-os.md:281` now states the installed-dependency false-timestamp result, `time is not an integer`, before the bounds check.
2. `bios-os.md:188` now explicitly distinguishes reached-call rules from cartridge-source known-call argument diagnostics and links the canonical section. The literal complete entry also supplies concrete ordinary no-argument `os.time()` and `os.date()` usage rather than asking the reader to infer those source forms from missing-slot behavior alone.

### Literal reconstruction

The first listing is a complete ordinary `results.lua` body, with no hidden initializer or omitted helper. It declares the numeric BSS layout and returns its linked result address together with an ordinary mutable observations Table. Dynamic Strings, returned date Tables and protected-call results remain guest language values. The entry imports that module, uses its typed result pointer, and mutates the exported observations Table. I would not add `module<const>`; the companion and README expressly prohibit that incorrect reconstruction.

The five printed entry bodies concatenate in their printed order without rewriting. They contain one `module<entry>`, the storage import and bindings, all four OS functions, all diagnostic calls, the completed store and the final park loop. No previous example, guessed RAM address, local calendar encoder, BIOS replacement, external asset, extra module declaration or missing source fragment is needed. The shared calendar/padding formulas remain documentary text and are not additional files to transcribe.

Text-only extraction from the public chapter produced:

| Reconstructed public body | Lines | SHA-256 |
| --- | ---: | --- |
| Results listing, lines 513–530 | 18 | `bf6aff8d4c7b73723b8ee6ac1256bf549e702d23c75fb7f7cf60bb524d2a32bb` |
| Entry parts joined, lines 536–550, 556–575, 581–610, 616–641, 647–665 | 110 | `3da3013b728df086dfe5209527c8cb61e53b2ef8a858f8c5db10bf4a55d55aa2` |

These hashes are of the printed body bytes with their line endings; they are not comparisons against the actual cartridge source. The joined entry contains exactly one entry declaration and 26 `print('OS ...')` calls. This reconstruction was performed as document text extraction/counting only, not by creating or compiling a cartridge.

### Build and inspection route

The chapter's development-companion link reaches the new `Build and inspect time and calendar operations` heading. Its return link reaches the chapter's complete-program heading. The allowed README also links to the correct chapter and companion paths. No new broken crossreference was found.

The companion provides the separate `bios_os_manual` project identity, both source filenames, manifest path and complete manifest. It points back to the shared repository-root POSIX/Node/npm/canvas prerequisites. It states the normal module roles, supplies the tooling build, validated cartridge build and named retained-suite command, identifies the expected case line, and says that the builder selects the matching BIOS.

The retained suite is described as supplied checkout material, not another ordinary program source fragment. Its named path, completion condition, 74 checks, fresh derived TS target and potentially different linked addresses are explicit. The ordinary route is separate: a complete supplied timeline transcription and `headless:tooling` command identify exactly what to run and compare. Timeline offset 4 is described as an observation endpoint rather than an output assertion or startup/cycle guarantee.

I can therefore recreate the ordinary project from the public listings and manifest, and identify the supplied validation/ordinary paths without reading their private implementation. This is not a claim that a newly empty checkout could recreate the unprinted retained suite from this chapter alone; the companion explicitly scopes itself to the supplied checkout.

### Diagnostics and whitespace

I matched each of the 26 printed `OS ...` diagnostics against the program on paper. The first two are clearly labelled captured independent samples rather than exact replay values; there are five separate default clock/date reads in the entry, not one shared snapshot. The other 24 diagnostics use explicit inputs. I do not require another run to reproduce `1.036`, `1`, or either sampled date String.

The fixed diagnostics follow the reference's noon default, in-place leap-day carry, negative floor-day decomposition, English names, clock/composite fields, both ISO-year crossover directions, Sunday/Monday week zero, literal zone text, accepted E/O sets, protected messages and difftime's lack of finite/safe-range bounds. Exact `1709168523` retained in f64 is correctly distinguished from displayed `1.70917e+09`; the large difference's displayed `9.0072e+15` is likewise not presented as its complete decimal expansion.

The chapter explicitly transcribes every tab as one space, including the tab inside `A%tB`, while preserving other spaces. This makes the two spaces before the space-padded day in `OS calendar` and `OS O modifiers` meaningful. `%n` preserves `C` as a distinct continuation line, not a twenty-seventh `OS` diagnostic.

A read-only textual comparison of the README observation block after replacing each tab by one space against the chapter's two observation blocks had no differences (`diff` exit 0). The comparison included all 26 `OS` rows and the separate `C` line. It did not run the program or assert observed runtime output.

### Final limits

This acceptance is exclusively about public-reference usability, literal reconstruction and the documented supplied-checkout workflow. I ran no build, typecheck/lint, test, player, emulator, guest program or native executable. Shell tools only viewed, searched, counted, hashed and compared the permitted public text. Only this report was appended.

The public documents' statements about successful retained and ordinary executions remain reported evidence, not independently rerun evidence from this reader. No claim is made about actual compilation acceptance, all-input accuracy, exact huge-range calendar arithmetic, native parity, source/runtime-parser parity, performance, reset/persistence, unresolved Table-length/compiler issues, whole-SDK or whole-console acceptance. The leading-`!` and Table-valued format-argument paths are explicitly outside this ordinary program's finite coverage.
