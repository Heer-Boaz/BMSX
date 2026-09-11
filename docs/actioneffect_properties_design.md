# ActionEffect property-view — ownership vóór presentatie

Uitgangspunt: `96957d571`, 9 september 2026. `STUDIO-ACTIONEFFECT-SOURCE-01`
is gebouwd. `STUDIO-ACTIONEFFECT-PROPERTY-VIEW-01` is nu eveneens
geïmplementeerd; onderaan staan het uitgevoerde bewijs en de afbakening.

De [gebruikersreview na A04, B06](behavior_authoring_ux_review.md#b06--actioneffect-inspectie-vanuit-functionaliteit)
vraagt een herontwerp van dubbele lijstpreviews, callbackpresentatie en echte
propertybewerkingen. De niet-mutating presentatie en volledige inspectie zijn
nu herzien; propertyauthoring blijft afhankelijk van B04. De bestaande bron- en
runtimegrenzen hieronder blijven gelden, niet iedere historische presentatiedetail.

### B06-presentatiecontract vóór de wijziging

Opnieuw gelezen: Godot `EditorPropertyArray::update_property` en de
[array/dictionary-controls](https://github.com/godotengine/godot/blob/cb41ea115914c61a8329087b4cffbad7477b8427/editor/inspector/editor_properties_array_dict.cpp).
De arraykop kan type/omvang tonen in plaats van een tweede inhoudsrepresentatie;
elementcontrols kunnen zonder apart label alle beschikbare breedte gebruiken.
Hier volgen we die presentatiegrens, niet runtime-Variantreflectie, paging of
Godots disabled `Callable`-placeholder.

- Een bewezen requirementlijst toont een compacte omvang bij zijn veld en
  eenmaal de individuele authored waarden eronder. Een directe constructor
  wordt niet nogmaals als `{...}` getoond. Een alias blijft herkenbaar bij de
  kop; partial en unresolved blijven expliciet en suggereren geen runtime-size.
- De generieke property-tree ondersteunt een waarde zonder zijlabel. Layout
  publiceert de concrete value-start; paint consumeert diezelfde geometrie.
  Zo krijgt een tag geen ordinalenaam en ook geen lege 40%-naamkolom.
- Inline callbacks tonen de syntactische parameterlijst; referenties en andere
  expressies blijven originele bronpreviews. Dit is geen call-resolution of
  evaluatie. Details leest de volledige oorspronkelijke bron, inclusief trivia.
- De twaalf fieldrollen, Source-occurrences, ordinary source Undo en retained
  layout blijven gelijk. Propertymutatie volgt pas het sterkere B04-contract;
  deze presentatiewijziging sluit B06-authoring niet af.

Uitgevoerd bewijs: 1.408 Lua-tests groen en één bestaande skip (1.409 totaal),
IDE-typecheck groen, dezelfde 51 bestaande tests-projectdiagnostics. De echte
Pietious-navigationflow slaagt op software, WebGL2 en WebGPU: alle twaalf rollen,
alias/partial requirements, selectie/Details/held Source/Back, source Undo en
behoud van machineclock/media. Nieuwe zelfstandige proeven testen full-width
waarden, cold-only meting, multiline functieparameters, varargs en exacte
ongewijzigde bron. De complete/partial tiny-font-uitvoer is visueel bekeken.
Studio-build, strict boundary-audit (0 issues), parity, indentation en diff-check
slagen. Deze slice wijzigt geen cartlib, compilersemantiek of runtime.

## Getoetste productiereferenties

- [Godot EditorProperty](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/editor/inspector/editor_inspector.cpp#L428-L584)
  scheidt gemeten label-/valuegebieden, thema, selectie en tekenen. De
  [Inspector](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/editor/inspector/editor_inspector.cpp#L4504-L4554)
  groepeert properties expliciet. Overnemen: propertykolommen en groepen,
  niet reflectie, Object/Variant-mutatie of een tweede runtime-inspector.
  [Section-input](https://github.com/godotengine/godot/blob/9552dfb6859a1aaba1e570b8e0ef5c599b830f19/editor/inspector/editor_inspector.cpp#L2678-L2691)
  behandelt accept op een groep als in-/uitklappen, niet als propertymutatie.
- [Unity VolumeComponentEditor](https://github.com/Unity-Technologies/Graphics/blob/a7e4c051d256a781ab362c64316b125a1e104694/Packages/com.unity.render-pipelines.core/Editor/Volume/VolumeComponentEditor.cs#L326-L354)
  bindt propertymetadata bij initialisatie; [tekenen](https://github.com/Unity-Technologies/Graphics/blob/a7e4c051d256a781ab362c64316b125a1e104694/Packages/com.unity.render-pipelines.core/Editor/Volume/VolumeComponentEditor.cs#L408-L427)
  consumeert die bindings. Hier is dat één Lua-sourcegeneration, geen per-frame
  discovery, SerializedObject of live-objectschrijfpad.
- [VS Code settingsTree](https://github.com/microsoft/vscode/blob/0af2bfdddee61954b27fdb831f7a8b20a139126b/src/vs/workbench/contrib/preferences/browser/settingsTree.ts#L1139-L1170)
  scheidt group- en propertytemplates van de generieke tree. De
  [tree-owner](https://github.com/microsoft/vscode/blob/0af2bfdddee61954b27fdb831f7a8b20a139126b/src/vs/base/browser/ui/tree/abstractTree.ts#L3320-L3374)
  bezit collapse/parent en expand/child; collapse en selectie zijn onderscheiden
  veranderingen. Geen DOM-, extensionregistry- of configuratieschema-overname.

## Productcontract

Eén gekozen ActionEffect krijgt een property-view in het volle IDE-hoofdvlak,
met tiny-font, categorieheaders, aparte naam/waarde-kolommen, uitklapbare
requirementlijsten en een begrensd uitlegvlak onderaan. Geen permanent breed
zijpaneel, zoom-to-fit, graph-worker of pijlen tussen niet-bewezen stappen.

Groepen zijn **presentatie**, niet authored nodes of een executable model:
Grant, Trigger requirements, Cooldown, Periodic, Execution en Unresolved source.
Alleen groepen met aanwezige bronvelden verschijnen. Hun volgorde is geen
uitvoeringsvolgorde. `period_ms` krijgt expliciete uitleg dat periodieke uitvoering
de trigger-gates/cooldown niet doorloopt. `event` is output; callbacks worden
niet geëvalueerd en krijgen geen gegokte event-/spawnrelaties.

Een property/requiremententry verwijst naar exact dezelfde `BehaviorSourceNode`
als het typed effectmodel. Labels komen uit contribution-owned displaymetadata;
waarden blijven bronexpressies, geen berekende milliseconden/defaults. Computed
keys, bekende mutaties en onopgeloste lijsten blijven zichtbaar als partial source.
Een groepsselectie bezit géén verzonnen Lua-range; Source opent daar de gekozen
registration. Een fieldselectie opent haar eigen authored/reference-range.

## Owners en grenzen

- `workbench/ui/tree_view.ts` blijft topology/collapse/navigation-owner. Zijn
  navigatieresultaat onderscheidt selection en collapse, zodat contributions
  geen boom hoeven te scannen om een verandering te reconstrueren.
- Een gedeelde property-tree-layout/renderer bezit kolommen, clipping, gemeten
  tekst en de retained uitlegregels. Zij kent geen Lua, ActionEffect of document-
  undo. Zij gebruikt bestaande tree-, list-, text-, theme- en overlayowners.
- De ActionEffect-contribution projecteert typed source naar die tree, bewaart
  groepsvoorkeuren los van bronidentiteit en gebruikt de bestaande source-
  correspondence voor echte fields en hun collapse/selectie. Zij geeft geen
  faux `BehaviorSourceNode` aan een visuele groep.
- De pane bezit fysieke gestures; nieuwe sourcegeneration/detach beëindigt een
  clickreeks. Focusverlies, andere navigatie en een nieuwe click op lege ruimte
  beëindigen haar ook: de pane abonneert zich op de bestaande focusowner, niet
  op een speciale palette-dismiss-hook. Focus, acties, palette en Source
  gebruiken de bestaande owners.
  Tekenen, hover en idle updates bouwen geen metadata/tree of tekst opnieuw.
- De bestaande expliciete raw-sourceoutline blijft bruikbaar voor de
  source-contractproeven. Een gekozen ActionEffect gebruikt de nieuwe property-
  presentation en bezit geen verborgen outline-rijen. Er is geen automatische
  outline-fallback bij onbekende bron of een verdwenen registration.

## Bewijs vóór afronden

Zelfstandige generic-control- en Lua-fixtures: geometrie/clipping, folds,
toetsen/controller/pointer, meerdere registrations, gedeeltelijke bron,
selected-fieldcorrespondentie, hidden edits/Undo en verdwijnen van de definitie.
Echte Studio op software/WebGL2/WebGPU: dezelfde flows met fysieke Source-
gestures, scene- en BT/FSM-regressies, pauze/Hot Resume en ongewijzigde media.
Inspecteer echte 384×288-uitvoer en meet koude projectie/layout afzonderlijk van
warme update/hit/draw. Geen nieuwe cartlib-, compiler-, machine- of C++-ABI.

Dit is een read-only visualisatie van authored Lua. Property-authoring vereist
later een afzonderlijk bewezen source-editcontract; er komen nu geen succesvolle
editstubs, tweede working copy of controls die schrijven zonder echte undo-owner.


## Implementatie en bewijs — 9 september 2026

- `action_effect_properties.ts` bindt één gekozen typed body aan de bestaande
  tree-topology. Een category heeft geen source-node; echte fields/entries wel.
  Complete, partial, lege, onopgeloste en verdwenen bron zijn onderscheiden.
  Source gaat via de bestaande workbench-navigation en deelt het textmodel.
  De controller kiest de concrete presentation vóór inputconstructie; ook een
  FSM start niet meer met tijdelijk opgebouwde outline-rijen die direct weer
  worden weggegooid. De expliciete outlineconstructor blijft voor bronproeven.
- `ui/property_tree.ts`, `ui/property_tree_pointer.ts` en
  `render/property_tree.ts` scheiden retained layout, gestures en paint.
  Inklappen wijzigt de visible rows, niet de opgeslagen nodes of gemeten tekst.
  De footer begint na hele rijen: er zijn geen ongetekende maar wel hittable
  gedeeltelijke rijen. De gedeelde Lua-previewreader toont originele tekst en
  kapt multiline syntax expliciet af; geen whitespace-normalisatie in strings.
  Een single-line value leest alleen zijn eigen text-range, niet telkens de
  gehele mogelijk gefragmenteerde bronregel van een grote requirementlijst.
- Bij de gesture-review bleek dat alleen detach/generation-identity niet
  voldoende was: een palette kan tussendoor focus krijgen zonder de pane te
  sluiten. De bestaande focusowner beëindigt nu ook die clickreeks. De echte
  Studio-proef controleert single click → palette → cancel → single click: geen
  Source-activatie. Een daaropvolgende echte double-click werkt, ook als de
  tweede press wordt vastgehouden.
- Lua-suite: **1.085 geslaagd, 1 bestaande skip** (1.086 totaal). Elf nieuwe
  zelfstandige control-/propertytests; bestaande tree-/FSM-tests mee gedraaid.
  De onafhankelijke fixtures toetsen ook strings met dubbele spaties en
  long-string casing, geen uitvoerbare callbacks of guessed defaults.
- ROM-packer: **123 geslaagd**. Browser Studio en Node tooling bouwen; de
  echte headless Behavior Lens slaagt met **59 assertions**. IDE-typecheck
  groen. Tests-typecheck behoudt **51 bestaande diagnostics**, op dezelfde
  locaties/codes als `96957d571`; geen claim van een volledig groene check.
- Volledige Studio-workflow en beide cart-navigationruns slagen op software,
  WebGL2 en WebGPU. De effectfixture is zelfstandige authored Lua, geen
  `nemesis_s`-/`pietious`-regelnummercontract. Zij bewijst meerdere registrations,
  held Enter/A, group/field double-click, controller/tree/palette-focus, echte
  Source-links, verborgen UTF-16-edits, gewone Undo en partial requirements.
  De scrollfixture vergroot die bronlijst via een gewone edit: echte wheel,
  Home/End en Undo gebruiken dezelfde pane en source-owner. Gepauzeerde
  machinepositie en geïnstalleerde media blijven ongewijzigd.
- Complete/partial 384×288-uitvoer is via echte rendererpixels geïnspecteerd.
  De software-capture publiceert alleen het werkelijke softwareframebuffer;
  er is geen aparte UI-testpainter. WebGL2/WebGPU zijn Chromium/SwiftShader-
  correctheidsproeven, geen gemeten fysieke GPU-performance.

- Architecture-boundaries strict: **nul issues**; core-parity, indentationcheck
  en `git diff --check` geslaagd. Geen machine-, C++- of cartlib-edits.

### Kosten

Node 22.23.1; 10 warmups / 25 mediaansamples, zonder gelijktijdige tests.
Eén gekozen effect met twaalf fields en een variërende requirementlijst:

| Requirements / UI-rijen | Koude propertyprojectie | Koude tekst/layout | Warme inputupdate | Warme hit | Draw + quad-emissie |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 / 21 | 0,042 ms | 0,028 ms | 0,065 µs | 0,006 µs | 9,65 µs |
| 256 / 276 | 0,150 ms | 0,058 ms | 0,060 µs | 0,014 µs | 7,95 µs |
| 4.096 / 4.116 | 2,600 ms | 0,415 ms | 0,031 µs | 0,015 µs | 8,06 µs |

Warm: **nul nieuwe fontmetingen**, dezelfde root-/rowobjecten en quadopslag,
geen graph-enginestart. Warm draw bezoekt alleen zichtbare rijen. De snellere
warme samples bij grotere lijsten zijn geen scalability-winstclaim: het zijn
afzonderlijke JIT-/zichtbare-inhoudsamples. Koude projectie is niet gratis;
meer requirements kosten meer nodes/tekst. De meting sluit source analysis,
GPU-raster, totale Studio-frametijd en guest-runtime uit, en is geen heap-
allocationprofiler. Er is geen nieuwe per-worldtick/cartlib-code.

Commando's staan in `tests/conformance/behavior_graph/README.md`; lokale logs,
bronreferenties, typecheck-baselinevergelijking en captures in
`/tmp/bmsx-actioneffect-view`. De grens blijft **read-only visualisatie**:
visueel authoren, callbackanalyse en runtime-inspection zijn hiermee niet
gebouwd of als perfecte toekomstige extensie bewezen.
