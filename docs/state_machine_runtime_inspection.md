# FSM: gerichte inspectie van de geladen state

Datum: 2026-09-13. D2-vervolg op `ddf3fe2f5`.

## Vooraf getoetste productievoorbeelden

- [Godot AnimationNodeStateMachinePlayback][playback] bezit `current`, `playing`
  en instancevoortgang afzonderlijk van de AnimationNodeStateMachine-resource.
  De [editor][editor] leest de gekozen playback, niet een veronderstelde
  uitvoer uit de getekende bron. BMSX heeft geen gelijkwaardige `playing`-flag
  op iedere state: `current_id` is ook in inactieve takken bewaard.
- [VS Code VariablesView][variables] vraagt scopes op voor het gekozen
  stackframe en behoudt de projectie. BMSX kiest eerst een FSM-instance en
  leest alleen daarna zijn hiërarchie en de gekozen state's properties.
- [LimboAI LimboDebugger][limbo] onderscheidt de instancekeuze van de
  getrackte instance en laat de vorige tracking los. BMSX hergebruikt de
  bestaande suspended-guest-lifetime; geen nieuw debugregister of updatehook.
- [VS Code List.reveal][reveal] gebruikt de hele rijhoogte en behandelt een
  te grote rij afzonderlijk. De screenshotproef vond dat de BMSX-inspector
  alleen de labelhoogte revealde en daardoor een gekozen waarde buiten beeld
  kon laten. Hij geeft nu de volledige rij aan de **bestaande** scrollbar;
  die bezit al minimal-scroll en lead-alignment voor oversized items.
- [VS Code ScrollbarState][scrollbar] scheidt de scrollrange/ratio van
  afgeronde thumbgeometrie. De gepaarde screenshots vonden één logische
  thumb-randpixel verschil door fractionele BMSX-schermcoördinaten. De
  gedeelde scrollbar produceert nu integer thumbbounds. Capture bewaart de
  begin-pointer en scrollpositie en past de pointerdelta toe, zoals
  [VS Code AbstractScrollbar][scrollbar-drag]. De continue scrollpositie wordt
  niet terugberekend uit een afgeronde thumb. Daardoor verandert een
  muisklik zonder beweging de positie exact niet, ook bij negatieve ranges.
  Geen renderer-specifieke correctie of afronding van guestwoorden.

Dit zijn afgeleide ownershipkeuzes, geen nieuw cartlib-protocol. De code is
daadwerkelijk gelezen; Godot is hier een animatie-FSM-referentie, niet een
algemene Lua-FSM-interpreter.

## Live owners en afbakening

- `cartlib/registry.lua` indexeert `fsm_component`-instances. De IDE leest
  die dense type-index. `runtime_components.ts` is de bijdrage-eigen reader
  voor deze bestaande cartlib-representatie, gedeeld met ActionEffects.
- `fsm_component._machines_by_id` bevat werkelijk gebonden machines, ook
  meerdere per actor. De eerste kiezer leest uitsluitend deze roots.
- `state.states` en `state.state_ids` bevatten de bestaande runtimehiërarchie.
  De tweede kiezer loopt alleen de gekozen machine. Zijn labels gebruiken de
  echte `state.id`; de identiteit blijft de geleende tabel, niet die tekst.
- De inspector leest **`selected_state.definition`**. Tijdens rebind kan de
  root al de nieuwe definitie hebben terwijl een kind nog naar de oude wijst.
  `root.definition.states` is dan niet de definitie van dat runtimekind.
- `state.data` is mutable instancestate; `definition.data` zijn geladen defaults.
  Rebind laat bestaande data staan. Beide krijgen een eigen inspectierij.
- `state.current_id` is een bewaarde kindselectie, geen bewijs dat deze tak of
  actor draait. Component-start/enabled en current worden afzonderlijk getoond;
  de host voert `is_active`, guards, updates of andere getters niet uit.
- `compile_definition_transitions` wist `handler.source` en
  `input_event_handlers`. Het overblijvende plan is geen oorspronkelijke
  Lua-expressie. Event-/inputtargets worden expliciet als gecompileerde waarden
  getoond, zonder path-decompiler, auteurspijl of gesuggereerde bestemming.
- Behouden callbacks gebruiken de bestaande instruction-bus-/debugsymbolreader
  en exacte geïnstalleerde bronbytes. Scalars en plan-tabellen krijgen geen
  verzonnen source-/write-target. De huidige bronlens blijft apart bewerkbaar.

## UI, lifetime en kosten

De bestaande FSM-lens krijgt **Live**, ook bereikbaar via het nodecontextmenu
en `State Machine: Inspect Runtime Instance`. De gedeelde QuickInput verzorgt
instance- en statekeuze; de bestaande property inspector verzorgt lezen,
scrollen, callback-Source en sluiten. Geen nieuw persistent editorinput,
extra tab, graphdatabase of tweede working copy.
Wanneer inspector of sourcereview de graph vervangt, tekent de pane ook niet
diens oude bronselectie in de footer. Een geladen default krijgt dus niet
alsnog de regel van de onderliggende, nooit uitgevoerde registratie als status.

Beide kiezers lenen alleen zolang hun suspended read geldig is. Continue,
Hot Resume, editor-deactivation en restore sluiten de read via de bestaande
`SuspendedGuestSession`. De inspector bewaart daarna alleen tekst en exacte
callback-navigatiemetadata; een bronedit verandert niet de runtimewaarden.

Er wordt geen machine-, compiler-, C++- of cartlib-code gewijzigd. Alle
registratie-, rebind-, transition-, frame-evaluator- en GC-paden blijven gelijk.
Hostwerk: eenmaal de roots in de bestaande componentindex; daarna eenmaal de
geselecteerde machinehiërarchie; daarna alleen de gekozen state's velden.
Paint/scroll consumeren behouden rijen, niet guesttabellen. Geen hele heapscan,
per-actor definitiekopie, nieuwe gastallocatie, per-frame query of callbackcall.

Dit sluit niet de volledige definitiecatalogus (ook zonder instances),
allocation-/registratieherkomst, live mutatie of BT-topologieopname. Het legt
evenmin een runtimehighlight over een authored graph zonder correspondentie.

## Validatie

De bestaande onafhankelijke Studio-runtime-inspectieproef is uitgebreid met
echte FSM-registratie, twee componenten, drie machineroots en callbacks uit een
tweede normale Lua-bron. Die bron wordt via **New File** gemaakt; vervolgens
gebruikt de proef Save/Reboot/Hot Resume/rewind. Geen parallel test-runtime,
mocked inspector of afhankelijkheid van de huidige game-FSM-definities.

`browser.mjs --studio-runtime-inspection` slaagt op **software, WebGL2 en
WebGPU** en bewijst via de echte palette, toolbar, kiezers en contextmenu:

- De open bronregistratie heeft dezelfde id maar is nooit uitgevoerd en heeft
  andere children/defaults (`999`). Live toont uitsluitend de echte instances,
  niet deze bronkandidaat of de wel geregistreerde maar unattached definitie.
- De gekozen machine levert zeven states, inclusief nested/concurrente takken.
  De twee actors blijven afzonderlijk kiesbaar; één actor heeft twee machines.
- Midden in de echte rebind heeft de eerste root al defaults `20`, haar kind
  nog `10` en het kind van de tweede actor eveneens `10`. De inspector leest
  steeds de gekozen node; na Continue krijgen beide kinderen `20`. Instance-
  data (`10`, `111`, `222`) blijven onafhankelijk daarvan behouden.
- Update-, event- en inputclosures openen de echte tweede Lua-bron op de exacte
  functiepositie. Ook een vastgehouden Source-click wijzigt geen tekst, guest-
  heap, CPU-tijd of callbackcounter. Gewijzigde callbackbytes blokkeren alleen
  die Source-link; Undo herstelt hem. Geladen defaults hebben geen write-target.
- No-change `<init>`, gewijzigde installatie, de bestaande compilefoutproef en
  rewind gebruiken dezelfde productroute. Restore sluit zowel de geleende
  statekiezer als de inspector; een nieuwe selectie leest de herstelde state.
- Idle frames behouden dezelfde inspectierijen en gemeten tekst. De bestaande
  ActionEffect-inspectie blijft in dezelfde proef slagen.

De drie checkpoints (`fsm-state-instance`, `fsm-loaded-definition` en
`actioneffect-instance`) zijn visueel bekeken. Vergelijking van de 768×576
RGBA-readbacks geeft voor software tegenover beide GPU-backends **nul
afwijkende bytes**. De algemene `browser.mjs --studio`-workflows slagen ook
op alle drie renderers, inclusief graph/pointer- en editorroutes.

De gedeelde scrollbarproeven bewijzen integer thumbgeometrie, beide assen,
negatieve en fractionele contentcoördinaten, een kleine positieve scrollrange
en exact stilstaande content bij een thumbgrab zonder pointerbeweging.
De inspectorproef bewijst reveal van de volledige waarde en lead-alignment
voor een oversized rij.

- `npm run test:lua`: **1765 geslaagd, 1 bestaande skip, 0 fouten**.
- IDE-typecheck, browser-Studio-build, `audit:architecture-boundaries:strict`,
  `audit:core-parity`, `check:indent` en `git diff --check`: geslaagd.
- De tests-projecttypecheck heeft nog dezelfde **48 bestaande diagnostics**
  als de baseline, op dezelfde files/errorcodes; niet als groen gerapporteerd.

Met de bestaande median-meethulp kost de warme hostprojectie op deze kleine
fixture circa **0,005 ms** voor drie roots, **0,005 ms** voor zeven states en
**0,010–0,020 ms** voor de gekozen state's properties. Dit is een meting op de
huidige testhost, geen performancegarantie voor grote werelden of tragere
hardware. De architecturale grens blijft: dit werk gebeurt bij selectie,
niet per guesttick of paint.

[playback]: https://github.com/godotengine/godot/blob/4.5-stable/scene/animation/animation_node_state_machine.h#L260-L342
[editor]: https://github.com/godotengine/godot/blob/4.5-stable/editor/animation/animation_state_machine_editor.cpp#L939-L962
[variables]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/variablesView.ts#L91-L170
[limbo]: https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/debugger/limbo_debugger.cpp#L131-L156
[reveal]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/base/browser/ui/list/listWidget.ts#L1901-L1925
[scrollbar]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/base/browser/ui/scrollbar/scrollbarState.ts#L127-L154
[scrollbar-drag]: https://github.com/microsoft/vscode/blob/1.104.0/src/vs/base/browser/ui/scrollbar/abstractScrollbar.ts#L244-L265
