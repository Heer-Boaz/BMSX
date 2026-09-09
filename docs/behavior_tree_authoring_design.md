# BT-authoring: bronbehoudend herordenen

`STUDIO-BT-CHILD-MOVE-01` bouwt broncommands voor bestaande ordered `children`
en weighted `choices`. De afgewezen **Earlier/Later-knoppen zijn uit de
graph-header verwijderd**; de expliciete commands blijven in de Command
Palette, niet als vervanging voor slepen. `STUDIO-BT-DRAG-REORDER-01` voegt
de fysieke reorder-interactie op dezelfde bronowner toe.
`STUDIO-BT-VISUAL-EDITOR-01` blijft het grotere, nog onvoltooide
authoringcontract. Geen Add/Remove/Connect, property-editor of runtime-observer
in deze twee slices.

## Getoetste productievoorbeelden

- [LimboAI, Move Up/Down](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/limbo_ai_editor_plugin.cpp#L660-L719):
  werk op echte siblings en hun parent-owned index; weiger endpoints en maak
  één normale Undo-actie. BMSX bewerkt geen LimboAI/Godot-resources: zijn owner
  is het gedeelde Lua-textmodel. De globale-history-workaround uit die plugin
  wordt niet overgenomen.
- [VS Code, MoveLinesCommand](https://github.com/microsoft/vscode/blob/30e67b4c96266198aed7e9b77c6687ff753106a2/src/vs/editor/contrib/linesOperations/browser/moveLinesCommand.ts#L99-L232):
  verplaats omliggende tekst zodat de geselecteerde tekst zelf behouden blijft.
  Dat principe vervangt onze oude volledige swap-replacement. BMSX gebruikt
  syntaxvelden met lexer-owned trivia, geen regelgebaseerde formatter of
  indentationheuristiek.
- De bestaande [Lua-syntaxowner](lua_source_syntax_design.md) volgt Full Moon
  voor field/separator/trivia. Er komt geen BT-scanner of tweede printer.

## Eigenaars en representaties

| Grens | Contract |
| --- | --- |
| Canonieke bron | Het bestaande resource-owned `EditorTextModel`; Lua blijft compileerbare auteurstekst. |
| Recognizer | Bewaart parsecompleetheid los van descendantresolutie en list-local issues. Geen Lua-executie. |
| Koude graphprojectie | Een zichtbare bewezen listmember verwijst naar de originele constructor, entries en zero-based entryindex. Geen kopie van siblings of runtime-instance-id. |
| Command-admission | Writable, actuele sourcegeneration, complete syntax en een echte eerdere/latere arrayentry. Root, parallelrollen en onbekende membership hebben geen move-target. |
| Expliciete edit | Vertaal de twee echte arrayentries naar hun lexical fieldindices; laat de gedeelde Lua-owner de minimale editbatch maken. |
| Text/history | Twee of drie edits, één Undo-element/content-event. Geselecteerde syntax wordt niet vervangen; bestaande source-correspondence volgt haar. |
| Focus/UI | Source/Details/Children in de action-bar; herordenen via expliciete Command Palette-commands. Graph-control en overige Lens-control binden elk expliciet document-Undo/Redo. Geen parent-commandfallback of globale gameplaytoets. |
| Compiler/cartlib/machine | Ongewijzigd. Cartlib compileert de gewijzigde Lua-order; normal Save/Hot Resume blijft de bestaande install/rebind-route. Geen nieuwe gueststate of C++-representatie. |

Een opaque builder **binnen** een bewezen lijst verhindert de bronbewerking
niet: de actie verplaatst zijn complete callsyntax, zonder het resultaat te
raden. Een onbekende, numeric-keyed, computed-keyed of known-mutated **lijst**
blijft source-only. Recovery-AST is geen complete editsyntax.

Een weighted kaart of verbinding verplaatst de volledige `choice`-entry,
inclusief weight, child en comments. Hun Source-selecties blijven verschillend:
de verbinding wijst op de wrapper-use; de kaart op de child-use. Een gedeelde
const-initializer wordt eenmaal in Lua aangepast en verandert dus al zijn
bronprojecties. Er ontstaat geen privé-subtree per gekozen registratie.

Named metadata telt niet als arraychild. Verplaatsen betekent gewone
source-list insertion: alle andere fields behouden hun onderlinge volgorde,
niet noodzakelijk hun oude absolute index. Daarom levert de bijdrage echte
syntaxfields, niet `entry.index - 1` als gegokte lexical index.

## Selectie en geschiedenis

De geselecteerde fieldbytes blijven staan terwijl het tussenliggende block
naar de andere kant gaat. Source-ranges volgen dezelfde gewone insert/delete-
events als de code-editor, ook wanneer de Lens verborgen is. Dit behoudt de
geselecteerde subtree, haar expanded/collapsed state en de gekozen registratie
door Move, Undo en Redo; er is geen bestemming-index-override of tweede history.
Ook de bestaande Scene Editor gebruikt nu deze eigenaar.

Dit introduceert **geen** universele identiteit voor willekeurig vervangen
bron. Ranges in het verplaatste omringende block worden gewoon ongeldig; oude
folds daarvan worden niet op naam teruggevonden. Na een latere selectie van
zulke ingevoegde tekst mag Undo die selectie verwijderen. Dat is dezelfde
bestaande broncorrespondentieregel, niet een verborgen graph-recoverypad.

## Bewijs

- `behavior_order_fixture.ts` is zelfstandige gewone Lua, gedeeld door tests en
  de fysieke workbenchproef; geen afhankelijkheid van game-definitienamen of
  regelnummers, geen fixture-ROM of host-evaluator.
- `behavior_tree_edit.test.ts` bewijst metadata versus arrayrank, opaque values,
  shared occurrences, subtree-expansion, weighted node/edge-selectie, endpoints,
  parallelrollen, unknown/computed/numeric/mutated lists, recovery en retained
  warme admission. `lua_table_moves.test.ts` bewijst de edit-/triviagrens.
- `fsm_hot_resume.test.ts` compileert de exact bewerkte fixture op de bestaande
  BLua/cartlib CPU-harness: nested-first geeft `1213`, nested-last `1312`;
  gewichten blijven aan hun eigen child gekoppeld. Dit bewijst guestuitvoering,
  niet op zichzelf een live Hot Resume van die fixture.
- De corpusgate controleert **23.262 moves in 312 Lua-bestanden** tegen de
  volledige AST en echte PieceTree-Undo, zonder bestanden uit te sluiten.
- `studio_bt_moves.ts` gebruikt de werkelijke palette/action-bar, held pointer,
  graphfocus, codefocus, hidden Undo, readonly resourceadmission en source-links.
  De generieke source-only fixture verandert de gepauzeerde Machine niet.
  De volledige Studio-suite test daarnaast de gewijzigde Scene-moveprimitive
  met gewone Save/Hot Resume, dezelfde levende actor en capture-cellen.

De bestaande productworkflow en de CPU-oracle zijn afzonderlijk bewijs. Een
specifieke live BT-reorder/rebind-sessie via Hot Resume is hiermee niet als
nieuwe end-to-end proef afgevinkt.

## Referentiecontract: slepen en verbindingen

De op Git gecontroleerde aigen-versie is
[`5248d9c`](https://github.com/Heer-Boaz/aigen/tree/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91).
[`WorkflowCanvas`](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_canvas.py#L261-L439)
onderscheidt node-/port-hit, capture, tijdelijke preview en één commit na
een geldige release. Een klik of geannuleerde gesture muteert het document
niet. [`WorkflowEditBuffer`](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_edit_buffer.py#L319-L383)
bezit reconnect en zijn Undo-wijziging, niet de renderer.

Dit is het referentiecontract. De reorder-interactie wordt hieronder apart
gebouwd; reconnect/reparent blijft **nog niet gebouwd**:

1. De gedeelde graph-control bezit press/drag/release/cancel en pointercapture.
   De bijdrage levert bewezen source-members en dropdoelen. Geen BT-parser of
   world-mutatie in generieke input/rendercode.
2. Preview en insertion-/poortmarkering zijn viewstate. Tijdens bewegen geen
   Lua-edit, herparse, history-element of autosave. Escape, blur, sluiten en
   een nieuwe sourcegeneration annuleren de gesture.
3. Een expliciete reorder-drop binnen de bewezen lijst doet één gewone
   source-editbatch via de bestaande taalowner. Geen reeks Earlier/Later-
   commands per hover of een delete-plus-recreate van het geselecteerde kind.
4. Nodepositie is niet automatisch uitvoervolgorde. Aigen bewaart layout in
   zijn eigen workflowdocument; dat rechtvaardigt geen editor-coördinaten in
   cartlib/Lua of wijziging van een BT doordat iemand alleen het diagram ordent.
5. Reconnect vereist een eigen bewezen Lua-bronbewerking: nieuwe parent/list,
   gewicht/rol, scope en gedeelde const-initializers moeten hun bestaande
   betekenis behouden. Een zichtbare lijn alleen is geen schrijfbevoegdheid.
   Geen runtimegraph, tweede authored graph of gegokte callbackrelatie.

Bewijs vóór afronding: dezelfde fysieke drop over alle drie backends, geen
dirty state bij klik/cancel/ongeldige drop, één Undo per geldige drop, hidden
source edits en generation-cancel, plus dezelfde source-/scope-oracles als de
keyboardcommands. De autosavefix wordt niet afhankelijk gemaakt van deze
grotere interactieslice.

## Kosten

Warm command-enablement leest uitsluitend behouden pointers, documentversie,
readonly/syntax-capability en twee indexgrenzen: **O(1), geen allocatie**.
Graphprovenance wordt alleen bij bron-/collapse-/fontprojectie opgebouwd;
entries/table zijn bestaande syntaxobjecten. Alleen het expliciete command
zoekt de twee lexical indices en maakt één lossless lexerscan en editbatch.
Er is geen nieuwe cartlib-, CPU-, IRQ-, renderer-device- of worldtick-callsite.

Metingen en reproductie: `tests/conformance/behavior_graph/profile.ts`,
`tests/conformance/lua_source/moves.ts`,
`tests/conformance/runtime_replay/browser.mjs`; artifacts onder
`/tmp/bmsx-bt-move/`. Zie de validatieresultaten hieronder voor de afgebakende
hostkosten, niet een totale Studio-frame- of doelhardwaregarantie.

### Gemeten hostkosten en validatie van de oorspronkelijke commandslice (2026-09-09)

Geïsoleerde Node 22.23.1-metingen, tien warmups en mediaan van 25 samples.
Moveconstructie gebruikt dezelfde bewaarde parse/sourcesnapshot; de grootste
table in elk bestand levert hetzelfde aangrenzende paar voor parent en patch.
500 operaties/sample voor de root, 20 voor het grote bestand:

| Bron | Bytes | Constructie parent → nu (ms) | PieceTree apply+Undo parent → nu (ms) | Gekopieerde UTF-16-eenheden parent → nu |
| --- | ---: | ---: | ---: | ---: |
| `nemesis_s/scenes/root.lua` | 1.264 | 0,02122 → 0,02081 | 0,00124 → 0,00127 | 400 → 200 |
| `pietious/player/player.lua` | 100.446 | 1,70471 → 1,68736 | 0,00126 → 0,00088 | 52 → 31 |

Dit is geen snelheidswinstclaim: de kleine timingverschillen zijn gevoelig voor
JIT/GC/timervariatie. Wel aantoonbaar: de geselecteerde bron wordt niet opnieuw
gekopieerd; gewone edit/history-administratie bevat twee in plaats van één
operatie. Bovenstaande kosten sluiten semantic refresh, views en Hot Resume uit.

De retained graphproef meet cold source/card/layout afzonderlijk en warm
hit/draw+quad-emissie in batches van 1.000:

| Siblings / opaque child | Kaarten | Source (ms) | Cards (ms) | Layout (ms) | Hit (µs) | Draw+quads (µs) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 24 / nee | 74 | 0,1775 | 0,1486 | 0,0811 | 0,1538 | 14,3013 |
| 1.024 / nee | 3.074 | 1,9032 | 3,5457 | 0,4228 | 9,0181 | 162,5836 |
| 24 / ja | 74 | 0,0676 | 0,1236 | 0,0180 | 0,1637 | 16,2232 |
| 1.024 / ja | 3.074 | 1,5700 | 4,5712 | 0,4017 | 10,1904 | 163,1730 |

Warm: nul fontmetingen, dezelfde quadstorage. Deze proef sluit parsing,
GPU-upload/raster en totale Studio-frames uit; geen fysieke GPU- of
JS-allocation-profilerclaim.

Validatie:
- Lua: **1.100 geslaagd, één bestaande skip**; ROM-packer: **123 geslaagd**.
- IDE-typecheck en browser/headless-productbuilds slagen. Tests-typecheck blijft
  **51 bestaande diagnostics**; file/code/message/multiplicity gelijk aan parent,
  twee posities verschoven door imports. Dit is geen groene tests-typecheck.
- Volledige Studio-workflow op **software, WebGL2 en WebGPU** geslaagd, inclusief
  Scene Save/Hot Resume op de gewijzigde primitive. Beide navigatieworkflows
  (Nemesis/Pietious) slagen op dezelfde drie backends, met de onafhankelijke
  BT-movefixture en readonly/generation-proeven.
- Zes echte 384×288 tiny-fontcaptures geïnspecteerd: drie siblings, alle
  action-bar-buttons, subtree-expansion en weighted edge/selectie blijven
  zichtbaar. Browser-GPU-bewijs gebruikt Chromium/SwiftShader, geen fysieke GPU.
- Headless Behavior Lens: **59 assertions**; strikte architecture-audit:
  **0 issues**; core-parity-, indentation- en diff-checks slagen.

De eerste browserproef vond dat graphfocus zijn eigen commandtarget nodig
heeft; beide concrete Lens-controls binden nu hun documenthistorie expliciet.
Er is geen commandbubbling of feature-lokale Ctrl-Z-handler toegevoegd. De
herhaalde productproeven gebruiken uitsluitend deze definitieve route.

## `STUDIO-BT-DRAG-REORDER-01`: interactiecontract

De volgende afgebakende stap is dezelfde bronlijst herordenen met slepen,
**niet** het vrij positioneren van nodes of het impliciet wijzigen van hun
parent. Een kaart of verbinding begint een kandidaatgesture; pas na de
gedeelde pointerdrempel ontstaat een drag. De linker-/rechterhelft van een
siblingkaart betekent vóór/na die entry. Een verticale insertionmarkering
maakt de geaccepteerde bestemming zichtbaar. Een drop zonder effectieve
orderwijziging doet niets. Weighted wrappers bewegen als één sourceentry.

De referenties zijn opnieuw op Git gecontroleerd:

- [aigen WorkflowCanvas](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_canvas.py#L261-L439):
  gesture en preview zijn tijdelijk; geldige release vraagt één documentedit.
  Zijn opgeslagen nodeposities worden niet als BT-executievolgorde gekopieerd.
- [LimboAI TaskTree](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/task_tree.cpp#L358-L515):
  expliciete insertionsector, normaliseren naar de echte parent/index, daarna
  een editverzoek. BMSX ondersteunt in deze stap uitsluitend dezelfde bewezen
  bronlijst; LimboAI's resourcevalidatie en reparenting worden niet overgenomen.
- [VS Code ListView](https://github.com/microsoft/vscode/blob/5644d4912d4671e81dc6894d3b13dc1603e9d9d1/src/vs/base/browser/ui/list/listView.ts#L1330-L1455):
  contribution-owned dropadmission, retained insertionfeedback en het beëindigen
  van de gesture vóór de docconsumer. Randscrollen hoort bij het control.
- [Godot GraphEdit](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/scene/gui/graph_edit.cpp#L2002-L2168):
  bewegingsfeedback staat los van het beëindigde moveverzoek.

| Owner | Verantwoordelijkheid |
| --- | --- |
| `input/pointer/buttons` | De bestaande fysieke, niet-geconsumeerde release-edge; `!primaryPressed` is niet voldoende. |
| `PointerCaptureService` | Capture loskoppelen vóór release/cancel-callbacks. Modal, ongeldige pointer, schermverlaten en verloren/geconsumeerde input annuleren, nooit droppen. |
| `WorkbenchGraphControl` | Pressdrempel, vastgehouden press-selectie, capture, pan versus drag, Escape/blur/detach, modelgeneration, hosttijd-gebaseerd randscrollen, wielscrollen met behoud van capture, releasepositie en warme hitcache. |
| Graph drag session | Eén transient bijdrage met bronpayload, retained feedback, actuele admission en een dropconsumer; geen generieke AST- of documentkennis in de control. |
| `behavior_tree_drag` | Concrete sourcegeneration en writable status; dezelfde constructor én dezelfde zichtbare parent-occurrence. Links/rechts normaliseren naar de uiteindelijke arrayrank. Geen drop op geraden verbindingen of dynamische lijstleden. |
| `behavior_tree_edit` | Zet arrayranks om in echte lexical fields en gebruikt de bestaande Lua-table-move-owner. Commands en drag delen deze grens. |
| Graph renderer | Alleen clipped preview en insertionmarkering uit retained geometry; geen bronquery of persistente nodebeweging. |

Tijdens bewegen geen Lua-edits, herparses, history-elementen of autosave.
De drag maakt eenmaal een kleine sessie; stationair buiten de scrollmarges
worden hits en dropadmission niet opnieuw berekend. Sourcewijziging, readonly
worden, graphvervanging, blur, menu en Escape beëindigen de gesture. De
releasepositie wordt nog beoordeeld; een eerder geldig hoverdoel geeft geen
recht om elders te droppen. Een geldige drop is één bestaande texteditbatch,
één content-event en één Undo-element. Er is geen rollback of preview-edit.

Reconnect/reparent, scopeverplaatsing en een eigen canvas-layoutdocument
vallen buiten deze stap. De melding van spontaan dirty worden bij Source
blijft afzonderlijk open zolang die niet gereproduceerd is.

### Validatie van drag-reorder (2026-09-09)

- **37** gerichte capture/graph/sourceproeven; de volledige Lua-suite:
  **1.117 geslaagd, één bestaande skip**. De insertionmatrix omvat ieder
  before/after-doel van drie siblings, metadata, opaque waarden, weighted
  node/edge-payloads, no-op, descendant/andere-occurrence-afwijzing en één Undo.
- De volledige echte Studio-workflow **én** de Pietious navigation/recovery-route
  slagen op software, WebGL2 en WebGPU. De nieuwe dragproef gebruikt zelfstandige
  authored Lua; de omliggende cartflows blijven integratiesmoke. Source,
  hidden Undo, Escape, palette, buiten-drop, readonly/sourcewijziging, werkelijk
  wielscrollen en randscrollen met held pointer zijn via echte hostinput bediend.
- De domeinvrije graph-viewportgate slaagt op alle drie backends, inclusief
  zes pixel-crop-oracles per backend, target resize en pane-/capturelifecycle.
  De echte 384×288-previewcaptures zijn geïnspecteerd: tiny-fontpayload boven
  de insertionmarkering, geen label dat door de dropmarkering wordt bedekt.
  GPU-tests gebruiken Chromium/SwiftShader, geen certificering van fysieke GPU's.
- Browser Studio en Node tooling herbouwd; headless Behavior Lens:
  **59 assertions**. IDE-typecheck, strict architecture-boundaries (nul issues),
  core-parity, indentationcheck en `git diff --check` slagen. Het tests-project
  heeft **51 bestaande typecheckdiagnostics, nul extra**; dat project is niet groen.

Geïsoleerde Node 22.23.1-metingen, 1.000 operaties per sample, tien warmups,
mediaan van 25. Eenheden hieronder zijn microseconden per operatie:

| Siblings | Stationaire hover | Stationaire drag | Bewegende drag/hit | Preview + overlay/quad-emissie |
| ---: | ---: | ---: | ---: | ---: |
| 24 | 0,006 | 0,029 | 0,059 | 7,454 |
| 1.024 | 0,060 | 0,017 | 1,201 | 12,679 |

Dit zijn afzonderlijke hostmetingen, geen onderling snelheidswinstbewijs:
JIT/callshape beïnvloedt vooral de zeer kleine stationaire getallen. Bewegende
hit-testing gebruikt de bestaande lineaire graph-hitowner; stationair zijn er
**nul nieuwe hitqueries**. Eén dragsessie en dezelfde graph/feedback/quadbuffers
blijven behouden. Dit bewijst geen totale heapallocatie, GPU-kosten of volledige
Studio-frametijd. Parsing, drop-editkosten en Hot Resume liggen buiten deze meting.

Reproductie staat in `tests/conformance/behavior_graph/README.md`; lokale logs,
metingen en captures staan onder `/tmp/bmsx-bt-drag/`. Reconnect/reparent en de
niet-gereproduceerde spontane dirty-melding zijn hiermee niet afgevinkt.
