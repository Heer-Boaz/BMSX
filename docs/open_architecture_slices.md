# Openstaande architectuur-slices

Baseline na de laatste boundary-slices:

```txt
architecture_boundary_issues,15
ts-machine -> ts-ide,10
ts-machine -> ts-render,3
cpp-machine -> cpp-render,2
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

- `npm run compile:machine -- --pretty false`
- `npm run test:lua` (`255` tests, `254` pass, `1` skipped)
- `npm run test:rompacker` (`68` pass)
- `npm run audit:core-parity`
- `npm run check:indent`
- `git diff --check`
- `npm run build:platform:libretro-wsl -- --force`
- `npm run headless:forcebuildalltest -- pietious tests/carts/pietious/pietious_enter_world_assert.lua`
- `npm run headless:forcebuildalltest -- nemesis_s tests/carts/nemesis_s/nemesis_s_stage_boot_assert.lua`
- `npm run headless:forcebuildalltest -- 2025 tests/carts/2025/2025_live_timeline_assert.lua`
- `npm run ide:test -- pietious tests/ide/hot_resume_entry_edit.idetest.js`

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
| echte `rodata`/`data`/`bss` secties | Deels: het image-format en de TS/C++ linker behouden `rodata`/`data`/`bss`; klaar: `.bss` zeroed RAM met compiler/linker-generated startup-code en raw BLua-declared `.rodata` als CPU-leesbare immutable PROGRAM_ROM storage met link-symbolen; open: `.data` RAM VMA plus ROM LMA en startup-copy. |
| één object-file/linker pipeline | Deels: program images hebben reloc-records en TS/C++ linkers; eerste install-seam staat nu in de program/linker-eigenaar (`inflateExecutableProgramImage`) voor object-image → executable program; gewone Lua source-boot, hot-resume en host-eval append lopen ook via de compiler-owned `ProgramImage` encoding; system+cart boot-entry selectie loopt via de program/linker-eigenaar (`linkBootProgramImages`) in TS en C++; ROM-build en source-compile zijn geaudit als legitieme input-producers die op dezelfde compiler/linker objectgrens convergeren, niet als resterende split-brain. |
| runtime relocaties als load/link stap | Deels: `module`/`export_proto` placeholders zijn uit runtimewaarden gehaald; open: harde verifier-gate voor alle executable images. |
| static module/data ABI | Deels: M2 call-targets kunnen link-time naar `CLOSURE(proto)` en de const-moduleklasse bestaat; const modules exporteren compile-time constants, `.bss` en `.rodata` storage-symbolen en leaf/static function call-targets zonder runtime module-table, global-slot lookup of `require`-call. Static function exports mogen sibling static exports aanroepen via `export_proto` link-symbolen; function exports zijn geen runtime waarden. Open: `.data` symbolen en bredere static functionregels buiten const modules. |
| dynamic Lua-opcodes weren uit systems/static modules | Deels: const-module static function protos worden na codegen/optimalisatie door de compiler geweigerd als dynamic Lua-opcodes overblijven; open: bredere systems/static functieklassen en audit-output zodra daar een echte consumer voor is. |
| CPU objectwereld loshalen van machine-code ABI | Open: `CPU.Value` is nog Lua-objectwereld; echte cart ABI moet primair words, registers, addresses, memory, sections en symbols zijn. |
| assets/`rom_data` binair maken | Deels: `rom_data`-familie is weg en `.bin` raw ROM path is getest; open: maps, rooms, timelines, registries en asset records naar vaste binaire layouts. |
| cart startup/vector model | Open: entry/init/new_game/reinit/IRQ handlers moeten een expliciete vector/handler ABI krijgen in plaats van ad-hoc Lua global lifecycle. |
| verifier/audit voor echte carts | GESCHRAPT in deze vorm: een los retro-cart verifier-script is een slechte slice. De echte gates horen bij de producer/linker/compiler/runtime-eigenaren zelf, niet in een achteraf-scanner die ROMs opnieuw interpreteert. |

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

## 17. BLua section-model met `.bss` en `.rodata`

Doel: het section-model onderscheidt `.rodata`, `.data` en `.bss`. `.rodata` is
immutable CPU-leesbare ROM-storage; `.data` is mutable RAM-storage met een
ROM-load-image; `.bss` is mutable zeroed RAM-storage zonder load-image. De
uitgevoerde increments bewijzen twee kanten: BLua declareert `.bss` voor zeroed
RAM en raw `.rodata` voor immutable PROGRAM_ROM bytes. De linker wijst concrete
VMA/LMA adressen toe; startup-code nult `.bss` als gewone CPU-code. De
emulator/runtime parse't geen secties en initialiseert geen cart-data namens
het spel. Dit is geen rompacker-conversie van JSON/YAML assets en geen generic
content-serializer.

Status:

- `.bss` v1 is geïmplementeerd in TS en C++: BLua accepteert `bss name: Type`
  declarations, de compiler reserveert typed zeroed RAM, en het object-image
  draagt `.bss` symbols plus `bss_addr` const-value relocaties
- linker/inflate resolven `.bss` symbolen naar concrete RAM VMA's;
  single-image install krijgt een expliciete `.bss` base en bij een system+cart
  link krijgt de cart `.bss` een VMA na de system `.bss`
- de compiler genereert een static section-init proto; cold boot draait die proto
  vóór static module initializers en user entry, zodat `.bss` zeroing gewone
  CPU/memory-instructies is en geen runtime/installer section-parser
- hot-resume geeft expliciet geen section-init proto door en reïnitialiseert live
  cart-RAM dus niet
- raw BLua-declared `.rodata` byte storage is geïmplementeerd in TS en C++:
  `rodata name: Type = ...` emit primitive typed ROM bytes, `.rodata` symbols en
  `rodata_addr` const-value relocaties. De CPU-memory map expose't text + raw
  `.rodata` als PROGRAM_ROM, terwijl de CPU alleen de text-section als
  instructies decodeert
- de bestaande VM constPool/module metadata blijft gescheiden van raw `.rodata`
  bytes; assets blijven ook gescheiden ROM-payloads met hun eigen symbolen
- `.data` blijft open modelwerk: er is nog geen mapped ROM LMA en geen
  startup-copy
- linker/inflate weigeren `.bss` ranges die buiten RAM vallen en PROGRAM_ROM
  ranges die buiten de ROM-window vallen

Open audit-evidence:

- static mutable state en persistent scratch storage worden nog vaak in
  Lua-objecten of handgekozen `mem[...]` ranges gelegd; nieuwe code kan nu naar
  compiler-toegewezen `.bss`, maar carts zijn nog niet breed gemigreerd
- immutable typed lookup tables kunnen nu naar compiler-toegewezen `.rodata`,
  maar carts zijn nog niet breed gemigreerd
- `.data` heeft nog geen BLua-syntax, symboolnamen, alignment- en
  relocation-discipline
- `.data` init-bytes hebben nog geen echte LMA in een CPU-leesbare ROM-window;
  bytes die alleen in `ProgramImage.sections.data.bytes` blijven zitten zijn
  metadata, geen geheugen

Acceptatie:

- BLua heeft expliciete declaraties voor zeroed cart-RAM (`.bss`) en immutable
  PROGRAM_ROM storage (`.rodata`) met typed size/alignment
- de compiler emit `.bss` reservations en `.rodata` bytes met linkbare symbolen
  voor die declarations
- linker wijst `.bss` RAM VMA's en `.rodata` PROGRAM_ROM LMA's toe en resolved
  de symbols naar concrete adressen
- BLua-startup/proloog voert `.bss` init uit als cartcode: zero `.bss` vóór de
  user entry; runtime/rompacker doen dit niet
- BLua-startup/proloog draait vóór static module initializers die section-symbolen
  kunnen raken, of static initializers worden onderdeel van de startup-flow:
  section init → static module init → user entry
- `.rodata` is raw storage, gescheiden van de bestaande VM constPool/module
  metadata en gescheiden van asset blobs
- `.data` blijft buiten scope: het volgt pas wanneer de mapped LMA klopt en
  startup-copy nodig is
- BLua code consumeert `.bss`/`.rodata` via addresses/pointers/words, niet via
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
- gewone TS Lua source-boot, hot-resume en host-eval append compileren nu eerst
  naar `ProgramImage` via de compiler-eigenaar (`encodeCompiledProgramImage` /
  `encodeAppendedProgramImage`) en installeren daarna via dezelfde executable
  install-boundary; IDE/runtime live paths bezitten die ruwe reloc-resolve stap
  niet meer
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

## 19. Static module/data ABI afmaken

Doel: naast M2 call-target exports komt er een expliciete static moduleklasse.
Static modules exporteren functies, constants en rodata/data-symbolen; ze hebben
geen runtime module-table identiteit.

Status:

- M2 call-targets kunnen direct naar `CLOSURE(proto)` linken
- gewone waardelezingen houden terecht Lua-semantiek
- const moduleklasse bestaat: een module in `constModulePaths` exporteert compile-time
  constants, `.bss`/`.rodata` storage-symbolen en top-level static function
  exports; elke value-export wordt op de use-site geïnlined (`KSMI`/`LOADK`,
  `bss_addr` of `rodata_addr` const-value reloc), en function exports linken via
  het bestaande `export_proto`
  pad naar static closures zonder module-tabel, global-slot lookup of
  `require`-call. De module heeft geen module-proto of `staticModulePaths`-entry.
  `bmsx/assets` gebruikt dezelfde klasse voor ROM asset-symbol constants. De
  module/export-contractanalyse is uit de bytecode-emitter gehaald en leeft in
  de program/module-contract eigenaar; de compiler consumeert dat contract bij
  storage-reservering en use-site-emissie.
- klaar als eerste static storage increment: const modules kunnen `bss name: Type`
  declareren en `return { name = name }`; de compiler reserveert de storage,
  exporteert het adres als link-symbol en cold startup zero't de storage via de
  bestaande section-init proto
- klaar als eerste static function increment: const modules kunnen top-level
  `local function` / `local <const> = function` exports aanbieden; de compiler
  compileert die als 0-upvalue static closures en weigert module-local captures
  of externe const-module function exports. Static functions mogen module-level
  `<const>` waarden gebruiken; sibling static-function calls naar geëxporteerde
  static functies loweren naar `export_proto` link-symbolen in plaats van
  runtime upvalues. Static function exports als waarden lezen blijft geen static
  ABI: alleen call-targets krijgen link-symboliek.
- klaar als eerste static opcode-contract increment: const-module static function
  protos worden na codegen/optimalisatie geweigerd wanneer table allocatie of
  dispatch, runtime closure allocatie, vararg of dynamische concat overblijft.
- open: `.data` symbolen en bredere static functionregels voor toekomstige
  systems/static function protos buiten const modules
- geen doel: diepe contentgraphs als Lua const-aggregaten naar rodata-bytes
  verlagen. Dat is content-packaging en hoort bij een
  schema-specifieke asset-producer.

Acceptatie:

- moduleclass is expliciet: dynamic Lua module of static systems module
  (const module is de eerste static klasse; designatie via `constModulePaths`
  bij de compile-input, bron blijft standaard-Lua)
- static exports zijn linkbare symbolen: functies, constants, `.bss` en
  `.rodata` addresses (klaar voor const modules), en later `.data` addresses en
  sizes
- namespace-als-waarde is voor static modules een compile-error (klaar voor de
  const module: de hele `bmsx/assets`-tabel als waarde gebruiken faalt compile-time)
- dynamic modules blijven Lua-semantiek houden waar gameplay die lane expliciet
  kiest
- generated `bmsx/assets` past in dezelfde static-symbol ABI (klaar: const module)
- static `.bss`/`.rodata` export heeft geen runtime module-table, geen asset
  lookup en geen content-serializer; het is gewoon object-storage met een
  link-time address symbol

## 20. Compiler-contract voor systems/static modules

Doel: hot/system cart code wordt niet door discipline snel gehouden. Zodra BLua
een expliciete systems/static moduleklasse heeft, garandeert de compiler voor
die moduleklasse dat dynamische Lua-runtime-opcodes niet worden geëmit. Dit is
wel relevant, maar pas als moduleklasse/section-declaraties een echte
compiler-semantiek zijn; het is geen losse linter en geen cart-specifieke stijlregel.

Verboden in systems/static modules:

- table-allocatie en table-dispatch op de ABI/hot path (`NEWT`, `GETT`, `SETT`
  en afgeleiden)
- runtime closure-allocatie in steady-state code
- `VARARG`, dynamische concat/dispatch en runtime module-table escape
- impliciete data-parser of nested Lua-table construction voor ROM ABI

Status:

- eerste increment klaar voor const-module static function exports: na codegen en
  optimalisatie controleert de compiler het daadwerkelijke InstructionSet van
  elke export-proto en weigert table allocatie/dispatch, runtime closure
  allocatie, vararg en dynamische concat. Dit is geen linter over source-stijl:
  alleen opcodes die na optimalisatie in het static proto overblijven tellen.
- dynamic gameplay modules blijven buiten deze gate; de gate hangt aan de
  static moduleklasse die al compile-time constants, `.bss`/`.rodata` symbols en
  static function exports bezit.
- open: dezelfde static-proto gate uitbreiden naar toekomstige systems/static
  functieklassen buiten const modules, en opcode-mix rapportage per module/proto
  als audit-output toevoegen wanneer er een echte audit-consumer is.

Acceptatie:

- module marker/klasse zit in compiler-semantiek (klaar voor const modules)
- compiler controleert de uiteindelijke geoptimaliseerde protos van gemarkeerde
  systems/static modules en faalt de build wanneer verboden dynamische opcodes
  overblijven (klaar voor const-module static function exports)
- opcode-mix rapportage per module/proto is beschikbaar voor audit (open)
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
- Static/systems modules moeten een compiler-contract krijgen dat dynamische Lua
  opcodes niet kan emitten.
- `data`/`bss`, vectors en ROM/data-symbolen moeten door hun eigen producers en
  linkers gevalideerd worden, niet door een late facade-check.
- Source-mode en hot-resume moeten dezelfde compile/link semantics gebruiken als
  ROM-build; als dat niet zo is, is dat een runtime-pipeline bug, geen
  verifier-feature.

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

Status:

- `RenderPresentationState` is host/core-owned in TS en C++; runtime bezit geen
  presentatie-state meer en `machine/runtime/frame`/`vblank` resetten geen
  render-presentatie lifecycle-state.
- Render-context restore voor save/resume blijft bewust open maar valt onder
  slice 8, dus niet mengen met deze slice zolang save-state/resume out-of-scope
  is.

Open audit-evidence:

- `machine/ts/machine/runtime/runtime.ts -> render/gameview`
- `machine/ts/machine/runtime/runtime.ts -> render/shared/bmsx_font`
- `machine/ts/machine/runtime/save_state.ts -> render/vdp/context_state`
- `machine/cpp/machine/runtime/resume_snapshot.cpp -> render/vdp/context_state.h`
- `machine/cpp/machine/runtime/save_state.cpp -> render/vdp/context_state.h`

Acceptatie:

- runtime exposes machine-visible output/state
- host/render owns presentation, view snapshots and context restore
- save/resume machine state remains render-host independent

## 8. Save-state/resume render-context split (OUT OF SCOPE! Save-state/resume pakken we pas aan nadat alle andere slices klaar zijn, omdat dit anders een moving target is die we steeds moeten aanpassen zolang er nog andere dependencies zijn)

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
