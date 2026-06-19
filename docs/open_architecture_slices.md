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
- cart-zichtbare PICO-achtige data-lookup APIs zijn verwijderd:
  `rom_data`, `rom_data_field`, `rom_bin`, `system.rom_data`,
  `romdir.data*` en `bin.decode_path` bestaan niet meer. Carts krijgen
  ROM-payloads via build/link-symbolen en lezen daarna op absolute ROM-adressen.
- rompacker en IDE/source-compile genereren dezelfde `bmsx/assets` module met
  per-asset adres/lengte-symbolen. Dat houdt ROM-symbolen een build/link
  product in plaats van een runtime-directory of host-facade.
- compiler/linker symbolische module/function-relocs zijn TS/C++-parity:
  reloc-records dragen het symbool, executable const-pools krijgen geen
  `modslot:`/`exportproto:` placeholder strings als runtimewaarden.
- TS/C++ firmware runtime prelude voor system builtins is verwijderd; er is geen
  aparte `rom_data`/builtin-global bootstrap meer.
- `.bin` resources zijn raw ROM-assets; glTF buffer-URI's blijven eigendom van
  de glTF/model-importer en worden niet als losse cart-binary API gescand.

Actuele validatie voor de ROM/data/compiler-linker status:

- `npm run compile:machine -- --pretty false`
- `npm run test:lua` (`223` tests, `222` pass, `1` skipped)
- `npm run test:rompacker` (`58` pass)
- `npm run audit:core-parity`
- `npm run check:indent`
- `git diff --check`
- `npm run build:platform:libretro-wsl -- --force`
- `npm run headless:forcebuildalltest -- pietious tests/carts/pietious/pietious_enter_world_assert.lua`
- `npm run headless:forcebuildalltest -- nemesis_s tests/carts/nemesis_s/nemesis_s_stage_boot_assert.lua`
- `npm run ide:test -- pietious tests/ide/hot_resume_entry_edit.idetest.js`

Referentie-model voor verdere ROM/data-slices:

- ROM is memory-mapped, read-only cart/geheugenregio; cartcode leest bytes of
  typed structs op adressen.
- build/link vertaalt namen naar adressen/relocs; runtime doet geen
  string-directory lookup voor gameplay-data.
- hot-path code krijgt woorden, adressen, pointers en vaste layouts; Lua-tabellen
  zijn alleen acceptabel bij echte gameplay/authoring-semantiek, niet als ROM ABI.

Status na de laatste ROM/data-slice:

- `pietious` en `nemesis_s` draaien op echte cart-tests zonder `rom_data`.
- `castle_map` en `nemesis_s_stage` gebruiken nu `bmsx/assets` adres/lengte
  symbolen en `bin.decode(addr, len, id)`.
- De pure retro-route is aanwezig en getest via een `.bin` struct-ROM test.
- Nog niet afgerond: de twee gemigreerde legacy data-assets decoden nog
  structured/YAML payloads naar Lua-tabellen bij load. Dat is geen runtime
  lookup meer, maar het is ook nog niet de eindvorm voor echte retro-console
  data.

Cart-representatie roadmap/status:

| Punt | Status |
| --- | --- |
| echte `data`/`bss` secties | Deels: het image-format en de TS/C++ linker behouden `rodata`/`data`/`bss`; open: producers vullen `data`/`bss` nog niet als cart ABI voor static config, registries, prefab-data en initialized RAM. |
| één object-file/linker pipeline | Deels: program images hebben reloc-records en TS/C++ linkers; open: BIOS/system/engine/cart/source-compile/hot-resume moeten door exact dezelfde object → reloc → executable semantiek. |
| runtime relocaties als load/link stap | Deels: `module`/`export_proto` placeholders zijn uit runtimewaarden gehaald; open: harde verifier-gate voor alle executable images. |
| static module/data ABI | Deels: M2 call-targets kunnen link-time naar `CLOSURE(proto)`; open: expliciete static moduleklasse met functies, constants en rodata/data-symbolen zonder runtime module-table. |
| dynamic Lua-opcodes weren uit systems/static modules | Open: dit moet een compiler-contract worden, geen discipline of losse linter. |
| CPU objectwereld loshalen van machine-code ABI | Open: `CPU.Value` is nog Lua-objectwereld; echte cart ABI moet primair words, registers, addresses, memory, sections en symbols zijn. |
| assets/`rom_data` binair maken | Deels: `rom_data`-familie is weg en `.bin` raw ROM path is getest; open: maps, rooms, timelines, registries en asset records naar vaste binaire layouts. |
| cart startup/vector model | Open: entry/init/new_game/reinit/IRQ handlers moeten een expliciete vector/handler ABI krijgen in plaats van ad-hoc Lua global lifecycle. |
| verifier/audit voor echte carts | Deels: test/parity/rominspector-validatie bestaat; open: één harde cart-verifier voor relocaties, dynamic opcodes, data/bss mapping, source-only dependencies en hot-resume/ROM-build equivalentie. |

## 14. Legacy cart-data naar vaste binaire ROM-layouts

Doel: de resterende cart-data die nu nog als structured/YAML blob naar Lua-tabellen
wordt gedecodeerd, vervangen door producer-owned vaste binaire layouts die cartcode
direct via ROM-adressen, typed pointers en integer velden consumeert.

Open audit-evidence:

- `carts/pietious/castle/map.lua` leest `castle_map` via
  `bin.decode(assets.data_castle_map_addr, assets.data_castle_map_len, 'castle_map')`
- `carts/nemesis_s/stage.lua` leest `nemesis_s_stage` via
  `bin.decode(assets.data_nemesis_s_stage_addr, assets.data_nemesis_s_stage_len, ...)`
- `machine/firmware/system/bin.lua` bezit nog de structured payload decoder die
  Lua-tabellen produceert

Acceptatie:

- producer/rompacker emit voor deze assets vaste binaire layouts
- cartcode gebruikt `assets.*_addr`, `assets.*_len`, typed structs of directe
  `mem[]`-reads; geen Lua-table decode als ROM ABI
- asset-ID strings blijven alleen build/debug/diagnose metadata, niet de runtime
  toegangsmethode
- `pietious` en `nemesis_s` headless cart-tests blijven groen
- `rominspector.ts --program-asm` toont adres/lengte-symbolen en geen
  `rom_data`-familie of data-directory calls

## 15. ROM asset-symbol contract vastleggen als linker/ROM ABI

Doel: `bmsx/assets` is een gegenereerd build/link-contract, geen gewone cartlib
utility. Deze ABI moet expliciet blijven: symbolen verwijzen naar ROM-adressen en
lengtes binnen de geladen cart/overlay/system ROM-layout.

Status:

- rompacker injecteert `bmsx/assets` in cart builds
- IDE/source-compile injecteert dezelfde module op basis van de actieve ROM TOC
- echte cart-tests en IDE hot-resume test zijn groen

Open punten:

- documenteer het `bmsx/assets` symboolformaat bij het ROM/program image format
- voeg rominspector-output toe voor asset-symbolen zodat address/length contracts
  direct zichtbaar zijn zonder disassembly-grep
- voorkom dat toekomstige code `bmsx/assets` als handgeschreven cartlib-module
  of runtime registry behandelt

Acceptatie:

- één eigenaar voor het genereren van asset-symbolen
- rompacker, IDE source compile en hot-resume gebruiken dezelfde producer
- TS/C++ runtime hoeft geen asset-name lookup API te kennen
- tests bewijzen zowel ROM-build als IDE/source-compile gedrag

## 16. Compiler/linker reloc-contract zonder runtime placeholders

Doel: alle symbolische program-relocs blijven linkerdata tot ze zijn toegepast.
Placeholder strings mogen niet als runtimewaarden door optimizer, const-pool of
executable image lekken.

Status:

- `module` en `export_proto` relocs dragen symboolmetadata in het reloc-record
- TS en C++ loaders/linkers lezen en schrijven dezelfde reloc-vorm
- optimizer-paden die instructies herschrijven verwijderen de symbolische
  relocmetadata bij die instructie
- tests dekken dat oude markerstrings gewone strings zijn en niet als relocs
  worden geïnterpreteerd

Acceptatie:

- executable const-pool bevat geen `modslot:`/`exportproto:` linker-placeholders
  als intern linkerproduct
- TS/C++ linkerresultaat blijft parity voor text/rodata/data/bss/link metadata
- `npm run audit:core-parity` blijft groen
- `tests/rompacker/program_linker.const_reloc.test.ts` dekt runtime-resolve,
  full-link en optimizer-rewrite cases

## 17. Echte `data`/`bss` secties als cart-RAM ABI

Doel: `data` en `bss` zijn geen lege image-format belofte meer, maar echte
cart-RAM secties. ROM bevat immutable bytes; load/link initialiseert RAM-data en
zeroed bss; static runtime-data wordt niet als Lua-tabel gebouwd.

Status:

- image-format heeft `rodata`, `data` en `bss`
- TS/C++ linker behoudt en merge't `data`/`bss`
- producers gebruiken `data`/`bss` nog niet als primaire static-data ABI

Open audit-evidence:

- mapdata, registries, prefab-data en static config worden nog op meerdere
  plekken als Lua-tabellen geconstrueerd of uit structured data gedecodeerd
- `data`/`bss` hebben nog geen cart-zichtbare allocatie/symbooldiscipline

Acceptatie:

- compiler/rompacker kan initialized cart-data in `data` emitten
- compiler/rompacker kan zeroed mutable cart-state in `bss` reserveren
- linker mapt secties naar concrete RAM-adressen en emit symbolen/relocs
- carts consumeren `data`/`bss` via addresses/pointers/words, niet via
  runtime Lua-table construction
- TS/C++ loader/linker parity blijft groen

## 18. Eén object-file/linker pipeline voor BIOS, system, engine en cart

Doel: elk programma-onderdeel gebruikt dezelfde contractvorm:
object image → relocaties → gelinkt executable program. Ontwikkelmodus en
hot-resume mogen tooling zijn, maar mogen geen andere compile/link semantiek
hebben.

Status:

- program images dragen linkmetadata en reloc-records
- ROM-build en source-compile hebben nog aparte paden en lifecycle-eigenaren
- hot-resume compileert opnieuw, maar moet expliciet hetzelfde object/link-resultaat
  als de ROM-build produceren

Acceptatie:

- BIOS, system, engine, cart en generated modules worden allemaal als object
  modules behandeld
- één linkerpad produceert executable program state
- source-mode/IDE/hot-resume gebruikt dezelfde object/linker entrypoints als
  ROM-build
- geen `systemImage`/`cart` semantiek als compiler-special-case; verschillen
  zitten in input objecten, memory map en link script/layout
- tests vergelijken ROM-build en source/hot-resume output voor dezelfde cart

## 19. Static module/data ABI afmaken

Doel: naast M2 call-target exports komt er een expliciete static moduleklasse.
Static modules exporteren functies, constants en rodata/data-symbolen; ze hebben
geen runtime module-table identiteit.

Status:

- M2 call-targets kunnen direct naar `CLOSURE(proto)` linken
- gewone waardelezingen houden terecht Lua-semantiek
- static data/constants hebben nog geen complete module-export ABI

Acceptatie:

- moduleclass is expliciet: dynamic Lua module of static systems module
- static exports zijn linkbare symbolen: functies, constants, rodata/data/bss
  addresses en sizes
- namespace-als-waarde is voor static modules een compile-error
- dynamic modules blijven Lua-semantiek houden waar gameplay die lane expliciet
  kiest
- generated `bmsx/assets` past in dezelfde static-symbol ABI

## 20. Compiler-contract voor systems/static modules

Doel: hot/system cart code wordt niet door discipline snel gehouden. De compiler
garandeert voor systems/static modules dat dynamische Lua-runtime-opcodes niet
worden geëmit.

Verboden in systems/static modules:

- table-allocatie en table-dispatch op de ABI/hot path (`NEWT`, `GETT`, `SETT`
  en afgeleiden)
- closure-allocatie in steady-state code
- `VARARG`, dynamische concat/dispatch en runtime module-table escape
- impliciete data-parser of nested Lua-table construction voor ROM ABI

Acceptatie:

- module marker/klasse zit in compiler-semantiek
- compiler faalt de build wanneer systems/static modules dynamische opcodes
  emitten
- opcode-mix rapportage per module/proto is beschikbaar voor audit
- gameplay/dynamic lane blijft mogelijk, maar niet voor console ABI of hot path

## 21. CPU machine-code ABI loshalen van Lua-objectwereld

Doel: de cart-machine wordt primair een word/address/register/memory machine.
Lua-objecten blijven compiler/dev/dynamic-lane representaties, niet het fundament
van de systems cart ABI.

Status:

- `CPU.Value` ondersteunt nog Lua-objecten zoals tables, closures en strings
- huidige bytecode bevat nog Lua-VM opcodes naast low-level memory/register
  operaties
- systems-lane gebruikt al struct/pointer/memory-lowering, maar dat is nog geen
  primair machine-code ABI-contract

Acceptatie:

- systems/static code gebruikt words, registers, addresses, sections en symbols
  als primaire representatie
- Lua-object values komen niet voor in static ABI/hot modules
- dynamic Lua objectwereld is expliciet beperkt tot de dynamic gameplay lane
- TS/C++ CPU/linker/debugger tonen dezelfde machine-code representatie

## 22. Cart startup/vector model expliciet maken

Doel: cart lifecycle is een ROM/vector contract in plaats van losse Lua globals.
Entry, init, new_game/reinit en IRQ handlers zijn expliciete vectors of handler
symbols met vaste calling convention.

Status:

- runtime en tests gebruiken nog Lua lifecycle/global conventions
- IRQ/hardware-model bestaat, maar cart handler ABI is niet als vector table
  vastgelegd

Acceptatie:

- ROM/program metadata bevat entry/init/new_game/reinit/IRQ vector-symbolen
- linker resolve't vector-symbolen naar concrete proto/adres targets
- runtime start en interrupt-dispatch gebruiken vector table/calling convention
- hot-resume behoudt dezelfde vector ABI als ROM boot
- oude Lua-global lifecycle is geen console ABI meer

## 23. Harde verifier/audit voor echte retro-carts

Doel: "echte cart" is een checkbare invariant. Een cart die door de verifier komt
heeft geen PICO-style runtime lookup, geen onopgeloste linker-placeholders en
geen dynamische Lua-opcodes in systems/static modules.

Verifier-gates:

- geen onopgeloste reloc-text of placeholder strings in executable program state
- geen dynamic opcodes in systems/static modules
- `rodata`/`data`/`bss` correct gemapt en consistent met symbols/relocs
- TS/C++ linker/loader parity groen
- ROM bevat geen source-only runtime afhankelijkheden
- hot-resume/source-mode produceert hetzelfde object/link-resultaat als ROM-build
- rominspector toont concrete ROM/data symbols, vectors en section layout

Acceptatie:

- één projectscript voert de verifier op echte carts uit
- `pietious` en `nemesis_s` zijn onderdeel van de gate
- verifier-failures wijzen naar eigenaar: producer, compiler, linker, loader,
  runtime of cart data layout

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
