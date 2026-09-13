# Herreview van de recente Studio-/inspectieslices

Reviewbasis: de 21 lokale slices `ff4874936..1d43d4b1b`, tegen de live owners.
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
