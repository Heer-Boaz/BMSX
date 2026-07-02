# Openstaande architectuur-slices

Baseline na de laatste boundary-slices:

```txt
architecture_boundary_issues,0
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
- cart-zichtbare `clock_now` en `os.clock` lopen via het `sys_time_ms`
  MMIO-register; default `os.time`/`os.date` en default
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
- TS debugger pause/suspension-state staat onder de Lua/debugger-laag in plaats
  van `ide/runtime`; IDE houdt alleen de workbench-clear action over.
- TS IDE-runtime state (`terminal`, `editor`, overlay renderer, IDE-font/input
  cadence en workbench fault-state) staat onder `ide/runtime`; machine runtime
  importeert geen IDE/workbench/editor modules meer. Source-boot/reboot/workspace-
  override/lua-pipeline orchestration staat bij `ide/runtime/program_boot` en
  `ide/runtime/lua_pipeline`; `core/MachineManager` doet alleen platform/render/
  audio bootsequencing rond die owner. Machine runtime houdt program/source-state,
  interpreter-install en machine boot primitives over.
- TS/C++ render/presentatie ownership is uit machine runtime/save-state gehaald:
  `Runtime` bezit geen `GameView` meer, machine save/resume code importeert geen
  render-context restore meer en render/view-context herstel zit bij host/IDE/core
  orchestration waar de render-owner beschikbaar is.
- `audit:architecture-boundaries:strict` staat op nul issues en kan weer als
  harde layer-gate draaien; de overgebleven open slices mogen geen nieuwe
  machine->host/render/IDE imports introduceren.
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
- `bmsx/assets` is een const module: standaard-Lua bron (`local <const>` +
  `return`-tabel), maar de compiler inlinet elke `assets.<symbol>` op de use-site
  als constante (`KSMI`/`LOADK`). De module krijgt geen proto, geen global slots,
  geen `require`-call en staat niet in `staticModulePaths`; er is geen runtime
  module-tabel meer. Geldt voor rompack, IDE/source-compile en hot-resume.
- compiler/linker symbolische module/function-relocs zijn TS/C++-parity:
  reloc-records dragen het symbool, executable const-pools krijgen geen
  `modslot:`/`exportproto:` placeholder strings als runtimewaarden.
- TS/C++ firmware runtime prelude voor system builtins is verwijderd; er is geen
  aparte `rom_data`/builtin-global bootstrap meer.
- `.bin` resources zijn raw ROM-assets; glTF buffer-URI's blijven eigendom van
  de glTF/model-importer en worden niet als losse cart-binary API gescand.

Actuele validatie voor de ROM/data/compiler-linker status:

- `npm run compile:machine -- --noEmit`
- `npm run audit:architecture-boundaries:strict` (`architecture_boundary_issues,0`)
- `npm run audit:core-parity`
- `npm run test:lua` (`295` tests, `294` pass, `1` skipped)
- `npm run test:rompacker` (`78` pass)
- `npm run build:platform:libretro-wsl -- --force`
- `npm run ide:test -- pietious tests/ide/hot_resume_entry_edit.idetest.js`
- `npm run ide:test -- bare_metal_cart tests/ide/bios_math.idetest.js`
- `npm run headless:forcebuildalltest -- pietious tests/carts/pietious/pietious_enter_world_assert.lua`
- `npm run headless:forcebuildalltest -- 2025 tests/carts/2025/2025_live_timeline_assert.lua`
- `npm run check:indent`
- `git diff --check`

Referentie-model voor verdere ROM/data-slices:

- ROM is memory-mapped, read-only cart/geheugenregio; cartcode leest bytes of
  typed structs op adressen.
- build/link vertaalt namen naar adressen/relocs; runtime doet geen
  string-directory lookup voor gameplay-data.
- Structured content kan nu al via bestaande JSON/YAML `data` assets naar ROM
  bytes. Het platform mist hier geen generieke producer-slice; een concrete
  schema-layout/reader voor story, maps of registries is asset-kind/cart-eigen
  werk tenzij meerdere carts hetzelfde schema als platformcontract delen.
- Geen `rom_asset()` of vergelijkbare runtime/string lookup-laag. Ook een
  compile-time functie met die naam is de verkeerde semantiek: het lokt
  asset-registries, module-root values en `.addr`/`.len` objecten uit. Gebruik
  platte link-symbolen.
- hot-path code krijgt woorden, adressen, pointers en vaste layouts; Lua-tabellen
  zijn alleen acceptabel bij echte gameplay/authoring-semantiek, niet als ROM ABI.

Status na de laatste ROM/data-slice:

- `pietious`, `nemesis_s` en `2025` draaien op echte cart-tests zonder `rom_data`.
- `castle_map`, `nemesis_s_stage` en `2025`'s `transition_config` gebruiken nu
  `bmsx/assets` adres/lengte symbolen en `bin.decode(addr, len, id)`; de adressen
  inlinen als constants op de use-site (const moduleklasse).
- De pure retro-route is aanwezig en getest via een `.bin` struct-ROM test.
- `castle_map`, `nemesis_s_stage` en `transition_config` decoden hun payload via
  `bin.decode` bij cart-init. Dat is een accepteerde eindvorm: het is een
  geheugen-read op een link-adres (geen runtime lookup), op een koud load-time
  pad, voor authoring/gameplay-data. Het format waarin een cart zijn data legt is
  een authoring-keuze, niet iets dat tooling mandateert. Zie de geschrapte
  slice 14.

Cart-representatie roadmap/status:

| Punt | Status |
| --- | --- |
| echte `rodata`/`data`/`bss` secties | Deels: BLua heeft nu typed `.bss`, `.rodata` en `.data` declaraties; `.bss` wordt door compiler-generated startup-code genuld, `.rodata` is CPU-leesbare immutable PROGRAM_ROM storage, en `.data` heeft RAM VMA + ROM LMA + startup-copy via gewone CPU-code. Open: brede cart-migratie en toekomstige complexere typed layouts buiten v1 primitive arrays. |
| één object-file/linker pipeline | Deels: program images hebben reloc-records en TS/C++ linkers; eerste install-seam staat nu in de program/linker-eigenaar (`inflateExecutableProgramImage`) voor object-image → executable program; gewone Lua source-boot, hot-resume en host-eval append lopen ook via de compiler-owned `ProgramImage` encoding; system+cart boot-entry selectie loopt via de program/linker-eigenaar (`linkBootProgramImages`) in TS en C++; ROM-build en source-compile zijn geaudit als legitieme input-producers die op dezelfde compiler/linker objectgrens convergeren, niet als resterende split-brain. |
| runtime relocaties als load/link stap | Deels: `module`/`export_proto` placeholders zijn uit runtimewaarden gehaald; open: harde verifier-gate voor alle executable images. |
| const module/data ABI | Deels: M2 call-targets kunnen link-time naar `CLOSURE(proto)` en de const-moduleklasse bestaat; const modules exporteren compile-time constants, `.bss`, `.data` en `.rodata` storage-symbolen en function call-targets zonder runtime module-table, global-slot lookup of `require`-call. Function exports mogen sibling exports aanroepen via `export_proto` link-symbolen; wanneer Lua-code een function export als waarde nodig heeft, materialiseert dezelfde `export_proto` naar een static closure in plaats van naar een runtime module-table. De scalar bios-util cohort (`bios/util/bool01`, `bios/util/clamp`, `bios/util/div_toward_zero`, `bios/util/rect_overlaps`, `bios/util/rol8` en `bios/util/round_to_nearest`) gebruikt root function modules; die functies worden als text-symbol/call-target gecompileerd en niet via runtime module-tables vervoerd. Open: verdere migratie per target/gap. |
| dynamic Lua-opcodes weren uit const-module function exports | Deels: static call-target scopes blokkeren runtime global loads/stores, runtime module slots, dynamic call targets en string constants bij de producer voordat die vormen als code worden geëmit; de post-codegen gate blijft alleen de invariant/backstop voor resterende dynamic Lua-opcodes (tables, closures, vararg, concat, object-length, en onverwachte global/module slots). Bewezen op de scalar bios-util cohort (`bios/util/bool01`, `bios/util/clamp`, `bios/util/div_toward_zero`, `bios/util/rect_overlaps`, `bios/util/rol8` en `bios/util/round_to_nearest`). Open: bredere target-migratie en audit-output zodra daar een echte consumer voor is. |
| runtime-magie uit manifesten en Lua libraries verwijderen | Deels: `math.*`, `easing.*`, `os.*`, core globals, `string.*` en `table.*` zijn uit de publieke machine-native surface gehaald en worden door BIOS Lua geleverd; de CPU houdt alleen verborgen boot-primitives die vóór cart-code worden gewist. `require(...)` is opnieuw alleen een compile-time importvorm: de compiler verlaagt literal imports naar static module initialization en module-export slot loads; er is geen runtime `require` global en geen `__bmsx_require` boot primitive. Gesloten: `machine_manifest`/`cart_manifest`, de oude firmware const-module en de raw `sys_*`/device-ABI globals zijn uit guest Lua weg; firmware/cart-code programmeert hardware met directe MMIO-registerwoorden of owner-owned BIOS/system/cartlib API's. Cartmanifesten zijn packaging/header input, niet live hardware API; Lua library gedrag hoort in BIOS Lua of in een echte taalprimitive van de dynamic Lua objectwereld. |
| CPU objectwereld loshalen van machine-code ABI | Deels: `CPU.Value` is nog Lua-objectwereld, maar const-module function call-targets in de scalar bios-util cohort (`bios/util/bool01`, `bios/util/clamp`, `bios/util/div_toward_zero`, `bios/util/rect_overlaps`, `bios/util/rol8` en `bios/util/round_to_nearest`) gebruiken nu scalar word/bool calls via link-time `export_proto` zonder runtime module-table, global-slot, dynamic-call of string-object transport; waar Lua een function value nodig heeft, materialiseert diezelfde link naar een static closure. Open: bredere migratie naar words, registers, addresses, memory, sections en symbols als primaire ABI. |
| assets/`rom_data` binair maken | Deels: `rom_data`-familie is weg en `.bin` raw ROM path is getest; open: maps, rooms, timelines, registries en asset records naar vaste binaire layouts. |
| cart startup/vector model | Deels: `ProgramImage` draagt nu een expliciete vector table (`resetProtoIndex`, `sectionInitProtoIndex`, `irqProtoIndex`) en TS/C++ linker/runtime boot gebruiken die vector table in plaats van losse entry/section-init velden. `init()`/`new_game()` zijn bewust cartfuncties, geen console-ABI: de lifecycle-IRQ-transportlaag is verwijderd, cold cart startup roept ze direct aan en hot-resume voert alleen `init()` als IDE/debugger-call uit. Hardware IRQ's vectoren bij `HALT` en guest instruction boundaries naar cartcode die `irq(flags)` dispatcht en owned masks ackt; gemigreerde carts gebruiken ISR-latches in plaats van post-HALT polling als dispatchpad. `IRQ_MASK` is de cart-facing per-source vector-maskerlaag; de CPU-global maskable state is alleen interne handler-serialisatie. Open: NMI blijft buiten scope tot er een echte producer is. |
| verifier/audit voor echte carts | GESCHRAPT in deze vorm: een los retro-cart verifier-script is een slechte slice. De echte gates horen bij de producer/linker/compiler/runtime-eigenaren zelf, niet in een achteraf-scanner die ROMs opnieuw interpreteert. |

## 24. Console-model registry: device-classes en region-switch

Doel: een console-model bestaat uit **vaste hardware** (RAM, VRAM, CPU-clock,
BIOS-default) plus een set **omwisselbare device-classes** — te beginnen de
**VDP-class**, met de **APU-class** als geanticipeerde tweede. Elke device-class
draagt zijn eigen **operations/second** (throughput) en programmeermodel. De
model-registry wordt de enige bron voor die waarden; cart- en system-manifests
stoppen met losse hardware-knoppen. **Nu wordt alleen het `psx`-model + de `psx`
VDP-class ondersteund**; de `bmsx` (tile/sprite) VDP-class is een schone seam
voor later, niet gebouwd. Region (50/60 Hz) blijft gedeelde, runtime-switchbare
timing.

Waarom deze vorm:

- Het verschil tussen een MSX-achtige en een PSX-achtige console zit primair in
  het **VDP-programmeermodel** (tile/sprite/nametables vs framebuffer/geometry/
  3D), niet in de hele machine. Modelleer dat verschil dus als een **device-
  class**, niet als een aparte CPU/core.
- Daardoor is backward-compat **goedkoop**: een high-end machine *heeft beide
  VDP-classes*; de cart-marker kiest welke class hij programmeert; CPU/geheugen
  zijn gedeeld. Geen tweede core, geen per-core-BIOS, geen dure compat-matrix.
- RAM/VRAM/CPU-clock zijn **vast per model** — niet configureerbaar, niet
  per-unit variabel (de MSX-fragmentatie-valkuil die een fantasy console juist
  vermijdt).

Dit supersedet de eerste foundation (commit `72c6ba9f0`): de
`getMachineFamilyProfile`-vorm splitst in **model** (vaste RAM/VRAM/CPU) +
**device-class** (ops/sec); de `MachineFamily {Bmsx,Bsx}`-enum wordt de
VDP-class/device-class-as en wordt `psx` benoemd. Alleen `psx` gepopuleerd; de
bmsx-tak blijft een lege, gedocumenteerde seam.

Structuur:

- **Model** (vast, gekeyd op model-id): `cpu_freq_hz`, `ram_bytes`, `vram`
  (`slot`/`staging`/`system_slot`), `bios_vdp_mode`, `dma`/`imgdec`-rates,
  plus welke device-classes het heeft.
- **Device-class** (omwisselbaar): een benoemde class met zijn eigen ops/sec en
  programmeermodel-identiteit.
  - VDP-class `psx`: framebuffer/3D, `work_units_per_sec` + `geo_work_units_per_sec`.
    (VDP-class `bmsx` = tile/sprite — seam, nog niet gebouwd.)
  - APU-class: geanticipeerd als tweede omwisselbare class (audio ops/sec), nog
    niet gebouwd.
- **VDP-mode-tabel** (binnen de `psx` VDP-class): mode `0` = MSX1
  256×192, mode `1` = MSX2 256×212, mode `2` = PSX 320×240.
  De mode is VDP-register/state die door cart/firmware-startup expliciet wordt
  geprogrammeerd; manifests dragen geen `vdp_mode` en geen losse `render_size`.
- **Region-timing-tabel** (gedeeld, runtime-switchbaar): `pal` = 50 Hz/313,
  `ntsc` ≈ 59,94 Hz/262.

Region als runtime-state:

- Region is geen modelkenmerk maar machine-runtime-state. **Region-switch-ABI**:
  het `sys_region`-MMIO-register (woorden `sys_region_pal=0`,
  `sys_region_ntsc=1`, analoog aan V9938 R#9 N/PAL) dat refresh +
  total_scanlines live wisselt via de timing-owner (`applyUfpsScaled` +
  `setFrameTiming`).
  Power-on default `pal` (50 Hz). `ntsc` = `60000/1001 ≈ 59,94 Hz` (scaled
  `59_940_060`), niet exact 60. De `resolveTotalScanlines(ufps)`-inferentie
  (`PAL_NTSC_REFRESH_CUTOFF_SCALED`) vervalt; total_scanlines komt uit de
  region-state, die in de save-state hoort.

Cart-marker (ROM-header):

- De cart draagt een **VDP-class-marker** in de ROM-header (de bestaande
  `BMSX`-magic `CartRomHeader`) — het ROM-image-equivalent van de cart-type-byte
  die een echte console leest (Game Boy CGB-flag `$0143`). De **boot-ROM leest de
  marker** en selecteert de VDP-class die de cart programmeert.
- **Effectieve class** = f(welke classes de machine heeft, cart-marker). Een
  machine die de class niet heeft → harde "incompatibele cartridge"-fault. Nu
  (alleen `psx`) krijgt elke cart de `psx`-class.
- Class-selectie is **boot/header-time** (de boot-ROM leest de marker bij
  insert), te onderscheiden van de runtime VDP-*modes* (SCREEN-stijl) bínnen een
  class. Of class-switching óók runtime moet kunnen, is een open vraag voor
  wanneer de tweede class landt — moot zolang alleen `psx` bestaat.
- De marker is een header-veld, geen nieuwe taal/preprocessor. Code-divergentie
  (een tweede VDP-class met eigen firmware) is graphics-workstream-werk via
  link-time module/image-selectie, niet `#ifdef` (zie slices 16/18/19/20).

Model-registry (nu; alleen `psx`):

| laag | veld | psx |
| --- | --- | --- |
| model | cpu_freq_hz | 50 MHz |
| model | ram_bytes | 128 MB |
| model | vram slot/staging/system_slot | 160/40 MB |
| model | imgdec/dma rates | huidige defaults |
| model | bios_vdp_mode | 2 (`psx`) |
| VDP-class `psx` | work_units_per_sec / geo_work_units_per_sec | huidige VDP/GEO-rates |
| VDP-mode 0 | MSX1 | 256×192, MSX1 kleurcontract |
| VDP-mode 1 | MSX2 | 256×212, MSX2 kleurcontract |
| VDP-mode 2 | PSX | 320×240, PSX kleurcontract |
| region (gedeeld) | pal / ntsc | 50 Hz/313 · 59,94 Hz/262 |

Cart-manifest na de cleanup:

```yaml
machine:
    vdp_class: psx        # ROM-header-marker; nu de enige ondersteunde class
    namespace: 'pietsona2025'
lua:
    entry_path: cart.lua
```

`namespace`, `lua.entry_path` en cart-metadata blijven cart-eigen. VDP-mode is
niet cart-manifest-eigen: de cart/firmware programmeert de VDP-mode zelf via de
VDP-register/MMIO-ABI tijdens startup. Render-size volgt uit de live VDP-mode en
hoort niet als Lua-manifestveld te bestaan.

Afgeronde follow-up (24.1b): `machine_manifest` en `cart_manifest` zijn uit
guest Lua weg. De ROM/header blijft packaging-input; de cart owner zet de
VDP-mode zelf via het VDP-mode MMIO-register. De live zichtbare dimensies komen
uit het VDP-owned screen-size registerwoord; firmware leest dat register direct via
het MMIO-adres in de VDP/system owner.

Cart-migratie-ledger (alle carts → `psx`-model; power-on region `pal`/50 Hz):

| cart | nu (cpu) | model | delta |
| --- | --- | --- | --- |
| pietious / nemesis_s | 5–10 MHz | psx; cart programmeert VDP-mode 0 | cpu → 50 MHz; 256×192 uit live VDP-mode 0 |
| emptycart / vblanktest / renderhwtest | 5–10 MHz / test | psx; cart programmeert VDP-mode 1 | 256×212 uit live VDP-mode 1 |
| 2025 / bare_metal_cart / fade_probe | 50 MHz / test | psx; cart programmeert VDP-mode 2 | 320×240 uit live VDP-mode 2 |

- **Verificatiepunt**: carts die nu < 50 MHz draaien krijgen de vaste psx-clock
  van 50 MHz — dat is een groter **cycle-budget per frame**, geen snellere
  gameplay: de frame-rate blijft pal/50 (refresh, niet cpu, bepaalt fps). Zolang
  carts hun logica uit `sys_time_ms`/scheduler-tijd halen i.p.v. cycle-counts,
  verandert wall-clock-timing niet. Controleer met de headless asserts.

System/BIOS-ROM-consolidatie (doel): vandaag dragen cart- én system-manifest
hardware-specs (`resolveRuntimeMemoryMapSpecs` combineert ze). Het model wordt de
enige bron; `system_slot_bytes` + `bios_vdp_mode` worden modelvelden, de
VDP-ops/sec horen bij de VDP-class en render-size hoort bij de live VDP-mode; de
system-firmware draait op het model. De
system-manifest levert geen onafhankelijke hardware-specs meer;
`SYSTEM_MACHINE_MANIFEST` (`machine/ts/core/system.ts`) stopt met het hardcoden
van 256×212 + 1 MHz en gebruikt model-clock; firmware programmeert de VDP-mode zelf.

Dev-override escape hatch: testharnassen die bewust niet-hardware-specs willen
booten op een expliciet gelabelde override-machine buiten de registry, geweigerd
voor echte cart-builds.

Sub-slices:

- 24.1 — registry met de **model + device-class**-structuur (één model `psx`, één
  VDP-class `psx`); ROM-header VDP-class-marker; vaste RAM/VRAM/CPU per model;
  ops/sec bij de VDP-class; VDP-mode-tabel 0/1/2 als VDP-registercontract;
  region als runtime-state + switch-ABI (default pal);
  `resolveTotalScanlines`-inferentie weg; system-consolidatie + `bios_vdp_mode`;
  alle carts → `psx` + startup-code die een concrete VDP-mode programmeert; dev-override. De device-class-abstractie wordt mét één class
  gebouwd, maar de seam (extra VDP-class, APU-class) is echt.
- 24.2 (graphics-workstream) — bouw de **`bmsx` tile/sprite VDP-class** + het
  `bmsx`-model; de marker selecteert de class; backward-compat = de machine biedt
  beide VDP-classes (gedeelde CPU/geheugen). Hier landt de echte
  capability-divergentie en, indien gewenst, de PAL/NTSC zichtbare-lijnen-mode.
- 24.x — **APU-class** als tweede omwisselbare device-class (audio ops/sec),
  zodra er een producer voor is.

Acceptatie (24.1):

- registry heeft de **model (vast: cpu/ram/vram/bios_render/dma/imgdec) +
  device-class (ops/sec)**-structuur; alleen `psx`-model + `psx`-VDP-class
  gepopuleerd; de seam voor extra classes is expliciet
- de cart-marker (ROM-header) benoemt de VDP-class; een niet-ondersteunde of
  onbekende class is een harde boot-fault; nu krijgt elke cart `psx`
- region is runtime-state met een switch-register (default pal/50 Hz);
  `resolveVblankCycles` gebruikt region-`total_scanlines`; de 55 Hz-inferentie +
  `PAL_NTSC_REFRESH_CUTOFF_SCALED` zijn weg; region-state zit in de save-state;
  `ntsc` = `59_940_060`
- gemirrorde TS/C++ registry (model + device-class + region-tabel); parity
  (waarde + shape) groen
- cart-/system-manifest dragen geen `ufps`/`specs.*`, `vdp_mode` of losse `render_size` meer;
  `system_slot_bytes` + `bios_vdp_mode` uit het model, VDP-ops/sec uit de
  VDP-class, render-size uit de live VDP-mode; de BIOS programmeert de mode i.p.v.
  hardcoded 256×212/1 MHz
- alle carts → `psx` + expliciete VDP-mode-programmering in startup-code; cpu normaliseert naar 50 MHz
  (groter cycle-budget, gelijke fps); refresh blijft pal/50; geverifieerd met de headless asserts (pietious +
  2025) en bare-metal IDE asserts
- gates: `npm run compile:machine -- --noEmit`, `npm run audit:core-parity`,
  `npm run test:lua`, `npm run test:rompacker`, headless asserts (pietious +
  2025), `npm run check:indent`, `git diff --check`

## 14. Legacy cart-data naar vaste binaire ROM-layouts — GESCHRAPT

Verworpen; geen open slice meer. De winst die ertoe deed is al binnen: geen
PICO-achtige runtime string-lookup, data-toegang via `bmsx/assets` link-symbolen
op absolute adressen, en `bin.decode(addr, len, id)` is een geheugen-read op ROM —
geen lookup-facade.

Wat slice 14 daarbovenop wilde — het *format* van de payload omzetten naar
producer-owned vaste binaire layouts — heeft geen platform-rechtvaardiging:

- De doel-assets (`castle_map`, `nemesis_s_stage`, `transition_config`) decoden
  één keer bij cart-init. Dat is een koud load-time pad; het format maakt geen
  meetbaar verschil.
- Het is authoring/gameplay-data met geneste, variabel-lengte vorm — precies de
  carve-out die dit document zelf vrijstelt (zie referentie-model: Lua-tabellen
  acceptabel bij echte gameplay/authoring-semantiek).
- Capability vs. mandate: de tooling levert al de primitieven voor wie fixed
  layouts wíl (`.bin` raw-ROM struct-pad + displaced load/store-opcodes, getest).
  Het *format* waarin een cart zijn data legt — en of die data hot is — is een
  authoring-keuze van de cart-author, niet iets dat runtime of tooling mandateert
  of preventief omzet.

Er is dus geen hot-path- of section-voorwaarde die deze slice later doet
herleven. Als een concrete asset ooit in `data`/`bss` moet leven, ontstaat dat
binnen slice 17 als capability-werk, niet als format-conversie van bestaande
carts.

## 15. ROM asset-symbol contract vastleggen als linker/ROM ABI

Doel: `bmsx/assets` is een gegenereerd build/link-contract, geen gewone cartlib
utility. Deze ABI moet expliciet blijven: symbolen verwijzen naar ROM-adressen en
lengtes binnen de geladen cart/overlay/system ROM-layout.

Status:

- rompacker injecteert `bmsx/assets` in cart builds
- IDE/source-compile injecteert dezelfde module op basis van de actieve ROM TOC
- echte cart-tests en IDE hot-resume test zijn groen

Afgerond binnen deze slice:

- `bmsx/assets` kan niet meer als runtime registry/cartlib-module gedragen worden:
  het is een const moduleklasse die op de use-site naar constants inlinet en geen
  runtime module-table, proto of global slots meer heeft. De hele module als
  waarde gebruiken is een compile-error (module-root misuse).
- `rominspector.ts --asset-symbols` toont dezelfde generated ROM-symbolen
  direct als `symbol/type/asset/payload/address/length`, zonder disassembly-grep.
- `docs/architecture.md` legt het `bmsx/assets` symboolformaat vast als
  compile/link ABI: `<asset-type>_<asset-id>_{addr,len}` met absolute
  CPU-zichtbare ROM-adressen en byte-lengtes.
- ROM-pack build verifieert dat de gegenereerde `bmsx/assets` adressen exact
  overeenkomen met de uiteindelijke TOC ranges; layoutdrift faalt de build.

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

## 17. BLua section-model met `.bss`, `.rodata` en `.data`

Doel: het section-model onderscheidt `.rodata`, `.data` en `.bss`. `.rodata` is
immutable CPU-leesbare ROM-storage; `.data` is mutable RAM-storage met een
ROM-load-image; `.bss` is mutable zeroed RAM-storage zonder load-image. De
uitgevoerde increments bewijzen alle drie de storage-klassen: BLua declareert
`.bss` voor zeroed RAM, raw `.rodata` voor immutable PROGRAM_ROM bytes en
`.data` voor initialized mutable RAM. De linker wijst concrete VMA/LMA adressen
toe; startup-code kopieert `.data` en nult `.bss` als gewone CPU-code. De
emulator/runtime parse't geen secties en initialiseert geen cart-data namens
het spel. Dit is geen rompacker-conversie van JSON/YAML assets en geen generic
content-serializer.

Status:

- `.bss` v1 is geïmplementeerd in TS en C++: BLua accepteert `bss name: Type`
  declarations, de compiler reserveert typed zeroed RAM, en het object-image
  draagt `.bss` symbols plus `bss_addr` const-value relocaties
- linker/inflate resolven `.bss` symbolen naar concrete RAM VMA's;
  single-image install krijgt expliciete static-RAM bases en bij een system+cart
  link krijgt de cart `.bss` een VMA na de gelinkte `.data` en system `.bss`
- de compiler genereert een static section-init proto; cold boot draait die proto
  vóór static module initializers en user entry, zodat `.data` copy en `.bss`
  zeroing gewone CPU/memory-instructies zijn en geen runtime/installer
  section-parser
- hot-resume geeft expliciet geen section-init proto door en reïnitialiseert live
  cart-RAM dus niet
- raw BLua-declared `.rodata` byte storage is geïmplementeerd in TS en C++:
  `rodata name: Type = ...` emit primitive typed ROM bytes, `.rodata` symbols en
  `rodata_addr` const-value relocaties. De CPU-memory map expose't text + raw
  `.rodata` als PROGRAM_ROM, terwijl de CPU alleen de text-section als
  instructies decodeert
- de bestaande VM constPool/module metadata blijft gescheiden van raw `.rodata`
  bytes; assets blijven ook gescheiden ROM-payloads met hun eigen symbolen
- `.data` v1 is geïmplementeerd in TS en C++: `data name: Type = ...` emit
  primitive typed init-bytes, `.data` symbols, `data_addr` VMA-relocs en
  `data_lma_addr` ROM-relocs. Program ROM bevat text + `.rodata` + `.data`
  init-image; cold startup-copy leest de LMA via de memory map en schrijft de VMA
- linker/inflate weigeren static-RAM ranges die buiten RAM vallen en PROGRAM_ROM
  ranges die buiten de ROM-window vallen

Open audit-evidence:

- static mutable state en persistent scratch storage worden nog vaak in
  Lua-objecten of handgekozen `mem[...]` ranges gelegd; nieuwe code kan nu naar
  compiler-toegewezen `.bss`, maar carts zijn nog niet breed gemigreerd
- immutable typed lookup tables kunnen nu naar compiler-toegewezen `.rodata`,
  maar carts zijn nog niet breed gemigreerd
- `.data` v1 is primitive typed storage; complexere layouts of contentgraphs
  blijven asset/schema-eigen werk en niet de compiler zijn generieke taak

Acceptatie:

- BLua heeft expliciete declaraties voor zeroed cart-RAM (`.bss`), immutable
  PROGRAM_ROM storage (`.rodata`) en initialized mutable RAM (`.data`) met typed
  size/alignment
- de compiler emit `.bss` reservations, `.rodata` bytes en `.data` init-bytes
  met linkbare symbolen voor die declarations
- linker wijst `.data` RAM VMA's, `.data` ROM LMA's, `.bss` RAM VMA's en
  `.rodata` PROGRAM_ROM LMA's toe en resolved de symbols naar concrete adressen
- BLua-startup/proloog voert section init uit als cartcode: copy `.data`, zero
  `.bss` vóór de user entry; runtime/rompacker doen dit niet
- BLua-startup/proloog draait vóór static module initializers die section-symbolen
  kunnen raken, of static initializers worden onderdeel van de startup-flow:
  section init → static module init → user entry
- `.rodata` is raw storage, gescheiden van de bestaande VM constPool/module
  metadata en gescheiden van asset blobs
- `.data` LMA bytes zijn echt onderdeel van de memory-mapped PROGRAM_ROM image,
  niet alleen `ProgramImage` metadata
- BLua code consumeert `.bss`/`.data`/`.rodata` via addresses/pointers/words, niet via
  runtime Lua-table construction of asset-decoder calls
- TS/C++ loader/linker parity blijft groen

## 18. Eén object-file/linker pipeline voor BIOS, system, engine en cart

Doel: elk programma-onderdeel gebruikt dezelfde contractvorm:
object image → relocaties → gelinkt executable program. Ontwikkelmodus en
hot-resume mogen tooling zijn, maar mogen geen andere compile/link semantiek
hebben.

Status:

- program images dragen linkmetadata en reloc-records
- TS/C++ program/linker bezit nu de eerste install-boundary:
  `inflateExecutableProgramImage` inflate een `ProgramImage` naar runtime
  `Program` en past object-relocs toe vóór CPU-install
- TS `bootProgramImage`/`bootSystemSourceProgram` en C++ `Runtime::boot`
  gebruiken die program/linker-eigenaar voor object-image install
- gewone TS Lua source-boot en hot-resume compileren eerst naar `ProgramImage`
  via de compiler-eigenaar (`encodeCompiledProgramImage`) en installeren daarna
  via dezelfde executable install-boundary; IDE/runtime live paths bezitten die
  ruwe reloc-resolve stap niet meer
- host-eval append voegt alleen executable bytecode/protos toe aan de actieve
  `Program`, resolvet alleen de appended code-relocs in de program-eigenaar, en
  behoudt de bestaande memory-mapped PROGRAM_ROM bytes en text/ROM split zodat
  live-eval code geen ROM-section adressen kan verschuiven
- system+cart link-orchestratie bezit nu in TS en C++ ook de boot-entry selectie
  (`linkBootProgramImages`); runtime boot-code vraagt de program/linker-eigenaar om
  het concrete linked boot image in plaats van zelf system/cart entrypaden te kiezen
- ROM-build en source-compile zijn verschillende input-producers, maar geen
  resterende pipeline-ziekte: ROM-build bezit resource-scan/asset layout/stripping en
  generated const-modules; source-compile bezit workspace/overlay/live-source input.
  Beide leveren via `compileLuaChunkToProgram` + `encodeCompiledProgramImage` een
  `ProgramImage` met reloc-records aan dezelfde linker/install-boundaries.

Acceptatie:

- BIOS, system, engine, cart en generated modules worden allemaal als object
  modules behandeld
- één linkerpad produceert executable program state
- source-mode/IDE/hot-resume gebruikt dezelfde compiler-owned `ProgramImage` en
  program/linker install-entrypoints als ROM-build
- geen `systemImage`/`cart` semantiek als compiler-special-case; verschillen
  zitten in input objecten, memory map en link script/layout
- tests bewaken de eigenaar-boundaries: ROM/source/hot-resume/host-eval installeren via
  `ProgramImage` en runtime boot gebruikt `linkBootProgramImages` voor linked boot
  targets

## 19. Const module/data ABI afmaken

Doel: naast M2 call-target exports wordt de const-moduleklasse de expliciete
static/data ABI. Const modules exporteren functies, constants en rodata/data-symbolen;
ze hebben geen runtime module-table identiteit.

Status:

- M2 call-targets kunnen direct naar `CLOSURE(proto)` linken
- gewone waardelezingen houden terecht Lua-semantiek
- const moduleklasse bestaat: een module in `constModulePaths` exporteert compile-time
  constants, `.bss`/`.data`/`.rodata` storage-symbolen en top-level function
  exports; elke value-export wordt op de use-site geïnlined (`KSMI`/`LOADK`,
  `bss_addr`, `data_addr` of `rodata_addr` const-value reloc), en function exports linken via
  het bestaande `export_proto`
  pad naar static closures zonder module-tabel, global-slot lookup of
  `require`-call. De module heeft geen module-proto of `staticModulePaths`-entry.
  `bmsx/assets` gebruikt dezelfde klasse voor ROM asset-symbol constants. De
  module/export-contractanalyse is uit de bytecode-emitter gehaald en leeft in
  de program/module-contract eigenaar; de compiler consumeert dat contract bij
  storage-reservering en use-site-emissie.
- klaar als static storage increment: const modules kunnen `bss`, `data` en
  `rodata` storage declareren en `return { name = name }`; de compiler
  reserveert storage of init-bytes, exporteert adressen als link-symbolen en
  cold startup voert de benodigde `.data` copy / `.bss` zero uit via de
  bestaande section-init proto
- klaar als eerste function-export increment: const modules kunnen top-level
  `local function` / `local <const> = function` exports aanbieden; de compiler
  compileert die als 0-upvalue static closures en weigert module-local captures
  of externe const-module function exports. Function exports mogen module-level
  `<const>` waarden gebruiken; sibling calls naar geëxporteerde
  functies loweren naar `export_proto` link-symbolen in plaats van
  runtime upvalues. Function exports als waarden lezen gebruikt dezelfde link-symboliek: de linker materialiseert een static closure, zodat gewone Lua function-value semantiek behouden blijft zonder runtime module-table of wrapper.
- klaar als eerste static opcode-contract increment: const-module function
  protos worden na codegen/optimalisatie geweigerd wanneer table allocatie of
  dispatch, runtime closure allocatie, vararg of dynamische concat overblijft.
- klaar als scalar function-export cohort increment: `bios/util/bool01`,
  `bios/util/clamp`, `bios/util/div_toward_zero`,
  `bios/util/rect_overlaps`, `bios/util/rol8` en
  `bios/util/round_to_nearest` zijn root function modules. Een module die een
  bare function retourneert kan daarmee een static call-target module zijn: de
  compiler leidt de call-target af uit de producer-local return-vorm en het
  const-module contract, niet uit een module-padlijst of extra keyword. Dezelfde
  export blijft ook als Lua function value bruikbaar; `require('...')` voor root function modules en table fields die zo'n export
  opnemen materialiseren een static closure via `export_proto` in plaats van
  een wrapper of host-call. Bestaand runtime `system.*` / prelude-global
  transport is verwijderd; consumers importeren de systeem-symbolen direct en
  linken via `export_proto`.
- open: verdere migratie per target/gap buiten de eerste scalar function-export cohort
- geen doel: diepe contentgraphs als Lua const-aggregaten naar rodata-bytes
  verlagen. Dat is content-packaging en hoort bij een
  schema-specifieke asset-producer.

Acceptatie:

- const-module ABI is declaratie-gedreven: dynamic Lua modules blijven runtime
  modules, generated const-symbol modules blijven compiler-input, BLua const
  modules declareren function text-symbol/call-targets zonder module-padlijst
  of extra keyword, en een bare-function module-return is expliciet dezelfde
  static call-target vorm zonder Lua function-value semantiek te verwijderen
- const-module exports zijn linkbare symbolen: functies, constants, `.bss`, `.data`
  en `.rodata` addresses (klaar voor const modules), plus later sizes wanneer
  een echte consumer die nodig heeft
- namespace-als-waarde is voor const modules een compile-error (klaar voor de
  const module: de hele `bmsx/assets`-tabel als waarde gebruiken faalt compile-time)
- dynamic modules behouden hun Lua-table semantiek waar gameplay die lane expliciet
  kiest, maar `require(...)` zelf blijft compile-time: de runtime voert geen
  module lookup-functie uit.
- generated `bmsx/assets` past in dezelfde static-symbol ABI (klaar: const module)
- const-module `.bss`/`.data`/`.rodata` export heeft geen runtime module-table, geen asset
  lookup en geen content-serializer; het is gewoon object-storage met een
  link-time address symbol

## 20. Compiler-contract voor const-module function exports

Doel: hot/system cart code wordt niet door discipline snel gehouden. Zodra BLua
een const-module function export declareert, garandeert de compiler voor die text-symbol
call-target dat dynamische Lua-runtime-opcodes niet worden geëmit. Dit is geen
losse linter en geen cart-specifieke stijlregel; de gate hangt aan de compiler-
representatie die werkelijk wordt gelinkt.

Verboden in const-module function exports:

- table-allocatie en table-dispatch op de ABI/hot path (`NEWT`, `GETT`, `SETT`
  en afgeleiden)
- runtime closure-allocatie in steady-state code
- `VARARG`, dynamische concat/dispatch en runtime module-table escape
- impliciete data-parser of nested Lua-table construction voor ROM ABI

Status:

- eerste increment klaar voor const-module function exports: na codegen en
  optimalisatie controleert de compiler het daadwerkelijke InstructionSet van
  elke export-proto en weigert table allocatie/dispatch, runtime closure
  allocatie, vararg en dynamische concat. Dit is geen linter over source-stijl:
  alleen opcodes die na optimalisatie in het static proto overblijven tellen.
- eerste function-export scalar-cohort klaar: `bios/util/bool01`,
  `bios/util/clamp`, `bios/util/div_toward_zero`,
  `bios/util/rect_overlaps`, `bios/util/rol8` en
  `bios/util/round_to_nearest` compileren via hun root function module shape:
  `return function(...) ... end` is een static call-target contract en blijft
  tegelijk als Lua function value materialiseerbaar. Deze modules worden
  door cart-consumers via `export_proto` naar system const-module protos gelinkt,
  en de opcode-contract gate faalt op een module die dynamische table-opcodes
  emit.
- eerste `.rodata`-backed math helper klaar: `bios/util/sincos_turn32` is een
  gewone BLua const-module export met een zichtbare `rodata sin_quarter_lut:
  word[257]` quarter-wave table en integer quadrant-reconstructie. De naam is
  geen intrinsic: compiler, CPU, interpreter en devices kennen `sincos_turn32`
  niet. Output is het bestaande signed Q16.16 fixed-point formaat; input is een
  32-bit binary turn. `bare_metal_cart` gebruikt deze route voor zijn model-yaw;
  alleen de RPU f32-constant boundary schaalt de Q16.16 uitkomst naar f32.
- dynamic gameplay modules blijven buiten deze gate; de gate hangt aan de
  function export/text-symbol ABI en de bestaande const-module storage/value ABI.
- runtime table-modules kunnen hun Lua API-table behouden terwijl no-upvalue
  exported functions via `export_proto` als linkbare sibling-call targets worden
  gebruikt. `bios/easing` gebruikt die vorm: `easing` blijft een gewone globale
  Lua table voor API-compatibiliteit, maar literal imports zoals
  `require('bios/easing').fn` worden compile-time naar concrete function protos
  of module-export slots verlaagd.
- open: volgende targets blijven gap-gedreven: verdere fixed-point math helpers
  blijven gewone BLua modules met ROM-data en integercode; local scratch
  aggregates, typed-pointer calling convention en audit-output per module/proto
  komen pas wanneer een concrete function-export migratie ze nodig heeft.

Acceptatie:

- module-padlijsten en fake module markers zijn niet de ABI: de compiler-semantiek
  komt uit het const-module contract en de root function modulevorm; const
  modules blijven compiler-input voor generated symbol modules
- compiler controleert de uiteindelijke geoptimaliseerde protos van const-module
  function exports en faalt de build wanneer verboden dynamische opcodes
  overblijven (klaar voor const-module function exports)
- opcode-mix rapportage per module/proto is beschikbaar voor audit (open)
- gameplay/dynamic lane blijft mogelijk, maar niet voor console ABI of hot path
- firmware trig gebruikt geen compiler-known namen, host `Math.*`, nieuwe opcode
  of native builtin in de runtime; `bios/util/sincos_turn32` is een root
  function module met `.rodata` en normale integer/pointer instructies
- de guest `math` API wordt door `bios/math.lua` geleverd en `easing` door
  `bios/easing.lua`; de machine-native TS/C++ `math.*` en `easing.*`
  callbacktabellen zijn verwijderd zodat shipped guest-code niet meer via host
  `Math.*`/`std::*` rekent
- `math.sin`, `math.cos` en `math.tan` hebben het firmware-LUT/Q16.16
  precisiecontract; exacte turn-singulariteiten leveren de normale Lua
  numerieke infinity op, terwijl bijna-singuliere radian inputs eindig blijven
- de guest `os` API wordt door `bios/os.lua` geleverd: `os.clock`, default
  `os.time`, default `os.date` en `os.difftime` lezen machine-tijd via
  `sys_time_ms` en voeren deterministische BMSX civil-time code uit in BLua;
  de machine-native TS/C++ `os.*` callbacks zijn verwijderd zodat shipped
  guest-code niet meer via host wall-clock/locale rekent
- de publieke core/`string`/`table` Lua library surface wordt door BIOS Lua
  geïnstalleerd (`bios/base.lua`, `bios/string.lua`, `bios/table.lua`). De CPU
  houdt alleen verborgen `__bmsx_*` boot-primitives voor de dynamic Lua
  objectwereld; runtime boot wist die globals na system static-module init en
  vóór cart static modules of cart reset-vector draaien. Dat is geen
  backwards-compat surface en geen precedent voor nieuwe cart-zichtbare host
  faciliteiten.

## 21. CPU machine-code ABI loshalen van Lua-objectwereld

Doel: de cart-machine wordt primair een word/address/register/memory machine.
Lua-objecten blijven compiler/dev/dynamic-lane representaties, niet het fundament
van de static cart ABI.

Status:

- `CPU.Value` ondersteunt nog Lua-objecten zoals tables, closures en strings
- huidige bytecode bevat nog Lua-VM opcodes naast low-level memory/register
  operaties
- static lane gebruikt al struct/pointer/memory-lowering; de scalar
  bios-util cohort (`bool01`, `clamp`, `div_toward_zero`, `rect_overlaps`,
  `rol8`, `round_to_nearest`) is de eerste echte function-export call-target
  groep zonder runtime module-table transport
- static function exports blokkeren runtime globals, runtime module slots,
  dynamic call targets en string constants in de compiler-producer voordat die
  vormen als opcodes worden geëmit; de post-codegen gate blijft de invariant
  voor resterende dynamic Lua-opcodes zoals table/closure/vararg/concat/object-length
- static calls blijven expliciet `export_proto` link-symbolen;
  `bios/util/sincos_turn32` is nu ook een root function module, zodat firmware
  trig geen compile-time export table-vorm meer nodig heeft
- dit is nog geen volledig primair machine-code ABI-contract: `CPU.Value` bestaat
  nog voor de dynamic Lua-lane en er zijn nog ongemigreerde cart/gameplay targets

Acceptatie:

- function export code gebruikt words, registers, addresses, sections en symbols
  als primaire representatie
- Lua-object values komen niet voor in static ABI/hot modules
- dynamic Lua objectwereld is expliciet beperkt tot de dynamic gameplay lane
- TS/C++ CPU/linker/debugger tonen dezelfde machine-code representatie

## 22. Cart startup/vector model expliciet maken

Doel: boot en echte hardware handlers hebben een expliciet consolecontract,
zonder een nep-lifecycle command bus. `init()` en `new_game()` zijn cartfuncties
met cart/engine-semantiek, geen machine vectors.

Status:

- eerste increment klaar: `ProgramImage` heeft een `vectors` object met
  `resetProtoIndex`, `sectionInitProtoIndex` en `irqProtoIndex`. TS/C++ loaders, linkers,
  runtime boot en ROM-header metadata gebruiken de boot-vector table in plaats
  van losse entry/section-init imagevelden.
- runtime start via de reset vector; cold startup draait eerst de section-init
  vector en daarna static module init en reset vector. Hot-resume installeert
  hetzelfde ProgramImage object maar passeert bewust geen section-init vector,
  zodat live `.data`/`.bss` niet opnieuw geïnitialiseerd wordt.
- `IRQ_REINIT`/`IRQ_NEWGAME` en de runtime lifecycle-raiser zijn verwijderd.
  Cold cart startup roept `init()` en daarna `new_game()` direct aan; hot-resume
  herstart de reset vector niet en roept alleen de huidige `init()` closure via
  de IDE/debugger-call primitive aan nadat live state is hersteld.
- hardware IRQ's hebben nu een concrete vector-entry in het imagecontract.
  Guest-domain executie accepteert maskable IRQ's bij `HALT` en op instruction
  boundaries, pusht een interruptframe boven het onderbroken cartframe,
  schakelt maskable IRQ's uit voor de handler en herstelt de vorige mask-state
  op `RET`. Host/debugger-calls observeren pending IRQ's alleen om uit `HALT`
  te komen; zij consumeren/vectoren niet.
- `IRQ_MASK` start op `0`. Firmware/carts unmasken alleen de bronnen die zij
  asynchroon via de vector afhandelen; de CPU-global maskable state is geen
  cart-facing EI/DI-knop maar alleen de interne handler-serialisatie die bij
  accept uitgaat en op interrupt-`RET` herstelt. Een pending unmasked lijn wordt
  bij de eerstvolgende guest instruction boundary na die mask-write geaccepteerd
  (geen Z80-achtige delayed EI).
- de boot ROM zet `IRQ_MASK` terug naar `0` direct vóór cart handoff, zodat
  firmware-owned mask bits niet in de cart reset vector lekken.
- de IRQ-vector is functioneel: de compiler-generated vector leest `IRQ_FLAGS`
  en roept de program-handler `irq(flags)` aan. Firmware/cartlib handlers
  dispatchen via `system.irq`/`on_irq` en acken alleen de maskers die zij
  behandelen. Asynchroon gevectoriseerde bronnen worden in `IRQ_MASK` gezet en
  hebben precies één handler-owner die ack't. Synchroon gewachte bronnen blijven
  gemasked: de waiter pollt `IRQ_FLAGS` terwijl hij loopt en schrijft `IRQ_ACK`
  zelf; masked bits zijn zichtbaar maar vectoren en wekken `HALT` niet. Een
  unmasked unacknowledged level-bit vector't opnieuw op de volgende eligible
  guest boundary, zoals hardware. Carts zijn gemigreerd naar ISR-owned latches
  in plaats van post-`HALT` flags-polling als dispatchpad.
- NMI is expliciet buiten scope zolang er geen NMI-producer is.

Acceptatie:

- ROM/program metadata bevat de echte vectors (reset/section-init/IRQ)
- linker resolve't vector-symbolen naar concrete proto/adres targets
- runtime start gebruikt de vector table/calling convention
- hot-resume gebruikt hetzelfde image/link-resultaat als ROM boot en voert
  `init()` als host/debugger-call uit, niet als machine lifecycle interrupt
- oude Lua-global lifecycle en `reinit`/`new_game` IRQ transport zijn geen
  console ABI meer
- IRQ-acceptatie bij `HALT` en instruction boundaries is cartcode-executie: de
  CPU pusht een handlerframe, de handler leest/dispatcht/ackt de pending bits,
  en `RET` uit dat frame hervat de onderbroken PC zonder return values naar het
  cartframe te schrijven
- unacknowledged level IRQ's worden niet door de emulator weggegooid; zij
  blijven pending en re-vectoren totdat de owner `IRQ_ACK` schrijft

## 23. Harde verifier/audit voor echte retro-carts — GESCHRAPT

Verworpen; geen open slice meer. Deze slice was een verkeerde richting: een
los "retro-cart verifier"-script dat achteraf ROMs scant is geen
retro-console-architectuur en geen best-practice. Het creëert een tweede,
afgeleide waarheid naast compiler/linker/loader/runtime, precies de soort
tooling-facade die ownership verbergt in plaats van de producer te repareren.

Waarom dit bullshit was:

- Een ROM achteraf opnieuw linken of scannen bewijst niet dat de echte
  boot/load/hot-resume keten dezelfde object → reloc → executable semantiek
  gebruikt. Die invariant hoort in de linker/runtime-pipeline zelf.
- Placeholder-strings of legacy symbolen achteraf in const-pools zoeken is een
  symptoomscan. De compiler/linker moeten zulke runtimewaarden by construction
  onmogelijk maken.
- Dynamic-opcode-, `data`/`bss`-, vector- en source-mode-equivalentie zijn
  producer/compiler/linker-contracten. Een generiek script dat alles op één hoop
  gooit wijst niet scherp genoeg naar de echte eigenaar.
- Een los projectscript kan makkelijk stale `dist/` artefacts controleren en dan
  valse zekerheid geven. Echte gates moeten aan build/link/load/hot-resume
  hangen waar de executable state daadwerkelijk ontstaat.

Wat in plaats daarvan moet gebeuren:

- `module`/`export_proto`/const/global relocaties moeten in de object/linker
  contracten zelf volledig verdwijnen vóór executable install.
- Const-module function exports moeten een compiler-contract krijgen dat dynamische Lua
  opcodes niet kan emitten.
- `data`/`bss`, vectors en ROM/data-symbolen moeten door hun eigen producers en
  linkers gevalideerd worden, niet door een late facade-check.
- Source-mode en hot-resume moeten dezelfde compile/link semantics gebruiken als
  ROM-build; als dat niet zo is, is dat een runtime-pipeline bug, geen
  verifier-feature.

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
