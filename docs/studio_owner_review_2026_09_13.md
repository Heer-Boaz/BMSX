# Herreview van de recente Studio-/inspectieslices

Reviewbasis: de 21 lokale slices `c30009e07..1d43d4b1b`, tegen de live owners.
Dit is een review met herstelwerk, geen verklaring dat de hele Studio af is.

## A01 — Waardebeschikbaarheid koos onbedoeld de functieaanroep

**Aangetoond in O0 en O3.** `readRuntimeLuaValue` filterde iedere lokale slot
eerst op liveness en zocht daarna verder door de stack. Een recursieve functie
met een niet-beschikbare local in de binnenste aanroep kreeg daardoor de waarde
`11` uit een oudere aanroep. De declaratie was gelijk, de invocation niet.
Het eerdere verwijderen van global-/interpreterfallbacks had dit niet opgelost.

[LLDB `StackFrame::FindVariable`][lldb] kiest binnen een concrete frame/scope een
variabele en vraagt daarna haar ValueObject op. Een ontbrekende locatie is geen
aanleiding om een oudere recursieve aanroep te proberen. [VS Code debug hover][hover]
leest eveneens scopes van de gekozen frame, niet van de eerste frame met een
leesbare waarde. Beide daadwerkelijke implementaties zijn opnieuw gelezen.

**Ownerbesluit vóór de fix:** de BMSX-bronhover kiest de binnenste actieve
invocation die de geschreven binding bezit, rekening houdend met de bestaande
inline-context. Pas daarna worden lexical scope, initialisatiepositie en
registerliveness getoetst. Een niet-beschikbare waarde beëindigt die query.
Dezelfde regel geldt voor de vastgelegde faultstack; niet alsnog de huidige
BIOS-stack of een oudere invocation lezen.

De bestaande inliner sluit self-inlining en herhaalde functies in een inline-
chain uit. Verschillende niet-actieve inline-callsites blijven daarom
verschillende kandidaten; een niet-passende callsite is geen gekozen frame.
Een fysieke functie zonder bron-PC kan wel de binding bezitten, maar levert
geen leesbare locatie. Globals en werkelijke captures houden hun eigen opslag.

Geen nieuwe CPU-velden, guestobjecten, snapshotcodec, evaluator, fallback of
debugger-only registerwrites. De correctie hoort bij source-to-storage-
resolutie in `ide/runtime/lua_inspection.ts`. Dit bouwt geen expliciete
stackframekiezer in de UI en claimt geen volledige optimized-value recovery.

**Hersteld en gericht bewezen:** dezelfde bestaande compiler/CPU-testfixture
dekt dode locaties, nog niet bereikte initialisatie, verlaten blocks en een
wel beschikbare binnenste local in O0/O3. Elk geval leest ook de faultsnapshot
nadat de fysieke CPU-stack is vervangen. De bestaande inlining-, capture-,
WIDE-, nil- en source-generationproeven blijven gelden.

De echte Studio-proef gebruikt een recursieve callback in haar onafhankelijke
Lua-fixture: Save/Reboot, breakpoint, bronhover en Continue lopen via de
productowners. De hover meldt unavailable, niet `11`, en verandert bron,
guestheap of cycles niet. Software, WebGL2 en WebGPU slagen alle drie, inclusief
de bestaande no-change/changed Hot Resume, gedeeltelijke rebind/binding-stops,
imported callbacknavigation, compile rejection en rewind-inspectie.
Een hardcoded callbackregel in de catalogusproef is daarbij vervangen door de
positie in de eigen fixture, niet door een nieuwe vaste regel of een cartnaam.

## Andere opnieuw gecontroleerde grenzen

Dit zijn gerichte ownercontroles, geen bewijs dat iedere regel in de 21 commits
of elke mogelijke gebruikersflow correct is.

| Grens | Controle / conclusie |
| --- | --- |
| Bron versus geladen state | Graphbewerkingen schrijven echte `EditorTextModel`-bronnen. Runtime-inspectors lezen bestaande tabellen/closures en voeren geen callback uit. Geen tweede authored graph, resourceformaat of hostwereld. |
| Cartlib-koppeling | FSM/BT/ActionEffect-readers zijn bewust cartlib-specifieke debuggerprojecties. Bijvoorbeeld de registrycapture `definitions_by_id` komt uit de werkelijke setterclosure en compiler-owned capture-origins. Dit is geen taal-onafhankelijke inspector; bij een cartlib-layoutwijziging moeten die adapters mee veranderen. De semantic binder kent deze velden niet. |
| Gedeeltelijke FSM-rebind | Het vermoeden dat `state_ids` naar nog niet gemaakte children zou wijzen is getoetst aan `rebind_definition_tree` en de constructor: children worden eerder gepubliceerd dan de nieuwe idlijst. Geen speculatieve nil-guards toegevoegd. |
| Guestrepresentatie | Classificatie loopt via de bestaande ValueTag-/table-/closure-owners. Metatable-reads volgen de machineimplementatie. Onbekende bronherkomst wordt niet geraden uit objectnamen of registratieplaatsen. |
| Levensduur inspectie | Editor-deactivation, expliciete guestcalls en state restore beëindigen geleende picker-/inspectorwaarden. De liveproef controleert dat oude projecties verdwijnen, ook bij rewind. |
| Multi-file edits | Eén gedeeld history-element staat in alle deelnemende modelstacks. Conflicten splitsen de bewerking niet en rollen geen state terug. De resource-unie van een composite input is bewust input-lifetime: een verwijderd importstatement mag Undo/Save van eerdere wijzigingen niet kwijtraken. |
| Trace / 33 MHz | BT-observatie zit op compilation/bind, niet op tick. Niet-geselecteerde traces worden vóór argument-lowering gewist; de recorder is opt-in `testlib`, niet normale Studio-admission. De named columns bewaren alleen waargenomen loweringdata; zij zijn geen extra runtime-executiongraph. |
| Preloads / hardware | Preloads zijn gewone compiler-owned require-afhankelijkheden. Trace-/preloadkeuzes zitten in toolingmetadata voor rebuild, niet in extra CPU-opcodes, cartslots of hardware-capabilities. |
| Checkpoints / presentatie | Execution grants zijn schedulerwerk, geen rewindstate. Scanoutafmetingen en host-presentatiedoel zijn gescheiden; de echte drie-backendproef bewaakt ook die maatgrens tijdens restore. Geen nieuwe machinevelden in deze herstelpatch. |

**Niet stilzwijgend afgemaakt:** automatische observatie-admission, mapping van
lowering-occurrences terug naar authored nodes en coherente graphprojectie tijdens
een onafgemaakte rebind blijven afzonderlijke ontwerp-/implementatiegates. Een
catalogus of succesvolle runtime-read bewijst die functionaliteit niet.

[lldb]: https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/lldb/source/Target/StackFrame.cpp#L1812-L1847
[hover]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/debugHover.ts#L493-L521

## Validatie A01

- `test:lua`: **1799 geslaagd, 1 bestaande skip**, 1800 tests.
- `--studio-runtime-inspection`: **software / WebGL2 / WebGPU PASS**;
  foutbewaking actief en gerenderde hover gecontroleerd.
- IDE-typecheck en browser-Studio-productbuild geslaagd.
- Tests-projecttypecheck: dezelfde **46 bestaande diagnostics**, geen nieuwe
  ten opzichte van `/tmp/bmsx-bt-columns-test-types.log`.
- Core-parityaudit, strikte boundaryaudit (**0 issues**), indentation en
  `git diff --check` geslaagd.
- Geen nieuwe C++-/machinecode in A01; deze browserproef wordt niet als een
  nieuwe native runtime- of SNES-mini-performanceproef gepresenteerd.

## A02 — Een afgeronde Promise was nog geen geldige navigatie

**Aangetoond:** de geregistreerde opener voor `older.lua` wordt vertraagd; een
nieuw verzoek opent `newer.lua`; afronden van het oude verzoek activeert alsnog
`older.lua`. De test gebruikt de bestaande `ResourceEditorResolver`- en pane-
owners. In het product kan AEM-source-admission daadwerkelijk op storage wachten.
De recente `await`-correctie voor debuggernavigation loste attachmentvolgorde op,
maar niet de levensduur van een opening. Dit is een algemenere workbenchfout,
niet een cartlib- of Behavior Lens-regel.

[VS Code `EditorPanes.doSetInput`](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/browser/parts/editor/editorPanes.ts#L425-L484)
start een opening-operation, laat een nieuw verzoek de oude beëindigen en
rapporteert cancellation vóór focus/volgacties. De daadwerkelijke productiecode
is gelezen, niet alleen de publieke API.

**Ownerbesluit vóór de fix:** de pane-owner bezit de open-generation. Een nieuw
async verzoek, directe pane-opening of pane-teardown beëindigt het recht van
oudere verzoeken om te activeren. Resource-admission blijft bij de resolver/model-
service; een geannuleerde opening wist geen bronmodel en breekt gedeelde I/O niet
af. De navigatiecaller krijgt expliciet te horen of attachment doorging, zodat
bijbehorende debugger/fault-effecten niet alsnog op de huidige tab landen.
Back/Forward onderdrukken history-capture alleen tijdens hun synchrone commit,
niet tijdens bestands-I/O; andere gebruikersnavigatie blijft haar eigen history
houden. Geen timeout, Promise-queue die achter trage I/O blijft wachten, fallback-
tab of per-feature requestcounter.

**Hersteld:** `EditorPanes` bezit één generation, ook bij opnieuw kiezen van de
al actieve tab en bij `clearEditor` zonder actieve pane. De bestaande IDE-
deactivation gebruikt die teardown al; er is geen extra featurehook nodig.
Navigation geeft de **attachment-generation** terug, niet slechts `true`:
tussen attachment en de debuggercontinuation kan alweer een andere tab gekozen
zijn. Ook die ingeplande continuation mag geen stopmarker/cursor plaatsen.
Geannuleerde inputkandidaten worden vrijgegeven tenzij dezelfde input al in de
groep zit. Workspace-modellen en gedeelde reads blijven van hun eigen service.
De resourcepanel-selectie wordt pas na admission gepubliceerd.

De onafhankelijke navigatieproef dekt resource-opening én Back/Forward, onderbroken
door nieuwe navigation, een directe tabkeuze, herselectie van dezelfde tab of
teardown. Zij controleert ook candidate-disposal, behoud van een reeds groeps-
owned input, vrije history-capture tijdens I/O en de microtask tussen source-
attachment en debuggerdecoratie. De echte Studio-proef opent daarnaast AEM en
Lua achter elkaar via de normale bijdragen en verlaat/heropent de IDE tijdens
een pending source-opening. Geen gesimuleerde resolver in die browserproef.

## Validatie A02 en afsluitende herproef

- Gerichte navigatie-/historysuite: **16/16 geslaagd**.
- Volledige `test:lua`: **1809 geslaagd, 1 bestaande skip**, 1810 tests.
- `--studio`: **software / WebGL2 / WebGPU PASS**, met de nieuwe echte
  AEM/Lua-openingrace en IDE-deactivation, naast de bestaande graphbewerkingen,
  Undo/Redo, focus/pointer, source navigation, Scenario Lab, pause/rewind,
  Hot Resume en source-failureproeven.
- `--studio-runtime-inspection` opnieuw op de uiteindelijke patch:
  **software / WebGL2 / WebGPU PASS**. A01 blijft werken met de nieuwe
  opening-lifetime; debugger/rebind/fault-continuations hebben geen parallel pad.
- Browser-Studio-product opnieuw gebouwd; IDE-typecheck geslaagd. Het tests-
  project houdt exact dezelfde **46 bestaande diagnostics** als de baseline.
- Core-parityaudit, strikte architectuurboundaries (**0 issues**), gerichte
  code-qualityscan van de navigation-/pane-owners, indentation en diffcheck
  geslaagd. De code-quality-uitzonderingsledger is daarmee niet verdwenen.

Er is geen nieuwe guest-tick-instrumentatie, rendererimplementatie of C++-
machinewijziging toegevoegd om deze twee IDE-fouten te herstellen. Deze review
is geen universele foutloosheidsgarantie of vervanging van de nog open productgates.
