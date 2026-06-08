# Openstaande architectuur-slices

Baseline na de laatste boundary-slices:

```txt
architecture_boundary_issues,31
ts-machine -> ts-ide,10
cpp-machine -> cpp-input,6
ts-machine -> ts-input,5
ts-machine -> ts-render,4
cpp-machine -> cpp-render,3
ts-machine -> ts-core,3
```

Al afgerond en daarom niet opnieuw als open slice opgenomen:

- timing-config losgetrokken van input
- ROM-format types losgetrokken van host layers
- browser backend factory verplaatst naar browser host
- TS input identity/action-state/action-parser/action-table onder ICU-eigenaarschap gebracht
- browser/runtime view-singleton lek uit WebGL post-passes gehaald
- C++ GLES2 CRT/device/present post-pass resources onder pass-lifecycle gebracht
- publieke JS runtime API gebruikt direct `MachineManager.boot`; `startCart`-wrapper verwijderd
- TS firmware/prelude/global registration losgetrokken van IDE lua-pipeline
- C++ machine firmware/IMGDEC/runtime gebruikt machine-owned `MicrotaskQueue`
  contracts in plaats van concrete `platform/platform.h`
- TS runtime gebruikt machine-owned `StorageService` contracts in plaats van
  concrete `platform/platform` types
- cart-zichtbare `clock_now`, `os.clock`, default `os.time`/`os.date` en default
  `math.randomseed()` gebruiken machine-scheduler tijd in plaats van host/platform clock
- ICU VBlank sampling gebruikt machine-scheduler tijd voor sampled action
  `pressTime`/timestamps; host input timestamps blijven host-side physical event
  metadata en worden niet doorgegeven als cart-zichtbare sampletijd

## 1. ICU input-device source boundary

Doel: ICU device-code consumeert machine-owned input source contracts, niet concrete host input managers/spelers.

Open audit-evidence:

- `machine/ts/machine/devices/input/controller.ts`
- `machine/ts/machine/devices/input/output_port.ts`
- `machine/ts/machine/devices/input/sample_edge.ts`
- `machine/cpp/machine/devices/input/controller.h`
- `machine/cpp/machine/devices/input/output_port.cpp`
- `machine/cpp/machine/devices/input/sample_edge.cpp`

Acceptatie:

- geen `machine/devices/input/* -> input/manager|player` imports/includes meer
- TS/C++ input-controller tests groen
- TS/C++ headless `bare_metal_cart` boot + screenshots groen

## 2. Machine/Runtime input-injectie boundary

Doel: `Machine` en `Runtime` krijgen hun input source expliciet via een machine-owned contract. Ze mogen niet zelf `Input.instance` of host input ownership kennen.

Open audit-evidence:

- `machine/ts/machine/machine.ts`
- `machine/ts/machine/runtime/runtime.ts`
- `machine/cpp/machine/machine.cpp`
- `machine/cpp/machine/runtime/runtime.cpp`

Acceptatie:

- machine constructor/runtime constructor spreken alleen over machine-side input source interfaces
- host/core maakt de concrete adapter
- ICU tests + boot/headless blijven groen

## 3. Runtime host-services port

Doel: machine runtime gebruikt een kleine machine-owned host-services port voor storage/frame-loop/gates, niet `core/machine_manager`, `core/taskgate` of concrete `platform` modules. HostClock blijft host/IDE/input scheduling en is geen cart-zichtbare machine-tijd.

Open audit-evidence:

- `machine/ts/machine/runtime/runtime.ts -> core/machine_manager`
- `machine/ts/machine/runtime/runtime.ts -> core/taskgate`
- `machine/ts/machine/runtime/timing/state.ts -> core/machine_manager`

Acceptatie:

- runtime is startbaar zonder core singleton import
- host/core bezit process/frame-loop scheduling
- machine runtime consumeert alleen de host-services port

## 4. IDE/workbench/hot-reload uit machine runtime trekken

Doel: machine runtime mag programma's laden, uitvoeren, pauzeren en state leveren; IDE/workbench/editor/hot-reload UI is host/tooling ownership.

Open audit-evidence:

- `machine/ts/machine/runtime/runtime.ts -> ide/terminal/ui/mode`
- `machine/ts/machine/runtime/runtime.ts -> ide/runtime/overlay_renderer`
- `machine/ts/machine/runtime/runtime.ts -> ide/cart_editor`
- `machine/ts/machine/runtime/runtime.ts -> ide/workspace/workspace`
- `machine/ts/machine/runtime/runtime.ts -> ide/workbench/*`
- `machine/ts/machine/runtime/runtime.ts -> ide/runtime/lua_pipeline`
- `machine/ts/machine/runtime/runtime.ts -> ide/runtime/debug_pause`
- `machine/ts/machine/runtime/runtime.ts -> ide/runtime/fault_state`

Acceptatie:

- runtime heeft geen editor/workbench imports
- host/IDE laag bezit hot reload, overlays en UI-fault rendering
- machine exposeert expliciete program-load/resume/fault data

## 6. Render/presentation boundary uit machine runtime halen

Doel: machine produceert VDP/VOUT/RPU output; host/render consumeert die output. Machine runtime bezit geen `GameView`, presentation state of render context restore.

Open audit-evidence:

- `machine/ts/machine/runtime/runtime.ts -> render/gameview`
- `machine/ts/machine/runtime/runtime.ts -> render/presentation_state`
- `machine/ts/machine/runtime/runtime.ts -> render/shared/bmsx_font`
- `machine/ts/machine/runtime/save_state.ts -> render/vdp/context_state`
- `machine/cpp/machine/runtime/runtime.h -> render/presentation_state.h`
- `machine/cpp/machine/runtime/resume_snapshot.cpp -> render/vdp/context_state.h`
- `machine/cpp/machine/runtime/save_state.cpp -> render/vdp/context_state.h`

Acceptatie:

- runtime exposes machine-visible output/state
- host/render owns presentation, view snapshots and context restore
- save/resume machine state remains render-host independent

## 8. Save-state/resume render-context split

Doel: machine save-state/resume bevat machine state; render-context herstel is host/render follow-up werk.

Deze slice overlapt met slice 6, maar is klein genoeg om los te doen.

Open audit-evidence:

- `machine/ts/machine/runtime/save_state.ts -> render/vdp/context_state`
- `machine/cpp/machine/runtime/resume_snapshot.cpp -> render/vdp/context_state.h`
- `machine/cpp/machine/runtime/save_state.cpp -> render/vdp/context_state.h`

Acceptatie:

- machine save/load heeft geen render imports
- host voert render-context restore uit na machine-state restore
- TS/C++ save-state tests blijven groen

## 9. Audit naar echte gate brengen

Doel: de audit blijft generiek en gaat pas strict zodra de open slices weg zijn. Geen hardcoded uitzonderingen toevoegen om huidige fouten wit te wassen.

Acceptatie:

- `npm run audit:architecture-boundaries -- --summary-only` gaat naar nul voor de beoogde machine-boundary classes
- daarna `audit:architecture-boundaries:strict` bruikbaar als CI-gate
- nieuwe regels blijven patroon-/layer-gebaseerd, niet file-by-file hardcoded

## 10. Rendering parity later apart oppakken

Doel: TS headless en C++ software screenshots zijn nu allebei correct bootend/nonblank, maar niet pixel-identiek. Dit is geen blocker voor de boundary-slices, wel een aparte rendering-parity slice.

Evidence uit validatie:

- TS screenshots: `256x212`, nonblank, alpha OK
- C++ screenshots: `256x212`, nonblank, alpha OK
- visueel dezelfde scene/progressie
- pixel/kleurlijn verschilt tussen TS headless en C++ software path

Acceptatie:

- eerst bepalen of pixel parity echt contract moet worden
- als ja: één golden/capture pad definiëren en TS/C++ daarop vergelijken
