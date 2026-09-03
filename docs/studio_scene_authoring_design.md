# Studio scene-authoringarchitectuur

Status: **architectuurcontract; geen scene-implementatie vóór de hieronder
genoemde owner-slices**

Dit document ontwerpt scene-authoring vóór UI of runtimecode. Het vervangt de
verworpen aanname dat Studio de cartlib-`World` alleen mag observeren. Studio
mag de echte scene en `WorldObject`s bewerken, maar wordt daardoor niet hun
owner: canonical source, cartlib-lifecycle, guestwaarden en host-viewstate
blijven afzonderlijke representaties.

## Professionele referenties en gevolgen

Godot bewaart scenecompositie als `SceneState`, instantiateert daaruit echte
nodes, stelt properties in, lost node-references uitgesteld op en geeft nodes
pas daarna scene-eigenaarschap. De editor muteert vervolgens de echte edited
scene via de centrale undo-owner en stuurt dezelfde structurele actie naar de
live debugscene:

- [`SceneState::instantiate`](https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/scene/resources/packed_scene.cpp#L231-L756)
- [`PackedScene::instantiate`](https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/scene/resources/packed_scene.cpp#L2579-L2599)
- [Scene Tree instantiate/undo/live-debugactie](https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/editor/docks/scene_tree_dock.cpp#L406-L428)

Unity instantiateert een prefab rechtstreeks in een expliciete destination
`Scene`. De Hierarchy bewaart haar TreeViewState, selectie en expansion als
viewstate boven de scene data source; prefab/propertymutaties lopen via de
centrale `Undo`- en serialized-propertygrenzen:

- [`PrefabUtility.InstantiatePrefab`](https://github.com/Unity-Technologies/UnityCsReference/blob/9d487cab41b00c50af020b56d27a3c768d54f770/Editor/Mono/Prefabs/PrefabUtility.cs#L2202-L2217)
- [`SceneHierarchy.Init`](https://github.com/Unity-Technologies/UnityCsReference/blob/9d487cab41b00c50af020b56d27a3c768d54f770/Editor/Mono/SceneHierarchy.cs#L225-L299)
- [prefab property- en file-undo](https://github.com/Unity-Technologies/UnityCsReference/blob/9d487cab41b00c50af020b56d27a3c768d54f770/Editor/Mono/Prefabs/PrefabUtility.cs#L1391-L1446)

Defold laat collections alleen concrete instancevelden en overrides bewaren.
De gebruikte prototype/script-owner publiceert zelf welke properties bestaan
en welke beperkte valuerepresentaties de editor en runtime mogen zetten. De
runtimepropertygrens adresseert vervolgens dezelfde game object/component-
owner; hij schrijft geen willekeurige fields op een Lua-table:

- [collection- en instancebeschrijvingen](https://github.com/defold/defold/blob/6050b64028aa7ed87f4372709b52bc860ee1b874/engine/gameobject/proto/gameobject/gameobject_ddf.proto#L27-L125)
- [`go.property`-declaraties en toegestane values](https://github.com/defold/defold/blob/6050b64028aa7ed87f4372709b52bc860ee1b874/engine/gameobject/src/gameobject/gameobject_script.cpp#L2123-L2205)
- [`go.get` via de concrete object/componentpropertygrens](https://github.com/defold/defold/blob/6050b64028aa7ed87f4372709b52bc860ee1b874/engine/gameobject/src/gameobject/gameobject_script.cpp#L692-L834)

VS Code custom text editors delen één standaard textdocument met de gewone
teksteditor en wijzigen dat document met minimale workspace-edits. Daardoor
blijven undo, redo, dirty state, save en externe wijzigingen document-owned:

- [custom text editor model](https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L108-L114)
- [minimale textedits](https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L140-L166)
- [documentwijzigingen, undo en redo naar alle views projecteren](https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L158-L169)

Roslyn houdt syntax full-fidelity: whitespace en comments zijn trivia met
eigen source spans. Refactorings vervangen de bedoelde node/token in plaats van
het hele document opnieuw te serialiseren:

- [full-fidelity syntax en trivia](https://github.com/dotnet/roslyn/blob/f5098787d20f8016bd1abe729ca8b76d9f9ac694/docs/wiki/Roslyn-Overview.md#syntax-trees)
- [gerichte `With*`/`ReplaceNode`-transformaties](https://github.com/dotnet/roslyn/blob/f5098787d20f8016bd1abe729ca8b76d9f9ac694/docs/wiki/Getting-Started-C%23-Syntax-Transformation.md#modifying-nodes-with-with-and-replacenode-methods)

Flecs stelt structurele ECS-wijzigingen tijdens systems uit en voert de
commandqueue aan een synchronization boundary uit. BMSX neemt daarvan alleen
het ownerprincipe over: de bestaande `World`-barrier, niet een scene- of
hostqueue, bepaalt wanneer Registry- en systemviews weer consistent zijn:

- [deferred world operations](https://github.com/SanderMertens/flecs/blob/9f5152c141077f5b2ca5f24ee7a667ce0b5108e8/include/flecs/addons/cpp/world.hpp)

MAME berekent de zichtbare game-area bij de render target en gebruikt dezelfde
targetgeometrie om hostpunten terug naar een rendercontainer te mappen. Godot
laat op vergelijkbare wijze de concrete `CanvasItem` zelf zijn editorrect en
selectietest leveren; de canvas-editor reconstrueert dat rect niet uit een
losstaande scene-DTO:

- [MAME visible-area- en point-mapping](https://github.com/mamedev/mame/blob/650339a66c5c575aecd05b380af5997810a1e31a/src/emu/render.cpp#L1421-L1469)
- [MAME `render_target::map_point_container`](https://github.com/mamedev/mame/blob/650339a66c5c575aecd05b380af5997810a1e31a/src/emu/render.cpp#L1758-L1777)
- [Godot `CanvasItem` editrect/selectietest](https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/scene/main/canvas_item.cpp#L54-L65)
- [Godot canvas picking via de item-owner](https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/editor/scene/canvas_item_editor_plugin.cpp#L664-L710)

BMSX kopieert deze producten niet letterlijk. De afgeleide regels zijn:

1. de visual editor is een tweede view op canonical source, geen tweede scene;
2. cartlib instantiateert en muteert echte objecten; de host schrijft geen
       tables of componentstorage;
3. scene-local `member_id` blijft de stabiele authored correspondence en wordt
       niet gelijkgesteld aan de terminale, World/Registry-owned runtime `id`;
4. authored objectreferences worden pas opgelost nadat alle objecttables,
       member-identities en nieuwe World/Registry runtime-ids bestaan, maar vóór de
       bestaande initialization/constructorfase
       die hun constructioninput consumeert;
5. alleen de prefab-owner publiceert welke instanceproperties authored en live
       wijzigbaar zijn;
6. structurele scene-edits zijn één expliciete `World`-batch aan de
       bestaande mutation barrier;
7. outlinerselectie, collapse, camerastand en pane-layout zijn retained host-
       viewstate en geen gastdata;
8. een cookstap is alleen gerechtvaardigd als source en runtime werkelijk een
       andere representatie nodig hebben.

## Begrippen en owners

| Begrip | Owner | Representatie | Niet hetzelfde als |
| --- | --- | --- | --- |
| `PrefabDefinition` | `cartlib/world/prefab.lua` | class, base initialization, defaults, component factories en concrete authoring bindings | scene, runtimeobject of editor-schema |
| `SceneBlueprint` | cart-Lua bij `scene_library.register` | authored ordered literal records onder één scene-id | runtimeobject, YAML-resource of host graph |
| `SceneDefinition` | `cartlib/world/scene_library.lua` | cold gematerialiseerde ordered velden/propertybindings, revision en member-id-index | `Space`, source-AST of generic propertybag |
| `SceneInstance` | `cartlib/world/scene_instance.lua` | één loaded definitie, ordered membercorrespondence en applied/pending revision | tweede `World` of save-state |
| `World` | `cartlib/world/world.lua` | object construction/admission/disposal en structural mutation barriers | authored scene of editortransaction |
| `Space` | `cartlib/world/space.lua` | scheduling/renderpartition voor actieve retained views | level, scene of transformhierarchie |
| `Registry` | `cartlib/registry.lua` | cart-wide terminale runtime-identiteit en keyindices | authored member-id, sourceprojectie of scene membership |
| scene sourceprojection | Studio workbench-contribution | syntaxtree-ranges en retained rows voor één `EditorTextModel.version` | live gueststate |
| runtime module-rootbinding | BLua compiler/linker tooling symbols + `RuntimeSourceState` | exact `(execution domain, module path) -> guest global slot name` voor een dynamic module root | runtime `require`, geraden gesanitiseerde global of machine-ABI |
| scene runtimebinding | `ide/runtime` scene-owner | concrete binding naar de publieke guest scene-API terwijl CPU suspended is | generic Lua-RPC of table editor |
| scene live-previewprojectie | dezelfde `ide/runtime/scene_editing`-owner | explicit previewcommand gekoppeld aan document-owned undo-record en runtime-epoch | tweede undo stack, pane-local history of algemene modelchange-hook |
| scene viewport | host presentation + Studio pane | retained game-viewrect, camera/viewstate en host overlaycommands | PCRTC circuit 2 of guest editorcart |

`SceneDefinition` en `Space` blijven bewust los. Eén scene mag objecten in
meerdere reeds geconfigureerde Spaces plaatsen; dynamische gameplayobjecten in
dezelfde Space worden daardoor geen sceneleden. BMSX heeft evenmin een algemene
parent/child-transformhierarchie. De eerste outliner toont dus echte scene-
membership en references en verzint geen transform tree.

## Representatieladder

| Fase | Scene | BT/FSM | AEM |
| --- | --- | --- | --- |
| authored waarheid | structured cart-Lua-`SceneBlueprint` | structured cart-Lua | `.aem.yaml` |
| editor model | hetzelfde resource-owned `EditorTextModel` | hetzelfde resource-owned `EditorTextModel` | hetzelfde resource-owned `EditorTextModel` |
| runtime-afleiding | `SceneInstance` + echte `WorldObject`s | compiled/rebound program/state tree | cooked immutable eventmap/filterdata |
| machinecontract | geen | geen | alleen gewone ROM-bytes/adressymbolen |

Een scene-cooker is niet principieel verboden. Hij is nu niet gerechtvaardigd:
de Lua-definitie kan rechtstreeks de cold instantiation voeden en er bestaat
nog geen gemeten sceneconsument die een compact binair format vereist. Een
toekomstige cooker blijft afgeleid van dezelfde canonical source en krijgt
pas een eigen owner wanneer laadtijd, ROM-grootte of een concrete datapath dat
aantoont. Hij mag nooit ontbrekende objectidentity, references, lifecycle,
mutation of Hot-Resume-rebind maskeren.

De scene-runtime vereist geen TypeScript-versie en C++-versie van cartlib: beide
cores voeren dezelfde gecompileerde cart-Lua-ROM uit. Alleen een wijziging aan
een werkelijk gespiegeld machine/render-owner krijgt TS/C++-pariteit; daarom is
de latere presentationregion-slice gespiegeld en blijven sourceprojectie en
browser-workbench host-TypeScript.

## Canonieke Lua-definitie

De scene blijft een gewone Lua-sourcemodule, bij voorkeur herkenbaar als
`*.scene.lua`, en registreert tijdens de expliciete cartinitialisatie dezelfde
soort structured table als BT en FSM. Het suffix selecteert hoogstens een
editor; compiler, ROM TOC en machine blijven gewone Lua/code zien. Het
`<init>`-attribuut roept een modulefunctie niet vanzelf aan: de cartentry roept
dezelfde publieke `register()` expliciet aan als de bestaande prefab-, BT- en
FSM-modules.

```lua
local scene_library<const> = require('cartlib/world/scene_library')
local main_scene<const> = {}

function main_scene.register()
    scene_library.register('game.main', {
        objects = {
            {
                member_id = 'castle',
                definition_id = 'game.castle',
                space_id = 'main',
                pos = { x = 0, y = 0, z = 0 },
            },
            {
                member_id = 'player',
                definition_id = 'game.player',
                space_id = 'main',
                pos = { x = 16, y = 32, z = 0 },
                properties = {
                    boot_mode = 'room',
                },
                references = {
                    castle = 'castle',
                },
            },
        },
    })
end

return main_scene
```

De cartentry maakt registratie onderdeel van haar bestaande Hot-Resume-
initialisatie en kiest afzonderlijk wanneer de scene daadwerkelijk wordt
geladen:

```lua
local scene_library<const> = require('cartlib/world/scene_library')
local main_scene<const> = require('scenes/main.scene')

local function init<init>()
    -- Bestaande prefab-, FSM- en BT-registraties staan in dezelfde owner.
    main_scene.register()
end

init()

function new_game()
    scene_library.load('game.main')
end
```

De rootinitialisatie registreert prefabdefinitions vóór scenes die ernaar
verwijzen. `scene_library.register` compileert de cold definition tegen die
concrete prefabdescriptors en reconcilieert daarna alleen reeds loaded
instances. `load` richt zich op de ene modulebrede cart-`World`; het maakt geen
world aan en verstopt geen worldargument in editorcode.

De recordshape heeft concrete betekenissen:

- `member_id` is de verplichte, scene-lokale authored correspondence en blijft
  stabiel over reconcile; hij wordt niet naar `WorldObject.id` gekopieerd;
- `WorldObject.id` blijft de terminale Registry-identiteit die World in authored
  constructionorder produceert. Een replacement krijgt dus een nieuwe runtime-
  identity terwijl de source dezelfde `member_id` houdt;
- `definition_id` kiest de bestaande prefabdefinition;
- `space_id` behoudt de bestaande guestidentiteit; `pos.x` en `pos.y` zijn de
  huidige cartlib integer-pixelposities en `pos.z` is het bestaande integer
  depthword. De source slaat geen hostfloats of zelfbedachte fixed-pointencoding
  op;
- `properties` bevat uitsluitend door die prefab gepubliceerde sceneproperties;
  het is geen doorgifte van willekeurige `world:spawn`-options;
- `references` noemt in deze eerste scope andere member-ids uit dezelfde scene
  en wordt naar echte `WorldObject`-tables opgelost vóór constructors,
  `onspawn` en `bind`;
- recordvolgorde is authored outliner- en deterministische instantiationorder,
  niet de swap-removevolgorde van `World._objects`.

Een scene wordt eenmaal onder haar scene-id geladen. Reusable objectconstructie
blijft de taak van prefabs; additive scenes gebruiken verschillende scene-ids
en mogen dezelfde scene-lokale member-id gebruiken. Meervoudige instanties,
nested scenes of een automatische runtime-id-prefix worden niet vooruit
ontworpen zolang een echte game dat niet nodig heeft.

## Load, unload en identiteit

`scene_library` bezit één definitionmap en één loaded-instance-map voor de
modulebrede cart-`World`:

- `register(scene_id, blueprint)` produceert één nieuwe cold
  `SceneDefinition`-revision en biedt die aan een eventueel loaded instance aan;
- `load(scene_id)` maakt precies één `SceneInstance`, plant al zijn members als
  één World-batch en retourneert die instance;
- een tweede `load` van hetzelfde scene-id is een lifecyclefout, geen verborgen
  no-op of tweede instance;
- `unload(scene_id)` plant disposal van alleen de nog live members en verwijdert
  de instance pas wanneer die batch is gecommit;
- `reload(scene_id)` is de expliciete unload/construct-operatie die ook
  tombstones opnieuw materialiseert;
- `instance(scene_id)` geeft de concrete loaded instance;
- `SceneInstance:object(member_id)`, `position(member_id)`,
  `set_position(member_id, x, y, z)`, `mutable_property(member_id, key)`,
  `set_mutable_property(member_id, key, value)` en `tombstoned(member_id)` zijn
  de concrete cart/runtimegrenzen; mutable propertyaccess gaat altijd door de
  prefabdescriptor en zij enumereren de World niet;
- `SceneInstance:revisions()` retourneert applied en pending revision als twee
  directe guestvalues, waarbij pending `nil` is wanneer geen plan wacht;
- na de spatial-queryslice leveren `pick(x, y)` en
  `visual_bounds(member_id)` respectievelijk het topmost live member-id en vier
  directe cartlib pixelbounds, niet een host DTO.

Scene membership is gewone cartlib-runtimeownership, geen Studio/debugmetadata.
`World` bewaart daarom package-intern de loaded `SceneInstance`s die aan hem
toebehoren, en een admitted authored object bewaart rechtstreeks zijn ene
package-interne instance/membercorrespondence. De terminale World-disposalgrens
meldt disposal aan die concrete instance; er komt geen algemene lifecycle-
observerregistry, eventsubscription, Registry-key of per-frame membershipscan.
Een expliciete scene-unload of `World:clear()` zet de betrokken instance eerst
in haar unloadtransition, zodat dezelfde disposalcallback de correspondence
verwijdert in plaats van gameplay-tombstones te maken. `clear_space()` en een
gewone gameplaydisposal houden de instance loaded en maken daarom wel een
tombstone. De structural-batchslice moet deze volgorde als onderdeel van de
bestaande World-barrier bewijzen; scene code wrapt `World:clear()` niet.

Additive compositie ontstaat dus door verschillende scene-ids naast elkaar te
laden. Hun gegenereerde runtimeobject-ids delen de ene Registry-namespace; hun
member-ids niet. Een scene-id of member-id is geen runtimeobject-id, Space-id of
execution domain. Cross-scene runtimequeries blijven
gewone cartcode; de eerste declaratieve referencegrens verzint geen loadorder of
ownership tussen additive scenes.

## Prefabproperties en references

De huidige `world:spawn`-options zijn open constructie-input en bevatten in de
live carts ook tables, functies en objects. Zij zijn daardoor geen
scenepropertyschema: Hot Resume kan zulke values niet generiek vergelijken en
live writes zouden setters, retained visual state, componentindices en
gameplay-invarianten omzeilen. Daarom zijn er drie soorten scenedata:

1. **structureel/common:** `member_id`, `definition_id`, `space_id`, `pos`;
2. **constructie-only properties:** expliciet door de prefab gepubliceerde
   values die alleen een nieuwe instance mag consumeren;
3. **mutable properties:** expliciet door de prefab gepubliceerde values met
   een concrete getter/setter voor een bestaande instance.

De prefabdefinition bezit voor iedere gepubliceerde property één descriptor
onder dezelfde key die de scene en constructorinput gebruiken. De descriptor is
een gewone cold Lua-record met `representation = 'number' | 'boolean' |
'string' | 'asset_id' | 'object_reference'` en `update = 'construction' |
'mutable'`. Een mutable descriptor bevat daarnaast concrete `get`- en `set`-
function values uit de prefab/class-owner; zij bevat geen functienaamlookup.
Een guest number blijft exact de BLua-numberwaarde uit source/runtime. Deze
eerste grens converteert geen hostfloat, fixed-pointwoord of ander domaingetal.
`asset_id` blijft runtime een interned guest string, maar geeft de editor de
smallere assetpickersemantiek. `object_reference` bewaart in source het member-
id en levert aan constructor of setter de opgeloste objecttable.
Descriptors met `object_reference` komen uitsluitend uit het recordveld
`references`; de overige representaties uitsluitend uit `properties`. Beide
gebruiken de descriptorkey als constructorinputkey.

Een mutable descriptor publiceert state, geen command. `get(obj)` retourneert
de actuele value in precies de descriptorrepresentatie; na `set(obj, value)`
retourneert `get(obj)` die value. De setter mag uiteraard owner-caches,
retained views of componentstate bijwerken, maar een herhaalde set van dezelfde
value heeft geen tweede gameplaybetekenis. Alleen onder dat contract mag
reconcile een setter overslaan wanneer de concrete getter de nieuwe authored
value al toont. Imperatieve acties en eventtriggers zijn geen properties en
krijgen niet via dit schema alsnog editorcontrols.

Voor iedere non-reference descriptor bevat `PrefabDefinition.defaults` onder
dezelfde key een value in die directe representatie. Een ontbrekend sceneveld
betekent daardoor “geen override”; initial construction gebruikt de gewone
prefabdefault. Verwijderen van een bestaande override betekent expliciet
terugzetten naar de **huidige** prefabdefault via de setter of, bij
construction-only, objectreplacement. `SceneDefinition` bewaart override-
presence daarom apart van de value. `nil` en een optionele objectreference zijn
niet in deze eerste propertygrens: een gepubliceerde reference is aanwezig in
`references`. Later nullable gedrag vereist een expliciete representatie van
de prefab-owner, niet de aanname dat een ontbrekend field en `nil` hetzelfde
zijn.

Bijvoorbeeld:

```lua
function player:get_scene_image()
    return self.sprite_component.imgid
end

local player_scene_properties<const> = {
    boot_mode = {
        representation = 'string',
        update = 'construction',
    },
    imgid = {
        representation = 'asset_id',
        update = 'mutable',
        get = player.get_scene_image,
        set = player.set_imgid,
    },
}

prefab.define({
    def_id = ids_player_def,
    class = player,
    components = player_components,
    defaults = player_defaults,
    scene_properties = player_scene_properties,
})
```

De records zijn het ownercontract zelf; `prefab.lua` introduceert geen
cosmetische descriptorbuilders of verborgen schema-DSL. Tables, closures en
andere rijke **propertyvalues** worden niet door een generic comparator of
serializer alsnog authorable gemaakt. Een domain-owner kan later een eigen
representatie en compare/apply-contract toevoegen.

Een required reference wordt cold tegen de records in dezelfde
`SceneDefinition` gevalideerd. Initial load en expliciete reload hebben alle
targets live en leveren de concrete objecttable. Gameplay mag zo'n target later
disposen; bestaande referencers behouden dan exact hun gewone Lua-runtimestate,
ook wanneer die state nog de inmiddels disposed objecttable bevat. Een
ongewijzigde Hot Resume herschrijft die gameplaystate niet. Moet een nieuwe of
vervangen member tijdens reconcile echter een required reference naar een
tombstoned target construeren, dan bestaat er geen geldige targettable en fault
de construction op die guest-lifecyclegrens. Zij respawnt het target niet en
verzint geen `nil`/handle/proxy. Een expliciete scene reload materialiseert beide
opnieuw. Optional/weak referencegedrag is daarmee bewust een latere,
owner-ontworpen representatie.

Bij initial construction materialiseert de prefab-owner dezelfde descriptor
naar constructorinput; bij reconcile gebruikt een mutable descriptor zijn
concrete getter/setter en veroorzaakt een gewijzigde construction-only
property vervanging van dat object. Common position en space blijven
respectievelijk `WorldObject:set_pos` en `WorldObject:set_space`; een sprite-
imagebinding gebruikt bijvoorbeeld de bestaande `set_imgid`, niet
`obj.imgid = value`. Een referencebinding ontvangt de reeds opgeloste
objecttable.

Een sourceprojection biedt alleen een details-control voor common fields of
een bewezen prefabdescriptor. Reguliere dynamische `world:spawn`-options
blijven gewone Lua buiten de declaratieve scene. Zo wordt een ontbrekende
setter niet vermomd als een vrije propertybag.

## Instantiation lifecycle

References vereisen een echte multi-object construction boundary. `World`
voert de eerder monolithische `spawn`-lifecycle nu uit met package-owned fasen;
ordinary `world:spawn` gebruikt exact dezelfde fasen en blijft de publieke
single-objectoperatie. De fasering behoudt de live `spawn`-semantiek dat
defaults en optionvalues vóór `definition.initialize` op het object staan. Een
scene mag die values dus niet pas na initialize injecteren. De nog open
scene-slice ordent deze bestaande fasen voor een retained multi-objectbatch; zij
kopieert ze niet.

Voor één scene commit is de volgorde:

1. allocateer alle objecttables, pas prefabdefaults en structurele velden behalve
       `pos` toe, stel class/metatable en scene-local member-id vast en laat World
       hun nieuwe runtime-ids in authored order produceren;
2. bouw de definitieve scene-membermap, los references op en materialiseer de
       prefab-owned constructioninput op dezelfde pre-initialize positie als
       gewone `spawn`-options;
3. voer voor alle objects de bestaande prefab/base initialization uit;
4. bind `world` en de effectieve `space_id`, bouw components en voer de
       concrete constructors met dezelfde constructioninput uit;
5. pas position toe en voer `onspawn` en activation/bind uit;
6. publiceer ieder volledig geconstrueerd object via de bestaande Registry-,
       Space- en retained-viewadmission.

Scene code voert deze stappen niet zelf uit en krijgt geen openbare half-built
object-API. `World` bezit de package-interne construction/admissionfasen;
`SceneInstance` bezit alleen de ordered batch en referencecorrespondence.
Initialization en constructors mogen een resolved peer bewaren, maar roepen
geen lifecycle op een peer aan voordat de batch admission voltooid is.

## Structurele scene-batch

`scene_library.register(scene_id, replacement)` vervangt de definition zoals de
BT/FSM-libraries dat doen. Iedere loaded `SceneInstance` van die id bouwt één
reconcileplan op basis van authored member-id:

- hetzelfde member-id, dezelfde prefab en ongewijzigde construction-only properties
  behoudt dezelfde `WorldObject` en alle niet-authored runtime-/componentstate;
- gewijzigde `pos`, `space_id`, override-presence of authorable prefabfield
  gebruikt zijn owner-
  setter uitsluitend wanneer de authored waarde werkelijk veranderde en de
  concrete getter niet al de nieuwe waarde retourneert;
- een nieuwe record wordt constructed/admitted;
- een verwijderde record gaat via `World:mark_for_disposal`;
- een andere prefab of gewijzigde construction-only property vervangt die ene
  instance; de oude runtimeidentity wordt vrijgegeven vóór de nieuwe instance
  haar eigen Registry-id publiceert;
- een gewijzigde reference gebruikt haar prefabpolicy: een mutable binding
  krijgt de final-mapobjecttable, een construction-only binding vervangt het
  object;
- de sourcevolgorde van retained records wijzigt de outlinerorder, niet
  stilzwijgend de bestaande z/visual-admissionorder.

De vergelijking gebruikt alleen de directe descriptorrepresentaties, common
velden en authored reference-ids. Er is geen recursieve tablevergelijking. Alle
gewijzigde references worden tegen de final live membermap gepland, zodat een
source-remove of replacement geen nieuwe binding naar het oude object laat
staan. Een ongewijzigde reference naar een gameplay-tombstone behoudt zoals
hierboven beschreven de bestaande runtimevalue.

Dit is één expliciete, niet-rollbackbare `World` structural batch. De huidige
barrier verwerkt admissions vóór disposals en kan daardoor replacement-
lifecycle en callbacks niet in terminal-old-before-new-volgorde uitvoeren. De
World-slice moet daarom één owner-gebonden batchvolgorde toevoegen: eerst
oude/vervangen members verwijderen, daarna
nieuwe members in authored order publiceren, vervolgens retained setters en
references toepassen en ten slotte de normale mutationqueues volledig drainen.
Pas daarna publiceert `SceneInstance` zijn nieuwe membercorrespondence en
revision. Geen systemview mag een half toegepaste scene-batch observeren.

Staat een system tick group open, dan retainen `World` en `SceneInstance` het
plan en committen het aan de bestaande mutation barrier. Is de barrier dicht,
dan doorloopt dezelfde operation intern één barrier. Lifecycle callbacks die
nieuwe worldmutaties veroorzaken worden door de bestaande dense mutation drain
afgehandeld; scene code voegt geen tweede algemene commandbuffer toe.

Meerdere instanceplannen binnen dezelfde open barrier vormen samen één World-
batch. De eerste enqueue van een instance bepaalt haar positie in de retained
batchorder; een volgende registratie vóór commit vervangt alleen haar pending
plan door de nieuwste revision. Op commit voert World de removefase voor alle
plannen uit, daarna hun additions in batch- en authored order, daarna retained
setters/references en de volledige normale mutationdrain. Pas wanneer dit geheel
klaar is publiceren alle betrokken instances hun nieuwe correspondence en
revision. Zo kan ook tussen additive scenes geen system group een tussentoestand
observeren en ontstaat er geen losse scenequeue naast World.

Een constructor/setter/lifecyclefault stopt op die echte guestgrens. De batch
maakt geen capture en rolt reeds toegepaste World-state niet terug; de machine
gaat in fault voordat een volgende system group een partial state kan uitvoeren.

`SceneInstance` bewaart applied en pending definition revision en een ordered
membermap. `World:clear()` ontlaadt zijn geregistreerde SceneInstances naast de
normale objectdisposal; `clear_space()` verwijdert alleen de betreffende live
members en laat source records als expliciete runtime-tombstones staan. Een
gameplay-disposed authored member wordt door een ongewijzigde Hot Resume niet
spontaan opnieuw gespawned. Alleen expliciet scene reload of een verwijdering
die als definitionrevision is geregistreerd, gevolgd door een latere
toevoegingsrevision, maakt hem opnieuw. Een remove+add die volledig tussen twee
registraties plaatsvindt is niet observeerbaar en heft de tombstone dus niet
op. Zolang hetzelfde authored member-id in opeenvolgende definitions aanwezig blijft,
blijft zijn tombstone ook bij property- of prefabwijzigingen staan.

Een prefabdefinition replacement reconcilieert niet impliciet de component-
topologie van reeds bestaande objects. Dat zou prefab-Hot-Resume semantiek
veranderen buiten scenes. Alleen een gewijzigde scene-record die volgens haar
descriptor replacement vereist, of een expliciete scene reload, reconstrueert
een object. Voor een property die in twee opeenvolgende scene revisions geen
override heeft, past scene reconcile evenmin een gewijzigde prefabdefault toe.
Het expliciet verwijderen van een bestaande override is wel een scene-edit en
herstelt de default uit de nieuwe prefabdefinition volgens haar updatebeleid.

## Eerste productie-adoptie

Een synthetische fixture bewijst de eigenaar niet voldoende. De eerste echte
adoptie is de statische rootcompositie die nu in
`carts/nemesis_s/cart.lua:new_game()` als vier opeenvolgende `world:spawn`-
calls staat. Een gewone `scenes/root.scene.lua` registreert in dezelfde authored
order de members `intro`, `story`, `title` en `director`, met de bestaande
definition exports, Spaces en integerposities. `init<init>` roept haar
`register()` pas na alle vier prefabdefinitions aan; `new_game()` behoudt
`world:clear()` en roept daarna `scene_library.load()`.

Die adoptie verplaatst niet de dynamische spawns uit director, stage, enemies
of effects en voegt geen sceneproperties toe die hun bestaande open optiontables
nabootsen. De nieuwe scene-runtime-ids mogen als scene-batch in hun gedocumenteerde
authored order worden geproduceerd; cartcode en tests mogen gegenereerde numeric
ids niet als authored correspondence gebruiken. De echte headless game,
presentatiecapture, gameover/new-game clear/load, save/restore en een Hot-Resume-
reconcile zijn acceptatiebewijs. De Studio-UI wordt niet tegen een test-only
scene gebouwd.

## Generieke Lua-syntaxedits

Scene-authoring mag geen eigen formatter of Lua-encoder in een workbenchfeature
introduceren. Vóór de sceneprojectie krijgt de language-owner daarom een
kleine, generieke syntax-editlaag voor bewerkingen die ook BT/FSM-refactorings
nodig hebben:

- een literal expression op zijn exacte range vervangen;
- een named table field of array entry invoegen en verwijderen;
- table entries verplaatsen zonder hun interne source, comments of whitespace
  opnieuw te formatteren;
- omringende indentation, separators en trivia uit de bestaande source bepalen;
- uitsluitend `EditorTextEdit`-records teruggeven; het resource-owned
  `EditorTextModel` blijft apply/undo/dirty/save-owner.

De generieke Lua-parser en binder krijgen geen scene-, prefab- of cartlibtypen.
Een scenecontribution herkent bovenop hun syntax/symbolfacts alleen statisch
bewijsbare `scene_library.register`-calls en literal recordtables. Veldwaarden
mogen literals of door de bestaande semantics bewezen immutable bindings zijn;
de contribution voert geen Lua uit. Een prefabproperty wordt alleen editable
wanneer de sourceprojectie ook haar concrete descriptor statisch bewijst. Een
latere loaded runtime mag correspondence en actuele values bevestigen, maar
promoveert een onbewijsbare sourceconstructie niet alsnog tot editable syntax.
Dynamische Lua blijft geldige canonical source en wordt in de code-editor
geopend; de visual view normaliseert haar niet en verzint geen editrange.

## Canonical edit, live preview en Hot Resume

De sourceworking copy is altijd de authored waarheid:

1. een scenecommand adresseert een bewezen syntaxrange in het actuele
   `EditorTextModel`;
2. de command levert één minimale `pushEditOperations`-batch en daarmee één
   document-undo-element;
3. de retained sourceprojection wordt alleen op model-versionchange herbouwd;
4. Save bewaart dezelfde Lua-source; Hot Resume compileert die source en de
   gewone `<init>`-registratie reconcileert de loaded `SceneInstance`;
5. een suspended live preview gebruikt daarnaast alleen een concrete publieke
   scene-/objectoperatie en wordt nooit canonical data.

Een continuous transformdrag is een expliciete editorinteraction transaction.
De drag bewaart zowel de authored sourcewaarde als de concrete live getterwaarde,
previewt `set_pos(live_start + delta)` terwijl de CPU suspended is en schrijft
op pointer-up de uiteindelijke guestwoorden als één source-edit. Cancel zet
uitsluitend deze interactionpreview terug naar de live startwaarde. Als
gameplay de instance eerder heeft verplaatst, is die bewuste drag dus de
expliciete handeling die de zichtbare runtimepositie in source bake't; inspectie
alleen doet dat nooit. Details tonen authored en live waarden afzonderlijk
zolang zij verschillen.

Iedere modelchange, inclusief undo, redo en handmatige code-edit, herbouwt de
sourceprojection maar voert uit zichzelf geen guestcode uit. Alleen een
concrete scenecommand koppelt haar eigen ondersteunde source-edit aan dezelfde
live setter. Die provenance mag niet achteraf uit een toevallig gelijkende
source-diff worden geraden.

Daarom krijgt het generieke textmodel vóór live scene-editing één smalle
history-projectiegrens. `pushEditOperations` retourneert de bestaande stabiele
`EditorUndoRecord`-identiteit en undo/redo-change events noemen diezelfde record
plus direction. Het model bewaart geen callback, runtimevalue of scene-type en
blijft de enige stackowner. De scene live-previewcoördinator koppelt uitsluitend
een door hemzelf succesvol gepreviewde command aan die record in een `WeakMap`.
Bij undo/redo van precies die record past hij de eerder vastgelegde directe
before/after guestvalues via dezelfde concrete SceneInstance-operatie toe.

De coordinator leeft bij de runtime-scene-binding en het resource-model, niet
bij één geopende pane, zodat dezelfde record in code- en scene-view dezelfde
expliciete previewprojectie houdt. Een code-edit, externe wijziging, revert of
niet-gepreviewde scene-edit heeft
geen recordassociation en voert dus geen guestcode uit. Hot Resume, mediawissel,
restore of verlies van de concrete runtimecorrespondence beëindigt de betrokken
preview-epoch en haar associations; de volgende documentactie wordt niet als
fallback geïnterpreteerd. De UI toont source/runtime dan unapplied totdat Hot
Resume. Dit is geen tweede undo stack: de coordinator kan geen history kiezen,
poppen of herschrijven en werkt niet per frame.

Directe preview is beperkt tot position en mutable scalar prefabfields met de
concrete getter/settergrens. De gettervergelijking hierboven voorkomt dat een
latere Hot Resume dezelfde reeds gepreviewde setter nogmaals uitvoert.
Add/remove, `member_id`, `definition_id`, `space_id`, construction-only
properties en
references lopen uitsluitend via de normale compile/Hot-Resume-registratie; de
host bouwt daarvoor geen Lua-blueprinttable en simuleert geen halve scene-batch.
De sourceprojectie kan zo'n edit onmiddellijk tonen, terwijl de runtime-
correspondence tot de expliciete Hot Resume als unapplied gemarkeerd blijft.

Machine save-state en workspace state blijven andere owners. `SceneDefinition`,
`SceneInstance`, memberobjects, tombstones en een eventueel pending World-plan
zijn gewone guest Lua-heapstate en volgen zonder scene-DTO de bestaande exacte
machine save/restore. Een restore reconstrueert of herregistreert niets. De
sourceworking copy, selectie, drawers en viewportzoom blijven workspace/editor-
state. Als source en een restored machine verschillende revisions bevatten,
toont de runtimebinding die correspondence expliciet totdat Hot Resume dezelfde
source opnieuw registreert; zij herschrijft geen van beide kanten automatisch.

De workbench blokkeert runtime-execution al wanneer hij actief is. Scene edit
gebruikt dus geen gameplay-clock, mailbox, IRQ, cartridgecommand of Lua pause-
protocol. Een debuggerstop midden in een open World-barrier mag inspecteren en
non-structurele owner-setters aanroepen; structurele reconcile blijft pending
tot de echte barrier. De host forceert die commit niet.

## Guest/runtimebinding

`ide/runtime/scene_editing` wordt de enige Studio-side binding naar de publieke
cartlib scene-API. Hij gebruikt `SuspendedGuestSession` uitsluitend wanneer de
CPU niet uitvoert en bindt de door tooling symbols geïdentificeerde dynamic
module-root van `cartlib/world/scene_library`, haar vaste publieke exports, een
concrete `SceneInstance` en zijn publieke operaties. Er komt geen call-by-string
over een willekeurige module of method.

`SceneInstance:object(member_id)` blijft een nuttige directe cartlib-API voor
guestcode, maar wordt geen workbenchmodel en behoort niet tot de host scene-
commandset. De runtimebinding vraagt availability, position, properties,
revisions en spatial results aan de instance-owner; zij geeft de ruwe objecttable
niet aan een contribution door en gebruikt haar niet om alsnog members of
classmethods te ontdekken.

Die modulebinding bestaat live nog niet als toolingcontract. BLua `require` is
compile-time authoring syntax; een ordinary dynamic module bewaart zijn echte
roottable wel in een compiler-owned global slot, maar de gesanitiseerde slotnaam
is geen IDE-API. Vóór scene-runtimebinding publiceert de linker daarom de reeds
door de compiler geproduceerde dynamic module-rootrecords in de private
`Blua32SymbolsImage`: exact execution domain, module path en global slot name.
`RuntimeSourceState` indexeert die records samen met de geïnstalleerde symbols.
Const/static modules hebben geen runtime root en produceren geen record.

Een generieke runtime-toolingoperatie resolveert met dat record de echte guest
rootvalue uit de CPU global registerfile. Zij berekent geen slotnaam opnieuw,
zoekt niet in de heap en probeert niet een andere domain/module als fallback.
Hot Resume vervangt source image en symbols als één bestaande installatiestap,
waardoor dezelfde index naar de nieuwe rootslotbinding wijst. Dit is debug-
symbolresolution zoals stackframes en locals, geen runtime module loader en geen
nieuwe machine-, ROM-header- of cartlib-ABI.

`SuspendedGuestSession` bezit de lage guestrepresentatie: stringarguments
worden via de CPU-`StringPool` echte tracked `StringValue`s; numbers en
booleans blijven hun directe guestvalues. Calls gebruiken retained
`Value`-argumentscratch. De
scene-runtimebinding bezit alleen de exacte operatie en argumentvolgorde, zoals
scene-id, member-id en `SceneInstance:set_position`-waarden. Propertypreview
roept uitsluitend `SceneInstance:mutable_property`/
`set_mutable_property` aan en bereikt zo de door de prefab gepubliceerde
getter/setter; construction-only values worden niet als live property
voorgesteld. De host leest of roept de classmethod niet zelf. De binding bouwt
geen gasttable en schrijft geen tablemember. Dit is een concrete
cartlibbinding boven de bestaande low-level callgrens, geen algemene
host-Lua-RPC.

De outliner zelf komt uit source. Runtimebinding voegt alleen actuele
availability, position en latere concrete runtime-decoraties toe voor dezelfde
authored member-ids. Er is geen `world._objects`-scan, heap-DTO, generic
`runtime.call`, arbitrary member write, inspector-RPC of per-frame snapshot.
Een niet-loaded of gameplay-disposed member is een expliciete correspondence-
state; de host verzint geen object.

## Host scene viewport

De oude circuit-2/Studio-cartviewport was de verkeerde owner. De scene viewport
is een host editorpane boven de echte machinepresentatie:

- PCRTC en GX blijven uitsluitend eigenaar van gameoutput;
- de host presentation pipeline bewaart de laatst voltooide gameoutput als
    input texture en compositet een retained integer content-source-rectangle in
    een retained editor game-destination-rectangle;
- inverse point mapping gebruikt exact diezelfde source/destinationrectangles en
    dezelfde edge/roundingregel;
- `OverlayRenderer` tekent workbench chrome en scene-gizmos in hostruimte en
  is daarmee renderer, nooit scene-owner;
- game-view en gizmo submissions worden tegen het pane geclipt; een zwarte
  rechthoek die een ontbrekende subviewport verstopt is geen implementatie;
- software/headless, WebGL2 en WebGPU volgen hetzelfde destination-, clip- en
  nearest-pixel contract voordat de scene-pane wordt gebouwd.

Deze eerste game-view toont de werkelijk voltooide gamepresentatie. De scene-
paneviewstate kiest voor host-side zoom/pan een integer source-rectangle binnen
die completed content; `VideoPresenter` bewaart de toegepaste source/destination-
geometrie voor present en inverse mapping. Dit claimt geen tweede vrije scene-
camera. Een latere editorcamera vereist een expliciet cartlib/GX-
projectiecontract en mag niet
worden nagebootst door alleen het uiteindelijke framebufferbeeld te verschuiven.

Daarmee toont deze viewport ook uitsluitend de huidige actieve `Space`, precies
zoals de game die presenteert. De source-outliner blijft alle sceneleden tonen
en kan hun authored velden bewerken, maar bounds/picking/gizmos bestaan alleen
voor een werkelijk draw-submittable member in de actieve presentatie. Selectie
wisselt nooit impliciet `World.active_space_id`: dat is cart-runtimestate, geen
paneviewstate. Een latere expliciete preview-space- of vrije-camerafunctie moet
eerst een echte World/GX-owneroperatie ontwerpen en als zichtbare gebruikersactie
landen; de eerste scene-editor simuleert haar niet in hostcode.

De huidige `VideoPresenter` zet PCRTC-contentextent, offscreen target extent en
hostcanvas samen in `setRenderTargetSize()`. De present/CRT/overlaypassen
gebruiken bovendien deels impliciete backbuffer-side effects. Een scene-pane
mag daar geen lokale crop of zwarte rechthoek overheen leggen. Eerst wordt het
generieke presentatiecontract in de gedeelde TS/C++-owners gescheiden:

| Waarde | Owner | Representatie |
| --- | --- | --- |
| machine content extent | PCRTC `GxGpuDeviceOutput` | native integer width/height |
| history/CRT source extent | `VideoPresenter` | content-sized retained textures |
| game content source | scene-pane viewstate, toegepast door `VideoPresenter` | retained integer rectangle binnen completed content; fullscreen gebruikt de volledige content |
| host surface extent | concrete `VideoOutput`/backend | native integer width/height |
| game destination | `VideoPresenter` | retained integer rectangle in host surface |
| pointer inverse | `VideoPresenter` | dezelfde content/destination rectangles |
| UI/gizmo clip | host overlay pass | dezelfde destination rectangle |

Rendergraphpassen declareren de contenttexture en de geordende writers van de
hostbackbuffer expliciet: scanout/history/quantize/CRT produceren een content-
sized texture, de presentwriter samplet de gekozen source rect nearest in de
destination rect en daarna schrijven workbench en menu. `alwaysExecute`,
verborgen default-framebuffer
writes of registrationorder zijn geen dependencycontract. Fullscreen game
blijft dezelfde representatie met een destination rect over het volledige
surface.

Op de minimale 384x288 Studio-resolutie is de game-view het primaire vlak.
Outliner en details zijn retained compacte workbench views die wisselend of als
drawer/panel worden geopend; er komt geen permanente Unity-achtige
driekolomsindeling. Alle tekst gebruikt de bestaande IDE tiny font. Commands
komen uit de centrale command/menu/action-barowners en worden niet als
hardcoded sneltoetszinnen of featureknoppen getekend.

Dit volgt ook de beperkte-resolutiepraktijk van TIC-80: diens 240x136 mapeditor
reserveert een compacte toolbar en laat de rest aan het canvas, in plaats van
een desktop-IDE-layout te verkleinen
([`map.c`](https://github.com/nesbox/TIC-80/blob/4aba09c98f1e5028b82765be1647677b08d35942/src/studio/editors/map.c#L25-L29)).

Een gizmo heeft bovendien een echte spatial owner nodig. `WorldObject.pos` is
bruikbaar als origin, maar spritebounds, draw offsets, custom visuals en een
latere camera mogen niet in hostcode worden gereconstrueerd. De generieke
`visual_component`-grens krijgt daarom een optionele concrete bounds-query die
dezelfde retained componentstate als `draw` consumeert. Sprite en surface
implementeren haar bij hun eigen drawmath; custom visuals zijn alleen pickable
wanneer hun producer een bounds-query publiceert.

`World` hergebruikt zijn retained, op depth en visual sequence gesorteerde
render-view. Een expliciete pick/query bouwt die view zo nodig één keer bij en
loopt haar achterstevoren zonder tijdelijke lijst; `SceneInstance` filtert
membership via zijn retained member-id/objectindex. Picking test alleen dezelfde
active, object-visible en component-visible visuals die de drawloop zou
submitten en retourneert de parent van de achterste/topmost match. De
memberbounds zijn de union van zijn huidige pickable visuals; een member zonder
zulke visual heeft geen verzonnen object- of colliderrect. Er is geen
boundsberekening of hostsnapshot per frame. Een toekomstige camera/projector
moet zowel draw als spatial query bij dezelfde cartlib-owner wijzigen. Tot deze
grens bestaat, ondersteunt de viewport outlinerselectie en origin/transform,
maar claimt geen pixel-perfect object picking.

## Performancecontract

- scene register/load/reconcile en source parsing zijn cold/change-driven;
- `World:update`, Registry lookup, system lanes en renderdraws krijgen geen
  Studio-branch, source-idlookup of per-frame scene-scan;
- `SceneInstance` houdt ordered records, objects en één member-id-index retained;
- een definition replacement bouwt maximaal één reconcileplan en queue't een
  instance maximaal eenmaal per open structural scope;
- outlinerrows, detailsstrings, hit-bounds, game-viewrect en gizmo submissions
  worden retained en alleen bij source-, runtime-, selection- of layoutrevision
  bijgewerkt;
- transformdrag hergebruikt één command-/argumentbuffer; geen guest table of
  host array per pointermove;
- cooking wordt met echte laadtijd/ROM-grootte bewezen en niet aangenomen.

## Verplichte bouwvolgorde

1. **`STUDIO-SCENE-AUTHORING-DESIGN-01`** — dit owner- en
   representatiecontract; geen runtimecode.
2. **`CARTLIB-WORLD-CONSTRUCTION-PHASES-01`** — split de bestaande
       single-objectconstruction package-intern zonder de publieke pre-initialize
       options- of verdere spawnsemantiek te veranderen.
3. **`CARTLIB-WORLD-STRUCTURAL-BATCH-01`** — één barrier-owned batch met
       terminale old-memberremoval vóór replacementadmission en publicatie na
       complete reconcile.
4. **`CARTLIB-SCENE-DEFINITION-01`** — `SceneDefinition`, `SceneInstance`,
   ordered load/unload, membership, revisions en tombstones; nog geen IDE.
5. **`CARTLIB-SCENE-PROPERTIES-01`** — concrete prefabdescriptors,
   construction-only/mutable beleid en reference resolution; geen algemene
   reflection/propertybag.
6. **`NEMESIS-ROOT-SCENE-01`** — migreer alleen de vier statische rootspawns
       naar een echte scene en bewijs new-game/clear/save/Hot-Resume in de echte
       cart; geen Studio-UI.
7. **`IDE-LUA-SYNTAX-EDIT-01`** — generieke, trivia-behoudende table/literal-
       edits die alleen `EditorTextEdit`s produceren.
8. **`IDE-SCENE-SOURCE-PROJECTION-01`** — scene/prefabrecognizer en retained
       sourceprojection op hetzelfde Lua-textmodel; geen live guest.
9. **`HOST-PRESENTATION-REGION-01`** — content/source/surface/destinationrect en
       expliciet geordende backbufferwriters in de gespiegeld gedeelde renderers.
10. **`CARTLIB-VISUAL-SPATIAL-QUERY-01`** — owner-gebonden bounds en picking
       vanuit de bestaande retained visual draw order.
11. **`BLUA32-TOOLING-MODULE-ROOT-01`** — producer-owned dynamic module-root-
        records in private tooling symbols en een domain-exact runtime-sourceindex;
        geen hostberekende globalslotnaam.
12. **`IDE-TEXT-HISTORY-PROJECTION-01`** — dezelfde undo-recordidentiteit naar
        change-driven secondary views projecteren zonder callback of scene-type in
        het textmodel en zonder tweede stack.
13. **`IDE-SCENE-RUNTIME-BINDING-01`** — concrete suspended guestbinding en
        source/runtime correspondence; geen generic RPC.
14. **`STUDIO-SCENE-EDITOR-01`** — tiny-font scene-pane, outliner/details,
        transforminteraction, hostgizmos en centrale commands.

Iedere slice landt afzonderlijk met eigen architectuur- en runtimebewijs. Een
latere slice mag een ontbrekende eerdere owner niet lokaal nabootsen.

## No-go's

- `.scene.yaml`, JSON, een host graphdatabase of een cooked scene als tijdelijke
  vervanging voor cartlib scene-lifecycle;
- scene-, Studio- of editorassettypen in machine, ROM header, TOC, socket of
  C++ core zonder een afzonderlijk bewezen runtimeconsumer;
- `Space` hernoemen of behandelen als scene;
- raw `world._objects`, componenttable- of heapscan als outliner;
- willekeurige Lua-tablefields schrijven in plaats van owner-setters;
- open `world:spawn`-options als scenepropertyschema behandelen;
- een scene-lokale Lua-formatter, encoder of table-edithelper;
- runtimepreview uit een willekeurige textdiff afleiden, callbacks/scenetypes in
  `EditorUndoRecord` bewaren of een scene-eigen undo stack bouwen;
- generic `runtime.call`, call-by-string, inspector-RPC of DTO-snapshot;
- een module-globalnaam in IDE-code sanitizen/raden of een guest global als
  handgeschreven scene-/Studio-entrypoint eisen;
- full scene reload voor iedere transform/propertyedit;
- per-Hot-Resume alle authored values opnieuw toepassen en daardoor runtime-
  state resetten;
- sceneleden die gameplay verwijdert stilzwijgend respawnen;
- scene mutation in `cartlib/studio/*` of een Studio-module in cartlib;
- PCRTC circuit 2, mailbox, expansion cart, guest gizmos of tweede Runtime als
  editorviewport;
- `alwaysExecute`, implicit default-framebuffer writes of een zwarte crop als
  presentationregion;
- `OverlayRenderer` verbieden voor host gizmos: verboden is modelownership,
  niet tekenen;
- een fixed driepanelenlayout of een ander font dan de IDE tiny font op
  384x288;
- viewport picking bouwen door cart-specifieke drawmath in de host te kopiëren.
