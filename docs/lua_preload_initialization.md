# Vooraf geladen modules en herhaalbare tracecompilatie

Datum: 2026-09-13. Ownerbesluit vóór implementatie.

## Productgrens

Een recorder die pas bij `entry` wordt gekoppeld mist registraties in normale
module-initializers. Bovendien wissen IDE-herbouw en Hot Resume nu opnieuw
alle traces, ook wanneer het geïnstalleerde programma geselecteerde kanalen
bevatte. Beide problemen horen bij de uitvoerproducer, niet bij BIOS, de CPU,
een extra cart-socket of een hostaanroep naar cartlib.

Lua 5.4.8 voert de expliciete [`-l`-modules][lua] vóór het script uit.
LLVM AddressSanitizer produceert een [expliciete vroege initializer][asan],
in plaats van te wachten op een eerste UI-consument. Clang bewaart ook
[compilatie-instellingen in debugmetadata][clang]. De daadwerkelijke code is
gelezen; BMSX neemt hun ownergrens over, niet hun dynamic loader of native ABI.

## Contract

- `preloadModules` zijn geordende canonieke bronmodulepaden in de bestaande
  compilatie. De bestaande require-DFS verzorgt afhankelijkheden, eenmalige
  initialisatie en cyclusdiagnostiek. Preloads komen vóór entry-afhankelijkheden,
  maar nooit vóór hun eigen afhankelijkheden. Geen tweede loader of prioriteiten.
- De normale startup voert eerst section-init uit, daarna dezelfde modulelijst
  en tenslotte entry. `<init>` houdt zijn bestaande betekenis; een Hot Resume
  voert moduleconstructors niet opnieuw uit om een recorder te resetten.
- Compiler- en gelinkte debugmetadata bewaren `preloadModules` en
  `traceStatements`. De IDE neemt beide rechtstreeks over voor boot-herbouw
  en Hot Resume, afzonderlijk voor SYSTEM en iedere cart. De actuele instelling
  is niet afgeleid uit constants, bronspelling of aanwezige tabellen.
- De transportrepresentatie van exacte kanaalselectie is een stringlijst;
  de compiler bouwt daar één lookup-set van. Geen Set/array-conversies in
  IDE-features en geen selectiecheck in uitgevoerde guestcode.
- Gewone builds kiezen nog steeds erasure en geen preloads. Dit schakelt niet
  automatisch de meetrecorder in als Studio-productopslag. Een opname die niet
  heeft plaatsgevonden wordt bij late attach niet alsnog gereconstrueerd.

## TS/C++-representatie en callsites vóór de diff

| Owner | TypeScript | C++ | Uitvoering |
| --- | --- | --- | --- |
| `traceStatements` | `'erase' \| 'emit' \| readonly string[]` | string/vector-variant in toolingmetadata | Alleen compiler en symbols-codec; geen machinewaarde. |
| `preloadModules` | `readonly string[]` | `vector<string>` met dezelfde naam | Alleen compiler-startupplanning en toolingmetadata. |
| Compilatie | Bestaande `FunctionBuilder.markStaticModulePath`, `compileStartup`, `compileBlua32TraceStatement` | Geen C++ broncompiler | Bestaande CALL/CLOSURE/GET/SET; geen nieuwe opcode. |
| Hot Resume | `buildBlua32Media` leest geïnstalleerde metadata | Geen host-Lua-hercompiler in libretro | Geen nieuwe guestcall of herinitialisatie. |
| Symbols | `Blua32DebugMetadata`, linker, symbols versie 8 | Gespiegelde metadata/codec, versie 8 | Koude toolinglaag; geen header-, MMIO- of deviceveld. |
| Hot paths | CPU-dispatch, BT-evaluate, services, FSM/AE-ticks | Dezelfde ongewijzigde datapaden | Geen nieuwe callsite of werk per tick. |

De gekozen modules moeten echte bronmodules van de build zijn. Het algemene
productbeleid dat recorderbronnen toevoegt en kanalen kiest blijft bij de
toolingproducer; deze compiler kent geen BT/FSM/Studio-modulenamen.

## Bewijsgates

O0/O3: preload plus afhankelijke modules vóór module-scope registratie,
gedeelde dependencies éénmaal, meerdere roots, constmodules, cycli, uitgeschakelde
kanalen en initvolgorde. Gewiste/default uitvoer blijft bytegelijk.
Symbols-codecs behouden beide instellingen; de echte IDE Save/Reboot/Hot Resume
mag de listener of zijn heap niet vervangen of stilzwijgend traces wissen.

Compacte BT-opslag, automatische Studio-toelating, authored-sourcecorrespondentie
en coherente live graphstate blijven aparte gates, geen afgeleide claim van
een geslaagde compiler- of workflowproef.

## Uitgevoerd bewijs

- Vijf O0/O3-compiler-/CPU-proeven slagen, inclusief echte cartlib-compilatie
  vanuit een module-initializer. Default/lege preloadconfiguratie verandert
  de executable niet. Volledige Lua-suite: **1789 geslaagd, 1 bestaande skip**.
- Rompacker: **124/124**. TS en C++ symbols-codecs behouden geselecteerde,
  gewiste, volledig uitgezonden en lege kanaalselectie plus preloadvolgorde.
  Het native `bmsx_rompack_format_tests`-target slaagt.
- `--studio-preload` bouwt een zelfstandige Lua-cart via de normale scanner,
  dependency closure, compiler, linker en packager. De drie rendererprojecten
  bewijzen eerste opname vóór entry, late normale instance-inspectie,
  no-change init, gewijzigde Save/Hot Resume, mislukte compilatie,
  bron-Undo met Save/Reboot en rewind. De twee Hot Resume-routes behouden
  dezelfde recorder/actor; Reboot maakt terecht een nieuwe heap. Een niet
  geselecteerde ticktrace blijft in iedere geïnstalleerde revision afwezig.
- De bronstatus is na Hot Resume, Save/Reboot en rewind aantoonbaar `applied`.
  De volledige bestaande `--studio`-workflow slaagt eveneens op software,
  WebGL2 en WebGPU. IDE-typecheck en core-parity-/boundary-/indentatie-audits
  slagen. De test-typecheck behoudt zijn 46 bestaande diagnostieken.
- Geen nieuw werk in de CPU- of BT-tickpaden. De bestaande kostenproeven
  behouden dezelfde cycli/allocaties; een geselecteerde lookup-set wordt alleen
  bij compilerconstructie gemaakt. De eerdere recorderretentie is niet verlaagd.

De aanvullende volledige replayproef op deze nieuwe fixture vond een aparte
save-stategrens: alleen `cpuState.instructionBudgetRemaining` verschilt na
restore (7344 versus 9673). Bestaande historytests normaliseren dit veld al.
Deze slice claimt daarom geen geslaagde volledige native replay. Het
call-local uitvoeringsbudget moet bij zijn eigen CPU/scheduler-stateowner
worden onderzocht, niet weggefilterd in een extra testpad.

Reproduceren:

```sh
npx tsx --test --import ./tests/lua/test_setup.ts tests/lua/preload_module.test.ts
node tests/conformance/runtime_replay/browser.mjs --studio-preload dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom
```

[lua]: https://github.com/lua/lua/blob/v5.4.8/lua.c#L635-L654
[asan]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/lib/Transforms/Instrumentation/AddressSanitizer.cpp#L2732-L2786
[clang]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/CodeGen/CGDebugInfo.cpp#L691-L698
