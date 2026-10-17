# Memory manual development workflow - owner fact extraction

2026-10-17. Internal facts for a separate programming companion; **not public
hardware prose**. Source checkout `f4a7138fb5d0c09a9ccf3d98c5bcbfceb22bf5e0`.
Read the actual example, manifest, guest suite, package scripts, narrow builder,
module/entry, Node player/test, symbol producer/consumer owners. No runtime or
tooling changes, repository writes, installation, build or execution occurred.
`docs/architecture.md` and PDFs were not opened. `docs/guest_testing.md` was
consulted for orientation only; implementation claims below cite live owners.

## Stable owner facts

### Project and build inputs

- **MW01 - Minimal authored project tree for this exact example.** The gameplay
  program is `carts/memory_manual/cart.lua` (30 lines) plus
  `carts/memory_manual/storage.lua` (32 lines), and the resource manifest is
  `carts/memory_manual/res/manifest/manifest.rommanifest` (3 lines). The assertion
  route additionally uses
  `tests/carts/memory_manual/memory_manual_assert.lua` (74 lines). The README is
  explanatory, not a build input required by these owners. Sources: those four
  files in full; recursive Lua source selection
  `scripts/rompacker/cart_source_files.ts:4-15`,
  `scripts/rompacker/build.ts:35-45`.

- **MW02 - Exact manifest for the example.** It is YAML:
  `title: Memory Manual Example`, then `hardware:` with one `- type: rom` item.
  No entry-file/module field, RAM-device declaration, display asset or extra
  manifest field is needed for these files. The parser accepts only root
  `title`/`hardware`; title is optional and hardware is required. Its ROM item
  accepts only `type`. Sources:
  `carts/memory_manual/res/manifest/manifest.rommanifest:1-3`,
  `machine/ts/rompack/manifest.ts:14-29,45-75,102-104`.
  The builder discovers `.rommanifest` resources recursively, rejects multiple
  manifests, parses YAML, and rejects a missing cart manifest:
  `scripts/rompacker/build_inputs.ts:34-48`,
  `scripts/rompacker/compile.ts:98-104`.

- **MW03 - Folder selection and source root.** `memory_manual` is the cart-folder
  argument, not the title. Default cart resource root is
  `carts/<target>/res`, project root its parent; the build recursively collects
  Lua program files there. The ROM packer normalizes its folder argument to
  lowercase and allows letters/digits/underscore/hyphen. Sources:
  `package.json:87-88`, `scripts/rompacker/rompacker.ts:13-21,35-43`,
  `scripts/rompacker/build.ts:35-45`,
  `scripts/rompacker/cart_source_files.ts:4-15`.

- **MW04 - Module name and entry selection.** Project-relative `storage.lua`
  becomes module path `storage`, so the exact `require('storage')` in cart.lua
  resolves to that supplied module. Project source paths are made relative to
  the project root and their `.lua` extension is removed for module identity.
  `cart.lua` is selected because it starts with `module<entry>`, not because the
  filename is a special entry filename. This ordinary build requires exactly
  one such root: none and multiple roots are errors. Sources:
  `carts/memory_manual/cart.lua:1-8`,
  `scripts/rompacker/rombuilder.ts:190-207,677-688`,
  `toolchain/ts/rompack/blua32_image_builder.ts:85-108,145,203-223`,
  `toolchain/ts/lua/module_path.ts:1-32`,
  `toolchain/ts/lua/entry_module.ts:7-31`.

- **MW05 - BIOS dependency is automatic.** A cart build captures system and cart
  inputs, resolves or compiles the matching system build, and supplies that
  system's actual imports to the cart linker. It does not require a pre-existing
  dist BIOS sidecar as its dependency input. The CLI exports the artifact's
  outputs to dist by default; system files are under its system subdirectory.
  Therefore a separate `build:toolchain:bios` is not a minimal prerequisite of
  `build:toolchain:cart -- memory_manual --debug`. Sources:
  `scripts/rompacker/build.ts:23-79`,
  `scripts/rompacker/rompacker.ts:19-30,42-49`,
  `scripts/rompacker/artifacts.ts:46-56`.

- **MW06 - Debug is required for the provided assertion route.** Debug builds
  collect testlib plus the corresponding `tests/carts/memory_manual` sources.
  `_assert.lua` suites are source-only debug assets, not ordinary gameplay
  modules; this exact suffix is recognized. The tooling test build later
  admits the suite. Sources: `scripts/rompacker/build.ts:37-45`,
  `scripts/rompacker/compile.ts:109-117,130-140`,
  `scripts/rompacker/scenario_test_sources.ts:15-37`,
  `scripts/rompacker/rombuilder.ts:555-558`,
  `toolchain/ts/rompack/scenario_test.ts:3-4`.

### Environment and package commands

- **MW07 - Honest setup boundary.** Use the repository checkout as current
  directory, with Node/npm and its development dependencies installed. The
  configured Node product compilation target is `node22`; the current root
  setup documentation says Node 22 or later and `npm install -D`. Those setup
  lines are documentation, not a fresh-install proof. Current extraction-host
  observations are Node `v22.23.1` and npm `12.0.2`; no general npm-version pin
  was found in the root package. Sources:
  `scripts/products/node_build.ts:50-66,103-107`,
  `package.json:6-36`, `README.md:15-18`; live `node --version` and
  `npm --version` observations. Do not silently convert these observations into
  a tested version range.

- **MW08 - Real platform/dependency requirements for the chosen command path.**
  The npm `headless:test` wrapper uses `sh -c`: the copyable npm command sequence
  below assumes a POSIX shell, e.g. this Linux/WSL checkout, rather than claiming
  a native Windows-shell recipe. Development dependencies include `tsx`,
  `esbuild`, `canvas`, `elkjs` and the rest of the root devDependency set.
  Product builds first generate the host atlas, which imports native `canvas`;
  the ROM builder also loads `canvas`. A functioning installed canvas binding
  is thus required even though this cart has no images. Sources:
  `package.json:19-36,45,89-95`,
  `scripts/render/generate_host_system_atlas.ts:1-14,43-54`,
  `scripts/rompacker/rombuilder.ts:120`,
  `scripts/products/node_build.ts:103-107`. No apt/brew/compiler installation
  recipe or native-canvas availability on every OS was established here.

- **MW09 - Build commands and artifact names.** The root scripts provide
  `build:product:node-headless-tooling`, `build:product:node-headless-player`
  and `build:toolchain:cart`; `--debug` selects debug artifacts. The Node product
  outputs are `dist/host_headless_tooling.debug.js` and
  `dist/host_headless.debug.js`. The debug cart is
  `dist/memory_manual.debug.rom`, with its matching automatically exported
  `dist/system/bmsx-bios.debug.rom`. Sources: `package.json:88-95`,
  `scripts/products/product_builder.ts:69-80,131-142`,
  `scripts/products/node_build.ts:72-97`,
  `scripts/products/targets.ts:19-44`,
  `scripts/rompacker/rombuilder.ts:1281-1283`, MW05.
  Both builders accept `--force` but ordinary incremental build commands do not
  need it. Sources: `scripts/rompacker/rompacker.ts:17,42`,
  `scripts/rompacker/build.ts:47-65`,
  `scripts/products/node_build.ts:78-80,98-101`.

- **MW10 - Do not infer a TypeScript check from a script's name.**
  `validate:toolchain:cart` adds `--force` while `build:toolchain:cart` adds
  `--skiptypecheck`; the present ROM CLI merely parses `skiptypecheck` and does
  not pass it to another owner or invoke tsc. Separate root
  `compile:machine`/`compile:toolchain` scripts invoke tsc. A ROM build still
  performs BLua compilation/linking and linting; do not call the command a
  general TypeScript validation run. Sources: `package.json:83-88`, complete
  `scripts/rompacker/rompacker.ts:11-58`,
  `scripts/rompacker/compile.ts:134-169`.

### Executable results route, distinct from ordinary playback

- **MW11 - Test command ownership.** `headless:test` requires cart folder and
  suite path, invokes the tooling bundle with the explicit debug BIOS and
  `--test`, and forwards further options. Node tooling selects host-test mode,
  reads the named files and calls `runGuestTests`, rather than executing its
  ordinary player loop. Sources: `package.json:45`,
  `scripts/bootrom/platforms/node_tooling_options.ts:135-144,190-220`,
  `scripts/bootrom/platforms/node_tooling_entry.ts:94-107`.

- **MW12 - Exact terminal result and failure route.** The host test runner
  resolves the packaged suite by source path, can filter a named case using
  `--case`, drives the shared isolated TestRun, prints each case name/state,
  emits guest logs with `[test:log]`, prints failures with phase/stack, and
  throws unless the overall result is passed. Thus the primary success line
  for this exact suite is
  `[test] startup_storage_and_scalar_copy: passed`. Its following authored log
  summarizes observations. Missing suite/case, failed assertions and expiry
  are failures, not successful blank output. Sources:
  `scripts/bootrom/platforms/hostrunner/test_runner.ts:16-65`,
  `scripts/bootrom/platforms/node_tooling_options.ts:43-44,73-76,174,208-210`,
  `tests/carts/memory_manual/memory_manual_assert.lua:16-22,71-74`.
  Default test wall-clock budget is 60000 ms, not the suite's wait bound of
  eight completed logical ticks: runner `:41-53`, options `:208-210`,
  `testlib/context.lua:12-24`, suite `:20-22`.

- **MW13 - What is actually inspected.** The one integration case waits for
  `status.completed == 1`, then asserts DATA/BSS observations, the final
  counter, type sizes/offsets, count, relative pointer strides, +1 byte address,
  every one of the six RODATA/output words, every record scalar and padding,
  and completion. It calls no capture operation. Sources: the complete suite
  `tests/carts/memory_manual/memory_manual_assert.lua:1-74`.
  The explicit six-word expectations are
  `00000011 12345678 33441122 00000022 9abcdef0 77885566`; initial counter is
  `12345678`, initial output OR is zero, final counter is `1234567a` and
  completed is one. The values are assertion expectations until root executes
  the command for this checkpoint; this extraction does not assert a new run.

- **MW14 - Derived-test qualification.** The test owner parses the ordinary
  program's sources and entry, adds the selected suite/testlib dependencies,
  preloads the test execution modules, and compiles a derived image. Unit
  suites replace the entry; this integration suite does not. Each case gets a
  new target constructed with that derived cartridge. The provided route
  verifies the production program's storage behavior under the integration
  fixture; it is not a byte-for-byte playback of the original production ROM,
  and no promise follows that its absolute linked addresses equal the ordinary
  ROM's addresses. Sources:
  `toolchain/ts/rompack/test_cartridge.ts:118-128,156-217`,
  `ide/testing/run.ts:31-45`,
  `ide/testing/guest_fixture.ts:31-47`,
  `ide/testing/execution.ts:98-105`.

- **MW15 - Ordinary player launch exists separately.** `headless:game` invokes
  the IDE-free Node player bundle with the explicit debug BIOS. Its positional
  `memory_manual` resolves to `dist/memory_manual.debug.rom` for this debug
  product. It boots the ordinary runtime and drives the host game loop, not
  a test. `--ttl 1` means one second of its virtual headless host clock, not a
  promised one-second wall-clock run. Sources: `package.json:43`,
  `scripts/bootrom/platforms/node_launch.ts:60-77,95-111,114-140`,
  `scripts/bootrom/platforms/node_entry.ts:70-90,106-121,134-166`,
  `hosts/node/headless/clock.ts:40-60,95-97`,
  `hosts/node/headless/frame_loop.ts:36-55`.

- **MW16 - Ordinary launch does not inspect example values.** The player prints
  loading paths, game-loop start and TTL termination and may also flush BIOS
  system output; it does not evaluate this
  program's counter/status/output or print the six words. The program itself
  only observes/copies storage and halts, with no print, renderer, device job or
  interrupt configuration. The Node host uses offscreen video and discards
  audio. An ordinary successful player exit is therefore not a result-value
  assertion or a visible-output proof. Sources:
  `scripts/bootrom/platforms/node_entry.ts:74-80,106-125,161-166`,
  complete `carts/memory_manual/cart.lua:1-30`.

### Symbols and linked addresses: actual artifact versus an invented inspector

- **MW17 - Cart debug symbols are embedded, not a cart sidecar.** With debug
  selected, the cart builder sets `includeSymbols`; the cartridge ROM contains
  the binary asset `__blua32_symbols__`. Its metadata includes named static
  declarations with source definition, kind and linked address for BSS/DATA/
  RODATA; type declarations have no storage address. Sources:
  `scripts/rompacker/compile.ts:139-145`,
  `scripts/rompacker/rombuilder.ts:1171-1200`,
  `toolchain/ts/rompack/blua32_symbols.ts:10,89-98,117-135`,
  `toolchain/ts/rompack/blua32_linker.ts:1016-1027`,
  `toolchain/ts/rompack/blua32_symbols_codec.ts:210-212`.
  External `.rom.blua32-symbols` and `.rom.blua32-imports` files are emitted by
  this finalizer only for system ROMs, not cartridge ROMs:
  `scripts/rompacker/rombuilder.ts:1432-1445`.

- **MW18 - Existing programmatic owner can decode those addresses.**
  `loadBlua32ToolingImage(parseCartridgePackage(bytes), CART_ROM_BASE)` is the
  existing tooling composition: it decodes the image and embedded symbols and
  returns `.symbols.metadata.staticScopes.declarations`. The actual Studio
  Lua-inspection owner consumes linked declarations and presents storage as
  `kind: 'address'`; it is not a raw-buffer allocation service. Sources:
  `toolchain/ts/rompack/blua32_media.ts:16-19,29-51`,
  `ide/runtime/lua_inspection.ts:73-95,220-236`, MW17.
  These are existing programmatic APIs, not a copyable beginner terminal UI.

- **MW19 - Scope limit of the existing command-line symbol dumper.**
  `scripts/dump_blua32_symbols_from_rom.ts` reads a cartridge, locates the symbols
  asset, decodes it, and prints asset extents, function/module counts and sample
  global names. It does **not** print static declaration addresses, output bytes
  or a running machine's result values. Source: its complete `:9-37`.
  Therefore do not direct a beginner to that command as an exact static-address
  or result inspector. No turnkey static-address dump command was established
  by the scoped owners inspected here, and none was invented or added. The
  supported complete result-inspection path established here is MW11-MW13's
  named guest-test command; no absolute numeric addresses or implementation
  reverse-engineering are needed to use that route.

## Source-derived copyable command sequence for root validation

Run at the repository root in the POSIX-shell environment described in MW07-08,
with installed dependencies. For a fresh dependency installation the repository
setup text's exact command is `npm install -D`; it was not executed here.

Minimal example build plus assertion inspection (BIOS dependency is automatic):

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- memory_manual --debug
npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua
```

Look for the exact named `passed` line in MW12 and the authored observation log;
full individual expectations are MW13/the supplied suite, not ordinary player
console output. This is a source-derived sequence ready for root to execute,
not fresh execution evidence from this extraction. To select just the already
sole named case, the established optional suffix is
`--case startup_storage_and_scalar_copy`.

Separate ordinary playback of the same production cartridge (not assertion
inspection):

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- memory_manual --ttl 2
```

This chosen route uses the actual Node player and needs no browser, Studio
clickpath, SDL/libretro build or invented wrapper. No browser/GUI-visible proof,
native parity, speed, universal installation success or publication acceptance
follows. Root should run builds serially and audit these bounded facts before
authoring the programming companion.

## Separately supplied root execution evidence

After this source extraction, root ran the player product build and
`npm run headless:game -- memory_manual --ttl 2`, with exit zero, recorded in
`/tmp/bmsx-memory-first-build-player.log`. I read that resulting log: it includes
BIOS boot/cartridge handoff text as well as the player's loop/TTL messages, and
no example-memory values. Root also reran the named guest case;
`/tmp/bmsx-memory-first-build-observe.log` contains
`[test] startup_storage_and_scalar_copy: passed` and the authored value log.
These are root's recorded executions, not builds performed by this extraction
agent. They corroborate MW12-16's result-route distinction; no absolute-address
equivalence or additional installation/platform proof follows.

Root subsequently ran all three minimal build/test commands exactly as printed
above and reports success in `/tmp/bmsx-memory-first-build-minimal.log`. This
adds direct root execution evidence for the minimal sequence; installation and
fresh-platform setup remain untested. Root independently audited MW01-MW16
against the live owners. A public companion can omit MW17-MW19's programmatic
symbol internals and teach the supported assertion-result route directly.

## Reader observation-route supplement


Internal compact author input, stable MW20+ facts, 2026-10-17. Source extraction only by this agent: no public prose, repository edit, runtime change, architecture/PDF read or new execution. Root-owned actual browser/test evidence is separately attributed below.

**MW20 — Supplied fault project and build roles.** `carts/memory_fault_manual/entry.lua:1–11` is the complete cartridge source (BSS marker, intentional unmapped Word load, trailing HALT loop), not a host test to paste into Node stdin. Build from repository root with `npm run build:product:browser-player -- --debug`, then `npm run validate:toolchain:cart -- memory_fault_manual --debug`. Browser product and cart media are separate products. Package scripts: `package.json:87–95`; debug flag and player/package producer: `scripts/products/product_builder.ts:75–80,99–112`. Cart project selection/paired BIOS capture: `scripts/rompacker/build.ts:23–45,71–76`.

**MW21 — Concrete output filenames.** Debug browser build supplies `dist/engine.debug.js` and `dist/index.html`; the HTML names `system/bmsx-bios.debug.rom`. The cart build supplies `dist/memory_fault_manual.debug.rom` and its matching system outputs under `dist/system/`. Sources: `scripts/products/targets.ts:19–44`, `scripts/products/browser_build.ts:217–242`; ROM basename `scripts/rompacker/rombuilder.ts:1281–1283`, paired system output prefix `scripts/rompacker/build.ts:47–58`, export `scripts/rompacker/rompacker.ts:42–50`. These filenames are products, not authored source/result-module names.

**MW22 — Serve locally and use the direct index URL.** `npm run serve:dist` runs the existing `preserve:dist` pre-script (build node-host-tools) and serves `dist` at port 8080, default host `127.0.0.1`. Use **`http://127.0.0.1:8080/index.html?rom=memory_fault_manual.debug.rom`**. The hinted `http://127.0.0.1:8080/?rom=...` is NOT accepted: server `/` redirects to `/index.html` without the search string. Sources: `package.json:110–111`; `scripts/serve-dist.mjs:41–45,160–167,239–250,278–284,293–298`. Player loads the selected query ROM rather than requiring a hardcoded default: `hosts/browser/boot.ts:51–59,197–199,300–305`; actual player consumer `hosts/browser/player.ts:30–35`.

**MW23 — Debug auto-start and physical keyboard.** The specified debug player skips the Press-any-key wait (`hosts/browser/boot.ts:164–171`); do not add a non-debug-only startup requirement. Give the browser page keyboard focus (click the player/page) before typing. Browser host listens on its owning window for keydown/up and forwards ordinary physical codes as `keyboard:0`: `hosts/browser/input.ts:196–215,345–369,372–395`. This is browser keyboard delivery, not CLI stdin. Installed BIOS accepts letters and Enter/numpad Enter through its HID monitor path: `machine/bios/shell/monitor.lua:105–108,273–275,354–395`. The existing test's physical-key command sequence is `MEM 08010208 3`, `FAULT CLEAR`, `CONT`, each followed by Enter: `tests/ide/memory_fault_manual.idetest.js:20–43`.

**MW24 — Existing readable FIT setting.** Browser player explicitly starts with `'overscan'`; its existing PICTURE root-menu option has values FIT / OVERSCAN 5%, directly selecting video-output screen fit. Sources: `hosts/browser/player.ts:30–35,81–94`; frontend options inserted in root menu `hosts/common/host_overlay_menu.ts:379–386`. Do not treat clipped default overscan terminal output as adequate readability or propose a runtime change; the existing FIT setting is the supported display route.

**MW25 — Exact narrow menu keys for FIT.** With default mappings, Right Ctrl is Select and Right Alt is Start (`hosts/common/input/manager.ts:238–244`). Briefly press the Select+Start chord and release before the **500 ms** hold deadline: short release toggles menu; holding reaches rewind instead. Sources: `hosts/common/input/shortcuts.ts:8–14,320–341`; menu binding `hosts/common/host_overlay_menu.ts:408–418`. In the root menu, Up/Down select **PICTURE**, Left/Right cycle its value to **FIT**, Escape closes. Physical mappings: `hosts/common/input/ui.ts:10–22`; selection/cycling `hosts/common/host_overlay_menu.ts:505–519,823–827`; Escape/B closes root menu `473–495`. No fixed number of arrow presses is established; select by visible label. No broader host-shortcut contract is added.

**MW26 — Root-owned actual browser proof, not execution by this extractor.** Root reports a successful debug player build, loopback serve, direct-index URL, physical mouse/keyboard and actual viewed page images. Default overscan cropped terminal edges; existing short chord → PICTURE → FIT → Escape produced readable output. Root then typed MEM / FAULT CLEAR / CONT. Actual MEM line: `08010208: 00000001 01000000 00000801`. Source-of-evidence handoff: `/tmp/bmsx-memory-fault-browser-execution.md:3–7`. Images: `/tmp/bmsx-memory-fault-browser-picture-fit.png`, `-fit-mem.png`, `-fit-fault.png`, `-fit-cont.png`; logs: `/tmp/bmsx-memory-fault-browser-build.log`, `-server.log`, `-console.log`, `-fit-console.log`. These browser images/logs are distinct from the canonical unmodified 320×240 headless figure and from hardware-latch assertions. No native/other-browser/fresh-install/recovery equivalence claim.

**MW27 — DMA authored program, retained result storage and test are different files.** Complete cartridge is `carts/dma_manual/cart.lua`; `carts/dma_manual/results.lua:12–33` defines and exports its BSS `result`, including source/copies/channel observations. It is not a generated results file. `tests/carts/dma_manual/dma_manual_assert.lua:16–29,30–71` is an ordinary guest integration test that reads retained observations and asserts the copy/completion results. Its named case is **`copies_and_separate_gpu_completion`**. It checks all 60 source/copy words, channel/count/status and bounded separate GPU observations; it does not need an assumed absolute BSS address inspector.

**MW28 — Exact DMA observation commands and output.** With the debug tooling product available, run from repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- dma_manual --debug
npm run headless:test -- dma_manual tests/carts/dma_manual/dma_manual_assert.lua
```

The first builds `dist/host_headless_tooling.debug.js` (`package.json:95`; `scripts/products/product_builder.ts:138–142`; `scripts/products/targets.ts:40–44`). The test script launches that debug tooling with `dist/system/bmsx-bios.debug.rom`, `--test <file>` and the named ROM (`package.json:45`). Cart project/paired BIOS output ownership is MW20/21. Root's actual minimal build/test rerun is recorded in `/tmp/bmsx-memory-dma-reader-command.log:9–20`: exact artifact exported, `dist/dma_manual.debug.rom` loaded, **`[test] copies_and_separate_gpu_completion: passed`**, and the named test log reports 60 RAM words, both BUSY, IRQ sequences 3/1, counts zero and DONE, fixed GP0 and DMA-before-marker/idle. Earlier validate-build plus same case log: `/tmp/bmsx-memory-dma-lifetime-validation.log:1–36`. These are console/test-log results, not a promised JSON output artifact or a live-memory-address dump. No new test was run by this extractor.

Boundaries: R1/R2 practical repository workflow only. No invented terminal stdin route for Node CLI/headless, new host server/API, deployment recipe, Studio workflow, supervisor/recovery policy or new hardware behavior. Actual server root-query mismatch is corrected by the direct index URL above, not by a server patch.

## Independent comparison with root's compact OW core

Compared `/tmp/bmsx-memory-observation-core-facts.md` OW01–OW06 with MW20–MW28 and the already inspected owners: **no substantive contradiction or unresolved practical R1/R2 gap found**. The direct-index URL correction is present; debug auto-start, existing FIT/menu physical-key route, separate browser evidence attribution and named DMA result-test route agree. Independently confirmed the supplied manifest (`carts/memory_fault_manual/res/manifest/manifest.rommanifest:1–3`), browser template body fields (`gamebase.html:22`), Node player construction with `HeadlessInputHub` (`scripts/bootrom/platforms/node_entry.ts:101–105`) and latest successful matching cart export log (`/tmp/bmsx-memory-fault-reader-command.log`). Root core's browser execution/visual claims remain root-owned; this agent did not rerun or re-view them. No stylistic rewrite or additional manual framework requested.

## Additional supplied buffer-program observation routes


Root extraction/actual execution, 2026-10-17, dbf99b501. These extend independently checked MW01–16/MW20–28 generic builder/module/debug/derived-test facts. No new tool/API/harness, no runtime/cart edits. Only the named existing projects/suites/results below are approved for observation instructions; no general symbol/address inspector follows.

- BW01: The GEO complete program lives in `carts/geo_manual/{cart,results}.lua`, public chapter `../book1/geo.md#complete-blua-program`. Supplied suite `tests/carts/geo_manual/geo_manual_assert.lua:1-73` is integration, named `transforms_sat_contacts_and_fault_ack` (lines17–20). Its asserted retained results include8vertices/2AABBs, SAT words,2floatcontacts+summaries, sixphaseprogress/status,5DONE/1ERROR and localfaultack. Named case passed in actual fresh ordinary guest path, not picture/GPU rendering. Source entire named73-line suite; actual execution `/tmp/bmsx-memory-buffers-geo_manual.log`.
- BW02: IMGDEC complete program `carts/imgdec_manual/{cart,results}.lua`, public `../book1/imgdec.md#programming-imgdec-in-blua`. Integration suite `tests/carts/imgdec_manual/imgdec_manual_assert.lua:1-101`, named `ram_gp0_fault_and_recovery` (lines19–22). Asserts26retained RAMwords, fourphases/progress/DMAcounts/status/IRQ, knownfault retainedheader and freshSTART result; separately performs actual12texture+8CLUT GPUREAD checks (lines74–97). These pixelwords are additional test observations, not program-retained result or display picture. Actual `/tmp/bmsx-memory-buffers-imgdec_manual.log` passed.
- BW03: APU complete program `carts/apu_manual/{cart,results}.lua`, public `../book1/apu.md#worked-blua-program`. Integration suite `tests/carts/apu_manual/apu_manual_assert.lua:1-93`, named `pcm_transfer_generator_and_badp` (lines17–21). Checks16transferwords/private-RAMroundtrip, separateDMA/APUuploadcommit and downloadSTOP, pausedactive/source/gain with advancing sampleclock,4end events, endedbankclear and nofaults. Not audible/speaker/waveform or native evidence. Source entire93line suite; actual `/tmp/bmsx-memory-buffers-apu_manual.log` passed.
- BW04: After the existing tooling build, each route uses exactly `npm run build:toolchain:cart -- <project> --debug` then `npm run headless:test -- <project> tests/carts/<project>/<project>_assert.lua` with project selected from BW01–03. Expected line is `[test] <exact-case-name>: passed`. These are already owned generic package scripts (package.json44–45,87–88), not a new command. Debug cart build handles matching BIOS automatically (MW05). No separateBIOSbuild or guessednumericRAMresultaddress is required. Missing/failed/expired case is not success (MW12). Derived integration/fresh target/absolute address qualifications MW14 apply to all three kind=integration suites. Root has now validated and executed each original program and observed exit0 of the exact minimal build+test reruns for all three. Logs `/tmp/bmsx-memory-buffers-<project>-reader-command.log` contain the exact named passed lines. This is current existing-checkout execution, not fresh-platform certification.
- BW05: Current GTE manual suite also passed both static_operand_layout and geometry_color_and_buffer_lifetime; that suite exercises normal projection/color/layout and two captures, NOT timedPLUS. Separate existing TS device suite tests/lua/gx_gte.test.ts ran43tests allPASS; its primary tests coverPLUS pending/interlock/restore etc. Neither of these is a new complete cartridge example provingeveryPLUSlifetimehazard or native parity. Do not attribute GTE's ordinary triangle snapshots to new shared-buffer/PLUS tests.
