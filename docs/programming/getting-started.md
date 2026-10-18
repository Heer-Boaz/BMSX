# Build and inspect the memory example

Use this guide with the two program listings in the [worked storage example](../book1/memory.md#worked-example-prepare-and-copy-two-records). It takes the supplied `memory_manual` cartridge from source files to an executable storage check, then shows ordinary headless playback separately. It is a first-build route, not a complete SDK or debugging guide.

## Prerequisites

Run the commands from the BMSX repository root in a POSIX shell, such as the Linux/WSL environment used for this route. Have Node.js 22 or later, npm and the repository's development dependencies installed. The repository setup command is:

```sh
npm install -D
```

A working native `canvas` binding is required by these builds, even though the memory example contains no images. The build and run sequence below was checked in an existing working checkout; a fresh dependency installation and every operating system were not tested by that check.

## Put the files in their roles

The repository supplies these example files, including the assertion suite. If recreating the worked storage example's two program listings, put the storage listing in `storage.lua` and the entry listing in `cart.lua` at these exact locations:

```text
carts/
  memory_manual/
    cart.lua
    storage.lua
    res/
      manifest/
        manifest.rommanifest
tests/
  carts/
    memory_manual/
      memory_manual_assert.lua
```

The manifest is exactly:

```yaml
title: Memory Manual Example
hardware:
  - type: rom
```

`memory_manual` is the cartridge folder argument used by the commands, not the manifest title. The builder collects Lua sources recursively from the cartridge project and resources from its `res` directory.

`storage.lua` has the project-relative module name `storage`, so the entry listing's `require('storage')` resolves to it. `cart.lua` is the entry because it declares `module<entry>`, not because that filename is special. The project must have exactly one such entry module; no manifest entry-file field is needed.

The supplied `memory_manual_assert.lua` is a test suite, not another gameplay entry. Its `_assert.lua` suffix and the debug build make it available to the test route below.

## Build and check the storage result

Run these three commands in order:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- memory_manual --debug
npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua
```

The first command builds the test-capable Node tooling product. The cartridge build automatically resolves or builds its matching BIOS; do not add a separate BIOS build as a prerequisite. It exports `dist/memory_manual.debug.rom` and the matching `dist/system/bmsx-bios.debug.rom` for this route.

The final command runs the supplied integration case. Look for this exact line:

```text
[test] startup_storage_and_scalar_copy: passed
```

The following observation log summarizes the checked values. A missing suite, failed assertion or expired test is a failure, not a successful run with nothing to display.

The case waits for `status.completed` to become one, then checks startup observations, layout, relative addresses, copied scalar fields and padding. Its six expected output words, matching the input words, are:

```text
00000011 12345678 33441122 00000022 9ABCDEF0 77885566
```

These are memory results, not rendered pixels or device-completion status. The other key observations are:

| Item | Hexadecimal value | Meaning |
|---|---|---|
| Initial counter | `12345678` | The initialized DATA value observed before the copy |
| Initial output-word OR | `00000000` | The BSS output words observed as zero before the copy |
| Final counter | `1234567A` | The counter has advanced by two |
| `status.completed` | `00000001` | The program has finished its scalar copy |

The test compiles a derived cartridge containing the integration fixture and the ordinary program entry, and runs the case on a fresh target. It checks the program's storage behavior, not a byte-for-byte playback of the ordinary ROM. Absolute linked addresses need not match between the test image and the ordinary cartridge; no guessed numeric RAM base is needed for this check.

## Run the ordinary cartridge separately

After the cartridge build above, build the player and launch it:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- memory_manual --ttl 2
```

This uses the ordinary `dist/memory_manual.debug.rom` and its debug BIOS, rather than running the assertion suite. `--ttl 2` limits the run to two seconds of the virtual headless host clock; it does not promise two seconds of wall-clock execution.

Expect loading, game-loop and TTL messages, and possibly BIOS boot text—not the six memory words. This program prepares storage and halts; it does not print its results or draw an image. A successful player exit is therefore not a value assertion or visible-output proof. Use the named integration test above to check the memory result.

## Run and inspect the fault probe

The complete probe from [Inspect an actual unmapped load](../book1/memory.md#inspect-an-actual-unmapped-load) is supplied as `carts/memory_fault_manual/entry.lua`. Use this separate `memory_fault_manual` project: do not replace the storage example's entry or run its storage suite against the fault probe. The supplied entry declares `module<entry>`; its filename does not select the entry. Its manifest is `carts/memory_fault_manual/res/manifest/manifest.rommanifest`:

```yaml
title: Memory Fault Manual
hardware:
  - type: rom
```

From the repository root, with the prerequisites above, run these commands in order:

```sh
npm run build:product:browser-player -- --debug
npm run build:toolchain:cart -- memory_fault_manual --debug
npm run serve:dist
```

The cart build exports `dist/memory_fault_manual.debug.rom` and automatically resolves its matching BIOS. Leave the server command running while using the browser. Open this exact URL, including `index.html`:

```text
http://127.0.0.1:8080/index.html?rom=memory_fault_manual.debug.rom
```

Do not shorten it to `/?rom=...`: the root redirect drops the query. The debug page starts automatically, without a “press any key” gate.

Click the page to focus it. The default overscan presentation can crop the monitor's edges, so first select `PICTURE = FIT`. With the current default physical key mappings, tap **Right Ctrl + Right Alt** together and release promptly, in less than 500 ms, to open the menu. Holding the combination for 500 ms enters rewind instead. Use **Up/Down** to select `PICTURE`, **Left/Right** to choose `FIT`, then **Escape** to close the menu.

At the BIOS monitor prompt, type this command with the keyboard and press **Enter**:

```text
MEM 08010208 3
```

The supplied probe produces:

```text
08010208: 00000001 01000000 00000801
```

Next type `FAULT CLEAR` and press **Enter**; this leaves you in the monitor. Then type `CONT` and press **Enter**. The same DBE is displayed again because the load is unchanged: this sequence demonstrates inspection and retry, not successful recovery. Type these monitor commands in the browser, not into the server shell or a headless process's stdin. This browser sequence was checked in Chromium on Linux, not certified across browsers, native players or fresh installations.

## Check the DMA program's results

Use the complete supplied `dma_manual` cart and its assertion suite with the [worked DMA program](../book1/dma.md#worked-blua-program). For a standalone result check, build the test tooling, build that cart, then run its named suite:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- dma_manual --debug
npm run headless:test -- dma_manual tests/carts/dma_manual/dma_manual_assert.lua
```

Look for this exact successful line:

```text
[test] copies_and_separate_gpu_completion: passed
```

The case checks all 60 RAM words and the supplied DMA/GPU completion observations. Its separate pixel readback is not a result retained by the program. A missing suite, failed assertion or expired test is a failure, not successful empty output.

As with the storage check, this integration route compiles a derived cartridge containing the ordinary program entry and the fixture, and runs on a fresh target. It is not byte-for-byte playback of the ordinary ROM, and absolute linked addresses need not match. Use the named check to inspect this supplied program's results without guessing a `MEM` address; it is not a general live-address inspector.

## Check hardware-buffer program results

Use the supplied programs and named checks below to observe their results without guessing RAM addresses. After the tooling build above (`npm run build:product:node-headless-tooling -- --debug`), run each command pair from the repository root. Cart builds handle the matching BIOS automatically.

All three suites compile derived integration images containing the ordinary program entry and fixture, then run on fresh targets. They are not byte-for-byte playback of the ordinary ROM; absolute linked addresses need not match. A missing suite, failed assertion or expired case is not success.

### GEO

Use the [complete GEO program](../book1/geo.md#complete-blua-program):

```sh
npm run build:toolchain:cart -- geo_manual --debug
npm run headless:test -- geo_manual tests/carts/geo_manual/geo_manual_assert.lua
```

Expect:

```text
[test] transforms_sat_contacts_and_fault_ack: passed
```

This checks eight vertices, two AABBs, SAT words, two float contacts and summaries, phase progress, five DONE events, one ERROR event, and local fault acknowledgement—not a drawn picture.

### IMGDEC

Use the [complete IMGDEC program](../book1/imgdec.md#programming-imgdec-in-blua):

```sh
npm run build:toolchain:cart -- imgdec_manual --debug
npm run headless:test -- imgdec_manual tests/carts/imgdec_manual/imgdec_manual_assert.lua
```

Expect:

```text
[test] ram_gp0_fault_and_recovery: passed
```

This checks 26 retained RAM words, phase/progress/DMA/status/IRQ observations, the retained fault header and fresh-START result. Its additional 12 texture and eight CLUT GPUREAD words are separate test observations, not program-retained results or a displayed picture.

### APU

Use the [complete APU program](../book1/apu.md#worked-blua-program):

```sh
npm run build:toolchain:cart -- apu_manual --debug
npm run headless:test -- apu_manual tests/carts/apu_manual/apu_manual_assert.lua
```

Expect:

```text
[test] pcm_transfer_generator_and_badp: passed
```

This checks 16 transfer words and private-RAM roundtrip, separate DMA/APU completion, paused voice state with advancing sample clock, four end events, ended-bank clearing and no faults. It does not establish audible output. These commands were checked in an existing checkout, not fresh-platform certification.

## Check the display-surface program

Use the memory chapter's complete `results` and cartridge entry modules. After the existing tooling build, build the ordinary cartridge and run its result check:

```sh
npm run build:toolchain:cart -- display_manual --debug
npm run headless:test -- display_manual tests/carts/display_manual/display_manual_assert.lua
```

The expected case line is:

```text
[test] publication_and_two_surface_reuse: passed
```

This checks the reported installed BIOS reservation, all four retained pixel words, the A/B/A programmed framebuffer words, phases 1–3, and a changed callback counter at each publication. The matching-BIOS, derived-cartridge, fresh-target and linked-address caveats given above apply here too. These are current-checkout observations, not a fresh-platform installation check.

The three pictures use a separate ordinary-playback route, not captures from that result check:

```sh
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/display_manual/display_manual_demo.json display_manual
```

It captures presentation frames 1, 4 and 7 as `frame_00001.png`, `frame_00004.png` and `frame_00007.png` under `tests/carts/display_manual/screenshots/`: red A, blue B and rebuilt green A. Those are this playback's chosen capture points, not a hardware timing or frame-budget guarantee.

## Check calls, values and text results

Use the complete [BLua call and text program](../book1/memory.md#complete-blua-call-and-text-program). Its two modules retain 35 word observations in a 140-byte result structure; they do not print a transcript.

If recreating the listings, put the result-storage listing in `carts/language_manual/results.lua` and concatenate the two entry parts in order into `carts/language_manual/cart.lua`. The supplied manifest at `carts/language_manual/res/manifest/manifest.rommanifest` contains:

```yaml
title: BLua Values and Byte Storage Manual
hardware:
    - type: rom
```

With the existing headless-tooling prerequisites installed, build that tooling once:

```sh
npm run build:product:node-headless-tooling -- --debug
```

Then build the ordinary cartridge and run its integration case:

```sh
npm run build:toolchain:cart -- language_manual --debug
npm run headless:test -- language_manual tests/carts/language_manual/language_manual_assert.lua
```

The build prepares the matching BIOS automatically. The expected case-result line is:

```text
[test] calls_values_and_utf8_storage: passed
```

The case waits for `completed` to become 1, checks the structure size, and checks all 35 retained word observations against the chapter's result table. It runs on a fresh target with initialized BSS and installed library globals. It compiles a **derived integration image** containing the complete ordinary entry and the assertion fixture; it is not byte-for-byte playback of the ordinary cartridge ROM. Absolute linked addresses can therefore differ between those images.

These commands and the reported result were checked on the current checkout. The system-VRAM result words describe its installed BIOS reservation, not a permanent layout promise. This check establishes the retained results for this headless execution; it does not establish native/backend parity, visible output, arbitrary dynamic-loader equivalence or a complete language-fault recovery contract.

## Check raw input and software edges

The [complete input sampling program](../book1/input.md#complete-input-sampling-program) is supplied as these project files:

- `carts/input_manual/results.lua` — complete 25-line constant result module;
- `carts/input_manual/cart.lua` — complete 62-line cartridge entry;
- `carts/input_manual/res/manifest/manifest.rommanifest` — cartridge manifest;
- `tests/carts/input_manual/input_manual_assert.lua` — retained-result integration check.

The manifest is:

```yaml
title: Input Controller Manual
hardware:
    - type: rom
```

Run the commands from the repository root. If the headless tooling product has not been built, build it first:

```sh
npm run build:product:node-headless-tooling -- --debug
```

Build the cartridge, then run its integration check:

```sh
npm run build:toolchain:cart -- input_manual --debug
npm run headless:test -- input_manual tests/carts/input_manual/input_manual_assert.lua
```

The cartridge build handles its matching BIOS automatically. A successful check prints:

```text
[test] latched_levels_and_software_edges: passed
```

The check starts a fresh target with the ordinary entry plus a fixture in a derived integration image; it is not byte-identical playback of the ordinary cartridge image, and absolute addresses may differ. The fixture controls case-owned keyboard and pad input through the ordinary input sampling path. It does not write the sampled input registers or force a latch.

The retained-result checks cover the 204-byte result layout; initially zero keyboard, pointer, pad and rumble-support observations; a KeyA press with mask `10H`; a held KeyA without a repeated press; separate first-pad A press and release with bit 0; and a KeyA release retaining `last_release = 10H`. The final completed observation has different before/after sample sequences and one KeyA press and release counted.

This checks the specified keyboard/pad levels and software edges. It does not inspect all 51 words at every instant or establish physical attachment timing, pointer calibration, visible output or vibration behavior.

## Build and inspect the GEO docking scene

The [complete docking-scene program](../book1/geo.md#complete-blua-docking-scene-program) is a **separate cartridge**, not an addition to the earlier numeric `geo_manual` entry. Its three complete listings belong in:

```text
carts/geo_scene_manual/
  results.lua
  assets.lua
  cart.lua
  res/manifest/manifest.rommanifest
```

Concatenate each module's printed parts in order into its own file. `results.lua` supplies the typed layouts and BSS; `assets.lua` supplies the complete indexed artwork, palette, hull and records; `cart.lua` declares the sole `module<entry>`. The manifest is:

```yaml
title: GEO Docking Scene Manual
hardware:
  - type: rom
```

With the prerequisites above, build the tooling once, then the supplied cartridge:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- geo_scene_manual --debug
npm run headless:test -- geo_scene_manual tests/carts/geo_scene_manual/geo_scene_manual_assert.lua
```

The cartridge build prepares its matching BIOS automatically. The successful case line is:

```text
[test] three_pose_geometry_and_visible_scene_sequence: passed
```

This fresh-target, derived integration image checks all three transformed hulls and bounds, SAT results, F32 contact and summary values, nine successful pose jobs, the separated return job, separate GEO/VBlank counters, the firmware reservation and six programmed display publications. It also checks that the old contact remains in storage while the return's new result count is zero. It does **not** supply the published images or prove that a programmed framebuffer read is a displayed-picture acknowledgement.

Capture the ordinary cartridge separately:

```sh
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/geo_scene_manual/geo_scene_manual_demo.json geo_scene_manual
```

The existing timeline writes the following actual 256 × 192 PNGs under `tests/carts/geo_scene_manual/screenshots/`:

| File | Expected picture |
|---|---|
| `frame_00004.png` | Local drone, cyan authored hull, gray axes and white pivot |
| `frame_00013.png` | Plain blue/red docking scene, separated |
| `frame_00022.png` | Separated cyan/amber transformed hulls; no result marker |
| `frame_00031.png` | Touching hulls and green SAT direction; no contact or depth bracket |
| `frame_00040.png` | Overlap, green SAT direction, yellow depth bracket, magenta contact normal and white contact cross |
| `frame_00049.png` | Separated return with no stale contact marker; identical to frame 22 in the checked run |

Those are observed capture points in this ordinary playback, not guest callback-counter values or a hardware latency guarantee. The eight-VBlank holds are the demonstration's chosen cadence. The retained-result check and these ordinary software-rendered captures are separate evidence; neither certifies native guest execution, accelerated rendering or a physical frame budget.

## Build and inspect formatted text

The [complete formatting program](../book1/bios-string.md#complete-program-formatted-text)
is a separate cartridge, not an addition to the earlier codepoint/UTF-8 entry.
Create:

```text
carts/bios_format_manual/
  results.lua
  cart.lua
  res/manifest/manifest.rommanifest
```

Save **Formatting result storage** as `results.lua`. Concatenate **Formatting
entry, part 1**, **part 2** and **part 3** in that order as `cart.lua`, separating
adjacent parts with one blank line and adding no other module declaration.
These are the complete 27-line result module
and 69-line entry; `require('results')` resolves the former. Use this entire
manifest:

```yaml
title: BIOS String Formatting Manual
hardware:
    - type: rom
```

The two modules and manifest suffice for the ordinary cartridge. There is no
external asset, cartridge BIOS import, buffer allocation step or local formatting
helper. With the development prerequisites above, run from the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_format_manual --debug
npm run headless:test -- bios_format_manual tests/carts/bios_format_manual/bios_format_manual_assert.lua
```

The validated cart build checks the actual source and prepares the matching
BIOS automatically. Expect `[test] formatted_text: passed`. The case waits for
completion and checks 18 retained fields/relations, including both zero
codepoints emitted by the installed `%c`. The test source is a debug-only suite,
not another gameplay module to append to the printed entry. Its fresh derived
integration image is not byte-identical ordinary playback or native execution.

The additional debug-only unit suite is:

```sh
npm run headless:test -- bios_format_manual tests/carts/bios_format_manual/format_char_assert.lua
```

Expect `[test] format_char_call_results: passed`. It checks the specific 0,
65, 65.75 and width 3 `%c` cases, direct `char` versus the grouped `modf` call,
and grouped/ungrouped result counts. It does not certify every numeric input
or source-compilation route.

For independent ordinary output, save this as
`tests/carts/bios_format_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BIOS String formatting retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_format_manual/ordinary_timeline.json bios_format_manual
```

The command explicitly selects the debug cartridge built above and uses the
script’s debug BIOS.
After startup, compare the eight `Format ...` lines with the chapter's
**Formatting observations** output. Brackets expose padding spaces, and the
quoted result contains visible escapes. The `%c` observation is printed as
numeric length 2 and codepoints 0,0, not an invisible display claim. The timeline’s
`frame: 4` is the chosen zero-based presentation offset, not an elapsed-frame,
startup-time or cycle guarantee.
The original common Table-length and CPU/compiler questions remain open; a
passing example does not resolve the helper-Table paths or arbitrary resource
limits.

## Build and inspect pattern searches

The [complete pattern program](../book1/bios-string.md#complete-program-patterns-and-substitutions)
is a separate cartridge, not an addition to the base or formatting entries.
Create:

```text
carts/bios_pattern_manual/
  results.lua
  cart.lua
  res/manifest/manifest.rommanifest
```

Save **Pattern result storage** as `results.lua`. Join the five **Pattern entry**
parts in order as `cart.lua`, with one blank line between adjacent parts. The
complete result module has 47 lines; the complete entry has 122. Only that entry
starts with `module<entry>`; `require('results')` resolves the result module.
The complete manifest is:

```yaml
title: BIOS String Patterns Manual
hardware:
    - type: rom
```

These two modules and manifest supply the ordinary cartridge. They use the
installed BIOS and need no external asset or local matcher. From the repository
root, with the prerequisites above:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_pattern_manual --debug
npm run headless:test -- bios_pattern_manual tests/carts/bios_pattern_manual/bios_pattern_manual_assert.lua
```

The validated cart build runs lint/type checking and prepares the matching BIOS.
The supplied debug-only test waits for completion, then checks 40 assertions.
Expect `[test] pattern_operations: passed`. The test suite is not another
cartridge entry; do not append it to the printed program. Its fresh derived
integration image is separate from ordinary playback and does not prove native
execution or every pattern/capture/output path.

For independent ordinary observations, create
`tests/carts/bios_pattern_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BIOS String patterns retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_pattern_manual/ordinary_timeline.json bios_pattern_manual
```

The command selects the debug cartridge and BIOS. Compare all 13 diagnostic
lines with **Pattern observations** in the chapter, including the final
standalone replacement-error payload. The timeline only chooses an observation
endpoint; it does not itself assert the printed values. Its `frame: 4` is a
zero-based presentation offset, not an elapsed-frame, startup-time or cycle
promise. The common Table-length and existing CPU/compiler questions remain
open despite these successful examples.

## Build and inspect packed records

The [complete packing program](../book1/bios-string.md#complete-program-a-packed-record)
is another separate cartridge. Do not combine its entry or its independently
named result layout with the earlier examples. Create:

```text
carts/bios_pack_manual/
  results.lua
  cart.lua
  res/manifest/manifest.rommanifest
```

Save **Packing result storage** as `results.lua`. Join the five **Packing entry**
parts in order as `cart.lua`, placing one blank line between adjacent parts.
These are the complete 42-line result module and 117-line entry, with no omitted
library implementation or setup prelude. Use this complete manifest:

```yaml
title: BIOS Binary Packing Manual
hardware:
    - type: rom
```

From the repository root, with the same development prerequisites:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_pack_manual --debug
npm run headless:test -- bios_pack_manual tests/carts/bios_pack_manual/bios_pack_manual_assert.lua
```

Expect `[test] binary_records: passed`. The supplied debug-only test waits for
completion, then checks 33 assertions: the full packet comparison, decoded
fields, absolute continuation positions, padding, embedded-zero/fixed text,
codepoint-versus-octet distinction and three reached errors. The cartridge does
not allocate a mapped packet buffer; the packet is a String. These tests do not
establish a String-to-byte-storage ABI, exhaustive float interchange, native
execution or arbitrary-size completion.

For independent ordinary diagnostics, create
`tests/carts/bios_pack_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BIOS binary packing retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_pack_manual/ordinary_timeline.json bios_pack_manual
```

Compare the eight `Pack ...` lines with **Packing observations**. The ordinary
run is not the retained-result test, and the timeline does not assert those
values. The final three lines deliberately report protected errors. Again,
`frame: 4` is the selected zero-based presentation offset, not a hardware latency
guarantee. The common Table-length and existing CPU/compiler questions remain
open.
