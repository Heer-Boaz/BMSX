# Behavior-authoring: gebruikersreview en vervolgslices

Datum: 2026-09-10. Live owners onderzocht op `7a7d37dc5`; de checkout schoof
tijdens de review door naar `0babc6349` (alleen de RetroArch-submodulepointer).
**Status: audit en ontwerp, niet geïmplementeerd.** De geslaagde A01–A04-proeven
bewijzen hun eigen contracten, niet dat Behavior Lens een afgeronde editor is.

Dit document verwerkt de nieuwe BT-, FSM- en ActionEffect-gebruikersproef. Het
vervangt geen Lua-, editor-, source-edit- of runtime-owner. Onderstaande slices
zijn opnieuw aan de live code te toetsen contracten, geen bouwrecept.

De [vervolganalyse van het bron-/bewerkingscontract](behavior_source_authoring_design.md)
verdiept B04 en scherpt B03 aan: API-binding is niet modulepad + const-spelling;
bronoccurrence is niet value identity; lexical relocation bewijst geen behoud
van initialisatie-effecten. Daarom gaat het generieke broncontract vóór het
uitbreiden van structurele authoring, ook binnen één bestand. Niet-mutating
UX-verbeteringen hoeven daarop niet te wachten.

## 1. Wat daadwerkelijk ontbreekt

| Gebruikersbevinding | Live oorzaak; behouden fundament |
| --- | --- |
| BT verplaatsen lukt alleen op dezelfde laag | `behavior_tree_drag.ts` accepteert uitsluitend dezelfde parent én dezelfde brontabel. Een lijst met één member kan niet eens een drag beginnen. Dit is een ontbrekende operatie, niet alleen een onduidelijke guide. `BehaviorTreeTransferAnalysis` en `createLuaTableFieldTransfer` bestaan, maar zijn nog geen aangesloten gebruikersflow. |
| BT toont `CHILD 1` in plaats van de handeling | `graph_projection.ts` zet rol/volgnummer op de kaart; `task` en andere specifieke velden belanden alleen in details. De typed source en daadwerkelijke lijstvolgorde zijn wél beschikbaar. |
| FSM toont herhaalde partial/unknown/no-path-tekst | `state_graph_projection.ts` maakt van bronanalyse-uitkomsten meerdere permanente kaartregels. `no-path` omvat ook een callback die alleen werk doet en geen transitie retourneert: dat is geen fout en betekent niet dat die callback niets doet. |
| FSM over meerdere bestanden | Er is **nog geen algemene multi-fileprojectie**. `source.ts` volgt literals en lokale `<const>`-aliases; geen geïmporteerde tabellen/memberexpressies. `state_machine_relations.ts` volgt op die manier callbacks: ook `methods.step` binnen hetzelfde bestand blijft onbekend. Directe transities in het registrerende bestand kunnen ondertussen wel zichtbaar zijn. |
| `DIRECT LN …` lijkt filegebonden | De tekst is niet de navigatie-identiteit: `LuaSourceRange` heeft een pad. Maar `BehaviorSourceIndex` zet alle ranges om via één buffer en `BehaviorSourceDocuments` invalideert alleen op de versie van het registrerende model. Alleen een bestandsnaam aan het label toevoegen lost multi-file dus niet op. |
| FSM `INITIAL` lijkt een eventpijl | Het typed model onderscheidt entries van transition outcomes. De projectie geeft beide dezelfde linkvorm; initial loopt van de container naar de child. Dit vraagt een eigen entry-presentatie, niet alleen andere inspringing. |
| Contextmenu ontbreekt | De huidige menu-session vereist een code-token, codebounds en een actieve code-tab. Een graphnode past niet in dat contract. Geen fake token of tweede Lens-popup toevoegen. |
| ActionEffect herhaalt tags en toont `<FUNCTION>` | `action_effect_properties.ts` toont de hele lijstexpressie én elke entry, en vervangt inline functies door een typelabel. De bronvelden bestaan al; de presentatie benut ze onvoldoende. |
| Zoom/minimap ontbreekt | De gedeelde viewport bezit scroll/pan, maar geen schaaltransformatie. Dit is een nieuwe capability, geen gemiste scrollbar of eigenschap van ELK. |

### Onafhankelijke tegenproeven

Vier tijdelijke auditproeven op kleine zelfgeschreven Lua-fixtures, zonder een
regelnummer/actor/BT uit Nemesis of Pietious als oracle:

- Een sequence met een task, een wait en een nested sequence: drag van de task
  naar de nested child wordt geweigerd; die enige nested child kan niet slepen.
  De bestaande transferanalyse accepteert dezelfde bronverplaatsing. De taskkaart
  bevat precies `CHILD 1` / `TASK`, ondanks het authored `task=tasks.walk`.
- Vier FSM-registraties: lokale const-functie → bewezen pad; membercallback →
  `unknown-callback`; `states` uit `require('external_states')` → dynamic;
  callback met uitsluitend `owner:fire()` → `no-path / no-return`.
- Effect met `blocked_tags={'g.dl'}` en twee inline callbacks: de lijst en de
  entry verschijnen beide; beide callbacks krijgen `<FUNCTION>`. Inspectie
  verandert de bron/dirty-state niet.
- Een workspace met twee echte source-inputs: de generieke Lua-frontend vindt
  `external.states` in `external_states.lua`. De behavior-reader op datzelfde
  workspace-snapshot houdt `states` dynamic. De ontbrekende aansluiting zit hier
  dus niet in Go to definition; dit rechtvaardigt geen nieuwe semantic engine.

Commando en tijdelijk bewijs:

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  /tmp/bmsx-behavior-ux/audit.test.ts
# /tmp/bmsx-behavior-ux/audit.log: 4 geslaagde tegenproeven
```

Dit zijn bewijzen van **huidige beperkingen**, geen toekomstige acceptatietests.
Ze worden niet als tests ingecheckt die de verkeerde UX moeten blijven eisen.
Dit is geen nieuwe browser-, renderer-, runtime- of performancemeting.
Daarnaast slagen de **26 bestaande source-/admissiontests** in
`behavior_tree_transfer.test.ts`, `state_machine_source.test.ts` en
`actioneffect_source.test.ts`; log: `/tmp/bmsx-behavior-ux/source-tests.log`.

## 2. Productievoorbeelden en toepassingsgrens

Opnieuw gelezen, niet uitsluitend afgeleid uit screenshots of handleidingen:

- [LimboAI TaskTree](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/task_tree.cpp#L410-L499)
  onderscheidt plaatsing tussen items en op een parent, en levert parent/positie
  aan de bewerking. Zijn
  [editorcommand](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/limbo_ai_editor_plugin.cpp#L1048-L1102)
  bezit de undoable lijstwijziging. BMSX behoudt daarvoor de bestaande Lua-transfer
  en bindinganalyse; een resourceboom is niet hetzelfde als gedeelde Lua-bron.
  [Taaknamen](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/task_tree.cpp#L78-L90)
  beschrijven de taak, niet uitsluitend haar siblingnummer. De uitvoerbare
  `_generate_name`-scriptmethode wordt **niet** overgenomen: Lens voert geen Lua
  uit voor een label.
- [Godot FSM-editor](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/animation/animation_state_machine_editor.cpp#L1465-L1490)
  onderscheidt de startpresentatie van gewone states en stuurt
  [transitionselectie naar inspectie](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/animation/animation_state_machine_editor.cpp#L179-L205).
  Overnemen: semantisch verschillende elementen en details buiten het diagram.
  Niet overnemen: Godots animation-runtime, playback-controls of een fictieve
  end-state die cartlib niet heeft.
- [VS Code ContextMenuService](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/contextview/browser/contextMenuService.ts)
  en [ContextMenuHandler](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/platform/contextview/browser/contextMenuHandler.ts#L40-L145)
  scheiden bijdrage-eigen acties/context van anchoring, focus en menu-lifetime.
  BMSX gebruikt zijn command-, menu-, focus- en capture-owners; geen DOM/service-
  container kopiëren en geen nieuwe menu-implementatie per feature.
- [VS Code FileReferences](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/gotoSymbol/browser/referencesModel.ts#L99-L146)
  koppelt bronverwijzingen aan de betreffende resource en diens textmodel. Dit
  ondersteunt de bronlocatie/modelgrens, **niet** de aanname dat een navigation-hit
  toestemming geeft voor het verplaatsen of herschrijven van Lua.
- [Godot EditorPropertyArray](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/editor/inspector/editor_properties_array_dict.cpp#L433-L460)
  heeft zowel een waardepreview als een type/omvang-presentatie, naast de
  afzonderlijke entry-controls. Een lijstpreview is dus niet universeel slechte
  UX; de vaste duplicatie in onze kleine taglijst voegt alleen onvoldoende toe.
  Overnemen: lijstpresentatie en bewerkbare entries onderscheiden. Niet overnemen:
  Variant-reflectie, array-evaluatie of een generieke inspector-runtime in cartlib.
- [Godot GraphEdit zoom](https://github.com/godotengine/godot/blob/4cefd60f5a3d733506cb557d6cd26263b3fbd17f/scene/gui/graph_edit.cpp#L2433-L2467)
  bewaart het punt onder het zoomanker en past scrollbereik/presentatie samen aan.
  Zijn minimap gebruikt dezelfde graphruimte. BMSX moet dit toetsen aan zijn
  bitmapfont en gedeelde graph-render/inputgrens, niet alleen tekencoördinaten
  vermenigvuldigen.

## 3. Eindcontracten

### B01 — informatiehiërarchie en bruikbare inspectie

**Canvas toont gedrag; inspectie toont bewijs en volledige inhoud.** Selectie
blijft een typed source occurrence/relatie, nooit de tekst van een kaart.

- BT: node-type plus de specifieke taak/referentie wanneer die in de bron staat.
  Bijvoorbeeld `TASK` / `tasks.walk`; voor wait de authored duur, voor timeline
  de authored timeline-id. Composite-types blijven herkenbaar. Ordinale
  `CHILD n`-koppen verdwijnen, niet de volgorde, choice-weight of het onderscheid
  tussen `main_task` en `background_tree`. Geen callbackevaluatie of naam raden.
- FSM: statenaam en noodzakelijke structurele rol op de kaart, event/callbackrol
  op de verbinding. Geen permanente `DIRECT LN …`-regel of opeenstapeling van
  geërfde partial-statistieken. Bronbestand/range, binding, returnbewijs en
  guards blijven bereikbaar vanuit de geselecteerde relatie/state.
- Onopgeloste bron blijft kenbaar via een compacte inspecteerbare aanduiding.
  Details benoemen **wat** ontbreekt. Een callback zonder geretourneerd
  transitiepad is niet automatisch een waarschuwing. Een stiller diagram mag
  geen volledigheid suggereren die de bronanalyse niet bewijst.
- Details zijn leesbare, scrollbare inhoud; een Quick Pick blijft een keuzecontrol,
  niet de definitieve vervanger van een inspector. Hergebruik de property-tree,
  scrollviewport, selection-, navigation- en source-owners. Geen globale
  runtime-inspectorfacade of nieuwe schaduwselectie voor de details.
- Vóór implementatie de diagram/details-compositie meten op 384×288 met tiny-font,
  ook met Problems open. Geen permanent breed zijpaneel dat het diagram opnieuw
  tot een smalle strook reduceert. De exacte plaatsing volgt uit die proef,
  niet uit een overgenomen desktop-layout. Verborgen details verliezen geen
  source-selectie of graphpositie.

**Gate:** elke betekenisvolle kaartwaarde en elk weggelaten brongegeven heeft
een aantoonbare plek; inspectie/source/Back/pan verandert geen sourceversie,
dirty-state of undo. Tekst meten/projecteren alleen bij relevante invalidatie.

### B02 — contextmenu is een workbench-control, geen Lua-tokencontrol

De bijdrage levert het geraakte doel en toepasselijke bestaande commands; het
gedeelde menu bezit schermbegrenzing, focus, pointer-/keyboardbediening en sluiting.
Een code-token is één context, niet het verplichte basisobject voor alle menu's.

Rechtsklik op een node/edge richt zich op dat doel; keyboard-opening gebruikt de
bestaande selectie. Leeg canvas is een afzonderlijke context. Inspectie, Source,
Duplicate, Remove en passende FSM-commands gebruiken dezelfde admission als
toolbar/palette. Menu openen, sluiten of annuleren is nooit een bronedit.

Node toevoegen is méér dan een menu-entry: er moet een concrete gekozen nodevorm,
echte insertion-site en language-owned sourcebewerking zijn. Geen werkeloze Add-
knop, nepnode of alvast een algemene runtime-noderegistry. Ontwerp creation naast
de bestaande duplicate/remove-owners, niet in het popup-renderpad.

**Gate:** code-, BT-, FSM- en propertycontext werken via dezelfde menuroute;
keyboard, release buiten target, Escape, readonly, detach en bronwijziging tijdens
het menu zijn beproefd. Focus keert terug naar de juiste input, niet een verborgen
code-tab. Los A09 hover/leave op bij de gedeelde pointer-owner, niet per menu.

### B03 — BT verplaatsen betekent parent/list/insertion veranderen

Gebruik het bestaande [transfercontract](behavior_tree_transfer_admission_design.md)
en [lossless Lua-transfer](lua_table_transfer_design.md), niet een ruimer gemaakte
`target.parent`-check. De destination is een echte source-list met insertion-site;
depth is het resultaat van topology, geen drag-admissioncategorie.

- Guides onderscheiden **vóór**, **na** en **in** een geschikte parent. Een lege
  maar bestaande children-list heeft een vindbaar droptarget. Ook één member
  kan naar een andere parent, en verplaatsen naar een hogere laag is mogelijk.
- Beginnen met slepen maakt relevante mogelijke bestemmingen zichtbaar; hover
  geeft de exacte bewerking of een begrijpelijke onbeschikbaarheidsreden.
  Geen source/layoutmutatie tijdens preview en geen bronanalyse per pointermove.
- Lijstrollen, shared source-consumers, cycles, concrete insertion-site en
  lexical binding changes blijven onderdeel van admission. `choices` verplaatst
  de volledige weight/child-entry. Geen stille omzetting van een task naar een
  weighted choice of vervanging van `main_task` als ware dat een lijst.
- De operatie verplaatst geschreven bron, niet een reeds geïnstantieerde node.
  Inline initializers kunnen daardoor in een andere volgorde evalueren. Ook
  same-list reorder/duplicate vereist die eerlijke betekenis; de bestaande
  bindinganalyse certificeert geen effectbehoud. Volg het operationele contract
  uit de [vervolganalyse](behavior_source_authoring_design.md#6-een-bewerkingscontract-per-gebruikersintentie),
  niet een algemene `canEdit`-uitkomst of ongevraagde initializerherschrijving.
- De huidige consumeranalyse ziet één document met zijn herkende registraties,
  niet alle mogelijke runtimegebruikers. De UI mag dat niet als globale
  exclusiviteit presenteren. Gedeelde bron is op zichzelf geen afwijzing; de
  bestaande source-edit-review toont de bekende impact.
- Eén bevestigde verplaatsing is één gewone source-edit/Undo met de bestaande
  bookmarks. Cross-file verplaatsen vereist eerst B04 plus bewezen edit- en
  undo-eigenaarschap voor meerdere modellen; het wordt niet stilletjes onderdeel
  van deze aanvankelijk same-document-operatie.

**Gate:** omhoog/omlaag, lege destination, enige member, aliased subtree, gedeelde
lists, commentbehoud, binding conflict, evaluatiegevolgen, cancel, Undo/Redo en
echte Save/Hot Resume. Het B04-broncontract gaat vóór nieuwe structurele authoring;
dit is niet uitsluitend een voorwaarde voor cross-filewerk.
De primaire testoracle is onafhankelijke Lua, niet een huidige gameboom.

### B04 — bronprovenance en invalidatie vóór ruimere authoring

Dit is niet een tweede semantic engine in Behavior Lens:

1. Generieke Lua-semantiek levert bron-/bindingfeiten uit het actuele workspace-
   snapshot; cartlib/FSM/BT-kennis blijft buiten parser, binder en query-store.
   Gebruik bestaande frontend/query-owners. Een gevonden functie en een bewezen
   editable table origin zijn verschillende feiten; een Go to definition-hit
   is geen edit-permissie. Het generieke resultaat moet geschreven origins,
   gecorreleerde callcontexten en onopgeloste bijdragen behouden; één gevonden
   target bewijst niet dat andere uitkomsten uitgesloten zijn.
2. De behavior-projectie behoudt registration occurrence, gebruikslocatie en
   daadwerkelijke definitie/returnlocatie afzonderlijk. Resource/domain en
   sourcegeneratie horen bij ieder bronfragment. Gedeelde callbacksyntax blijft
   gedeeld, de scope waarin haar FSM-pad wordt gebonden niet.
3. Ranges worden naar offsets omgezet en gemapt in **het model dat die bron
   bezit**. Geen buitenlandse range door de registration-buffer voeren. De
   bestaande modelservice, navigation, edit-state en Undo blijven eigenaar.
4. Afhankelijke projecties reageren ook op unsaved wijzigingen/Undo in een
   geïmporteerd bestand. De cachekey mag niet alleen `registration.version`
   blijven; betrokken sourcegeneraties en dependency-invalidation moeten eerst
   bewezen worden. Geen elke-frame workspace-scan of verborgen kopie van bronnen.
5. Mogelijke/dynamische uitkomsten blijven mogelijk/dynamisch. Niet uitvoeren,
   niet een same-name functie kiezen, niet een onbewijsbare callback vervangen
   door een literal. Inspectie/navigatie en toestemming tot wijzigen blijven
   afzonderlijke capabilities.

**Gate:** minstens twee bestanden met imported state table, membercallback en
shared callbacks in meerdere FSM-scopes; een unsaved dependencywijziging met
ongewijzigde registration-bron; meerdere/ontbrekende targets; exacte Source/Back;
Undo/read-only op de daadwerkelijke edit-owner. Daarnaast: gewone ongewijzigde
aliases, overschreven module-export, gelijke waarden met verschillende occurrences
en afzonderlijke wrappercalls. Eerst de producer-API en snapshot-/dependency-
contracten vastleggen, dan de recognizer uitbreiden. De
[broncontractanalyse](behavior_source_authoring_design.md) onderscheidt read-many/
write-one van echte multi-model-edits; geen workspace-Undo-manager bouwen alleen
om een imported field in zijn eigen model te wijzigen.

### B05 — FSM entry-presentatie volgt haar eigen semantiek

Een `initial`-relatie krijgt een herkenbaar entry-element **binnen haar scope**,
niet een gewone eventlijn vanaf de buitenste container. De render/layout-elementen
refereren aan de bestaande `StateMachineSourceEntry`; zij worden geen fake
`BehaviorSourceNode`, event, runtime-state of fictieve Lua-range.

Concurrente entries blijven onderscheiden van exclusieve initial entry. Geneste
scopes, parent handlers en echte event-/callbackverbindingen behouden hun
semantiek. De bronselectie en bestaande Set Initial-/retarget-edit blijven op de
echte entry/field werken, ook wanneer het visuele anker verandert.

**Gate:** entry herkenbaar zonder kleur alleen; geen label- of containeroverlap;
nested/concurrent scopes, self-loops en parenttransities; actuele hit geometry;
Source, Set Initial en Undo op dezelfde Lua. B01 is de informatiehiërarchie,
geen excuus om onbekende relaties als entrylijnen te tekenen.

### B06 — ActionEffect inspectie vanuit functionaliteit

De huidige acht value-velden en vier requirementlijsten dekken de definition-
velden die `actioneffect_component.lua` gebruikt. Deze audit bewijst dus geen
ontbrekende dertiende instelling. Wel ontbreken bruikbare presentatie en
bewerkingsflows. Begin niet met extra effectmetadata in cartlib.

- Toon requirements eenmaal als benoemde lijst met afzonderlijk navigeerbare
  waarden. De groepsregel herhaalt niet de volledige `{…}` naast die entries;
  een numeriek array-index is geen nuttige hoofdnaam voor een tag.
- Behoud onderscheid tussen authored literal, referentie en niet statisch
  opgeloste expressie. Alleen lijstwaarden komen uit `blocked_tags`; de werkelijke
  callbackgate is `can_trigger`. Een expressie kan een lijst opleveren, maar de
  view voert die niet uit.
- Callbacks krijgen een betekenisvolle verwijzing of herkenbare inline-functie
  met parameters en directe Source-route, niet alleen `<FUNCTION>`. Hun rol
  blijft zichtbaar: gate, cooldownberekening en handler zijn geen uitwisselbare
  instellingen. Volledige bron hoort bij inspectie, niet in een lange lijstcel.
- Timing blijft de authored expressie; geen gegokte milliseconden of defaults.
  Periodic execution slaat de triggerrequirements/cooldown over. Handler kan
  event/payload veranderen. Geen verzonnen lineaire execution-graph tekenen.
- Propertybewerkingen volgen dezelfde bronbehoudende edit- en draft/focusroute
  als andere structured views. Geen waarde wijzigen bij selectie/Source, geen
  evaluatie nodig om inspectie of bronbewerking te mogen openen.

**Gate:** alle twaalf rollen zijn vindbaar en verklaarbaar zonder duplicatie;
long/multiline values volledig inspecteerbaar; callbacks/aliassen/unknown keys;
selected-entry Source; cancel/read-only en één gewone Undo per echte wijziging.

### B07 — gedeelde zoom, daarna eventueel minimap

`WorkbenchGraphViewport` wordt eigenaar van één model/viewport-transformatie.
Paint, hit testing, connection grips, dropguides, edge scrolling, scrollbars,
reveal en eventuele minimap gebruiken dezelfde omrekening. Geen aparte schaal
in BT/FSM-renderers en geen ELK-relayout bij elke zoomtick.

100% blijft de leesbare tiny-font-basis. Zoom is een expliciete canvasactie met
anker en reset; geen automatische zoom-to-fit die het eerdere real-estateprobleem
verbergt. Eerst de daadwerkelijke glyph-/lijnrastering en selectie bij uitzoomen
testen op software, WebGL2 en WebGPU. Een minimap is aanvullende navigatie, niet
een vervanger voor leesbare details of correct zoom/hitgedrag.

**Gate:** pointeranker behouden, gepande/negatieve coördinaten, getransformeerde
hit/drop/reveal, stabiele selectie/Undo en backendvergelijking op tiny-resolutie.
Viewnavigatie verandert nooit authored coordinates, Lua of runtimeklokken.

## 4. Bouwvolgorde en expliciete grenzen

Werk per volledig ownercontract, met productiecode opnieuw naast de live owner.
De vervolganalyse corrigeert de eerdere B01→B07-volgorde; de nummers zijn geen
afhankelijkhedenketen:

1. B04 generiek bron-/snapshotcontract en resource-eigen projectie, inclusief
   read-many/write-one. Geen lokale herkenningsuitzonderingen als tussenoplossing.
2. B03 same-document reparent als complete drag → review → edit → Undo-flow op
   die bronfeiten, met expliciete betekenis voor verplaatste evaluatie.
3. Echte cross-filemoves vereisen pas daarna een afzonderlijk multi-model-edit/
   Undo-contract. Dat is niet hetzelfde als geïmporteerde bron bekijken/bewerken.

Onafhankelijk daarvan kunnen B01 informatiehiërarchie/inspectie, B02 gedeeld
contextmenu (met A09 bij dezelfde pointer-owner), B05 FSM entry-geometrie en de
niet-mutating B06-presentatie worden verbeterd. B01 houdt zijn tiny-resolutiegate;
B06-propertyauthoring gebruikt het broncontract. B07 blijft gedeelde zoom;
minimap alleen wanneer die daarna aantoonbaar helpt.

A05–A09 uit de algemene UX-audit blijven open waar niet expliciet afgesloten.
Deze nieuwe review is geen aanleiding om de reeds beproefde sourcebehoudende
edits, undo, tabidentiteit, Hot Resume of machine/host-grenzen opnieuw uit te vinden.
Pointerverlies buiten het browservenster blijft voorlopig de bestaande
capture-cancel; de gebruiker heeft uitbreiding van de HTML-pointerarea uitgesteld.

**Niet in deze docs-slice gebouwd:** herontworpen UI, contextmenu, cross-depth
drag, multi-fileprojectie, nieuwe sourcebewerkingen, zoom of minimap. Er is geen
cartlib-, compiler-, machine- of TS/C++-runtimewijziging.
