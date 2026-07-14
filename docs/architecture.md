# BMSX Architecture Contract

Last checked: 2026-07-02.

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
- `lib/libbmsx.a`: C++ machine/runtime static library.
- `dist/libretro_bmsx.so` / `.dll` / `.dylib`: libretro core entrypoint around the C++ machine runtime.
- `bmsx_libretro_host`: local frontend executable that loads a libretro core and
  owns SDL, ALSA, EGL/fbdev, input devices, screenshots, and the process loop.
- `dist/host_headless.js` / `.debug.js` and `dist/host_cli.js` / `.debug.js`:
  Node host executables/modes that load the machine runtime artifact and own
  their process/runtime environment.

Do not use `platform` as an architecture category for both `libretro` and
`libretro_host`. `hosts/libretro` is the libretro core entrypoint;
`hosts/libretro_host` is the local frontend executable that can run that core.

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
- A CPU parked by `HALT` remains parked until an accepted interrupt. Host/native
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

Program images also carry an `irqProtoIndex` vector. On a guest-domain
`HALT` or guest instruction boundary, an asserted unmasked maskable IRQ line
makes the CPU push that handler proto as an interrupt frame above the
interrupted cart frame. The handler runs as normal CPU bytecode and returns
with `RET`; interrupt-frame return restores the previous maskable-enabled state
and resumes the interrupted frame without copying return values. Host/debugger
closure calls may wake from a pending IRQ, but they do not consume or vector it.
NMI has no producer today and is not part of the vector table.

The cart-facing IRQ gate is `IRQ_MASK`, a per-source bitmask with the same bit
layout as `IRQ_FLAGS`. It resets to `0`, so cold boot starts with no source
vectoring. Firmware and carts unmask only the sources they handle asynchronously.
The boot ROM masks all sources again immediately before handing control to a
cart, so firmware-owned mask bits never leak into the cart reset vector.
The CPU's global maskable-enable state is internal handler serialization: it
starts enabled, is disabled atomically when a maskable interrupt frame is pushed,
and is restored from that frame on `RET`. A line vectors when both layers allow it:
the internal enable is set and `(IRQ_FLAGS & IRQ_MASK) != 0`. A pending source
is accepted at the first guest instruction boundary after its mask bit is
written, with no delayed-EI extra instruction.

The compiler-generated IRQ vector reads `IRQ_FLAGS` and calls the program's
global `irq(flags)` handler when bits are pending. The shipped handler belongs
to firmware/cart code: BIOS and cartlib expose `system.irq` / `on_irq` as
convenience dispatch over registered masks, and bare-metal carts may define
`irq(flags)` directly. Dispatch code acknowledges only the masks it owns. An
asynchronous source is unmasked and has exactly one vector-handler owner that
acknowledges it. A synchronous waiter leaves its source masked, polls
`IRQ_FLAGS` directly while running, and writes `IRQ_ACK` itself; masked pending
bits remain visible but do not vector or wake `HALT`. An unmasked unacknowledged
level bit will vector again at the next eligible guest boundary, matching
hardware interrupt-storm semantics rather than being discarded by the emulator.

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
  latches, and the VBlank sample-edge datapath owned by
  `machine/devices/input/controller`;
- output command datapath owned by `machine/devices/input/output_port`.

The runtime VBlank owner enters through the ICU controller edge. The controller
consumes the arm latch into sample sequence/last-cycle state, asks the host
input owner to fill one raw `InputControllerSnapshot`, and decodes that snapshot
into raw MMIO words at the datapath boundary. Later cart reads consume only the
mirrored register words. The ICU does not own action maps, action-expression
parsing, button-name string ids, consume state, repeat windows, guarded presses,
or a high-level event FIFO.

ICU device code consumes only `machine/devices/input/contracts` source ports.
The host input manager/player layer implements those ports and remains outside
the device. The host side may keep its richer keyboard/gamepad/pointer mapping,
shortcut, IDE, terminal, quick-menu, onscreen gamepad, and device-assignment
logic under `machine/{ts,cpp}/input`; that complexity is not exposed as ICU
hardware.

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

## IDE, editor, and host tooling

IDE/editor/workspace code is host tooling. It may compile source, inspect debug
symbols, display terminals, and patch ROM/workspace inputs at host edges. It must
not be imported by machine devices or become the cart-visible source of truth.

Terminal commands return explicit owner actions; workbench/editor owners apply
those actions. Runtime faults must surface through the runtime/terminal error
channel instead of being swallowed by deferred host code.

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

The active architecture-slice status table lives in
`docs/open_architecture_slices.md`; the broader hardware-emulation goal lives in
`docs/goal.md`. This architecture file remains the stable machine contract.
