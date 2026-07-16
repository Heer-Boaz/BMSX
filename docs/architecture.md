# BMSX Architecture Contract

Last checked: 2026-07-16.

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
GTE+. The active phase finishes and preserves exact PSX register, opcode,
fixed-point, saturation, flag, timing, and pipeline behavior before any GTE+
contract is designed or exposed. GTE+ must extend that raw model explicitly;
it may not replace unfinished PSX behavior with host geometry, material,
morphing, or renderer objects.

The later BSX hardware may add native depth-buffered rendering, morphing, and
other geometry or raster capabilities. Their GPU-local-memory, register,
packet, and datapath contracts are intentionally deferred until the PSX GTE
foundation is accepted. The retired VDP/RPU ABI is not a design source or a
compatibility route for that work.

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
- ROM/program/header constants and memory-map addresses.

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
register. Lua library behavior belongs in BIOS Lua unless it is a true language
primitive of the remaining dynamic Lua object-world. Do not preserve manifest or
host-native library shortcuts by adding wrappers; migrate each observable value
to its owner and delete the shortcut.

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

Guest library tables are firmware-owned. The boot ROM installs `bios/base.lua`
as the core Lua global library, `bios/table.lua` as `table`, `bios/string.lua`
as `string`, `bios/math.lua` as `math`, and `bios/easing.lua` as the animation
easing library. Those modules execute as BLua using ordinary calls, ROM lookup
tables, and integer/number instructions. Machine TS/C++ firmware exposes only
temporary `__bmsx_*` boot primitives for the BIOS to capture; runtime boot clears
those primitive globals after system static-module initialization and before any
cart static module or reset vector runs. `require(...)` is not one of those
primitives and is not a guest runtime global: literal module imports are resolved
by the compiler into static module initialization and module export slot loads.
Machine TS/C++ firmware must not expose `math.*`, `easing.*`, `string.*`,
`table.*`, `require`, or core Lua globals as native host callbacks; host
`Math.*`/`std::*` remains valid only for emulator/device implementation and
build tooling.

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
Lua and is not precedent for cart-visible host facilities such as the removed
`math.*`, `easing.*`, and `os.*` callbacks.

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
Debugger pause, source activity, IDE overlays, hot-eval source text, and editor
diagnostics are host/IDE state; the machine scheduler and runtime frame loop do
not carry those flags as emulated state.

A BMSX host owns the embedding/process edge and physical host services. It may be
a browser bootstrap, a Node executable, a libretro core entrypoint, or a local
frontend executable. It never owns cart-observable machine semantics.

## Console model and timing

The active machine model is `psx`. The model owns fixed hardware facts:
50 MHz CPU clock, 4 MB RAM, a 6,553,600 word/s DMA datapath, a 16,384,000
work-unit/s geometry unit, and a PSX-style GPU with 1 MiB of raw VRAM. Machine
reset initializes that VRAM with the fixed GX power-on bit pattern. GPU reset
starts from a 320×240 PAL display configuration; that is a reset register state,
not a fixed host scanout size.

The cart ROM still carries a `psx` VDP-class marker in its package header. This
is a ROM format marker, not a live VDP device or graphics ABI. A second GPU/APU or
device-class contract starts only when a real producer consumes it; it is not an
open slice by itself. Guest Lua does not receive a `machine_manifest`,
`cart_manifest`, or raw hardware globals to discover these facts. The header and
machine registry are host/tooling input; cart-visible behavior is still
programmed through CPU-visible ROM, RAM, MMIO, BIOS Lua, and link symbols.

Display configuration is raw GPU register state. GP1(08h) horizontal-resolution
bits own native scanout width, GP1(07h) start/end own the active line count, and
GP1(05h) owns the VRAM scanout origin. GP1(06h) is retained horizontal timing
state; changing it does not manufacture a logical width or resize a target.
Software, WebGL2, WebGPU, and GLES2 scan out those native pixel coordinates
directly. Presentation resizes the retained canvas, framebuffer, and backend
targets only when the dimensions derived from the latched raw words change; it
does not scale an active range over a fixed 320×240 target. Physical 4:3 display
layout is separate host presentation policy and does not change the native
buffer.

GP1 display-mode bit 3 selects PAL (50 Hz, 313 total scanlines); a clear bit
selects NTSC (59.940060 Hz, 262 total scanlines). The GPU publishes display mode
and vertical range at VBlank; runtime timing consumes that publication before
scheduling the next frame, using the active line count for the VBlank boundary.
Cycle budget, audio mixer pacing, libretro AV publication, and current-format
save-state restore consume the same raw GPU state. There is no VDP mode register,
host-inferred region state, cart-name mode map, or asset-size proxy.

The GPU owns its interlaced field, displayed-field, and active-line parity
latches. Current-format save-state preserves those three raw latches so a
restored GPUSTAT read and the next interlaced draw continue the captured field.
VBlank phase and frame-cycle timing remain runtime-scheduler state and are
republished to the GPU during restore rather than duplicated in the device
record.

Frame deadlines advance from the preceding scheduled frame boundary, not from
the scheduler time at which an overdue deadline is serviced. A CPU instruction
is atomic and may cross that deadline, but such lateness must not accumulate
into scanout-phase drift or duplicate a host frame. One runtime tick completes
at the VBlank edge; the first tick after boot remains a real timeline tick and
is not consumed as host warm-up.

## Runtime container vocabulary

Ownership terms are architectural roles, not interchangeable directory labels:

- `machine` owns cart-observable semantics: CPU, memory, MMIO, firmware,
  scheduler, devices, ROM/program formats, and deterministic save-state.
- `host` owns the process, window/device/runtime environment, files, physical
  input, audio/video presentation, external ABI callbacks, and execution loop.
- `mode` is a behavior variant inside one host. A mode may choose pacing,
  capture, CLI, headless, or test-runner behavior; it is not a separate machine.

Current artifact roles:

- `dist/libbmsx.js` / `.debug.js`: importable JavaScript machine/runtime
  artifact. It exposes `MachineManager.boot(...)`; it does not own browser, Node, SDL, ALSA, EGL,
  or libretro host services.
- `dist/engine.js` / `.debug.js`: browser host/bootstrap artifact. It wires
  browser video, audio, input, and view-host construction around the machine
  runtime.
- `libbmsx.a` in its CMake build tree: C++ machine/runtime static library. Build
  trees never share this target-specific archive.
- `dist/libretro_bmsx.so` / `.dll` / `.dylib`: libretro core entrypoint around the C++ machine runtime.
- `bmsx_libretro_host`: local frontend executable that loads a libretro core and
  owns SDL, ALSA, EGL/fbdev, input devices, screenshots, and the process loop.
- `dist/host_headless.js` / `.debug.js` and `dist/host_cli.js` / `.debug.js`:
  Node host executables/modes that load the machine runtime artifact and own
  their process/runtime environment.

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
need lockstep parity, the public machine API still moves, ROM/program/save-state
wire formats still change, host entrypoints still move with machine internals, and
cross-language parity/golden cases need one CI slice.

Split repositories only after all of these are true:

- `bmsx-machine` / C++ machine libraries have a stable public API.
- Host entrypoints use only that public API, not internal imports/includes.
- ROM, program, and save-state formats are releasable with explicit versions.
- Parity audits and golden cases can run as a published conformance suite.
- External consumers exist that need independent versioning.

The package boundary is `machine`, `hosts`, `tools`, `carts`, and `tests`. Carts are software for the machine, not part of the machine package.
Current `carts/<name>` folders are cart collections with cart-local
resources. If cart source moves during a package split, it should move toward a
top-level `carts/` collection, not under `machine`.

The exception is firmware/source material that ships with the machine runtime:
BIOS, system-ROM helpers, and default boot/source assets belong under the
machine firmware owner. That is not a general cart collection.

## Mirrored core contract

The TypeScript core under `machine/ts/machine` and the C++ core under
`machine/cpp/machine` are mirrored implementations of the same machine.

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

## ROM and program image

ROM data is CPU-visible source material.

Owners:

- ROM package wire layout: `machine/ts/rompack/format.ts` and
  `machine/cpp/rompack/format.h/.cpp`.
- ROM TOC wire layout: `machine/ts/rompack/toc.ts` and
  `machine/cpp/rompack/toc.h/.cpp`.
- Layered ROM lookup: `machine/ts/rompack/source.ts` and
  `machine/cpp/rompack/source.h/.cpp`.
- Program image layout/loading/linking:
  `machine/ts/machine/program/*` and `machine/cpp/machine/program/*`.
- Build-time Lua source compilation and Lua source registries:
  `machine/ts/lua/compiler.ts`, `machine/ts/lua/compiler/*`, and
  `machine/ts/lua/source_registry.ts`.

The ROM package and program image use the current wire records only. There is no
old-format reader and no decode path for obsolete records.

Runtime package records describe ROM payloads; they do not own duplicate audio,
atlas, or binary payload bytes. The active machine keeps one CPU-visible ROM
backing per loaded layer. Native path-based libretro loads use read-only mapped
files for that backing; memory-buffer frontends provide data that the core owns
once for lifetime safety. Node headless consumes the `fs.readFile` buffer
directly. Guest code moves bytes from ROM to RAM/VRAM/APU through the machine;
the Lua engine must not cache asset payload copies behind the cart's back.

Compiled Lua/YAML is source/program material, not mutable machine state.
`__program__` is a linked object image. `__program_symbols__` is debug metadata
and never counts as RAM.

The emulator core consumes program images; it does not own source compilation.
TypeScript source builds, hot-eval compilation, and source registries live in the
Lua/tooling side and feed compiled program images into the same runtime boundary
that native uses. `machine/ts/machine/program/*` stays the executable image,
linker, loader, scratch, and closure-call machine boundary mirrored by C++.

Runtime link symbols belong to `__program__`, not `__program_symbols__`.
The program-image `link.symbols` record carries proto ids, global slot names,
system-global slot names, and export-proto mappings required to resolve
relocations and install CPU global slots. Stripping `__program_symbols__`
removes source ranges, local-slot names, and upvalue names only; it must not
change executable linking, boot, or restore behavior.

CPU decode state is derived runtime infrastructure. The CPU decodes executable
proto ranges into sparse pages and allocates table-load inline caches only for
actual table-load opcodes. It must not allocate decode/cache state for address
holes in the linked text layout or for every possible program-ROM word.

ROM asset symbols are a compile/link contract, not a runtime registry. The
rompack owner emits the generated const module `bmsx/assets`; the compiler
recognises that module as compile-time only and inlines exported constants at
each use site. The module never produces a runtime Lua table, module proto,
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
offset in the corresponding ROM payload. For
pack-time cart assets that do not yet have a TOC range, the address is computed
from `CART_ROM_BASE + CART_ROM_HEADER_SIZE` plus the same packed-byte order the
ROM writer uses, and the build verifies those generated addresses against the
final TOC ranges before accepting the ROM. Length values are byte counts.
`rominspector.ts
--asset-symbols` prints the generated symbol table so the ROM address ABI can be
checked without disassembling program code.

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

Program images are object images until linked. Symbolic relocs remain linker
metadata; `module`, `export_proto`, section-address, and const-value relocs must
not leak as placeholder runtime strings into executable const-pools or Lua
values. The program/linker owner resolves object images to executable program
state before CPU install.

Program images carry a vector table: reset, section-init, and IRQ. Cold boot
runs section-init, then static module initialization, then the reset vector.
Hot-resume installs the same linked image shape but does not re-run section-init
against live cart RAM.

BLua sections are machine storage, not runtime metadata. `.rodata` is immutable
CPU-readable PROGRAM_ROM storage; `.data` is RAM storage with a PROGRAM_ROM
load image; `.bss` is zeroed RAM storage. BLua declarations create typed storage
symbols and startup code copies `.data` and zeros `.bss` with ordinary CPU
memory operations. Runtime and rompacker do not parse sections to initialize
cart data on behalf of the game.
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
and function text-symbols without producing a runtime module table, module proto,
global slot, or runtime `require` call. Function text-symbols are call targets
only: const aliases may name them for direct calls, but they are not Lua runtime
values and cannot be stored in tables, assigned to dynamic locals, or returned as
gameplay objects. Static calls resolve through `export_proto` symbols; non-call
value reads of dynamic module exports use ordinary module-slot relocs so the
dynamic lane keeps Lua table/function semantics where gameplay deliberately
chooses that lane.
Every const module declares `module<const>` in its own BLua source. Generated
packer modules emit the same declaration at their producer. Packed builds and
debug source recompilation therefore consume one source-owned contract; the
rompacker, TOC and host do not maintain a second module-name or attribute list.

## Memory, CPU, and scheduler

- `Memory` owns RAM, ROM windows, IO slots, and MMIO callback dispatch.
- The CPU consumes instruction words and runtime values directly from the mapped
  machine representation.
- Reserved opcodes, malformed standalone `WIDE` prefix words, and branch skips
  past decoded text do not become host exceptions. The CPU latches a hard-halt
  state, stops accepting IRQs, and stays stopped until a new program/reset path
  starts it again.
- Typed memory opcodes consume the register/RK lane directly as machine data;
  producers own the numeric address/value representation before the CPU reaches
  RAM, ROM, VRAM, or MMIO byte/halfword/float datapaths.
- Numeric arithmetic, bitwise, shift, unary-minus, and bitwise-not opcodes
  consume the register/RK lane directly. The producer owns the numeric lane
  representation before CPU dispatch reaches those datapaths.
- Ordering compare opcodes consume interned-string lanes when both sides are
  strings; otherwise they consume the numeric register/RK lanes directly. The
  CPU dispatch path does not revalidate producer-owned operand kinds.
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
- Protected-call VM primitives are non-yieldable CPU primitives. If a protected
  callee stops before returning, `pcall`/`xpcall` do not synthesize Lua success
  or error results; the CPU preserves the callee's actual stop state, whether
  hard-halted by malformed instruction flow or parked by `HALT`.
- The frame scheduler owns CPU/device advancement and IRQ/VBlank timing. The
  host frame pump may request work; it does not own device state transitions.
- VBlank is a machine edge. Devices with VBlank behavior expose explicit edge
  methods and latch/commit their own state there.

The static cart ABI uses words, registers, addresses, sections, memory, and
symbols as the primary representation. Static storage crosses module boundaries
as section symbols and typed addresses; static function exports cross those
boundaries as proto/text symbols; typed memory and numeric opcodes consume the
register/RK lanes directly as machine data. `CPU.Value` remains the dynamic Lua
object-world representation, but hot/static machine-code ABI does not use it as
module-export transport.

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

Lua closures own their captured upvalue slots as VM closure storage. In C++,
captured-closure upvalue pointers are tail storage in the same GC allocation as
the closure object, not a separate `std::vector` allocation. Static/root
closures have no captured slots; the C++ CPU keeps them in CPU-owned indexed
storage with stable closure addresses instead of allocating them as GC heap
objects. TypeScript keeps the same boundary with `Closure` instances, dense
`Upvalue[]` closure slots, and a required `heapBytes` word on every closure, so
heap accounting consumes the producer-owned closure representation directly.
Save-state serializes closure upvalue references as object ids at the
persistence boundary; it does not expose either runtime's closure slot storage
shape.
Snapshot object ids are reserved before an object's child values are captured,
so cyclic/shared Lua table graphs stay object graphs rather than path lookups or
duplicated tree materialisation.
Object-key hashing follows the value representation. Runtime objects receive a
producer-owned identity word when the table, closure, upvalue, native function,
or native object is created; save-state restores that identity for CPU-owned
objects. Table lookup and snapshot traversal do not keep separate side tables.
Table save-state stores the table hash columns and free cursor because Lua
iteration observes the current bucket walk. Restore rehydrates the owner-owned
columns directly so `next` resumes the same table order after state replay.

Core VM builtins (`next`, `type`, `rawget`, `pcall`, string byte/char, and the
other BIOS-captured primitives) are fixed VM primitive slots/singletons. They
are not native host callbacks, are not GC heap allocations, and do not
contribute to Lua heap accounting; guest-visible names are ordinary globals
pointing at those fixed VM primitive values. Save-state serializes their
`BuiltinFunctionId`, not a global/module path. Host-native bridge values are
runtime infrastructure, not CPU state: they are neither path-stabilized nor
restored by save-state.
Native/builtin argument transport is a borrowed VM register/result view. C++
`NativeArgsView` exposes direct indexed access over the caller-owned value span;
it does not carry a checked `at()`/exception path in builtin dispatch.
TypeScript uses a pooled borrowed view with `get(index)`, not a `Proxy`-backed
array facade. Both views expose Lua's nil-filled argument lane for reads beyond
the supplied argument count without materializing an argument array per call.

Executable program text is part of the memory-mapped program ROM image. The
runtime program text view points at the text window in that ROM buffer, so
runtime relocations patch the executable text that the CPU decodes and the bytes
that the bus exposes at the program-ROM address range. Host-eval append code is
the explicit exception: it extends the CPU-visible bytecode stream while
preserving the already-installed program-ROM mapping for guest memory reads.
Executable const-pool relocation is an inflate-time value rewrite; it must not
clone the full object sections just to replace the const-pool image.
Release program installs retain one CPU-visible program-ROM backing for text,
rodata, and data load image bytes. The executable code view aliases that backing
instead of owning a second byte buffer; debug/source metadata is a debug-symbol
asset, not release runtime residency. Runtime const-pool values, protos, module
export records, and the CPU decode cache are their own owner data structures and
must not keep duplicate rodata/debug payload copies.
Program-ROM size/fit is owned by the linker/producer. `Memory` maps the retained
program-ROM backing into the fixed CPU window and the window itself determines
which bytes are observable; the memory device does not revalidate producer size
or throw during install.

System ROM and cart ROM are fixed CPU-visible address windows. The backing
payload may be shorter than the window or absent; bytes beyond the backing read
as zero through the bus. The memory owner exposes immutable ROM residency by
binding caller-owned retained byte views for ranges that are fully backed by the
system/cart ROM payload. It must not allocate or return fresh view/span objects
on device load paths, and an empty or zero-filled window tail is not immutable
backing.

## Save-state contract

Save-state captures deterministic machine state, not host conveniences.

Saved:

- CPU registers, stack/frame/root runtime values, string pool ownership, RAM/IO
  state, scheduler/VBlank state, device registerfiles/latches/FIFOs/buffers, and
  device-visible memory.
- GX GPU raw register words, GP0 packet assembly, retained command-buffer state,
  raw 1 MiB VRAM, transfer/readback latches, and display timing state that
  determines future output.
- APU command/source/output state that determines future audio output,
  including the command FIFO ring, queued parameter latch words, active AOUT
  voice position, gain-ramp, filter history, and BADP decoder state.
- GEO command/result/fault state and device-visible scratch/result memory.
- ICU registerfile, sample latch, committed action records, and sampled action
  status/value words.

Not saved:

- host windows, WebGL/SDL handles, browser objects, editor state, build caches,
  parser caches, derived lookup tables, scratch arrays that are fully rebuilt
  from saved device state, host-native bridge callbacks/objects, and output
  queues that belong only to a host backend.

Save-state bytes start with the current property-table payload. There is no
format-version field, old reader, or migration path. Aggregate machine
save-state records live in
`machine/save_state` on both runtimes. IRQ and ICU save-state contracts live in
dedicated `machine/devices/irq/save_state` and
`machine/devices/input/save_state` files on both runtimes; C++ keeps those
capture/restore bodies in the matching save-state translation units.

TS and C++ codecs share a fixed 16 MiB wire capacity and reject an oversized
current-format payload on encode or decode. Libretro exposes one fixed header
plus that capacity, captures and encodes once, writes directly into the frontend
buffer and clears its unused suffix; it does not retain another 16 MiB envelope.
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
| `BUS_FAULT_CODE` | `0x0801020c` | Sticky fault code for the first visible bus fault. |
| `BUS_FAULT_ADDR` | `0x08010210` | Address captured with the sticky bus fault. |
| `BUS_FAULT_ACCESS` | `0x08010214` | Access flags captured with the sticky bus fault. |
| `BUS_FAULT_ACK` | `0x08010218` | Write nonzero to clear the sticky bus fault. |

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

### Host fault publication

The host fault registers publish host startup fault state into the machine
without making the host own cart-observable behavior. The host writes only the
fault flags and stage MMIO words; it does not publish a Lua message global.
Register addresses, flag values, and stage values are machine ABI values. Firmware
names the words it owns locally or consumes them through owner-owned
BIOS/system helpers; the emulator does not inject them as Lua globals.

Host fault registers:

| Register | Address | Meaning |
| --- | ---: | --- |
| `HOST_FAULT_FLAGS` | `0x08000000` | Sticky host fault flags published by the host runtime during startup. |
| `HOST_FAULT_STAGE` | `0x08000004` | Host startup fault stage code. |

Host fault flag values:

| Name | Value | Meaning |
| --- | ---: | --- |
| `HOST_FAULT_FLAG_ACTIVE` | `0x0001` | A host fault is currently published. |
| `HOST_FAULT_FLAG_STARTUP_BLOCKING` | `0x0002` | The published fault blocks startup. |

Host fault stage values:

| Name | Value | Meaning |
| --- | ---: | --- |
| `HOST_FAULT_STAGE_NONE` | `0` | No host fault stage is active. |
| `HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH` | `1` | Deferred startup audio-refresh failure. |

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

Program images carry `irqProtoIndex` and `exceptionProtoIndex` vectors. On a
guest-domain `HALT` or guest instruction boundary, an asserted unmasked
maskable IRQ line makes the CPU push the selected generated IRQ root above the
interrupted frame. That root calls the program's `irq(flags)` handler and ends
in `RFE`; an ordinary Lua return only returns to the root. Host/debugger closure
calls may wake from a pending IRQ, but they do not consume or vector it. The NMI
line and system exception vector exist at the CPU boundary; the ICU asserts the
manual system line from the rising edge of its dedicated supervisor-request
input at VBlank.

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

The compiler-generated IRQ vector reads `IRQ_FLAGS` and calls the program's
`irq(flags)` handler when bits are pending. System-ROM compilation binds the
BIOS `irq` and `exception` handlers through `SETSYS`/`GETSYS`; cart compilation
binds the same source names through ordinary `SETGL`/`GETGL`. The compile domain
is explicit at every BIOS, cart, hot-resume and host-eval producer. Existing
linked metadata cannot grant a cart access to a system slot.

The CPU stores system and ordinary global slots in distinct registerfiles.
Ordinary slots synchronize with the Lua globals table; system slots do not.
Program replacement preserves system slots by interned name, and save-state
serializes both registerfiles independently. This permits BIOS and cart code to
use the natural handler names without renaming, a dispatcher facade, or the
cart overwriting a supervisor vector after linking.

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
| `IRQ_FLAGS` | `0x08000008` | Read pending IRQ bits. |
| `IRQ_ACK` | `0x0800000c` | Write bits to clear. |
| `IRQ_MASK` | `0x08000010` | Read/write per-source vector mask; bit set means that pending source may vector. Reset `0`. |

| Name | Value | Meaning |
| --- | ---: | --- |
| `IRQ_DMA_DONE` | `0x0001` | DMA completion. |
| `IRQ_RESERVED_1` | `0x0002` | Reserved; later IRQ bits retain their ABI positions. |
| `IRQ_VBLANK` | `0x0004` | VBLANK entry. |
| `IRQ_GEO_DONE` | `0x0008` | Geometry command completion. |
| `IRQ_GEO_ERROR` | `0x0010` | Geometry command error. |
| `IRQ_APU` | `0x0020` | APU voice event. |
| `IRQ_GPU` | `0x0040` | Rising edge of the GX-GPU GP0 interrupt-request source. |

### Supervisor exceptions and BIOS terminal

The CPU supervisor exception path and BIOS terminal are machine-owned. The
terminal is system-ROM firmware, not a host overlay. This first hardware version
deliberately uses a compact R3000-style exception model without an MMU, MPU,
protected heap, or supervisor-only RAM.

The CPU owns a compact coprocessor-0 registerfile. Guest code addresses the
registers with CPU instructions rather than MMIO or host builtins:

| Register | CP0 index | Meaning |
| --- | ---: | --- |
| `BAD_ADDRESS` | 8 | Faulting guest address; asynchronous entry leaves the previous latch value unchanged. |
| `STATUS` | 12 | Raw privilege/interrupt stack described below. |
| `CAUSE` | 13 | Raw exception code and asserted CPU-line bits. |
| `EPC` | 14 | Guest byte-PC at which exception return resumes. |

`MFC0` reads all four words. Supervisor code may write `STATUS` and `EPC` with
`MTC0`; `CAUSE` and `BAD_ADDRESS` are CPU-written latches. A user-mode CP0
access is a defined privileged-instruction guest fault. It is never a native
callback, seeded Lua global, or parallel firmware shadow.

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
zero plus `CAUSE.IRQ=bit 10`; manual system entry writes exception code zero
plus `CAUSE.NMI=bit 16`. The device-source bits remain in `IRQ_FLAGS`. A manual
NMI edge is accepted only from user mode; supervisor execution inhibits and
drops further manual edges, so opening the monitor or handling a cart IRQ cannot
recursively open another monitor. The first synchronous cause is deliberately
narrow:

| Cause | `CAUSE.ExcCode` | `EPC` | `BAD_ADDRESS` | Resume rule |
| --- | ---: | --- | --- | --- |
| User execution of `MFC0`, `MTC0`, or `RFE` | 11 (`CAUSE[6:2] = 11`) | Faulting instruction | Unchanged | The handler must replace `EPC` with another instruction address before `RFE`; unchanged `EPC` retries the fault. |

No other host/runtime failure is converted into this cause. Address faults and
supervisor double-fault behavior require their own explicit table rows before
implementation.

Exception entry pushes a generated exception-root closure above the stopped
frames. That root calls the program-owned handler and ends in `RFE`; a normal
Lua `return` only returns from the handler to the root. `RFE` is legal only in a
CPU-marked exception root and uses `EPC` as the authoritative resume PC. Entry
does not serialize, copy, unwind, or reconstruct the cart call stack. Only
faults defined by the machine contract enter this path. Emulator invariant
failures remain host failures.

System and cart program vectors remain distinct after linking. A maskable IRQ
selects its vector from the pre-entry `KUc`: user execution uses the cart IRQ
vector, supervisor execution uses the BIOS IRQ vector. NMI and synchronous
faults always use the BIOS exception vector. Pending device bits are neither
acknowledged nor reassigned by CPU entry; while the monitor runs, BIOS owns an
explicit IRQ-mask/context switch and system handlers acknowledge only their
sources. Machine schedulers and devices continue advancing normally. The
existing NMI request latch is not a terminal implementation by itself: the CPU
consumes it into the system vector and preserves the latch, raw CP0 words, and
exception-frame state in the mirrored TS/C++ save-state contract. The ICU
samples only the dedicated supervisor-request line and requests that NMI; the
BIOS exception handler owns monitor entry.
Privilege gates system vectors, CP0 writes, exception return, and other
explicitly privileged CPU/system-control operations; it does not make ordinary
RAM inaccessible to carts.

The BIOS monitor code lives in system program ROM. Its line buffer, fixed-size
output/history rings, and other mutable state use reserved ordinary `.bss`/RAM.
A cart can therefore corrupt that workspace, and a heap-corruption or
out-of-memory fault need not leave a working monitor. That is an explicit
property of the first hardware model, not a condition for host-side repair or
a hidden fallback VM.

Platform input owners drive one dedicated supervisor-request line rather than
injecting a synthetic keyboard event into the ICU. Browser, headless and native
libretro keyboard paths map physical `F2` to that line while still publishing
the ordinary F2 HID bit. Libretro also maps the port-0 Down+Select chord; its
physical buttons remain configurable through the frontend controller mapping.
That chord is distinct from the host-owned Start+Select+L+R quick-menu action.
All physical request sources are ORed before a line transition is published.
While the BIOS monitor owns the CPU, it reads the raw ICU USB-HID bitmap,
performs its own modifier, repeat, and character mapping, and waits on the BIOS
IRQ/VBlank path. The cart receives no input because its frames are not
executing. The host continues to sample the physical devices into ICU words;
it does not edit a terminal buffer or dispatch commands.

The BIOS terminal uses the ordinary GX GPU and the ordinary primary scanout.
GX VRAM remains one 1024x512 A1RGB555 word array: 524,288 words, exactly 1 MiB.
There is no second display circuit, terminal VRAM bank, character-plane SRAM,
terminal write port, host framebuffer or terminal-owned backend texture. Boot
and monitor firmware program the native 256x192 display mode. Firmware uploads
the packed system texture through the standard GP0 CPU-to-VRAM packet, then
draws the terminal with ordinary fill, VRAM-copy and textured-rectangle GP0
commands. Software, WebGL2, WebGPU and GLES2 therefore execute the same command
stream used by carts.

The packed system texture remains at x=512..767, y=0..63 and cart manifests
reserve that actual 256x64 rectangle. The terminal has no permanent texture or
VRAM reservation: while active, its 256x192 framebuffer is the primary scanout
at x=0, y=0. Entering the monitor deliberately replaces the cart image rather
than retaining or reconstructing it.

The BIOS keeps a fixed 128-line cell scrollback, dirty ranges, line editor,
history and GP0 command list in ordinary `.bss`. A packed ROM table maps each
4x6 tiny-font codepoint to its physical system-texture coordinates. The initial
frame is a full clear followed by textured glyph rectangles; later edits clear
and redraw only dirty cell spans, and ordinary VRAM-to-VRAM copy scrolls the
visible framebuffer. DMA consumes the retained command words before firmware
may rebuild them, and the final GP0 IRQ fences GPU completion. No render-time
Lua tables, strings or pixel buffers are allocated.

The firmware line editor supports insertion, deletion, cursor motion, a fixed
history ring and command-name completion. Long producers feed one fixed row at
a time into an automatic pager; page/line advance and scrollback never retain a
second copy of command output. Command metadata is one typed `.rodata` array of
records, so names, usage and descriptions have no parallel blob, offset or
length tables.

Monitor entry is a one-way supervisor takeover. Firmware masks cart IRQs,
terminates a live DMA channel through its live count/control registers,
acknowledges pending cart IRQ sources, resets the GP0 parser, and programs the
terminal display. It does not capture or restore GPU, DMA, VRAM or cart call
state. Only machine reset leaves the monitor; transparent display above a
frozen cart frame and resumable monitor entry remain a separate parked hardware
problem rather than a host workaround.

The machine-visible monitor command set starts with hardware operations such as
`HELP`, `FAULT`, `REGS`, `MEM`, `CLS`, and `REBOOT`. It does not expose the workspace,
host filesystem, JavaScript stack, real-time compiler options, host process
shutdown, IDE symbol browser, or other current workbench services. Its layout
and colors are firmware policy and intentionally do not emulate the removed
host terminal's appearance.

### DMA

DMA is one register channel. `READ_ADDR`, `WRITE_ADDR`, `TRANSFER_COUNT` and
`CONTROL` remain live while `STATUS.BUSY` is set; `TRIGGER` is a write-only,
self-clearing start strobe. The count is expressed in 32-bit bus transfers.
Control selects read/write address incrementing and one request input: forced,
GX write, GX read or disabled. GX requests are GPU-owned lines gated by the GP1
DMA-direction register.

The scheduler grants at most sixteen word slots per DMA service deadline and
the channel resamples DREQ before every word. A low request discards unused
slots and a later edge begins a fresh timing interval. Every word is a mapped
bus read followed by a mapped bus write and then live address/count writeback.
Memory remains the sole bus-fault owner; a fault does not invent a DMA error
state or abort the channel. Completion clears `BUSY`, sets `DONE` and raises
`IRQ_DMA_DONE`. The ROM texture producer emits native RGB555/STP GP0 streams;
there is no runtime IMGDEC, mapped RGBA staging aperture, descriptor queue or
image-copy DMA channel.

GX-read DREQ is the readback port's ready-to-send line, not a polled GPUSTAT
copy. Backend completion raises that line and schedules a waiting channel at the
current machine cycle; consuming the final available GPUREAD word lowers it.
A longer transfer therefore remains `BUSY` when the GPU has no word available
and resumes on a later readback completion without a timer, copied readiness
latch, or software retry loop.

### GX GPU/GTE

Cartlib submits painter-ordered 2D work through one retained visual-component
list per world space. Sprite, tile, text and custom visual components share the
same effective depth `parent.z + offset.z + draw_offset.z`; lower depths submit
first and higher depths submit last. Activation sequence is the stable equal-z
tie-break. Add/remove updates that same list and its indices, while one in-place
BIOS sort accounts for runtime depth changes before the visual system draws the
components polymorphically. There are no kind-priority stages, subsystem draw
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
between GX command buffers and those backends. The mirrored VDP/RPU and IMGDEC
device trees, mapped apertures, scheduler services, VBlank hooks, MMIO words,
readback state and save-state fields are removed. The ROM package marker is the
only remaining `vdp_class` name and must not be used as a compatibility route.

The GP0 command processor has one fixed sixteen-word FIFO and one integer
execution clock running at two GPU ticks per CPU cycle. Packet decode admits a
command to the retained execution stream; the scheduler completes it at its
absolute device deadline. GPUSTAT receive-ready, idle, DMA request and the
published execution frontier derive from that same state. A CPU GP0 store that
reaches a full FIFO remains the pending CPU instruction and resumes at the next
device edge that makes its exact MMIO address writable; neither CPU nor host
polls, retries, drops, or queues a replacement word. Save-state preserves FIFO,
packet assembly, execution frontier, and the active deadline relative to
scheduler time.

GP0(1Fh) asserts the GPUSTAT interrupt-request source and raises `IRQ_GPU` only
on its low-to-high transition. `IRQ_ACK` clears the IRQ controller's pending
edge without changing GPUSTAT, so another GP0(1Fh) cannot retrigger while the
GPU source remains asserted. GP1(02h) deasserts the GPU source but does not
clear an already-pending `IRQ_GPU`; cart code acknowledges that pending bit
through `IRQ_ACK`. This keeps the GPU source latch and the system interrupt
pending latch as two distinct hardware words.

Machine/device reset and GP1(00h) are distinct GPU transitions. A machine reset
regenerates the deterministic raw-VRAM power-on contents, advances the shared
unsigned 64-bit snapshot revision, and clears the retained command stream. GP1(00h)
resets GPU registers and applies the same packet/FIFO transition as GP1(01h).
Already accepted backend commands and received image payload remain in the
retained execution log, while an incomplete packet/polyline and an active
readback suffix are discarded. GP1(00h) preserves both the GPUREAD data latch
and the 1 MiB VRAM contents; machine reset clears the latch to zero. Every render
backend consumes the same raw snapshot revision; the command buffer has no
second VRAM-clear signal or backend-specific reset route.

GP1(01h) clears in-progress GP0 packet/FIFO state and aborts an active
VRAM-to-CPU transfer. Commands before a still-pending C0 fence remain in their
stable retained prefix; the C0 marker and its queued suffix are discarded.
Abandoned image headers and partial polylines truncate their uncommitted word
suffix; already received image payload remains one partial upload command.
Submitted or ready readback state is invalidated by generation, lowers the DMA
ready line, and cannot be completed by a stale backend callback. The GPUREAD
data latch and raw VRAM remain unchanged.

GP0(C0h) is an execution-stream fence. Commands through that marker execute
before the backend reads raw VRAM; later commands remain unpublished until the
entire transfer has been consumed. `GxGpuReadbackPort` owns the request latches,
fence, completion phase, fixed 512K-pixel exchange storage, and read cursor.
Software backends copy directly from their raw-VRAM owner. Accelerated backends
pack the logically wrapped 16-bit pixels on the GPU and perform one API
readback into that retained exchange storage; they do not maintain a CPU VRAM
shadow or run a per-pixel pack loop. GPUREAD emits the low pixel first, pads an
odd final high halfword with zero, and leaves the final data latch unchanged
after completion.

#### Raster and store datapath

GX rasterization uses raw PSX-style integer coordinates and state through the
store boundary. Triangles use top-left edge ownership and half-open bounds;
polygon coordinates wrap at the raster bucket after primitive-size rejection.
Textured and Gouraud polygons use the shared signed fixed-gradient plane with
twelve fractional bits, half-texel seed, and twenty-bit UV accumulator wrap.
Lines use the integer DDA and wrap each emitted sample to signed eleven-bit
coordinates. Endpoints exchange only when the first X exceeds the second; a
vertical line therefore retains GP0 packet order, matching MAME's
[`GouraudLine`](https://github.com/mamedev/mame/blob/389e99d4cea2a7a62e0cce227000c4c7d0efdd6b/src/devices/video/psx.cpp#L2149-L2262)
ordering rather than reversing equal-X colors before fixed-point interpolation.
Drawing offset, inclusive drawing area, texture window/page,
packed palette texels, CLUT addressing, STP, mask bits, four five-bit blend
modes, dithering and RGB555 storage remain raw datapath stages rather than host
float/color corrections.

GX selects the type-2/208-pin drawing-area contract: GP0(E3h/E4h) retains and
compares all ten Y bits. Installed VRAM remains exactly 1024x512 words; only the
physical VRAM row address aliases with `y & 511` after raster clipping. Thus an
upper-band sample at logical row 520 can store in physical row 8, while row 8
itself is rejected when E3/E4 selects only the upper band. Accelerated backends
project each non-empty clipped primitive range through one physical band in the
normal case and at most two at row 512. Their vertex stage removes the band
origin, their fragment stage restores logical Y for line DDA, fixed attribute
planes, dither and interlace, and destination VRAM access remains physical.
Dependency overlap, sample synchronization and dirty coverage compare the same
physical aliases. A drawing area spanning both bands keeps GP0 command order by
ending primitive batches at command boundaries. Within a command, generated
triangles remain the outer submission order and each triangle visits its lower
then upper logical band; dependent submissions synchronize the VRAM sample
shadow between draws so blend, mask and texture feedback observe prior physical
writes. Line and polyline segments keep their own order as well. Fill and
image-transfer commands retain their separate physical VRAM datapaths.

TS and C++ software renderers are the executable oracle for this contract, not
a fallback inside accelerated backends. WebGL2, WebGPU and GLES2 consume the
same command and raw-state representation and must run the same conformance
vectors. Backend-specific vertex/shader representations may implement the
datapath, but may not change coverage, intermediate precision, command order or
VRAM-visible stores. New BSX GPU/GTE+ extensions remain separate from this base
command set and are added only after the affected PSX-style behavior is fixed.

#### Texture production and VRAM residency

The ROM producer encodes images as native direct16 or palette payloads plus
integer texture-local coordinates, mode and optional CLUT offset. A filename
`@atlas=N` suffix is only a producer packing-group directive: its numeric value
is not serialized into the image ABI and is not visible to BIOS, cartlib, GPU or
DMA. Images packed together share one ROM texture span; runtime code consumes
that span and its raw metadata directly rather than reconstructing normalized
coordinates or looking up an atlas object.

Each cart declares physical VRAM destinations, reserved regions and simultaneous
working sets in `gx_texture_layout`. The producer validates the complete layout
and emits only each packed texture/CLUT slot's physical destination words. The
cart decides when a raw texture payload is transferred and which region it
replaces. Firmware only emits the GP0 transfer packet and DMA moves its ROM
words. Ordinary sprite/tile images stay within one hardware texture page; the
central rectangle primitive alone splits a surface that was authored to span
pages. There is no runtime semantic slot manager, atlas cache, scene-aware
firmware policy, runtime image decoder or mapped RGBA staging aperture.

#### Accelerated backend execution

The accelerated raw-VRAM texture is authoritative. CPU uploads, GPU draws,
fills and VRAM copies enter one ordered backend command stream. A retained dirty
coverage record tells a sample texture which raw-VRAM region must be copied
before a source or destination read. A backend may use an attached-texture
barrier only when the live context exposes the required procedure and the
source/destination coverage satisfies that API's ordering rules; otherwise the
concrete dependency-copy path remains the owner. Capability choice never leaks
into cart or firmware code.

Compatible solid, line and textured commands append to backend-owned retained
arenas until render state, capacity or a real VRAM dependency forces submission.
Mixed command order is retained and read-modify-write triangles remain ordered.
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

Pixel parity is a machine contract at GX VRAM scanout. For the same ROM,
timeline, model profile, and GX display registers, the TypeScript headless
renderer and C++ libretro/software renderer must emit byte-identical RGBA
screenshots before host presentation effects. Nonblank screenshots or
boot-screen parity are not render-parity evidence. `npm run test:render-parity`
captures the same timeline through both runtimes and compares dimensions and raw
RGBA bytes.

CRT postprocessing and RGB565/MSX10 output quantization are host presentation,
not runtime or machine state. Parity captures disable these effects, including
`bmsx_crt_noise`, so they prove machine pixel output rather than host decoration.

### APU and AOUT

APU is an audio device, not a sound service.

Cart-visible ingress:

- APU register writes;
- command FIFO words;
- parameter registers;
- source/sample memory;
- status/fault/IRQ words.

Internal units:

- APU registerfile/status/fault latch;
- command doorbell ingress, command FIFO, and parameter latch bank;
- service clock: CPU-cycle sample accrual, carry latch, pending-sample latch, and APU scheduler edge;
- active-slot datapath: active-mask register image, slot phase transitions, source-byte teardown, selected-slot refresh, and slot-ended event emission;
- slot bank: slot phases, per-slot register words, playback cursors, fade counters, and voice ids;
- source bytes DMA bank and metadata validator;
- playback parameter decoder;
- mixer/filter datapath and retained mix buffer;
- AOUT active voice records;
- PCM source data validator;
- BADP block decoder and seek-table datapath;
- AOUT fixed-capacity output ring, retained render buffer, and host-audio pull
  edge.

Save-state captures active AOUT voice datapath state. It does not capture the
already-rendered AOUT output ring; queued frames at the host edge are not
machine state and are rebuilt from the restored voice datapath. The audio
save-state data contract lives in dedicated `machine/devices/audio/save_state`
files on both runtimes. The shared device-status latch owns fault/status/code/detail register images and
fault-ack writes through mirrored `machine/devices/device_status` files. The
command latch default register image is owned by
mirrored `machine/devices/audio/command_latch` files. The command-doorbell
ingress path is owned by mirrored `machine/devices/audio/command_ingress` files;
it admits command words into the FIFO, clears the command latch, raises command
faults, and wakes the service clock. Command FIFO drain, PLAY/STOP/GAIN command
execution, the selected-slot register window, source-DMA replacement, and AOUT
voice replay are owned by mirrored `machine/devices/audio/command_executor`
files. The APU event latch
(sequence, kind, slot, source address, and IRQ edge) is owned by mirrored
`machine/devices/audio/event_latch` files. The command FIFO ring,
read/write pointers, queued count, and per-entry parameter words are owned by
mirrored `machine/devices/audio/command_fifo` files and are saved through that
owner. Queue-depth status registers for command FIFO and AOUT output ring state
are owned by mirrored `machine/devices/audio/queue_status_registers` files. The APU service clock owns CPU-cycle sample accrual, carry and
pending-sample latches, and the scheduler service edge in mirrored
`machine/devices/audio/service_clock` files; aggregate save-state stores only
those latch words.
The selected-slot source/status latch is owned by mirrored
`machine/devices/audio/selected_slot_latch` files. Slot selector words are raw
APU register words; the command executor and selected-slot latch decode the low
slot-index bits at the datapath boundary and preserve the raw selector word in
the slot register image. The active-slot datapath is owned by mirrored
`machine/devices/audio/active_slots` files; it writes the CPU-visible
active-mask register image, clears source-DMA slot bytes when a slot stops,
refreshes the selected-slot latch, and emits slot-ended events from the advance
edge. The composite APU status register read datapath is owned by
mirrored `machine/devices/audio/status_register` files. The APU slot bank owns
slot phase/register/cursor/fade/voice-id words in mirrored
`machine/devices/audio/slot_bank` files; aggregate save-state records
read and restore those live words through that owner.
The AOUT playback/filter parameter decoder is owned by mirrored `machine/devices/audio/playback` files. The APU source register decoder, source DMA latch, and source metadata validator are owned by mirrored `machine/devices/audio/source` files. The PCM source data validator is owned by mirrored `machine/devices/audio/pcm_decoder` files; scalar PCM sample decode lives in mirrored `pcm_decoder_hot_path` files so AOUT keeps the same retained-buffer hot path without owning sample-format decoding. The BADP decoder and seek-table datapath are owned by mirrored
`machine/devices/audio/badp_decoder` files; active decoder latches stay in the
voice record and are captured through the audio save-state contract. C++ keeps
its per-sample BADP decode loop in a C++-only `badp_decoder_hot_path` internal
header included only by `output.cpp`, so the hot path remains same-TU inline
without exposing those helpers through the public audio headers; TS mirrors that
split in `badp_decoder_hot_path.ts`. The host-edge AOUT output ring
is owned by mirrored
`machine/devices/audio/output_ring` files; the mixer fills that ring from live
voice state, and save-state deliberately excludes the already-rendered ring
frames.
C++ keeps aggregate capture/restore method bodies in the audio save-state
translation unit. TS keeps aggregate controller methods at the private-field
device boundary while command-FIFO state transfer stays on the FIFO hardware
owner, including the FIFO save-state record shape. BADP fixture proof covers
saved decoder latches and selected-slot start-sample mutation while a
decoder-backed voice is active.

APU source DMA slots store either a retained immutable ROM byte view or
device-owned source bytes. ROM-backed sources bind directly to the system/cart
ROM backing through the memory owner and do not copy sample payload into the
slot. RAM-backed and zero-filled/tail sources are copied into exact-size
device-owned bytes so later RAM writes cannot mutate active voices and stale
sample capacity is not retained. Save-state serializes the active source bytes
deterministically and restore rebuilds exact-size owned slot bytes.

Hot paths must use retained buffers and fixed-size state. No per-sample,
per-render, or per-pull allocation is acceptable.

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
the retained supervisor-request line once per VBlank and requests NMI only on
its rising edge; it never decodes HID usages or controller buttons. The ICU does
not own action maps, action-expression
parsing, button-name string ids, consume state, repeat windows, guarded presses,
or a high-level event FIFO.

ICU device code consumes only `machine/devices/input/contracts` source ports.
The host input layer implements those ports and remains outside the device.
Platform input adapters publish the supervisor-request line as a separate
retained input signal without turning it into a guest key. The browser runtime
keeps its richer IDE, shortcut, onscreen-gamepad, device-assignment, and
buffered PlayerInput state under `machine/ts/input`. Native frontends normalize
their external input ABI once into BMSX-owned numeric source/device/control
records; `machine/cpp/input` retains fixed keyboard, pad, and pointer state, and
the native quick menu owns its own fixed edge/repeat records. Those host
implementations are intentionally target-specific. Only the raw ICU snapshot,
supervisor line, and runtime input source contracts are mirrored machine
semantics.

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

`machine/firmware/bios` is the system ROM entry layer: `bootrom.lua`,
`system.lua`, and shared common/util helpers. Device-facing system-ROM Lua
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
source of truth. Runtime and tooling diagnostics use the platform logging and
IDE error owners; they are not BIOS monitor commands and must not be swallowed
by deferred host code.

## Host presentation and frontend lifecycle

`overlay_queue` is the retained publication boundary between host-UI producers
and render backends. Workbench and menu publish separate ordered lanes as
references to their existing command kinds, payload references and counts.
Backends consume only that pass state; they do not read a menu/workbench
controller or clone the commands into a per-frame DTO. WebGPU and WebGL2 own
their concrete pipelines, atlases, buffers and uploads behind that boundary.
The BIOS display-2 circuit is not an overlay-queue lane. The full-screen IDE
owns and emits its own frame background; the quick menu publishes only its own
host commands over the retained game scanout.
WebGPU is the default accelerated browser backend and WebGL2 is its fallback;
host validation failures do not reverse that ownership or introduce a second
presentation facade.

One libretro `retro_run()` advances exactly one machine-timed frame. Frontend
wall time is not fed back into the machine scheduler. A direct host may skip an
overdue host presentation while catching up, but it still advances machine and
audio state. When physical audio output is active, its fixed-capacity blocking
queue is the host pacing master; a second deadline pacer must not compete with
it, and push/pop/callback paths must not allocate or report dropped samples as
consumed.

The direct Linux host keeps platform video resources in the concrete
`video_context` owner. That owner contains the fbdev mapping, SDL window,
renderer and texture, SDL GLES context, EGL context and surface, swap operation,
drawable extent and physical window-to-surface mapping. It initializes and
quits only the SDL video subsystem. Game-controller subsystem state remains with
input; audio owns the SDL audio subsystem independently.

`video_presenter` owns the libretro pixel format and hardware-context callback,
native game geometry, destination rectangle, accepted-presentation ordinal,
software conversion, GLES final blit, frontend messages and screenshot capture.
It borrows one stable surface record from `video_context`; the context may grow
or replace that record's pixel storage but not the record itself. The presenter
therefore translates surface points through its retained destination rectangle
instead of making the platform context duplicate game-layout policy. Its
message surface, GL objects and capture buffer are retained owner state:
ordinary frames do not allocate, message geometry uploads only when it changes,
and repeated captures reuse capacity. SDL software storage changes only when
the machine geometry changes, and GLES drawable extent is refreshed on SDL
window events rather than polled during every presentation.

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
than through process-global symbols. A libretro context reset may arrive without
a preceding destroy callback, so every GLES texture, depth buffer and render
target records the context generation that created its GL name. Clean context
destruction runs while the context is still alive and deletes matching graph,
pass, texture-manager, default-texture and backend resources in owner order. An
unannounced loss advances the generation first; the same owners then discard
their stale host handles and complete CPU-side pipeline state without issuing
deletes against numeric names that may already belong to the replacement
context. Replacement pass singletons are bootstrapped only after the old graph
and registry have been removed.

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
preserves byte-exact VRAM without stale accelerated frontier state. These
lifecycle paths run only at context setup or loss; frame rendering does not
perform generation checks or allocate replacement state.

An unannounced loss cannot read back the dead context. Resource recreation is
safe, but byte-exact VRAM restoration is still open because the retained raw
snapshot may predate GPU-only writes whose replay commands have already been
discarded by guest-visible FIFO/readback operation. Do not hide that boundary
with per-frame full-VRAM readback, parallel software rasterization or an
asset-reupload special case; it needs a measured, backend-independent VRAM
coherence contract.

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
through the real backend and cannot be replaced by software parity, a black WSL
swapchain, sparse screenshots or a hidden compositor window.

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
