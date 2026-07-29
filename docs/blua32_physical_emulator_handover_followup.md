# BLua32 physical-emulator handover — vervolg

Dit document is een **vervolg** op `docs/blua32_physical_emulator_handover.md`,
niet een vervanging. Lees dat document nog steeds voor:

- §1 opdracht/eindtoestand,
- §2 niet-onderhandelbare uitvoeringsregels,
- §3 ownershipwaarschuwing,
- §11-12 validatie-eisen,
- §14 no-go-oplossingen,
- §15 lessons learned.

Die secties zijn nog volledig geldig en zijn in het werk hieronder ook
aangehouden. **§4 (exacte repositorytoestand), §6 (bugs), en met name §7.1 en
§7.4 zijn inmiddels achterhaald** — de repository is sindsdien door vier
commits heen. Dit document legt uit wat er sinds die handover is opgelost, wat
er nog open staat, en waar concreet verder te gaan.

## Wat er sinds de vorige handover is gebeurd (4 commits, in volgorde)

### 1. `32014f272` — §7.1 opgelost: Revision uit de fysieke CPU-kern

`Blua32ExecutionImageRevision`/`Blua32MediaRevision`/
`CPU.applyExecutableMediaRevision()` zijn uit `cpu.ts`/`cpu.cpp` verwijderd.
De CPU kent nu alleen nog generieke primitieven die niets van
source-revisions afweten:

- `CPU.installExecutionImage(target)`
- `CPU.rawContinuations()`
- `CPU.relocateFrame(frameIndex, functionAddress, pc, callSitePc, epcWord, nmiReturnEpcWord)`

Alle revision-/relocatiesemantiek zit nu in tooling
(`toolchain/ts/rompack/blua32_revision.ts`) en in de IDE
(`ide/runtime/hot_resume.ts`), niet meer in de CPU-kern. Terzijde is hierbij
een echte latente bug gevonden en gefixt: `callSitePc` werd niet
gerelokeerd (nu via `relocatedCallSitePc`).

### 2. `b3bd4efac` — `machine/ts/ide/` verplaatst naar top-level `ide/`

Zuivere directoryverplaatsing (ts-morph, ~250 bestanden, alle imports
automatisch herschreven). Dit heeft **4 echte core→ide-schendingen**
zichtbaar gemaakt die daarvoor verstopt zaten onder `machine/ts/`:

- `machine/ts/core/machine_manager.ts`
- `machine/ts/core/host_frame.ts`
- `machine/ts/machine_runtime.ts`
- `machine/ts/render/presentation_state.ts`

Deze vier importeren nog rechtstreeks uit `ide/` (boot, error handling,
frame-sync state). Dit is **bewust niet in dezelfde commit opgelost** —
zie Taak 3 hieronder.

### 3. `a0ab64088` — nieuwe feature: Lua-runtimefouten als echte CPU-exceptie

Dit loste een architectuurspanning op die niet in de oorspronkelijke
handover stond, maar er wel direct uit voortvloeide: de gebruiker wilde de
CPU symbol-vrij houden (§7.4), maar niet de bestaande crash-terminal-feature
verliezen (firmware-monitor toont "bestand:regel" bij een fout).

Oplossing: een oncaught Lua-fout wordt nu een **echte CPU-exceptie**, exact
zoals een adresfout, gedispatched naar firmware's bestaande
exceptionvector. Geen host-side symbol-decode, geen "magic" — de firmware
zelf (Lua in ROM) doet alle crash-rapportage.

Concreet, in beide talen 1:1:

- `cop0.ts` / `cop0.h`: `COP0_LUA_FAULT_REASON = 9`,
  `CPU_CAUSE_CODE_TRAP = 13 << 2` (echte MIPS Trap-ExcCode, hergebruikt omdat
  een Lua runtime-check-failure precies is wat MIPS Trap betekent), plus 8
  `LUA_FAULT_REASON_*`-constanten.
- `CPU.enterLuaFaultException(error)` hergebruikt de bestaande
  exceptionentry-machinery (`enterException`/`enterSynchronousException`),
  gezet in de catch-paden van `runUntilDepth`/`step`.
- `cop0.lua_fault_reason` is nu geldige, read-only Lua-syntax
  (`toolchain/ts/lua/compiler.ts`'s `resolveCop0Register`).
- `machine/firmware/bios/monitor_commands.lua`/`monitor.lua`: bestaande
  BIOS-monitor (exception_registry, FAULT-command) is **uitgebreid**, niet
  vervangen — nieuwe `TRAP`-registry-entry met `LUAFAULT <reason>`-regel.
- Save-state: `luaFaultReasonWord`/`nmiReturnLuaFaultReasonWord` zijn
  append-only toegevoegd aan `RUNTIME_SAVE_STATE_PROP_NAMES`.
- Echte end-to-end proof: `carts/monitor_fault_probe/` +
  `tests/ide/monitor_fault_probe.idetest.js` — headless screenshot bevestigt
  het BIOS-monitor-scherm met de juiste exception/reason-tekst.

### 4. `137723b20` — §7.4 opgelost: symbols uit CPU/runtime, TS én C++

`Blua32SymbolsImage` zit niet meer in `Blua32MediaImage`/
`Blua32ExecutionImage`, in geen van beide talen. `CpuCallStackEntry`/
`CpuDebugState` exposeren nu een fysiek feit — `slot: number`
(`cartridgeSlot` in C++; -1 = system, 0/1 = cartridge) — in plaats van een
symbolpointer. `CPU.activeSymbols()`/`getDebugRange()`/
`executionImageForPc()` (TS én C++) zijn volledig verwijderd, niet leeg
gemaakt (de handover waarschuwde hier expliciet tegen in §7.4's laatste
zin — "voer dit niet half uit door opnieuw `getDebugRange()` leeg te
maken").

Twee losstaande designbeslissingen die de functionaliteit **behouden**
(conform de waarschuwing) in plaats van weg te gooien:

**Profiler** — had de rijke symbols nodig voor source-line-rapportage.
Nieuwe, smalle, opt-in API i.p.v. hergebruik van `Blua32SymbolsImage`:

```ts
cpu.attachProfilerDebugInfo(slot, functionIds, metadata /* CpuProfilerMetadata */)
```

De profiler gebruikt zijn eigen, al bestaande, smallere type
(`CpuProfilerMetadata`, alleen `debugRanges`) — niet de rijke
compiler/linker-symbols. `tests/lua/cpu_profiler.test.ts` bleef ongewijzigd
groen.

**IDE-tooling** (stack trace, intellisense-hover) — had de rijke symbols
nodig, maar `loadBlua32MediaSymbols()` vereist een volledige
TOC-container (`RawRomSource`) die lage-niveau CPU-unittests niet hebben.
Oplossing: een goedkope, extern bijgewerkte snapshot-cache in
`ide/runtime/lua_pipeline.ts`:

```ts
setActiveBlua32MediaSymbols(symbols)   // bij boot() en bij hot-resume — de enige 2 echte lifecycle-momenten
activeBlua32MediaSymbols(): Blua32MediaSymbols
blua32SymbolsForSlot(symbols, slot): Blua32SymbolsImage | null
```

Consumenten (`ide/runtime/stack_trace.ts`, `ide/editor/contrib/intellisense/engine.ts`,
`ide/runtime/debug_state.ts`, `ide/cart_editor.ts`, `ide/workbench/mode.ts`,
`ide/workbench/overlay_modes.ts`) lezen deze cache i.p.v. zelf te decoderen.

**C++**: `Runtime` bezat `m_blua32MediaSymbols` al **niet** op de CPU (dat
was al goed) maar rechtstreeks op `Runtime` zelf. C++ heeft geen aparte
`ide/`-laag zoals TS — `Runtime::logLuaCallStack()`/`logDebugState()` doen
zelf de crash-logging (private methods, dus buiten de strict-public-parity-
check). Om **strict `boot()`-methodparity met TS te herstellen** (TS'
`Runtime.boot()` heeft 0 parameters sinds deze commit) is C++'s
`Runtime::boot(Blua32MediaSymbols)` gesplitst in:

```cpp
void Runtime::boot();                                    // 0 params, matcht TS exact
void Runtime::setBlua32MediaSymbols(Blua32MediaSymbols);  // nieuw, apart, na boot() aangeroepen
```

met een `cpp_exclusions`-entry in `scripts/core_parity_manifest.json`
(zelfde patroon als de al bestaande `handleLuaError`-exclusion) die
uitlegt waarom dit een C++-only public method is.

**Bijvangst — twee kapotte auditconfigs gevonden en gefixt:**
`scripts/architecture_boundary_rules.json` en `scripts/core_parity_manifest.json`
verwezen nog naar `machine/ts/ide/**`-paden die commit 2 (`b3bd4efac`)
had verplaatst. Gevolg: `npm run audit:core-parity` **crashte** (ENOENT) en
`npm run audit:architecture-boundaries:strict` **scande `ide/` stilletjes
niet meer** (0 issues was een vals-positieve "schoon", niet een echte
schone scan — `ide` stond niet in `roots`). Beide zijn gefixt:
`roots` bevat nu `"ide"`, de `ts-ide`-laag wijst naar `ide/**`, en alle
losse `"file"`/`"present"`-padreferenties zijn bijgewerkt. **Les voor de
volgende directoryverplaatsing: grep ook JSON/configbestanden op
letterlijke padstrings — ts-morph herschrijft alleen TS-imports, geen
strings in config.**

## Volledige validatiebattery die groen is bevestigd na commit 4

```
npx tsc --noEmit --project machine/ts/tsconfig.json
npx tsc --noEmit --project ide/tsconfig.json
npm run test:lua                                    # 504/505 pass, 1 skip (verwacht)
npm run test:rompacker                              # 87/87
npm run audit:architecture-boundaries:strict        # 0 issues (nu een echte scan, zie boven)
npm run test:hot-resume                             # 27 assertions
npm run test:cartridge-conformance
npm run audit:core-parity                           # geen strict-parity errors meer
npm run test:render-parity                          # TS-software/C++-software/C++-GLES2 pixel-identiek
npm run test:bare-metal-frame-scan
npm run test:pietious-scanout-headless
git diff --check
cmake --build build-cpp-tests --parallel $(nproc)
cd build-cpp-tests && ctest --output-on-failure -j $(nproc)  # 23/23
```

**Let op de tsc-valkuil uit de vorige sessie**: `npx tsc --noEmit --project
tsconfig.json` (root) is een **stille no-op** in dit project (bevestigd via
`--listFiles` → 0 bestanden). Gebruik altijd het per-project pad
(`machine/ts/tsconfig.json`, `ide/tsconfig.json`) of `npx tsc -b tsconfig.json`.

## Wat nog open staat (4 taken, in aanbevolen volgorde)

### Taak 0 — ontvlecht `cpu.ts`/`cpu.cpp` (nieuw, hoogste prioriteit, vóór A/B/C)

**Deze taak moet vóór Taak A/B/C gebeuren** — expliciete gebruikersbeslissing.
Aanleiding: tijdens het uitzoeken van Taak A (zie hieronder, en de
MSX/NDS-precedentendiscussie) viel op dat `functionRecordOnSelectedBus`
(cpu.ts:2403) een RAM-adres stilzwijgend als systeem-ROM behandelt
(`address < CART_ROM_BASE ? systemImage : ...`, terwijl `RAM_BASE` vóór
`CART_ROM_BASE` ligt) — een sprong naar RAM halt vandaag altijd, terwijl de
gewone databus (`memory.ts`) wél correct drieledig splitst
(`RAM_BASE`/`CART_ROM_BASE`). Dat leidde tot een bredere, structurele audit
van `cpu.ts` (grep op alle method-declaraties, niet de volledige bodies) die
een fundamenteler probleem blootlegde dan Taak A alleen.

**Bevinding 1 — het is niet eens één klasse.** `machine/ts/machine/cpu/cpu.ts`
is 4927 regels en bevat 10 classes, niet 1: `StringValue`,
`LuaThrownValueError`, `LuaExecutionError`, `Closure`,
`ProtectedCallContinuation`, **`Table`** (een volledige generieke
Lua-hashtable-implementatie — rehash/resize/array-hash-hybride-indexering,
regels 525-1181, 656 regels), `RegisterFile`, twee `NativeArgsView`-
varianten, en pas dan `CPU` zelf (regel 1534-4927, ~3400 regels). Een
generieke Lua-waardemodel-implementatie hoort sowieso niet in hetzelfde
bestand als de CPU-executielogica. C++ (`machine/cpp/machine/cpu/cpu.cpp`
3576 regels + `cpu.h` 1185 regels) moet op dezelfde manier doorgelicht
worden — nog niet gedaan.

**Bevinding 2 — binnen de `CPU`-klasse, wat hoort wel/niet als "hardware":**

Hoort **niet** thuis op de CPU-klasse (geen enkele MAME-CPU-device zou dit
doen — dit is loader-/driver-/presentatielaagwerk):
- ROM/media mount+decode: `mountExecutableMedia`/`remountExecutableMedia`/
  `mountExecutableImages`/`decodeExecutableMedia`/`activateExecutableImage`/
  `installExecutionImage`/`decodeText`/de decoded-page-cache
  (`decodedPageForWrite`/`decodedPageAt`). Een echte CPU-core leest via
  `memory.read()` en heeft geen besef van "media" of "images".
- Cartridge-busslotresolutie: `functionRecordOnSelectedBus`,
  `cartridgeImageForExecution` — CPU beslist hier over cartridge-
  slotsemantiek in plaats van pure adresresolutie.
- Profiler-orkestratie/opmaak: `configureProfiler`, `profilerImages`,
  `formatProfilerReport`, `attachProfilerDebugInfo`. Ruwe state-exposure
  (`getCallStack`, `readFrameRegister`) is wél prima — dat doet een
  MAME-CPU-device ook (state-interface) — maar *beslissen wat geprofiled
  wordt* en *een leesbaar rapport opmaken* niet.

Hoort **wel** thuis op de CPU-klasse (legitieme Lua-VM-"hardware", exact de
categorie waarvan de gebruiker zelf al zei "het is een Lua-CPU en dat is
prima" — **niet verplaatsen**):
- `executeInstruction` (regels 2996-3619, 623 regels) — de eigenlijke
  fetch/decode/execute-opcode-switch. Omvang is normaal voor een grote
  opcode-switch, geen smell op zich.
- Register-/frame-/upvalue-machinery: `pushFrame`, `acquireFrame`/
  `releaseFrame`, `closeUpvalues`, `readUpvalue`/`writeUpvalue`,
  `createClosure`, de hele `setRegister*Fast`-familie.
- Protected-call-machinery (pcall/xpcall): `startProtectedCall`,
  `invokeProtectedTarget`, `finishProtectedCall*`, `handleProtectedCallError`.
- Table-index inline caching: `resolveTableIndexChain`,
  `loadTableIntegerIndexCached`, `loadTableFieldIndexCached`.
- Builtin-opcode-dispatch (`runBuiltinFunction` met o.a. `next`/`type`/
  `setmetatable`/`rawget`/`rawset`/`select`/`string.byte`/`string.char`/
  `error`) — zag er op naam uit als stdlib-gemak, maar is bevestigd
  backed door een echte `BuiltinFunctionId`-enum mét een
  cyclus-kostentabel (`BUILTIN_COST_TIER1/2/4`,
  `toolchain/ts/lua/compiler.ts:124` e.v.), gedispatcht vanuit hetzelfde
  opcode-pad als alle andere instructies — dat is precies hoe een echte
  ISA "vreemde" instructies behandelt (vgl. x86 BCD-/string-instructies).
  Geen host-magie, niet verplaatsen.
- Globals-slotbeheer (`registerGlobalNames`, `setGlobalBySlot`/
  `getGlobalBySlot` e.d.) — idem, legitieme Lua-VM-"hardware".

`captureRuntimeState`/`restoreRuntimeState` (regels 4352-4751, ~400 regels
samen) zijn steekproefsgewijs gecheckt op host-cache-lekken (het §7.8-punt
uit de originele handover) — één treffer, een check tegen
`staticClosuresByAddress` om te bepalen of een closure canoniek is (de
cache gebruiken om een fysiek feit te classificeren, niet de cache zelf
serialiseren). Lijkt schoon, maar niet regel-voor-regel geverifieerd.

**Save-state: expliciet buiten scope van Taak 0, gebruikersbeslissing.**
Géén verdere verificatie, opschoning of herontwerp van
`captureRuntimeState`/`restoreRuntimeState` of het save-state-wireformat
als onderdeel van deze taak — dat kost uren werk en enorm veel tokens
terwijl de representatie sowieso een moving target is zolang de rest van
deze refactor loopt. Dit is consistent met het bestaande projectbeleid
("Save-state bevroren tijdens refactors": best-effort tot de representatie
stabiliseert, eindbeeld raw dumps + build-hash) — niet een nieuwe
uitzondering, gewoon een herbevestiging ervan voor deze taak specifiek.
Als sub-slice 0.3's herstructurering per ongeluk save-state-relevante
velden raakt (append-only toevoegen/verwijderen in
`RUNTIME_SAVE_STATE_PROP_NAMES`), volg de bestaande append-only-regel en ga
niet verder dan strikt noodzakelijk om de build/tests groen te houden.

**Performance-regressiemeting: vereist vóór sub-slice 0.2/0.3, niet
optioneel.** De volledige validatiebattery (zie boven) meet uitsluitend
correctheid (pixel-parity, frame-scan, unit-tests, audits) — niets daarvan
meet host-side wall-clock-kosten per uitgevoerde instructie. Dat is precies
het risico dat sub-slice 0.3b punt 1 probeert te vermijden (geen indirectie
op het hete `pushFrame`-pad) — zonder meting zou een regressie daar alsnog
door de hele battery heen glippen. Het benodigde framework **bestaat al**,
hoeft niet gebouwd te worden:
- `CpuExecutionProfiler`/`--cpu-profile` (headless CLI-vlag,
  `scripts/bootrom/platforms/node_entry.ts:1103`,
  `cpu.setProfilerEnabled(true)` + `formatCpuProfilerReport()` bij afsluiten)
  geeft een deterministisch, structureel profiel (opcode-tellingen, hot
  paths, categorie-drukverdeling) — goed voor "welke opcodes worden het
  vaakst uitgevoerd", niet voor wall-clock-kosten per opcode.
- `hosts/libretro_host/frame_timing.c`/`.h` is een generieke wall-clock
  paced-timeline-harness (warmup, max-frames), al gebruikt door de
  bestaande `profile:libretro-particle-soak-offscreen-wsl`/
  `profile:libretro-upload-soak-offscreen-wsl`-scripts — nu toevallig
  alleen ingezet voor GLES2-renderdoeleinden via `--gles2-timing-report`.

Wat ontbreekt is niet het framework maar een **CPU-instructiezware
soakcart** die dezelfde `frame_timing`-harness gebruikt (bijv. via
`--backend software` om GLES2-ruis te vermijden) — een nieuw
`profile:cpu-*-soak`-script naar het bestaande patroon, met een
vóór-en-na-vergelijking rond sub-slice 0.2/0.3 specifiek. Zet dit op
vóórdat aan 0.2/0.3 wordt begonnen, niet achteraf als iets al traag blijkt.

**Waarom dit vóór Taak A moet**: Taak A's eager-decode-probleem en de
RAM-executie-dispatch-inconsistentie zijn allebei symptomen van dezelfde
onderliggende fout (CPU bezit media-/bus-loader-verantwoordelijkheid die
niet van haar is). Als media-mounting een aparte loader wordt die de CPU
alleen voedt via een smalle, fysieke interface (adresbereik → decoded
backing, met een expliciet "niets hier"-fout-pad — zie de eerdere
MSX/NDS-precedentendiscussie hierboven/in de originele handover §7.10),
lossen beide problemen waarschijnlijk vanzelf mee op in plaats van losse
puntfixes te vereisen.

**Concreet extractieplan (5 sub-slices, elk apart verifieerbaar en te
committen — niet één big-bang-herschrijving; volledige validatiebattery na
elke sub-slice):**

**Sub-slice 0.1 — pure bestandssplitsing, geen gedragswijziging (laagste
risico, goede warming-up).** Verplaats `Table` (regels 525-1181, 656 regels
— volledige generieke hashtable-implementatie), `StringValue`,
`LuaThrownValueError`/`LuaExecutionError`, `Closure`,
`ProtectedCallContinuation`, `RegisterFile`,
`ArrayNativeArgsView`/`RegisterNativeArgsView` naar eigen bestanden (bijv.
`lua_table.ts`, `lua_value.ts`, `register_file.ts`, naamgeving volgt
bestaande conventie in `machine/ts/machine/cpu/` — er bestaan al
`blua32_image.ts`/`blua32_symbols.ts`/`profiler.ts`/`string_pool.ts` als
sibling-bestanden, dus dit patroon is al gangbaar). Check eerst of er ook
een losstaand `CallFrame`-type/klasse in `cpu.ts` zit dat mee moet (nog niet
expliciet gevonden in de methode-grep, wel gebruikt als `frame.pc`/
`frame.functionRecord`). Kan met dezelfde ts-morph-aanpak als de
`ide/`-verplaatsing eerder deze sessie (automatische importherschrijving
over alle call sites).

**Nieuw gevonden asymmetrie voor deze sub-slice, C++ vs TS.** TS'
`executeInstruction` (623 regels, de opcode-dispatch-switch) zit volledig
inline in de `CPU`-klasse. In C++ zit het equivalent **niet** in
`cpu.cpp`/`cpu.h` — het is al gefactored in aparte bestanden
`cpu_dispatch.inl` (720 regels, per-opcode-handlerbodies, bijv.
`DISPATCH_LABEL(CLOSURE)`) en `spec/blua32/opcode_list.inl` (64 regels, X-macro
opcode-lijst), die 6× met verschillende macrocontext worden geïncluded
vanuit `cpu.cpp` (regels 2430-2879) om zowel de dispatchtabel als andere
afgeleide structuren te genereren. Dat is een bestaand, gangbaar
C++-interpreterpatroon (vergelijkbaar met hoe Lua's eigen `lvm.c` of veel
emulators opcode-tabellen in aparte headers zetten) — **geen probleem, eerder
het voorbeeld dat TS zou moeten volgen**. Concreet betekent dit: sub-slice
0.1 is voor C++ **al gedeeltelijk gedaan** (opcode-dispatch is al
uitgefactored) — de C++-kant van 0.1 hoeft dus alleen `Table` (nog steeds
volledig in `cpu.h`, regel 806, met 27 `Table::`-methodes in `cpu.cpp`) en
de overige gebundelde structs aan te pakken, niet de dispatch-logica. Voor
TS zou 0.1 idealiter ook overwegen om `executeInstruction` naar een eigen
bestand te verplaatsen, analoog aan hoe C++ dit al doet — dit stond niet in
de oorspronkelijke versie van deze sub-slice.

Ook geverifieerd tijdens dit onderzoek: `cpu_dispatch.inl` bevat zijn eigen
`CLOSURE`-handler (`DISPATCH_LABEL(CLOSURE)`, regel 415) die
`functionRecordInExecutionDomain` aanroept — dit is het vierde aanroeppunt
in C++ dat in een eerdere onderzoekspas over het hoofd werd gezien (alleen
`cpu.cpp` was doorzocht, niet de `.inl`-bestanden die erin worden
geïncluded). Met dit vierde punt meegeteld komen TS (4 aanroeppunten) en
C++ (4 aanroeppunten) wél overeen — de eerdere "C++ heeft er maar 3, mist
misschien de CLOSURE-case"-zorg was dus ongegrond, maar wel een teken dat
elke volgende C++-audit ook `*.inl`-bestanden moet doorzoeken, niet alleen
`.cpp`/`.h`.

**Sub-slice 0.2 — fix de adresresolutie fundamenteel, niet als patch.**
Bouw een correcte drieledige resolver (ROM/RAM/cartridge, gespiegeld aan de
al-correcte splitsing in `memory.ts`: `addr < RAM_BASE` → systeem,
`addr < CART_ROM_BASE` → RAM (expliciet geen backing, dus fault — tenzij
RAM-executie ooit een echte capability wordt), anders → cartridge via
`cartridgeController.selectedSlot()`) **vanaf nul**, in plaats van de
bestaande tweeledige `functionRecordOnSelectedBus`/
`functionRecordInExecutionDomain` door te schuiven naar het nieuwe bestand.
Dit lost zowel de RAM-dispatch-inconsistentie als (grotendeels) Taak A's
eager-decode-probleem op: de resolver hoeft alleen te decoderen op het
moment dat hij daadwerkelijk om een backing voor een adres wordt gevraagd.

**Sub-slice 0.3 — extraheer de loader, strict (gebruikersbeslissing: geen
compromis).** Nieuw bestand (bijv. `execution_loader.ts`, sibling van
`blua32_image.ts`) neemt over: `decodeExecutableMedia`,
`mountExecutableImages`/`mountExecutableMedia`/`remountExecutableMedia`,
`installExecutionImage`, `cartridgeImageForExecution`, en de nieuwe
resolver uit 0.2. De strikte eis: de `CPU`-klasse zelf mag na deze
sub-slice **geen enkele referentie meer** hebben naar "cartridge slot",
"media", "loader" of vergelijkbare BLua32/cartridge-specifieke concepten —
alleen een generieke, bij constructie/koppeling ingebrachte resolver-
interface (bijv. `ExecutionAddressResolver` met een enkele methode
`resolve(address): { image, functionRecord } | null`), analoog aan hoe een
MAME-CPU-device een door de driver geconfigureerde address-space krijgt
aangereikt zonder zelf te weten wat daar precies achter zit. De loader
implementeert die interface en wordt van buitenaf gekoppeld — **geverifieerd
haalbaar**: `Machine` (`machine/ts/machine/machine.ts:59`) doet vandaag al
`this.cpu = new CPU(this.memory, this.irqController)` als bestaande
compositieroot met een vaste constructievolgorde; de loader construeren en
meegeven (`new CPU(this.memory, this.irqController, loader)`) past daar
natuurlijk in, geen cirkelvormige afhankelijkheid of herstructurering van
`Machine` nodig. C++'s `Machine`/`machine.h`-equivalent is hier nog niet op
gecontroleerd.

**Type-relocatie die nog niet als stap in dit plan stond:**
`Blua32MediaImage`/`Blua32ExecutionImage` zijn vandaag **private types
inline in `cpu.ts`** (regels 1484/1490), niet al aanwezig in
`blua32_image.ts` zoals hierboven geformuleerd. `Blua32MediaImage`
(`layout`/`boot`/`cartridgeSlot`) is pure ruwe media-data — natuurlijke
nieuwe plek is `blua32_image.ts` zelf, naast de `Blua32ImageLayout`/
`Blua32BootHeader` waar het al direct op leunt. `Blua32ExecutionImage`
breidt dat uit met `functions`/`constPool`/`globalSlots`/`decodedPages`/
`staticClosures`/`profilerIndex` — stuk voor stuk CPU-runtime-state, precies
wat `activateExecutableImage` erin verankert — dat type blijft dus
CPU-eigendom (in `cpu.ts` of een nieuw CPU-eigen bestand, niet in de
loader).

Belangrijke nuance uit nader onderzoek: `activateExecutableImage` (regels
2017-2073) is **niet** pure loader-logica — het interned constant-strings
in `this.stringPool` (CPU-gedeelde string-pool), registreert globals in
`this.registerGlobalNames` (CPU-gedeelde globals-slottabellen), en bindt
static closures in `this.staticClosuresByAddress` (CPU-gedeelde registry).
Dit muteert dus echt gedeelde CPU/VM-state, geen pure byte-naar-structuur-
omzetting. **Blijft daarom een CPU-methode** die de loader aanroept via de
resolver-interface (loader doet ROM-header-parsing + busresolutie, roept
dan `cpu.activateImage(media)` aan om het resultaat in de gedeelde VM-state
te verankeren) — niet blind meeverplaatsen, en de CPU-methode zelf kent nog
steeds geen "cartridge slot"-concept, alleen "een media-blob die
geactiveerd moet worden". `decodeText`/`decodedPageForWrite`/
`decodedPageAt` (regels 2221-2309) gebruiken `this` niet inhoudelijk (puur
array-rekenwerk op gegeven layout-bytes) en kunnen als losse functies
worden geëxtraheerd, bruikbaar door zowel CPU als loader — laag risico.

**Sub-slice 0.3b — drie punten die eerder in gesprek werden gevonden maar
nog niet in dit plan waren verwerkt (alsnog expliciet gemaakt):**

1. **Het tweeledige resolutiepatroon moet in het ontwerp van 0.2/0.3
   terugkomen, niet worden platgeslagen tot één interface-call.**
   `functionRecordInExecutionDomain` (goedkoop, geen busconsultatie) wordt
   aangeroepen vanuit **`pushFrame`/`pushFrameFromCaller`** — dus bij **elke
   Lua-functieaanroep** in zowel TS (regels 3642/3679) als C++ (cpu.cpp:2963,
   3017) — en moet daarom **CPU-lokaal en synchroon blijven**, zonder
   indirectie via de strikte, extern-ingebrachte resolver-interface uit 0.3.
   Alleen `functionRecordOnSelectedBus` (duur, consulteert
   `cartridgeController.selectedSlot()`, alleen gebruikt bij `start()`/
   `executeFunctionAddress()` — programma-entry/IRQ/exceptie-dispatch, geen
   hete lus) gaat door de strikte interface. Twee resolutieniveaus, niet één.
2. **`relocateFrame`/`rawContinuations`** (TS-only, Slice-1, regels
   2168-2219) lezen vandaag rechtstreeks `this.cartridgeImages[slot]` — dat
   is *gebruiken* van slot-kennis om te *beslissen* welke image hoort bij een
   adres, niet slechts een feit doorgeven. Dat moet onder 0.3 via de
   loader/resolver lopen (`relocateFrame` roept de resolver aan met
   `functionAddress`, niet met een losse `slot`-parameter die het zelf
   indexeert in een CPU-eigen array). Bevestigd cold path (alleen Hot Resume),
   dus geen perf-risico — wél een concrete openstaande wijziging die nog
   nergens als stap was opgeschreven.
3. **Onderscheid "slot als passief feit" vs. "slot als beslissing"** — dit
   lost een schijnbare tegenspraak met Taak #6 (deze sessie, symbols-
   verwijdering) op: `CpuCallStackEntry.slot`/`CpuDebugState.slot`/
   `activeCartridgeSlot()`/`isCartridgeExecutionActive()` blijven **prima**
   staan — dat is de CPU die een reeds-bekend, ruw fysiek feit doorgeeft
   ("dit frame hoort bij slot N"), geen CPU die zelf de bus consulteert om
   gedrag te bepalen. Dat laatste (actief `cartridgeController.selectedSlot()`
   raadplegen, of `slot` gebruiken als index in een CPU-eigen
   `cartridgeImages`-array om te *beslissen* wat er geactiveerd wordt) moet
   naar de loader. Vergelijkbaar met hoe een MAME-CPU-device een ruwe
   bank-index aan de debugger mag tonen zonder zelf te weten wat die bank
   betekent.
4. **Save-state en 0.3 staan op gespannen voet, en dat is opgelost noch
   genegeerd.** `captureRuntimeState`/`restoreRuntimeState` lezen vandaag
   rechtstreeks `this.systemImage`/`this.cartridgeImages`/
   `this.activeExecutionImage`. Als 0.3 die eigendom naar de loader
   verplaatst, moeten deze call sites **mechanisch** worden bijgewerkt om te
   blijven compileren/werken (dezelfde data ophalen via de loader in plaats
   van via `this`) — dat is onvermijdelijk onderdeel van 0.3, geen keuze.
   "Save-state is buiten scope" (eerder in dit document) betekent: geen
   her-audit van de correctheid, geen wireformat-herontwerp — **niet** "raak
   geen letter aan". Verwar die twee niet.

**Sub-slice 0.4 — profiler-orkestratie, strict (gebruikersbeslissing: geen
compromis).** `formatProfilerReport` (regel 2877) is al een letterlijke
one-line delegatie naar de **al bestaande, al externe**
`formatCpuProfilerReport()` in `profiler.ts`, via het publieke
`cpu.profiler`-veld — puur verwijderen, callers roepen
`formatCpuProfilerReport(cpu.profiler.snapshot(), options)` rechtstreeks
aan. `configureProfiler`/`profilerImages`/`buildProfilerOpcodeByWord`/
`setProfilerEnabled`/`isProfilerEnabled`/`profilerEnabled`/
`profilerConfigured` gaan **volledig** van de CPU-klasse af — niet als
"legitieme levenscyclus-glue" laten staan. De CPU krijgt één publieke,
puur-data accessor (bijv. `cpu.currentExecutionImages()`) die alleen
teruggeeft wat er al fysiek bestaat (systemImage + cartridgeImages,
decodedPages, functions) zonder zelf te weten dát er geprofiled wordt. Een
externe orchestrator (nieuw bestand, of in de bestaande profiler-tooling)
roept die accessor aan, bouwt zelf de `CpuProfilerImage[]`-descriptors
(inclusief `buildProfilerOpcodeByWord`-equivalent), en beslist zelf wanneer
te herconfigureren (bij mount/hot-resume/install-events — de orchestrator
luistert naar die lifecycle-momenten, niet de CPU). `attachProfilerDebugInfo`
blijft bestaan maar verhuist mee naar diezelfde orchestrator in plaats van
een CPU-methode te zijn. Dit is exact hoe een MAME-CPU-device zich verhoudt
tot de debugger: de CPU-device weet niet dat er geprofiled wordt, iets
extern leest zijn state.

**Sub-slice 0.5 — mirror in C++, met geverifieerde verschillen (niet zomaar
4 sub-slices kopiëren).** De C++-kant is inmiddels wél echt bekeken (grep op
`cpu.h`/`cpu.cpp`), niet langer een aanname. Identiek aan TS, dus 0.1/0.2/0.3
gelden onverkort:
- De RAM-conflatiebug zit letterlijk hetzelfde in `functionRecordOnSelectedBus`/
  `functionRecordInExecutionDomain` (cpu.cpp:1344-1357): `address < CART_ROM_BASE
  ? systemImage : ...`.
- Hetzelfde tweeledige resolutiepatroon — en `functionRecordInExecutionDomain`
  wordt aangeroepen vanuit **`CPU::pushFrame`** (cpu.cpp:2963), dus bij **elke
  Lua-functieaanroep**, niet alleen bij closure-creatie (dit geldt ook voor TS'
  `pushFrame`/`pushFrameFromCaller`, regels 3642/3679 — heter dan eerder in dit
  document gesuggereerd; dit pad moet dus zeker CPU-lokaal en goedkoop blijven,
  geen indirectie via de strikte resolver-interface uit 0.3).
- `Table` zit ook in C++ volledig in `cpu.h` (`class Table : public GCObject`,
  regel 806, implementatie in `cpu.cpp` via 27 `Table::`-methodes) — zelfde
  bundelingsprobleem, sub-slice 0.1 geldt onverkort.
- Media/mount/decode-methodes bestaan met identieke namen en vorm (deze sessie
  zelf bewerkt) — sub-slice 0.3 geldt onverkort.

**Niet hetzelfde — niet aannemen, expliciet overslaan:**
- **Sub-slice 0.4 (profiler-orkestratie) is niet van toepassing.** `cpu.h`
  bevat geen `CpuExecutionProfiler`/`attachProfilerDebugInfo`/
  `configureProfiler` — geen treffers. Er is geen `profiler.cpp`/`.h` naast
  `cpu.cpp` zoals TS die heeft onder `machine/ts/machine/cpu/profiler.ts`.
  De profiler-feature bestaat simpelweg niet in C++ — niets te extraheren.
- **`relocateFrame`/`rawContinuations` bestaan niet in C++** (nul treffers) —
  consistent met §7.6 uit de originele handover ("Hot Resume is TS-only
  CPU-gedrag"). De eerder in dit document genoemde zorg over die twee
  methodes (cartridge-slot-kennis in reeds-gecommit Slice-1-werk) is dus
  TS-only en raakt C++ niet.

Pas dus alleen 0.1/0.2/0.3 toe op C++, in dezelfde volgorde als TS.

Elke sub-slice: eigen commit, volledige validatiebattery (zie boven) ervoor
verplicht. Gegeven de omvang (4927 + 3576 + 1185 regels aan te raken code)
niet in één keer aanvliegen.

### Taak A — §7.10: eager dual-slot BLua32-decode

`CPU.mountExecutableImages()` (TS én C++) decodeert bij mount **beide**
cartridgeslots volledig (function records, constants, strings, global
names) — ongeacht welk slot ooit daadwerkelijk wordt uitgevoerd. Alleen de
omzetting naar guest-runtimevalues wordt al uitgesteld tot
`cartridgeImageForExecution()`.

Probleem: een ongeldig executable image in een ongebruikt slot kan al bij
hostmount throwen, vóórdat firmware dat slot ooit selecteert; een nooit
uitgevoerd tweede cart kost al host-parsing/allocaties.

**Niet oplossen met try/catch + "negeer corrupt slot 1"-fallback** (expliciet
verboden in de handover, §7.10 en §14). De juiste route: maak decode lazy
per slot, pas uitgevoerd zodra firmware dat slot daadwerkelijk selecteert
voor executie — zowel in TS als in C++ tegelijk (niet één taal lazy maken
terwijl de andere eager blijft, dat schendt regel 10 uit §2).

**Historisch precedent (informatief, geen blauwdruk).** Twee bestaande
dual-slot-systemen laten zien hoe "goedkope presence-check zonder decode,
volledige decode alleen voor de daadwerkelijk uitgevoerde slot" op
verschillende niveaus is opgelost. Geen van beide hoeft letterlijk
nagebootst te worden — ze illustreren alleen dezelfde onderliggende eis,
niet een concrete architectuurkeuze voor BMSX:

- **MSX** (BIOS-scan over N slots): bij boot leest de BIOS uitsluitend een
  klein "AB"-signature-woord op pagina 1/2 van elke slot; pas als dat
  aanwezig is wordt de INIT-vector aangeroepen. Een niet-uitvoerbare
  cartridge (bijv. de Konami Sound Cartridge die bij (SD) Snatcher zat —
  een MegaRAM+SCC+-kaart zonder "AB"-header) wordt door die scan simpelweg
  nooit gezien: er wordt geen programmastructuur voor gedecodeerd, alleen
  ruwe memory-mapped registers die het van disk geladen spel zelf
  aanspreekt. Een disk-controllercartridge heeft wél een geldige header,
  maar diens INIT installeert alleen hooks en geeft terug — ook dat is geen
  "overname", puur een goedkope aanwezigheidsbevestiging.
- **Nintendo DS** (asymmetrisch Slot-1/Slot-2): geen scan/wedstrijd tussen
  slots — Slot-1 is het enige boot-slot, Slot-2 (GBA-compatibel) is direct
  memory-mapped en wordt uitsluitend door het draaiende Slot-1-programma op
  eigen initiatief geprobeerd, nooit door de hardware zelf als programma
  geïnterpreteerd tenzij er expliciet naartoe wordt gesprongen.

**Waar BMSX vandaag concreet staat**: het presence-signaal bestaat al,
hardwarematig, voor niets. `CartridgeController`
(`machine/ts/machine/devices/cartridge/controller.ts`) exposeert
`IO_CART_STATUS` (`readStatusThunk`) met `SLOT0_PRESENT`/`SLOT1_PRESENT`,
losstaand van enige BLua32-decode. En `decodeExecutableMedia()` in `cpu.ts`
heeft ook al een goedkope early-out (`bindRomByteView` faalt, of
`boot.imageOffset === 0`) — dat is precies het MSX-"geen AB-header"-pad.
**De echte lek zit specifiek bij een aanwezige, geldige, maar nooit
geselecteerde slot**: staat er in slot 1 wél een geldig BLua32-image maar
selecteert firmware via `cartridgeController.selectedSlot()` altijd slot 0,
dan decodeert `mountExecutableImages()` (cpu.ts:1932) toch **beide** slots
volledig — function records, constants, strings, global names — bij elke
mount. Dat is exact de NDS-Slot-2-situatie: aanwezig en memory-mapped mag
niets kosten; volledig als programma gedecodeerd worden hoort pas te
gebeuren zodra `selectedSlot()` er daadwerkelijk naar wijst, niet
automatisch bij mount.

Relevante bestanden: `machine/ts/machine/cpu/cpu.ts`
(`mountExecutableImages`, `decodeExecutableMedia`,
`cartridgeImageForExecution`), `machine/ts/machine/devices/cartridge/controller.ts`
(`selectedSlot`, `readStatusThunk`), `machine/cpp/machine/cpu/cpu.cpp`/`cpu.h`
(zelfde functienamen).

### Taak B — §7.9: IDE path-based source-identiteit

Zo'n tiende plekken onder `ide/{runtime,workbench,editor,workspace}`
identificeren een Lua-bron nog uitsluitend met een kale `path`-string
(bijv. `luaChunkEnvironmentsByPath: Map<string, LuaEnvironment>`,
`CartEditor.isAvailable` dat faalt zodra **enig** slot geen source heeft).
Twee carts met allebei een `entry.lua` kunnen daardoor dezelfde
editor-/environmentidentiteit raken.

**Niet oplossen met handmatig samengestelde tekstprefixes overal** (expliciet
verboden). Ontwerp één professionele documentidentiteit
(slot-of-system + path, of een registry-toegewezen ID) bij de bestaande
registry/media/project-context-owner. De fysieke CPU mag hier niets van
weten — dit is zuiver IDE/workspace-scope.

### Taak C — core/ide-verstrengeling (ontdekt bij commit 2, bewust apart gehouden)

De 4 bestanden genoemd onder commit 2 hierboven
(`machine/ts/core/machine_manager.ts`, `machine/ts/core/host_frame.ts`,
`machine/ts/machine_runtime.ts`, `machine/ts/render/presentation_state.ts`)
importeren nog rechtstreeks uit `ide/` voor boot/error-handling/frame-sync-
state. Voor elke import: bepaal per geval of de dependency echt op
core/runtime-niveau hoort, of dat de afhankelijkheid omgedraaid moet worden
(bijv. via een callback/event die core aanroept en die ide/ registreert,
i.p.v. core die ide/ importeert). Merk op dat `npm run
audit:architecture-boundaries:strict` dit **niet** afdwingt — er bestaat
geen `deny`-regel die `ts-core`/`ts-runtime-api`/`ts-render` verbiedt om
`ts-ide` te importeren (bewust nagelaten toen dit werd ontdekt, om de
build niet meteen rood te maken). Overweeg zo'n regel toe te voegen **nadat**
deze taak is afgerond, niet ervoor.

## Volgorde-advies

**0 → A → B → C** (bijgewerkt: gebruiker heeft expliciet besloten dat Taak 0
— de CPU-ontvlechting — vóór A/B/C moet, juist omdat A's probleem er een
symptoom van is). In lijn met het "salvage gericht, niet alles-of-niets"-
patroon uit de vorige sessie: elke taak (en binnen Taak 0, elke sub-slice)
is een losstaande, zelfstandig te verifiëren en te committen stap. Voer na
elke slice de volledige battery hierboven uit voordat je commit.
