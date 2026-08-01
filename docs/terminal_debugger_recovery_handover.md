# Handover: herstel de BMSX-terminal, debugger en monitor-audio zonder host-magie

Datum: 2026-08-01  
Branch bij overdracht: `master`  
HEAD bij overdracht: `b731ec229 fix(studio): preserve physical fault observation across reboot`

## Opdracht aan de volgende agent

Herstel de verloren terminal- en debuggerfunctionaliteit van BMSX, maar zet de
oude host-magie niet blind terug. Gebruik de oude implementaties als
**functionele referentie** en plaats ieder gedrag bij de juiste huidige owner:

- de machine emuleert alleen fysieke CPU-, bus-, register-, interrupt-,
  supervisor- en devicewerking;
- de BIOS-ROM bezit de fysieke monitor, TTY, commandline en consoleweergave;
- IDE/tooling bezit bronbestanden, symbols, source maps, breakpoints,
  steppingbeleid, overlays en navigatie;
- hosts transporteren beeld, geluid, invoer en machine-output, maar voeren geen
  guestsemantiek uit.

Dit is geen cosmetische polish. De eerdere migratie heeft bestaande features
verloren. Herstel de complete featurecontracten, met exacte TS/C++-pariteit waar
de machinegrens wordt geraakt. Bedenk geen nieuwe terminal en geen nieuwe
audiobuffering.

## Startconditie

Voor het schrijven van dit document was de worktree schoon. De laatste
afgebroken audiopoging is volledig ongedaan gemaakt. Er staat dus **geen**
`writeSilence()` of vergelijkbare silence-queue in de huidige checkout.

Controleer dit zelf voordat je begint:

```sh
git status --short
git branch --show-current
git log -1 --oneline
rg -n "writeSilence|heap-diag-frames" . \
  -g '!node_modules/**' -g '!build*/**' -g '!dist/**'
```

Verander eerst niets. Lees:

1. de instructies die bij deze overdracht zijn meegegeven;
2. `docs/architecture.md`, vooral de machinegrens, mirrored core, supervisor,
   BIOS/Lua, IDE/tooling en host-lifecycle;
3. `docs/open_architecture_slices.md`;
4. de live owners die hieronder staan;
5. de historische referenties die hieronder staan;
6. passende productiecode, minimaal MAME voor execution/debugger hooks en VS
   Code voor debugger- en editorownership.

## Niet-onderhandelbare werkwijze

- Verifieer de live checkout; behandel dit document en bestaande plannen als
  hypotheses waar dat nodig is.
- Fix een verkeerde producer of owner. Voeg geen guards, fallbacks, facades,
  adapters of wrappers toe om een verkeerd model te verbergen.
- Geen hostobjecten, source paths, source revisions, debug-DTO's of JS-shape
  checks in de CPU.
- Geen nieuwe tests. Gebruik bestaande tests alleen waar ze een actueel
  contract bewaken. Verwijder een obsolete test als hij de nieuwe fysieke
  architectuur test in plaats van gedrag.
- Builds en typechecks zijn geen runtimebewijs. Draai echte carts en bekijk de
  geproduceerde frames.
- Geen extra buffering, prebuffer, silence frames of latencycompensatie in de
  APU of hostaudio.
- Geen hot-pathallocaties, repeated decode, redundante validatie of cosmetische
  helpers.
- Doe vóór iedere machinewijziging een expliciete TS/C++-representatietabel en
  benoem alle hot-pathcallsites.
- Commit coherente, reviewbare stukken tussendoor. Laat geen gigantische diff
  ontstaan.
- Schrijf implementatiedetails als comments bij hun owner; gebruik
  `docs/architecture.md` alleen voor blijvende architectuurcontracten.
- Voeg geen `preLaunchTask` toe aan `.vscode/launch.json`.

Aanvullende harde codebans voor BMSX-owned waarden:

- geen `Number.isFinite`, `Number.isNaN`, `isNaN` of `typeof ... ===/!==
  'number'`;
- geen `floor`/`ceil` voor fixed-point, registerwoorden, adressen, opcodes of
  rendererdata;
- geen lokale ABI-, fixed-point-, register- of encodinghelpers in feature- of
  cartfiles;
- geen capture/rollback/restore rond MMIO-writes tenzij het hardwaredomein
  werkelijk transacties modelleert;
- geen runtime-DTO-validatie of veilige fallback voor state die door BMSX zelf
  wordt geproduceerd;
- geen legacybehoud zonder werkelijk bestaand, gewenst legacycontract;
- hardwaredevices bewaren raw words en decoderen alleen aan hun datapathgrens.

## Direct waarneembare regressies

Deze punten zijn door de gebruiker live waargenomen. Neem ze niet als opgelost
aan omdat een typecheck of headless proces eindigt.

### BIOS-monitor en terminal

- Tijdens de monitor blijft de muziek doorspelen. De oude terminal stopte de
  uitvoering/audio en hervatte zonder merkbare latency.
- De monitor toont de nutteloze tekst `NO SAVED FAULT`.
- Een fout in `pietious` toonde alleen de BIOS-monitor met onder meer
  `ATTEMPTED TO INDEX FIELD ON A NON-TABLE VALUE`; de rijke Lua-broncontext
  ontbrak.
- De caret zag er in de geobserveerde foutflow grijs/afwijkend uit. Het gewenste
  consolegedrag is een block caret die de glyph eronder werkelijk inverseert.
- Guest/system-output en de volledige exception kwamen niet meer in de
  browserconsole terecht.

### IDE en debugger

- Bij een runtime-exception opent de IDE niet meer automatisch op de juiste
  bronlocatie met een foutoverlay.
- Wanneer de IDE daarna wordt geopend, is de fout niet zichtbaar zoals vroeger.
- `Ctrl+E` springt niet meer naar de exception; het opent nu een file search.
- Breakpoints worden nog opgeslagen en getekend, maar beïnvloeden de CPU niet.
- Volwaardige continue, step-in, echte step-over, step-out en resumable fault
  execution zijn verloren gegaan.

### Cartregressies die opnieuw bewezen moeten worden

- `pietious`: de hierboven genoemde non-table fault na recente cartlibrefactors;
  daarnaast is eerder na enkele minuten actief spelen in World 1 een Lua-heap
  overflow gezien. Het is onbekend of dat nog bestaat.
- `2025`: eerder zijn combat-skip/freezes en een niet gewiste achtergrond
  waargenomen. De status na de recente commits is niet opnieuw volledig live
  bewezen.
- `bare_metal_cart`, `pietious` en `2025` moeten in zowel TS als C++ worden
  uitgevoerd; screenshots moeten inhoudelijk worden bekeken.

## Belangrijk: de mislukte audio-oplossing niet herhalen

De afgebroken patch voegde ongeveer dit concept toe:

```ts
ApuOutputRing.writeSilence(frameCount, startSequence)
```

Dat was fundamenteel fout:

- silence frames werden in dezelfde ring vóór hervatte muziek gezet;
- daardoor ontstond precies de langdurige latencyregressie die al eerder was
  veroorzaakt;
- ring-writebeleid werd gedupliceerd;
- een frontendprobleem werd als nieuwe APU-buffersemantiek gemodelleerd.

Vereist gedrag:

1. supervisor/monitor wordt actief;
2. guestmuziek stopt onmiddellijk;
3. de APU-song/voicepositie loopt tijdens de monitor niet ongemerkt door;
4. bestaand uitgaand hosttransport bevat geen oude backlog;
5. `CONT` hervat vanaf dezelfde machinepositie zonder hoorbare bufferlatency;
6. er worden nergens silence frames gequeued om dit te simuleren.

De waarschijnlijke ownerverdeling, die eerst tegen de huidige timing moet worden
geverifieerd:

- een fysieke supervisor-hold/clock-gate aan de machine/APU-kant bevriest de
  relevante audiadatapath;
- de host stopt/suspendeert alleen het transport en verwerpt reeds uitgaande
  transportbacklog;
- browser en libretro observeren dezelfde fysieke supervisorstate;
- geen frontend bestuurt gastvoices of guesttijd rechtstreeks.

Relevante huidige owners:

- `machine/ts/machine/devices/audio/**`
- `machine/cpp/machine/devices/audio/**`
- `machine/ts/machine/devices/system/controller.ts`
- `machine/cpp/machine/devices/system/controller.{h,cpp}`
- `hosts/common/audio_output.ts`
- `hosts/common/host_frame.ts`
- `hosts/libretro/audio_output.{h,cpp}`
- `hosts/libretro/entry.cpp`

`HostAudioOutput.muteSystem()` bestaat al en stopt de puller, reset de resampler,
leegt de bestaande outputring en suspendt de sink. Onderzoek of dit het juiste
hosttransport-eindpunt is; gebruik het niet als vervanging voor het bevriezen
van machine-audiotijd. De libretrohost heeft een afzonderlijke
`LibretroAudioOutput` en moet hetzelfde waarneembare contract krijgen zonder
een tweede bufferbeleid te introduceren.

## Historische functionele referentie: terminal

De laatste commit waarop de oude hostterminal de complete gewenste combinatie
bezat is:

```text
db2c68ed9c6b148bf875333b2f734ebc963d3982  2026-06-20
```

Gebruik deze commit als feature-oracle, niet als architectuursjabloon. De oude
terminal was host/IDE-owned; de fysieke commandline hoort nu in BIOS-ROM.

De oude boom op die commit:

```text
machine/ts/ide/terminal/common/suggest_model.ts
machine/ts/ide/terminal/completion_panel/input.ts
machine/ts/ide/terminal/completion_panel/model.ts
machine/ts/ide/terminal/completion_panel/renderer.ts
machine/ts/ide/terminal/ui/commands.ts
machine/ts/ide/terminal/ui/mode.ts
machine/ts/ide/terminal/ui/suggest_controller.ts
```

Inspecteer bestanden zonder ze terug te checkouten:

```sh
git show db2c68ed9:machine/ts/ide/terminal/ui/mode.ts
git show db2c68ed9:machine/ts/ide/terminal/ui/commands.ts
git show db2c68ed9:machine/ts/ide/workbench/overlay_modes.ts
git show db2c68ed9:machine/ts/machine/runtime/debug.ts
```

Aanwezige functionaliteit op `db2c68ed9`:

- commandline/REPL en `?expr`/`=expr`;
- ghost completion text;
- command history met Up/Down;
- command-outputpager met Up/PageUp, Down/PageDown, Enter, Space en Q;
- `CLS`, `CONT` en faultcommands;
- auto-activatie bij runtimefouten;
- rijke PC/op/instruction/sourceweergave en expressionwaarden;
- guest `print` naar terminal én browserconsole;
- overlay blokkeerde guest-frame-executie en suspendde audiotransport.

Regressiegrenzen:

| Contract | Laatste goede commit | Eerste bekende degradatie |
| --- | --- | --- |
| Complete terminalcombinatie | `db2c68ed9` | `a468b4b02` |
| Rijke source/disassembly en locals | `db2c68ed9` | `a468b4b02` |
| Guest print naar terminal en browserconsole | `ad47e672f` | `4b7e44b82` |
| Source snippets/expressions nog aanwezig | `e328581be` | `c11346342` |
| Commandline, ghost, history, pager en overlayaudio | `5530194fa` | `56c848ee9` |

`56c848ee9 feat(bios): move terminal into supervisor firmware` verwijderde de
oude IDE-terminalboom. De huidige BIOS-files zijn:

```text
machine/bios/shell/monitor.lua
machine/bios/shell/commands.lua
machine/bios/shell/editor.lua
machine/bios/shell/source_location.lua
machine/bios/tty/console.lua
machine/bios/tty/layout.lua
machine/bios/tty/terminal.lua
```

De huidige regel die `NO SAVED FAULT` produceert staat in
`machine/bios/shell/commands.lua`. Verwijder niet alleen de tekst waarna een
ongeldige producer toch doorloopt. Modelleer de lege `FAULT`-actie bij de
commandproducer en monitor-entry correct: geen nepbericht en geen dereference
van ontbrekende faultstate.

## Historische functionele referentie: execution debugger

Let op: de juni-terminal bevatte nog debugger-UI, maar de werkelijke execution
debugger was al veel eerder gedegradeerd. Gebruik voor CPU-stop/stepgedrag de
oudere commits:

| Contract | Laatste goede commit | Eerste bekende breuk |
| --- | --- | --- |
| Breakpoints, continue, step-in, step-out en exception resume | `6f3c0b353073842e00476236b7d5f7c8b9453ad6` | `14a2329645bd7d37c1ba566e17908386b865d037` |
| Echte step-over | `b30f062a1abb27933ab8dd1983803ecfdbc3da38` | `4c2cb014baef43524b69fe6eaf539dc672185749` |
| IDE auto-open en source overlay bij exception | `8755ae34b734d81d66cf25125b901b326d060df7` | `9dab80cd55c94c1d41c007967661a82fe41f66b0` |
| CPU-fault naar host source mapping | `b3bd4efac6ef6da8a6ab7fbf9b9bab85f8712137` | `a0ab6408858345f34112d9737efc042c191647e3` |

Daarna verwijderden deze commits subsystemen:

- `bf35d283c`: `ide/commands/debug.ts`, `ide/runtime/debug_pause.ts`,
  `ide/runtime/debug_state.ts`, `ide/workbench/contrib/debugger/state.ts`,
  `machine/ts/lua/debug_pause.ts` en `machine/ts/lua/debugger.ts`;
- `f5278a693`: de oude host-fault-MMIO-laag;
- `f67cc0078`: retained BIOS-faultstate en `NO SAVED FAULT`.

De oude debuggercode mag eveneens niet blind worden teruggezet. Bestudeer hoe
MAME dit oplost:

- `device_execute_interface` biedt een minimale instruction-hookboundary;
- alleen wanneer de debuggerhookflag actief is, gaat execution door de
  debuggercheck;
- de debugger, niet de CPU, bezit breakpoints, stepping en stopbeleid;
- source mapping en consoleweergave blijven buiten de CPU.

Productiereferenties:

- <https://github.com/mamedev/mame/blob/master/src/emu/diexec.h>
- <https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcpu.cpp>
- <https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcon.cpp>
- <https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts>

## Huidige ownerkaart

### Fysieke machine/supervisor

`machine/{ts,cpp}/machine/devices/system/controller.*` bezit nu:

- `SYS_CONTROL` en `SYS_STATUS`;
- supervisor fence/quiesce/contextbanken;
- fault-registerfile en fault sequence;
- supervisor enter/leave en resumability.

De fysieke faultstatus staat in raw MMIO-woorden. Houd dat zo. Voeg geen
bronlocaties, debugobjecten of hostcallbacks met sourcekennis toe.

### BIOS-ROM

- `machine/bios/shell/monitor.lua`: exception/NMI-entry en commandloop;
- `machine/bios/shell/commands.lua`: fysieke commando's en fault/memory/register
  output;
- `machine/bios/shell/editor.lua`: editor/history/completionstate;
- `machine/bios/shell/source_location.lua`: ROM-side diagnostiek;
- `machine/bios/tty/terminal.lua`: cellen, scroll, caret en GP0-flush;
- `machine/bios/tty/console.lua`: consoletransport naar de terminal;
- `machine/bios/base.lua`: guest `print`.

De BIOS mag fysieke informatie tonen die een echte ROM via registers, RAM en
ROM-indexen kan lezen. Workspacepaden, editorbuffers en host-source-revisions
horen hier niet.

### IDE/tooling

- `ide/runtime/fault_state.ts`: tooling-side faultsnapshot en Lua stack;
- `ide/workbench/runtime_errors.ts`: formatting/logging van runtimefouten;
- `ide/runtime/debugger_state.ts`: huidige breakpointmetadata;
- `ide/workbench/contrib/debugger/controller.ts`: breakpoint-UI;
- `ide/browser/debugger_pause.ts`: browser/DevTools-pause;
- `ide/runtime/sources.ts` en `ide/runtime/source_registry.ts`: bronownership;
- `tooling/ts/runtime/suspended_guest.*`: tooling-inspectie van gestopte guest;
- `toolchain/ts/rompack/**`: symbols, image-layout en disassembly.

Huidige breakpoints worden opgeslagen en getekend, maar niet naar een
execution-stopcontract gecompileerd. De juiste richting is:

1. IDE/tooling vertaalt `(domain, path, line)` naar fysieke PC-ranges;
2. een minimale, optionele machine-executionhook observeert raw domain/PC;
3. de hook is uitgeschakeld in de normale hot path;
4. tooling bezit breakpointmatching, step-in/over/out en pause events;
5. de scheduler stopt/hervat bij de executionboundary;
6. de CPU kent geen source path, source map, editor of `debugState`.

### Host-output

- `hosts/common/system_output_log.ts` draint fysieke systeemoutput;
- `hosts/common/audio_output.ts` bezit browser/common audiotransport;
- `hosts/common/host_frame.ts` bezit host pause-reasons;
- `hosts/libretro/audio_output.*` bezit libretro audiotransport.

Het spiegelen van fysieke console-output naar DevTools/logging is hostobservatie,
geen BIOS-call naar `console.log` en geen CPU-debugfeature. Herstel terminal- en
exceptionlogging via de bestaande fysieke output/faultkanalen.

## Gewenste architectuur voor faults

Er zijn twee weergaven van dezelfde gebeurtenis, niet twee concurrerende
faultsystemen:

1. De machine publiceert de raw exception in het fysieke supervisor-
   registerfile en vectoriseert naar BIOS.
2. De BIOS-monitor toont uitsluitend machine-native diagnose.
3. IDE/tooling observeert de fault sequence en maakt met symbols/source maps een
   rijke toolingweergave.
4. De IDE opent de relevante bron en toont de overlay.
5. Browser/libretro logging consumeert de fysieke output of toolingobservatie
   op zijn eigen boundary.

`b731ec229` verplaatste de geobserveerde supervisor-faultsequence naar
`RuntimeFaultState` en synchroniseert deze na reboot/cold boot. Review deze
commit als startpunt; neem niet aan dat hij de volledige debugger herstelt. Hij
herstelt alleen het bewaren/observeren van de fysieke fault sequence en bevat
ook product/launch-configaanpassingen.

## Uitvoeringsvolgorde

Werk niet tegelijk aan cartlib-cleanup en debuggerherstel. Houd de diff klein en
bewijs elke verticale feature.

### 1. Leg een featurematrix vast uit historische code

Maak vóór edits een korte tabel met:

- oud waarneembaar gedrag;
- huidige producer/consumer;
- uiteindelijke owner;
- TS/C++-impact;
- hot-pathcallsites;
- live bewijs dat het gedrag terug is.

Geen nieuwe designfantasie: iedere rij moet naar oude code en huidige owner
wijzen.

### 2. Herstel output en faultpresentatie

Herstel als één coherente flow:

- fysieke print/system-output naar BIOS-terminal;
- dezelfde voltooide output naar browserconsole/hostlog;
- supervisorfault naar rijke IDE-toolingstate;
- auto-open bron + overlay;
- exceptionnavigation, inclusief de bedoelde `Ctrl+E`-actie.

Laat de BIOS niet van de IDE afhangen en laat de IDE niet rechtstreeks in CPU-
interne objecten graven.

### 3. Herstel execution debugging

Port de functionele contracten uit de decembercommits naar de huidige fysieke
CPU/scheduler. Ontwerp eerst de minimale TS/C++ hookrepresentatie en toon de
normale fast path. Herstel daarna in deze volgorde:

1. breakpoint stop;
2. continue;
3. step-in;
4. echte step-over;
5. step-out;
6. fault resume/`CONT`.

Een breakpoint dat alleen in de gutter staat is niet geïmplementeerd.

### 4. Herstel monitor-audio als machinefeature

Pas dit pas aan nadat de huidige APU-cycle- en outputringownership in TS en C++
expliciet naast elkaar staat. Geen silence queue. Bewijs live:

- muziek stopt direct bij supervisor-entry;
- monitorinput en display blijven werken;
- muziekpositie blijft behouden;
- `CONT` hervat direct;
- herhaald open/sluiten bouwt geen latency op;
- browser en libretro gedragen zich hetzelfde.

### 5. Los de cartregressie pas op vanuit de eerste verkeerde producer

Reproduceer de `pietious` non-table fault en gebruik de herstelde faulttooling om
de exacte source/stack te vinden. Voeg geen `type(...)`, `nil`-fallback of
`ensure_*` toe. Controleer vooral recente cartlibcommits vanaf:

```text
493e35ec5 refactor(cartlib): allocate AEM records only for queued plays
814ef32fc refactor(cartlib): split ECS systems by owner
de0a7934d refactor(cartlib): flatten retained visual state
703abb090 refactor(cartlib): split component owners
d461e97ce refactor(cartlib): make state runtimes opt in
5f597326f refactor(cartlib): compile input and FSM runtime state
235e5ad87 refactor(cartlib): dispatch direct event values
e562e0761 refactor(cartlib): own retained GX rendering
67199843d refactor(cartlib): compose ECS systems directly
740dc418c refactor(cartlib): remove obsolete shared surfaces
f1b6e2beb refactor(cartlib): compose prefab features at their owners
```

`CARTLIB-SURFACE-01` blijft open in `docs/open_architecture_slices.md`, maar
gebruik dat niet als excuus om nog meer API te herschrijven voordat de concrete
regressie is gelokaliseerd.

## Validatiecontract

Gebruik bestaande runners en bestaande timelines; voeg geen synthetische
fixturetests toe om de implementatie groen te verklaren.

Minimaal:

```sh
npm run audit:core-parity
npm run headless:forcebuildallrun -- bare_metal_cart
npm run headless:forcebuildallrun -- pietious
npm run headless:forcebuildallrun -- 2025
```

Voor echte TS/C++-beeldpariteit bestaan onder meer:

```sh
npm run test:render-parity
npm run run:libretro-host:wsl:headless
```

De exacte cart/timeline-argumenten moet je uit de bestaande scripts onder
`tests/carts/**` halen. Een proces dat tot het einde draait is geen bewijs:

- bekijk representatieve screenshots;
- vergelijk TS en C++ op dezelfde inputtimeline;
- controleer terminal/faultframes inhoudelijk;
- test `pietious` meerdere minuten actief in World 1;
- test `2025` combat, skip en reboot;
- test browseraudio live;
- test libretroaudio live op oplopende latency;
- open/sluit monitor herhaald en controleer onmiddellijke audioresume;
- plaats een echt breakpoint en bewijs dat execution stopt;
- bewijs step-over met een call, niet met een rechte instructiereeks;
- forceer een Lua-fout en bewijs BIOS-monitor, browserconsole, IDE-overlay,
  source navigation en resume als één flow.

Registreer eerlijk wat niet live kon worden bewezen. Noem builds nooit
"headless runs" en noem headless runs nooit "de spellen werken" zonder de
frames te inspecteren.

## Breder open werk

`docs/open_architecture_slices.md` is de huidige werkvoorraad. Bij overdracht
staan daar onder andere nog:

- `TOOLCHAIN-BULLSHIT-01`;
- `PARITY-COVERAGE-01`;
- `PERF-RUNTIME-01`;
- `CARTLIB-SURFACE-01`;
- live backend-, GX-, supervisor-, performance- en SNES Mini-gates.

Verwijder afgeronde regels uit die lijst. Voeg de terminal/debuggerrecovery pas
als open slice toe als dat nodig is voor overdraagbaarheid; gebruik de lijst
niet als dagboek van kleine edits.

## Eindcriteria voor deze recovery

De recovery is pas klaar wanneer alle onderstaande beweringen met live bewijs
waar zijn:

- de BIOS-monitor is een fysiek ROM-programma en niet afhankelijk van IDE-
  objecten;
- de CPU is een CPU en kent geen source/debugger/host-DTO's;
- BIOS-monitor en IDE tonen dezelfde fysieke fault op hun eigen detailniveau;
- fysieke console-output bereikt terminal en hostconsole zonder dubbele
  guestsemantiek;
- exceptionoverlay en bronnavigatie zijn hersteld;
- breakpoints en alle stepmodi sturen execution werkelijk;
- `CONT` hervat een resumable machinecontext;
- monitor-audio stopt en hervat zonder extra buffer of latency;
- TS en C++ gebruiken hetzelfde machinecontract;
- `bare_metal_cart`, `pietious` en `2025` zijn inhoudelijk bekeken in beide
  runtimes;
- de concrete `pietious`-fault is bij zijn producer opgelost, niet verborgen;
- er is geen compatibility-, legacy- of corrupt-statefallback toegevoegd.

Als een van deze punten alleen door een hostspecial-case, nieuwe buffer, guard,
wrapper of CPU-debugobject haalbaar lijkt, stop dan en corrigeer eerst de owner
of representatie.
