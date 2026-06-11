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

## 11. ICU scope terugbrengen naar raw input hardware

Doel: de ICU wordt weer een kleine MMIO-hardwareunit: registerfile,
sample-latch en output/vibration latch. De ICU leest raw keyboard/gamepad/mouse
state en schrijft raw vibration/output commands; hij bezit geen PlayerInput,
action parser, mapping contexts, action table, consume-semantiek of high-level
action event FIFO.

Open audit-evidence:

- `docs/input_controller_unit.md`
- `docs/architecture.md` ICU-sectie
- `machine/ts/machine/devices/input/controller.ts`
- `machine/ts/machine/devices/input/contracts.ts`
- `machine/ts/machine/devices/input/registers.ts`
- `machine/ts/machine/devices/input/control_port.ts`
- `machine/ts/machine/devices/input/action_table.ts`
- `machine/ts/machine/devices/input/action_parser.ts`
- `machine/ts/machine/devices/input/query_port.ts`
- `machine/ts/machine/devices/input/event_fifo.ts`
- `machine/ts/machine/devices/input/output_port.ts`
- `machine/ts/machine/devices/input/sample_edge.ts`
- `machine/cpp/machine/devices/input/controller.{h,cpp}`
- `machine/cpp/machine/devices/input/contracts.h`
- `machine/cpp/machine/devices/input/registers.{h,cpp}`
- `machine/cpp/machine/devices/input/control_port.{h,cpp}`
- `machine/cpp/machine/devices/input/action_table.{h,cpp}`
- `machine/cpp/machine/devices/input/action_parser.{h,cpp}`
- `machine/cpp/machine/devices/input/query_port.{h,cpp}`
- `machine/cpp/machine/devices/input/event_fifo.{h,cpp}`
- `machine/cpp/machine/devices/input/output_port.cpp`
- `machine/cpp/machine/devices/input/sample_edge.cpp`

Acceptatie:

- `docs/input_controller_unit.md` beschrijft alleen raw input registers,
  sample-latch, read result registers en vibration/output latch words.
- `sys_inp_action`, `sys_inp_bind`, `sys_inp_query`, `sys_inp_consume`,
  action-expression parsing, mapping contexts, action snapshots en high-level
  action FIFO verdwijnen uit de ICU-contracten.
- De ICU sample-edge maakt een deterministische raw input snapshot; latere
  reads zien de latched hardware state, niet live host state.
- Vibration/output blijft een CPU-visible write datapath: carts schrijven
  selected-player/output words en de host input backend voert de output uit.
- TS/C++ ICU save-state bevat alleen zichtbare raw registers/latches en geen
  PlayerInput/action-parser/cache/host state.
- TS/C++ headless `bare_metal_cart` boot + screenshots blijven groen.

Non-goals:

- geen nieuwe wrapper/facade/adapterlaag om de huidige PlayerInput alsnog door
  de ICU te tunnelen;
- geen lokale ABI/fixed-point/register helpers in carts of gameplay files;
- geen rename-golf met `InputController*`-prefixes voor host PlayerInput APIs.

## 12. PlayerInput-semantiek naar Lua engine (`cartlib`), niet naar BIOS

Doel: de huidige PlayerInput-logica krijgt een cart/engine-owned Lua-equivalent
in `cartlib`: action mappings, contexts, action expressions, guarded presses,
repeat, consume en per-frame action state. Dit hoort bij de engine die gameplay
wil aanbieden, niet bij de BIOS en niet bij ICU-hardware.

Open audit-evidence:

- `machine/ts/input/player.ts`
- `machine/ts/input/context.ts`
- `machine/ts/input/manager.ts`
- `machine/ts/machine/devices/input/action_parser.ts`
- `cartlib/input/action_effect/system.lua`
- nieuw of aangepast `cartlib/input/*`

Acceptatie:

- Lua engine-code kan de huidige PlayerInput-semantiek uit raw ICU reads
  opbouwen zonder BIOS-modules te wijzigen.
- BIOS blijft beperkt tot laag-niveau boot/system utilities; geen PlayerInput,
  action parser, mapping context of gameplay input framework in
  `machine/firmware/bios/**`.
- De Lua engine bezit retained per-player/per-action/per-binding state en
  scratchbuffers; geen per-frame table/string/closure churn in input hot paths.
- Action parser/evaluator semantiek wordt met tests gespiegeld tegen de huidige
  host PlayerInput-resultaten voordat ICU high-level gedrag wordt verwijderd.
- Cartlib API blijft engine-facing: gameplay code vraagt actions aan de engine,
  en alleen de engine-laag leest de raw ICU MMIO waar dat nodig is.

Non-goals:

- geen `string.pack`/lokale encoding helpers of raw register abstractions in
  random cart files;
- geen metatable/objectlaag puur om host PlayerInput klasses na te bouwen;
- geen BIOS-afhankelijk gameplay-framework.

## 13. Host PlayerInput behouden voor IDE, Terminal en Quick Menu

Doel: de huidige host PlayerInput blijft bestaan voor host/UI ownership:
IDE/editor, terminal, workbench, quick menu, host shortcuts, onscreen gamepad en
host-device assignment blijven host-zaken. Deze laag wordt niet vervangen door
de Lua engine en wordt niet in de ICU begraven.

Open audit-evidence:

- `machine/ts/input/player.ts`
- `machine/ts/input/manager.ts`
- `machine/ts/ide/**`
- `machine/ts/core/host_overlay_menu.ts`
- `machine/cpp/input/**`
- `machine/cpp/core/host_overlay_menu.{h,cpp}`

Acceptatie:

- IDE, Terminal en Quick Menu blijven host PlayerInput gebruiken en importeren
  geen cartlib PlayerInput.
- Host PlayerInput mag high-level actions/contexts blijven hebben voor host UI,
  maar die state wordt niet geserialiseerd als machine/ICU state.
- De machine/ICU krijgt raw input state via de bestaande host input owner of een
  directe raw input boundary; geen high-level PlayerInput contract in de ICU.
- Vibration/output support blijft bij de host/device backend; ICU schrijft
  alleen raw output command words.

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
