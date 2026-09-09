# BT-authoring: bronbehoudend herordenen

`STUDIO-BT-CHILD-MOVE-01` bouwt uitsluitend **Earlier/Later** op bestaande
ordered `children` en weighted `choices`. `STUDIO-BT-VISUAL-EDITOR-01` blijft
het grotere, nog onvoltooide authoringcontract. Geen Add/Remove/Connect,
drag-to-reorder, property-editor of runtime-observer in deze slice.

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
| Focus/UI | Echte action-bar en Command Palette. Graph-control en overige Lens-control binden elk expliciet document-Undo/Redo. Geen parent-commandfallback of globale gameplaytoets. |
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

### Gemeten hostkosten en validatie (2026-09-09)

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
