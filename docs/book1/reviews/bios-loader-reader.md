# BIOS runtime compilation: fresh public-only reader acceptance

## Verdict

**Scoped PASS.** An experienced programmer new to BMSX can follow the public route, reconstruct the complete cartridge, choose text or factory compilation, understand the documented runtime-language restrictions and observations, and identify the supplied build/test/ordinary-playback commands without reverse engineering. No concrete route-blocking gap or internal contradiction was found in this read.

This is a public-document usability and static reconstruction check. No cartridge, test, build, dependency installation, or emulator was executed. Repository files were not edited. No implementation owners, facts/review/editorial documents, actual cartridge Lua or manifest files, test Lua, architecture manuscript, historical PDFs, or private handoffs were opened.

## Exact inputs

SHA-256:

| Public input | Hash |
| --- | --- |
| `docs/book1/bios-loader.md` | `b59cf2dbdc1b3ef6bd21d7f20c6fd05a5585df7fffeb85cdc5d8e6594b11e5d3` |
| `docs/programming/getting-started.md` | `f624246842c33cf7bb7abbdbdcee26146531bf37cb6cb3e724a76067246834c9` |
| `carts/bios_loader_manual/README.md` | `17397dc75d72af1d4cc97def81c9c94a8fe52adf1947a0fc6d34beac38151804` |

Only linked public chapters were followed for prerequisite definitions. Their input hashes were:

| Linked prerequisite | Hash |
| --- | --- |
| `docs/book1/memory.md` | `28089324f05ad3661ea7f8b29200392a0ec0657e13fcc968c7c3ba094b7a1230` |
| `docs/book1/blua-programs.md` | `e4cc1350a40b7a4d5c491efd84cb4bf6c64702f37557ad91b45d1b0ab3b65d69` |
| `docs/book1/coroutines.md` | `7becc9752745fa69d9c31aeda2811f3954029f609b349f2822cbb283fccc4a2c` |
| `docs/book1/cpu.md` | `3b83050c8a28398079f8ffa6fc5d3439a6e8ded2cf1cd96aed6af1540b9c16e3` |
| `docs/book1/bios-base.md` | `fca0baa2977922446b551df44a02d2161e390e8a1e399bb249b98c55cb741505` |

## Prerequisite chain followed

1. The loader chapter links directly to BLua source programs, CPU values/calls, memory/storage, and protected calls/coroutines.
2. Memory sections on typed storage, primitive representations, structs, typed local views, language values versus byte RAM, and argument/result adjustment explain `word`, `f64`, `bss`, `struct`, `: *type`, and why closures/Tables/error values stay guest values rather than byte encodings.
3. BLua sections on source modules, literal `require`, eager initialization, ordinary exports, const locals versus const modules, installed program globals, and `halt_until_irq` explain the two file roles, the final ordinary-module export, shared mutable observations Table, named global access, and final parked entry.
4. CPU calls/closures/Tables sections supply ordinary callable/capture/indexing definitions. Protected-call sections explain `pcall`, arbitrary error payloads, nil positions, and the non-transactional language-error boundary.
5. The BLua installed-name section links to BIOS base services. Its `select` and `print` definitions explain counting intervening nils and tab-separated fields. No additional implementation knowledge was needed.
6. Getting-started prerequisites specify repository-root POSIX shell, Node.js 22 or later, npm, development dependencies via `npm install -D`, and a working native `canvas` binding. Earlier example cartridges are expressly not prerequisites. Its runtime-compilation section supplies the complete loader-specific route.

## Reader tasks checked

- **Route selection and invocation:** Text uses protected `load`; owned syntax uses direct `compile_syntax`. Neither route invokes the result. Signatures, fifth/fourth external-scope slots, defaults and required written-call counts are distinguished from reached fixed-parameter behavior.
- **Runtime grammar:** The chapter explicitly separates runtime-loaded blocks from linked-cartridge BLua and describes identifiers, literals, escapes, calls, operators, single-target declarations/assignments, control flow, lexical scope, path roots, missing linked forms and diagnostic shapes. The complete cartridge's richer linked syntax is not presented as valid runtime source.
- **Nil, default, mode, tuples and errors:** Only nil mode skips scanning; lowercase `t` membership is sufficient; binary decoding is not selected. False mode fails during length, while false environment selects indexing and fails on invocation in the example. Failure detection uses the first `load` result, preserving a possibly nil/false error payload. Bare return/fallthrough produce one nil, and final unparenthesized calls expand tuples while runtime parentheses select one result. Direct syntax errors require an explicit protection boundary if wanted.
- **Environment and external scope:** Locals/captures precede external names, then environment/global routing. Actual environment identity and subsequent writes are retained rather than copied. The documented `names`, `read`, `write`, descriptor flags and callback signatures are enough to construct a self-owned binding; the complete example does so without inventing a selected-frame location. Unusable matching external descriptors do not silently fall through.
- **Factory shapes and ownership:** All 27 callables have usable signatures and argument-role explanations, including identifier occurrences versus strings/symbol records, member keys versus expression indices, raw `index_path` values, method receiver versus callee, parameter-node lists, declaration nodes, conditional helper records, fourth-position nil numeric-loop step, empty return lists, direct string-ID operand and `expands_results`. Nodes are fresh per occurrence/attempt; only symbol keys are shared. Generated-symbol identity and unresolved-symbol failure are explicit.
- **Resources and lifetime:** Arena capacity/alignment/header/splitting, emitted-count payload formula, register ceiling, separate guest-object heap, whole-compilation retention by root/child closures, weak allocator ownership, GC/reuse conditions and finite retry are stated without timing guarantees. Environment retention depends on generated use. Borrowed-frame binding retirement is separate from retained code lifetime. No undocumented reset/cache guarantee was required for acceptance.

## Static reconstruction

Extracted only the chapter's published Lua fences after “Complete program: runtime compilation”; concatenated entry parts 1–4 in order without source invention. Saved under `/tmp/bmsx-bios-loader-reader-reconstruction/`:

| Reconstructed file | Lines | SHA-256 |
| --- | ---: | --- |
| `results.lua` | 23 | `53bb04c9d407a29c64ac99f4615490647813d0f76a537b9ae07d2aaa581a64c5` |
| `entry.lua` | 137 | `ef911e554858b176aaec2e8042ae253ec5ede8fc550a191e4d45a9ad5ba3aa1f` |
| `res/manifest/manifest.rommanifest` | 3 | `fc0a148866536d61073954a669def42731bc90bfc5395620d10a9c07a5aadc5e` |
| `ordinary_timeline.json` | 6 | `120ac0aa42b4303ebefb206a909c662e4c0c9bbdfd9e4663233d35ef70473ea8` |

Entry parts contain 34, 32, 33 and 38 lines respectively. The combined entry has exactly one `module<entry>`. The results module remains ordinary and exports typed numeric BSS plus a mutable Table. The manifest is complete (`title: BIOS Loader Manual`, `hardware`, ROM item); no entry filename field is required. The six-line timeline supplies frame 8 and its description. These files were not compared against private cartridge/test source.

## Supplied build and observation route

From the repository root after the stated prerequisites:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_loader_manual --debug
npm run headless:test -- bios_loader_manual tests/carts/bios_loader_manual/bios_loader_manual_assert.lua
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_loader_manual/ordinary_timeline.json bios_loader_manual
```

The public route names the supplied suite and expected `[test] runtime_compilation: passed`, with 38 retained assertions after completion. It distinguishes that fresh derived TS integration image from separate ordinary playback and says the builder selects the matching BIOS with normal quality checks enabled. This review confirms that the instructions are supplied and usable as a reader route, not that those commands passed during this review.

All 13 ordinary diagnostic lines are printed in both the chapter and companion README. A static comparison found an exact match after replacing README tabs with the chapter's documented spaces:

```text
Load environment 0 3 8 8
Load external scope 12 14 14 1000
Load globals 7 9 9
Load child 15 25
Load modes 42 nil attempt to load a text chunk (mode is 'b')
Load false mode nil Attempted to get length of an unsupported value.
Load false environment nil false Attempted to index field on a non-table value.
Load source error nil [load:manual.invalid] unexpected character at 1:8
Load nil results 1 nil 1 nil
Load result expansion 3 1 3 nil 9
Load syntax factory 42
Load generated symbol 7
Load syntax error false [load:manual.invalid_syntax] break outside loop at 1:1
```

Nil fields, error text, line/column and middle tuple nil are therefore all available for comparison without inspecting the test implementation. Timeline completion is separately required; offset 8 is explicitly an endpoint rather than an assertion or timing guarantee.

## Limits and open scope

No fresh SDK/dependency/native-canvas installation was attempted. No runtime build/execution, native parity, all-input/grammar/optimizer correctness, forced collection, exhaustion/reuse/cache behavior, reclamation deadline, reset/snapshot/persistence, performance, PDF layout or implementation-source audit was established. The documents already keep the Table-length publication dependency and dynamic unary-`&` lowering question open. These limits do not obstruct the finite newcomer route checked here.

## Public-only delta check: system startup and compiled-code storage

**Scoped delta PASS.** Read only the newly added `System startup and compiled-code storage` subsection and the linked public SYSTEM page's control/reset-request definitions. No private source, owners, facts, reviews, builds, runtime execution or repository edits were used.

Exact new loader input SHA-256: `4588aa55cf58ae6ad0c9d7567020db578b1db99594fde6908f2adc8136abc9c8` (`docs/book1/bios-loader.md`). The linked public prerequisite `docs/book1/system.md` hashes to `c2646d2476bdedd217d97a9d4432e4077e5b45cd528374ea378f8e5aca996327`.

The added subsection is comprehensible without inventing an API or assuming persistence:

- System DATA copy and system BSS zeroing precede dependency-ordered module initialization, which precedes BIOS entry. It explicitly assigns free-block header/cursor initialization to the arena module, rather than claiming BSS zeroing alone creates a usable allocator.
- A hardware reset request is distinct from its later consumption and reboot. The SYSTEM link supplies a concrete public interface: the CONTROL address, bit-0 RESET command, command readback, coalesced request, and consumption at documented execution boundaries. The new prose therefore needs no missing reset function. Its conditional “If execution proceeds through system startup” avoids equating the request write with completed initialization.
- Clearing guest globals/module-initialized latches before the system-reboot CPU restart is distinguished from a CPU-only restart, which by itself promises no arena reinitialization. Replacing ROM bytes or an execution image is likewise not described as running startup.
- Ordinary BIOS-to-cartridge transfer initializes cartridge DATA/BSS after the BIOS-reserved BSS, not the BIOS arena. This separates the cartridge's storage from BIOS-owned allocator state. It does not promise arbitrary code preservation through reset/media replacement, nor complete RAM clearing.

No concrete gap or contradiction was found in this narrow delta. The earlier route/reconstruction/13-diagnostic scoped PASS and its finite limits remain the applicable earlier evidence; this delta check does not re-prove those unchanged sections, execute the 160 source lines, establish implementation correctness, or add fresh SDK/native/all-input/reset-preservation guarantees. Subsequent layout-only keep groups are outside the technical delta reviewed here.
