# Public-only BLua extension newcomer review

## Scope and evidence boundary

Reviewed the NEW extension-first portion of `docs/book1/blua-programs.md`, before `## Existing source forms and linked programs` (boundary at line 876 in the inspected revision), its own complete static-record example, and the public companion setup/storage-result route plus its new trace-selection section. Consulted only relevant public CPU closure/CP0/HALT text, Memory typed-storage/function-address/worked-storage text, and a limited keyword search in the linked BIOS base chapter. No implementation owners, facts/reviews, private carts, assertion fixtures, architecture documents or PDFs were inspected. No repository file was edited, and no install, build, test or playback was run.

Some existing-reference text below the boundary was incidentally displayed while following module/BIOS links; it is not being accepted or reviewed here. This is not a whole-Lua, whole-manual, whole-SDK, implementation-correctness or runtime acceptance result. No external production-reference study was required or performed: no implementation was attempted.

Inspected public-file SHA-256 values:

- `docs/book1/blua-programs.md`: `2cdd6f1525203fb8de28456fff3a8331a1f8f7ae1ca66cd7a5222c527ff5ae88`
- `docs/book1/cpu.md`: `3b83050c8a28398079f8ffa6fc5d3439a6e8ded2cf1cd96aed6af1540b9c16e3`
- `docs/book1/memory.md`: `28089324f05ad3661ea7f8b29200392a0ec0657e13fcc968c7c3ba094b7a1230`
- `docs/book1/bios-base.md`: `fca0baa2977922446b551df44a02d2161e390e8a1e399bb249b98c55cb741505`
- `docs/programming/getting-started.md`: `cc111336f2132088b8dd311dbdc5e70544f6e6aca1f5ab62d0342ca2837c8f00`

The source chapter was being edited concurrently; the listed hash is the revision re-read for the String-table correction, layout keep-groups and direct trace-selection link, not the earlier first-read snapshot.

## Finite result

The extension route is identifiable and materially broader than hardware programming. A reader can find the source spellings and the principal limits for static linkage, storage/layouts, typed addressing, raw maps, CP0, all three intrinsics, waiting, all six augmented assignments, String/address unary `&`, and `->`. It does not need another general Lua tutorial.

The supplied storage program is reconstructible as 32 + 30 source lines, with no invented helper, numeric RAM placement or missing program module. Its layout/count/address calculations are internally consistent as documentation. This is reconstruction and reader arithmetic, not compilation or observed execution.

Two actionable public-route gaps remain for the distinctive use of advanced forms, plus one explicitly disclosed tool limitation:

1. **`blua32.closure` has no source-level address acquisition example in the inspected route.** At source lines 650–664 it accepts `function_record_address`, delegates acquisition/capture context to CPU, and correctly warns against arbitrary integers. The consulted CPU closure section explains function records, descriptors and parent captures at the VM boundary; it does not provide a newcomer source expression that obtains a valid record address. A reader can learn the intrinsic's syntax, result and failure constraints, but cannot construct a usable complete call from this route alone. Add a direct link to an actual public address producer/use case, or explicitly identify it as a low-level form requiring an externally supplied valid function-record address and document the supported capture-context case. Do not substitute a guessed numeric address or pretend a static call target is an ordinary function value.

2. **`<init>` explains non-invocation at startup but leaves invocation of its separate participant sequence unlocated.** The ordinary explicit `prepare()` example is usable, and the separation from static function targets is clear. The attribute's distinctive registration use, however, depends on a separate sequence with no public caller, trigger or invocation route identified in the inspected extension/companion material. Name/link the supported trigger if one exists, or state that registration has no ordinary cartridge-facing invocation route. This is a documentation navigation/contract gap, not a claim that startup should invoke participants, and not a request to invent an invocation API.

3. **Selected tracing cannot currently be reproduced in an ordinary ROM through the documented builder CLI.** The new direct link after the default-erasure paragraph and companion lines 926–947 now make this explicit: ordinary builds erase, `--debug` does not enable selection, and there is no advertised trace-selection switch. The compilation interface supports `traceStatements = 'erase'`, `'emit'`, or exact channel-name arrays; the derived integration-image route selects `'emit'`. This is an honestly documented outstanding tool-interface limitation, not a missing flag to guess, and not evidence that a derived integration trace proves ordinary-ROM tracing. The inspected material contains no standalone newcomer selected-trace run to reproduce. No follow-up/private evidence was inspected.

The first two gaps do not block reproducing the static-record program. The third no longer misleads the reader about default/debug tracing, but it still prevents a fully runnable ordinary-ROM example covering selected trace/trace_sink.

## Coverage/constraint checks from the public text

- **Storage and layout:** `struct`, `bss`, `data`, `rodata`, explicit/inferred outer array dimensions and typed local views have concrete spellings. Scalar name-versus-address distinction, zero BSS, DATA copy, four-byte section padding, field alignment, no aggregate scalar copy, unsigned `i` loads, unsupported static float initializers, String constant references and rodata alias caveats are stated.
- **Units:** size/alignment/field offset/address arithmetic are bytes; typed indices are zero-based and element-scaled; numeric `+ 1` is one byte; `#` is an outer static-array count, not bytes or pointer capacity; device word-count units are separate.
- **Module/static/ordinary distinctions:** one entry, literal paths, eager ordinary dependency initialization and retained exports are distinguished from compile-time namespaces/static targets and immutable local bindings. Static target calls/aliases and rejection as runtime callbacks/values are stated. The separate `<init>` semantics are clear apart from the missing trigger route noted above.
- **All six raw maps:** `mem`, `mem8`, `mem16le`, `mem32le`, `memf32le`, `memf64le` have read/write shapes, byte-address units, sizes/alignment, integer-versus-float values, map-versus-I/O restrictions and partial two-word f64 behavior. `mem` is not called a source alias for `mem32le`.
- **All six CP0 fields:** bad_address/lua_fault_reason/cause read-only; status/epc read-write plus compound assignment; exec write-only without compound assignment. Supervisor requirement and raw-word/execution-transfer distinction are explicit. Ordinary entry is not promised privilege.
- **All three intrinsics:** closure value and one argument; trace and trace_sink direct dotted statement forms with literal channels, arity, erasure and conditional evaluation; receiver-aware sink example and nil clearing. The new companion link resolves where the ordinary-builder selection limit is explained.
- **All six augmented assignments:** +=, -=, *=, /=, %=, ^=; one target/one expression; prepared target, RHS, read, operate, write; no target reevaluation or atomicity promise, including MMIO/CP0 consequences. No invented //=, bitwise, concatenation, increment or decrement forms.
- **Unary & and arrow:** typed address-of is distinct from String retention, not a byte-pointer/string-id conversion. Arrow is a named-member alternative, not C automatic dereference. Lowercase identifier and line-leading dereference constraints are stated. No independent blocker was found in these descriptions within this finite read.

## Reconstructed program artifacts

Extracted verbatim from the two fenced listings under `Complete example: static records and typed address views`, adding their normal terminating newline:

- `/tmp/bmsx-blua-extensions-reader/storage.lua`: 32 lines; SHA-256 `06b3e37736f0d01984045f5d5de99ba94e1f8ff885696df6744f8a0e2290c163`
- `/tmp/bmsx-blua-extensions-reader/cart.lua`: 30 lines; SHA-256 `687b849e71697a83d8a73815089f36922c91dbdcbe672dcccc627995ddd61daa`

The Memory companion explicitly says the top-level `memory_sample` and `memory_status` types are available unqualified to the entry's views/sizeof; they need not be runtime address/count exports. No hidden type module was invented.

Reader calculation: memory_sample tag @0 (1 byte), padding @1–3, value @4 (4 bytes), samples @8 and @10 (2 bytes each): alignment 4, size 12; two-record array = 24 bytes = six words. status = 12 bytes with word offsets 0/4/8. Selected offsets +12, +4, +8 and +22 agree with the listings. The first loop visits word indices 0 through 5. Documented completed words are `00000011 12345678 33441122 00000022 9ABCDEF0 77885566`; initial counter `12345678`, initial BSS OR zero, final counter `1234567A`, completed 1. These are documented expectations only.

## Public companion project/manifest/commands

The supplied-checkout route specifies this project layout:

```text
carts/memory_manual/cart.lua
carts/memory_manual/storage.lua
carts/memory_manual/res/manifest/manifest.rommanifest
tests/carts/memory_manual/memory_manual_assert.lua
```

Only the two program source files were reconstructed. The assertion-suite contents were deliberately not read or recreated. Its path is an advertised supplied-checkout dependency, so the public listings alone do not recreate the observation fixture in an empty independent project.

Public manifest:

```yaml
title: Memory Manual Example
hardware:
  - type: rom
```

Prerequisites: repository root, POSIX shell, Node 22+, npm and installed repository development dependencies (`npm install -D`), including working native canvas. No fresh-platform certification is promised.

Documented commands, NOT EXECUTED in this review:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- memory_manual --debug
npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua
```

Expected test line: `[test] startup_storage_and_scalar_copy: passed`. Matching BIOS is automatic; advertised outputs are `dist/memory_manual.debug.rom` and `dist/system/bmsx-bios.debug.rom`. The test compiles a derived integration image, not the byte-identical ordinary ROM, and linked absolute addresses may differ.

Ordinary playback is separately documented:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- memory_manual --ttl 2
```

Expect host loading/game-loop/TTL messages and possibly boot text, not the retained six words or a rendered image. TTL is virtual headless host time. Playback success is not a value assertion. The program's halt loop creates no completion interrupt.

## Remaining unproven bounds

No source acceptance, artifact generation, fixture existence/correctness, storage result, ordinary execution, native/browser parity, performance or trace selection was verified. The source address producer for closure and participant-sequence trigger were not found in the finite permitted route; this does not assert they cannot exist elsewhere. Other old source forms, linked chapters beyond the relevant excerpts, BIOS compiler APIs and general SDK operation were not systematically audited. No universal PASS is claimed.

## Scoped delta recheck: closure and participant navigation fixes

Re-read only the changed closure/participant paragraphs, the new development-companion participant section, and the linked BIOS loader's relevant interface/results/direct-compilation text. No implementation/private files, additional SDK audit, builds or tests.

Delta source hashes:

- `docs/book1/blua-programs.md`: `89b901a3c6d5d313cb7f1839de72136f54a0b7d881bd37552ce63eefca27d76a`
- `docs/programming/getting-started.md`: `189e651c002f50cb1bd4e632aea3f4cff6eb8951d0025689a479e12a54640581`

**Reader gap 1 closed as a documentation boundary/navigation issue.** Source lines 670–675 now explicitly identify `blua32.closure` as consuming, not producing/revealing, a valid function-record address with appropriate capture context. They link the supported BIOS `load` / `lua_compiler.compile_syntax` route for a callable compiled root and say ordinary function expressions need no supplied address. The linked BIOS interface states these calls produce a closure without executing it and documents their call/result contracts. This supplies a useful newcomer alternative without pretending the loader publicly returns a bare address or that its returned closure should be passed to `blua32.closure`. The low-level intrinsic's externally supplied address/context precondition is now explicit rather than an unlocated beginner acquisition task. No source-level raw-record extraction API is claimed or required by this acceptance.

**Reader gap 2 closed as a trigger/location issue.** Source lines 509–511 now directly link `Development invocation of <init>`. The companion names IDE Hot Resume as the specific explicit route, explains selected nonzero cartridge/system init vectors, installation before completion calls for rebuilt media, selected execution domains and the bounded initial selection cases. It preserves the normal-startup non-invocation rule and explicitly disclaims every-edit/replacement/reset/scheduling guarantees. This identifies the distinctive registration trigger without promising universal reload behavior. It is not live IDE interaction evidence or a step-by-step Hot Resume UI certification.

The original findings above are retained as the historical first-read result; these two findings are superseded by this scoped delta acceptance. The previously disclosed ordinary-ROM trace-selection CLI limitation remains unchanged. The 62-line static-record reconstruction and its no-build/no-runtime-proof bounds remain unchanged. No additional reader blocker was found in these two fixes; no whole-route or whole-manual PASS is asserted.
