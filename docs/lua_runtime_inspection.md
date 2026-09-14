# Lua-runtime-inspectie: bindings, locaties en levensduur

Datum: 2026-09-13. Vergelijkingsbasis: `36e9a1ca2`.
**Gebouwd:** de bestaande hover en runtime-memberaanvulling lezen geschreven
bindings uit de werkelijke guest. Dit is de leesbasis voor D2. De afzonderlijke
[ActionEffect-instance-inspectie](actioneffect_runtime_inspection.md) consumeert
dezelfde guest-owner in de Behavior Lens. De [FSM-/ActionEffect-catalogus](behavior_definition_catalog.md)
leest inmiddels ook bestaande modulecaptures via de gespiegelde read-only
`CPU.readClosureUpvalue`, zonder dat de closure op de stack hoeft te staan.

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
  context en capture-origins. Eerst wordt de binnenste actieve invocation van
  die binding gekozen, pas daarna haar waardelocatie. Een niet-beschikbare local
  mag niet de waarde uit een oudere recursieve aanroep opleveren. Een initializer
  die nog in zijn callee staat heeft nog geen beschikbaar resultaat in de nieuwe
  local. De [herreview en recursieproef](studio_owner_review_2026_09_13.md#a01--waardebeschikbaarheid-koos-onbedoeld-de-functieaanroep)
  leggen de gevonden verborgen fallback en correctie vast.
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

De vervolgreader consumeert ook compiler-owned module-exportslots en kan
opgeslagen tabelentries bezoeken zonder numerieke/referencekeys naar strings
om te zetten. Een gekoppelde callbackbron komt uit het werkelijke closureadres
**plus de actuele CPU execution-busmapping**, niet uit een scan van beide carts
of hun source-id. De gedeelde read-session beëindigt kortlevende UI-borrowers bij
editor-deactivation, expliciete guestcalls en restore. Zie het vervolgcontract
voor de kleine gespiegelde read-only CPU-accessor, concrete kosten en tests.

## Compiler-, formaat- en TS/C++-contract

| Gegeven | TypeScript | C++ |
| --- | --- | --- |
| Wordinterval | `ProgramWordRange { start, end }` in compiler `word_range.ts` | Dezelfde velden in tooling `word_range.h`, `i32` |
| Local metadata | `LocatedLocalSlotDebug` / `Blua32LocalSlotDebug.liveWordRanges` | `Blua32LocalSlotDebug.liveWordRanges` |
| PC-query | `blua32LocalSlotLiveAtPc(slot, codeAddress, pc)` | Dezelfde naam, argumenten en binaire zoekberekening |
| Symbolen | Actuele structuur, bestaande binary-codec, geen schemaversie | Dezelfde structuur en codec |

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

Debug-ROMs/sidecars moeten na formaatwijzigingen opnieuw worden gebouwd; writer
en reader veranderen samen. Geen schemaversie, migratie of compatibility reader.

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

- Algemene actorselectie en bewezen definitie-Source-/write-targetcorrespondentie.
  Gerichte FSM-/ActionEffect-instances en actorloze catalogi zijn inmiddels
  afzonderlijk gebouwd; zie de gelinkte vervolgslices.
- D3's BT-topologiecorrespondentie door lowering, met afzonderlijke opslag-/GC-
  metingen; geen closure-decompilatie of extra boom per actor.
- Volledige optimized-variable recovery (constants, verhuisde locaties) is
  niet door alleen named-register-liveness opgelost.

De afzonderlijke glyph-/viewportfout uit deze proef is daarna hersteld bij de
[presentatiemaat-owner](host_presentation_sizing.md). Rewind wijzigde het doel
naar de scanoutmaat terwijl de IDE haar vaste layout behield; ook software kapte
het werkvlak af. De gedeelde fixture bewaakt nu de maatgrens en de inspectiedriver
vergelijkt de echte menubalkpixels op de drie renderers. Dit was geen inspectie-
of symbolenregressie en is niet met een fontcorrectie opgelost.

De zichtbaar geworden donkere tekst op een donkere hoverachtergrond is daarna
bij de bestaande theme-owner hersteld. Zoals [VS Code's hoverrollen][hover-colors]
behoren foreground, background en border bij dezelfde widget, niet bij een
statusbalk. Beide BMSX-thema's gebruiken daarvoor bestaande palettekleuren en
een opaque achtergrond; de oude vaste translucent hoverkleur vervalt. Geen
contrastberekening in draw of nieuw kleur-/widgetframework. De kleurproef toetst
de [7:1-contrastgrens][contrast] zonder daarmee volledige WCAG-conformiteit te
claimen. De live inspectieproef bedient ook de gewone thema-shortcut en **Alt-
hover**, niet alleen de provider, en controleert de werkelijk getekende
foreground-/backgroundpixels op de drie renderers. De gedeelde pointerproef
consumeert nu `resolveTextPositionBounds` in plaats van diens glyphprojectie
nogmaals in het harnas te implementeren.

De hoververvolgslice doorstaat de inspectie- en volledige Nemesis-navigatieproef
op software, WebGL2 en WebGPU, 1762 Lua-tests (1 bestaande skip), IDE-typecheck,
browser-productbuild, beide architecture/core-parity-audits en indentationcheck.
De tests-projecttypecheck blijft op dezelfde 48 bestaande diagnostics als na
de presentatiemaatfix; de hoverwijziging voegt er geen toe.

[lldb]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/lldb/source/Target/StackFrame.cpp
[locations]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/lib/CodeGen/AsmPrinter/DebugLocStream.h
[live-values]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/lib/CodeGen/LiveDebugValues/VarLocBasedImpl.cpp
[vscode-model]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/common/debugModel.ts
[vscode-session]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/debugSession.ts
[dap]: https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md
[hover-colors]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/platform/theme/common/colors/editorColors.ts#L187-L197
[contrast]: https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html
