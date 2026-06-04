# Openstaande architectuur-slices

Baseline na de laatste boundary-slices:

```txt
architecture_boundary_issues,38
ts-machine -> ts-ide,11
cpp-machine -> cpp-input,6
ts-machine -> ts-input,5
cpp-machine -> cpp-platform,4
ts-machine -> ts-core,4
ts-machine -> ts-render,4
cpp-machine -> cpp-render,3
ts-machine -> ts-platform,1
```

Al afgerond en daarom niet opnieuw als open slice opgenomen:

- timing-config losgetrokken van input
- ROM-format types losgetrokken van host layers
- browser backend factory verplaatst naar browser host
- TS input identity/action-state/action-parser/action-table onder ICU-eigenaarschap gebracht

## 0. Browser/runtime view-singleton lek afronden

Status: in progress, nog niet gecommit.

Aanleiding: browser-host `engine.js` en machine/runtime `libbmsx.js` kunnen elk hun eigen `consoleCore` singleton in de bundle hebben. WebGL post-passes mogen daarom niet via een geïmporteerde `consoleCore.view` naar de actieve view grijpen.

Huidige wijziging:

- `machine/ts/render/post/device_quantize_pipeline.ts`
- `machine/ts/render/post/crt/pipeline.ts`

Acceptatie:

- post-passes gebruiken de actieve `RenderPassLibrary.view`
- browser debug/release build groen
- TS headless en C++ headless boot + screenshots blijven groen
- geen nieuwe architecture-boundary issues

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

Doel: machine runtime gebruikt een kleine machine-owned host-services port voor clock/storage/frame-loop/gates, niet `core/console`, `core/taskgate` of concrete `platform` modules.

Open audit-evidence:

- `machine/ts/machine/runtime/runtime.ts -> core/console`
- `machine/ts/machine/runtime/runtime.ts -> core/taskgate`
- `machine/ts/machine/runtime/runtime.ts -> platform/platform`
- `machine/ts/machine/runtime/timing/state.ts -> core/console`
- `machine/cpp/machine/runtime/runtime.cpp -> platform/platform.h`

Acceptatie:

- runtime is startbaar zonder core singleton import
- host/core bezit process/frame-loop scheduling
- machine runtime consumeert alleen de host-services port

## 4. Program start/bootstrap uit machine halen

Doel: `start_cart` is host/bootstrap API, geen machine module. De machine-runtime levert een runtime/machine API; browser/headless/libretro host kiezen hoe die gestart wordt.

Open audit-evidence:

- `machine/ts/machine/program/start_cart.ts -> core/console`

Acceptatie:

- start/bootstrap entrypoint leeft onder host/bootstrap ownership
- machine/program bevat alleen program/ROM/compiler/runtime primitives
- browser en headless blijven dezelfde public startup kunnen gebruiken

## 5. IDE/workbench/hot-reload uit machine runtime trekken

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

## 6. Firmware/prelude/global registration ownership

Doel: firmware/global registration hoort bij machine firmware/runtime ownership, niet bij IDE runtime helpers.

Open audit-evidence:

- `machine/ts/machine/firmware/globals.ts -> ide/runtime/lua_pipeline`
- overlap met `machine/ts/machine/runtime/runtime.ts -> ide/runtime/lua_pipeline`

Acceptatie:

- prelude/global registration kan door machine runtime zelf draaien
- IDE lua-pipeline is geen dependency van machine firmware
- BIOS/game builds en Lua tests blijven groen

## 7. Render/presentation boundary uit machine runtime halen

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

## 8. C++ platform dependencies in machine firmware/IMGDEC

Doel: C++ machine code mag geen concrete platform header nodig hebben voor firmware builtins of IMGDEC. Als host services nodig zijn, lopen die via een expliciete machine service boundary.

Open audit-evidence:

- `machine/cpp/machine/devices/imgdec/controller.cpp -> platform/platform.h`
- `machine/cpp/machine/firmware/builtins.cpp -> platform/platform.h`
- `machine/cpp/machine/firmware/globals.cpp -> platform/platform.h`
- `machine/cpp/machine/runtime/runtime.cpp -> platform/platform.h`

Acceptatie:

- machine firmware/IMGDEC include geen `platform/platform.h`
- host-owned IO/resources blijven buiten cart-observable semantics
- native build + libretro headless blijft groen

## 9. Save-state/resume render-context split

Doel: machine save-state/resume bevat machine state; render-context herstel is host/render follow-up werk.

Deze slice overlapt met slice 7, maar is klein genoeg om los te doen.

Open audit-evidence:

- `machine/ts/machine/runtime/save_state.ts -> render/vdp/context_state`
- `machine/cpp/machine/runtime/resume_snapshot.cpp -> render/vdp/context_state.h`
- `machine/cpp/machine/runtime/save_state.cpp -> render/vdp/context_state.h`

Acceptatie:

- machine save/load heeft geen render imports
- host voert render-context restore uit na machine-state restore
- TS/C++ save-state tests blijven groen

## 10. Audit naar echte gate brengen

Doel: de audit blijft generiek en gaat pas strict zodra de open slices weg zijn. Geen hardcoded uitzonderingen toevoegen om huidige fouten wit te wassen.

Acceptatie:

- `npm run audit:architecture-boundaries -- --summary-only` gaat naar nul voor de beoogde machine-boundary classes
- daarna `audit:architecture-boundaries:strict` bruikbaar als CI-gate
- nieuwe regels blijven patroon-/layer-gebaseerd, niet file-by-file hardcoded

## 11. Rendering parity later apart oppakken

Doel: TS headless en C++ software screenshots zijn nu allebei correct bootend/nonblank, maar niet pixel-identiek. Dit is geen blocker voor de boundary-slices, wel een aparte rendering-parity slice.

Evidence uit validatie:

- TS screenshots: `256x212`, nonblank, alpha OK
- C++ screenshots: `256x212`, nonblank, alpha OK
- visueel dezelfde scene/progressie
- pixel/kleurlijn verschilt tussen TS headless en C++ software path

Acceptatie:

- eerst bepalen of pixel parity echt contract moet worden
- als ja: één golden/capture pad definiëren en TS/C++ daarop vergelijken
