# Openstaande architectuur-slices

Baseline na de laatste boundary-slices:

```txt
architecture_boundary_issues,17
ts-machine -> ts-ide,10
ts-machine -> ts-render,4
cpp-machine -> cpp-render,3
```

Slice-nummers worden niet hergebruikt: gaten in de nummering (1–3, 5, 7) zijn
slices die al zijn afgerond of vervangen; nieuwe slices nummeren door vanaf het
hoogste ooit gebruikte nummer. Slices staan in dit document in
prioriteitsvolgorde, niet in nummervolgorde.

Al afgerond en daarom niet opnieuw als open slice opgenomen:

- timing-config losgetrokken van input
- ROM-format types losgetrokken van host layers
- browser backend factory verplaatst naar browser host
- TS input identity/action-state/action-parser/action-table uit directe host
  ownership getrokken; dat was een tussenstap, geen eindmodel. De open
  ICU-slices hieronder halen de high-level PlayerInput/action-semantiek weer uit
  de hardware en leggen die bij engine/host-eigenaars.
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
- ICU VBlank sampling gebruikt machine-scheduler tijd voor de hardware
  sample-latch; host input timestamps blijven host-side physical event metadata
  en high-level action/`pressTime`-semantiek hoort niet in de ICU
- ICU input-device source boundary: TS/C++ ICU device-code consumeert
  `machine/devices/input/contracts` input-source ports in plaats van concrete
  host input manager/player types
- Machine/Runtime input-injectie boundary: TS/C++ `Machine` en `Runtime`
  consumeren expliciet het machine-owned ICU input-source contract; host/core
  geeft de concrete input owner door. Runtime boot-opties zitten in de
  gemirrorde `machine/runtime/options` contractbestanden. Runtime input-timing
  configuratie zit in `machine/runtime/input`; ICU input-source ports blijven
  onder `machine/devices/input/contracts`
- TS runtime importeert geen core singleton meer; storage wordt direct bij
  constructie geleverd, runtime bezit zijn eigen lua-gate en `TimingState`
  muteert alleen nog machine timing state
- TS/C++ task-gate primitive staat onder `common` in plaats van `core`, zodat
  render/IDE/runtime readiness geen core-owner shortcut nodig heeft
- ICU is teruggebracht tot raw MMIO input hardware: keyboard bitmap,
  pointer snapshot, vier gamepad blocks en output latch. High-level
  action/query/consume/event-FIFO gedrag is uit de ICU-contracten verwijderd.
- Lua `cartlib/input` bezit gameplay PlayerInput-semantiek bovenop raw ICU
  reads; normale carts gebruiken deze engine-laag in plaats van ICU action
  registers. `bare_metal_cart` leest de raw ICU-layout direct.
- TS/C++ host PlayerInput blijft onder `machine/{ts,cpp}/input` voor IDE,
  terminal, quick menu, shortcuts, device assignment en rijkere host-inputlogica.

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
