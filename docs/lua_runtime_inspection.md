# Lua-runtime-inspectie: bindings, locaties en levensduur

Datum: 2026-09-13. Vergelijkingsbasis: `36e9a1ca2`.
**Gebouwd:** de bestaande hover en runtime-memberaanvulling lezen geschreven
bindings uit de werkelijke guest. Dit is de leesbasis voor D2, geen nieuwe
Behavior Lens-runtimeweergave of geladen-definitiecatalogus.

## Professionele referenties en afbakening

- [LLDB `StackFrame`, LLVM 20.1.8][lldb] onderscheidt lexical scope van een
  geldige variabelelocatie in een frame. `GetInScopeVariableList` en
  `FindVariable` zoeken niet simpelweg iedere waarde met dezelfde naam.
- [LLVM `DebugLocStream`, 20.1.8][locations] bewaart locatiebereiken per
  variabele/inliningcontext. [LiveDebugValues][live-values] volgt waar een
  waarde beschikbaar blijft en waar een write/clobber die locatie beëindigt.
- [VS Code `debugModel`, 1.104.0][vscode-model] koppelt children/scopes aan
  debuggerreferenties. [`debugSession`][vscode-session] beëindigt oude requests
  en callstacks bij Continue. De [DAP-specificatie][dap] begrenst de levensduur
  van variablereferenties tot de suspended state.

**BMSX-afleiding:** de compiler produceert de geldige registerlocaties; de IDE
combineert die met de geschreven lexical binding en de actuele stop. Geen
interpreterfallback, source-evaluatie, reflectie op hostobjecten of extra guest-
debugvelden. Dit is niet LLVM's volledige DBG_VALUE-/spill-/constant-recovery:
BMSX publiceert conservatief alleen live named registers. Een weggeoptimaliseerde
waarde zonder locatie blijft expliciet unavailable, niet de waarde die de IDE
uit een literal denkt te kunnen reconstrueren.

## Gevonden fouten en hun owners

1. De oude IntelliSense-reader probeerde CPU-locals op naam, vervolgens globals
   en daarna een tooling-interpreter/native-objectpad. Een niet-beschikbare
   local kon zo veranderen in een andere waarde. Dat pad is verwijderd, niet
   achter een nieuwe interface verstopt.
2. Een O3-proef met `local value = 11; halt_until_irq; return value` verwijderde
   de registerwrite terwijl de oude symbolen nog de oorspronkelijke localslot
   noemden. Een debugger mag dat register niet als actuele `value` lezen.
3. PC en framediepte kunnen zich herhalen. Zij zijn geen volledige cachekey
   voor een waarde die tijdens uitvoering of `<init>` verandert.
4. De bestaande memberpad-reader gaf ook `nil` terug bij dereferencing van een
   niet-tabel. De read-owner onderscheidt nu een echt nil-member van een pad
   dat niet gelezen kan worden, zonder iets in de guest uit te voeren.

`ide/runtime/lua_inspection.ts` bezit nu de source-to-storage-resolutie. De
semantic binder blijft immutable en levert alleen geschreven bindings. De
runtime-reader vraagt geen workspace-value/factory-expansie op.

## Leescontract

- Alleen de bestaande identifier-chain-parser laat read-only memberpaden toe.
  Calls, getters of callbacks worden niet uitgevoerd voor inspectie.
- De bronbytes moeten overeenkomen met de geïnstalleerde bron van hetzelfde
  resource-domain. Edited/unloaded bron is expliciet unavailable; Undo naar
  dezelfde geïnstalleerde bytes kan weer gelezen worden.
- Een local/parameter/receiver wordt gekozen op zijn exacte geschreven
  declaratie, niet op de naam van de binnenste toevallige CPU-local. De reader
  consumeert de bestaande modulepath-conversie, lexical scope, inline-callsite
  context en capture-origins. Een initializer die nog in zijn callee staat
  heeft nog geen beschikbaar resultaat in de nieuwe local.
- Globals volgen de werkelijke system-/ordinary-registerfile. De twee carts
  krijgen geen verzonnen afzonderlijke global heaps. Fysieke stackframes
  worden wel per execution-domain geselecteerd.
- Gewone stops gebruiken de volgende frame-PC; een caller gebruikt de
  callsite-PC van zijn callee. Een vastgelegde fault gebruikt diens trace-PC,
  registers en captures, ook als firmware de fysieke CPU-stack heeft vervangen.
- `nil` is een echte guestwaarde. Unavailable is geen `nil`, lege definitie of
  aanleiding om een ander register of interpreter te proberen.
  `table.missing` kan nil zijn; `table.missing.value` heeft daarmee nog geen
  leesbare waarde. `SuspendedGuestSession` bezit ook dat onderscheid.
- Het resultaat is een geleende VM-waarde, onmiddellijk geformatteerd of tot
  completionlabels verwerkt. Het publiceert geen vermoedelijke definitiebron.
  Het kennen van de root-binding bewijst niet waar een heapmember is gemaakt.

De hostprojectie van hover blijft retained. De querykey omvat resource-domain,
bron/snapshot, PC/diepte, scheduler-cycles, geïnstalleerd mediaobject en de
faultsnapshot. De bestaande view-deactivation en `Runtime.onStateRestored`
beëindigen de query. Geen per-feature stopcounter, heapcopy of retained gast-
tabellen. De verwijderde native-membercache heeft ook geen clear-facade meer
op `CartEditor`, AEM-installatie of Hot Resume nodig.

## Compiler-, formaat- en TS/C++-contract

| Gegeven | TypeScript | C++ |
| --- | --- | --- |
| Wordinterval | `ProgramWordRange { start, end }` in compiler `word_range.ts` | Dezelfde velden in tooling `word_range.h`, `i32` |
| Local metadata | `LocatedLocalSlotDebug` / `Blua32LocalSlotDebug.liveWordRanges` | `Blua32LocalSlotDebug.liveWordRanges` |
| PC-query | `blua32LocalSlotLiveAtPc(slot, codeAddress, pc)` | Dezelfde naam, argumenten en binaire zoekberekening |
| Symbolen | Versie 7, bestaande binary-codec | Versie 7, bestaande binary-codec |

Intervallen zijn halfopen, relatief aan het begin van de definitieve functie,
in instructiewoorden. WIDE-prefix en opcode behoren tot hetzelfde bereik.
De compiler reserveert named registers zonder lokale recycling; de inliner
remapt registers en scopes voordat de definitieve locaties berekend worden.
Een scope of declaratie alleen bewijst geen registerbeschikbaarheid.

`buildProgramDebugPoints` consumeert de bestaande CFG-livenesspass ook voor
locaties. De streaming visitor leent het actuele bitmap; alleen aaneengesloten
wordintervallen blijven behouden, geen bitmap per instructie en geen tweede
fixed-point-run naast resume-points. De bestaande resume-points houden hun
betekenis voor Hot Resume. Dit verandert geen instructies of registertoewijzing.

Callsites: compilerfinalisatie, sourcemapping/linker, symbolcodec en hover/member-
query. CPU dispatch, MMIO, scheduler, GC, cartlib-register/rebind/tick, snapshots
en renderers hebben **geen nieuwe callsite**. De C++-wijziging zit in bestaande
tooling, niet in een native Studio- of gameplayprotocol.

Debug-ROMs/sidecars moeten opnieuw worden gebouwd; de format-owner accepteert
geen oudere symbolenversie. Geen migratie of compatibility reader.

## Bewijs en kosten

- Onafhankelijke Lua-proeven op O0/O3: inactive local versus gelijknamige
  global, shadowing, echt nil versus interpreterwaarde, methodreceiver,
  pending initializer, folded local en WIDE-locaties met halfopen grenzen.
  Bestaande inline- en vastgelegde fault/capture-proeven blijven behouden.
- TS/C++-symbolproeven bewaren dezelfde ranges, gaps en lege locatieverzameling
  door encode/decode. De publieke parity-audit bewaakt ook deze velden en API.
  Een aanvullende TS → C++ → TS-proef op de echte BIOS- en Nemesis-symbolen
  behoudt de volledige gedecodeerde metadata: respectievelijk 4004/12167 locals
  en 18067/37482 wordintervallen.
- `--studio-runtime-inspection` gebruikt het bestaande Studio-harnas, de echte
  file-API en Save/Reboot. Een onafhankelijke entry gebruikt gewone cartlib-
  ActionEffects, twee echte componenten met afzonderlijke owners/clocks, één
  gedeelde definitie en een niet-uitgevoerde registratie met dezelfde effect-id.
  Dit is geen bewijs van een algemene world/actorpicker.
- De bestaande hover leest periode, cooldown en active count. De proef stopt
  midden in de echte rebind: eerst beide perioden 20, daarna één 30 en één 20.
  No-change `<init>` behoudt de media-identiteit maar verandert de definitie;
  gewijzigde bron/Hot Resume levert 48. Compilefout verandert geen guesttijd
  of installatie. Rewind leest een eerdere tick met de juiste definitie.
  Lezen verandert geen bronversie, guestheapbytes, clock of callbackteller.
- Deze inspectieflow, de volledige bestaande Studio-workflow en de afzonderlijke
  FSM initial/Hot-Resume-flow zijn uitgevoerd op software, WebGL2 en WebGPU.
  Functionele workflowasserties zijn geen algemene pixel-/UX-certificering.

Validatie: `compile:toolchain`, IDE-typecheck, 1760 Lua-tests (1 bestaande skip),
123 rompacker-tests, `bmsx_rompack_format_tests`, beide architecture/core-parity-
audits, indentationcheck en `git diff --check`. De tests-projecttypecheck heeft
dezelfde 51 bestaande diagnostics als de schone baseline; geen nieuwe.

De nieuwe live proef is reproduceerbaar met de bestaande driver:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio-runtime-inspection \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/runtime-inspection.png
```

Zoals bij de overige browserproeven wijst `BMSX_PLAYWRIGHT_MODULE` indien nodig
naar de geïnstalleerde Playwright-tooling. De driver kiest drie renderers en
maakt geïsoleerde workspaces; hij wijzigt geen gebruikersbestanden of storage.

Kostenvergelijking op dezelfde machine/Node 22, twee afzonderlijke processen per
variant, ieder twee warmups en acht gemeten compilaties; geen gelijktijdige builds
of browserproeven tijdens de meting. Dezelfde 179 Nemesis-programmodules en
vooraf geparste ASTs, O3:

| Meting | Voor | Na |
| --- | ---: | ---: |
| Compiler mediaan (16 samples) | 2421,67 ms | 2514,05 ms |
| Spreiding | 2337,99–2577,80 ms | 2417,16–2614,81 ms |
| BIOS executable image | 294780 bytes | identiek, inclusief SHA-256 |
| Nemesis executable image | 634588 bytes | identiek, inclusief SHA-256 |
| BIOS encoded symbols | 2723740 bytes | 2900998 bytes |
| Nemesis encoded symbols | 11090597 bytes | 11463054 bytes |

Dit kost hier circa 92 ms (+3,8%) bij een volledige compiler-run en extra
debugmetadata; **niet gratis**. Het is geen meting van interactieve workspace-
querylatentie en geen framebenchmark. De bytegelijke executables en ongewijzigde
runtime/cartlib-owners bewijzen dat deze patch geen extra guest-tickwerk of
guest-objectvelden toevoegt. Debug-ROMretentie op de host groeit wel.

## Open, niet als voltooid claimen

- D2's gerichte selectie/presentatie van geladen definitie en actor, een
  actorloze definitiecatalogus en bewezen Source-/write-targetcorrespondentie.
- D3's BT-topologiecorrespondentie door lowering, met afzonderlijke opslag-/GC-
  metingen; geen closure-decompilatie of extra boom per actor.
- Volledige optimized-variable recovery (constants, verhuisde locaties) is
  niet door alleen named-register-liveness opgelost.
- De afsluitende inspectiescreenshots tonen bij WebGL2/WebGPU beschadigd
  glyphbeeld na de reboot/rewind-flow. De softwareopname is leesbaar. Dit is
  ook gereproduceerd met de ongewijzigde productiecode en versie-6-ROMs van
  `36e9a1ca2` (dezelfde lifecycle, zonder de nieuwe runtimewaarde-asserties).
  Het is dus geen nieuw inspectie-/symbolenregressie, maar blijft een afzonderlijke
  render-/viewportfout. Functionele asserties zijn geen zichtbare rendererparity.

[lldb]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/lldb/source/Target/StackFrame.cpp
[locations]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/lib/CodeGen/AsmPrinter/DebugLocStream.h
[live-values]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/lib/CodeGen/LiveDebugValues/VarLocBasedImpl.cpp
[vscode-model]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/common/debugModel.ts
[vscode-session]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/debugSession.ts
[dap]: https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md
