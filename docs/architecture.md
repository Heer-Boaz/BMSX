# Internal software architecture

This document describes the implementation and dependency boundaries of the
BMSX repository. Its readers maintain the emulators, firmware source, development
tools and host applications. It is **not a hardware or BIOS specification**, and
it does not supplement or override the console manuals.

## Documentation responsibilities

The developer manuals are the product specification supplied to independent
BMSX programmers:

- **Book I — System and Hardware Reference:** [console](book1/console.md),
  [memory](book1/memory.md) and the installed hardware units.
- **Book II — BLua32 and BIOS Reference:** [processor architecture](book1/cpu.md),
  [BLua source](book1/blua-programs.md) and the installed firmware interfaces.
- **Book III — Cartridge and Expansion Reference:**
  [cartridge and mapped devices](book3/cartridge.md).

Register maps, instruction encodings, executable layouts, device protocols,
public firmware calls and machine timing belong in those books, not here.
Source verification and editorial rules live in the
[manual authoring guide](manual/README.md) and [repository instructions](../AGENTS.md).
A directory name does not determine book membership or product ownership.

## Architectural roles

| Role | Responsibility | Principal source roots |
|---|---|---|
| Machine core | CPU execution, memory and device state, scheduling, image execution and checkpoints | `machine/{ts,cpp}/machine` |
| Numeric specifications | Shared numeric definitions and pure representation/arithmetic primitives consumed independently by core and producers | `machine/{ts,cpp}/spec` |
| BIOS | The system-ROM guest program and its resources | `machine/bios` |
| Shared format libraries | Binary serialization and media-image decoding used at their owning boundaries | `machine/{ts,cpp}/common`, `machine/{ts,cpp}/rompack` |
| Toolchain | Source analysis, compilation, linking, symbols and ROM/resource production | `toolchain/ts`, `scripts/rompacker` |
| Host applications | Process and platform services, media admission, physical input and execution/presentation policy | `hosts` |
| GX execution backends | Software/accelerated command execution, rasterization, VRAM synchronization and scanout | `machine/{ts,cpp}/render/backend` |
| Host presentation | Video presentation, output audio, overlays and platform resource lifetimes | `machine/{ts,cpp}/render`, `machine/ts/audio`, host output owners |
| Studio | Resource models, editing, source tools, debugging and authoring workflows | `ide` |
| Independent cartridge software | Optional game libraries, engines and example cartridges | `cartlib`, `carts` |
| Test infrastructure | Native/TS tests, derived guest tests and conformance runners | `tests`, `testlib` |

`cartlib` and the project's packers/converters have the position of a game
studio's internal development software. They are not console hardware, resident
firmware or a manufacturer-mandated SDK. Their APIs and asset formats cannot
define what BMSX cartridges must use. Co-location in this monorepo changes none
of those responsibilities.

## Dependency direction

```text
Studio / explicit tooling hosts ──> authoring toolchain
           │                              │
           v                              v
      host services                  numeric specs
           │                              ^
           v                              │
  machine Runtime ──> CPU / memory / devices / scheduler
           │
           v
    shared low-level code

GPU front-end ──> execution backend ──> completed scanout ──> host presentation
BIOS and cartridge sources ──> toolchain ──> guest images
```

The graph describes ownership, not a requirement for another interface layer.
Use the existing owner directly. Machine devices do not import Studio,
filesystem transports, source compilers, product builders or presentation UI.
Compiler and ROM producers consume specification leaves rather than importing
emulator objects to obtain numeric definitions. Shared format code is not
emulator-owned merely because it currently lives under `machine/`.

Product composition roots select the concrete host, renderer and optional
tooling dependencies. Ordinary players do not acquire Studio or a source
compiler through an optional parameter, runtime feature switch or facade.

## Machine implementation

### Runtime, memory and devices

`Runtime` composes a machine instance with its frame scheduler and execution
lifecycle. `Machine` owns its CPU, memory, devices and device scheduler. Each
device owns the mutable state it executes; the MMIO bus routes access to that
owner rather than maintaining another semantic copy.

Raw register words, addresses, opcodes, FIFO contents and fixed-point data retain
their machine representation. Decode at the owning datapath. Host objects,
source annotations and convenience library objects are not substitutes for
machine values. The books define the observable behavior; device methods and
state records implement it.

The CPU owns guest value representation, heap identity, allocation accounting,
execution frames and collection. Compiler and debugger metadata remain with
their tooling owners. Diagnostic presentation resolves raw machine observations
against installed symbols outside the core; it does not store formatted source
errors in CPU state.

### Scheduling and host time

The device scheduler orders CPU slices and device service deadlines in machine
time. The frame scheduler accounts for admitted host time, retained fractional
grants and unspent execution budget. Host pacing, menu pause, capture and UI
refresh policy remain outside device state.

Browser/Node and native libretro execution use their existing common frame
owners. Explicit bounded execution and normal paced execution share those
owners; a test or debugger does not create another CPU loop. Backend suspension
retains admitted work until its actual completion. Detailed hardware timing and
event order are specified in the relevant unit manuals.

### Persistence and rewind

Capture and restore aggregate the live owners' state. The paired runtime codecs
serialize the current state directly, without revision tags, legacy readers,
migration or state-repair paths. Restore installs owned state; it is not replay
of MMIO writes or an opportunity to normalize representable machine data.

`RuntimeHistory` owns checkpoints and recorded input. Host rewind and Studio
navigation admit operations against that history and own presentation/control
intent. Working copies, source installation records, UI focus, tool handles and
host pause reasons do not become emulated checkpoint state. See
[rewind architecture](rewind_architecture.md) for the internal ownership and
lifetime details.

### Mirrored implementations

TypeScript and C++ core modules match by responsibility and representation.
Shared numeric leaves are dependency leaves without controllers, host policy
or runtime objects. They may contain pure word encoders/decoders and arithmetic
primitives; source parsing remains a frontend responsibility. Domain-specific
conversions stay with their owner; feature files do not invent alternate
encoders.

Guest behavior and serialized machine state are cross-runtime responsibilities.
Host-only UI implementations do not require unused counterparts.

## Toolchain and media ownership

`toolchain/ts/lua` owns authored-source lexing, parsing, binding, compilation and
source metadata. A parsed generation belongs to its source owner; compiler and
editor consumers reuse that generation rather than reconstructing syntax from
display text. The linker owns image construction and relocation. The machine
executes the resulting image; its accepted image format is documented in the
manuals, not defined by a particular producer's output choices.

`toolchain/ts/rompack` and `scripts/rompacker` own source/resource discovery,
conversion and package emission. Their project manifests, source catalogs,
private atlas placements and authoring payloads remain tooling representations.
Public BLua source and linkage interfaces belong in Book II even when their
consumer is a compiler; that does not make this packer's container or workflow
mandatory. Establish hardware/BIOS format claims from their actual consumers,
not by copying a tool's writer into a manual.

Hosts admit physical media and retain its backing for the lifetime of the
runtime's byte views. Authoring tools separately load optional source/symbol
media. Native content releases the runtime before unmapping its backing.
Ordinary runtime construction does not build authoring catalogs.

Native CMake targets maintain the same dependency split:

| Target | Responsibility |
|---|---|
| `bmsx_binary_codec` | Shared binary serialization |
| `bmsx_rom_image` | Shared media-image decoding |
| `bmsx_core` | Machine execution; depends on low-level codec code |
| `bmsx_host_support` | Presentation and native host-support resources above the core |
| `bmsx_rom_tooling` | Source-aware ROM records and diagnostics |
| `bmsx_blua32_tooling` | Symbols, source mapping and disassembly above ROM tooling |

The target definitions in `machine/cpp/CMakeLists.txt` and product entrypoints
own the actual build graph. Compiler/tooling code is not promoted to core
ownership by its current filesystem location.

## Firmware and independent guest software

The BIOS is one separately linked guest program. `machine/bios/main.lua`
coordinates its boot lifecycle; `kernel`, `gpu`, `tty`, `shell` and `debug`
own firmware internals. The resident libraries live in the BIOS source tree.
Their public calls and cartridge-visible effects belong in Book II. The
emulator does not replace those bodies with host service shortcuts.

Cartridges may choose `cartlib`, another engine or direct programming. Studio's
cartlib-specific inspectors consume the independent producer's private layout
through the [inspection contract](cartlib_inspection_contract.md); that is an
internal integration contract, not a console ABI. Generic machine inspection
must not depend on cartlib membership or names.

`testlib` belongs only to explicitly derived test programs. Guest test code is
not a runtime dependency of ordinary cartridges or installed firmware. Test
source discovery, case isolation and execution lifetime belong to the
[guest-testing system](guest_testing.md).

## Rendering, audio and host input

The GX device front-end owns register/ingress state and scheduling. Software
and accelerated backends execute its command/buffer boundary, including
emulated rasterization, transfers, VRAM synchronization and scanout. This is
part of GPU emulation, not merely host display work; every backend implements
the same product behavior. Concrete resource lifetime stays with the backend.

Completed scanout then enters host presentation. Host menus and Studio publish
separate overlay work. The presenter owns destination sizing, render-target
lifetime, presentation history and capture. Window geometry does not become
device register state. See
[host presentation sizing](host_presentation_sizing.md).

Renderer caches and GPU resources have explicit ownership and context lifetime.
Controlled teardown commits authoritative device data before destroying its
backing. A dead external context must not silently restore stale cached data.
Context-generation handling belongs at resource creation/destruction, not as
per-instruction or per-pixel defensive work.

Audio devices own emulated audio state. Resampling, physical output buffering,
transport muting and platform device lifetime belong to host audio owners.
Physical input adapters likewise own platform sampling and lifecycle; they
supply the device's input boundary without installing gameplay action maps.
Host shortcut recognition is source-local and separate from guest mapping.
Game-view focus routes ordinary gameplay input without reserving it globally
for Studio or host UI.

## Host products and builds

`hosts/common` owns shared player lifecycle, execution control and presentation
coordination. Browser and Node roots compose those services directly.
`hosts/libretro` embeds the native runtime in the libretro ABI;
`hosts/libretro_host` is a separate frontend that owns its window, platform
input/audio and loaded-core lifetime. A host mode is an execution/presentation
variant, not another emulated machine or firmware layer.

| Artifact | Composition |
|---|---|
| `dist/libbmsx.js` | Importable JavaScript machine/runtime library |
| `dist/engine.js` | Browser player |
| `dist/studio.js` | Browser host with Studio and authoring tooling |
| `dist/host_headless.js`, `dist/host_cli.js` | Node player modes |
| `dist/host_headless_tooling.js` | Explicit Node validation and source-aware tooling |
| `libbmsx.a` | Native machine/runtime archive in its build tree |
| `dist/libretro_bmsx.*` | Native libretro core |

`scripts/products` owns deployable product construction and host resource
production. `scripts/rompacker` owns guest-image construction. Shared CLI/build
mechanics live in their existing common owners; neither producer imports the
other product's composition root.

Cross-build toolchains, SDK preparation and platform requirements belong to
`Makefile`, CMake/toolchain files and the platform build scripts. Their current
recipes and acceptance commands are not reproduced here as dated setup logs.

## Studio ownership

### Source and editor state

Resource-owned text models are the canonical authored source. Undo, saved
baseline and installed source are distinct states. Builds capture the admitted
source revision; Save acknowledges actual persistence, not ROM installation.
Recovery records are not canonical source files. See
[source lifecycle](studio_source_lifecycle.md) and
[save acknowledgements](studio_source_save_acknowledgements.md).

The semantic workspace publishes retained source/syntax snapshots consumed by
completion, navigation, diagnostics and source-authoring features. Feature
providers do not introduce their own parser, binder, alias walker or mutable
semantic cache. Domain/project identity belongs to the resource-model owner,
not merely a path or displayed version. Detailed analysis ownership lives in
the existing language-service design documents, including
[semantic-model synchronization](editor_semantic_model_sync.md).

### Execution and inspection

Debuggers, Terminal calls, frame navigation and isolated guest tests use the
real runtime and its scheduler/task boundaries. Source stops are tooling
policy over raw execution observations; CPU state contains no editor paths or
stepping policy. Installed symbols locate values without evaluating guest code
to reconstruct missing metadata. See the
[source debugger](studio_source_debugger.md) and
[runtime tools](studio_runtime_tools.md).

Inspection borrows expire on execution, state replacement and target retirement.
Retained display selection is not a live guest handle. Studio source editing,
review, Save, installation, guest execution and result publication each retain
their own admission/completion owner. UI panes and assistant transports consume
those owners rather than creating alternate execution or persistence paths.

GTE observation exposes paired normal-command operands/results and distinct
PLUS acceptance/publication events at their device owners. Inspection never
synchronizes pending work. Studio owns the optional bounded history, retained
acceptance provenance, installed-source identities, selection and diagrams;
it does not rerun device arithmetic, reconstruct unobserved operands or infer GPU
submission from GTE results. Retained evidence navigates through the existing
physical frame history with its original checkpoint provenance. The hardware
interface remains specified by [the GTE reference](book1/gte.md).

### Workspace services and assistants

Workspace filesystem/browser storage, source saving and session recovery have
explicit resource lifetimes. Capabilities are injected by product composition;
standalone Studio does not acquire a server or assistant dependency merely to
edit or run a program. See [standalone composition](studio_standalone.md) and
[workspace history](editor_workspace_history.md).

The assistant is an optional Studio consumer. Conversation transport and native
process/account ownership remain host-side. Source edits use the ordinary
review/working-copy services; tests and runtime operations use their existing
isolated-target owners. No provider protocol, process handle or conversation
state enters emulated machine state. Detailed lifecycle rules belong in
[assistant integration](studio_assistant_contribution.md) and
[process ownership](studio_codex_process_contract.md).
