# Grafische Behavior Lens: bron, relaties en canvas

Status: **BT-bronprojectie, gedeelde graphviewport en concrete BT-view
geïmplementeerd.** Het architectuurcontract is eerst getoetst op `09b84195e`;
de concrete BT-slice op `a9953b819`. Onderstaande bewijssecties horen bij de
gebouwde grenzen. FSM en ActionEffect houden hun outline. FSM-relatiebewijs en
cyclische plaatsing volgen afzonderlijk; deze BT-view is nog geen authoring.

## Doel en grens

Maak gedrag ruimtelijk leesbaar: bij een BT de ordered boom met zijn
attachments; bij een FSM states, scopes en aantoonbare mogelijke overgangen.
De openingskiezer kiest een registration, niet een bestand. Meerdere FSM's of
BT's in één Lua-resource blijven afzonderlijke onderwerpen. Het bestaande
resource-owned editorinput en textmodel blijven de documentowners.

Lua blijft canoniek. Dit ontwerp introduceert geen executable graph,
behaviorresource, runtime-reflectie, guest-instrumentatie of cartlib-werk op het
framepad. Een eerste read-only grafiek is geen verbod op authoring: latere
bewerkingen gebruiken hetzelfde source-edit-, undo-, save- en Hot-Resume-pad.
Zij zijn niet automatisch onderdeel van deze visualisatieslices.

## Referenties: overnemen én begrenzen

- **Godot GraphEdit** scheidt grafiekinteractie van domeinbetekenis. Verbindingen
  hebben retained geometrie en bounds; pannen verandert niet de topologie.
  Dit is het voorbeeld voor een gedeeld control, niet een reden om Godots
  scene-objectmodel of alle widgetfeatures te porten.
  [Invalidering](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/scene/gui/graph_edit.cpp#L642-L671),
  [verbindingen en zichtbaarheid](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/scene/gui/graph_edit.cpp#L1617-L1690).
- **Godots Animation State Machine Editor** behandelt een transition als
  zelfstandig selecteerbaar onderwerp met eigen details en bronmodelmutatie.
  Het is een afzonderlijke domeineditor, niet bewijs dat deze editor zelf op
  GraphEdit gebouwd is. BMSX neemt evenmin Godots runtime-state-semantiek over.
  [Transitionselectie](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/editor/animation/animation_state_machine_editor.cpp#L177-L208),
  [hit testing](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/editor/animation/animation_state_machine_editor.cpp#L318-L355).
- **Groot 1** is een onderhoudsreferentie, geen voorgestelde dependency. De
  boomplaatsing gebruikt gemeten nodes en niveaus. Maar `getChildren` kan
  uitvoervolgorde uit schermposities afleiden: dat nemen we **niet** over.
  Hier bepaalt Lua de childvolgorde, niet het canvas.
  [Plaatsing](https://github.com/BehaviorTree/Groot/blob/70973d004365f16d47a8c7bd9c5d84fa0bb9d05d/bt_editor/utils.cpp#L89-L264),
  [geometrisch gesorteerde children](https://github.com/BehaviorTree/Groot/blob/70973d004365f16d47a8c7bd9c5d84fa0bb9d05d/bt_editor/utils.cpp#L38-L83).
- **D3 hierarchy** levert het Buchheim/Reingold–Tilford tidy-tree-algoritme.
  De kleine, ISC-gelicentieerde implementatie is geadapteerd in de gedeelde
  layoutowner: gemeten halve nodebreedtes plus gap vervangen unit separation;
  de hoogtes per niveau volgen Groot. Geen hele D3-dependency, screen-size
  normalization, viewport-zoom of herhaald verschuiven van alle descendants.
  De iteratieve traversals behouden de aangeleverde siblingvolgorde.
  [Algoritme](https://github.com/d3/d3-hierarchy/blob/c6fa6b98d1028e80b27982c003a2a5ac5e8e3c87/src/tree.js),
  [ISC-licentie](https://github.com/d3/d3-hierarchy/blob/e6210810070d4e6360d0b4d8cecd2de8f2ca2ae9/LICENSE).
- **VS Code tree traits** plaatsen selectie op tree-niveau omdat een
  samengevouwen occurrence geen zichtbare listrij hoeft te hebben. De Lens
  bewaart daarom source-selection buiten de discriminated outline/graph-
  presentatie; de BT heeft geen verborgen outline als navigation owner.
  [Tree traits](https://github.com/microsoft/vscode/blob/1e1ee361e263c95c283dddceae3a7bd3373590ee/src/vs/base/browser/ui/tree/abstractTree.ts#L2398-L2420).
- **VS Code list commands** registreren Space als command met concrete
  controlfocus, niet met een actieve-tab-check. De BT gebruikt daarom de
  bestaande focuscommand-/keybindingowner; een Quick Input-tekstveld boven
  de grafiek houdt zijn spaties. Geen globale gameplaybinding of eigen
  raw-Space-dispatch in de contribution.
  [Toggle Expand](https://github.com/microsoft/vscode/blob/1e1ee361e263c95c283dddceae3a7bd3373590ee/src/vs/workbench/browser/actions/listCommands.ts#L697-L717),
  [focus zonder tekstinput](https://github.com/microsoft/vscode/blob/1e1ee361e263c95c283dddceae3a7bd3373590ee/src/vs/platform/list/browser/listService.ts#L106-L109).
- **aigen** is het eigen UX-voorbeeld: canvas centraal, details op verzoek,
  retained node-/wiregeometrie voor tekenen en aanwijzen. Zijn TUI-cellen en
  authored workflow-DAG zijn niet BMSX' representatie. Met name de
  topologische layout kan niet ongewijzigd cyclische FSM's plaatsen.
  [WorkflowScene](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_scene.py),
  [DAG-layout](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_layout.py#L226-L246).
  De vernieuwde inspector past zich aan selectie en beschikbare ruimte aan;
  zijn layoutowner behoudt de gemounte editors en hun document-/undo-state.
  Dat ownershipvoorbeeld hoort bij de latere canvas-slice, niet bij een
  tweede BMSX-documentlaag:
  [panegeometrie](https://github.com/Heer-Boaz/aigen/blob/5248d9c9a0b3bb1cde45a9088c9427d20d8f1b91/aigen/workflow_editor_layout.py#L44-L114).
- **BehaviorTree.CPP** bouwt afzonderlijke uitvoerende nodes per bezoek en
  voegt ordinary children in bronvolgorde toe. Dit ondersteunt het onderscheid
  tussen gedeelde definitiebron en afzonderlijke subtree-occurrences; BMSX'
  eigen `node_program.lua` blijft de semantische owner. Geen XML-runtime,
  subtreefactory of extra defensieve traversal-laag voor de source lens:
  [nodeconstructie en recursie](https://github.com/BehaviorTree/BehaviorTree.CPP/blob/9b63b505983f76e46d90d71c87d21fad0001f8a3/src/xml_parsing.cpp#L1042-L1092).
- **VS Code/Roslyn** blijven de referenties voor één textmodel en minimale
  bronbewerkingen, zoals vastgelegd in
  [Source-backed visual projections](../ide/ARCHITECTURE.md#source-backed-visual-projections).
  Een grafiek krijgt geen eigen document-undo of whole-definition serializer.

Dit zijn toepasbare ownershipvoorbeelden, geen bewijs dat een nog niet
gebouwde BMSX-grafiek correct, leesbaar of snel is.

## Live owners en ontbrekende contracten

| Owner | Wat bestaat | Wat vóór een grafiek moet veranderen |
| --- | --- | --- |
| `ide/workbench/contrib/behavior_lens/registrations.ts`, `registration_index.ts` | Semantisch herkende registrations, per resource én occurrence; workspace-generation-index | Het retained input volgt de gekozen call over edits; de catalogus levert geen duurzame identiteit op basis van bestandsnaam of runtime-id |
| `behavior_lens/model.ts`, `behavior_tree_model.ts`, `behavior_tree.ts`, `source.ts` | Typed BT-controlrollen, ordered relaties, attachments en provenance op dezelfde objecten als de outline; lokale const-table-resolutie en incomplete syntax | FSM-overgangen moeten nog expliciete bronfeiten worden; geen teruggeparste `label`-/`detail`-strings |
| `behavior_lens/controller.ts`, `editor_input.ts`, `view_model.ts`, `source_correspondence.ts` | Resource-owned input; refresh bij eigen textmodelversie; selectie/collapse en gekozen registration via gemapte occurrence-ketens | Grafiekviewport is geen listscroll. Cross-file feiten vereisen ook semantic-generation-invalidering |
| `ide/editor/text/text_change.ts`, `scene_editor/controller.ts`, `behavior_lens/source_correspondence.ts` | Gedeelde UTF-16-rangemapping; beide projecties volgen ranges ook terwijl hun pane verborgen is | Geen lokale offsetcorrecties of namesake matching |
| `ide/workbench/ui/graph`, `ide/workbench/render/graph.ts` | Retained node-/edgegeometrie, viewport, selectie, hit testing en pane-owned control | Gedeelde viewport en gemeten tree-layout gebouwd; BT-relaties en bronactivatie zitten in de concrete contribution, FSM-layout volgt afzonderlijk |
| `ide/runtime/overlay_renderer.ts`, TS/C++ `render/host_overlay` | Pooled overlaycommands, `Poly`-exposure en geordende cliprects | Clip-stack, scissor-batches en software-rastergrens gebouwd; geen feature-local glyph- of lijnclipper |
| `ide/input/pointer/capture.ts`, `dispatch.ts` | Eén captured fysieke gesture vóór gewone pane-/chrome-hit-tests | Graphcontrol gebruikt deze route; bestaande andere controls zijn hiermee niet allemaal gemigreerd |
| `cartlib/behaviour_tree/node_program.lua`, `cartlib/fsm/fsm.lua`, `fsm_component.lua` | De uitvoersemantiek die het beeld moet respecteren | Geen wijziging voor deze visualisatie; geen hostgeschreven tweede runtime |

## Eén bronprojectie, twee verschillende domeinen

De domain recognizers blijven in de workbench-contribution. Parser, binder en
Lua-query-store blijven generiek. De recognizer produceert eenmaal per
relevante brongeneratie getypeerde feiten met syntaxprovenance. Outline,
details en grafiek consumeren diezelfde feiten; zij hebben geen afzonderlijke
herkenning of interpretatie van presentatietekst.

Een grafieknode is niet automatisch ieder `BehaviorSourceNode`: property- en
sectionrijen zijn vaak details, geen controlflow. De vorm van de nieuwe types
wordt bij de betreffende domeinslice tegen de live producers vastgesteld;
geen universeel optioneel BT/FSM/ActionEffect-DTO of pluginregistry vooraf.

### BT: occurrences en ordered structuur

De BT-projectie bewaart expliciet:

- de registration en root-occurrence;
- per occurrence de herkende nodevariant en de authored/reference-syntax;
- per verbinding de ouder, child-occurrence, bronveld en controlrol:
  ordered child, weighted choice, main task of background tree;
- authored volgorde en weights als broninformatie, niet een opgemaakt label;
- services en decorators als ordered attachments aan hun eigenaar; blackboard
  en overige properties als details, niet als gewone treechildren;
- dynamische of gedeeltelijk herkende constructies op hun eigen bronpositie.

`node_program.lua` compileert ieder bezoek via `compile_node` naar een eigen
execution occurrence. Twee verwijzingen naar dezelfde immutable Lua-table
worden dus twee grafiekoccurrences met gedeelde definitionbron. Zij worden
niet één gedeelde uitvoerende DAG-node. Een samengevouwen subtree behoudt die
occurrence; openen van de gemeenschappelijke bron verandert dat niet.

Arrayvolgorde volgt de bewezen Lua-tableconstructie. Computed keys, bekende
mutatie of een builder bewijzen geen dichte ordered array; de recognizer mag
ontbrekende indices niet aanvullen of expliciete keys stilzwijgend hernummeren.
Een onbekende structuur blijft zichtbaar, niet als lege geldige subtree.

De layout plaatst parents en children op niveaus met gemeten nodeafmetingen,
volgens de boomplaatsingsreferentie. Zij bewaart de aangeleverde childvolgorde.
Een latere expliciete reorder-command verandert Lua; een visuele positie of
panbeweging doet dat nooit.

### FSM: mogelijke overgangen met aantoonbare herkomst

FSM-projectie bewaart statecontainment en concurrent regions afzonderlijk van
transitions. Een edge heeft een bewezen originscope, target en de bron van
trigger/overgang. Een initiële state is een entryrelatie, geen eventtransition.
De runtime kent ook impliciete initialisatie en pathsemantiek; de visualisatie
mag deze niet vervangen door een hostgekozen eerste of gelijknamige state.

| Bronbewijs | Wat het beeld mag zeggen |
| --- | --- |
| Statisch herkende `initial` en target binnen dezelfde scope | Entryrelatie naar dat target |
| Statische `go` of timeline-`on_finished` met bewezen origin en target | Gerichte **mogelijke** overgang, met event/timeline en relevante guardbron |
| Bewezen callbackbinding én bewezen returntargets in een slot dat returnpaths consumeert | Mogelijke callbackovergangen met zowel binding als returnbron; niet “deze overgang wordt uitgevoerd” |
| Parent-owned eventhandler | Relatie vanuit de handler-owningscope; niet gekopieerd naar iedere child alsof dispatchprioriteit ontbreekt |
| Imperatieve `transition_to(...)` met onbekende caller-/machinescope | Navigeerbare transitionbron; geen gefingeerde `from`-state |
| Computed target, history/pop, onbekende callbackuitkomst of niet opgeloste path | Expliciet dynamische relatie/attachment zonder verzonnen endpoint |

Alleen een string in een willekeurige functie vinden is geen transitionbewijs.
FSM-pathbetekenis volgt `fsm.lua`; componentbrede of machine-qualified aanroepen
volgen `fsm_component.lua`. Geen renderer-local pathparser, name matching over
alle FSM's, host-Lua-uitvoering of domeinregels in de generieke binder.
Ondersteunde pathvormen en callbackgevallen krijgen fixtures tegen deze owners;
de eerste tranche hoeft niet alle dynamische Lua te verklaren.

Concreet bij de huidige Sneeuwpop is `cooling_down → idle` rechtstreeks
onderbouwd door een timelinepath. `idle → ready_to_fire` en
`ready_to_fire → firing` vragen óók bewijs van callbackbinding en returnpath.
De losse imperatieve aanroep in `ray_finished` bewijst niet op zichzelf
`firing → cooling_down`. Deze cart illustreert de grens, maar zijn regelnummers
worden geen duurzame testverwachtingen.

Een FSM mag cyclisch en genest/concurrent zijn. BT-tree-layout of aigens
DAG-sort mag hem niet platdrukken. De concrete plaatsings- en routingkeuze
voor cycli, self-loops en parallelle edges is een expliciete ontwerpgrens vóór
de FSM-view-slice, niet een stilzwijgende grid- of force-layout-workaround.

## Bronidentiteit, navigatie en geldigheid

Drie identiteiten blijven gescheiden:

1. **Resource:** het bestaande `(domain, path)` en zijn `EditorTextModel`.
2. **Registration/occurrence:** een concreet syntactisch gebruik binnen die
   bron, inclusief de keten van verwijzingen naar hergebruikte subtrees.
3. **Runtime-instance/execution-slot:** niet afleidbaar uit een label, source
   range of graphindex; valt buiten deze authored visualisatie.

Huidige `rowKey`s onderscheiden occurrences binnen een projectie, maar zijn
geen duurzame identiteit over sourcewijzigingen. Bewaar selectie/collapse via
bewezen broncorrespondentie: registration plus occurrence-/referenceranges,
gemapt met de bestaande `mapTrackedTextRange` en geverifieerd tegen de nieuwe
projectie. Alleen een gedeelde initializer-range is onvoldoende bij hergebruik.
Dit gebeurt ook als de pane niet actief is.

Na verwijderen of volledig vervangen van de gekozen syntax bestaat die
correspondentie niet meer. De betrokken selectie/collapse vervalt; geen
andere rij, zelfde naam of latere undo krijgt haar op basis van een gok terug.
Een toekomstige source-move-command kan correspondentie leveren omdat die
command de echte move bezit. Handgeschreven UUID's in Lua zijn niet nodig.

De grafiek focust één gekozen registration binnen het bestaande resource-input.
Een opnieuw geopend onderwerp wordt niet afgeleid uit de actieve bestandsnaam.
`Source` opent de gekozen occurrence of het transitionveld. `Go to Definition`
volgt de normale semantische binding. Een edge met meerdere bewijsplaatsen
biedt die benoemd aan; het control kiest geen willekeurige range.

Projecties consumeren een consistente semantic/textgeneratie. De huidige
file-local const-resolutie wordt niet als cross-file callbackanalyse verkocht.
Zodra een feit op een ander document berust, is alleen `workingCopy.version`
als refreshsleutel onvoldoende: gebruik de bestaande semantic snapshot owner
en diens invalidatie, niet een parallelle dependency-engine. Geen query tijdens
draw of pointer-hit-testing. Een nieuwe bronversie kan geen oude actionable
edges of source-links behouden terwijl de projectie wordt ververst.

## Gedeeld canvas, geen nieuwe documentlaag

De toekomstige gedeelde control hoort bij `ide/workbench/ui`, met rendering
bij de bestaande workbench-rendergrens. Hij bezit:

- retained nodebounds, connectionroutes en dezelfde geometrie voor hit testing;
- viewport/pan, reveal-selection, selection en de actieve pointergesture;
- clipgrens, hitvolgorde en focus voor nodes én verbindingen.

BT/FSM bezitten betekenis, controlrollen, labels/details en de toepasselijke
layoutpolicy; zij leveren rechtstreeks de presentatie-input. Het control kent
geen Lua, `world`, BT-task of FSM-statepad. Het editorinput bewaart selectie,
collapse en viewport tussen paneactivaties; de herbruikbare pane bezit de
lopende interactie. Geen tweede graphdocumentservice of listscrollfacade.

De bestaande fysieke pointeredges blijven de enige press/release-producer.
Pane-/inputwisseling en sourcewijziging beëindigen de betrokken gesture zonder
een nieuwe press te maken. Focus, action bars, menu's en command palette lopen
via de bestaande commandroutes. Geen lokale shortcut-hintstrip of nieuwe
globale gameplaytoetsen. Zie [pointer ownership](studio_pointer_navigation.md).

`WorkbenchGraphViewport` bewaart modelgeneratie, pan en selectie bij het input.
`WorkbenchGraphControl` bewaart focus, hover, dubbelklik en draganchors bij de
pane. `PointerCaptureService` routeert de lopende fysieke gesture vóór gewone
hit testing, ook buiten de controlbounds. Release, verlaten van het display,
een modal/palette/menu, pane-detach of IDE-deactivatie beëindigt capture;
sluiten van een popup hervat de oude gesture niet. De service ontkoppelt vóór
de cancelcallback; alleen de eigenaar kan zichzelf releasen. Het model levert
geen nieuwe buttonhistorie. Dit volgt de scheiding in
[VS Code GlobalPointerMoveMonitor](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/base/browser/globalPointerMoveMonitor.ts)
en [Godots mouse-focus-route](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/scene/main/viewport.cpp#L2113-L2147).
Browser-pointercapture van het fysieke inputdevice blijft de hostowner;
geen DOM-widgetfacade of overgenomen exception/fallback-pad in het control.

Nodebounds en lijnpunten worden eenmaal met het echte font gemeten. Tekenen
en hit testing gebruiken dezelfde geometrie; nodes winnen boven achterliggende
edges en de dichtstbijzijnde zichtbare lijn wint binnen de hitradius. Hover
hergebruikt de vorige hit bij gelijke modelgeneratie en graphcoördinaten.
Een modelwisseling krijgt haar selectiecorrespondentie expliciet van de
domeinowner, niet via namen, rijen of guessed indices.

### Rendererprerequisite, niet wegtekenen

Het host-overlaycommand `Poly` levert lijnsegmenten; de IDE-exposure en
per-control clipgrens zijn bij de gedeelde overlayowner gebouwd. Pannende
tekst, nodes en edges mogen niet over tabs, menu of status heen tekenen of
buiten het canvas klikbaar zijn. Achteraf chrome erover schilderen, uitsluitend
volledig zichtbare nodes tekenen of per-feature glyphs afsnijden is geen clipcontract.

De viewport-slice heeft deze grens vóór zijn implementatie getoetst tegen de
bestaande quad-stream, headless en backendconsumenten. Onderstaande
representatietabel benoemt de TS/C++-spiegels en hot-pathcallsites;
zij is geen nieuw GX/PCRTC-register of C++-Studio-UI. Software, WebGL2 en WebGPU
krijgen hetzelfde productbewijs. Godots GraphEdit schakelt hiervoor zijn
bestaande Control-clipping in, niet een graphspecifiek afdekvlak:
[GraphEdit-constructie](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/scene/gui/graph_edit.cpp#L3375-L3385).

### Leesbaarheid en kosten

- Ontwerp en toets op **384×288 met het bestaande IDE-tiny-font**. Het canvas
  krijgt het hoofdvlak; details verschijnen op verzoek, niet in permanent brede
  linker- en rechterpanelen. Het geselecteerde onderwerp blijft herkenbaar.
- Eerst pan, reveal-selection en collapse met leesbare labels; geen verplichte
  zoom-to-fit die tekst onleesbaar maakt. Zoom, minimap en handmatig opgeslagen
  nodeposities zijn geen prerequisite voor de eerste BT-view.
- Parent/childvolgorde, edge-rol en selectie moeten zonder uitsluitend kleur
  begrijpelijk zijn. Services/decorators blijven herkenbaar bij hun eigenaar.
  Keyboard/controllerselectie volgt relaties en onthult het geselecteerde item;
  pointer is geen voorwaarde voor het lezen of openen van bron.
- Herkenning loopt alleen op relevante source-/semanticverandering. Meting en
  layout lopen bij gewijzigde inhoud, collapse of fontmetrics. Pan verandert
  de viewport, niet de brongrafiek; hover/selectie herkent of plaatst niets opnieuw.
- Draw consumeert retained zichtbare geometrie en de bestaande commandpools.
  Geen per-frame AST-walk, sourcetextformattering, routing of topologyallocatie.
  Buffers worden hergebruikt; een extra spatial index volgt alleen uit gemeten
  noodzaak. Meet ook hergebruikte subtrees: het aantal uitgeklapte occurrences,
  niet alleen het aantal bronregels, bepaalt dit werk.

### Clipgrens — representatie vóór de implementatie

Getoetst op `305a23c65`. Referentie is Dear ImGui's retained clip-stack en
draw-commandgrenzen; niet zijn vertexformaat of globale UI-context:
[clip-stack](https://github.com/ocornut/imgui/blob/ea6d21687bec144dd7aee0f4db37f7c61a8799bb/imgui_draw.cpp#L665-L694),
[batches](https://github.com/ocornut/imgui/blob/ea6d21687bec144dd7aee0f4db37f7c61a8799bb/imgui_draw.cpp#L591-L610),
[WebGPU-scissor](https://github.com/ocornut/imgui/blob/ea6d21687bec144dd7aee0f4db37f7c61a8799bb/backends/imgui_impl_wgpu.cpp#L588-L601).

| Representatie | TypeScript | C++ | Owner / betekenis |
| --- | --- | --- | --- |
| `HostOverlayClipRect` | vier integer `number`-grenzen | vier `i32`-grenzen | Halfopen logical-pixelrect, top-left origin; geen GX-register of scene-type |
| `Host2DKind.Clip` / `Host2DRef` | kind + rectreferentie | kind + union-rectpointer | Geordende clipwijziging in dezelfde publication lane; geldig tot consumptie |
| `HostOverlayClipState` | `reset`, `set`, `left/top/right/bottom`, dimensies | dezelfde namen en berekeningen | Rendertarget-owner schaalt naar pixels, truncateert en intersecteert met target; lege intersectie tekent niets |
| Nested clip-stack | gepoold in beide `OverlayRenderer`-buffers | geen native IDE-producent | Push intersecteert met parent; pop publiceert parent; opnieuw gebruiken van stackdiepte muteert geen eerdere commandreferentie |
| Quads / drawgrenzen | retained quad-stream met clipbatches | bestaande immediate GLES2-pipeline | WebGL2 bindt instance-offsets per batch; WebGPU gebruikt `firstInstance`; GLES2 zet scissor bij een clipcommand |
| Softwareclip | retained context van headless backend | retained clipstate van software backend | Fill- en atlasloops begrenzen hun rasterwerk vooraf, niet per pixel een nieuw clipfilter |
| Frame- versus targetafmetingen | `HostOverlayFrame.logicalWidth/Height`; pass `width/height` uit presenter | dezelfde velden en owner | De publicatie bezit logische tekenruimte, niet de framebuffer. `renderWidth/Height` vervallen; een bewaarde IDE-viewport mag de actuele game-/rewindtarget niet overschrijven |

Hot-path callsites: `OverlayRenderer.beginFrame/pushClipRect/popClipRect/endFrame`,
`HostOverlayQuadStream.reset/appendEntry`, WebGL2/WebGPU `renderStream`, headless
`drawHeadlessHostOverlayFrame/drawHeadlessHostMenuLayer/renderHeadlessHost2DEntry`,
C++ `beginHostOverlaySoftware/renderHost2DEntrySoftware`,
`SoftwareBackend::fillRect`, de software-atlasloops en
`beginHostOverlayGLES2/renderHost2DEntryGLES2/endHostOverlayGLES2`.
De volledige Studio-rewindproef vond een oude 384×288 IDE-override bij een
actuele 256×192 target. De bijbehorende ownerwijziging raakt
`writeHostOverlayState` / `writeHostOverlayPassState` en de gepoolde
`OverlayRenderer`-publicatie; niet iedere backend krijgt een herstelpad.
Net als bij de host-menu-lane komen de fysieke passafmetingen van de presenter.
GLES2 consumeert diezelfde `width/height` voor target, viewport en scissor;
`overlayWidth/Height` blijft uitsluitend de logische shader-/clipruimte.
Iedere lane begint opnieuw met de volledige targetclip. Accelerated clipping
wordt aan het paseinde uitgezet; geen capture/restore van vreemde renderstate.
Dit verandert geen guest-datapath, scanout, z-order of commandpayload van de
bestaande tekenprimitieven. Pannen hergebruikt lijnroutes; alleen de bestaande
Poly-submission vertaalt punten naar schermcoördinaten in retained opslag.

## Bouwvolgorde en bewijs

### Concrete BT-view: ownerbesluit vóór implementatie

Getoetst op `a9953b819`. De Lens-selectie verhuist van de zichtbare rij-index
naar een source-occurrence-key. De bestaande text-range-correspondentie blijft
die key over edits volgen. Een discriminated presentation bevat óf de bestaande
outline, óf een retained BT-grafiek; geen onzichtbare outline die de grafiek
bestuurt. De gekozen registration bepaalt de BT-root. Een ontbrekende of
dynamische bron wordt als zodanig getoond, niet als verzonnen lege geldige boom.

Layout volgt D3 hierarchy's Buchheim/Reingold–Tilford-implementatie: twee
iteratieve walks, contourthreads en uitgestelde subtreeverschuivingen. Alleen
de vaste-size-layout wordt overgenomen; scheiding gebruikt gemeten nodebreedtes,
en niveaus de maximale nodehoogte. Geen sortering op schermposities,
zoom-to-fit of herhaalde subtreeverplaatsing per parent. De bronlicentie blijft
bij de gedeelde tree-layout-owner. Groot is de referentie voor gemeten BT-nodes
en levelafstand; niet zijn geometrische childsortering.
[D3 tree](https://github.com/d3/d3-hierarchy/blob/v3.1.2/src/tree.js).

De contribution vertaalt alleen typed branches naar verbindingen. Kindnummers,
weights en main/background-rollen blijven leesbaar bij de childcard; services
en decorators worden als attachments aangegeven, nooit gewone controlchildren.
De bestaande Quick Input toont op verzoek source-details/properties en hun
bronlocaties. Dit is een read-only bronkeuze, geen generieke property-inspector
of authoringfacade. Collapse/expand, details en source krijgen echte commands
in de bestaande action-bar-/palette-owner, geen los toetsen-hintstrookje.

Keyboard/controller volgen parent/child/sibling-relaties en onthullen selectie;
blank-canvas-drag en wheel pannen. De pane bindt de toepasselijke keyboardroute
aan het graph-focus-target; de gedeelde canvas krijgt geen BT-kennis. Draw, hover
en pan vernieuwen geen bronprojectie, labels of layout. Nieuwe tests gebruiken
vaste Lua-fixtures; carts blijven integratiesmoke.

Dit zijn opeenvolgende ownercontracten. Geen enkele rij heet klaar doordat
alleen een typecheck slaagt. De latere rijen zijn nog te toetsen hypotheses.

| Slice | Afgebakende eindtoestand en bewijs |
| --- | --- |
| `STUDIO-BT-SOURCE-GRAPH-01` — geïmplementeerd | De bestaande recognizer levert typed ordered BT-occurrences/relaties met echte provenance. Outline en registratiekeuze consumeren diezelfde feiten. Selectie/collapse volgen bewezen bronwijzigingen, ook bij verborgen pane. Fixtures: twee registrations in één file, drie uses van één subtree, parallelrollen, weights/attachments, comments vóór bron, gewijzigde initializer, insert/delete/reorder van occurrences en onbekende constructies. Geen graphrenderer of runtimewijziging. |
| `IDE-GRAPH-VIEWPORT-01` — geïmplementeerd | Gedeeld retained canvas met clipping, pan, node-/edgeselectie en focus/lifecycle. Domeinvrije fixture bewijst half-zichtbare tekst/lijnen/nodes, targetwissels, rand-hit-testing en held-pointer paneovergang op alle drie backends. De echte Studio-palette onderbreekt capture via de centrale dispatcher. Geen behaviorsemantiek of extensieframework. |
| `STUDIO-BT-GRAPH-VIEW-01` — geïmplementeerd | Eén gekozen BT als ordered visuele boom, attachments/details, collapse, source-navigation en relationship-based keyboard/controllerbediening. Inspecteer echte 384×288-captures en bronnavigatie na pan/collapse/tabwisseling. Een brede en diepe fixture meet projection/layout/hit/draw apart; idle/hover/pan bewijzen geen herhaalde herkenning. Echte carts blijven integratiesmoke. Dit is nog geen editable BT. |
| `STUDIO-FSM-SOURCE-GRAPH-01` | Na BT: typed containment/entry/transitionfeiten met bewijs en expliciete onbekende relaties; geen lines uit strings. Fixtures bewijzen scopes, guards, directe paths, ondersteunde callbacks, meerdere machines en dynamische targets. Iedere ondersteunde path-/callbackvorm volgt de runtime-owner; cross-file bewijs kan niet zonder semantic-generation-invalidering. |
| `STUDIO-FSM-GRAPH-VIEW-01` | Eerst de professionele layout-/routingkeuze voor cycli en hiërarchie uitwerken en meten, daarna de view. Fixture met self-loop, twee edges tussen dezelfde states, parenthandler, nested en concurrent scopes; edges blijven selecteerbaar en verwijzen naar hun eigen bewijs. Geen tree/DAG-normalisatie. |

`STUDIO-BT-VISUAL-EDITOR-01` blijft het afzonderlijke **authoring**contract.
Nieuwe add/remove/reorder/connect-commands moeten hun minimale Lua-edit en
broncorrespondentie bewijzen voordat zij beschikbaar worden. Canvaslayout
wijzigt geen bron en krijgt geen plaats in cartlib of ROM. ActionEffects
behouden voorlopig hun eigen huidige Lens-presentatie; zij worden niet in een
BT/FSM-grafiekmodel geperst. Live traces blijven afzonderlijke observaties.

`IDE-STUDIO-TEST-FIXTURES-01` blijft het afgesproken vervolg voor de bestaande,
cartgebonden Studio-tests. Nieuwe contracttests beginnen direct met zelfstandige
Lua-fixtures in de bestaande testharness; geen vervangende fake parser,
source-rangeproducer of inputowner. Nemesis/Pietious laten bruikbaarheid en
integratie zien, maar hun huidige namen en regelnummers definiëren de API niet.

### Bewijs van de BT-bronslice — 9 september 2026

`behavior_tree_model.ts` geeft de bestaande source-occurrences typed root-,
branch- en attachmentvelden. Weights, primary fields en listentries behouden
de echte AST-velden; geen omweg via displaystrings, genormaliseerde runtimewaarden
of een parallelle graaf. Alleen de bij de nodevariant behorende velden zijn
controlbranches. Incidentele `children` op een `wait` blijven source-informatie.
Computed arraymembership blijft expliciet onopgelost in de sectionbron, niet
een gegokte ordered child. Bekende mutaties worden niet uitgevoerd.

`source_correspondence.ts` volgt half-open UTF-16-spans met de bestaande
text-change-owner, ook in verborgen inputs. Een match vereist een overeenkomende
parent-occurrence en dezelfde gemapte syntactische use, niet alleen een
gedeelde initializer. Een verwijderde use wordt niet vervangen door zijn
namesake; cut/paste of later Undo bewijst geen move-identiteit. Bronopenen na
refresh gebruikt actuele nodes, niet eerder bewaarde regel-/kolomcoördinaten.
De pane bezit clickhistorie; inputwisseling beëindigt die gesture en een
nieuwe sourcegeneration kan de oude clicked node niet opnieuw activeren.

De live proef vond daarnaast een prerequisite: directe
`EditorTextModel.pushEditOperations` konden een zichtbare code-layout met oude
regels achterlaten. De codepane subscribeert nu op model-contentevents en
`CodeLayout` invalideert de getroffen regels. `PieceTreeBuffer` blijft de
tekst- en offset→positie-owner; `textChangesEndOffset` bepaalt uitsluitend de
eindoffset van een applied-order editbatch. Geen renderergrenzencheck,
test-only layoutreset of per-frame documentvergelijking. Dit volgt de
model-events→view-lines-koppeling van
[VS Code ViewModel](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/common/viewModel/viewModelImpl.ts).

- `tests/helpers/behavior_source_fixture.ts` levert dezelfde zelfstandige Lua
  aan unit- en live Studio-tests. `tests/lua/behavior_source_graph.test.ts`
  toetst branches/weights/attachments, hergebruik, duplicates, incomplete
  syntax, hidden edits, delete/replace/Undo, reorder en een 64-level subtree.
  Gemeenschappelijke range-invarianten worden ook met zelfstandige FSM- en
  ActionEffect-bron getoetst.
- `studio_behavior_source.ts` gebruikt de echte palette, paneactivatie,
  keyboard/pointer, textmodel-events en Undo. Beide echte carts slagen voor
  de navigatieproef op software, WebGL2 en WebGPU. Een held Source-press wordt
  geen tekstselectie; verborgen bronwijzigingen volgen dezelfde occurrence;
  30 idle frames behouden document en rijobjecten. Machinepositie en
  geïnstalleerde media veranderen niet.
- De volledige Studio-workflow slaagt op alle drie backends, inclusief
  source-apply, Hot Resume, scene-edits en de bestaande negatieve faulttests.
  Captures zijn geïnspecteerd: dit bewijst de bestaande outline/codeweergave,
  niet de leesbaarheid van een nog ontbrekende grafiek.
- IDE-typecheck, Lua-tests, rompacker-tests, core-parity, architecture-boundary
  audit en indentcheck slagen. De hele tests-typecheck heeft 52 bestaande
  diagnostics; een compilerhostvergelijking tegen `6b3a84ac5` geeft exact
  dezelfde diagnostics, geen nieuwe.

Kostenmeting op Node 22.23.1, 10 warmups en 20 samples, reeds opgebouwde
syntax/bindingdata: 131 source-nodes kosten circa 0,11 ms projectie en 0,08 ms
reconciliatie; 10.243 source-nodes uit 1.024 hergebruikte subtrees circa
3,93 ms en 3,65 ms. De eerdere outline-only projectie kostte in die grote
fixture circa 2,27 ms: de typed feiten/correspondentie zijn dus niet gratis.
Twee rangemapping-events samen kosten daar circa 0,07 ms. Dit zijn lokale
medianen, geen parser-, canvas-, GPU- of prestatietoezegging voor elk apparaat.
Reconciliatie indexeert kandidaten per gematchte parent, geen globale
kwadratische namesake-scan; dit werk draait niet tijdens idle draw.

### Bewijs van de gedeelde viewport — 9 september 2026

`tests/conformance/graph_viewport/README.md` bevat de reproduceerbare commando's
en expliciete bewijsgrenzen. Dit is de canvasbasis, niet de concrete BT-view.

- `host_overlay_clip.test.ts`, `workbench_graph.test.ts` en
  `pointer_capture.test.ts` bewijzen retained clips/commandbuffers, geometrie,
  edgeafstand/hitvolgorde, halfopen grenzen, reveal, dubbele clicks en
  gesturebeëindiging bij focus-/input-/modelwisseling. De bestaande
  quad-streamtest gebruikt nu werkelijk beide fontvarianten: de oude
  `new Font(variant)` gaf ten onrechte een string aan een options-constructor.
- De domeinvrije browserfixture draait op **software, WebGL2 en WebGPU**.
  Zes gedeeltelijk zichtbare primitiefsoorten leveren per backend een exacte
  pixel-crop van hun eigen ongeclipte raster. Echte pointer-/keyboardinput,
  editorpane-hergebruik en 384×288→256×192→384×288-targetwissels slagen.
  Tiny-font-captures zijn bekeken; dit is nog geen bewijs voor BT-layout-UX.
- **Native software en GLES2** slagen met hetzelfde primitivecorpus.
  Het GLES2-pad draait op een echte EGL-rendercontext en toetst tevens lege
  clips, logical→physical-schaal en het loslaten van scissor aan het paseinde.
  GX/GPU- en glyph-runregressies slagen eveneens (4 native tests samen).
  Geen claim over een fysieke SNES-mini of ieder GPU-driverplatform.
- De volledige **Studio-workflow** slaagt op alle drie browserbackends,
  inclusief de echte rewind-/Hot-Resume-/source-editflow en de bestaande
  negatieve faulttests. De toegevoegde proef opent de echte Command Palette
  terwijl een fysieke gesture captured is: die stopt definitief. Geen
  test-only reset of vervangende featuredispatcher.
- De Studio-proef vond de hierboven beschreven dubbele targetowner. Een
  kleinere echte framebuffer kreeg de oude IDE-afmetingen als scissor.
  `HostOverlayFrame` publiceert nu uitsluitend zijn logische ruimte;
  passafmetingen komen van de presenter. Geen corrupt-state-clamp of
  WebGPU-only workaround. De software-lijnproef vond daarnaast fractionele
  eindpunten in een integer Bresenham-loop: conversie gebeurt nu op de
  rastergrens zoals in C++, niet in het graphcontrol.
- IDE-typecheck, browser-productbuild, **1.007 Lua-tests geslaagd / 1 skip**,
  core-parity, strict architecture-boundaries (0), indent en diffcheck slagen.
  De volledige tests-typecheck is niet groen: **51 bestaande diagnostics**.
  Vergelijking met `305a23c65` geeft alleen het verdwijnen van de genoemde
  font-constructorfout (52→51), geen nieuwe diagnostics.

Kostenproef: Node 22.23.1, 256 nodes/255 routes, 1.000 warmups en daarna
5.000 idle- en 5.000 panframes. Koude geometrie circa 1,0 ms; warm
command-emission plus quad-stream circa 24 µs idle en 27 µs bij pan per frame.
De stationaire pointer doet één hit-test, warm wordt het font nulmaal opnieuw
gemeten en de quadbacking blijft hetzelfde object. Deze lokale meting omvat
geen Lua-projectie, GPU-upload/raster of totale Studio-frametijd en is geen
bewijs van nul JavaScriptallocaties of een snelheidsgarantie voor andere hosts.

### Bewijs van de concrete BT-view — 9 september 2026

De input bezit nu source-selection buiten een discriminated outline/graph-
presentatie. FSM/ActionEffect blijven hun bestaande outline gebruiken; een
gekozen BT bouwt geen verborgen lijst. De concrete projection consumeert typed
branches en de nieuwe afzonderlijke `referenceLabel` van de sourceproducer,
geen teruggeparste displaystring. D3's tidy-layout zit bij de gedeelde graph-
owner; de contribution bezit de source-links en orthogonale routing. Rechte
verbindingen bevatten geen redundante nulsegmenten. Collapse en bronrefresh
bewaren de schermpositie van de bewezen selectie; een niet meer zichtbare
controlflow-occurrence wordt niet als onzichtbaar geselecteerd object bewaard.

Een verbinding heeft eigen bronprovenance. Bij een weighted choice is dat de
choice-use in de ordered lijst, niet de `child`-use in een gedeelde initializer.
Node-activatie kan die childbron juist wel openen. Dezelfde bestaande source-
correspondentie volgt beide selectierollen. Details bieden individuele
bronvelden via Quick Input, zonder dubbele policy-samenvattingen of een tweede
propertymodel. Onopgeloste membership krijgt een expliciete bronkaart.

Reproduceerbare commando's en bewijsgrenzen staan in
[`tests/conformance/behavior_graph/README.md`](../tests/conformance/behavior_graph/README.md).
De onafhankelijke bron-/layouttests omvatten hergebruikte choices, variabele
nodeafmetingen, brede/asymmetrische bomen en een iteratieve boom van 10.000
niveaus. De live Studio-proef gebruikt dezelfde vaste Lua als tekstmodelbron,
nooit een geïnjecteerde executable of guest-hook. Toetsen/controller volgen
parent/child/siblings; Space/Y toggelt één occurrence via de concrete graph-
focuscommand. Ctrl+Space en spaties in de palette wijzigen de grafiek niet.
De echte action bar en
palette openen details/bron, inclusief een edge en weight/decorator-field.
Hidden edits, pane gestures, delete/Undo en retained idle frames blijven getest.

De volledige Studio-workflow en de afzonderlijke Nemesis-/Pietious-navigatie
slagen op software, WebGL2 en WebGPU. De bekeken captures gebruiken de echte
384×288-ruimte en het IDE-tiny-font, inclusief clipping onder meerregelige tabs.
De bestaande headless Behavior Lens-proef slaagt met 62 assertions.
IDE-typecheck, browser-/headless-productbuild, **1.016 Lua-tests / 1 skip**,
core-parity, strict architecture-boundaries (0), indent en diffcheck slagen.
De tests-brede typecheck houdt **51 bestaande diagnostics** ten opzichte van
`a9953b819`; alleen de volgorde van twee unionleden in één diagnostic verschilt,
geen nieuwe fout of verschoven foutlocatie. De oude gamegebonden golden tests
blijven de aparte `IDE-STUDIO-TEST-FIXTURES-01`-backlog.

Kosten op Node 22.23.1, medianen uit de gedocumenteerde profile:

| Volledig uitgeklapte fixture | Bronprojectie | Kaartprojectie/meting | Layout + routes | Hit | Draw + quadstream |
| --- | --- | --- | --- | --- | --- |
| 24 hergebruikte subtrees / 74 kaarten | 0,13 ms | 0,20 ms | 0,055 ms | 0,49 µs | 15 µs |
| 1.024 hergebruikte subtrees / 3.074 kaarten | 1,92 ms | 3,38 ms | 0,42 ms | 23 µs | 156 µs |

Warm tekenen meet geen fonts opnieuw en behoudt de quadbacking. Dit zijn
lokale hostmetingen zonder parsing, GPU-upload/raster of totale Studio-frametijd;
geen prestatiegarantie, nulallocatieclaim of kosten in de 33.8688-MHz-guest.
FSM-relatiebewijs/cyclische layout, graph-authoring en runtime-execution-overlay
zijn hiermee nadrukkelijk niet gebouwd.
