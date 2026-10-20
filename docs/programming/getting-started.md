# Build and inspect example cartridges

This is a repository-tooling companion, outside the three BMSX reference books.
Its builders, examples and tests are optional project software, not console or
BIOS requirements. Independent toolchains implement the interfaces in the books.

Begin with a visible result: build and run the supplied GPU cartridge below.
It draws a static scene from ordinary BLua source; an assertion suite is not
required to see it. Then use the hardware-operation links to choose what to
program next.

Use the supplied example source files. The manual fragments explain individual
mechanisms; they are not copies of the result-storage and diagnostic projects.
The examples below are independent, not a chain of prerequisite builds.

## Prerequisites

This route targets Ubuntu Linux on x86-64, including Ubuntu under WSL. Use
Node.js 22.x with npm and a POSIX shell. In WSL, run the commands inside the
Linux environment.

Install Git and the development server's native build requirements:

```sh
sudo apt-get update
sudo apt-get install -y git build-essential libsystemd-dev
```

For a new checkout, run the following from your projects directory. If you
already have a checkout, change to its root and run only the install command.

```sh
git clone https://github.com/Heer-Boaz/BMSX.git
cd BMSX
npm ci --include=dev
```

`npm ci` installs the committed dependency versions. Allow dependency
installation scripts: these builds need the native `canvas` binding, even for
examples without image assets. Canvas supplies a prebuilt Linux x86-64/glibc
binary; compiling it from source needs the additional dependencies in its
[versioned installation guide](https://github.com/Automattic/node-canvas/blob/v3.2.3/Readme.md#installation).

Run the remaining commands from the repository root. The cartridge build
supplies its matching BIOS automatically. `serve:dist` also builds its native
server helper automatically; that is why the C++ toolchain and systemd
headers/library are needed. Do not add separate BIOS, Studio or headless-tooling
builds to the first-picture route.

## First picture: build and run the GPU example

The complete source is `carts/gpu_manual/cart.lua`, corresponding to
[Program a complete picture in BLua](../book1/gpu.md#sec-gpu-program-a-complete-picture-in-blua).
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

This is the existing [GPU output plate](../book1/gpu.md#sec-gpu-gpu-output-plate), whose
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
| Establish memory ownership and startup | Read [ROM contents, RAM sections, and startup](../book1/memory.md#sec-memory-rom-contents-ram-sections-and-startup), then [Taking ownership after the BIOS](../book1/memory.md#sec-memory-taking-ownership-after-the-bios) before assigning storage. |
| Draw, upload pixels, or use textures | Extend [Program a complete picture in BLua](../book1/gpu.md#sec-gpu-program-a-complete-picture-in-blua) through [Upload and issue the stream](../book1/gpu.md#sec-gpu-upload-and-issue-the-stream-through-one-port) and [Locate texture texels and palette colors](../book1/gpu.md#sec-gpu-locate-texture-texels-and-palette-colors). |
| Control display timing and source windows | Read [Beam timing](../book1/pcrtc.md#sec-pcrtc-27-beam-timing), then [Program the fixed canvas and initial cutout](../book1/pcrtc.md#sec-pcrtc-program-the-fixed-canvas-and-initial-cutout) for the source-selection route. |
| Transform and project 3D geometry | Begin with [Constructing and packing a transform](../book1/gte.md#sec-gte-constructing-and-packing-a-transform); continue through [Perspective and geometric decisions](../book1/gte.md#sec-gte-perspective-and-geometric-decisions) to [a visible image](../book1/gte.md#sec-gte-from-projected-vertices-to-a-visible-image). |
| Transform 2D shapes and test contacts | Follow [An authored sprite and its collision hull](../book1/geo.md#sec-geo-an-authored-sprite-and-its-collision-hull), then [Launching and observing a job](../book1/geo.md#sec-geo-launching-and-observing-a-job). |
| Transfer data and observe completion | Follow [Program a transfer](../book1/dma.md#sec-dma-program-a-transfer) together with [Completion and interrupts](../book1/dma.md#sec-dma-completion-and-interrupts). |
| Play sound and manage sample storage | Start with the APU [Programming sequence](../book1/apu.md#sec-apu-programming-sequence), then [Voice sources and their lifetime](../book1/apu.md#sec-apu-voice-sources-and-their-lifetime) and [Sample RAM transfer](../book1/apu.md#sec-apu-sample-ram-transfer). |
| Read input and service interrupts | Follow the [input sampling sequence](../book1/input.md#sec-input-sample-input-in-blua), [Choose one cartridge dispatch route](../book1/irq.md#sec-irq-install-the-cartridge-handler), and [Acknowledge the source and the controller separately](../book1/irq.md#sec-irq-acknowledge-the-source-and-the-controller-separately). |

The [System overview](../book1/console.md) relates the units and storage. For
source notation, read the [BLua extensions](../book1/blua-programs.md#sec-blua-programs-blua-extensions)
rather than treating the hardware examples as ordinary Lua.


## Project files and commands

Cartridge projects live under `carts/<folder>`. The folder, not its manifest
title or an entry filename, is the builder's cartridge argument. Sources use
project-relative module paths; exactly one source declares `module<entry>`.
The manifest is `res/manifest/manifest.rommanifest`. Keep project sources and
resources separate from fixtures under `tests/carts/<folder>`.

To inspect the typed-storage example through the supplied test runner:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- memory_manual --debug
npm run headless:test -- memory_manual tests/carts/memory_manual/memory_manual_assert.lua
```

The tooling product is needed for this test route, not for the first-picture
player. Tests compile isolated derived images; they are not byte-identical
ordinary-ROM playback. Their absolute linked addresses may differ. A passed
suite checks its selected results, not all hardware behavior or every backend.

Run an ordinary debug cartridge separately with the player:

```sh
npm run headless:game -- memory_manual --ttl 2
```

`headless:game` runs existing debug artifacts. To rebuild the host, BIOS and
selected cartridge explicitly, use `headless:forcebuildallrun`. TTL is virtual
host time in seconds; reaching it does not assert output. Captures and input
timelines use `headless:tooling -- --debug --input-timeline <file> <cart>`.
Use the supplied timeline under the matching `tests/carts` directory rather
than creating another observer or copying recorded frame numbers into code.

## Supplied examples

Each row identifies an existing optional project and its principal assertion
suite. Invoke it with the same build/test sequence above, replacing both paths.
Consult the source for full diagnostic layouts; the books contain the hardware
and BIOS contracts, not these projects' retained-result conventions.

| Subject | Cartridge | Suite in `tests/carts/<cartridge>/` |
|---|---|---|
| Typed storage | `memory_manual` | `memory_manual_assert.lua` |
| Language values and bytes | `language_manual` | `language_manual_assert.lua` |
| CPU values | `cpu_values_manual` | `cpu_values_manual_assert.lua` |
| CP0 inside IRQ | `cpu_irq_manual` | `cpu_irq_manual_assert.lua` |
| DMA | `dma_manual` | `dma_manual_assert.lua` |
| Input | `input_manual` | `input_manual_assert.lua` |
| Interrupt handling | `irq_manual` | `irq_manual_assert.lua` |
| System context | `system_manual` | `system_manual_assert.lua` |
| Graphics packets | `gpu_manual` | `gpu_manual_assert.lua` |
| GPU dithering | `gpu_dither_manual` | `gpu_dither_manual_assert.lua` |
| GPU shared edges | `gpu_coverage_manual` | `gpu_coverage_manual_assert.lua` |
| GTE pipeline | `gte_manual` | `gte_manual_assert.lua` |
| Display composition | `pcrtc_mix_manual` | `pcrtc_mix_manual_assert.lua` |
| Horizontal sampling | `pcrtc_sampling_manual` | `pcrtc_sampling_manual_assert.lua` |
| GEO arithmetic | `geo_manual` | `geo_manual_assert.lua` |
| Sprites and collision hulls | `geo_scene_manual` | `geo_scene_manual_assert.lua` |
| Image decoding | `imgdec_manual` | `imgdec_manual_assert.lua` |
| Audio sources | `apu_manual` | `apu_manual_assert.lua` |
| Sample-RAM download | `apu_download_manual` | `apu_download_manual_assert.lua` |
| Module linkage | `modules_manual` | `modules_manual_assert.lua` |
| Numeric loops | `loops_manual` | `loops_manual_assert.lua` |
| Generic iteration | `iterators_manual` | `iterators_manual_assert.lua` |
| Base BIOS | `bios_base_manual` | `bios_base_manual_assert.lua` |
| Math BIOS | `bios_math_manual` | `bios_math_manual_assert.lua` |
| Time/calendar BIOS | `bios_os_manual` | `bios_os_manual_assert.lua` |
| String formatting | `bios_format_manual` | `bios_format_manual_assert.lua` |
| String patterns | `bios_pattern_manual` | `bios_pattern_manual_assert.lua` |
| Binary records | `bios_pack_manual` | `bios_pack_manual_assert.lua` |
| Runtime compilation | `bios_loader_manual` | `bios_loader_manual_assert.lua` |
| Table BIOS | `bios_table_manual` | `bios_table_manual_assert.lua` |
| Coroutines | `coroutines_manual` | `coroutines_manual_assert.lua` |

The two-card project additionally needs `cartridge_manual_data` installed in
socket 1. Build both projects, then use the existing `--slot1` argument:

```sh
npm run build:toolchain:cart -- cartridge_manual --debug
npm run build:toolchain:cart -- cartridge_manual_data --debug
npm run headless:test -- cartridge_manual tests/carts/cartridge_manual/cartridge_manual_assert.lua --slot1 dist/cartridge_manual_data.debug.rom
```

## BIOS monitor and frame selection

`memory_fault_manual` deliberately enters the monitor on an unmapped load.
`memory_recovery_manual` supplies a mutable pointer that can be repaired there.
Use the [Memory chapter's monitor procedure](../book1/memory.md#sec-memory-repair-a-word-load-and-retry)
for inspection, assignment and retry. Do not treat clearing a report as repairing
the faulting operand.

`FRAMES` prints physical frame rows, each followed by currently active `DEPTH`
rows and source-scope names. Select the desired pair with
`LUA --FRAME INDEX DEPTH <SOURCE>`. Displayed selectors are hexadecimal; prefix
copied words with `0x` because bare command counts are decimal. The BIOS-consumed
diagnostic directory supplies these names and availability intervals. Private
host symbols are a different artifact.

## Development invocation of `<init>`

IDE Hot Resume explicitly prepares calls to the public executable header's
`initFunctionAddress` vectors for selected cartridge or system images, omitting
zero addresses. Linked tooling reads `linked.layout.header.initFunctionAddress`.
When media was rebuilt,
it installs the revision before beginning the prepared completion calls in their
selected execution domains. Initial selection includes the active cartridge when
source-edited or when resuming without rebuilt media, and the system for a system
source edit. This is a specific development route, not automatic invocation on
every image replacement. Normal startup still omits the participant vector;
`<init>` declarations register closures without calling their bodies.

See the [BLua participant reference](../book1/blua-programs.md#sec-blua-programs-init-registers-a-participant-it-does-not-call-it-at-startup)
for the declaration restrictions and explicit ordinary-startup call. This bounded
route description is not a guarantee about every source edit, replacement,
reset or IDE scheduling state.

## Trace selection in the supplied build routes

The [BLua extension reference](../book1/blua-programs.md#sec-blua-programs-intrinsic-calls-blua32)
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

Ordinary-ROM trace selection is not exposed by the cartridge builder. The
source forms remain documented, including their erasure and evaluation rules;
no undocumented flag or replacement build wrapper is required here.

## BIOS link information for independent tools

A cartridge linker needs information about the **matching BIOS build**, not
just the console's address windows. It must preserve firmware static RAM and,
when using a named BIOS function import, bind that name to its actual
function-record address. These addresses are not instruction PCs, image-relative
offsets or cartridge resource IDs.

Read the matching BIOS ROM itself: `dist/system/bmsx-bios.debug.rom` for a debug
build or `dist/system/bmsx-bios.rom` for the ordinary build. Its boot header
locates the executable header, whose public function table and RAM-section
fields supply the required addresses. No package index or separate import file
is needed. The ordinary cartridge-build commands select the matching ROM
automatically.

The existing tooling reader returns the link information from those public
fields:

```sh
./node_modules/.bin/tsx --eval '
import { readFileSync } from "node:fs";
import { readBlua32BiosImports } from "./toolchain/ts/rompack/blua32_bios_imports.ts";
console.log(JSON.stringify(readBlua32BiosImports(
  readFileSync("dist/system/bmsx-bios.debug.rom")
), null, 2));
'
```

| Returned field | Meaning for an independent linker |
|---|---|
| `cartridgeStaticRamBase` | Matching firmware's BSS end. The supplied linker places cartridge DATA here; the CPU does not allocate that storage or enforce this adjacency. |
| `functions[i].path` | Literal named BIOS import, such as `gpu/system_vram_region`. |
| `functions[i].exportPathKey` | Export within that module; empty for the currently supplied module-root function imports. |
| `functions[i].functionAddress` | Absolute function-record byte address in system ROM. |

For an immediate CLOSURE relocation, encode that function-record address in
sixteen-byte units, then call the constructed closure. The [CPU linkage
reference](../book1/cpu.md#sec-cpu-linkage-operands-and-encoding-examples) gives both
closure forms and their exact bytes. Ordinary BIOS globals such as `print`
instead use the image's global-name table and normal value calls; their names
are not additional entries in this static-function import list.

A custom layout must still preserve firmware reservations, initialize its own
DATA and BSS through startup instructions, and place the actual addresses in
its records and code. The [Memory reference](../book1/memory.md#sec-memory-rom-header-fields)
defines the machine's boot and executable-image formats. A tool's choice to
pack static sections consecutively is not an additional hardware requirement.
