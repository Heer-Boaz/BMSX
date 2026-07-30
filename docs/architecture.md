# BMSX Architecture Contract

Last checked: 2026-07-30.

This document is the current machine/host boundary contract. It is not a work
log, a prompt, or a migration diary. If implementation changes land, this file
must be updated in the same slice.

## Machine identity

BMSX is documented and implemented as if it were an obscure physical console.
The repository is the surviving hardware manual and emulator source for that
machine. Product language may be playful, but architecture work must not treat
the cart runtime as a fantasy-console service API.

Cart-observable facts are hardware facts: CPU-visible words, RAM/ROM bytes,
MMIO registers, registerfiles, FIFOs, IRQ lines, status/fault latches, device
memory, command packets, fixed-point formats, opcodes, and timing edges. A cart
may use BIOS or cart-library helpers, but those helpers must ultimately program
the same machine-visible bytes and registers the cart could use directly.

### BSX end state and PSX foundation

`BMSX` is the current repository and runtime name. The intended console is
`BSX`: a fantasy descendant of the PlayStation architecture with the Lua CPU
and its own native GTE+ and GPU. It is not intended to remain a PSX emulator or
to accumulate compatibility wrappers around PSX command packets.

The PSX GTE emulation is nevertheless the deliberate hardware foundation for
GTE+. That foundation was formally accepted on 2026-07-18: all 22 canonical
opcodes were audited against DuckStation, Mednafen, and MAME; both runtime
owners matched all 64 output register words in each of the 1,100 runs in the
pinned JaCzekanski hardware log; and the mirrored focused suites cover raw
register behavior, fixed-point stages, saturation, flags, divide, MAC/IR
ordering, timing, and save-state latches. The evidence and exact pinned input
remain in the [GX workplan](gx_psx_replacement_workplan.tmp.md#4-gte-parity),
the [TS vectors](../tests/lua/gx_gte.test.ts), and the
[C++ vectors](../tests/cpp/gx_gte_test.cpp). A later PSX discrepancy is a
foundation regression to fix, not a reason to reinterpret the accepted raw
words through a compatibility path.

GTE+ extends that accepted register/opcode model explicitly; it does not replace
it with host geometry, material, morphing, or renderer objects, and it never
reinterprets an existing PSX opcode or register word. The first native extension
is the three-lane fixed-point `VMAD3` datapath below. Native depth buffering,
local geometry memory, packet emission and surface words remain separate future
hardware slices rather than implied parts of this one. The retired VDP/RPU ABI
is not a design source or a compatibility route for any of them.

#### GTE+ VMAD3 datapath

GTE+ revision 1 adds one raw ten-word MMIO register block at
`IO_GX_GTE_PLUS_BASE` (`0x08010380`). It is adjacent machine hardware, not an
alternate view of the 32 PSX data registers, 32 PSX control registers or the PSX
command port.

| Word | Name | Access | Raw layout |
| ---: | --- | --- | --- |
| 0 | `ADD_XY` | R/W | Signed 16-bit X in bits 0--15 and signed 16-bit Y in bits 16--31. |
| 1 | `ADD_Z` | R/W | Signed 16-bit Z in bits 0--15; bits 16--31 are retained input bits. |
| 2 | `MUL_XY` | R/W | Signed 16-bit X in bits 0--15 and signed 16-bit Y in bits 16--31. |
| 3 | `MUL_Z` | R/W | Signed 16-bit Z in bits 0--15; bits 16--31 are retained input bits. |
| 4 | `SCALAR` | R/W | Signed Q4.12 scalar in bits 0--15; bits 16--31 are retained input bits. |
| 5 | `RESULT_XY` | R | Saturated signed 16-bit X/Y result halves. |
| 6 | `RESULT_Z` | R | Saturated signed 16-bit Z in bits 0--15; bits 16--31 read zero. |
| 7 | `FLAG` | R | Result flags defined below; all other bits read zero. |
| 8 | `COMMAND` | CPU R/W | Complete retained command word; bits 0--7 select the function and bits 8--31 are ignored by revision 1. DMA writes have no effect. |
| 9 | `CYCLES` | R | Bit 31 is `BUSY`; bits 0--30 retain the accepted command latency. |

Function `0x01` is `VMAD3`. The GTE+ owner admits only a CPU-bus write while
`BUSY` is clear; DMA command writes and direct writes presented while `BUSY`
have no effect and cannot replace the retained command. A CPU store targeting a
busy command port waits at the existing mapped-write readiness boundary. A
multiword CPU store preflights every mapped destination before issuing any bus
word, so a sequence that reaches `COMMAND` blocks at that exact address without
committing an input prefix. An accepted write latches all five input words,
publishes `BUSY | 5` through `CYCLES`, and then each lane computes the same
integer pipeline in parallel:

```
accumulator = signed16(ADD) * 4096 + signed16(MUL) * signed16(SCALAR)
shifted     = arithmetic_shift_right(accumulator, 12)
result      = saturate_signed16(shifted)
```

The accumulator is a signed 32-bit datapath; the complete representable input
range fits it without an intermediate overflow. Arithmetic shift is the normal
two's-complement shift, including negative fractional results. While `BUSY` is
set, result and `FLAG` reads expose their previous completed latches. Input words
remain writable, but those writes cannot alter the accepted operation because
its operands have already been latched. The three result lanes and `FLAG`
publish atomically after five machine cycles; that completion edge clears
`CYCLES.BUSY` and leaves the latency value `5`. The GTE+ owner retains one
absolute completion tick. Normal commands do not allocate a generic scheduler
event: GTE+ MMIO access or state capture materializes an elapsed tick exactly
once. Only an actually blocked CPU store receives one scheduler wake at the
retained tick. `FLAG` bit 31 is the aggregate error bit. Bits 30/29/28 report
positive saturation for X/Y/Z and bits 27/26/25 report negative saturation for
X/Y/Z. A `VMAD3` command replaces the previous flag word. An unknown function
leaves all result words unchanged, publishes `BUSY | 1` immediately, then
publishes `ERROR | INVALID_COMMAND` (`FLAG` bits 31 and 24) and clears `BUSY`
one cycle later. Writes to `RESULT_XY`, `RESULT_Z`, `FLAG`, and `CYCLES` have no
effect.

Reset clears all ten words, cancels an outstanding CPU-interlock wake, discards
the retained completion tick, and makes the command port ready. Save-state
stores the ten raw words plus the in-flight pipeline's pending packed results,
pending flag, remaining machine cycles and armed-interlock bit. Restore consumes
those words directly and reconstructs the owner tick; an unblocked operation
allocates no event, while an operation captured with a blocked CPU store rearms
exactly that single wake. The central firmware utility waits on
`CYCLES.BUSY`, so its returned vector has crossed the same hardware edge in TS
and C++. `VMAD3` has no implicit GPU command, VRAM access, local memory, DMA or
host handoff. Its packed results deliberately match the accepted PSX vector
halfword layout, so cart code may explicitly write them to a PSX GTE input
register or another machine destination without a compatibility facade.

Host wall clocks, browser performance counters, UI timers, and process scheduling
are host services. Cart-visible time is BMSX machine time derived from emulated
CPU/scheduler progress unless the machine specification defines a concrete RTC
device. Firmware helpers must not expose host wall-clock time as machine state.
`os.time`/`os.date` use the BMSX civil-time conversion, not the host timezone,
DST rules, JavaScript `Date`, or libc local-time functions. `os.time(table)`
consumes integer `year`, `month`, and `day` fields plus optional integer
`hour`, `min`, and `sec` fields. Lua's standard defaults and normalization are
preserved: omitted `hour` is noon, omitted `min`/`sec` are zero, and out-of-range
calendar/time fields normalize deterministically through BMSX civil time.
`os.time(table)` writes those normalized Lua date fields back to the supplied
table, matching Lua's documented table-normalization contract. `os.date` and
`os.difftime` consume integer BMSX time values; fractional time arguments are
not silently truncated.

## ABI symbol policy

Machine ABI symbols are numeric facts about the machine, not emulator-injected
Lua globals. This includes:

- MMIO register addresses;
- status, control, IRQ, and fault bit values;
- command words, opcodes, packet fields, and descriptor layouts;
- fixed-point formats, record sizes, offsets, and capacities;
- ROM/BLua32-image/header constants and memory-map addresses.

The owning TS/C++ machine files define those constants for the emulator. The
hardware documentation lists cart-visible values. Cart, BIOS, or cart-library
source defines the constants it uses. The emulator runtime must not make a
value observable merely by seeding a friendly global name.

Runtime-injected host Lua globals are not a cart API. Machine TS/C++ may expose
temporary hidden `__bmsx_*` boot primitives only for BIOS Lua to capture; runtime
boot clears those primitives before cart code runs. Public guest names are
installed by BIOS/firmware Lua or ordinary cart Lua, not by host seeding.

Migration warning: earlier slices sometimes used cart manifests or host-seeded
Lua library globals as convenient cart-visible API. Treat that as host-magic
architecture debt, not as precedent. Cart manifests are packaging/header input,
not the live hardware-control surface. If guest code can observe a value or
function, it must come from one of the real owners: ROM/header fields consumed at
boot, link symbols, BIOS Lua, CPU-visible RAM/MMIO, or a documented device
register. Lua language-runtime behavior and machine firmware services belong in
BIOS Lua unless they are true CPU primitives. Cart-facing asset, animation,
font, collection, and gameplay libraries belong in `cartlib` and are linked
into the cartridge image. Do not preserve manifest or host-native library
shortcuts by adding wrappers; migrate each observable value to its owner and
delete the shortcut.

## Fixed-point and angle ABI

BMSX fixed-point geometry uses one shared signed Q16.16 word format. The value
`0x00010000` is `1.0`; negative values are two's-complement signed words. The
GEO transform datapath multiplies Q16.16 matrix words by signed coordinates with
an i64 multiply-accumulate, saturating i64 addition, arithmetic right shift by
16, and saturating i32 narrowing. That shift semantics is the ABI; firmware math
helpers must not introduce a second rounding rule for matrix/trig values.

Angles used by fixed-point firmware trig helpers are 32-bit binary turns: one
full revolution wraps at `2^32`, `0x40000000` is 90 degrees, `0x80000000` is
180 degrees, and arithmetic overflow is natural turn wrap. Firmware helpers may
store lookup tables in `.rodata` and read them through ordinary typed pointer
loads. Function names such as `sincos_turn32` are ordinary exported BLua symbols,
not compiler, CPU, interpreter, or device intrinsics.

The guest Lua language deliberately includes its table and string value types
and the normal base, table, string, math and OS libraries. The boot ROM installs
`bios/base.lua` as the core Lua global library, `bios/table.lua` as `table`,
`bios/string.lua` as `string`, `bios/math.lua` as `math`, and `bios/os.lua` as
`os`. Those modules execute as BLua using ordinary calls, ROM lookup tables, and
integer/number instructions; carts are not expected to avoid normal Lua
features. More generally, broadly useful language/runtime basics may be
firmware-provided guest services.

The prohibition is narrower: machine TS/C++ must not implement or inject those
public guest functions as native host callbacks. It exposes only temporary
`__bmsx_*` boot primitives for the BIOS to capture; runtime boot clears those
primitive globals after system static-module initialization and before any cart
static module or reset vector runs. `require(...)` is not one of those
primitives and is not a guest runtime global: literal module imports are
resolved by the compiler into static module initialization and module export
slot loads. Host `Math.*`/`std::*` remains valid only for emulator/device
implementation and build tooling.

Guest-cycle accounting describes the BLua32 datapath, not the amount of work
performed by a generic Lua interpreter or by the emulator host. Tables are the
language's normal object representation: `GETFIELD`, `GETI`, `GETT` and their
store counterparts are deliberately cheap machine instructions, with the
literal-field and integer-index paths consuming image-owned lookup caches.
`CONCAT` and `CONCATN` likewise execute as CPU instructions. Implementing those
instructions directly in mirrored TS/C++ is emulation of the datapath, not a
guest-visible host callback. Their cycle costs must not be inflated merely
because a host implementation performs lookup, hashing, allocation or string
work; changing a cost requires an explicit change to the hypothetical hardware
contract.

Literal `require(...)` is authoring syntax resolved by the compiler and consumes
no guest cycles of its own. Emitted static module initialization executes
normally, once, and deliberate dynamic module-root or field reads pay only for
the ordinary load instructions that remain after compilation. A library being
firmware-owned also does not require every useful primitive to be expressed as
a slow BLua loop: a proven fundamental operation may be an architected CPU
instruction or microcode operation with mirrored representation and timing.

Animation easing is not a Lua standard-library facility or general firmware
service; it lives in `cartlib` with font layout, ROM-directory/metadata
decoding, APU asset decoding, clock helpers, and cart-only device helpers. Those
modules consume cartridge code and heap rather than system-firmware code and
heap. BIOS fixed assets use generated link-time system-ROM address constants;
BIOS does not build a runtime TOC object graph for them.

Runtime source compilation (`load`/`loadstring`) is a compiler/loader boundary,
not a shipped-cart technique or a BIOS-provided public Lua API. ROM, BIOS and
cart sources must contain explicit Lua code or precompiled module exports; the
cart Lua linter rejects references to `load` and `loadstring` in shipped
sources.

`math.sin`, `math.cos`, and `math.tan` use the same firmware quarter-wave LUT
and Q16.16 turn helper as direct fixed-point firmware code. Their precision is
therefore the documented LUT/Q16.16 firmware precision, not host double
transcendental precision. `math.tan` is the ratio of those Q16.16 sine/cosine
results: exact turn singularities divide by zero and produce the normal Lua
numeric infinity; near-singular radian inputs remain finite.

The `os` library is also firmware-owned. `bios/os.lua` implements `os.clock`,
`os.time`, `os.date`, and `os.difftime` in BLua; elapsed time comes from the
CPU-visible `sys_time_ms` word and civil-time conversion is deterministic BMSX
UTC-equivalent logic, not host wall-clock, host timezone, JavaScript `Date`, or
libc local-time behavior. VM primitives required by the dynamic Lua object-world
remain CPU intrinsics, but their cart-visible API surface is installed by BIOS
Lua and is not precedent for implementing guest libraries through removed
host-native callbacks. The firmware implementations of `math.*` and the other
Lua basics remain part of the machine; animation `easing` remains a cart
library.

## Hard boundary

BMSX carts observe a machine, not the host application:

```text
cart Lua / BIOS helper -> CPU-visible RAM or MMIO -> machine device -> host output edge
```

Forbidden cart-visible shapes:

- cart or BIOS calls into renderer, audio backend, IDE, platform, host, or
  workspace objects;
- runtime shortcuts that mutate device-visible state without RAM/MMIO;
- host registries that duplicate cart-visible ROM, resource, input, video,
  audio, or geometry state;
- old-format fallbacks, defensive state repair, or stale decode branches for
  BMSX-owned formats.

Host code may load files, build ROMs, display frames, play samples, edit source,
and inject input events. It must not be the owner of cart-observable semantics.
Debugger pause, source activity, IDE overlays, media-build source text, and editor
diagnostics are host/IDE state; the machine scheduler and runtime frame loop do
not carry those flags as emulated state.

A BMSX host owns the embedding/process edge and physical host services. It may be
a browser bootstrap, a Node executable, a libretro core entrypoint, or a local
frontend executable. It never owns cart-observable machine semantics.

## Console model and timing

The active machine model is `psx`. A selected model owns the installed hardware
facts for one machine instance. The current model selects a 33.8688 MHz CPU,
4 MiB RAM, region-aware DMA bus timing, a 16,384,000 work-unit/s geometry unit,
and a PSX-style GPU with 2 MiB of raw VRAM. `Runtime` passes the selected
`MachineModelSpec` once into `Memory` and the devices; consumers read installed
capacity from those owners instead of consulting the current model's constants.
The DMA timing is expressed in CPU cycles: one per RAM word plus one cycle of
RAM-burst setup, one per firmware-ROM word, and eight per cartridge word plus
four cycles of cartridge-burst setup.
Machine reset initializes
VRAM with the fixed GX power-on bit pattern. GPU reset starts from a 320×240 PAL display
configuration; that is a reset register state, not a fixed host scanout size.

The ROM package does not select a VDP, GPU, APU, or machine model. The product
host selects the installed machine model; guest software configures that
hardware only through its CPU-visible registers and memory ABI. Authoring
manifests are not guest hardware descriptors and are never exposed to Lua.

Display configuration is raw hardware register state. PCRTC is the implemented
scanout authority. Its live timing bank owns the physical beam; its
VBlank-published bank owns both native read-output rectangles, their merge and
the resulting output bounds. Software, WebGL2, WebGPU, and GLES2 scan out those
native pixel coordinates directly. The PCRTC owner updates its retained output
width, height and selected merge datapath only when published words change; the
presentation loop consumes those members directly instead of re-decoding both
circuits every host frame. Host targets resize only when those bounds change,
and physical 4:3 layout remains separate presentation policy.

GP1(05h)--GP1(08h) are retained PSX GPU register/status words, not a second
clock or scanout owner. They retain the PSX origin, horizontal range, vertical
range and display-mode bits used by GP0/GPUSTAT behavior. A write to any of
them cannot change a PCRTC timing revision, beam deadline or output rectangle.
GX identifies as the type-2 GPU through GP1(10h/07h), so GP1(08h) retains its
complete low-byte input word but bit 7 does not drive GPUSTAT bit 14 or reverse
scanout. There is no permanent GP1-to-PCRTC adapter.

`SMODE1`, `SYNCH1`, `SYNCH2` and `SYNCV` own the raw beam clock and horizontal
and vertical periods. Their MMIO writes publish live timing at the scheduled
GPU service and start a new beam epoch at that machine cycle. `SMODE1.SINT` or
`PRST` stops only the beam; it does not stop CPU, DMA, APU or other machine
time. `CSR` retains FIELD and event latches, `IMR` controls the separate PCRTC
IRQ source, and write-one-to-clear events do not fabricate a new edge. All
configuration words also have a presentation shadow that latches at VBlank so
a mid-field timing or composition write never tears the current scanout.

The PCRTC retains the beam epoch, rational half-line remainder, absolute
half-line, HSync cadence, vertical stage, VBlank level, FIELD, CSR and IMR.
GPUSTAT field/line bits and interlaced command parity are projected from that
physical state plus the retained GP1 words. Current-format save-state stores
the PCRTC state directly and restores its next deadline relative to the restored
machine cycle; it does not reconstruct the beam from legacy display words.

The host frame scheduler consumes each accepted host delta exactly once and
grants the CPU/device timeline its exact rational machine cycles, independently
of PCRTC state. It retains the fractional cycle remainder between grants; unused
whole cycles carry across a VBlank rather than disappearing. A VBlank-begin edge
completes a logical runtime tick and publishes at most one host presentation
completion; a stopped beam therefore stops video edges but not machine
execution. If weird but representable timing produces multiple fields inside
one machine cycle, PCRTC advances every physical FIELD/event transition in
constant time and coalesces only the host-facing presentation edge. Absolute
cycle zero remains a valid hardware deadline.

## Runtime container vocabulary

Ownership terms are architectural roles, not interchangeable directory labels:

- `machine` owns cart-observable semantics: CPU, memory, MMIO, firmware,
  scheduler, devices, ROM/BLua32-image formats, and deterministic save-state.
- `host` owns the process, window/device/runtime environment, files, physical
  input, audio/video presentation, external ABI callbacks, and execution loop.
- `mode` is a behavior variant inside one host. A mode may choose pacing,
  capture, CLI, headless, or test-runner behavior; it is not a separate machine.
- `Studio` is an authoring product above a host. It may compose IDE and compiler
  tooling, but player hosts never import it.

Current artifact roles:

- `dist/libbmsx.js` / `.debug.js`: importable JavaScript machine/runtime
  artifact. It exposes the machine `Runtime` and its physical-media/input
  contracts directly; it does not own browser, Node, SDL, ALSA, EGL, IDE, ROM
  admission, ROM authoring records, or libretro host services.
- `dist/engine.js` / `.debug.js`: browser player/bootstrap artifact. It wires
  browser video, audio, input, runtime preparation, and
  the frame loop through static composition. Its bundle contains no IDE,
  compiler, or ROM authoring/source-tooling code. The browser boot host may
  inspect the raw TOC for its ROM-label presentation.
- `dist/studio.js` / `.debug.js` with `dist/studio.html`: browser Studio
  artifact. This is the explicit composition root that adds workbench,
  workspace, compiler, and source tooling to the browser host.
- `bmsx_binary_codec` and `bmsx_rom_image`: lower native wire-format targets.
  The machine core uses the binary codec for save-state serialization; product
  hosts and tooling use physical-ROM admission. Neither lower target depends on
  the machine core.
- `libbmsx.a` in its CMake build tree: C++ machine/runtime static library. It
  retains stable physical-ROM byte views and executable-image decode state, but
  owns no path, file mapping or copied host-media buffer and does not
  compile ROM TOC/manifest/asset package loading, Lua module-path tooling, the
  Lua source lexer/parser, BLua32 source-range extraction, symbol sidecars,
  disassembly, or formatted fault presentation. Its CMake target depends only on
  the binary codec, never on ROM admission or either tooling target. Build trees
  never share this target-specific archive.
- `bmsx_host_support`: native presentation support above `libbmsx.a`. It owns
  output resampling, presentation, overlays, software/GLES2 render backends,
  file mapping, and their external-library dependencies. Libretro
  composes this target with `bmsx_core`; none of these objects or link
  dependencies enter the core archive.
- `bmsx_rom_tooling` in native diagnostics/tests builds: ROM TOC records and
  asset-id tokens used by source diagnostics. It depends only on the lower
  wire-format targets; neither it nor its consumers acquire the machine core
  through this dependency.
- `bmsx_blua32_tooling` in native diagnostics-enabled builds: BLua32 source,
  symbol-sidecar, and disassembly tooling. It depends on `bmsx_rom_tooling`, not
  on the machine core.
- `dist/libretro_bmsx.so` / `.dll` / `.dylib`: libretro core entrypoint around the C++ machine runtime.
- `bmsx_libretro_host`: local frontend executable that loads a libretro core and
  owns SDL, ALSA, EGL/fbdev, input devices, screenshots, and the process loop.
- `dist/host_headless.js` / `.debug.js` and `dist/host_cli.js` / `.debug.js`:
  Node player executables/modes that statically compose the machine runtime and
  own their process/runtime environment. Their bundles contain no IDE,
  compiler, ROM tooling, capture runner, or host-test runner.
- `dist/host_headless_tooling.js` / `.debug.js`: explicit Node validation and
  Studio-tooling executable. Timelines, screenshots, host tests, IDE tests, and
  source-aware profiling live here rather than in the ordinary headless player.

The shared player lifecycle and frame loop are owned by `hosts/common/`. The
browser and Node player entrypoints import that lifecycle directly. Studio owns
its separate composition in `ide/workbench/`; only Studio and IDE-test
entrypoints import it.
This is a static dependency boundary, not an optional IDE parameter, callback
provider, or runtime feature switch. Browser and native libretro product roots
own their monotonic presentation clocks; machine
`FrameLoopState` retains only in-flight emulation execution state.

The product host admits the outer physical ROM/header and translates cartridge
package metadata into installed socket media. `Runtime` consumes the system-ROM
bytes and cartridge-media records directly and constructs the one machine-owned
`Memory`; there is no manager or second ROM lifecycle. Admission never decodes
TOC assets, manifests, source registries, symbols, or authoring packages.
Native libretro content owns its mapped ROM backing, parsed physical-image
views, and active `Runtime` as one RAII lifetime; unloading destroys the runtime
before unmapping its ROM spans.
Studio and source-aware profiling explicitly call `rompack/tooling/media.ts`
above that machine initialization boundary. Ordinary browser and Node players
therefore neither allocate authoring layers nor link their decoder graph.

Deployable artifact construction is owned by `scripts/products/`. Browser
player, browser Studio, Node player, Node tooling, machine-library, and
libretro builds are independently invokable product targets; there is no
platform meta-target that silently links player and authoring products
together. Browser deployment builds only the player and a selected prebuilt
cart. Its title comes from that cart's serialized manifest, not from its source
tree. Host-atlas generation is an explicit prerequisite of every product and
browser-deployment target; product modules do not import or execute the atlas
producer. `scripts/rompacker/` owns BIOS/cart source compilation, linking,
assets, and ROM emission and imports no host, IDE, runtime-composition, or
product-build module. Shared CLI and source-scan mechanics live under
`scripts/tooling/` rather than either solution owner.

The compiler and ROM producer depend downward on `machine/{ts,cpp}/spec` and
shared low-level code only. They never import/include `machine/**` or `core/**`
emulator implementation to obtain register words, image layouts, model
constants, CPU values, or firmware identities. The emulator consumes the same
specification leaves independently. This dependency direction is enforced by
`audit:architecture-boundaries:strict`; it is not maintained through re-export
files or an emulator facade.

Do not use `platform` as an architecture category for both `libretro` and
`libretro_host`. `hosts/libretro` is the libretro core entrypoint;
`hosts/libretro_host` is the local frontend executable that can run that core.

## SNES Mini target ABI and toolchain

The SNES Mini build has two deliberately separate roots:

- `.snesmini/sdk-sysroot` is a generated coherent compile SDK. It contains the
  Debian Jessie armhf development files plus a static PIC libstdc++ built by the
  modern cross compiler against those old target headers and libraries. Its
  builder image, Debian snapshot packages, authenticated Jessie archive
  metadata, downloaded package hashes, and complete SDK-producing recipe are
  pinned. Each Docker build returns an immutable image ID; the SDK marker binds
  that exact image ID to the recipe digest, and the CMake toolchain requires the
  same pair. The resulting build-toolchain digest keys both build trees and
  compiler cache, so a changed SDK, compiler, toolchain, or compile-container
  contract cannot reuse stale objects. A publisher lock bridges SDK creation to
  the consumer's shared SDK lock, which remains held through acceptance; the SDK
  cannot be replaced between bootstrap and compile or under a running audit.
- `.snesmini/rootfs` is an imported snapshot of the actual target userspace. It
  copies the complete device root except live pseudo-filesystem contents and is
  used only as the runtime-acceptance authority. Its manifest identifies the
  complete normalized directory, symlink, mode, special-file, and regular-file
  content tree, and is verified again for every acceptance run.

Modern C++ language support therefore does not imply a modern target runtime.
The networkless compile container exposes the repository read-only, masks its
entire `.snesmini` tree, and then mounts only the generated SDK read-only plus
the identity-keyed build tree and compiler cache read-write. Generic distro
headers and target libraries are absent. The imported runtime root is not
mounted at all. The CMake cross-toolchain consumes the SDK directly and links
the target-built libstdc++ and libgcc statically. Missing target symbols are
build failures; the target does not receive compatibility stubs, dummy symbols,
or per-symbol shims.

SNES Mini code generation targets its Cortex-A7 directly with the hard-float
ABI and NEON/VFPv4 instruction set. Release core and direct-host builds enable
link-time optimization; debug builds do not. This is a fixed target-toolchain
contract, not runtime CPU detection or a second renderer profile.

Every produced ARM artifact is audited against the imported runtime root. The
audit verifies ELF32 ARM hard-float, the program interpreter, the complete
transitive `DT_NEEDED` closure, every strong dynamic-symbol reference and its
exact GNU-version provider, the symbols loaded explicitly from EGL/GLES, and
equality between the core export surface and its libretro version map. This is
stronger than checking only dependency or version names. Audit and QEMU run in
a second networkless container with the candidate build tree and runtime root
mounted read-only. Accepted files and their hashes form an immutable release
directory; one atomic `current` symlink publishes the complete core or host
release. SNES Mini output therefore never overwrites the native
`dist/libretro_bmsx.so`.

The core build first force-builds its release BIOS and bare-metal cart directly
into a private per-run output directory. ROM publication is an atomic rename by
the rompacker owner, so concurrent normal builds cannot replace or partially
publish acceptance inputs. Their hashes and the positive frame count are
recorded in the accepted release. QEMU then loads the cross-built libretro core
through the target dynamic loader, loads those private ROMs, selects the
software backend, and executes the requested real frames. This proves the
CPU/userspace ABI and core execution path on a PC. It does not emulate the SNES
Mini framebuffer, evdev devices, Mali GLES driver, audio device, or sustained
target timing; those remain real-hardware acceptance gates.

The operational sequence is:

```bash
npm run import:snesmini-rootfs -- /path/to/extracted-rootfs-or-tar
npm run setup:snesmini
npm run build:platform:libretro-snesmini
npm run build:libretro-host-snesmini
```

`build:platform:libretro-snesmini` includes the ARM ABI audit and QEMU frame
smoke; there is no weaker build-only publication path.

Accepted target releases are available through:

- `dist/snesmini/core/current/libretro_bmsx.so`
- `dist/snesmini/core/current/libretro_bmsx.info`
- `dist/snesmini/host/current/bmsx_libretro_host`
- `acceptance.txt` beside each release's artifacts, containing the immutable
  builder image, toolchain, build type, runtime-root, and artifact identities;
  the core record also contains its ROM hashes and executed frame count.

The core and direct host are separate deployable products. The core can be
installed through the normal libretro-core route. On the SNES Mini, Clover can
instead start `bmsx_libretro_host` directly and pass it that installed core plus
the selected cart ROM. The host is not a shell runner around RetroArch: its ARM
executable is built with the same target SDK, its full runtime closure is
audited against the same imported device root, and QEMU enters its real CLI
through that target loader before publication. Clover's desktop `Exec` field
therefore names the host executable directly; no `/bin/sh` trampoline is part of
the deployment contract.

## Repository and package boundary policy

Keep this repository as one monorepo while TS and C++ machine implementations
need lockstep parity, the public machine API still moves, ROM/BLua32/save-state
wire formats still change, host entrypoints still move with machine internals, and
cross-language parity/golden cases need one CI slice.

Split repositories only after all of these are true:

- `bmsx-machine` / C++ machine libraries have a stable public API.
- Host entrypoints use only that public API, not internal imports/includes.
- ROM, BLua32, and save-state formats are releasable with explicit versions.
- Parity audits and golden cases can run as a published conformance suite.
- External consumers exist that need independent versioning.

The package boundary is `machine`, `hosts`, `tools`, `carts`, and `tests`. Carts are software for the machine, not part of the machine package.
Current `carts/<name>` folders are cart collections with cart-local
resources. If cart source moves during a package split, it should move toward a
top-level `carts/` collection, not under `machine`.

The exception is firmware/source material that ships with the machine runtime:
BIOS, firmware helpers, and default boot/source assets belong under the
machine firmware owner. That is not a general cart collection.

## Machine specification owner

`machine/ts/spec` and `machine/cpp/spec` own the mirrored numeric contracts
shared by machine implementations and build-time producers. Specification files
are dependency leaves: they contain raw words, addresses, bit layouts, opcodes,
register indexes, and architectural timing tables, but no emulator objects,
source-language parsing, diagnostics, host policy, or compatibility facade.
Compiler, linker, disassembler, and CPU consumers import/include these contracts
directly.

The fixed BMSX physical address contract lives in
`machine/{ts,cpp}/spec/bmsx/memory_map.*`. It owns the raw 32-bit ROM, RAM
aperture, cartridge-bus and MMIO addresses plus the fixed reserved-RAM layout.
The selected `MachineModelSpec.ramBytes` is the installed capacity;
`machine/{ts,cpp}/machine/memory/memory.*` allocates that capacity once and uses
its backing length as the physical decode endpoint. Datapaths consume fixed
addresses directly from the specification owner without a CPU or Memory facade.
The BLua32 linker receives an explicit RAM-region capacity from its build
target. Offline ROM builds currently target `PSX_MACHINE_SPEC.ramBytes`; live
IDE builds use the RAM capacity of the running machine. ROM manifests do not
select or resize emulator hardware. Loading a ROM never enlarges the installed
machine; access beyond the selected model's RAM reaches the ordinary
unmapped-bus datapath.

Other numeric specification leaves are split by physical contract:

- BMSX MMIO indexes, cartridge words, ROM package fields, and TOC records:
  `spec/bmsx/io.*`, `cartridge.*`, `rom_package.*`, and `rom_toc.*`;
- BLua32 builtin identities and signed execution-domain ids:
  `spec/blua32/builtin.*` and `execution_domain.*`;
- GX GP0 packet fields and VRAM geometry:
  `spec/gx/gp0.*` and `vram.*`;
- APU register, FIFO, and fixed-point words: `spec/audio/apu.*`;
- IMGDEC register/FIFO words and compressed stream grammar:
  `spec/imgdec/registers.*` and `stream.*`.

Decoded device state, controller phases, parsers, compiler objects, ROM package
objects, diagnostics, and authoring records remain with their behavior owners.
They are not moved into specification files merely because they consume a wire
constant. `audit:core-parity` compares the mirrored numeric leaves as well as
the runtime surfaces that consume them.

The BLua32 ISA contract is:

- instruction-word layout and byte encoding:
  `machine/{ts,cpp}/spec/blua32/instruction_format.*`;
- opcode numbers, decode flags, call-operand encoding, and architectural base
  cycles: `machine/{ts,cpp}/spec/blua32/opcode.*`;
- typed-memory operand numbers and alignment masks:
  `machine/{ts,cpp}/spec/blua32/memory_access_kind.*`;
- numeric `MOD` and `FLOORDIV` opcode semantics shared by CPU execution and
  compile-time folding: `machine/{ts,cpp}/spec/blua32/numeric.*`;
- CP0 register indexes, status/cause words, and Lua-fault reason words:
  `machine/{ts,cpp}/spec/blua32/cop0.*`.

The BLua32 executable-image wire records live in
`machine/{ts,cpp}/spec/blua32/image_format.*`. The BMSX ROM boot-header fields
that locate and enter such an image live in
`machine/{ts,cpp}/spec/bmsx/rom_header.*`. Packers, decoders, and machine
consumers use those numeric contracts directly.

Human-readable opcode names and profiler categories are tooling metadata under
`toolchain/ts/lua/opcode_metadata.ts` and
`machine/cpp/rompack/tooling/opcode_metadata.*`; loading the emulator does not
construct those string tables. BLua source spellings for typed-memory intrinsics
belong to the Lua frontend, not to the numeric machine contract.
`audit:core-parity` compares the TS opcode order, the C++ X-macro order, all
three decode/timing tables, and both tooling string tables entry for entry.

## Mirrored core contract

The TypeScript core under `machine/ts/machine`, the C++ core under
`machine/cpp/machine`, and their specification owners are mirrored
implementations of the same machine.

Rules:

- Core files use the same relative path and basename unless
  `scripts/core_parity_manifest.json` has a narrow explicit exclusion.
- Public constants, register words, opcodes, state records, device methods, and
  save-state fields match by role and representation.
- Runtime representation is not changed to make one language easier. If a value
  is a word, address, opcode, register, fixed-point word, slot, surface id,
  packet field, or render command, it remains that representation.
- `npm run audit:core-parity` is the standing parity audit. Passing it does not
  prove semantic parity; it only proves the mirrored surface is still accounted
  for.

## ROM and BLua32 executable images

ROM data is CPU-visible source material.

Owners:

- Raw ROM package layout: `machine/{ts,cpp}/spec/bmsx/rom_package.*`.
- Raw ROM TOC layout: `machine/{ts,cpp}/spec/bmsx/rom_toc.*`.
- Physical ROM header parsing: `machine/ts/rompack/format.ts` and
  `machine/cpp/rompack/format.h/.cpp`.
- Physical ROM image/header admission: `machine/ts/rompack/image.ts` and
  `machine/cpp/rompack/image.h/.cpp`.
- Physical ROM TOC decoding and wire records: `machine/ts/rompack/toc.ts` and
  `machine/cpp/rompack/toc.h/.cpp`.
- Studio-only ROM asset metadata, package loading, and layered lookup:
  `toolchain/ts/rompack/assets.ts`,
  `toolchain/ts/rompack/loader.ts`,
  `toolchain/ts/rompack/metadata.ts`, and
  `toolchain/ts/rompack/source.ts`. Native fault tooling decodes the
  required TOC and BLua32 records directly and does not construct a parallel
  authoring package.
- BLua32 executable-image wire records:
  `machine/ts/spec/blua32/image_format.ts` and
  `machine/cpp/spec/blua32/image_format.h`.
- BMSX ROM boot-header fields for BLua32 images:
  `machine/ts/spec/bmsx/rom_header.ts` and
  `machine/cpp/spec/bmsx/rom_header.h`.
- Tooling-only decoded image graph:
  `toolchain/ts/rompack/blua32_image.ts` and
  `machine/cpp/rompack/tooling/blua32_image.h/.cpp`.
- Tooling-only system/cartridge package composition:
  `toolchain/ts/rompack/media.ts`.
- Build-time Lua source compilation:
  `toolchain/ts/lua/compiler.ts` and `toolchain/ts/lua/compiler/*`.
- Studio-only layered Lua source registry:
  `ide/runtime/source_registry.ts`.
- BLua32 object linking and ROM-tail writing:
  `toolchain/ts/rompack/blua32_linker.ts` and
  `toolchain/ts/rompack/blua32_tail.ts`.
- Pack-time payload spans, final TOC records, and immutable executable-prefix
  layout: `toolchain/ts/rompack/asset_layout.ts` and
  `toolchain/ts/rompack/rom_prefix_layout.ts`.
- ROM-header serialization shared by the packer and tail rebuilder:
  `toolchain/ts/rompack/header_encode.ts`.

The ROM package and BLua32 image use the current wire records only. There is no
old-format reader and no decode path for obsolete records.

`Blua32ImageLayout` is a tooling representation for inspection, disassembly,
linking, and hot-resume relocation. It is not part of the runtime execution
address space or either CPU implementation.

Every top-level ROM section and every independently stored main, compiled,
texture, and collision payload begins on a four-byte boundary. The producer inserts zero padding
between top-level sections and between aligned asset ranges. Inter-section
padding falls outside section lengths; inter-asset padding occupies data-section
space but is excluded from each asset's declared length. Generated `bmsx/assets`
payload addresses can therefore feed typed CPU word loads directly. Per-entry
metadata remains byte-packed inside the aligned metadata section: its
`metabuffer` offsets are byte addresses, and consumers decode multibyte fields
through little-endian byte reads. Values inside an individual packed format
likewise remain byte-packed. The producer does not insert padding inside a
format, and consumers do not weaken CPU alignment or infer alternate layouts.

ROM tooling package records describe ROM payloads; they do not own duplicate
audio, atlas, or binary payload bytes. Studio may decode those records for
authoring views. The active machine keeps one CPU-visible ROM backing per loaded
medium; there is no parallel manager-owned copy. Native path-based libretro
loads use read-only mapped files for that backing; memory-buffer frontends own
their input bytes for the runtime lifetime. Node headless consumes the
`fs.readFile` buffer directly. Guest code moves bytes from ROM to RAM/VRAM/APU
through the machine; the Lua engine must not cache asset payload copies behind
the cart's back.
Every ROM file starts with the current BMSX header at byte zero and remains its
exact raw file length in memory. There is no prepended ROM-label PNG, whole-ROM
compression, normalize/decompress stage, or allocation sized to the address
aperture. The ROM label is an ordinary TOC asset. Texture streams use IMGDEC's
`IMD1` format and audio uses its own codec where applicable; those asset
datapaths do not turn the complete cartridge into a compressed container.

Compiled BLua is executable source material, not mutable machine state. BLua is
the source dialect; BLua32 is BMSX's 32-bit instruction set and is not PUC-Lua
bytecode. Compiler constants are the source-level scalar set
`nil | boolean | number | string`; the compiler never constructs CPU `Value`
objects, uses the runtime string pool, or classifies values through host object
identity. It emits a tooling-owned BLua32 object with relocations. The ROM
packer resolves those relocations at the actual physical `SYSTEM_ROM` or
`CART_ROM` addresses and emits the final bytes; neither runtime owns a linker.

One source chunk in each system or cartridge program declares
`module<entry>`. The compiler requires exactly one such root and synthesizes the
section initializer and reset trampoline around that chunk. The linker resolves
the resulting reset proto to the physical startup address stored in the ROM
header. `entry_path`, `rom_name`, and browser `short_name` are therefore not
executable ROM-manifest fields: the first is derived by tooling from
`module<entry>`, the second is a build-output identity, and the third belongs
to browser-product packaging. The serialized cart manifest keeps
author/cart facts such as its title and physical cartridge-board construction;
it does not select executable source.

The packer emits one immutable prefix: ordinary asset payload spans, per-entry
metadata, and the manifest. It derives final TOC records from that layout
without using build-input assets as mutable offset storage. A cart texture group
owns one explicit `texture` TOC entry and one compressed `IMD1` payload span.
Each image entry owns only its image metadata, including `gx_texture_resid` and
its local texture coordinates; images never impersonate owners of a shared
physical span. A model may still own its own auxiliary texture span as part of
that model entry. The file writer consumes completed spans; it does not
interpret payload kinds or publish TOC fields while performing I/O.

The guest firmware directory and the ROM inspector consume texture TOC entries
directly. Host runtime packages deliberately do not decode, copy, or cache cart
texture records: the ROM bytes remain the single payload owner until guest DMA
or an explicit tooling inspection reads them.

`__blua32__` begins the deliberately mutable executable tail after that prefix.
It is one ordinary TOC payload containing a fixed binary image; it has no
generic serializer descriptor and no parallel compiled range.
`__blua32_symbols__`, when present, follows it and contains tooling metadata
only. The movable TOC follows the executable tail. Hot Resume therefore
replaces only the ROM header, executable bytes, symbols, and TOC; asset,
metadata, and manifest addresses remain unchanged.

The outer ROM header exposes the executable without a TOC lookup:

| Header byte | Word |
| ---: | --- |
| `32` | `__blua32__` byte offset in this physical ROM; zero means no executable image. |
| `36` | `__blua32__` byte count. |
| `40` | Startup function-record address. |
| `44` | IRQ function-record address. |
| `48` | Exception function-record address. |
| `52` | Static-layout token low word. |
| `56` | Static-layout token high word. |
| `60` | Reserved, zero. |

All addresses above are absolute CPU byte addresses. The current BLua32 image
header is 96 little-endian bytes:

| Byte | Field |
| ---: | --- |
| `0` | `BL32` magic. |
| `4` | Image-format version. |
| `8` | Complete image byte count. |
| `12` | Flags; currently zero. |
| `16`, `20` | Absolute function-table address and record count. |
| `24`, `28` | Absolute constant-table address and record count. |
| `32`, `36` | Absolute ordinary-global name table and count. |
| `40`, `44` | Absolute system-global name table and count. |
| `48`, `52` | Absolute shared-string bytes and byte count. |
| `56`, `60` | Absolute `.rodata` bytes and byte count. |
| `64`, `68` | Absolute `.data` load image and byte count. |
| `72` | Writable `.data` VMA. |
| `76`, `80` | Writable `.bss` VMA and byte count. |
| `84`, `88` | Absolute text address and byte count. |
| `92` | Reserved zero word. |

Each 32-byte function record is 16-byte aligned and contains, in order, the
absolute code address, code byte count, parameter count, maximum register
count, raw function flags, absolute upvalue-table address, upvalue count, and
one reserved word. A function record's physical address is the function's
runtime identity. `CLOSURE` stores that address shifted right by four; its
`WIDE` form covers every function record in the system and cartridge ROM
windows. A four-byte upvalue word uses bit 31 for `in-stack` and bits 30--0 for
the slot index.

Each constant record is 16 bytes. Its first word selects nil, false, true,
64-bit number, or string. Number payloads are little-endian binary64. String
payloads contain an absolute address and byte count into the shared string
bytes. Each global-name record is eight bytes with the same absolute string
address and byte count. Global names are part of the Lua slot ABI; source paths,
debug function ids, lexical ranges, local names, and workspace state are not.

The image is laid out as header, `.rodata`, `.data` load bytes, function table,
upvalue words, constant table, global-name tables, shared strings, and text,
with the declared alignments. Keeping the static sections directly after the
fixed header makes their physical addresses depend only on the static layout,
not on edits that add functions, constants, global names, or text. Text
contains the existing BLua32 instruction words unchanged. `.bss` owns no ROM
payload.

`Memory` owns the installed system ROM and both cartridge ROMs and binds direct
read-only views into those regions. `Machine` owns one
`ExecutionAddressSpace`, wired directly to `Memory` and borrowed by the CPU. It
selects the executable bus domain and reads only the raw outer boot words. The
CPU consumes the system reset word into root execution state, retains the
system exception word as a CPU latch, retains the raw IRQ word with each
resident domain, activates the system image at reset, and activates a
cartridge image only when execution first targets the currently selected
socket. The resident execution image does not retain an outer ROM DTO, image
byte copy, decoded layout, or static-layout token.

Activation binds the fixed physical image header once and latches its raw
function-table and text addresses and counts on the resident execution image.
It binds the physical constant and global-name record tables and materializes
only the guest constant registerfile and immutable instruction-operand-to-global
slot maps. String payloads are interned from their physical ROM addresses. It
binds the complete physical text span once and derives dense decoded instruction
pages directly from those instruction words; no copied raw instruction buffer
remains. It scans physical function records to create canonical static
closures. Merely inserting or replacing an unexecuted second cartridge
therefore cannot consume guest string or object identities or change table
iteration. A call frame retains its physical function-record address, physical
PC, execution domain, and the raw code bounds latched from that function
record. Instruction fetch subtracts the resident image's latched raw text
address and indexes the activated dense decoded page. It performs no memory-map
classification, TOC lookup, string lookup, allocation, parser work or
activation check per instruction.

Function entry and `CLOSURE` bind one complete raw function record through the
physical execution address space into one CPU-owned scratch latch; `CLOSURE`
likewise binds its complete raw upvalue table once. There is no resident
runtime-function array or per-image static-closure index. `LOADK` and RK
operands index the guest constant registerfile owned by the frame's resident
image. Static closures are retained CPU objects keyed by physical
function-record address. Table-load inline caches are allocated only for actual
table-load instructions. Guest constant registers, global-slot maps, decoded
instruction pages, and inline caches are regenerated only when suspended
tooling explicitly replaces an affected resident execution image after the ROM
owner installs new bytes. They are never serialized. No decoded host image
graph determines CPU execution.

A closure value owns only its raw physical function-record address and captured
upvalues. Entering a cartridge closure resolves that address once through the
current `CP0.EXEC` cartridge-socket latch and retains the resulting image only
on the new call frame for instruction fetch. The closure itself never pins a
socket or decoded image. Therefore the same cartridge address deterministically
names the function in the currently execution-latched socket before and after
save-state restore.

TypeScript source builds and source registries stay on the compiler/rompack
side and enter the machine through the same raw image boundary as native.
Stripping `__blua32_symbols__` removes source ranges, local-slot names, upvalue
names, and Hot-Resume maps; it does not change physical executable bytes,
vectors, global slots, boot, or restore behavior.

Release ROMs omit `__blua32_symbols__`. The system build publishes the encoded
system symbols beside its ROM as `<system-rom>.blua32-symbols`; the cartridge
linker consumes that build artifact while resolving firmware calls. Debug ROMs
also embed the symbols asset for the debugger and Hot Resume. The sidecar is
never mounted, mapped, copied or decoded by the emulated machine, and
cartridges do not carry a duplicate of the firmware symbols.

ROM asset symbols are a compile/link contract, not a runtime registry. The
rompack owner emits the generated const module `bmsx/assets`; the compiler
recognises that module as compile-time only and inlines exported constants at
each use site. The module never produces a runtime Lua table, module function,
global slot, or `require` call in executable cart code. Using the module root as
a value is a compile-time error; cart code must read concrete exports such as
`assets.data_transition_config_addr` and `assets.data_transition_config_len`.
Do not add a `rom_asset("name")`-style API, even as a compile-time builtin: the
cart-visible contract is plain address/length/bank symbols, not a string lookup,
registry object, or `{ addr, len }` value.

Asset symbol names are generated as `<asset-type>_<asset-id>_{addr,len}` after
sanitising non-alphanumeric characters to underscores and prefixing a leading
digit with an underscore. Public symbols are generated for ROM-backed asset
records except Lua/code records and the ROM label. Address values are absolute
CPU-visible ROM addresses: `SYSTEM_ROM_BASE` or `CART_ROM_BASE` plus the record
offset in the corresponding ROM payload. The pack layout produces the final
TOC records before BLua32 compilation; `bmsx/assets` consumes those same
records, and the TOC encoder later serializes them without recomputing offsets.
There is no parallel writer-owned layout or duplicate verification pass. Length
values are byte counts.
`rominspector.ts
--asset-symbols` prints the generated symbol table so the ROM address ABI can be
checked without disassembling BLua32 code.

Schema-rich content, such as story graphs with dialogue nodes, choices, combat
rounds, rewards, strings, and `next` links, is owned by a schema-specific asset
producer. The compiler must not become a general serializer for arbitrary Lua
const aggregates. The producer validates the schema and emits immutable ROM
bytes plus named symbols; runtime/game code consumes those concrete
address/length symbols through the content reader.

Decoding schema-rich payloads once at cart initialization through
address/length symbols is an acceptable cold authoring-data path. The platform
does not mandate fixed binary layouts for every map, room, timeline, registry,
or asset record. Fixed layouts become a machine/tooling contract only when a
concrete asset producer and hot/runtime consumer require that contract.

BLua32 objects exist only between compiler and ROM-building/Hot-Resume tooling.
Symbolic module, static-function, section-address, constant, global-slot, and
indexed-operand relocations are resolved before bytes are installed. They never
become placeholder Lua values or mutable machine state. Cartridge objects link
against the firmware image's published global-slot ABI and physical static
function addresses; system and cartridge code, constants, and functions remain
separate physical domains.

The compiler emits a startup function that performs section initialization,
initializes statically required modules in dependency order, clears the
firmware-only boot primitives where applicable, calls the source entry, and
returns. On cold reset the CPU resolves and activates the system domain and
enters the raw reset-vector word in supervisor mode. Host runtime code
may bind native primitives before scheduling that frame, but it never reads,
returns, or passes the startup address.
Firmware inspects the raw cartridge headers through `CART_SELECT` and transfers
to the selected cartridge startup address through the privileged `CP0.EXEC`
control word. The host never calls a cartridge entry or assembles a combined
execution namespace.

Hot Resume remains an IDE-only authoring facility above this machine contract.
It compiles a source-backed medium once, rebuilds its physical executable tail,
and installs that media through the ROM owner. Existing heap objects, globals,
closures, frames, module state, RAM, devices, and audio remain live. The
linker keeps every known function id in its previous physical function-record
slot for the lifetime of that development lineage. A removed function leaves a
record that retains its closure layout and enters a one-word hard-halt
tombstone; a new function id appends after the existing high-water mark, and
reinserting the removed id restores its original slot. Slots are never reused
for a different identity while live closures may still exist. An ordinary cold
ROM build has no previous lineage and emits a compact table.

The tooling sidecar maps only compatible sequence points into the revised text.
Closure addresses do not move and the CPU does not traverse or rewrite the Lua
heap. Before the ROM owner installs any rebuilt bytes, IDE tooling walks the
suspended CPU through scalar physical-state primitives and proves a complete
relocation for every active frame function address and continuation PC, every
child-frame callsite in its parent execution domain, the active exception
`EPC`, a nested NMI return `EPC`, and the latched instruction domain/PC pair.
A missing map rejects the edit before any media or CPU state write.

After that proof, the ROM owner installs the rebuilt physical media. IDE
tooling reads CPU-owned execution-domain residency before asking the
machine-owned execution address space to decode an affected domain, the CPU
replaces that domain's derived execution state, and IDE tooling applies the
precomputed raw frame and latch words. Compatible active
frames bind to the new physical function records and grow register storage when
required. The CPU fetch path remains the ordinary physical-address path and
gains no authoring-time branch, source revision, linker baseline, lookup,
parser, or allocation. No old executable image or development-tail buffer
remains an execution owner. Save-state retains only the current raw machine
state and restores it against the media inserted at restore time.

The TypeScript and C++ memory and cartridge owners expose the same suspended
raw-media replacement operations. Replacing media only changes the backing byte
view; the owners retain no source identity, generation counter, decoded image,
or tooling callback.

Hot Resume does not perform a cold boot, run the startup vector, section
initialization, static module initialization, or `new_game`. It reruns `init`
so registration-owned handlers publish changed code. Captured-upvalue layout,
static-closure identity mode, or static-storage layout changes are incompatible
revisions. Incompatibility is reported to the IDE; it never becomes an implicit
reboot, rollback, or legacy fallback.

BLua sections are machine storage, not runtime metadata. Firmware `.rodata` and
`.data` load bytes live in `SYSTEM_ROM`; cartridge `.rodata` and `.data` load
bytes live in `CART_ROM`. `.data` has its writable VMA in RAM and `.bss` is
zeroed RAM storage. BLua declarations create typed storage symbols and startup
code copies `.data` from its physical ROM LMA and zeros `.bss` with ordinary CPU
memory operations. Runtime and rompacker do not initialize those RAM sections
on behalf of guest code.
Initialized `.rodata` and `.data` arrays may infer their outer count from one
exact initializer, and initialized records use the declared struct layout
directly. Immutable `string` fields are `.rodata` const-pool references: the
object image records a relocation for each reference, the linker remaps those
words, and `LOADKR` loads the referenced interned string without constructing a
table or string at the field access. String fields are not writable words and
are not valid in `.data` or `.bss`. A static array's `#` is its resolved type
dimension, not runtime length metadata.
Cart library numeric latches that model machine words over time use section
storage too: AEM keeps request/source/slot words and per-slot active
source/priority arrays in `.bss`, while Lua tables remain only for actual
event records and queued play objects.
Scalar section symbols are pointers to one typed cell: firmware and cart code
read/write them with `*symbol`. Indexing is for actual arrays and structs, not
for pretending a scalar word is a one-element array.

Const modules are the static symbol ABI. They export constants, section symbols,
and function text-symbols without producing a runtime module table, module function,
global slot, or runtime `require` call. Function text-symbols are call targets
only: const aliases may name them for direct calls, but they are not Lua runtime
values and cannot be stored in tables, assigned to dynamic locals, or returned as
gameplay objects. Static calls resolve through `export_proto` symbols. Dynamic
module value reads and calls load fields from the live root table; module slots
hold module roots, not initialization-time copies of mutable fields. This keeps
ordinary Lua table and function semantics where gameplay deliberately chooses
the dynamic lane. A `<const>` local fixes only that local binding; it does not
turn the required module or any of its fields into a static ABI.
Every const module declares `module<const>` in its own BLua source. Generated
packer modules emit the same declaration at their producer. Packed builds and
debug source recompilation therefore consume one source-owned contract; the
rompacker, TOC and host do not maintain a second module-name or attribute list.

## Memory, CPU, and scheduler

- `Memory` owns RAM, ROM windows, IO slots, and MMIO callback dispatch.
- Every IO slot and device callback carries one raw unsigned 32-bit bus word.
  IO state is therefore neither a Lua `Value` store nor a GC root set. A CPU
  `Word` load boxes the returned register word once at the CPU boundary;
  a CPU `Word` store converts its numeric register lane once before MMIO
  dispatch. Typed `U32LE` and DMA transactions already cross that boundary as
  raw words and do not box and unbox again inside devices.
- The CPU consumes instruction words and runtime values directly from the mapped
  machine representation.
- Reserved opcodes, malformed standalone `WIDE` prefix words, invalid physical
  function records, and branch skips past the active function text do not
  become host exceptions. The CPU latches a hard-halt state, stops accepting
  IRQs, and stays stopped until reset starts it again.
- Emulator invariant failures remain host failures. A frontend stops its host
  run and may inspect the unchanged machine for diagnostics; it does not clear
  CPU/input/frame state, inject a guest fault, or serialize a host-failure latch
  into the runtime save state. Studio retains its error snapshot in IDE state.
- Typed memory, numeric, and ordering datapaths decode each producer-owned
  register/RK tag and payload once. A `Number` tag exposes its scalar lane;
  tagged non-number values behave as a NaN operand. Number producers
  canonicalize NaNs before storing guest values. The packed C++ representation
  may consume a tagged qNaN word directly where its payload is unobservable;
  typed floating stores canonicalize that word at the guest-memory boundary.
  Ordering compares interned strings only when both tags are `String`. This is
  guest representation decode, not host-value classification or repeated
  validation.
- `HALT` is an interrupt-event wait, not an unconditional sleep for a future
  edge. The CPU has one event latch. An asynchronous interrupt accepted while
  code is active sets it; `HALT` consumes a set latch without parking. If no
  event is latched, the CPU parks until an accepted interrupt. An interrupt that
  wakes an already parked CPU consumes its event in the wake transition. This
  makes sequence-latch IRQ waits lossless across the condition-to-`HALT`
  instruction window without polling or host scheduling.
- Host/native
  closure entry does not wake it and does not throw. If an entered external
  closure executes `HALT` and no interrupt is scheduled, the host call stops with
  the CPU still parked and the stopped frame intact instead of converting that
  state into a host exception or fast-forwarding device time outside the frame
  scheduler.
- `pcall` and `xpcall` are retained Lua-CPU microcode, not BIOS algorithms and
  not recursive host interpreter calls. BIOS ROM only installs their guest
  bindings. A protected invocation retains its caller, target, return window,
  and optional handler across ordinary cycle-budget yields, `HALT`, blocked
  MMIO, and save/restore. Lua returns and Lua errors complete that continuation;
  a supervisor exception frame is a strict barrier and remains hardware state.
  A hard halt or parked target therefore stays stopped instead of being
  converted into a fabricated Lua result. `xpcall` validates its handler before
  arming the continuation or executing the body. A handled body error produces
  exactly `false` plus the handler's first result, using `nil` when the handler
  returns nothing and discarding further results; a handler error produces the
  stable Lua error value `error in error handling`.
- Host/IDE closure entry is permitted only while the CPU is suspended outside
  an active scheduler slice. Native code cannot recursively run the Lua CPU
  inside an executing instruction. `Runtime` is the sole owner of
  scheduler-aware external execution: it grants ordinary CPU slices and
  advances device deadlines. IDE tooling invokes that core primitive and never
  runs a second scheduler loop that can cross an APU, GPU, DMA, or IRQ edge
  differently. External slices obey the system-controller CPU hold, GPU
  machine-block fence, MMIO interlocks, and ordinary CPU interrupt entry.
  Interrupts therefore vector through the retained `STATUS`, `CAUSE`, and
  `EPC` words; the CPU has no host-call mode that suppresses them. External
  execution advances physical machine time without consuming the suspended
  slice's retained instruction budget. A host failure ends the scheduler slice
  but does not unwind physical call or exception frames as rollback.
- A completion call sets a physical return-route bit on its call frame. `RET`
  writes the CPU-owned retained completion latch, and `Runtime` exposes that
  latch plus whether its physical return route is still present. C++ borrows
  the packed latch span directly; TypeScript marshals it into one retained cold
  boundary array which is cleared at call entry, reset, and restore. The route
  bit and latch are save-state data; neither CPU uses a host result buffer as
  guest state or a heap root.
- Emulator tooling may inspect or edit a suspended CPU through allocation-free
  scalar primitives for raw frame domains, function-record addresses,
  continuation and callsite PCs, exception-frame flags, live registers,
  resolved upvalues, the last fetched instruction's raw domain/PC latches,
  and exception-return latches. The CPU does not allocate a debug snapshot,
  derive function indexes or source locations, format a stack trace, retain
  symbols, or know why tooling writes those physical words.
- The frame scheduler owns CPU/device advancement. Each accepted host delta is
  granted once as exact rational CPU cycles, with both the fractional remainder
  and unused whole-cycle carry retained; PCRTC frequency or `SINT` never becomes
  a CPU wall clock.
  The host frame pump may request work, but it does not own device transitions.
- PCRTC owns HSync, VSync, FIELD and VBlank timing. VBlank is a machine edge,
  not a timer invented by the runtime. Devices with VBlank behavior expose
  explicit edge methods and latch/commit their own state there.
- Device deadlines may be absolute cycle zero. An overdue PCRTC service batches
  repeated periodic beam events arithmetically instead of looping per half-line,
  but every retained latch reaches the same deterministic final state.

The static cart ABI uses words, registers, addresses, sections, memory, and
symbols as the primary representation. Static storage crosses module boundaries
as section symbols and typed addresses; static function exports cross those
boundaries as physical function addresses; typed memory and numeric opcodes consume the
register/RK lanes directly as machine data. Dynamic Lua values likewise retain
their producer-owned guest tag and payload. C++ carries that state in one packed
value word; TypeScript carries parallel tag, scalar, and table/closure-reference
lanes through registers, constants, globals, upvalues, completion values, table
storage, and builtin transport. A host `Value` object/union exists only while
marshalling at an explicit cold runtime or tooling boundary, in either
direction; it is never guest identity or hot-path transport.

Lua tables are VM-owned data structures, not host collection wrappers. Their
representation follows the usual array-part/hash-part split: integer sequence
keys live in the array part, while the hash part stores key, value, and next-link
columns. The C++ runtime keeps those columns in one table-owned contiguous
allocation; the TypeScript runtime uses parallel arrays plus an `Int32Array`
next column so hash capacity does not materialize one JavaScript object per
slot. Save-state still serializes hash nodes as schema data at the persistence
boundary, but steady-state table storage is columnar.
Table rehash counts integer-key bins in VM-owned scratch/stack storage; growing
or reshaping a table must not allocate a temporary count array/vector on every
rehash.
The collector consumes a table metatable's `__mode` directly. Weak values do
not become roots, weak keys use ephemeron convergence, and strings retain
Lua's non-removable weak-table behavior. Canonical static closures are
CPU-owned non-heap values; only dynamic closures participate in heap
liveness. Collector worklists are retained CPU/heap scratch, active builtin
result scratch is rooted, inactive TypeScript scratch releases its reference
lanes, and decoded table-load caches are invalidated rather than becoming
hidden roots.

Clearing a weak hash entry preserves the hash chain and the identity needed by
`next`. Non-object keys remain in the key column beside an empty value.
Table and closure keys become a dead-key identity word in the otherwise hidden
value column. Ordinary lookup and traversal skip both forms;
`next` alone matches the dead identity, mutation compacts dead nodes before
reclassifying array/hash ownership, and save-state preserves the raw columns
and advances the object-id producer past both live and dead identities.

Lua closures own their captured upvalue slots as VM closure storage. In C++,
captured-closure upvalue pointers are tail storage in the same GC allocation as
the closure object, not a separate `std::vector` allocation. Static/root
closures have no captured slots; the C++ CPU keeps them in CPU-owned indexed
storage with stable closure addresses instead of allocating them as GC heap
objects. TypeScript keeps the same boundary with `Closure` instances, dense
`Upvalue[]` closure slots, and a required `heapBytes` word on every closure, so
heap accounting consumes the producer-owned closure representation directly.
Save-state serializes closure upvalue references as object ids at the
persistence boundary. Each closure record also retains whether the object is
the CPU-owned canonical static closure or a dynamic closure, so cartridge
slots with different function flags at the same raw address cannot merge or
split object identity during restore. It does not expose either runtime's
closure slot storage shape.
Open upvalues form an intrusive list owned by the call frame whose registers
they reference, ordered by register index. Capturing the same slot reuses that
upvalue; frame exit detaches and closes only that frame's list. GC and
save-state traverse the frame-owned links, so return dispatch never scans or
compacts unrelated open upvalues.
Snapshot object ids are reserved before an object's child values are captured,
so cyclic/shared Lua table graphs stay object graphs rather than path lookups or
duplicated tree materialisation.
Object-key hashing follows the value representation. Guest tables and closures
receive a producer-owned identity word when created, and save-state restores
that identity. Upvalues remain GC-owned closure cells rather than guest values
or table keys. Table lookup and snapshot traversal do not keep separate side
tables.
Table save-state stores the table hash columns and free cursor because Lua
iteration observes the current bucket walk. Restore rehydrates the owner-owned
columns directly so `next` resumes the same table order after state replay.

Core VM builtins (`next`, `type`, `rawget`, `pcall`, string byte/char, and the
other BIOS-captured primitives) are fixed VM primitive slots/singletons. They
are not native host callbacks, are not GC heap allocations, and do not
contribute to Lua heap accounting; guest-visible names are ordinary globals
pointing at those fixed VM primitive values. Save-state serializes their
`BuiltinFunctionId`, not a global/module path. The CPU value set is closed:
arbitrary host functions and host objects have no value tag, allocation path,
dispatch branch, GC path, or save-state representation. Studio language tooling
may copy plain data into ordinary guest tables and inspect guest tables and
closures, but it cannot inject host callbacks or opaque host objects into the
machine.
Builtin argument transport is a borrowed VM register/result view. C++
`BuiltinArgsView` exposes direct indexed access over the caller-owned value
span; it does not carry a checked `at()`/exception path in builtin dispatch.
TypeScript uses a retained `ValueSlots` view plus caller-owned base and supplied
length, not a `Proxy`-backed array facade or host-value decoder. Each builtin
chooses supplied or Lua nil-filled arguments once, then consumes tag, scalar,
and reference lanes directly. Neither runtime materializes an argument array or
per-value DTO per call.

System firmware and cartridge BLua32 bytes live in their ordinary physical ROM
assets. Guest loads observe the raw `__blua32__` image through `SYSTEM_ROM` or
`CART_ROM`, including function/constant records, `.rodata`, `.data` load bytes,
and text. There is no third executable address window, combined host-owned
instruction buffer, or runtime relocation write into either ROM. Decoded
instructions, runtime constant values, function-record indexes, interned global
names, static closures, and inline caches are derived CPU state. Debug/source
metadata remains a separate optional tooling asset.

System ROM has its own CPU-visible window. The two cartridge sockets share one
external address/data bus and therefore one CPU aperture; `CART_SELECT.bit0`
drives `/CS0` or `/CS1` rather than selecting a host-side ROM facade. For every
mapped ROM window, the selected backing payload may be shorter than the window
or absent; bytes beyond the backing read as zero through the bus. A cartridge
payload larger than its physical 512 MiB ROM window is rejected at the ROM
loader and producer boundaries rather than aliasing into cartridge RAM or
MMIO. The memory owner exposes immutable ROM residency by binding
caller-owned retained byte views only for ranges fully backed by the addressed
system-ROM or explicitly selected cartridge-socket payload. It does not
allocate or return fresh view/span objects on device load paths, and an empty
or zero-filled window tail is not immutable backing.

## Save-state contract

Save-state captures deterministic machine state, not host conveniences.

Saved:

- CPU registers, stack/frame/root runtime values, string pool ownership, RAM/IO
  state, the monotonic scheduler cycle, rational host-cycle grant remainder,
  unused whole-cycle carry, the coalesced pending tick-completion latch, device
  registerfiles/latches/FIFOs/buffers, and device-visible memory.
- Closures and frames identify BLua32 functions by raw physical function-record
  address and retain physical PCs. Restore rebuilds decode images from the
  inserted ROM media and reconnects those addresses; it does not serialize
  decoded instructions, function indexes, source paths, or tooling symbols.
- GX GPU raw register words, GP0 packet assembly, retained command-buffer state,
  the selected model's installed raw VRAM, transfer/readback latches, PCRTC
  active and presentation words, CSR/IMR, beam
  offset/remainder/half-line/stage/VBlank state, and the pending presentation
  latch that determines future output.
- APU command/source/output state that determines future audio output,
  including the command FIFO ring, queued parameter latch words, active AOUT
  voice cursor/remainder, signed-Q12 gain/fade datapath, filter history, and
  BADP decoder state.
- GEO command/result/fault state and device-visible scratch/result memory.
- ICU raw registerfile, sample arm/sequence/last-cycle latches, and previous
  supervisor-request level.

Not saved:

- host windows, WebGL/SDL handles, browser objects, editor state, build caches,
  parser caches, derived lookup tables, scratch arrays that are fully rebuilt
  from saved device state, and output queues that belong only to a host backend.

Save-state bytes start with the current property-table payload. There is no
format-version field, old reader, or migration path. Aggregate machine
save-state records live in
`machine/save_state` on both runtimes. IRQ and ICU save-state contracts live in
dedicated `machine/devices/irq/save_state` and
`machine/devices/input/save_state` files on both runtimes; C++ keeps those
capture/restore bodies in the matching save-state translation units.

TS and C++ codecs encode the exact current-format payload; the machine codec
does not invent or enforce a padded capacity. Libretro separately owns the
frontend transport envelope required by its stable-size callback: an 8-byte
header, a 16 MiB base payload area and the installed cartridge-RAM byte count.
The header records the actual payload length. The core captures and encodes
once, writes directly into that frontend buffer and clears its unused suffix;
it does not retain another envelope. This transport capacity is not machine
RAM, GX VRAM or part of the save-state wire format.
An asynchronous accelerated readback submission is backend infrastructure, not
a wire phase: capture publishes only the corresponding machine request or its
completed retained pixel bytes, and a completion from an older generation
cannot mutate restored state.

## Device contracts

### Memory map and bus faults

The mapped-memory bus exposes sticky fault registers for the first visible bus
fault: code, address, access flags, and acknowledgement. The register addresses
are MMIO words; fault codes and access flags are machine ABI values. ABI values
are documented constants, not runtime-injected Lua globals. Cart code that
tests them defines the constants it uses.

Bus fault registers:

| Register | Address | Meaning |
| --- | ---: | --- |
| `BUS_FAULT_CODE` | `0x08010204` | Sticky fault code for the first visible bus fault. |
| `BUS_FAULT_ADDR` | `0x08010208` | Address captured with the sticky bus fault. |
| `BUS_FAULT_ACCESS` | `0x0801020c` | Access flags captured with the sticky bus fault. |
| `BUS_FAULT_ACK` | `0x08010210` | Write nonzero to clear the sticky bus fault. |

Bus fault code values:

| Name | Value | Meaning |
| --- | ---: | --- |
| `BUS_FAULT_NONE` | `0` | No bus fault is latched. |
| `BUS_FAULT_UNMAPPED` | `1` | The mapped-memory access targeted no mapped bus owner. |
| `BUS_FAULT_UNALIGNED_IO` | `2` | A non-word access targeted word-only MMIO. |
| `BUS_FAULT_READ_ONLY` | `3` | A mapped-memory write targeted a read-only MMIO register. |

Bus fault access flag values:

| Name | Value | Meaning |
| --- | ---: | --- |
| `BUS_FAULT_ACCESS_READ` | `0x0001` | The access was a read. |
| `BUS_FAULT_ACCESS_WRITE` | `0x0002` | The access was a write. |
| `BUS_FAULT_ACCESS_U8` | `0x0100` | The access width was byte. |
| `BUS_FAULT_ACCESS_U16` | `0x0200` | The access width was little-endian 16-bit. |
| `BUS_FAULT_ACCESS_U32` | `0x0400` | The access width was little-endian 32-bit. |
| `BUS_FAULT_ACCESS_WORD` | `0x0800` | The access width was Lua word. |
| `BUS_FAULT_ACCESS_F32` | `0x1000` | The access width was little-endian 32-bit float. |
| `BUS_FAULT_ACCESS_F64` | `0x2000` | The access width was little-endian 64-bit float. |

The access-width flag describes the CPU or device transaction, not an internal
host load used to carry its bits. A mapped `F32LE` transaction therefore
latches `BUS_FAULT_ACCESS_F32`, and either 32-bit bus cycle of an `F64LE`
transaction latches `BUS_FAULT_ACCESS_F64`. An `F64LE` transaction does not
issue its second bus cycle when the first cycle faults.

### IRQ

IRQ is a machine device with flag/status words. Devices raise/clear IRQ state
through the IRQ owner. Cart-originated faults surface as status/fault bits and
IRQ flags when the device contract says so; they do not escape as host
exceptions. IRQ save-state is the pending flag word plus `IRQ_MASK`, owned by
`machine/devices/irq/save_state`.

IRQ exposes three MMIO registers. IRQ register addresses and flag bits are machine
ABI values; they are documented constants, not runtime-injected Lua globals.
Cart and firmware code that tests or acknowledges them defines the constants it
uses.

The system and selected-cartridge ROM headers carry physical IRQ and exception
function-record addresses. On a guest-domain `HALT` or guest instruction
boundary, an asserted unmasked maskable IRQ line makes the CPU push the selected
generated IRQ root above the interrupted frame. That root calls the image's
`irq(flags)` handler and ends
in `RFE`; an ordinary Lua return only returns to the root. Host/debugger closure
calls obey the same pending IRQ/NMI entry before their next instruction; they do
not bypass or suppress physical vectors. The NMI line and system exception
vector exist at the CPU boundary; the ICU asserts the manual system line from
the rising edge of its dedicated supervisor-request input at VBlank.

The cart-facing IRQ gate is `IRQ_MASK`, a per-source bitmask with the same bit
layout as `IRQ_FLAGS`. It resets to `0`, so cold boot starts with no source
vectoring. Firmware and carts unmask only the sources they handle asynchronously.
The boot ROM masks all sources again immediately before handing control to a
cart, so firmware-owned mask bits never leak into the cart reset vector.
The CPU-wide maskable gate is raw `STATUS.IEc`. Exception entry pushes the
`STATUS` mode stack and clears current interrupt enable; `RFE` restores the
previous pair. A line vectors when both layers allow it: `STATUS.IEc` is set and
`(IRQ_FLAGS & IRQ_MASK) != 0`. A pending source is accepted at the first guest
instruction boundary after its mask bit is written, with no delayed-EI extra
instruction.

The compiler-generated IRQ vector reads `IRQ_FLAGS` and calls the source-defined
`irq(flags)` handler when bits are pending. Firmware compilation binds the
BIOS `irq` and `exception` handlers through `SETSYS`/`GETSYS`; cart compilation
binds the same source names through ordinary `SETGL`/`GETGL`. The compile domain
is explicit at every firmware, cartridge, and IDE media-build producer. Existing
final-image metadata cannot grant a cart access to a system slot.

The CPU stores system and ordinary global slots in distinct registerfiles.
Ordinary slots synchronize with the Lua globals table; system slots do not.
Cartridge handoff and IDE media replacement preserve system slots by their
image-declared names, and save-state
serializes both registerfiles independently. This permits BIOS and cart code to
use the natural handler names without renaming, a dispatcher facade, or the
cart overwriting a supervisor vector.

The shipped handler belongs to firmware/cart code: BIOS and cartlib expose
`system.irq` / `on_irq` as convenience dispatch over registered masks, and
bare-metal carts may define `irq(flags)` directly. Dispatch code acknowledges
only the masks it owns. An asynchronous source is unmasked and has exactly one
vector-handler owner that acknowledges it. A synchronous waiter leaves its
source masked, polls `IRQ_FLAGS` directly while running, and writes `IRQ_ACK`
itself; masked pending bits remain visible but do not vector or wake `HALT`. An
unmasked unacknowledged level bit will vector again at the next eligible guest
boundary, matching hardware interrupt-storm semantics rather than being
discarded by the emulator.

| Register | Address | Meaning |
| --- | ---: | --- |
| `IRQ_FLAGS` | `0x08000000` | Read pending IRQ bits. |
| `IRQ_ACK` | `0x08000004` | Write bits to clear. |
| `IRQ_MASK` | `0x08000008` | Read/write per-source vector mask; bit set means that pending source may vector. Reset `0`. |

| Name | Value | Meaning |
| --- | ---: | --- |
| `IRQ_DMA0_DONE` | `0x0001` | DMA channel 0 completion. |
| `IRQ_GX_PCRTC` | `0x0002` | GX PCRTC HSync/VSync/VBlank event. |
| `IRQ_VBLANK` | `0x0004` | VBLANK entry. |
| `IRQ_GEO_DONE` | `0x0008` | Geometry command completion. |
| `IRQ_GEO_ERROR` | `0x0010` | Geometry command error. |
| `IRQ_APU` | `0x0020` | APU voice event. |
| `IRQ_GPU` | `0x0040` | Rising edge of the GX-GPU GP0 interrupt-request source. |
| `IRQ_IMGDEC` | `0x0080` | IMGDEC final output-word consumption or format fault. |
| `IRQ_DMA1_DONE` | `0x0100` | DMA channel 1 completion. |

### Supervisor exceptions and BIOS terminal

The CPU supervisor exception path and BIOS terminal are machine-owned. The
terminal is firmware-ROM code, not a host overlay. This first hardware version
deliberately uses a compact R3000-style exception model without an MMU, MPU,
protected heap, or supervisor-only RAM.

The system controller also owns the cart-visible machine clock registerfile.
`SYS_TIME_MS` decodes the scheduler's current machine-cycle count through the
configured CPU clock and returns the low 32 bits of elapsed whole milliseconds.
`SYS_FRAME_MS_Q16` decodes the retained current GX PCRTC microhertz timing into
an unsigned Q16.16 frame period, and `SYS_CYCLES_PER_FRAME` exposes that same PCRTC datapath's next
VBlank cycle budget. A stopped PCRTC drives zero on both frame registers. These
reads consume retained machine-device state directly; `Runtime` neither maps
the addresses nor supplies a parallel cart clock.

| Register | Address | Meaning |
| --- | ---: | --- |
| `SYS_TIME_MS` | `0x08010224` | Read low-u32 elapsed whole machine milliseconds. |
| `SYS_FRAME_MS_Q16` | `0x08010228` | Read current PCRTC frame duration as unsigned Q16.16 milliseconds; zero while stopped. |
| `SYS_CYCLES_PER_FRAME` | `0x08010234` | Read the current PCRTC next-VBlank cycle budget; zero while stopped. |

Cart and firmware `print()` use the system debug-output register pair. A write
to `SYS_PRINT_CHAR` supplies one Unicode codepoint. The system controller maps
`0..255` directly into an 8192-byte circular BIOS-glyph history and maps wider
or invalid raw words to `?`; independently it UTF-8-encodes the codepoint for
the host transport. A write to `SYS_PRINT_FLUSH` appends a newline
and completes the host log line. Reading `SYS_PRINT_FLUSH` returns the retained
glyph count and reading `SYS_PRINT_CHAR` removes the oldest glyph byte. When
full, the hardware history overwrites its oldest byte, so output never stalls
the CPU. The byte history and its read cursor are machine state and survive
save/load.

The independent host-output transport is also a fixed 8192-byte ring. MMIO
writes therefore allocate nothing and cannot grow host memory. The host drains
only newline-complete bytes and performs UTF-8-to-host-string conversion at the
host boundary. Complete pending lines retain FIFO priority. If the current
uncommitted line exceeds the remaining capacity, the controller discards that
whole line through its flush instead of replacing already completed output. The
guest-visible hardware history keeps its normal circular overwrite behavior.
Host transport cursors and bytes are presentation state and are not serialized.

On supervisor entry the BIOS drains this hardware history into the retained
firmware terminal before producing monitor command output. The host log sink
receives the same completed lines independently; the browser host therefore
emits them through its normal developer console.
Neither host path owns terminal cells, GX state, or a second guest-visible
output ABI.

The CPU owns a compact coprocessor-0 registerfile. Guest code addresses the
registers with CPU instructions rather than MMIO or host builtins:

| Register | CP0 index | Meaning |
| --- | ---: | --- |
| `BAD_ADDRESS` | 8 | Last address-error guest address; every other exception class leaves the previous latch value unchanged. |
| `STATUS` | 12 | Raw privilege/interrupt stack described below. |
| `CAUSE` | 13 | Raw exception code and asserted CPU-line bits. |
| `EPC` | 14 | Guest byte-PC at which exception return resumes. |
| `EXEC` | 15 | Write-only non-returning transfer to a physical BLua32 function record. |

`MFC0` reads the four retained exception words; reading `EXEC` returns zero.
Supervisor code may write `STATUS`, `EPC`, and `EXEC` with `MTC0`; `CAUSE` and
`BAD_ADDRESS` are CPU-written latches. Writing `EXEC` selects the physical
image containing the supplied function record, latches the currently selected
cartridge socket when the address lies in the cartridge aperture, refreshes
that image's derived decode state, installs its declared ordinary-global layout
while retaining the system registerfile, clears the current call stack, sets
cartridge-entry status for a cartridge target, and pushes that function. It
never returns to the writer. An address that does not name a mapped executable
function record hard halts the CPU. A user-mode CP0 access is a defined
privileged-instruction guest fault. `EXEC` is not a native callback, seeded Lua
global, or parallel firmware shadow.

`STATUS[5:0]` follows the R3000 current/previous/old two-bit stack:

| Bit | Name | Meaning |
| ---: | --- | --- |
| 0 | `IEc` | Maskable interrupt enable for the current mode. |
| 1 | `KUc` | Current privilege: `0` supervisor, `1` user. |
| 2 | `IEp` | Previous interrupt enable. |
| 3 | `KUp` | Previous privilege. |
| 4 | `IEo` | Old interrupt enable. |
| 5 | `KUo` | Old privilege. |

Exception entry performs
`STATUS = (STATUS & ~0x3f) | ((STATUS << 2) & 0x3c)`, making the current mode
supervisor with maskable entry disabled. `RFE` performs
`STATUS = (STATUS & ~0x0f) | ((STATUS >> 2) & 0x0f)`, then removes
the active exception-root frame and resumes the retained frame at the current
`EPC`. The raw `STATUS` word is the only CPU interrupt/privilege truth; no
parallel enable/restore booleans or ordinary-`RET` restoration remain. System
firmware starts with `IEc=1, KUc=0`; a cart starts with `IEc=1, KUc=1`.

Asynchronous entry happens before the next guest instruction. It writes that
next byte-PC to `EPC`, so an accepted interrupt after `HALT` resumes after the
`HALT`. NMI has priority over a maskable IRQ at the same boundary. Both clear
the CPU's halted-until-interrupt latch. Entry while active sets the one-bit
interrupt-event latch; entry that wakes `HALT` leaves it clear because that
event has already been consumed. Maskable IRQ entry writes exception code
zero plus `CAUSE.IRQ=bit 10`; system entry writes exception code zero plus
`CAUSE.NMI=bit 16`. The device-source bits remain in `IRQ_FLAGS`. NMI is
admitted independently of the current privilege bit, so the system-entry edge
can preempt a cart IRQ root that reached supervisor mode immediately before the
common device fence. The system controller emits at most one NMI for that
transition. A later supervisor-request edge in an active resumable monitor sets
the supervisor exit-request status bit instead, so monitor entry cannot recurse.

NMI has one fixed hardware return bank for the interrupted `CAUSE`, `EPC`, and
`BAD_ADDRESS` words. The exception-root frame records that it owns this bank;
the eventual `RFE` therefore restores it even when nested BIOS VBlank IRQs have
overwritten the visible CP0 cause latch. `RFE` first uses the firmware-selected
NMI `EPC` to resume the interrupted instruction and then exposes the banked CP0
words, allowing an interrupted cart IRQ's later `RFE` to retain its own return
PC. This is fixed scalar CPU state, is included in save states, and is not a
general dynamic exception stack. The first synchronous cause is deliberately
narrow:

| Cause | `CAUSE.ExcCode` | `EPC` | `BAD_ADDRESS` | Resume rule |
| --- | ---: | --- | --- | --- |
| User execution of `MFC0`, `MTC0`, or `RFE` | 11 (`CAUSE[6:2] = 11`) | Faulting instruction | Unchanged | The handler must replace `EPC` with another instruction address before `RFE`; unchanged `EPC` retries the fault. |
| Misaligned CPU mapped-memory load | 4 (`CAUSE[6:2] = 4`, `AdEL`) | Faulting instruction | Exact load address | Unchanged `EPC` retries the complete load. The faulting access issues no bus cycle and does not commit its destination. |
| Misaligned CPU mapped-memory store | 5 (`CAUSE[6:2] = 5`, `AdES`) | Faulting instruction | Exact store address | Unchanged `EPC` retries the complete store. The faulting access issues no bus cycle; a multiword store commits no prefix. |
| Bus error during a CPU mapped-memory load or store | 7 (`CAUSE[6:2] = 7`) | Faulting instruction | Unchanged | Unchanged `EPC` retries the complete instruction. A load does not commit its destination. A multiword store retains completed prefix writes, stops at the faulting cycle and does not issue its tail. |

CPU alignment is part of instruction execution rather than a defensive memory
API check. Byte accesses have no alignment requirement, 16-bit accesses require
two-byte alignment, and word, 32-bit, `f32`, `f64`, and multiword accesses
require four-byte alignment. `f64` uses two ordered 32-bit bus cycles and
therefore retains the compiler ABI's four-byte alignment. The CPU checks the
effective address before write-readiness sampling, bus-fault sampling, or any
mapped-memory cycle, then latches `BAD_ADDRESS` and enters the system exception
vector on `AdEL` or `AdES`.

The mapped-memory owner publishes a runtime-only monotonically changing bus
fault sequence alongside the sticky guest-visible fault registers. The CPU
samples that sideband around its own transaction, so a new CPU bus error still
vectors when an older first-fault record occupies `BUS_FAULT_CODE`. The
sideband is neither guest-visible nor save-state data: no transaction remains
in flight at a save-state boundary. DMA and other device-master faults continue
to update only the sticky bus-fault registers and never vector the CPU.

A synchronous bus error in supervisor mode follows the same R3000-style nested
entry path instead of a synthetic double-fault halt. It pushes the raw status
mode stack again, overwrites the CP0 exception latches and enters another system
exception root above the interrupted supervisor frame. Firmware must preserve
any outer exception context it intends to resume. No other host/runtime failure
is converted into a CPU cause.

Exception entry pushes a generated exception-root closure above the stopped
frames. That root calls the image-owned handler and ends in `RFE`; a normal
Lua `return` only returns from the handler to the root. `RFE` is legal only in a
CPU-marked exception root and uses `EPC` as the authoritative resume PC. Entry
does not serialize, copy, unwind, or reconstruct the cart call stack. Only
faults defined by the machine contract enter this path. Emulator invariant
failures remain host failures.

Exception-root register zero is the raw guest error-value channel. An
unhandled Lua trap places its existing `Value` there; allocation failures use
the CPU's preinterned guest string. The generated root forwards that value to
the image-owned `exception(error_value)` handler. IRQ, NMI, address, bus and
privilege entries leave the register `nil`. This is call-frame state covered by
the ordinary CPU save-state contract, not a host exception string or diagnostic
object.

System and cartridge physical vectors remain distinct. A maskable IRQ
selects its vector from the pre-entry `KUc`: user execution uses the cart IRQ
vector, supervisor execution uses the BIOS IRQ vector. NMI and synchronous
faults always use the BIOS exception vector. Pending device bits are neither
acknowledged nor reassigned by CPU entry; while the monitor runs, BIOS owns an
explicit IRQ-mask/context switch and system handlers acknowledge only their
sources. Machine schedulers and devices continue advancing normally. The
existing NMI request latch is not a terminal implementation by itself: the CPU
consumes it into the system vector and preserves the latch, raw CP0 words, and
exception-frame state in the mirrored TS/C++ save-state contract. The ICU
samples only the dedicated supervisor-request line. Its rising edge requests a
system-controller transition; the controller raises NMI only after the user
device context has reached its entry fence. The BIOS exception handler owns
monitor entry.
Privilege gates system vectors, CP0 writes, exception return, and other
explicitly privileged CPU/system-control operations; it does not make ordinary
RAM inaccessible to carts.

The BIOS monitor code lives in `SYSTEM_ROM`. Its line buffer, fixed-size
output/history rings, and other mutable state use reserved ordinary `.bss`/RAM.
A cart can therefore corrupt that workspace, and a heap-corruption or
out-of-memory fault need not leave a working monitor. That is an explicit
property of the first hardware model, not a condition for host-side repair or
a hidden fallback VM.

Host input owners drive one dedicated supervisor-request line rather than
injecting a synthetic keyboard event into the ICU. Browser, headless and native
libretro keyboard paths map physical `F2` to that line while still publishing
the ordinary F2 HID bit. Ordinary libretro frontends leave all RetroPad buttons
as gameplay and drive no supervisor line. The BMSX direct host negotiates the
versioned private `BMSX_ENVIRONMENT_GET_SUPERVISOR_REQUEST_INTERFACE_V1`
callback instead. Its physical Down+Select chord is host control: a partial
press remains ordinary cart input, but the first poll with both buttons high
masks both RetroPad bits and raises the dedicated line. The latch keeps both
buttons masked until both are released, then lowers and rearms the line; focus
or device loss reaches the same transition through the host's raw zero input
state. The core never receives a synthetic F2 event. Its libretro input owner
ORs the negotiated line with the real F2 line before edge publication, so
overlapping sources cannot produce a false release. A frontend that rejects
the private command retains a permanent low host line.
While the BIOS monitor owns the CPU, it reads the raw ICU USB-HID bitmap,
performs its own modifier, repeat, and character mapping, and waits on the BIOS
IRQ/VBlank path. The cart receives no input because its frames are not
executing. The host continues to sample the physical devices into ICU words;
it does not edit a terminal buffer or dispatch commands.

Monitor entry arms one ordinary ICU sample before its existing publication
VBlank, then seeds both sides of the firmware key-edge state from those latched
words. A key held while the exception was raised must therefore be released
before it can become monitor editor input; no platform filters or synthetic
release events participate in this boundary.

Monitor entry snapshots the raw `STATUS`, `CAUSE`, `EPC`, `BAD_ADDRESS`, and IRQ
mask words before enabling nested supervisor IRQs or changing IRQ/GPU
ownership. The automatic fault output decodes the architectural cause from a
firmware `.rodata` registry, includes `BAD_ADDRESS` only for address faults, and
prints the guest Lua error value supplied by the exception-root ABI for Lua
traps. Long messages are consumed directly into fixed terminal rows without a
substring or host-formatting allocation. `FAULT` and `REGS` retain the
underlying raw words. Fault presentation therefore does not depend on host
exception text or a frontend-owned terminal overlay.
The firmware keeps the current monitor-entry registers separate from its last
synchronous fault record. A supervisor-request NMI updates `REGS` but cannot
replace that fault with `NMI SUPERVISOR REQUEST`; `FAULT` reports the retained
fault, or `NO SAVED FAULT` before one exists, and `FAULT CLEAR` explicitly
invalidates it. `CONT` restores the current entry's saved `STATUS` and `EPC`, so
continuing a synchronous fault retries the same guest instruction and may
immediately raise the same fault again.

System control is a small privileged registerfile rather than a host callback:

| Register | Address | Meaning |
| --- | ---: | --- |
| `SYS_CONTROL` | `0x08010348` | Write-only command bits: machine reset `0x1`, enter an already fenced supervisor context `0x2`, leave resumable supervisor context `0x4`, begin synchronous-fault supervisor entry `0x8`. It reads back as zero. Supervisor commands are accepted only in supervisor mode. |
| `SYS_STATUS` | `0x0801034c` | Read-only raw bits: supervisor transition/context active `0x1`, exit requested `0x2`, context resumable `0x4`. |

A supervisor-request edge in user mode starts a dependency-ordered hardware
fence. The first stage closes GP1 writes, DMA triggers, IMGDEC configuration and
`START` strobes, and geometry doorbells. Geometry finishes its already accepted
job. IMGDEC finishes only the already scheduled decode batch of at most sixteen
words, lowers both DREQs, and retains the rest of the live stream in place;
monitor entry never runs a complete compressed asset merely to reach a fence.
GP0 ingress remains open during this producer phase so output accepted before
the boundary can progress. Once both producers are quiescent, DMA closes new
block admission and lets its single admitted block finish. Finally GX closes
GP0 after any already admitted GP0 DMA block and drains the physical DMA ingress
stage, command FIFO, readback and executable command stream. A partial GP0
packet is a retained user-context latch, not work that the fence invents padding
for or discards. Supervisor leave reuses only the bus and GX drain phases:
IMGDEC and geometry stay quiesced throughout the monitor context.

The GPU, DMA, IMGDEC and geometry owners publish their own completion edges; the
system service never polls a renderer, busy-waits, or repeatedly schedules
itself at the current cycle. At the final GX fence for an external request the
controller aborts any still-waiting CPU mapped-store handshake, raises NMI and
enters `ENTRY_VECTOR`.
A blocked store has not issued a bus cycle and its PC already names the complete
instruction, so `EPC` retains it for retry after resume without a port-specific
release list. The firmware saves the post-exception CP0 words. `CAUSE.NMI`
selects `SYS_CONTROL.ENTER`; a synchronous cause selects `SYS_CONTROL.FAULT`.
Firmware therefore classifies the exception explicitly instead of inferring
transition intent from mutable device phase. For a synchronous exception,
`SYS_CONTROL.FAULT` starts the same producer, bus and GX fence from the exception
handler. The system controller holds CPU execution after that MMIO command and
directly activates the retained supervisor bank when the final GX edge arrives;
it does not raise a second exception.

An armed DMA channel whose selected DREQ is low has not acquired the shared bus:
its endpoint reservation still blocks conflicting user CPU access, but it does
not hold the supervisor fence. Once DMA admission is closed, the DMA owner banks
that raw `BUSY` registerfile on entry and re-arbitrates it after monitor exit.
Only a block admitted before that gate closes drains into the GX stage.

That enter command banks the raw user IRQ registerfile, both live DMA channel
registerfiles and the next arbiter channel, and the GPU's scalar register/latch
state. The physical GPU DMA ingress, command FIFO, readback path and executable
command stream are empty at the fence. An incomplete packet-sequencer state and
its retained command words are copied into one preallocated fixed user ingress
bank; there is no second live parser, FIFO, command buffer or VRAM image. The
supervisor receives fresh IRQ, DMA and GPU registerfiles over the same MMIO
addresses. A GPU bank switch clears its quiesce/ingress latches before the new
raw register words republish CPU-port readiness and DREQ, so no transition
exposes lines derived from the previous owner. IMGDEC keeps the exact paused
user stream in its physical latches and FIFOs, while geometry remains quiescent
with its completed registerfile resident. The transition performs no heap work.
A synchronous cart fault cancels a pending entry NMI, if any, and uses the same
fixed banks rather than resetting devices or discarding accepted work. The
resumable status bit remains low while the fence is in flight and becomes high
only after those banks own a complete retained user context. A fault raised by
monitor code keeps that existing bank active; the fault command acknowledges a
pending supervisor-line exit request without rebanking the devices.

The APU is autonomous and continues playing while the monitor is active. Its
events accumulate in the hidden user IRQ pending bank; supervisor VBlank, DMA
and GPU sources use the visible supervisor bank. The CPU interrupt line is
derived only from the visible bank. This preserves user audio timing and IRQ
state without giving firmware a duplicate APU or routing user events into the
monitor.

The BIOS terminal uses the ordinary GX raster/store path. GX VRAM is one
uniform linear array of installed raw 16-bit words. The current `psx` model
installs 1,048,576 words, exactly 2 MiB, behind the fixed 1024-column by
1024-row GX address decoder. All ten Y address bits therefore name distinct
installed memory when the Y9 gate is open on that model; the lower and upper
halves are not different allocator classes or legacy/native banks. There is no
terminal VRAM bank, character-plane SRAM, terminal write port, host framebuffer
or terminal-owned backend texture. Firmware uploads the packed system texture
through the standard GP0 CPU-to-VRAM packet, then draws the terminal surface
with ordinary fill, VRAM-copy and textured-rectangle GP0 commands. Software,
WebGL2, WebGPU and GLES2 therefore execute the same command stream used by
carts.

The larger physical store does not widen the GP0 transfer fields. CPU upload,
VRAM copy and GPUREAD retain their 1024x512-pixel maximum; their retained result
buffer remains transfer-sized rather than a full-VRAM mirror. VRAM copy reads
and writes the live store in raster order, reversing each row when horizontal
overlap requires it; it does not allocate or retain a second transfer image.
Full-VRAM snapshots and backend storage instead use the exact installed capacity
selected by the machine model.

The standard machine layout reserves the bottom-right 256x256 page at
x=768..1023, y=768..1023. Its top 256x64 words hold the packed system texture;
the lower 256x192 words hold the terminal surface at `(768,832)`. This is a
128 KiB convention inside the shared 2 MiB VRAM, not protected or additional
memory. The rompacker rejects overlap for ordinary cart layouts. Bare-metal
cart code can still address those words and accepts that doing so may corrupt
firmware rendering; hardware does not hide, restore or redirect the region.
Every other installed VRAM word is an ordinary cart resource.

#### GX PCRTC dual read-output circuits

The rejected GP1(0Ah)--GP1(0Dh) A1RGB555 composition plane is not part of the
BSX hardware contract. `GX-PCRTC-01` instead replaces the single-output GX
scanout contract with the PlayStation 2 GS PCRTC dual rectangular read-output
and merge design. This is not a terminal-only plane or a reduced derivative:
the selected register block retains the raw PS2 layouts and behavior of
`PMODE`, `DISPFB1`, `DISPLAY1`, `DISPFB2`, `DISPLAY2`, and `BGCOLOR`, including
both circuit enables, framebuffer base/width/format, source offsets, output
position and extent, horizontal/vertical magnification, background selection,
alpha-source selection and constant-alpha merge. The reference layouts are
visible in [PS2SDK's privileged GS register owner](https://github.com/ps2dev/ps2sdk/blob/78c5bae9d2fa20bce6596554a4461000d4b9098e/common/include/gs_privileged.h#L14-L43)
and [PCSX2's raw register definitions](https://github.com/PCSX2/pcsx2/blob/470e995c6c1404dfa76c9efff60d7f47acb63562/pcsx2/GS/GSRegs.h#L321-L410).

PCRTC is a post-raster hardware unit. Its two circuits read the authoritative
GX VRAM directly and merge before device quantization, presentation history,
CRT processing and host overlay lanes. It owns no rasterizer, command FIFO,
framebuffer copy, composed image or backend texture. The software and
accelerated backends consume the same raw register words and VRAM; backend
optimizations may skip a provably invisible circuit but may not change the
merge result. PCSX2's production merge owner demonstrates the same separation
between the two read circuits, their source/destination rectangles and the
[`PMODE` merge](https://github.com/PCSX2/pcsx2/blob/470e995c6c1404dfa76c9efff60d7f47acb63562/pcsx2/GS/Renderers/Common/GSRenderer.cpp#L82-L240).

`DISPLAY.DW+1` is a horizontal video-clock extent and `DISPLAY.DH+1` is an
output-line extent. The PCRTC owner converts signal X and `DW` once to native
output columns through the `SMODE1` signal step. `MAGH+1` and `MAGV+1` control
how the scanout datapath advances or repeats source samples from the
`DISPFB.DBX/DBY` origin; they are not a second host-frame bounds calculation.
`DISPFB.FBP` remains an 8 KiB base unit, `FBW` remains a 64-pixel unit, and the
selected `PSMCT32`, `PSMCT24`, `PSMCT16`, `PSMCT16S`, and packed `PSGPU24`
datapaths address the same uniform raw-word VRAM with word wrap at its physical
boundary. `PSGPU24` is a packed RGB byte stream stored through the GS
`PSMCT16` page/block/column swizzle, not a linear `framebufferWidth * 3` byte
surface. Pixel `x` reads the two swizzled 16-bit words at logical word columns
`(x * 3) >> 1` and `((x * 3) >> 1) + 1`; even and odd pixels then select their
three RGB bytes from those raw words. `FBW` therefore remains the PSMCT16 page
count for row and page advancement.

The standard mode envelope reaches 1920x1080, matching the largest PS2 DTV mode
rather than the earlier PSX-only 640x480 declaration. Mirrored raw
vectors cover the PSX 256/320/368/512/640-column 240p family and 640x480i, PS2
640x448i NTSC and 640x512i PAL, plus 720x480p, 656x576p, 1280x720p and
1920x1080i. Libretro starts with that standard maximum and publishes
`SET_SYSTEM_AV_INFO` with a larger maximum only when raw dual-circuit composition
exceeds it. Every representable `SMODE`, `DISPLAY` and `DISPFB` word therefore
continues through the same deterministic datapath without forcing frontends to
reserve the theoretical maximum at startup. The system firmware owns coherent
reset presets for the PSX widths and the three SD interlaced outputs; those
helpers program GP1 and PCRTC raw words independently and do not create a
permanent GP1-to-PCRTC adapter.

Software scanout selects its composition datapath once from the published
PCRTC state. The common RGB555 case clears the selected rows, writes circuit 2
with its raw STP-derived alpha, then runs the selected source- or
constant-alpha circuit-1 row kernel. `PMODE.AMOD` selects whether that kernel
publishes its merge alpha or preserves circuit-2/background alpha; zero-alpha
and opaque-alpha paths have dedicated row datapaths instead of a per-pixel
mode branch. Other framebuffer formats use the general circuit sampler.
Circuit enable, format, magnification, output bounds and merge mode are
therefore decoded when the published register words change, not again every
host frame. The TypeScript headless owner exposes one retained output
allocation as both 32-bit scanout words and RGBA bytes; presentation does not
repair alpha or copy the completed frame into a second buffer.

Accelerated scanout retains both circuit payloads by PCRTC revision and field.
WebGL2 stores them in separate aligned ranges of one uniform buffer. GLES2
retains the payload currently owned by each linked sample program and republishes
it only when that program's circuit, revision or field changes. Distinct circuits
that share one GLES2 program therefore pay the required uniform update instead
of adding circuit selection to every fragment. A GLES2 scanout invocation also
retains its bound sample program so adjacent passes do not repeat the same bind.
Blend color is backend-owned state:
WebGL2 retains it for the exclusive browser context, while GLES2 invalidates its
cache at frame entry because the libretro frontend shares that context.

PCRTC is the sole GX scanout authority. BIOS and cart producers program its raw
MMIO words directly; there is no permanent GP1-to-PCRTC adapter, legacy/native
display selector or parallel presentation path. The selected framebuffer-format
and address behavior, VBlank publication, reset words, supervisor context and
current-format save-state are owned by the mirrored TS/C++ registerfiles rather
than custom 24-bit GP1 commands.

Both read circuits remain raw hardware and bare-metal code can program either
one. The standard BSX firmware/cart ABI, however, assigns cart presentation to
circuit 1 and reserves circuit 2 for supervisor composition. This is an
ownership convention, not MMIO protection: a bare-metal cart that also uses
circuit 2 gets deterministic dual-circuit output and accepts that resumable
supervisor entry can preserve only its published circuit-1 readout as the
supervisor's circuit-2 underlay. The system controller retains the complete raw
twelve-word user composition context, including circuit 2, and restores its
active and published banks unchanged on exit. `SMODE1/2`, `SYNCH1/2`, `SYNCV`,
`CSR`, `IMR` and the physical beam remain one global PCRTC rather than hidden
per-context clocks; supervisor writes to those words therefore persist after
exit. Entry and exit replace the composition banks atomically and arm one
presentation-pending latch. Supervisor circuit 1 belongs to monitor firmware
and `PMODE` merges its terminal source alpha over the frozen underlay. Both an
external request and a synchronous fault program terminal presentation over the
same retained cart composition. No path copies the cart framebuffer or
allocates terminal-only memory.

The BIOS keeps a fixed 128-line cell scrollback, dirty ranges, line editor,
history and GP0 command list in ordinary `.bss`. A packed ROM table maps each
4x6 tiny-font codepoint one-to-one to its physical system-texture coordinates.
The monitor's HID-to-console-ASCII producer emits uppercase alphabetic bytes;
the ROM packer and glyph renderer do not reinterpret text. A zero retained cell
leaves its 4x6 terminal area transparent. Every nonzero cell, including an
explicit space, first draws an opaque black 4x6 background and then draws its
glyph when it has one. Dirty spans and newly exposed scroll bands clear back to
transparent before their live cells are redrawn, while ordinary VRAM-to-VRAM
copy moves the existing cell coverage during scrolling. DMA consumes the
retained command words before firmware may rebuild them, and the final GP0 IRQ
fences GPU completion. No render-time Lua tables, strings or pixel buffers are
allocated.

The firmware line editor supports insertion, deletion, cursor/home/end and
word motion/deletion, a fixed history ring and command-name completion with a
retained selectable candidate row. While the caret follows a non-empty command
prefix at the end of the input, the first matching ROM command supplies a dim
inline suffix; Right accepts that suffix without consulting host tooling.
The block caret is rendered through ordinary GX rectangles and inverts the
underlying retained glyph rather than replacing it with an underscore. Edit,
completion and pager are one explicit monitor mode rather than overlapping
flags. Completion scans the command registry once, stores the matching registry
indices in fixed `.bss` whose capacity derives from that registry, and reuses
that set for selection and acceptance. Long producers feed one fixed row at a
time into an automatic pager; page/line advance and scrollback never retain a
second copy of command output. Command metadata is one typed `.rodata` array of
records, so names, usage and descriptions have no parallel blob, offset or
length tables.

Monitor exit is the reverse hardware boundary. A new supervisor-request edge
sets `SYS_STATUS.EXIT_REQUESTED`; firmware observes it on VBlank and writes
`SYS_CONTROL.LEAVE`. `CONT` issues the same leave command with the saved `EPC`
unchanged. `LEAVING` holds CPU execution
while DMA closes admission and drains its admitted block, after which GX closes
and drains supervisor GP0 ingress. IMGDEC and geometry have remained quiesced
for the complete monitor context and are not supervisor-side producers. Hardware
then restores the raw user DMA, GPU and IRQ banks, releases the IMGDEC and
geometry quiesce latches, and resumes IMGDEC from its exact retained stream
state. The saved
post-exception `STATUS` keeps maskable entry disabled until compiler-emitted
`RFE` atomically restores user privilege/interrupt state and resumes at `EPC`.
There is no host state, framebuffer copy, global IRQ acknowledge, DMA abort or
retry loop on either path. If the cart has not changed the condition that caused
the synchronous fault, retrying the same instruction enters the monitor again.
A monitor-side fault returns through `RFE` without leaving the already active
device bank, so retrying its `EPC` likewise reproduces the same fault. Each
monitor invocation samples `SYS_STATUS.RESUMABLE` before its entry command:
the invocation that creates the retained bank owns the eventual `SYS_CONTROL.LEAVE`,
while a nested monitor fault only restores its CP0 context.

The machine-visible monitor command set starts with hardware operations such as
`HELP`, `FAULT`, `REGS`, `MEM`, `CLS`, `CONT`, and `REBOOT`. It does not expose the workspace,
host filesystem, JavaScript stack, real-time compiler options, host process
shutdown, IDE symbol browser, or other current workbench services. Its layout
and colors are firmware policy; firmware-owned interaction quality does not
depend on the removed host terminal.

#### Cartridge expansion

BMSX has two physical cartridge sockets on one 16-bit external
address/data bus. Both sockets receive the same address and bus strobes; distinct
`/CS0` and `/CS1` lines decide which board responds. The CPU sees one 528 MiB
cartridge aperture, not two relocated ROMs:

| CPU range | Selected-board decode |
| --- | --- |
| `10000000h`--`2FFFFFFFh` | 512 MiB immutable ROM window. |
| `30000000h`--`30EFFFFFh` | 15 MiB cartridge-RAM window. |
| `30F00000h`--`30FFFFFFh` | 1 MiB cartridge-MMIO window. |

`CART_SELECT` at `08010424h` is a raw retained word; bit 0 selects socket 1
when set and socket 0 when clear. `CART_STATUS` at `08010428h` reports socket
presence in bits 0--1 and the decoded selection in bit 16. The controller does
not classify cartridge contents as executable. The four read-only words that
follow expose each socket's raw board word and physical RAM byte count. Unknown
board bits remain readable and have no current datapath effect.

The ROM header owns the board declaration. Its word at byte 76 has
`RAM=bit0` and `MAILBOX=bit1`; the word at byte 80 is the socket-local RAM
capacity and cannot exceed the 15 MiB aperture. A board without `RAM` returns
zero and ignores writes in the RAM window. A shorter ROM or RAM backing returns
zero beyond its physical end. The complete header, sections and TOC must fit
the 512 MiB ROM window; loaders and ROM producers reject a larger physical
image. Reset retains cartridge RAM, resets the CPU
selection to socket 0 and clears mailbox data, control, DREQ and local
IRQ state. At the source boundary the ROM packer maps
`cartridge.board = rom|ram|mailbox|ram_mailbox` and optional
`cartridge.ram_bytes` into those two raw header words.

The minimal device board decodes four aligned 32-bit mailbox registers at the
start of cartridge MMIO:

| Offset | Register | Datapath |
| ---: | --- | --- |
| `00h` | `DATA` | Raw read/write word. |
| `04h` | `CONTROL` | Bit 0 is an IRQ-trigger strobe; retained bits 1 and 2 assert read- and write-side DREQ. |
| `08h` | `STATUS` | Bit 0 reports the socket-local IRQ source latch. |
| `0Ch` | `IRQ_ACK` | A nonzero word clears that local source latch. |

Socket 0 and socket 1 raise IRQ bits 9 and 10 respectively. Their four DREQ
lines are separate. DMA request selectors 7--10 drive a socket chip-select
override independently on the read and write sides, so a block can transfer
slot-1 ROM into slot-0 RAM while the CPU selection remains unchanged. The
DMAC decodes each request selector into retained read/write bus signals once
per admitted block; only `BLOCK_END` changes per transferred word.
The mailbox trigger raises the central IRQ only on a clear-to-set transition of
the socket-local source latch. A central `IRQ_ACK` clears the IRQ-controller
flag but does not retrigger a still-pending mailbox; firmware must write the
mailbox's own `IRQ_ACK` before a later trigger can create another edge.

System firmware always supplies the reset vector. Firmware scans sockets in
physical order by writing `CART_SELECT` and reading each raw ROM header through
the shared aperture. It chooses the first present image whose BLua32 image
offset is nonzero, leaves that socket selected, and writes the header's physical
startup function address to `CP0.EXEC`. If neither cartridge is executable,
firmware remains in its own boot flow. The emulator host neither chooses the
executable socket nor calls its entry.

Both sockets are executable through exactly the same cartridge aperture. The
bus controller has two physical chip-select sources: ordinary CPU data cycles
use `CART_SELECT`, while cartridge instruction cycles use the socket latched by
the last cartridge-targeted `CP0.EXEC`. Only one socket drives any individual
bus cycle. This lets cartridge code read another socket without silently
retargeting its next instruction fetch; it is a CPU/bus latch, not a host-pinned
image or second address namespace.

A cartridge image is position-invariant between the two sockets because both
use `10000000h`--`2FFFFFFFh` and does not require relinking. A later
cartridge-targeted `CP0.EXEC` samples the then-current `CART_SELECT` value and
replaces the execution latch. DMA uses its explicit socket chip-select
overrides. There is no second executable namespace and no host merge of the two
cartridges.

Save-state stores the raw CPU selection word and, per socket, RAM, mailbox data,
retained control and the local IRQ source latch. Immutable ROM bytes, board
words and capacities remain properties of the inserted media. CPU state
separately retains the cartridge execution-socket latch selected by `CP0.EXEC`.
Browser hosts
accept `rom` and optional `slot1` URL parameters, the Node host accepts
`--slot0`/`--rom` and `--slot1`, and ordinary libretro content maps to slot 0.
Libretro additionally publishes the `dualcart` subsystem with required slot 0
and optional slot 1. All hosts pass the same two physical media inputs into the
machine owner; none maps a second cart through an alternate address or copies
it into RAM.

This follows the MSX principle that a cartridge can extend the machine rather
than merely supply one software image; openMSX models the same distinction with
external-slot ownership and extensions that install real memory or devices, for
example its
[cartridge-slot manager](https://github.com/openMSX/openMSX/blob/d1b8f2c81b3fcafde528e91e6133a7278a732e04/src/CartridgeSlotManager.cc#L120-L180),
[2 MiB RAM cartridge](https://github.com/openMSX/openMSX/blob/d1b8f2c81b3fcafde528e91e6133a7278a732e04/share/extensions/ram2mb.xml), and
[GFX9000 device cartridge](https://github.com/openMSX/openMSX/blob/d1b8f2c81b3fcafde528e91e6133a7278a732e04/share/extensions/gfx9000.xml).
BMSX deliberately does not copy MSX slot paging: the raw chip-select mux,
external-bus aperture and per-board decode above are the complete base contract.

### DMA

DMA exposes two identical six-word register channels. DMA0 retains its base at
`08000014h`; DMA1 is mapped at `080103E8h`. Each channel contains, in order,
`READ_ADDR`, `WRITE_ADDR`, `TRANSFER_COUNT`, `CONTROL`, `STATUS` and the
write-only, self-clearing `TRIGGER` strobe. Addresses, count and control remain
CPU-visible and writable while `STATUS.BUSY` is set. The count is the number of
32-bit bus transfers.

`CONTROL` is a raw word with this layout:

| Bits | Meaning |
| ---: | --- |
| 0 | Increment the read address after each word. |
| 1 | Increment the write address after each word. |
| 2--5 | Read-side request selector. |
| 6--9 | Write-side request selector. |
| 10--13 | Hardware block length minus one, encoding one through sixteen words. |

Both selected request lines must be asserted before a block is admitted. A
memory side normally selects `FORCE`; a device side selects the DREQ published
by that device owner.

| Selector | Name | Owner |
| ---: | --- | --- |
| 0 | `FORCE` | Permanently asserted. |
| 1 | `GX_WRITE` | GX GP0 write port. |
| 2 | `GX_READ` | GX GPUREAD port. |
| 3 | `APU_WRITE` | APU sample-transfer input. |
| 4 | `APU_READ` | APU sample-transfer output. |
| 5 | `IMGDEC_WRITE` | IMGDEC compressed-input FIFO. |
| 6 | `IMGDEC_READ` | IMGDEC GP0-output FIFO. |
| 7 | `CART0_WRITE` | Socket-0 board write-side DREQ and `/CS0` override. |
| 8 | `CART0_READ` | Socket-0 board read-side DREQ and `/CS0` override. |
| 9 | `CART1_WRITE` | Socket-1 board write-side DREQ and `/CS1` override. |
| 10 | `CART1_READ` | Socket-1 board read-side DREQ and `/CS1` override. |
| 15 | `DISABLED` | Permanently deasserted. |

GX translates its raw GP1 DMA direction and retained port readiness into the
GX request lines; the DMA controller does not decode GPU state. The APU and
IMGDEC likewise publish their own raw FIFO DREQs. The controller only consumes
those lines and never calls a device-specific transfer API. The GX front end
owns `GX_WRITE`; the GPUREAD port owns `GX_READ`. A GP1 direction change is
break-before-make: the previous directional owner lowers its request before the
new owner is enabled and allowed to publish. The arbiter therefore never sees
the old and new directional requests asserted together, without moving either
request latch into the DMA controller.

The standard machine runs its CPU at 33.8688 MHz (44100 × 768, the PS1 CPU
clock). The firmware/BIOS package occupies `SYSTEM_ROM`; up to two inserted
cartridge packages sit behind the shared cartridge aperture and its socket
chip-selects. Firmware code and assets share the first physical package. CPU
execution fetches from the physical system image or the `CP0.EXEC`-latched
cartridge socket; derived decode state is not a third memory-mapped ROM.

DMA timing is region-dependent and block-based. For a block of `N` words, a
side starting in RAM costs `1 + N` cycles: one cycle establishes a sixteen-word
hyper-page burst and each word costs one more. The setup is paid again for every
admitted block, including a block at the same or a fixed address. It is not a
persistent open-row cache, does not depend on where RAM happens to sit in the
memory map, and creates no row id or row state to serialize. `SYSTEM_ROM` uses
the internal 32-bit path and costs `N` cycles. `CART_ROM` uses a 16-bit external
cartridge datapath: a block pays four address/arbitration setup cycles, then each
32-bit DMA word takes two 16-bit transfers of four CPU cycles each. Its block
cost is therefore `4 + 8N` cycles for cartridge ROM, cartridge RAM and
cartridge MMIO alike: all three remain behind the external socket bus. Setup is
paid again at every admitted block; there is no persistent cartridge page
latch. A fixed internal MMIO or other non-cartridge mapped side contributes no
memory wait of its own; the DMA datapath still needs one cycle to complete a
block when neither side contributes a memory wait.

Admission asks `Memory`, the mapped-address owner, for consecutive word spans in
each actual physical region. An incrementing side is split only where its
address crosses such a boundary; a fixed-address side remains one run. Every
RAM or cartridge run pays its setup once, including the run containing the
block's first word. `CART_ROM`, cartridge RAM and cartridge MMIO are distinct
physical runs even though they share one timing class and one external bus, so
crossing either selected-board decode boundary starts and charges a new bus
transaction. For each pair of simultaneous spans the read and write costs
overlap and the slower side wins when the sides have distinct bus owners.
RAM↔RAM costs add because internal RAM is single-ported. Cartridge↔cartridge
costs likewise add because both sockets and all three selected-board windows
share one half-duplex external address/data bus; separate socket chip selects
do not create a second datapath. Segment costs accumulate in transfer
order, so a later region crossing cannot retroactively overlap an earlier beat.
The timing therefore depends on decoded physical ownership, never on accidental
adjacency in the numeric memory map, cached row ids, or a first-word guess for
the entire block. With continuous DREQ and full sixteen-word blocks that stay
inside one region this yields about 135.48 MB/s for
`SYSTEM_ROM`→MMIO, 127.51 MB/s for RAM→MMIO or `SYSTEM_ROM`→RAM,
16.42 MB/s for `CART_ROM`→RAM/MMIO, and 63.75 MB/s for RAM→RAM. Short RAM
and cartridge blocks pay setup more often, and DREQ can add idle time between
blocks. A cartridge↔cartridge transfer reaches about 8.21 MB/s for full
sixteen-word blocks. The one-sided cartridge path approaches 16.93 MB/s only
as blocks grow; the architectural sixteen-word maximum is the quoted
16.42 MB/s.

The timing belongs to the bus/DMA owner rather than GX, APU, firmware or a ROM
texture helper. The machine model supplies these fixed raw-cycle constants to
the DMA controller once; PCRTC/CPU timing refresh does not carry or reapply
them. This follows the same ownership shape as DuckStation's
[DMA RAM tick owner](https://github.com/stenzek/duckstation/blob/4730d795bba1d11353efef01be513886fb8867c7/src/core/bus.h#L194-L202): RAM cost
is calculated once for a transferred batch, not by simulating another per-word
memory stream before the real transfer. The cartridge rate is a BMSX hardware
choice rather than a PS1 expansion-ROM inference. The standard profile does not
pretend that Nintendo's documented N64 Game Pak
[50 MB/s page-mode peak](https://ultra64.ca/files/documentation/online-manuals/man/kantan/step1/2-6.html)
is a universally sustainable cartridge rate, nor does it copy that platform's
roughly 5 MB/s typical baseline. It specifies its own fixed 16-bit path between
those endpoints and deliberately forgets sequential state at every DMA block.
The different physical-bus ownership follows production emulators: mGBA keeps
separate [internal and Game Pak wait-state tables](https://github.com/mgba-emu/mgba/blob/bae93155b2076d7de6bdfa25499b62084144b22a/src/gba/memory.c#L35-L40)
and [charges DMA's first non-sequential and later sequential accesses](https://github.com/mgba-emu/mgba/blob/bae93155b2076d7de6bdfa25499b62084144b22a/src/gba/dma.c#L259-L285)
through those tables, while melonDS makes the eight-bit cartridge port itself
publish a 32-bit word every [20 or 32 system cycles](https://github.com/melonDS-emu/melonDS/blob/82fdbc78483f43b310e920e21acc47787cb43564/src/NDSCart.cpp#L806-L893),
about 6.70 or 4.19 MB/s before command gaps. BMSX keeps one fixed cartridge
profile instead of adding programmable wait-state registers. The uniform
mapped-memory contract retains the MSX principle represented by openMSX's
common device-facing
[memory read path](https://github.com/openMSX/openMSX/blob/6a71ac3f14a9367934daef4d90138823fdabd1a2/src/cpu/MSXCPUInterface.cc#L190-L213).
No cart, firmware module or device endpoint may add a second payload-rate
budget around the shared bus.

The two channels share one physical bus and one scheduler service. At most one
block is admitted at a time; after a block completes, round-robin arbitration
starts at the other channel. A high pair of request lines admits the programmed
block length, shortened only by the channel's final transfer count. Admission
latches the channel, block length, read and write cursors, remaining count, raw
control word and aggregate completion edge. Save-state preserves those admitted
block latches and the remaining time to that edge; it does not serialize a
second decoded timing plan. A later DREQ edge, register write, memory-map or
timing change cannot alter that block. DREQ and the visible control word are
sampled again only before the next block.

`TRIGGER` sets `BUSY` immediately. Mapped-port owners use the channel's retained
read/write endpoint to keep conflicting CPU stores off their physical port; the
APU data port, for example, is half-duplex and checks both directions. DMA
channels are not silently rejected or stalled because another channel names the
same endpoint: the shared-bus arbiter serializes their admitted blocks and
exposes the programmed round-robin interleaving deterministically. Read and
write directions remain independent, so IMGDEC's input and output channels can
both use the bidirectional `DATA` address. Ordinary RAM and ROM ranges are not
treated as device-port locks.

Endpoint reservation and bus admission are deliberately different hardware
facts. Every armed `BUSY` channel reserves its programmed fixed MMIO endpoint
against the CPU, including while DREQ is low. Only the single latched active
block owns the shared bus and can hold a device's supervisor fence. This lets a
monitor bank and later restore an indefinitely waiting channel without inventing
an abort, endpoint registry or device-specific resume path.

The supervisor fence likewise exposes two physical DMAC gates rather than one
timing-dependent flag. Its control gate rejects new `TRIGGER` strobes from the
first supervisor edge. Existing channels continue normal request arbitration
until active producer devices are quiescent. The later admission gate then
prevents another block from acquiring the bus while the already admitted block
finishes. Both raw gate latches are save-state data.

Mapped write readiness belongs to the addressed device and receives the raw bus
master signal. The CPU uses that line before issuing a mapped store; the machine
bus samples the same line before a DMA word can enter the target registerfile.
Consequently a forced block admitted before the control gate may still complete
its bus timing, but a later write to closed DMAC `TRIGGER`, GP1, IMGDEC config or
geometry doorbell does not latch. Streaming data ports distinguish the admitted
DMA master from a CPU excluded by that DMA channel's endpoint reservation; the
DMAC contains no address list of control or data endpoints.

At service time every admitted word is one mapped bus read followed by one
mapped bus write using the latched cursors and control bits. Only the final word
of that block carries `BLOCK_END`; there is no transfer-end sideband. The
latched cursors and remaining count advance inside the block, while their
CPU-visible register words are published once when the whole block completes.
That hardware writeback wins over a concurrent CPU or self-DMA register write.
A control write made during the block is visible immediately but affects only a
later admission.

Completion clears `BUSY`, sets `DONE`, and raises `IRQ_DMA0_DONE` or
`IRQ_DMA1_DONE`. Memory remains the sole bus-fault owner; a fault does not add a
DMA error state or roll back the channel. Save state retains both channel
registerfiles, the single admitted block and its remaining deadline, the next
round-robin channel, and both supervisor-banked channel registerfiles. No
predicted row, decoded-address cache, transfer-start facade or device-owned
continuation state is serialized.

System firmware uses DMA0 for ordinary ROM/RAM-to-device and device-to-RAM
copies. IMGDEC upload arms DMA1 from `IMGDEC_DATA` to GX GP0, then DMA0 from
`CART_ROM` to `IMGDEC_DATA`, and strobes IMGDEC `START` last. Both channels can
therefore wait on their device DREQ independently while the shared bus
round-robins admitted blocks. Raw native GP0 streams remain valid DMA payloads;
compressed textures use the same mapped GP0 port after IMGDEC expands them.

The APU FIFO is sixteen words: its first accepted word may lower the level
DREQ, while the already admitted block continues and `BLOCK_END` starts exactly
one timed sample-RAM batch. A short final block carries its actual word count.
GX CPU-to-GP0 command-sync producers must keep each polygon or line packet
wholly inside one block; longer polylines or unaligned command streams select
FIFO or forced request mode. Packet alignment is command-list ownership, not a
hidden repair in `system/dma.lua`.

GX-read DREQ is the readback port's ready-to-send line, not a polled GPUSTAT
copy. Backend completion raises that line and schedules a waiting channel at the
current machine cycle; consuming the final available GPUREAD word lowers it. A
longer transfer therefore remains `BUSY` when GX has no word available and
resumes on a later readback completion without a timer, copied readiness latch,
or software retry loop.

### IMGDEC

IMGDEC is a streaming word decompressor between the cartridge bus and the
ordinary mapped GX GP0 port. It is not a host image loader and it never produces
PNG, RGBA, a backend texture or a private GX command path. The ROM producer
first converts a cart atlas to native GX direct16 or palette4 words and then
encodes that payload as the BMSX `IMD1` word stream.

The registerfile starts at `08010400h`:

| Address | Register | Direction |
| ---: | --- | --- |
| `08010400h` | `INPUT_WORD_COUNT` | R/W |
| `08010404h` | `TEXTURE_DESTINATION` | R/W |
| `08010408h` | `TEXTURE_SIZE` | R/W |
| `0801040Ch` | `CLUT_DESTINATION` | R/W |
| `08010410h` | `CONTROL` | R/W |
| `08010414h` | `STATUS` | Read-only status word. |
| `08010418h` | `DATA` | Compressed input on write; GP0 output on read. |
| `0801041Ch` | `INPUT_WORDS_RECEIVED` | Read-only progress word. |
| `08010420h` | `DECODED_WORD_COUNT` | Read-only payload progress word. |

`CONTROL.START` is a self-clearing start strobe. Configuration writes wait while
the decoder is busy, so a new stream cannot overwrite active configuration.
`STATUS` exposes only `BUSY`, `DONE`, `INPUT_REQUEST`, `OUTPUT_REQUEST` and
`FORMAT_FAULT`. `IRQ_IMGDEC` is raised when the final output word is consumed or
a format fault stops the stream.

IMGDEC owns a 32-word compressed-input FIFO, a 64-word GP0-output FIFO and a
4096-word chronological history ring. Input DREQ `IMGDEC_WRITE` (selector 5)
asserts only when the input FIFO can accept the next complete sixteen-word DMA
block, shortened for the programmed final input block. Output DREQ
`IMGDEC_READ` (selector 6) asserts only when the output FIFO contains the next
complete sixteen-word block, likewise shortened for the final output block.
The input and output DREQs are independent; the DMA controller arbitrates the
shared physical bus between them.

Firmware first programs the IMGDEC stream and destination words, then arms DMA1
from `IMGDEC_DATA` to GX GP0 with read selector 6 and write selector 1. It arms
DMA0 from `CART_ROM` to `IMGDEC_DATA` with forced reads and write selector 5,
then strobes `START`. The decoder emits an ordinary GP0 A0 texture packet and,
for palette4 assets, an ordinary A0 16-by-1 CLUT packet. GX therefore contains
no IMGDEC register state, request/grant protocol, continuation latch, abort
callback or direct submission API. CPU writes, raw DMA command streams and
IMGDEC output all reach the same mapped GP0 hardware boundary.

Decode is scheduled in batches of at most sixteen output words. A batch becomes
visible in the output FIFO, history and decoded-payload counter only at its
cumulative device deadline; IMGDEC does not prefill untimed data and charge for
it later. Each synthesized three-word GP0 header and each decoded payload word
costs two CPU cycles. The no-stall decoder ceiling is therefore 67.74 MB/s at
33.8688 MHz, while `DECODED_WORD_COUNT` counts payload words only. End-to-end
throughput is also bounded by compressed `CART_ROM` DMA bandwidth, compression
ratio, shared-bus arbitration and GX FIFO backpressure. Token parsing adds no
second payload-rate budget.

Forced DMA still drives the physical input port when its FIFO is full: the FIFO
drops the presented word and `INPUT_WORDS_RECEIVED` advances. Normal CPU stores
and selector-5 DMA instead obey the input port's ready/DREQ signals. An empty
`DATA` read returns the retained data latch. These are deterministic raw-port
semantics, not corruption recovery.

`DONE` means that the final GP0 output word has been consumed from IMGDEC, not
that a render backend has presented the resulting VRAM contents. A format fault
stops decode, deasserts both DREQs and raises `IRQ_IMGDEC`; already admitted DMA
or GP0 state remains where its hardware owner accepted it. IMGDEC does not
truncate, restore or roll back GX state. GP1 reset and command-buffer clear keep
their normal GX meaning and have no IMGDEC sideband.

Supervisor entry prevents a new `START`, lowers both IMGDEC DREQs and lets only
the already scheduled batch of at most sixteen decoded words reach its deadline.
It then pauses the live stream in the physical decoder state; it does not drain
the complete texture/CLUT transaction. After that producer batch is quiescent,
DMA closes admission and completes only its one admitted block, then GX closes
and drains its own admitted ingress. Monitor exit releases the latch and
schedules the next decode batch from the exact paused phase. A non-resumable
supervisor fault resets the decoder datapath. Normal save/load retains the raw
register words and data latch, input/output FIFO contents, progress and output
counters, decode/output phases, run latches, chronological history, pending
batch and remaining deadline, and the supervisor-quiesce latch. DMA separately
retains both channels, its control/admission gates and its single admitted block;
GX separately retains its control/ingress gates and normal GP0 state.

An `IMD1` stream begins with magic word `31444D49h`, decoded texture-payload
word count and decoded CLUT-payload word count. Each token uses its top two bits:

- `00`: literal run; low 30 bits are `count - 1`, followed by `count` words;
- `01`: repeated-word run; low 30 bits are `count - 1`, followed by one word;
- `10`: back-reference; low 12 bits are `distance - 1` and bits 12--29 are
  `length - 3`;
- `11`: zero run; low 30 bits are `count - 1`.

The retained 4096-word history permits overlapping back-references. Texture and
CLUT counts are 32-bit GP0 payload-word counts; a palette4 stream emits the
second fixed 16-by-1 CLUT upload to `CLUT_DESTINATION`. Destination and size
registers remain raw GP0 words and are not decoded into a host-side descriptor.
Every token run must end within the declared combined payload and the programmed
input span must end on the token that produces its final word; unavailable
history, truncated runs and trailing words latch `FORMAT_FAULT`. The ROM
inspector calls the same tooling decoder with the exact TOC texture span before
previewing a cart image. Firmware-resident system textures remain deliberately
uncompressed raw GP0 uploads.

### GX GPU/GTE

Cartlib submits painter-ordered 2D work through one retained visual-component
list per world space. Sprite, surface, tile, text and custom visual components share the
same effective depth `parent.z + offset.z + draw_offset.z`; lower depths submit
first and higher depths submit last. Activation sequence is the stable equal-z
tie-break. Add/remove updates that same list and its indices, while one in-place
BIOS sort accounts for runtime depth changes before the visual system draws the
components polymorphically. Cart-authored depth alone establishes occlusion;
there are no kind-priority stages, subsystem draw
escape paths, per-frame display-list records or backend-facing visual DTOs.

Text layout is retained component state. Text, font, wrap or textobject-dimension
mutation rebuilds wrapped lines, glyph references and widths. Typewriter state
reveals those retained glyph references by index; neither typing nor steady
presentation rescans strings. Sprite modulation remains one packed GX color
word from cart producer through command submission.

GX GPU/GTE is the cart graphics ABI and the only cart graphics path
executed by host render backends. The old cart-visible VDP/RPU firmware ABI and
the WebGL, GLES2, and software/headless RPU presentation executors are removed.
Backend-local shader programs, buffers, textures, render targets, and draw-call
issue remain concrete GX backend ownership; there is no presentation facade
between GX command buffers and those backends. The mirrored VDP/RPU device trees
and the former host-PNG/RGBA IMGDEC path, mapped apertures, VBlank hooks and
descriptor state are removed. The current streaming IMGDEC is a separate raw
register/FIFO datapath whose output DMA reaches the mapped GP0 port, not a
presentation route. ROM metadata has no `vdp_class` compatibility route.

The GP0 command processor has two distinct fixed physical stages: one
sixteen-word DMA ingress buffer for the currently admitted block and one
sixteen-word command FIFO behind the packet sequencer. It also has one integer
execution clock running at two GPU ticks per CPU cycle. Packet decode admits a
command to the retained execution stream; the scheduler
completes it at its absolute device deadline. GPUSTAT receive-ready, idle, DMA
request and the published execution frontier derive from that same state. A CPU
GP0 store that reaches a full FIFO remains the pending CPU instruction and
resumes at the next device edge that makes its exact MMIO address writable;
neither CPU nor host polls, retries, drops, or queues a replacement word.
Save-state preserves the DMA ingress buffer, sequencer phase, command FIFO,
packet assembly, execution frontier, and active deadline relative to scheduler
time.

The ingress sequencer tracks fixed packets, CPU-to-VRAM headers and payload
length, and mono/Gouraud polyline vertex phase before deciding whether an
accepted word reaches the FIFO. At a proven command boundary GP0(00h),
GP0(04h--1Eh), GP0(E0h), and GP0(E7h--EFh) are discarded as physical NOPs, while
GP0(E3h--E5h) write the drawing-area and drawing-offset register latches
directly. These words consume neither FIFO capacity nor execution time and can
take effect while older raster packets remain queued. Fixed parameters, image
headers/payload, and polyline payload are opaque; a polyline terminator is still
stored so the execution-side packet owner consumes the same stream boundary.
GP0(03h) occupies one FIFO word like other unknown commands.

Non-final words of a DMA block enter only the DMA ingress buffer. `BLOCK_END`
then advances that buffer, in order, through the packet sequencer and into the
command FIFO as capacity becomes available; CPU writes enter the sequencer
directly. Normal DMA cannot overrun the ingress buffer because GX lowers DREQ
before another block is admitted. A forced DMA stream can ignore that
handshake: every word still reaches the GP0 data latch, while a word presented
to a full DMA ingress write port is discarded. Neither stage's retained count
can exceed its own sixteen physical words, and forced malformed streams remain
deterministic across save/load without a combined thirty-two-slot fiction or
status synchronization in the per-word mapped-bus path.

GP1(04h) selects the GPUSTAT bit-25 request mux. FIFO mode exposes the
one-block DMA-ingress admission line: the ingress buffer is empty and the
downstream command FIFO has at least one slot. CPU-to-GP0 mode exposes the
stricter GPUSTAT bit-28 packet-admission line; GPUREAD-to-CPU mode exposes bit
27. The selected write request is the same line consumed by the DMA controller,
while direct CPU writes retain their independent physical command-FIFO-slot
readiness and also wait for an empty DMA ingress stage.

GPUSTAT bit 28 reports command-front-end block admission rather than rasterizer
idleness. Ordinary incomplete fixed packets remain ready; a complete packet
still queued behind earlier work is not. Polygon and line opcodes lower the bit
immediately and keep it low through the complete packet, while a polyline keeps
it low through its terminator. Dispatch reopens the front end even while bit 26
still reports downstream raster work. CPU-to-VRAM payload streaming instead
follows physical FIFO capacity, so an A0 upload can cross multiple admitted DMA
blocks. In CPU-to-GP0 mode bit 25 is exactly this bit-28 line; FIFO mode remains
the independent physical FIFO-not-full line.

GP1 decodes the complete eight-bit command field. Undefined commands in the
40h--FFh range are no-ops rather than aliases of commands 00h--3Fh, matching
Mednafen's physical-hardware observation and MAME's control decoder.

GP0(1Fh) asserts the GPUSTAT interrupt-request source and raises `IRQ_GPU` only
on its low-to-high transition. `IRQ_ACK` clears the IRQ controller's pending
edge without changing GPUSTAT, so another GP0(1Fh) cannot retrigger while the
GPU source remains asserted. GP1(02h) deasserts the GPU source but does not
clear an already-pending `IRQ_GPU`; cart code acknowledges that pending bit
through `IRQ_ACK`. This keeps the GPU source latch and the system interrupt
pending latch as two distinct hardware words.

A cart that page-flips uses that ordered GP0 IRQ packet as its completion fence:
it finishes the back page, appends GP0(1Fh), waits for `IRQ_GPU`, programs
GP1(05h), snapshots the VBlank sequence after that store, and waits for the next
sequence edge before reusing the former front page. Missing the current beam
edge can delay publication by one frame but cannot expose a page still being
written. The cart waits through `halt_until_irq`; it does not poll GPUSTAT,
drain a host queue, or ask the renderer to publish an atomic frame.

Machine/device reset and GP1(00h) are distinct GPU transitions. A machine reset
regenerates the deterministic raw-VRAM power-on contents, advances the shared
unsigned 64-bit snapshot revision, clears the retained command stream, initializes
the physical scanout beam/VBlank/field phase, and initializes the VBlank-latched
presentation state. GP1(00h) resets GPU registers at the current physical scanout
phase and applies the same packet/FIFO transition as GP1(01h). It does not publish
those reset register values directly: the previous presented registers remain
visible until the next VBlank presentation edge, and neither the prior edge result
nor a pending compacted-VRAM publication is discarded.
Its register reset clears the E1 texture-page-Y-high bit, mirrored in GPUSTAT
bit 15, but preserves the separate GP1(09h) VRAM-Y-address-extension latch;
only machine reset clears that latch.
Already accepted backend commands and received image payload remain in the
retained execution log. The surviving accepted execution frontier completes at
the GP1 transition and its old device deadline is removed, while an incomplete
packet/polyline and an active readback suffix are discarded. GP1(00h) preserves
both the GPUREAD data latch and the installed VRAM contents; machine reset clears
the latch to zero. Every render backend consumes the same raw snapshot revision;
the command buffer has no second VRAM-clear signal or backend-specific reset
route.

GP1(01h) clears in-progress GP0 packet/FIFO state and aborts an active
VRAM-to-CPU transfer. Commands before a still-pending C0 fence remain in their
stable retained prefix; the C0 marker and its queued suffix are discarded.
Abandoned image headers and partial polylines truncate their uncommitted word
suffix; already received image payload remains one partial upload command and
completes at the reset edge. A surviving accepted raster command likewise
advances the execution frontier immediately, whereas a removed C0 marker never
activates readback. In every case the pre-reset GPU deadline is cancelled.
Submitted or ready readback state is invalidated by generation, lowers the DMA
ready line, and cannot be completed by a stale backend callback. The GPUREAD
data latch and raw VRAM remain unchanged.

GP0(C0h) is an execution-stream fence. Commands through that marker execute
before the backend reads raw VRAM; later commands remain unpublished until the
entire transfer has been consumed. `GxGpuReadbackPort` owns the request latches,
fence, completion phase, fixed 512K-pixel exchange storage, and read cursor.
The device deadline that activates C0 stops CPU execution at that exact machine
cycle. The host then asks the active backend to execute through the C0 fence;
this is independent of VBlank sealing and scanout presentation. Synchronous
backends resume the same host frame. WebGPU submission and mapping suspend the
in-flight machine frame, and their elapsed host time is discarded rather than
converted into machine catch-up time. If restore replaces a request while an
older map is still in flight, the backend claims the replacement request,
invalidates the old completion by token and submits the claimed fence when the
mapping buffer becomes available; the host never spins or advances machine time.
Software backends copy directly from their raw-VRAM owner. Accelerated backends
pack the logically wrapped 16-bit pixels on the GPU and perform one API
readback into that retained exchange storage; they do not maintain a CPU VRAM
shadow or run a per-pixel pack loop. GPUREAD emits the low pixel first, pads an
odd final high halfword with zero, and leaves the final data latch unchanged
after completion.

Backend VRAM capture executes through the device's complete execution frontier,
not merely the last VBlank presentation frontier. The captured raw snapshot
replaces that exact command prefix and rebases the retained suffix. When capture
occurs between VBlanks, the GPU retains one presentation-pending latch so the
new raw snapshot is published on the next VBlank exactly once. The machine
owner holds both execution and rendering gates across asynchronous backend
capture and state encoding, so the copied bytes and retired prefix cannot come
from different live command-stream generations.

#### Raster and store datapath

GX rasterization uses raw PSX-style integer coordinates and state through the
store boundary. Triangles use top-left edge ownership and half-open bounds;
polygon coordinates wrap at the raster bucket after primitive-size rejection.
Textured and Gouraud polygons use the shared signed fixed-gradient plane with
twelve fractional bits, half-texel seed, and twenty-bit UV accumulator wrap.
Textured rectangles retain their separate fixed-function sampling rule: packet
U/V names the texel sampled by the first covered destination pixel, and the E1
rectangle flip bits change the per-pixel step from +1 to -1 on that axis.
Accelerated rectangle vertices seed a negative axis one texel past packet U/V so
fragment-center interpolation followed by integer texture addressing produces
the same first texel and decrement sequence as the fixed-function software
datapath. This phase belongs to rectangle emission in each backend, not to a
host-coordinate conversion helper or to cart-authored UV adjustment.
Lines use the integer DDA and wrap each emitted sample to signed eleven-bit
coordinates. Endpoints exchange only when the first X exceeds the second; a
vertical line therefore retains GP0 packet order, matching MAME's
[`GouraudLine`](https://github.com/mamedev/mame/blob/389e99d4cea2a7a62e0cce227000c4c7d0efdd6b/src/devices/video/psx.cpp#L2149-L2262)
ordering rather than reversing equal-X colors before fixed-point interpolation.
Drawing offset, inclusive drawing area, texture window/page,
packed palette texels, CLUT addressing, STP, mask bits, four five-bit blend
modes, dithering and RGB555 storage remain raw datapath stages rather than host
float/color corrections.

Both software rasterizers intersect the three affine triangle edges into one
exact inclusive span per scanline. Each edge divides only while its
quotient/remainder stepper is initialized; scanlines advance that stepper with
integer additions, so bounding-box rejection does not occur in the pixel loop
and division does not occur in the scanline loop. Their fixed-gradient producer
emits raw twenty-bit accumulator words as `u32`/`Uint32Array`; software UV and
color steppers retain and consume those words in that representation. Their
VRAM store owner performs the four RGB555 blend modes with packed five-bit lane
arithmetic before applying STP and mask-bit store state. C++ additionally
selects texture depth, raw/modulated texturing, semi-transparency, color
interpolation and dithering once per primitive through compiled specializations.
These are shared software-datapath rules, not host-specific SIMD paths or
alternate renderers.

GX selects the type-2/208-pin drawing-area contract: GP0(E3h/E4h) retains all
ten Y bits. GP1(09h).0 gates address bit Y9 at the existing GP0 raster/transfer
VRAM decoder for drawing-area bounds, texture pages, CLUTs, transfers, copies,
fills and readback. With the gate closed, logical Y addresses alias into rows
0--511. With the gate open, all ten bits enter the fixed 1024-row GX address
space. GP0(E1h).11 is the raw texture-page Y9 bit in either state and GPUSTAT
bit 15 mirrors that latch; it never disables texturing. PCRTC reads use their
own exact `DISPFB` address/format contract rather than inheriting this GP1
latch, but reach the same installed physical word array.

The selected model installs a power-of-two number of complete 1024-word rows.
The physical decoder masks the linear GX word address to that installed word
count after the GP1 logical-Y gate. A model with fewer than 1024 installed rows
therefore exposes deterministic physical aliases; it does not return zero,
open-bus data or a host fallback. The current `psx` model installs all 1024 rows
and consequently introduces no additional alias when the Y9 gate is open.
There is no unpopulated upper bank, pulled-down read behavior, legacy half or
second VRAM owner. Commands retain the GP1(09h) latch that applied when they
entered the execution stream, and GP0(C0h) retains it for the complete readback
transfer. Standard BSX firmware and cart producers target the current model,
open the gate and allocate across its 1024 rows except the shared bottom-right
system reservation. Closing the gate remains deterministic address-decoder
behavior, not an allocator mode.

Software and accelerated backends own one raw-VRAM resource with exactly the
selected model's installed word count. They apply the captured Y9 gate and then
the installed-word decode; they do not create a 2-MiB shadow, zero-read mask or
second image. Accelerated textures use 1024 columns and derive their storage-row
count once from the installed capacity. When logical rows alias that storage,
destination geometry is submitted in physical row bands while shaders retain
the original logical row for raster phase, gradients and source addressing.
Dirty coverage, sample synchronization, texture/CLUT overlap, transfers,
readback and scanout use the same physical alias. Generated primitives and
transfer segments remain in outer command order, including across aliased
bands. Dependent submissions synchronize the VRAM sample shadow between draws
so blend, mask and texture feedback observe prior writes. Line and polyline
segments keep their own order as well. Fill and image-transfer commands retain
their separate VRAM datapaths.

Every render-backend instance owns its core programs, textures, buffers,
readback state, retained command frontier and preallocated submission scratch.
Browser pass registrations own their frame-uniform storage,
fullscreen-geometry scratch and post-process resources for the lifetime of their
`RenderPassLibrary`; the native GLES backend owns the corresponding pipeline
state and retires its resources through the context/pass lifecycle. The
headless backend owns its framebuffer views, handle sequences and
glyph-rasterization context. Host-overlay publication belongs to the
corresponding `VideoPresenter`; accelerated overlay resources belong to that
presenter's backend/pass lifecycle. Render modules retain only immutable
constants, shader sources and stateless datapath functions. Constructing a
second backend/presenter pair therefore creates an independent renderer and
overlay lane rather than replacing process-global resources or in-flight state.
CRT noise derives its per-frame offset from the presenter frame index through
the mirrored 32-bit hash; it does not consume a host-process random-number
generator.

Accelerated primitive batches retain the rasterizer class `Polygon`,
`Rectangle`, or `Line`; draw rectangles and fill rectangles therefore share the
same rectangle coverage without pretending to retain a representative GP0
command. Only the vertex/uniform boundary decodes polygon versus rectangle
sample phase. VRAM transfer vertices carry destination position plus a constant
source-minus-destination offset. The fragment datapath derives the integer
destination pixel from the backend fragment position and adds that offset
before VRAM wrapping, so copy semantics do not depend on interpolated texture
coordinates. Integer-fetch backends address texels directly. GLES2 converts
those integer addresses to normalized `texture2D` coordinates at the sampler
boundary, where adding one half texel is the required texel-center conversion
rather than VRAM geometry or a copy correction.

TS and C++ software renderers are the executable oracle for this contract, not
a fallback inside accelerated backends. WebGL2, WebGPU and GLES2 consume the
same command and raw-state representation and must run the same conformance
vectors. Backend-specific vertex/shader representations may implement the
datapath, but may not change coverage, intermediate precision, command order or
VRAM-visible stores. New BSX GPU/GTE+ extensions remain separate from this base
command set and are added only after the affected PSX-style behavior is fixed.

#### Texture production and VRAM residency

The ROM producer encodes images as native direct16 or palette payloads, wraps
each cart texture group in a compressed `IMD1` stream, and emits that stream as
one explicit `texture` resource. Its metadata owns `mode`, `word_width`,
`height`, `texture_word_count` and `clut_word_count`; its ordinary TOC range owns
the only physical payload span. Each packed image stores integer texture-local
coordinates and a stable `gx_texture_resid` reference to that resource. Cartlib
resolves and caches the texture by resource id, never by coincident physical
addresses, and passes the resource's raw counts and shape to firmware IMGDEC.
Palette placement is derived from the native texture extent rather than
serialized as a second offset. A filename `@atlas=N` suffix is only a producer
packing-group directive: its numeric value is not serialized into the image ABI
and is not visible to BIOS, cartlib, GPU or DMA.

Each cart declares physical VRAM destinations, reserved regions and simultaneous
working sets in `gx_texture_layout`. The producer validates the complete layout
and emits only each packed texture/CLUT slot's physical destination words. The
cart decides when a compressed texture payload is transferred and which region
it replaces. Firmware programs IMGDEC's raw destination words and DMA moves the
compressed ROM words; IMGDEC emits the GP0 transfer packets. A cart may still
DMA a deliberately uncompressed native GP0 stream as the direct bypass.
Ordinary sprite/tile images stay within one hardware texture page; the
rectangle primitive therefore emits exactly one native packet. Explicit large
image groups are producer-partitioned into retained page-local records and use
the cartlib surface component's single linear submission pass. Firmware never
discovers or splits image pages at draw time. There is no runtime semantic slot
manager, atlas cache, scene-aware firmware policy, host image decoder or mapped
RGBA staging aperture.

#### Accelerated backend execution

The accelerated raw-VRAM texture is authoritative. CPU uploads, GPU draws,
fills and VRAM copies enter one ordered backend command stream. A retained dirty
coverage record tells a sample texture which raw-VRAM region must be copied
before a source or destination read. The GLES2 backend uses framebuffer fetch
only through `GL_ARM_shader_framebuffer_fetch`, the native path relevant to an
ARM GLES2 target. It deliberately does not compile or select
`GL_EXT_shader_framebuffer_fetch`: no supported BMSX target that requires the
GLES2 backend provides that route, so carrying a second shader ABI and
capability branch would be targetless complexity rather than an optimization.

Framebuffer fetch reads the previous raw destination word from the active
color attachment and removes destination sample copies and explicit texture
barriers. Dependency batches still keep overlapping read-modify-write
primitives in separate API draws. GLES2, WebGL2 and WebGPU walk their retained
triangle stream once in submission order and extend the current dependency draw
only while the next clipped destination bounds do not intersect its accumulated
bounds. The first intersection ends that draw. This is the bounding-box batching
model specified by
[`GL_NV_texture_barrier`](https://registry.khronos.org/OpenGL/extensions/NV/NV_texture_barrier.txt):
one draw contains only mutually non-overlapping destination readers, and
primitives are never reordered. Texture-source aliasing remains a per-triangle
boundary. On the NV route, texture-page and CLUT reads use the stable sample
texture while a separate sampler reads only the attached destination; the
bounding box is therefore the complete live feedback read/write set. The NV
route issues one barrier per dependency draw; the dependency-copy routes
synchronize the retained sample texture once before each subsequent draw; ARM
framebuffer fetch uses the same draw ordering without those copies or barriers.
The scan uses retained rectangles and performs no heap work.

Framebuffer fetch does not replace arbitrary texture-page or CLUT reads: those
continue to use the retained sample texture, and a source that aliases its
destination remains an ordering boundary. Without ARM framebuffer fetch, GLES2
uses the resolved `GL_NV_texture_barrier` procedure when its ordering rules
permit it; otherwise the exact dependency-copy path remains the owner.
Capability choice is fixed at backend context creation and never leaks into
cart or firmware code. Backends do not silently weaken GX blend, mask or
ordering semantics for a slower host.

Compatible solid, line and textured commands append to backend-owned retained
arenas until render state, capacity or a real VRAM dependency forces submission.
Mixed command order is retained and read-modify-write triangles remain ordered.
Texture-page and CLUT bases are primitive sampling data, not pipeline state.
GLES2, WebGL2 and WebGPU decode them once at the command-to-vertex boundary and
store the four coordinates in one packed `uint16x4` vertex attribute. The
vertex shader carries that value unchanged to the fragment datapath. Page and
CLUT changes therefore neither publish uniforms nor end a compatible batch;
texture mode, texture window, raw/modulated mode, active blend mode, mask state,
dither state, field parity and actual VRAM dependencies remain batch boundaries.
Rectangle flips are already resolved into the retained UV plane. This follows
the same production design used by
[DuckStation's per-vertex texture page](https://github.com/stenzek/duckstation/blob/42bf523e891fad7959a4d9dd171929a65ea25988/src/core/gpu_hw.h#L120-L134)
and [Beetle PSX HW's per-vertex page/CLUT inputs](https://github.com/libretro/beetle-psx-libretro/blob/59e43186cacee4c656a56a4c505b8c16ade90506/rhi/rhi_lib_gl.c#L468-L478).
It does not reorder primitives, cache cart imagery or depend on a framebuffer
extension.

GLES2 additionally uses one driver stream whose cursor survives frame boundaries
and whose storage is orphaned only at capacity wrap; WebGL2 and WebGPU keep
their own concrete upload lifecycles. CPU arenas, bounds, transfer staging,
pack/readback storage, descriptors and backend state are retained owner data:
steady rendering must not allocate per command, build a second vertex/VRAM
representation, or copy an entire stream for presentation.

The GLES2 dependency planner retains normalized line and rectangle payloads with
their clipped bounds. Layer emission consumes those prepared payloads directly,
and each batch carries its draw bounds through execution; it does not decode or
clip the same command a second time. The measured command envelope uses a linear
overlap scan over retained bounds. Spatial bins or another index belong here
only after a representative workload demonstrates that the scan, rather than
command execution or the driver, is the bottleneck. Planning, overlap checks
and layer emission perform no heap work in the steady path.

CPU-to-VRAM packets remain discrete GX commands. Accelerated owners expose the
command owner's retained word storage as bytes and submit those direct16 bytes
without a CPU pixel loop, RGB555 conversion or 16-to-32-bit host expansion.
WebGL2 and WebGPU upload into one retained two-channel staging texture and apply
GX mask-bit semantics in a transfer draw. GLES2 stores each raw GX word across
the four nibbles of its RGBA texture representation: complete, unmasked,
nonwrapping rectangles upload directly with the core
`GL_UNSIGNED_SHORT_4_4_4_4` type, while masked, wrapping or partial commands use
the retained two-channel staging texture and the same GPU transfer semantics.
The linear staging layout uses 1024-pixel rows, so a packet uses one host texture
upload when it fits in one staging row or ends on a staging-row boundary, and
two only when it contains complete rows plus a final partial row. Destination
wrapping only emits bounded retained transfer geometry and does not repack
pixels. The GLES2 path uses only core GLES2 formats and entry points.

The direct libretro host can opt into fixed-scalar profiling through a private
versioned interface. The core publishes a monotonically numbered
completed-render sample containing semantic command/byte counts, actual host
call/byte counts, and CPU duration. This profile is host observation only:
ordinary frontends decline the interface, and the disabled profiling path adds
no clocks or counters inside its transfer loops.

Pixel parity is a machine contract at GX VRAM scanout. For the same ROM,
timeline, model profile, and GX display registers, the TypeScript headless
software reference, C++ libretro/software renderer, and accelerated GLES2
renderer must emit byte-identical RGBA screenshots before host presentation
effects. Nonblank screenshots or boot-screen parity are not render-parity
evidence. `npm run test:render-parity` first force-builds the exact headless
runtime, libretro core, direct host, BIOS and cart images consumed by the gate.
It then generates fresh captures from the purpose-built `renderhwtest` and
`bare_metal_cart` scenes through all three paths and compares dimensions and
every RGBA byte. It does not preserve game screenshots as goldens.

Shader source layout, helper names, uniform spelling, and textual normalization
are not parity contracts. Backend implementations may differ where their GPU
APIs require it; their own compiler and linker validate the concrete shader
interface, while rendered output validates behavior. WebGL2 and WebGPU require
the same capture comparison in a real browser before accelerated parity is
claimed for those backends.

CRT postprocessing and RGB565/MSX10 output quantization are host presentation,
not runtime or machine state. Parity captures disable these effects, including
`bmsx_crt_noise`, so they prove machine pixel output rather than host decoration.

### APU and AOUT

APU is a fixed-rate audio device, not a host sound service. Its hardware sample
clock is 44.1 kHz. Host callback cadence, host sample rate, audio-device buffer
size, and whether a host drains audio at all never advance or modify an APU
voice.

Cart-visible ingress and state are:

- parameter and selected-slot registerfiles;
- command FIFO words and command-queue status;
- source/sample memory;
- active-slot, status, fault, event, and IRQ latches.

The service clock retains an absolute machine-cycle edge, the fractional
CPU-cycle-to-sample carry, and the absolute DAC-sample sequence. It synchronizes
the voice datapath and sample-transfer datapath to the exact current machine
cycle before live selected-slot writes, command admission, timing-dependent
reads, and save-state capture.
Normal service runs are batched to at most 128 samples, but the next service
deadline is shortened to the first finite-source or fade completion. Slot END
and its IRQ therefore occur on the exact hardware sample edge without
scheduling one emulator event per sample. Command FIFO consumption occurs at
the command-write machine-cycle edge; a batch can never render across a live
register mutation.

`machine/devices/audio/slot_bank` owns raw slot register words, slot phases, and
active-mask state only. The live AOUT voice record is the single playback
datapath owner. It retains:

- signed Q16 source cursor;
- the signed division remainder for `rate_step * source_rate / 44100`;
- decoded source and loop bounds;
- signed-Q12 current gain plus the integer fade quotient, signed remainder,
  error accumulator, and sample counters;
- fixed-44.1-kHz filter coefficients/history;
- BADP seek state and the retained current/previous decoded-frame window used
  by interpolation.

The quotient and remainder are retained separately so synchronization batch
size cannot change pitch, loop position, or END timing. Source-rate/rate-word
products are decoded when voice programming changes, not in the per-sample
loop. The 32-bit gain register is decoded once as signed Q12 and retained without
clamping, so negative and overrange words remain distinct hardware inputs. A
STOP fade derives one integer quotient, signed remainder, and initial error from
that retained gain; each DAC edge advances the error and current Q12 gain without
floating point or a per-sample divide. A live gain write during a fade writes the
current signed-Q12 latch and derives a new fade slope over the remaining edges.
The current-gain latch wraps as signed 32-bit state and the error latch commits as
unsigned 32-bit state on every edge, including for non-canonical but representable
save-state bit combinations.

Each voice contributes `signed_i16_sample * signed_Q12_gain` directly to a wide
stereo accumulator. TypeScript stores exact integer-valued `number` entries in a
retained `Float64Array`; with sixteen voices the largest representable sum stays
below `2^53`. C++ uses retained `i64` entries. After every voice has contributed,
the mixer performs one arithmetic Q12 shift and one signed-i16 saturation for
each left/right DAC sample. It never saturates or normalizes an individual gain
product or mix contribution before the sum; the separate biquad datapath retains
its own documented i16 output boundary. This follows the signed integer
volume-product and explicit accumulator-boundary model used by
[DuckStation](https://github.com/stenzek/duckstation/blob/39fe70c84b10600727c6d176791fee8ae86705b1/src/core/spu.cpp#L43-L50) and
[Mednafen](https://github.com/libretro-mirrors/mednafen-git/blob/f0ee9d595db68ad5247ba5ac6a8367fdced9c3fc/src/psx/spu.cpp#L716-L731), while
BMSX keeps its own Q12 and sixteen-voice hardware contract.

PCM mixing uses retained fixed-capacity scratch buffers. Sample generation, host
pull, PLAY, and live source replacement perform no allocation. Only save-state
capture may allocate serialized state outside the realtime datapath.

When PLAY or a live source-register write binds cartridge ROM, the command
datapath samples the currently decoded cartridge socket and the voice retains
that socket alongside its direct ROM view. Later `CART_SELECT` writes therefore
do not retarget an active voice. Save-state retains the socket latch and restore
rebinds the immutable source through it; no cartridge selection occurs in the
per-sample loop.

The mixer writes the continuous 44.1-kHz machine timeline, including silent
intervals, to the 3072-frame AOUT presentation ring. Each batch carries its
absolute DAC sequence and the ring retains the sequence of its oldest frame.
The ring is not cart-visible hardware state. When a host is late or absent, it
keeps at most about 70 ms and overwrites older presentation history while voice
phase, filters, fades, END events, IRQs, and emulated time continue normally.
The former AOUT occupancy MMIO words remain reserved address holes so the later
APU register addresses do not move; APU status exposes command FIFO state, not
host queue occupancy.

`audio/AudioOutputResampler` owns retained 44.1-kHz-to-host-rate conversion.
Browser and libretro output owners retain one resampler and own target buffering
and underrun policy. They request bounded chunks without
choosing APU time or changing device cadence. Resampler phase
and boundary samples persist across callbacks and source starvation. If AOUT
has overwritten the sequence following a retained interpolation endpoint, the
resampler starts at the oldest still-present frame without resetting the
fractional output-clock phase. A pull publishes only the frames backed by a
complete interpolation window; it neither waits for a second source-side
prebuffer nor pads an unavailable tail with queued silence. Immediately before
a host drain, the APU controller materializes samples only through its own
current scheduler cycle.
This removes the internal 128-sample service quantum from host cadence without
generating future machine audio or moving the absolute next device deadline.
The browser worker writes exactly that produced prefix into its retained
AudioWorklet transport, while libretro submits exactly that produced prefix to
the frontend batch callback. Buffer targets and underrun policy therefore stay
at the actual host transport rather than accumulating another frame of hidden
machine-output latency. Clearing or underrunning host transport can produce
silence only; it cannot backpressure the APU.

`hosts/common/HostAudioOutput` owns the TypeScript browser/Node transport
lifecycle and nested pause, Studio, debugger, and system-task mute reasons.
Libretro has no browser audio context or Studio lifecycle:
`hosts/libretro/LibretroAudioOutput` owns its frontend frame batch and fractional
sample accumulator. This host-specific lifecycle difference stays outside the
mirrored machine runtime; the resampler and APU/AOUT representations remain
mirrored.

Save-state first synchronizes the unified APU clock domain to the scheduler cycle, then
captures the command FIFO, raw slot bank, internal sample-RAM and transfer unit,
service-clock carry and DAC sequence, event/fault latches, and the single live
voice datapath, including the signed-Q12 gain and fade quotient/remainder/error
latches. It deliberately excludes immutable sample-ROM, the AOUT ring, and host
resampler. Restore reinstates machine state at the restored cycle, clears
presentation transport, restores voices without generating samples, and
schedules the next exact hardware edge.

The mirrored owners are `machine/devices/audio/{controller,service_clock,
sample_memory,sample_transfer,active_slots,slot_bank,command_ingress,
command_executor,output,output_ring,save_state}` in TS and C++. Source metadata, PCM, BADP, filter, command FIFO,
event, selected-slot, status, and fault responsibilities remain in their
corresponding dedicated audio/device owner files.

The APU owns a separate 32-bit sample address space. It is not an alias of the
CPU bus. Four physical chip selects live on that bus:

- the immutable system sample-ROM at `0x00000000`;
- the immutable socket-0 cartridge sample-ROM at `0x10000000`;
- the immutable socket-1 cartridge sample-ROM at the same address, selected by
  the voice's retained cartridge-socket latch;
- 512 KiB of internal sample-RAM at `0x40000000`.

The three ROM chip selects make large cartridge music directly addressable, as
on a ROM-fed sample chip; they are not generic main-memory views. CPU instruction
storage and main RAM are absent from the sample bus. A voice range must fit wholly in one
physical window and never wraps. Internal RAM remains a single retained backing
store, so DMA writes become visible to every active voice at the transfer
datapath's hardware completion edge. PLAY, source replacement, and sample
generation allocate nothing. BADP voices retain only the seek-entry count and
table offset and binary-search the encoded table in place.

The three APU words historically reserved after the selected-slot register bank
are the transfer-address, 32-bit transfer-data, and raw transfer-control
registers. Control bits 1:0 select STOP, MANUAL_WRITE, DMA_WRITE, or DMA_READ;
all other bits remain raw and currently have no datapath effect. The address
register remains the programmed raw word, while its low nineteen bits with the
low two alignment bits cleared seed a separate physical RAM address latch.
Transfers increment that latch by four and wrap on the 512-KiB boundary.

MANUAL_WRITE stores one 32-bit data word directly in sample-RAM. DMA transfers
use a fixed sixteen-word FIFO. A write request is asserted only when that FIFO
is empty and a read request only when it is full, matching one block of the
existing sixteen-word DMA arbiter. DMA write overflow drops the unaccepted word;
DMA read underflow returns the retained transfer-data latch. CPU data reads
return that same latch. The mapped CPU/DMA bus carries its initiating master
and block-end strobes through the existing single IO decoder and handler table.
DMA-data reads pop only in DMA_READ mode and DMA-data writes push only in
DMA_WRITE mode. A wrong-direction DMA access still reaches the raw data latch,
but cannot mutate the other mode's FIFO. A
control-mode change first synchronizes the transfer
datapath, then cancels its outstanding batch and clears the FIFO; entering
DMA_READ begins filling it, while STOP has no transfer in flight. DMA completion
means that the last bus word was accepted by the FIFO, not that a pending write
batch has reached sample-RAM.

The internal transfer clock is `APU_SAMPLE_RATE_HZ * 24`, or 1,058,400 words per
second. `DEVICE_SERVICE_APU_TRANSFER` advances fixed batches with the same
integer budget/carry model used by the other timed units. The final DMA block
word schedules the accepted FIFO words as one batch at their shared completion
deadline; it never schedules one host callback per word. Batch visibility is
atomic at that deadline rather than a claim of per-word SPU-bus visibility. At
an equal scheduler cycle the transfer unit is synchronized before the voice
clock samples RAM. APU status preserves its
existing fault/selected-slot/busy/FIFO bits and adds DMA request at bit 7,
DMA-read request at bit 8, DMA-write request at bit 9, and transfer busy at bit
10.

The shared DMA controller's four-bit read/write selectors assign
`APU_WRITE=3` and `APU_READ=4`; the memory side uses `FORCE=0`. The APU does
not contain a second host-side copy engine.
Save-state synchronizes the APU clock domain, stores internal RAM once plus FIFO,
address/control/data latches, timing carry, and the relative transfer deadline,
and excludes immutable sample-ROM. The TS and C++ runtimes implement this same
sample-bus, transfer, DMA, and persistence contract.

The voice filter is a raw fixed-point DSP block, not a host-side filter-type
API. Its four existing slot words are `FILTER_CONTROL`, `FILTER_B0_B1`,
`FILTER_B2_A1`, and `FILTER_A2`. Control bit 0 enables the block; all other
control bits remain retained raw words without a current datapath effect.
`B0_B1` packs signed-Q14 `b0` low and `b1` high, `B2_A1` packs signed-Q14 `b2`
low and `a1` high, and the low halfword of `A2` is signed-Q14 `a2`. The unused
high halfword of `A2` is likewise retained but ignored. Every halfword pattern
therefore has direct deterministic meaning; the device no longer decodes
filter names, frequency, Q, gain, or host floating-point coefficients.

PCM and BADP decode to signed sixteen-bit samples. Q16 interpolation performs
one wide signed multiply and arithmetic shift by sixteen; the square generator
emits `32767` or `-32768`. Each stereo channel then executes a transposed
direct-form-II section with signed 64-bit intermediates:

```text
y   = arithmetic_shift_right(b0 * x + z1, 14)
z1' = low_signed_32_bits(b1 * x - a1 * y + z2)
z2' = low_signed_32_bits(b2 * x - a2 * y)
```

The unsaturated `y` feeds the recurrence. Only the sample delivered to the
mixer saturates to signed sixteen-bit; both delay-register writes wrap to their
low signed 32 bits. A disabled block passes the same interpolated signed-16
sample onward and freezes both stereo delay pairs. `PLAY` clears the delays
before loading the slot words. Live control/coefficient writes and source
replacement reload only the raw configuration and preserve delays.

The raw slot bank is the sole saved owner of filter configuration. A live voice
saves only `l1`, `l2`, `r1`, and `r2`; restore reloads the slot words first and
then reinstates those four delay words. TS and C++ use the same integer
datapath and exact raw-word vectors. The sample loop performs no trigonometry,
host-number validation, table construction, or allocation.

AEM keeps its author-facing filter names and parameters in cartlib. During AEM
rule compilation, `cartlib/aem_biquad.lua` uses the BIOS math owner to design
the section once and the BIOS numeric owner to round and saturate each
coefficient to signed Q14 before packing the four hardware words. The AEM
tooling rejects non-positive Q and frequencies outside the open interval from
zero to the APU Nyquist frequency; no runtime clamp repairs invalid authored
data. This split follows the production pattern of separating coefficient
design from retained raw filter state, as in
[MAME's biquad device](https://github.com/mamedev/mame/blob/master/src/devices/sound/flt_biquad.cpp),
while the integer sample boundary and explicit saturation follow the
[MAME PSX SPU](https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp),
[DuckStation SPU](https://github.com/stenzek/duckstation/blob/master/src/core/spu.cpp),
and miniaudio's signed-16 fixed-point biquad datapath.

### GEO

GEO is a geometry/collision accelerator.

Cart-visible ingress:

- command and parameter registers;
- source/result RAM addresses;
- device scratch/result memory;
- scheduler service and IRQ/status/fault words.

The `overlap2d_pass` command reads packed shape/instance/candidate records,
executes through the GEO controller, writes packed result records, and exposes
faults through GEO status/fault registers. Geometry math helpers are allowed only
under the GEO device boundary; cart-visible proof must use RAM/MMIO/status, not a
private direct helper call.

Cartlib submits both direct and full-pass overlap commands through the GEO
doorbell and waits on the device DONE/ERROR interrupt with `halt_until_irq`.
The cart IRQ dispatcher acknowledges the hardware line and latches the GEO
completion bits for the suspended collision call; collision code does not read
or acknowledge the global IRQ register itself. `overlap2dsystem` owns two
alternating pair-history maps, a retained pool for their row tables, retained
GEO result/contact records, and one synchronous overlap-event record. A stable
collider high-water mark therefore performs no per-frame row or event-table
allocation. `overlap.begin`, `overlap.stay`, and `overlap.end` handlers must
consume the transient retained record during dispatch rather than storing it.

GEO active-job latch records live in `machine/devices/geometry/job` on both
runtimes. GEO save-state record shapes live in
`machine/devices/geometry/save_state`; C++ keeps the aggregate GEO
capture/restore bodies in the matching save-state translation unit.

### ICU

ICU is the Input Controller Unit.

Cart-visible ingress is a raw 47-word MMIO registerfile:

- `sys_inp_ctrl` / `sys_inp_status` for sample control and the latched sample
  sequence;
- `sys_inp_keys`, eight words of USB HID keyboard usage bits;
- `sys_inp_pointer_buttons`, `sys_inp_pointer_x`, `sys_inp_pointer_y`, and
  `sys_inp_pointer_wheel` for pointer state;
- `sys_inp_pads`, four seven-word pad blocks containing `buttons`, `lx`, `ly`,
  `rx`, `ry`, `lt`, and `rt`;
- `sys_inp_output_port`, `sys_inp_output_intensity_q16`,
  `sys_inp_output_duration_ms`, `sys_inp_output_status`, and
  `sys_inp_output_ctrl` for output hardware.

State owned by ICU:

- raw control, keyboard, pointer, pad, and output latch words plus reset/restore
  register mirroring owned by `machine/devices/input/registers`;
- `sys_inp_ctrl` command side effects, private sample arm/sequence/last-cycle
  latches, the saved previous supervisor-request level, and both VBlank edge
  datapaths owned by `machine/devices/input/controller`;
- output command datapath owned by `machine/devices/input/output_port`.

The runtime VBlank owner enters through the ICU controller edge. The controller
consumes the arm latch into sample sequence/last-cycle state, asks the host
input owner to fill one raw `InputControllerSnapshot`, and decodes that snapshot
into raw MMIO words at the datapath boundary. Later cart reads consume only the
mirrored register words. Independently of the sample arm, the controller reads
the retained supervisor-request line once per VBlank and publishes its rising
edge to the system controller; only the completed common device fence raises
NMI. The ICU never decodes HID usages or controller buttons. The ICU does
not own action maps, action-expression
parsing, button-name string ids, consume state, repeat windows, guarded presses,
or a high-level event FIFO.

ICU device code consumes only `machine/devices/input/contracts` source ports.
The host input layer implements those ports and remains outside the device.
Host input adapters publish the supervisor-request line as a separate
retained input signal without turning it into a guest key. The browser runtime
keeps its shortcut, device-assignment, and PlayerInput state under
`hosts/common/input`. Browser DOM, hit testing, control styling, and control
layout remain in `hosts/browser`; the retained onscreen controller enters common
input as an ordinary `GamepadDevice`, not as a DOM proxy contract. Native
frontends normalize their external input ABI once into BMSX-owned numeric
source/device/control records; `hosts/libretro/input` retains fixed keyboard,
pad, and pointer state, and the native quick menu owns its own fixed edge/repeat
records. Those host implementations are intentionally target-specific. Only the
raw ICU source-port contract—snapshot input, supervisor line and vibration
output—is mirrored machine semantics. Host repeat timing never flows back
through `Runtime` or a machine input interface.

Gameplay/cart PlayerInput semantics live in `cartlib/input/player.lua` and
`cartlib/input/action_parser.lua`: cartlib reads the raw ICU MMIO snapshot,
owns per-player mapping contexts, action state, consume state, guarded/repeat
evaluation, parser caches, and scratch buffers. Normal carts use this Lua engine
layer. Bare-metal carts may intentionally read the raw keyboard/pointer/pad MMIO
words directly and must not route through cartlib for ICU access. BIOS code may
use raw ICU reads for boot UI, but it must not grow a gameplay PlayerInput
framework.

`sys_inp_ctrl` writes enter the control port. The control port latches the raw
command word through the registerfile, then arms the VBlank sample latch or
resets the raw ICU registerfile.

`machine/devices/input/save_state` is only the aggregate persistence boundary.
Live ICU register and sample-latch record shapes stay in their hardware owner
files rather than in a parallel save-state contract.

The output register bank is a raw pad-output datapath. Carts write an output
port, an unsigned-Q16.16 intensity word, and a duration word, then ring the
output doorbell. The ICU decodes those latch words at the output datapath
boundary and passes one output command to the selected pad's input hardware.
Status reads expose a bitmask of host output support by pad; that support mirror
is restored with the registerfile but is not gameplay state.

## Firmware and Lua layer

`machine/firmware/bios` is the firmware-ROM entry layer: `bootrom.lua`,
`system.lua`, and shared common/util helpers. Device-facing firmware Lua
helpers that are also useful to cart libraries live in `machine/firmware/system`
instead of pretending to be BIOS entry points. They remain firmware code: helpers emit RAM/MMIO words and do not own
host renderer/audio state.

BIOS and cart libraries may hide register programming behind helpers, but those
helpers must write/read the same RAM/MMIO words the cart could use directly.
Gameplay/cart files own intent values only. They must not define GX GPU/APU/GEO/ICU
ABI encoders, fixed-point helpers, register maps, packet layouts, or hardware
fallbacks locally.

Lua heap counts as RAM. Public accounting should talk about RAM, not a separate
heap budget outside the machine.
Heap accounting and collection thresholds are CPU-owned state per machine;
there are no process-global counters or Runtime-installed collection hooks.
Tables, dynamic closures, upvalues, and tracked strings reserve their exact
guest-RAM cost before committing growth. A reservation that crosses the
collection threshold or available RAM runs a full VM collection first, then
fails before the requested mutation if the live graph still does not fit.
Save-state rehydration is the explicit exception: restore-only accounting
rebuilds the trusted object graph without invoking collection while its roots
are incomplete, then the CPU collects and recomputes the live total once every
root has been installed.

The CPU retains fixed, untracked guest string values for allocation and VM
execution errors. An allocation failure therefore follows ordinary Lua
protected-call semantics without allocating its error value; `pcall`/`xpcall`
can receive `Out of memory.`. Only an unhandled allocation failure becomes
`LUA_FAULT_REASON_OUT_OF_MEMORY` in CP0, after which the BIOS monitor presents
the same preinterned guest string through the exception-root value register.
Internal TS/C++ unwind signals carry only the raw guest value or numeric reason;
they do not build parallel host error strings.

The compact 4x6 `tiny_3b_font_*` glyph set is the BIOS-owned
`font.get('default')` descriptor for boot and firmware text. The ROM producer
also packs those source glyphs into a 256-word terminal-font ROM resource. BIOS
code reads those packed words as physical system-texture coordinates and emits
ordinary GP0 textured rectangles; it does not inspect an atlas layout. Tiny is the only
standard font in the BIOS resource package. The MSX 6-pixel font is an
aesthetic cart/host asset, not a machine or BIOS primitive: carts that want that
style ship the glyph resources, reserve their own VRAM slot and define the font
explicitly. Firmware retains no compatibility alias, automatic MSX resource
inclusion, or missing-glyph fallback into the removed set.

## IDE, editor, and host tooling

IDE/editor/workspace code is host tooling. It may compile source, inspect debug
symbols, retain workspace operations, and patch ROM/workspace inputs at host
edges. It must not be imported by machine devices or become the cart-visible
source of truth. Runtime and tooling diagnostics use host logging and
IDE error owners; they are not BIOS monitor commands and must not be swallowed
by deferred host code.

TypeScript BLua32 source tooling is owned by `@bmsx/blua-toolchain` under
`toolchain/ts/lua`; ROM authoring is the downstream `@bmsx/rompack-tooling`
package under `toolchain/ts/rompack`. Neither is compiled by the emulator
package, and the BLua package has no dependency back to ROM authoring.
`@bmsx/machine` compiles only its public runtime entrypoint, machine, shared
low-level primitives, and hardware specification sources. Native ROM and fault
tooling remains in the separate
`bmsx_rom_tooling` and `bmsx_blua32_tooling` CMake targets. After an exception
reaches the libretro host boundary,
fault presentation decodes the tooling image directly from the inserted
physical ROMs, joins optional symbols with allocation-free scalar CPU state
reads, emits the diagnostic, and releases that tooling state.
`Runtime`, CPU state, and `libbmsx.a` retain no source paths, symbol caches,
disassembler objects, or formatted diagnostic records.

Lua source lexing, parsing, semantic analysis, and compilation are TypeScript
authoring-tool responsibilities under `toolchain/ts/lua`. Native machine code
executes the already-linked physical BLua32 image and therefore has no parallel
C++ source lexer, parser, AST, or runtime source-compilation path.

`RuntimeSourceState` owns one retained IDE resource identity per installed
`(domain, path)`. That identity points at the owning `RomAsset` or
`LuaSourceRecord`; tabs, navigation, search, workspace restore, and resource
panels consume the same object and read type, asset id, and generated state
directly from its source record. Source installation and activation publish the
retained Lua and active-domain catalogs. Listing and lookup code does not copy
resource metadata into descriptor DTOs. Workspace state persists only
`(domain, path)` and resolves it through `RuntimeSourceState`. Local workspace
files have one owner representation, `{ contents, updatedAt }`; autosave,
explicit source saves, cold-boot source arbitration, and the local transport
all consume that same record. Each dirty source record is stored under the
project root owned by its resource domain at an immutable path derived from its
record timestamp; the active workbench root owns only the session record. Every
session entry names that exact dirty-record generation, so the session record
is the commit marker: new dirty records are published without overwriting the
previous generation, then the session record is published, and records no
longer referenced by it are deleted afterwards.
Unreferenced files are unreachable orphans, not restore candidates. Remote
workspace replication uses the same order and preserves integer-millisecond
timestamps instead of restamping received content. Remote operations are
serialized per resource while unrelated source reads run concurrently.
Workbench composition awaits old-session shutdown and storage configuration,
loads every manifest-referenced dirty record once into the retained session,
arbitrates source records, then constructs and restores the editor before guest
boot. A newer remote manifest is published locally only after all of its dirty
records are present; only then are records belonging exclusively to the
replaced local generation removed. A dirty record rejected by source
arbitration is not hydrated and is removed by the next session commit. The
current session schema has no version field or migration path. Missing storage
is absence; malformed BMSX-owned records and session entries whose dirty
timestamp is absent fail without deletion or repair.

Workspace autosave is mutation-driven. Text, dirty cursor/scroll state,
breakpoints, explicit saves, and font changes advance a retained revision and
arm one debounce callback with exact change bits. A completely idle workspace
has no autosave timer, does not enumerate tabs, and allocates nothing. Content
changes rebuild the dirty-file generation; cursor and scroll changes retain the
affected context identities and replace only their session metadata. They reuse
the dirty-record map, unchanged background entries, and serialized breakpoint
state. A commit writes changed dirty content locally, then the session record,
then obsolete dirty records. Remote acknowledgement advances only after the
same record-before-session sequence succeeds; metadata-only replication skips
dirty-record indexing and transfer when the retained map is already remote.
Remote failure leaves the local commit authoritative, schedules reconnect, and
does not abort editor shutdown or workspace reconfiguration.

Instruction profiling is an opt-in Node tooling-host feature. The TypeScript
tool loads immutable BLua32 symbol media directly from the boot ROM layers and
drives the same scheduler-safe single-instruction boundary exposed by both
machine runtimes. After each executed scheduler quantum it reads only the CPU's
raw last-domain and last-PC latches; retained tooling arrays map those words to
predecoded opcodes, functions and source ranges. The normal TypeScript and C++
CPU loops contain no profiler state, observer interface, host callback or
per-instruction observer branch. Profiling does not initialize Studio or IDE
source state, and the native runtime needs no report-formatting consumer. The
step boundary retains the in-flight coarse scheduler budget between calls so
device events observe the same frame state as an uninterrupted run; that
transient executor latch is reset at boot and state-restore boundaries and is
not serialized.

## Host presentation and frontend lifecycle

`overlay_queue` is the retained publication boundary between host-UI producers
and render backends. Workbench and menu publish separate ordered lanes as
references to their existing command kinds, payload references and counts.
Backends consume only that pass state; they do not read a menu/workbench
controller or clone the commands into a per-frame DTO. WebGPU and WebGL2 own
their concrete pipelines, atlases, buffers and uploads behind that boundary.
The machine-visible PCRTC merge is not an `overlay_queue` lane. The
full-screen IDE owns and emits its own frame background; the quick menu
publishes only its own host commands over the retained game scanout.
WebGPU is the default accelerated browser backend and WebGL2 is its fallback;
host validation failures do not reverse that ownership or introduce a second
presentation facade.

The platform atlas producer is the sole owner of the host-UI atlas layout. It
emits the RGBA bytes and the image descriptors as native generated data for
both runtimes. The shared descriptor order is `width`, `height`, `pixels`,
`images`; every image record carries `id`, source dimensions and atlas bounds.
TypeScript retains one `Uint8Array`, while C++ exposes spans over static byte
and descriptor arrays. Image IDs are sorted by the producer and both runtimes
use binary lookup, so no runtime builds a second index. Backends upload or
sample that one pixel backing directly. Base64, runtime decoding, lazy pixel
caches and intermediate pixel copies are not part of this host-resource
boundary. This atlas remains a host presentation resource, not cart ROM, GX
local memory or an IMGDEC stream.

One libretro `retro_run()` advances exactly one machine-timed frame. Frontend
wall time is not fed back into the machine scheduler. A direct host may skip an
overdue host presentation while catching up, but it still advances machine and
audio state. The direct host deadline clock remains the pacing master with or
without physical audio output. Its fixed-capacity audio queue never blocks the
machine thread: when the sink falls behind, the queue discards its oldest
presentation frames and retains the newest audio. Push/pop/callback paths do
not allocate, and audio transport timing never changes machine cadence.

The direct Linux host keeps platform video resources in the concrete
`video_context` owner. That owner contains the fbdev mapping, SDL window,
renderer and texture, SDL GLES context, EGL context and surface, swap operation,
drawable extent and physical window-to-surface mapping. It initializes and
quits only the SDL video subsystem. Game-controller subsystem state remains with
input; audio owns the SDL audio subsystem independently.

The BMSX libretro core publishes software frames as XRGB8888; the direct host
accepts that one producer-owned format instead of carrying conversion branches
for formats its core never emits. `video_presenter` owns the hardware-context
callback, native game geometry, destination rectangle, accepted-presentation
ordinal, GLES final blit, frontend messages and screenshot capture.
It borrows one stable surface record from `video_context`; the context may grow
or replace that record's pixel storage but not the record itself. The presenter
therefore translates surface points through its retained destination rectangle
instead of making the platform context duplicate game-layout policy. Its
message surface, GL objects and capture buffer are retained owner state:
ordinary frames do not allocate, message geometry uploads only when it changes,
and repeated captures reuse capacity. SDL software storage changes only when
the machine geometry changes, and GLES drawable extent is refreshed on SDL
window events rather than polled during every presentation.

When layout selects an exact integer scale, `video_presenter` retains that
scale beside the destination rectangle. The `software_frame_blitter` consumes
it directly: each XRGB8888 source pixel is loaded once, converted once when the
physical surface is RGB565, and written to its complete integer pixel block.
It neither evaluates fixed-point source coordinates nor allocates during
steady-state frames. One retained expansion row is allocated when the presenter
opens or its physical surface grows, then reused for every integer-scaled row.
Non-integer presentation remains a separate nearest-neighbour kernel. Shared
XRGB8888/RGB565 word conversion lives in
`video_pixels`; neither presenter messages nor the frame blitter carries a
private duplicate.

The direct host's `input_devices` owner contains evdev descriptors and sampled
axes, the SDL game-controller subsystem and controller handle, physical
keyboard event routing and source lifecycle, mouse/pointer state, focus policy
and the input-originated quit latch. `keyboard_input` retains and aggregates the
per-source key bitsets. The physical owner's poll and state entrypoints are the
libretro callbacks directly; the run loop does not mirror their state. SDL
resize events call the concrete video-context and presenter owners in sequence,
while window-to-surface and surface-to-game coordinate transforms remain
separate ownership boundaries. Polling uses retained fixed-capacity state and
performs no allocation.

The direct host's `core_session` is the concrete loaded-core owner. It retains
the dynamic-library handle, complete libretro API table, system information,
core options, independent system/save-directory pointers, frame-time callback,
current frame periods and core-requested shutdown latch for exactly one core
lifetime. Libretro's contextless environment callback reaches that one active
session and routes video and keyboard commands directly to their existing
owners; it does not expose a generic host context or a wrapper API around
`retro_run()` and the other raw core entrypoints. The API version is accepted
only when it equals the frontend header version, and every mandatory symbol is
resolved before the core is initialized.

Content bytes for a core that does not require a full path live only across the
`retro_load_game()` call, as required by the default non-persistent libretro
content contract. `retro_get_system_av_info()` is queried only after that load
succeeds. A missing save directory remains absent rather than aliasing the
system directory. Software presentation starts in libretro's 0RGB1555 default
and retains allocation-free conversion for 0RGB1555, RGB565 and XRGB8888;
BMSX's explicit format negotiation therefore adds no per-frame allocation or
extra conversion to its existing hot paths. CLI parsing, POSIX signals,
multi-owner startup/shutdown ordering, pacing and measurement counters remain
stack/runloop state in `main.c`.

Libretro keyboard input enters through
`RETRO_ENVIRONMENT_SET_KEYBOARD_CALLBACK`. The direct host retains source bits
for each physical key source, so releasing one source cannot clear a still-held
equivalent source or generate a duplicate edge. Input resources close before
core teardown because releasing a physical source can still invoke the
core-owned keyboard callback. Focus-loss policy remains owned by the frontend;
the core does not invent a private keyboard ABI or synthetic clear event. One
accepted-presentation counter orders scripted input, captures and automatic
exit. Rejected/skipped host presentations do not advance that timeline, and
neither boot heuristics nor a second frame counter may shift it.

The frontend that creates a GLES context owns the current-framebuffer callback
and `get_proc_address` resolver and supplies both through the libretro hardware
context boundary. The GLES backend resolves context procedures there rather
than through process-global symbols. One libretro lifecycle value distinguishes
software operation, an accepted request awaiting the frontend callback, a
received reset awaiting deferred initialization, a ready context and a terminal
hardware fault. Acceptance of `SET_HW_RENDER` is not itself a context-reset
event and never starts GL initialization.

Every GLES texture, depth buffer and render target records the context
generation that created its GL name. Clean context destruction runs while the
context is still alive and deletes matching graph, pass, texture-manager,
default-texture and backend resources in owner order. A reset without a
preceding destroy means the old context is already dead under the libretro ABI.
The backend advances its generation first and the graph, pass and texture
owners then release only CPU-side state; no stale numeric GL name is deleted
against the replacement context. The core does not build replacement resources
or execute another machine frame after that transition.

Direct-host shutdown invokes the core `context_destroy` callback while the
frontend context is current, unloads and deinitializes the core, deletes the
presenter's remaining GL objects while that same context is still current, and
only then destroys the SDL/EGL context, surface and window. No process-wide
`SDL_Quit()` call is allowed to erase resources owned by the input or audio
subsystems.

Before clean destruction, the GPU commits accelerated VRAM to its retained raw
snapshot. GX pipeline teardown clears its accelerated command frontier and
batch state. The first GX execution after context reset uploads that snapshot
before replaying the current command stream, so a controlled destroy/recreate
preserves byte-exact guest VRAM without stale accelerated frontier state.
Presentation-history and the previous 480i field are host presentation caches,
not guest VRAM, and are rebuilt after the first completed scanout. These
lifecycle paths run only at context setup or loss; ordinary frame rendering
does not perform generation checks or allocate replacement state.

An unannounced loss cannot read back the dead context. The retained raw snapshot
may predate GPU-only writes whose replay commands were retired after
presentation, so silently uploading that snapshot would corrupt emulated
hardware state. BMSX therefore treats this external device loss as
non-resumable: it abandons the dead generation without GL calls, reports the
fault, requests frontend shutdown and advances no further machine frames. This
matches the production boundary used by DuckStation for device loss, while
controlled renderer recreation in DuckStation likewise performs a complete
VRAM readback before destroying the old backend. Transparent recovery would
instead require a GX-owned, fixed-capacity command journal plus occasional full
VRAM checkpoints before the journal fills. That is a separate machine-data
authority design with measurable runtime cost, not a host lifecycle fix; it is
not introduced without an explicit product requirement and a checkpoint budget.

## Validation policy

A machine-boundary slice is not done without proof appropriate to the touched
surface:

- TS build/typecheck for touched TS core;
- C++ build/tests for touched core;
- focused unit/integration tests that exercise RAM/MMIO/device state rather than
  only private helper calls;
- scoped code-quality scanner with zero issues for touched files;
- `npm run audit:core-parity` for mirrored runtime changes;
- `git diff --check`;
- headless run when cart-visible runtime behavior is touched.

Render-visible GX changes keep TS headless and C++ software/headless execution
green, run the same raw conformance vectors against both software owners, and
keep WebGL2/GLES2 command behavior synchronized. Live accelerated proof is a
separate gate: browser or frontend captures must exercise consecutive frames
through the real backend and cannot be replaced by software parity, a WSL
browser without a usable WebGL2/WebGPU context, sparse screenshots or a hidden
compositor window.

Performance attribution uses fixed, allocation-free owner probes and external
heap traces, not timing or stack anecdotes. Comparative runs keep the ROMs,
timeline, release build, renderer configuration and CPU affinity fixed and
rotate variants to separate scheduler, host and GX effects. Native-paced runs
may corroborate an owner but do not turn pacing noise into a causal result.
Heap reports attribute calls and requested bytes to the allocating owner rather
than every driver or runtime frame on its stack. New indexing, upload
coalescing, frame dropping or other complexity requires a representative
profile that identifies that exact owner first.

Subagent review is useful at the slice boundary, not for every tiny edit. Review
findings are blockers only when they identify ownership drift, stale docs,
performance regression, fake parity, hidden old-format paths, defensive clutter, or
hardware-contract violations.

## Documentation policy

Hardware documents must read like hardware contracts:

- register map and bit meanings;
- latches, buffers, FIFOs, registerfiles, datapaths;
- timing edges and service points;
- fault/status/IRQ behavior;
- save-state-visible state;
- TS/C++ owner files.

They must not be prompts, migration journals, marketing copy, or product-pitch
explanations. If a document cannot be made into a current hardware contract, it
should be deleted.

Only unresolved work belongs in `docs/open_architecture_slices.md`, including
work explicitly deferred or parked. Once a slice closes, its durable hardware,
runtime or validation contract is folded into this document and its status row
is removed; the open matrix is not a completion ledger. The broader
hardware-emulation goal lives in `docs/goal.md`. This architecture file remains
the stable machine contract.
