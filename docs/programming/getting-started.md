# Build and inspect example cartridges

Begin with a visible result: build and run the supplied GPU cartridge below.
It draws a static scene from ordinary BLua source; an assertion suite is not
required to see it. Then use the hardware-operation links to choose what to
program next.

The later storage route uses the two listings in the
[worked storage example](../book1/memory.md#worked-example-prepare-and-copy-two-records):
build `memory_manual`, check its storage result, then run ordinary headless
playback separately. Other sections cover the named cartridges, including
[modules and globals](#build-and-inspect-modules-and-globals). These examples
are independent, not a sequence of prerequisite builds. This guide describes
the supplied checkout; it is not a complete SDK installation or debugging guide.

## Prerequisites

Run the commands from the BMSX repository root in a POSIX shell, such as the Linux/WSL environment used for this route. Have Node.js 22 or later, npm and the repository's development dependencies installed. The repository setup command is:

```sh
npm install -D
```

A working native `canvas` binding is required by these builds, even though the
memory example contains no images. These instructions assume a working
checkout with its dependencies available; they are not a fresh-installation
procedure for every operating system.

## First picture: build and run the GPU example

The complete source is `carts/gpu_manual/cart.lua`, corresponding to
[Program a complete picture in BLua](../book1/gpu.md#program-a-complete-picture-in-blua).
Its manifest is supplied at
`carts/gpu_manual/res/manifest/manifest.rommanifest`. Texture pixels, palette
colors, packed indices and command packets are declared in the source; no
external image preparation is required for this example.

From the repository root, run:

```sh
npm run build:product:browser-player -- --debug
npm run build:toolchain:cart -- gpu_manual --debug
npm run serve:dist
```

The player build supplies `dist/index.html` and `dist/engine.debug.js`.
The cartridge build exports `dist/gpu_manual.debug.rom` and its matching
`dist/system/bmsx-bios.debug.rom`; it resolves or builds that BIOS automatically.
Do not add a separate BIOS or host-tools build to this route.

Leave the server running and open this exact URL in a browser:

```text
http://127.0.0.1:8080/index.html?rom=gpu_manual.debug.rom
```

Keep the `index.html` path and `rom` parameter: the generic player does not
select this cartridge by itself. The debug player starts automatically; the
picture does not require the ordinary “Press any key” gate or an audio-unlock
keypress.

### Expected static scene

After boot, look for two large textured quads and an RGB-gradient triangle
above overlapping rectangles, with a colored indexed strip along the bottom.
The small marks near the left are intentional readback and unscaled-texture
witnesses. The cartridge finishes drawing and sleeps; it is not an animated
game or a frame-loop template.

![GPU example reference picture, with textured quads, gradient triangle, rectangle overlaps and an indexed strip](../book1/figures/gpu-output-materials.png)

This is the existing [GPU output plate](../book1/gpu.md#gpu-output-plate), whose
legend explains the regions. Running the ordinary ROM shows the picture;
it does not run the retained-value assertion suite. The memory-result and
other inspection routes below remain separate.

### Show the whole frame

The player defaults to overscan, which can crop the picture's edges. To compare
the whole frame, click the page to focus it and select `PICTURE = FIT`.
Tap **Right Ctrl + Right Alt** together and release in less than 500 ms to open
the menu. Use **Up/Down** to select `PICTURE`, **Left/Right** to choose `FIT`,
then **Escape** to close the menu. Holding the combination for 500 ms requests
rewind instead. These are player controls, not cartridge input code.

## Find the hardware operation

With the first picture running, use the task below to choose your next
programming route. These links lead to explanations and worked sequences,
rather than register inventories. Start with the operation you need; follow
its chapter's register reference for individual fields.

| What you want to do | Where to continue |
|---|---|
| Establish memory ownership and startup | Read [ROM contents, RAM sections, and startup](../book1/memory.md#rom-contents-ram-sections-and-startup), then [Taking ownership after the BIOS](../book1/memory.md#taking-ownership-after-the-bios) before assigning storage. |
| Draw, upload pixels, or use textures | Extend [Program a complete picture in BLua](../book1/gpu.md#program-a-complete-picture-in-blua) through [Upload and issue the stream](../book1/gpu.md#upload-and-issue-the-stream-through-one-port) and [Locate texture texels and palette colors](../book1/gpu.md#locate-texture-texels-and-palette-colors). |
| Control display timing and source windows | Read [Beam timing](../book1/pcrtc.md#27-beam-timing), then [Program the fixed canvas and initial cutout](../book1/pcrtc.md#program-the-fixed-canvas-and-initial-cutout) for the source-selection route. |
| Transform and project 3D geometry | Begin with [Constructing and packing a transform](../book1/gte.md#constructing-and-packing-a-transform); continue through [Perspective and geometric decisions](../book1/gte.md#perspective-and-geometric-decisions) to [a visible image](../book1/gte.md#from-projected-vertices-to-a-visible-image). |
| Transform 2D shapes and test contacts | Follow [An authored sprite and its collision hull](../book1/geo.md#an-authored-sprite-and-its-collision-hull), then [Launching and observing a job](../book1/geo.md#launching-and-observing-a-job). |
| Transfer data and observe completion | Follow [Program a transfer](../book1/dma.md#program-a-transfer) together with [Completion and interrupts](../book1/dma.md#completion-and-interrupts). |
| Play sound and manage sample storage | Start with the APU [Programming sequence](../book1/apu.md#programming-sequence), then [Voice sources and their lifetime](../book1/apu.md#voice-sources-and-their-lifetime) and [Sample RAM transfer](../book1/apu.md#sample-ram-transfer). |
| Read input and service interrupts | Follow the [Complete input sampling program](../book1/input.md#complete-input-sampling-program), [Choose one cartridge dispatch route](../book1/irq.md#choose-one-cartridge-dispatch-route), and [Acknowledge the source and the controller separately](../book1/irq.md#acknowledge-the-source-and-the-controller-separately). |

The [System overview](../book1/console.md) relates the units and storage. For
source notation, read the [BLua extensions](../book1/blua-programs.md#blua-extensions)
rather than treating the hardware examples as ordinary Lua.

## Put the files in their roles

The following storage route uses the separate `memory_manual` project. The repository supplies these example files, including the assertion suite. If recreating the worked storage example's two program listings, put the storage listing in `storage.lua` and the entry listing in `cart.lua` at these exact locations:

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

Click the page to focus it. The default overscan presentation can crop the
monitor's edges, so [show the whole frame](#show-the-whole-frame) with
`PICTURE = FIT` before inspecting the diagnostic text.

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

This checks 26 retained RAM words, phase/progress/DMA/status/IRQ observations,
the retained fault header and fresh-START result. It captures the actual
[decoded indexed patch](../book1/imgdec.md#imgdec-indexed-output) at
`tests/carts/imgdec_manual/screenshots/frame_00001.png`, full 256 × 192.
The six source rows form red/transparent/blue/green and gray/white patterns,
followed by two transparent rows retaining the purple destination.

All twelve texture and eight CLUT GPUREAD words are still checked. Six complete
120-pixel picture rows add 360 packed words; one outside-background word makes
381 raw GPUREAD comparisons in total. These are separate test observations,
not program-retained results or complete raw readback of the entire display.
Capture precedes the readback probes.

The captured run uses a derived integration image. For separate ordinary-ROM playback:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- imgdec_manual --ttl 2
```

TTL 2 is 2000 ms of virtual host time, not picture verification. No native or
accelerated-backend parity, physical throughput or fixed IRQ latency follows.

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

#### Listen to the ordinary APU cartridge

The numeric headless check above runs assertions in a derived test cartridge; it does not demonstrate audible output. For ordinary ROM playback, build the existing `apu_manual` cart and non-debug browser player from the repository root:

```sh
npm run build:product:browser-player
npm run build:toolchain:cart -- apu_manual
```

Reuse the already-running `dist` server on port 8080; do not start a duplicate. Only when starting from scratch, run:

```sh
npm run serve:dist
```

Open **http://127.0.0.1:8080/index.html?rom=apu_manual.rom**. Keep `index.html` in the URL: the server's root redirect drops the query. Wait for “Press any key, button or touch screen to start...”, then **press and release a keyboard key**, or **finish a screen touch**. This non-debug startup awaits audio resume before creating the guest runtime.

Expect this short sequence:

| Phase | Expected sound |
| --- | --- |
| ROM PCM sine | Brief 440 Hz sine, brief silent pause, resumed sine, then fade-out. |
| Private-RAM PCM | The same PCM waveform, briefly played and faded after its RAM transfer exercise. |
| Square generator | Brief 440 Hz square-wave timbre, brighter than the sine, then fade-out. |
| Packed asset | The authored `tone.wav` one-shot, then silence as the cart halts. |

These are very short, once-per-boot events, not multi-second stages: the authored waits are 50 ms and fades 10 ms at the 44,100-frame/s machine output clock, not guaranteed wall-clock durations. Transfers and command processing can add gaps. Negative gain reverses polarity; it does not change pitch or promise an audible distinction.

Debug playback can produce sound, but debug startup runs the guest automatically without waiting for the audio-unlock interaction. A late click, key release, or touch end can therefore miss the initial short sequence. Use the non-debug gate above when checking all four phases. This route is not proof of playback on every browser, device, or speaker.

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

This checks the reported installed BIOS reservation, all four retained pixel words, the A/B/A programd framebuffer words, phases 1–3, and a changed callback counter at each publication. The matching-BIOS, derived-cartridge, fresh-target and linked-address caveats given above apply here too. These are current-checkout observations, not a fresh-platform installation check.

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

This fresh-target, derived integration image checks all three transformed hulls and bounds, SAT results, F32 contact and summary values, nine successful pose jobs, the separated return job, separate GEO/VBlank counters, the firmware reservation and six programd display publications. It also checks that the old contact remains in storage while the return's new result count is zero. It does **not** supply the published images or prove that a programd framebuffer read is a displayed-picture acknowledgement.

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

## Build and inspect modules and globals

The [complete modular program](../book1/blua-programs.md#complete-program-modules-and-ordinary-globals)
is a separate cartridge. Save the six complete listings at these exact paths:

```text
carts/modules_manual/
  entry.lua
  results.lua
  lib/settings.lua
  lib/counter.lua
  lib/false_export.lua
  lib/nil_export.lua
  res/manifest/manifest.rommanifest
```

Use this complete manifest:

```yaml
title: BLua Modules Manual
hardware:
    - type: rom
```

`entry.lua` is selected by its `module<entry>` declaration, not its filename.
The literal `lib/` imports use the corresponding nested source files. Do not
add another entry or combine these independently named modules with another
example. Start this program through a fresh BIOS boot; its observations are not
a promise that executing an image again clears a retained global environment.

From the repository root, with the prerequisites above:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- modules_manual --debug
npm run headless:test -- modules_manual tests/carts/modules_manual/modules_manual_assert.lua
```

Expect `[test] modules_and_globals: passed`. The force-validation build includes
normal system/cartridge compilation and quality checks and selects the matching
BIOS. The supplied debug-only test waits for completion, then checks 19 retained
observations: pre-entry constructor counts, shared module identity and state,
false/nil exports, and ordinary global changes versus a same-named lexical local.
It runs a derived integration image on a fresh target, not byte-for-byte playback
of the ordinary ROM. Linked addresses can differ; no guessed `MEM` address is
required.

For separate ordinary playback, create
`tests/carts/modules_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BLua module observations retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/modules_manual/ordinary_timeline.json modules_manual
```

Compare all five `Modules ...` lines with **Observations** in the chapter.
The timeline selects zero-based presentation offset 4, not an elapsed startup,
frame or cycle guarantee, and does not assert the printed values. The retained
checks and ordinary diagnostics are separate TS executions, not native proof,
exhaustive module-graph/lifetime guarantees, fresh-OS/whole-SDK acceptance or
validation of the separate BIOS runtime source compiler.

## Build and inspect numeric loops

The [complete numeric-loop program](../book1/blua-programs.md#complete-program-numeric-loop-control)
is its own cartridge, not an extra entry in `modules_manual`. Save the storage
listing as `results.lua` and concatenate the three entry parts in order as
`entry.lua` at these exact paths:

```text
carts/loops_manual/
  entry.lua
  results.lua
  res/manifest/manifest.rommanifest
```

Use this complete manifest:

```yaml
title: BLua Numeric Loops Manual
hardware:
    - type: rom
```

From the repository root with the shared prerequisites above:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- loops_manual --debug
npm run headless:test -- loops_manual tests/carts/loops_manual/loops_manual_assert.lua
```

Expect `[test] numeric_loop_control: passed`. The supplied suite waits for
completion and checks sixteen retained observations. It runs a fresh derived
integration image, not byte-for-byte ordinary playback; linked addresses can
differ. The builder selects the matching BIOS. No earlier example cartridge is
a prerequisite.

For separate ordinary playback, create
`tests/carts/loops_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BLua numeric loop observations retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/loops_manual/ordinary_timeline.json loops_manual
```

Compare all six `Loops ...` lines with **Numeric-loop observations**. The
zero-step cases that enter use explicit breaks; the ordinary result is not an
assertion that zero step eventually advances the index. The timeline chooses
zero-based presentation offset 4, not startup/frame/cycle latency, and does not
assert output values. The retained checks and ordinary run are separate TS
executions, not native or all-Number/NaN/infinite termination proof, a separate
BIOS runtime-parser contract, or whole-SDK/whole-console acceptance.

## Build and inspect generic iteration

The [complete generic-iteration program](../book1/blua-programs.md#complete-program-generic-iteration)
is a separate cartridge. Save its two complete listings at these exact paths;
do not combine its entry or `results` module with the other examples:

```text
carts/iterators_manual/
  entry.lua
  results.lua
  res/manifest/manifest.rommanifest
```

Use this complete manifest:

```yaml
title: BLua Iterators Manual
hardware:
    - type: rom
```

From the repository root with the shared prerequisites above:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- iterators_manual --debug
npm run headless:test -- iterators_manual tests/carts/iterators_manual/iterators_manual_assert.lua
```

Expect `[test] generic_iteration_control: passed`. Ten retained assertions
follow the completion wait on a fresh derived integration target, not the
byte-identical ordinary ROM. The builder selects the matching BIOS; absolute
linked addresses can differ. No earlier example cartridge is a prerequisite.

For separate ordinary playback, create
`tests/carts/iterators_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BLua iterator observations retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/iterators_manual/ordinary_timeline.json iterators_manual
```

Compare all three `Iter ...` lines with **Iterator observations**. False and
nil are deliberately distinct, as are the visible variable and hidden control.
The timeline's zero-based presentation offset 4 is an endpoint, not a
startup/frame/cycle guarantee or an assertion. Retained checks and ordinary
playback are separate TS executions, not native, all-input/iterator/optimizer,
Table-length or separate BIOS runtime-parser acceptance. CPU7, Table length,
BZ01 and the repeat-scope issue remain open.

## Build and inspect Math operations

The [complete Math program](../book1/bios-math.md#complete-program-math-operations)
is a separate `bios_math_manual` cartridge. Its results listing and five entry
parts supply two complete source files. Save `results.lua` and concatenate
entry parts 1–5, in order, as one `entry.lua` at these exact paths:

```text
carts/bios_math_manual/
  entry.lua
  results.lua
  res/manifest/manifest.rommanifest
```

Use this complete manifest:

```yaml
title: BIOS Math Manual
hardware:
    - type: rom
```

No earlier example cartridge is a prerequisite. The program uses the
installed library without replacing its fields, uses explicit seeds rather
than the clock default, and uses `//1` instead of the cart-forbidden
`math.floor` reference. See the source-program chapter's
[known-call argument diagnostics](../book1/blua-programs.md#known-call-argument-diagnostics)
for source minimums versus reached-call behavior.

From the repository root with the shared prerequisites above:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_math_manual --debug
npm run headless:test -- bios_math_manual tests/carts/bios_math_manual/bios_math_manual_assert.lua
```

Expect `[test] math_observations: passed`. The supplied suite waits for
completion and checks 84 retained observations; it is a fresh derived
integration image, not byte-identical ordinary playback. The builder selects
the matching BIOS, and absolute linked addresses may differ.

For a separate ordinary run, create
`tests/carts/bios_math_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BIOS math observations retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_math_manual/ordinary_timeline.json bios_math_manual
```

Compare all 24 `Math ...` lines in **Ordinary observations**. Rounded Number
text is not a substitute for the exact retained f64 checks. The timeline
selects zero-based presentation offset 4, not an output assertion or a
startup/frame/cycle guarantee. Retained and ordinary results are separate TS
executions, not native or all-input/optimizer/accuracy/statistical,
reset/persistence, runtime-parser, whole-SDK or whole-console acceptance.
CPU7, Table length, BZ01 and LS01 remain open.


## Build and inspect time and calendar operations

The [complete time/calendar program](../book1/bios-os.md#complete-program-time-and-calendar-operations)
is a separate `bios_os_manual` cartridge. Save the results listing as
`results.lua` and concatenate entry parts 1–5, in order, as one `entry.lua`:

```text
carts/bios_os_manual/
  entry.lua
  results.lua
  res/manifest/manifest.rommanifest
```

The complete manifest is:

```yaml
title: BIOS OS Manual
hardware:
    - type: rom
```

The ordinary results module exports typed numeric BSS and a mutable guest
observations Table. Do not add `module<const>`: that Table is not a compile-
time constant export. The entry has one `module<entry>`, calls the installed
BIOS, records/prints its observations, sets `completed`, then parks.

From the repository root after the prerequisites at the beginning of this
companion, build the tooling and cartridge with the existing quality checks:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_os_manual --debug
npm run headless:test -- bios_os_manual tests/carts/bios_os_manual/bios_os_manual_assert.lua
```

Expect `[test] time_and_calendar_observations: passed`. The supplied suite
waits for completion and checks 74 retained observations. This is a fresh
derived TS integration image, not byte-identical ordinary playback; linked
addresses may differ, and the builder selects the matching BIOS.

For separate ordinary playback, the supplied
`tests/carts/bios_os_manual/ordinary_timeline.json` is exactly:

```json
[
  {
    "frame": 4,
    "description": "BIOS time and calendar observations retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_os_manual/ordinary_timeline.json bios_os_manual
```

Compare all 26 `OS ...` diagnostics in **Ordinary observations**. The first two
lines are a recorded sample, not exact replay values: each default-time call
samples independently. The other 24 diagnostics use explicit inputs; the
`%n` example additionally prints the continuation line `C`. The exact retained
normalized timestamp is 1709168523, although ordinary Number text rounds it to
`1.70917e+09`. Printed text is not a substitute for the retained f64 checks.

The timeline's zero-based presentation offset 4 is an endpoint, not an output
assertion or startup/frame/cycle guarantee. Leading-`!` and Table-valued formats
are not exercised; the common Table-length publication question remains open.
These finite retained and ordinary TS executions are not native/all-input/
optimizer/calendar-accuracy, performance, reset/persistence, runtime-parser,
whole-SDK or whole-console acceptance. CPU7, BZ01 and LS01 are not resolved.


## Development invocation of `<init>`

IDE Hot Resume explicitly prepares calls to selected cartridge or system
`initFunctionAddress` vectors, omitting zero addresses. When media was rebuilt,
it installs the revision before beginning the prepared completion calls in their
selected execution domains. Initial selection includes the active cartridge when
source-edited or when resuming without rebuilt media, and the system for a system
source edit. This is a specific development route, not automatic invocation on
every image replacement. Normal startup still omits the participant vector;
`<init>` declarations register closures without calling their bodies.

See the [BLua participant reference](../book1/blua-programs.md#init-registers-a-participant-it-does-not-call-it-at-startup)
for the declaration restrictions and explicit ordinary-startup call. This bounded
route description is not a guarantee about every source edit, replacement,
reset or IDE scheduling state.

## Trace selection in the supplied build routes

The [BLua extension reference](../book1/blua-programs.md#intrinsic-calls-blua32)
describes `blua32.trace` and `blua32.trace_sink`. Their selection is a compilation
choice, not a switch that a running cartridge can use to restore erased code.

The ordinary cartridge builder defaults to erasing these statements. Its
current command-line options do not expose a trace-channel selection switch;
`--debug` does not supply one. Do not expect the tracing fragment to record
anything merely because it appears in a debug cartridge's source.

The compilation interface supports `traceStatements` set to `'erase'`, `'emit'`,
or an array of exact channel names. That interface setting is not an additional
BLua statement or an advertised cartridge-builder command-line option.
The existing derived integration-image producer selects `'emit'`. A tracing
observation on that route therefore does not establish tracing in the ordinary
ROM. Keep those build routes distinct when comparing results.

Ordinary-ROM selection is an outstanding tool-interface item, recorded in the
[technical follow-up](../manual/technical-follow-up.md#blua-extension-reference-and-current-tool-boundaries).
The source forms remain documented, including their erasure and evaluation
rules; no undocumented flag or replacement build wrapper is required here.

## Build and inspect runtime compilation

The [complete runtime-compilation program](../book1/bios-loader.md#complete-program-runtime-compilation)
is a separate `bios_loader_manual` cartridge. Save its results listing as
`results.lua` and concatenate entry parts 1–4 as one `entry.lua`:

```text
carts/bios_loader_manual/
  entry.lua
  results.lua
  res/manifest/manifest.rommanifest
```

The complete manifest is:

```yaml
title: BIOS Loader Manual
hardware:
    - type: rom
```

The results module is ordinary, not `module<const>`: it exports numeric typed
BSS and a mutable observations Table. The entry has one `module<entry>`;
closures, environments, binding descriptors and error values remain guest
values. It prints observations, sets `completed`, then parks.

From the repository root after this companion's development prerequisites:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- bios_loader_manual --debug
npm run headless:test -- bios_loader_manual tests/carts/bios_loader_manual/bios_loader_manual_assert.lua
```

Expect `[test] runtime_compilation: passed`. The supplied integration suite
waits for completion and checks 38 retained assertions. Its fresh derived TS
image is not byte-identical ordinary playback; linked addresses may differ.
The normal quality checks remain enabled and the builder selects the BIOS.

For separate ordinary playback, the supplied
`tests/carts/bios_loader_manual/ordinary_timeline.json` is exactly:

```json
[
  {
    "frame": 8,
    "description": "BIOS runtime compiler observations retained"
  }
]
```

Run:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_loader_manual/ordinary_timeline.json bios_loader_manual
```

Compare all 13 `Load ...` diagnostics in **Observed results**, then timeline
completion. Raw `print` separators are tabs; the public chapter renders each
as one space. Offset 8 is a zero-based presentation endpoint, not an assertion
or a compilation/startup/frame/cycle guarantee. The self-owned external scope
is not a fabricated selected-frame descriptor. No forced collection, code
reuse/exhaustion, reset/snapshot, native/all-input/optimizer, fresh installation,
SDK or whole-console acceptance follows from these finite executions. The
common Table-length dependency and dynamic unary-& lowering hole remain open.

## Build and inspect GTE depth cue

Use the complete [two-stage GTE color program](../book1/gte.md#gte-depth-cue-output).
Put its two modules in `carts/gte_cue_manual/cart.lua` and
`carts/gte_cue_manual/results.lua`, and its manifest in
`carts/gte_cue_manual/res/manifest/manifest.rommanifest`. The supplied assertion
suite and capture timeline are in `tests/carts/gte_cue_manual/`; keep those files
present before building the debug cartridge. No earlier example cartridge is a
prerequisite. With the [checkout prerequisites](#prerequisites), run from the
repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_cue_manual --debug
npm run headless:test -- gte_cue_manual tests/carts/gte_cue_manual/gte_cue_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/gte_cue_manual/gte_cue_manual_demo.json gte_cue_manual
```

The cartridge build exports `dist/gte_cue_manual.debug.rom` and its matching
`dist/system/bmsx-bios.debug.rom`. The supplied integration case reports:

```text
[test] depth_cue_and_display_words: passed
```

That case checks all four depth IR0/RGB2/FLAG rows, all three NCS/NCCS
lighting/material rows, raw probes of both surfaces, retained first-image
probes, firmware exclusion and both fresh VBlank observations. The final command
separately runs the ordinary ROM and captures two native 256×192 images in
`tests/carts/gte_cue_manual/screenshots/`: `frame_00001.png` is the four-depth
comparison; `frame_00004.png` is unmodulated lighting, material A and material B.
Those selected frames are not fixed hardware-latency guarantees. One shared
setup produces both images, with the first still selected while drawing the
second elsewhere in local memory. Displayed GX16 RGB differs from retained GTE
eight-bit results; compare the calculation and display tables rather than
replacing one with the other. This route was checked in the working checkout,
not on every OS or a fresh SDK installation.

## Build and inspect GTE near-plane clipping

Use the complete [near-plane image program](../book1/gte.md#gte-near-plane-output).
Put its two modules in `carts/gte_clip_manual/cart.lua` and
`carts/gte_clip_manual/results.lua`, and its manifest in
`carts/gte_clip_manual/res/manifest/manifest.rommanifest`. Keep the supplied
assertion and timeline in `tests/carts/gte_clip_manual/` before the debug build.
No earlier example cartridge is needed. With the [checkout prerequisites](#prerequisites),
run from the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gte_clip_manual --debug
npm run headless:test -- gte_clip_manual tests/carts/gte_clip_manual/gte_clip_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/gte_clip_manual/gte_clip_manual_demo.json gte_clip_manual
```

The build exports `dist/gte_clip_manual.debug.rom` and its matching
`dist/system/bmsx-bios.debug.rom`. The supplied case reports:

```text
[test] near_plane_geometry_and_display: passed
```

It checks the constructed raw D/B/C/E records, every retained SXY/SZ/FLAG/IR0
row, nominal RTPT CYCLES, separately saved NCLIP areas/flags, raw image probes,
firmware exclusion and both fresh VBlank observations. The last command
separately runs the ordinary ROM and saves two native 256×192 captures under
`tests/carts/gte_clip_manual/screenshots/`: `frame_00001.png` shows the unchanged
ABC triangle; `frame_00004.png` shows the constructed DBC/DCE trapezoid.

One setup supplies both pictures. The first remains selected while the second
is drawn into a separate raw surface, and neither is subsequently reused.
Projection FLAG does not automatically remove geometry; the example deliberately
submits ABC as well as the clipped triangles. The selected frame numbers are
observation checkpoints, not fixed hardware latency. Source numeric coordinates,
raw typed transfer records and displayed GX16 color are distinct. This route
was checked in the working checkout, not on every OS or a fresh SDK installation.

## Build and inspect GPU dithering

The [complete dither comparison](../book1/gpu.md#gpu-dither-output) is a separate
cartridge at `carts/gpu_dither_manual/cart.lua`, not an addition to the earlier
GPU program. Its manifest at
`carts/gpu_dither_manual/res/manifest/manifest.rommanifest` is:

```yaml
title: GPU Dither Manual Example
hardware:
    - type: rom
```

From the repository root, build the tooling, build the cartridge and run its check:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gpu_dither_manual --debug
npm run headless:test -- gpu_dither_manual tests/carts/gpu_dither_manual/gpu_dither_manual_assert.lua
```

Expect `[test] polygon_dither_and_rectangle_controls: passed`. The check captures
the full 256 × 192 output at
`tests/carts/gpu_dither_manual/screenshots/frame_00001.png`: only the upper-right
quad has a dither pattern; the other three regions have the same uniform colour.
It then compares forty packed GPUREAD words from five 4 × 4 blocks: each panel's
origin and the texture source. The displayed image and raw words are separate checks.

This is a derived integration image containing the ordinary entry and fixture,
not byte-identical playback of the ordinary ROM. For separate ordinary playback:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- gpu_dither_manual --ttl 2
```

TTL 2 means 2000 ms of virtual host time. Reaching it alone does not validate
the picture. Neither route establishes native or accelerated-backend parity.

## Build and inspect GPU shared edges

The [shared-edge and joint comparison](../book1/gpu.md#gpu-coverage-output)
has a complete standalone program at `carts/gpu_coverage_manual/cart.lua`.
Its manifest at
`carts/gpu_coverage_manual/res/manifest/manifest.rommanifest` is:

```yaml
title: GPU Coverage Manual Example
hardware:
    - type: rom
```

With the same prerequisites, run from the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- gpu_coverage_manual --debug
npm run headless:test -- gpu_coverage_manual tests/carts/gpu_coverage_manual/gpu_coverage_manual_assert.lua
```

Expect `[test] shared_polygon_edge_and_polyline_joint: passed` and the full
256 × 192 capture at
`tests/carts/gpu_coverage_manual/screenshots/frame_00001.png`. The upper-left
quad is uniform; the upper-right has a brighter overlap wedge and uncovered
black; the lower band has a bright vertical joint. The check captures before
probing twelve complete 96-pixel quad rows and one 97-pixel polyline row:
625 packed GPUREAD words, including the zero high half of the odd final word.
These raw checks sample specified rows, not every pixel of the picture.

This capture uses a derived integration image. For separate ordinary-ROM playback:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- gpu_coverage_manual --ttl 2
```

The virtual 2000-ms TTL is not picture verification. Native/accelerated parity
and physical throughput are not established by these routes.

## Build and inspect PCRTC composition

Use the complete [composition program](../book1/pcrtc.md#pcrtc-composition-output).
Put its two modules in `carts/pcrtc_mix_manual/cart.lua` and
`carts/pcrtc_mix_manual/results.lua`, and its manifest in
`carts/pcrtc_mix_manual/res/manifest/manifest.rommanifest`. Keep the supplied
assertion and timeline in `tests/carts/pcrtc_mix_manual/` before the debug build.
No earlier example cartridge is needed. With the [checkout prerequisites](#prerequisites),
run from the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- pcrtc_mix_manual --debug
npm run headless:test -- pcrtc_mix_manual tests/carts/pcrtc_mix_manual/pcrtc_mix_manual_assert.lua
npm run headless:tooling -- --debug --ttl 5 --input-timeline tests/carts/pcrtc_mix_manual/pcrtc_mix_manual_demo.json pcrtc_mix_manual
```

The build exports `dist/pcrtc_mix_manual.debug.rom` and its matching
`dist/system/bmsx-bios.debug.rom`. The supplied case reports:

```text
[test] composition_words_and_source_lifetime: passed
```

It checks the four programmed PMODE words, raw source probes, unchanged
framebuffer/source/window/background words, firmware exclusion and four fresh
VBlank observations. Those are register/source observations, not readback of
composed output. The last command separately runs the ordinary ROM and saves
four unscaled 256 × 192 images under `tests/carts/pcrtc_mix_manual/screenshots/`:
`frame_00001.png` is A (constant coefficient), `frame_00004.png` B (source
alpha), `frame_00007.png` C (background) and `frame_00010.png` D (circuit-2
output alpha). D has the same RGB image as B; these opaque PNGs cannot verify
output alpha. That independent channel is specified in the chapter's table,
not inferred from screenshot transparency.

One setup and two immutable sources supply all four phases. The selected frame
numbers and holds are observation checkpoints, not fixed hardware latency.
This route was checked in the working checkout, not on every OS or a fresh SDK
installation.


## Build and inspect APU downloads

Use the complete [APU download program](../book1/apu.md#apu-download-budget).
Put its two modules in `carts/apu_download_manual/cart.lua` and
`carts/apu_download_manual/results.lua`, and its manifest in
`carts/apu_download_manual/res/manifest/manifest.rommanifest`. Keep the supplied
assertion at `tests/carts/apu_download_manual/apu_download_manual_assert.lua`
before the debug build. No earlier example cartridge or audio asset is needed.
With the [checkout prerequisites](#prerequisites), run from the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- apu_download_manual --debug
npm run headless:test -- apu_download_manual tests/carts/apu_download_manual/apu_download_manual_assert.lua
```

The build exports `dist/apu_download_manual.debug.rom` and its matching
`dist/system/bmsx-bios.debug.rom`. The supplied case reports:

```text
[test] requested_words_before_surplus_prefetch: passed
```

It checks all twenty first-download words and four second-download words,
DMA count/DONE, masked pending, APU transfer-busy before STOP, cleared transfer
state after STOP and zero APU/system bus faults. The second download recovers
four words also present in the first, after STOP. Silence or an unchanged
picture is not this data-transfer proof; no voice is started by the example.
The chapter's ideal cycle tables count separate device work, not the CPU
program's setup/polling/observation instructions or a promised STOP latency.
This route was checked in the working checkout, not every OS or a fresh SDK
installation.

## Build and inspect two cartridge sockets

Use the complete two-module program in **Book III, Cartridge sockets and mapped
card devices — Two-card programming example**. This is a separate raw polling
example, not a prerequisite for earlier examples. Its source files are
`carts/cartridge_manual/results.lua` and `carts/cartridge_manual/cart.lua`.
The project-relative module name `results` supplies the entry's typed BSS
record; `module<entry>` selects the entry. The supplied assertion is
`tests/carts/cartridge_manual/cartridge_manual_assert.lua`; have it present
before the debug build.

Two distinct media definitions are required. Place the bootable program in
**socket0**, not socket1. Its manifest is
`carts/cartridge_manual/res/manifest/manifest.rommanifest`:

```yaml
title: Cartridge Sockets Manual Example
hardware:
    - type: rom
    - type: ram
      bytes: 256
    - type: mailbox
```

The separate **socket1** data-card manifest is
`carts/cartridge_manual_data/res/manifest/manifest.rommanifest`:

```yaml
title: Cartridge Sockets Manual Data Card
hardware:
    - type: ram
      bytes: 256
    - type: mailbox
```

The data-card project has no Lua entry or ROM device. Its packaged `.rom`
filename does not turn the package into installed ROM. Both cards have 256 bytes
of RAM and a mailbox, not the whole 15 MiB RAM aperture.

With the [prerequisites](#prerequisites), run from the repository root:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- cartridge_manual --debug
npm run build:toolchain:cart -- cartridge_manual_data --debug
npm run headless:test -- cartridge_manual \
  tests/carts/cartridge_manual/cartridge_manual_assert.lua \
  --slot1 dist/cartridge_manual_data.debug.rom
```

The first cartridge build resolves the matching BIOS automatically. The data
card exports `dist/cartridge_manual_data.debug.rom`; `--slot1` explicitly keeps
it in physical socket1. This existing guest-test route looks up its supplied
suite in socket0, so do not swap the two command arguments to demonstrate a
socket1 boot. The BIOS's general scan policy and the scope of this particular
verification route are distinct.

This starts a fresh machine and fresh card RAM. Do not substitute a warm reset
or rerun: card reset retains RAM, whereas the program's untouched socket0
copy destination is expected to begin zero. The program owns DMA0, both
mailboxes, both central cartridge pending bits and card-RAM bytes 0–31 in both
sockets. IRQ delivery remains masked; it polls raw pending/status instead of
installing a DMA callback service.

Look for exactly:

```text
[test] two_sockets_local_edges_and_cross_socket_dma: passed
```

The suite checks raw SELECT `80000001H`, derived STATUS `00010003H`, no ROM on
the data-only card, separate RAM sentinels `10203040H`/`50607080H`, and two local
IRQ edges on each socket separated by source acknowledgement. A central ACK
without a source ACK does not produce another edge. It then checks all four
socket0-ROM→socket1-RAM words:

```text
01234567 89ABCDEF 55AA33CC F00DCAFE
```

It also checks CPU SELECT remains 1 during the transfer, DMA CONTROL `00000E63H`,
DONE `2`, count 0, correct final addresses, masked DMA pending 1, untouched socket0
copy words 0 and bus fault 0. The linked seed address comes from the actual
`rodata`; it is not a guessed absolute ROM offset.

This integration route compiles a derived socket0 image containing the ordinary
program and assertions, while preserving both media definitions. Its linked
addresses need not match the ordinary image. The retained values do not measure
the chapter's conditional 72-cycle admitted-block budget or IRQ entry latency.
For ordinary playback without the assertions, build and run separately:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- cartridge_manual \
  --slot1 dist/cartridge_manual_data.debug.rom --ttl 2
```

Expect loading/game-loop/TTL messages, not a printed payload or a new image.
A normal player exit is not a value check. Use the named integration case for
the retained hardware observations; neither route is physical-bandwidth proof
or native execution of this complete cartridge.

<a id="repair-and-retry-a-word-load"></a>

## Repair and retry a word load

Keep the existing fault-probe cartridge unchanged. Create
`carts/memory_recovery_manual/cart.lua` using the complete listing in
[Repair a word load and retry](../book1/memory.md#repair-a-word-load-and-retry).
Create `carts/memory_recovery_manual/res/manifest/manifest.rommanifest`:

```yaml
title: Memory Recovery Manual
hardware:
  - type: rom
```

From the repository root, build the debug tooling and this separate cartridge,
then run the maintained keyboard scenario with the standard default O3 build:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- memory_recovery_manual --debug
npm run ide:test -- memory_recovery_manual tests/ide/memory_recovery_manual.idetest.js
```

The observed result is `memory_recovery_manual.idetest.js passed (10 assertions)`.
This runs the ordinary ROM and enters BIOS monitor commands through physical
keyboard input; it is not the guest integration runner. The assertions verify
both payload words and Memory CODE changing from 1 to 0. The **cartridge itself**
must contain debug symbols for its source bindings; a debug BIOS or debug page
alone does not supply them.

For a manual browser run, reuse the prerequisites, `PICTURE=FIT` setting and
keyboard-focus directions in [Run and inspect the fault probe](#run-and-inspect-the-fault-probe),
but build and open this **distinct** ROM:

```sh
npm run build:product:browser-player -- --debug
npm run build:toolchain:cart -- memory_recovery_manual --debug
npm run serve:dist
```

Keep the server running and open
`http://127.0.0.1:8080/index.html?rom=memory_recovery_manual.debug.rom`.
This sequence was exercised in Chromium on Linux using mouse/keyboard input and the ordinary debug ROM. It does not establish other-browser or native execution.

At the fault prompt, enter:

```text
FRAMES
LUA --FRAME 0x00000001 0 source = safe_words
CONT
```

`FRAMES` displays hexadecimal indices. For this supplied example, the retained
source scope at the fault EPC is physical index `00000001`, depth `0`; use the
`0x` prefix when entering that displayed index. Other programs/builds require
their own matching scope. Binding names are case-sensitive. Assign the live
mutable `source`, not `source_address`, `safe_words`, source text or EPC.
Assignment returns to the prompt; it does not resume execution or clear CODE.
`CONT` retries the repaired read.

Expected **diagnostic output**, visible in the browser developer console or the keyboard scenario’s log, not new terminal pixels drawn by `print`:

```text
RECOVERED
WORDS 12345678 9ABCDEF0
FAULT 00000001 -> 00000000
```

The old monitor image can remain visible after `CONT`; use the diagnostic result rather than expecting a new on-screen success message.

`REBOOT` requests a fresh BIOS/system startup, not saved-EPC continuation. The unchanged cartridge starts with its bad initial pointer again; restarting is not repairing it.

<a id="physical-frames-and-inline-scopes"></a>
### Physical frames and inline scopes

`LUA --FRAME INDEX DEPTH <SOURCE>` selects a physical frame and a source scope within it. They are independent selectors:

| Selector | Meaning |
| --- | --- |
| `INDEX` | A retained physical frame from the current stop. |
| `DEPTH` | `0` selects that physical function's own scope; positive depth `d` selects the `d`th callee in its outer-to-inner inline chain. |

Inlining can preserve a source function's scope without creating another physical frame. A lexical block does not add a depth, and available scopes depend on the selected PC: not every depth is available.

`FRAMES` takes no arguments and lists retained physical frames, highest index first; index `0` is the outer end. Its header is `INDEX    FUNCTION PC (HEX; DEPTH 0)`. Each row shows the index, function-record address and saved PC as eight uppercase hexadecimal digits without `0x`. The header is not an expanded source backtrace or a promise that every row resolves at depth `0`.

Both selectors default to decimal and accept `0x` or `0X` for hexadecimal. For example, a displayed index `0000000A` would be entered as `0x0000000A` or decimal `10`; this illustrates formatting, not an actual row from the supplied cart.

The saved PC is not always the scope-lookup point: an older ancestor can resolve at its child's call-site PC while that child is pending. Choose frame identities from the current stop; do not reuse them as the same identities after execution.

Currently, `FRAMES` does not expose inline names or depth choices, and `HELP LUA` supplies usage, not scope discovery. The visible BIOS CLI accepts an already-known pair but cannot reveal arbitrary fault-source pairs. The recovery lesson's `0x1 0` pair remains valid for its supplied example, not universally. This is a current tooling limitation, not a permanent hardware constraint. Even the correct pair still requires the installed symbols and live, mutable binding discussed above for assignment.

<a id="read-cp0-during-an-irq"></a>
## Read CP0 during an IRQ

Use this example to read CP0 inside a cartridge IRQ callback and confirm normal return to main code. Follow the common [prerequisites](#prerequisites) and [tooling/debug BIOS build](#build-and-check-the-storage-result). No additional asset or library module is required.

The [complete CPU program](../book1/cpu.md#cp0-in-cartridge-irq) supplies the results module, `carts/cpu_irq_manual/results.lua`, and entry module, `carts/cpu_irq_manual/cart.lua`. Its manifest, `carts/cpu_irq_manual/res/manifest/manifest.rommanifest`, is:

```yaml
title: CPU IRQ Privilege Manual
hardware:
  - type: rom
```

Build and run the maintained derived integration case:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- cpu_irq_manual --debug
npm run headless:test -- cpu_irq_manual tests/carts/cpu_irq_manual/cpu_irq_manual_assert.lua
```

It reports:

```text
[test] cp0_in_irq_callback_and_normal_return: passed
```

On a fresh target, that case checks the 28-byte result structure: STATUS `0000000C`, CAUSE `00000400`, aligned nonzero EPC, SYSTEM STATUS zero, flags containing `4`, one service, and final mask zero. It waits for `resumed=1`. This is an integration check, not ordinary ROM playback, native coverage, or all-input coverage.

For the separate ordinary ROM route, run:

```sh
npm run build:product:node-headless-player -- --debug
npm run headless:game -- cpu_irq_manual --ttl 2
```

This uses `dist/cpu_irq_manual.debug.rom` and `dist/system/bmsx-bios.debug.rom`. TTL `2` means 2000 ms of virtual headless host clock, not wall-clock time or hardware latency. Compare the actual post-boot diagnostics:

```text
IRQ CP0 STATUS=0000000C CAUSE=00000400
SYSTEM CONTEXT=00000000 SERVICES=1 RESUMED=1
```

Successful player exit alone does not check those values. These are diagnostics, not new framebuffer text or a capture; no exact EPC is printed.

With fresh ordinary BIOS entry, sole callback/mask ownership, and no external context request, the callback reads CP0 with current-user clear without activating SYSTEM supervisor context. Normal return and generated RFE resume main, which never reads CP0. This is not a cartridge memory-exception installation or recovery API.
