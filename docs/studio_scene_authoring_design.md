# Studio scene-authoringarchitectuur

Status: **`STUDIO-SCENE-RUNTIME-DESIGN-03`; directe opt-in
scenedefinitie gekozen, retained live-reconcile nog niet ontworpen**

Scenes zijn een legitiem engine- en Studio-concept. De fout in de eerste
implementatie was niet dat zij structured scenes introduceerde of dat een cart
die scenes kiest daar helemaal niets voor mag betalen. Zij vertaalde zonder
producer een desktop-runtime naar de algemene `World`: `SceneInstance`, een
structurele commandbuffer, gekopieerde definitionrecords, maps en tombstones.
Daardoor betaalde zelfs een cart zonder scene-import. Die implementatie is
verwijderd; dit ontwerp maakt scenes net als FSM, BT en ActionEffect expliciet
opt-in.

Dit ontwerp begint daarom bij de bestaande BMSX-voorbeelden die al hetzelfde
probleem goed oplossen: FSM's, Behavior Trees en ActionEffects. Daarna toetst
het sceneconcept aan concrete composities in de vier huidige carts.

De reden voor de verwijdering was meetbaar. De eerste drie sceneslices maakten
een release-O3-`cartlib_test` die zelf geen scene gebruikte al zwaarder:

| maat | zonder scene-runtime | eerste scene-runtime | verschil |
| --- | ---: | ---: | ---: |
| ROM | 183.992 bytes | 189.504 bytes | +5.512 bytes |
| statische functies | 520 | 541 | +21 |
| statische instructies | 23.018 | 23.632 | +614 |
| statische basiscyles | 28.228 | 28.990 | +762 |
| uitgevoerde tables in dezelfde vijf seconden | 713 | 728 | +15 |
| uitgevoerde closures in dezelfde vijf seconden | 885 | 904 | +19 |

Dit was een ownershipfout, geen optimalisatietodo: ongebruikte functionaliteit
hoort niet in `World` en mag niet met guards of lazy facades worden verstopt.

## Het patroon dat cartlib al gebruikt

| Domein | Authored bron | Admission | Retained runtime | Waarom |
| --- | --- | --- | --- | --- |
| FSM | Lua-table bij `fsm_library.register` | bouwt een concrete state-definition | per component de actieve state tree; registration rebindt bestaande machines | states, guards en events worden herhaald uitgevoerd en Hot Resume moet levende machines behouden |
| BT | Lua-table bij `behaviour_tree_library.register` | verlaagt naar gespecialiseerde evaluators, operands, resetpad en execution-layout | per component alleen blackboard- en execution-slots | de 50-Hz-route mag de authored tree niet interpreteren of generieke featurebranches uitvoeren |
| ActionEffect | Lua-table bij `actioneffects.register_effect` | installeert de definitie rechtstreeks | alleen verleende effects bewaren count/cooldown/periodieke state | er is geen extra compilerlaag nodig; de producer leest zijn eigen guestwaarden rechtstreeks |

Daaruit volgt niet dat ieder structured Lua-domein dezelfde compiler of
instanceklasse nodig heeft. De gemeenschappelijke regels zijn:

1. gewone Lua blijft de canonieke bron zolang geen andere runtimeconsument een
   cooked representatie rechtvaardigt;
2. registration is expliciet en opt-in; een cart zonder BT betaalt niet voor
   BT en een cart zonder scenes betaalt niet voor scenes. Een cart die bewust
   een scene gebruikt mag wel betalen voor haar authored definition en koude
   instantiatie;
3. authored input wordt alleen verlaagd wanneer dat aantoonbaar werk uit een
   herhaald pad haalt;
4. runtime-instances bewaren alleen hun noodzakelijke veranderlijke state;
5. Hot Resume vervangt de producer-owned definitie en rebindt alleen werkelijk
   bestaande consumenten;
6. de owner consumeert echte Lua-/guestwaarden rechtstreeks. Er is geen tweede
   tabel met labels als `number`, `string`, `asset_id` of `object_reference` en
   geen DTO-validator die Lua-types nogmaals modelleert.

Voor scenes is instantiatie in beginsel een koud pad. Een BT-achtige compiler is
daarom geen standaardantwoord. De eerste sceneowner volgt ActionEffect: een
expliciete registration bewaart de concrete Lua-definitie rechtstreeks en
instantiatie consumeert haar ordered members via de bestaande `World:spawn`-
grens. Verlaging volgt alleen wanneer een grote echte placementcollection daar
later aantoonbaar baat bij heeft.

FSM en BT leveren wel twee andere essentiële regels. De scenedefinitie staat in
een cartmodule waarvan de expliciete `register`-functie uit `<init>` wordt
aangeroepen, en een toekomstige rebindroute mag alleen bestaan wanneer een
werkelijk retained sceneconsumer bestaat. Registration alleen gaat geen reeds
geinstantieerde objectgraph herschrijven. Dat is ook het `PackedScene`-model:
een resource revision bepaalt toekomstige instanties; een aparte editor- of
runtimeoperatie bezit eventuele mutatie van een levende instantie.

## Professionele referenties

Godot bewaart authored compositie in `SceneState`, maakt daaruit de echte nodes,
stelt properties in en lost node-references pas op nadat de nodes bestaan. Het
maakt dus onderscheid tussen authored scene, concrete runtimeobjecten en
editor-viewstate:

- [`SceneState::instantiate`](https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/scene/resources/packed_scene.cpp#L231-L756)
- [uitgestelde `NodePath`-resolutie](https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/scene/resources/packed_scene.cpp#L675-L717)
- [Scene Tree edit en centrale undo](https://github.com/godotengine/godot/blob/6ef60dc279b2c58a94ffc57bf98eefc9663f7907/editor/docks/scene_tree_dock.cpp#L406-L428)

Defold bewaart collections als compacte instancebeschrijvingen met prototype,
id, transform, children en concrete componentproperty-overrides. De native
runtime reserveert haar instance-array en indexpool op `max_instances` en
gebruikt intrusive add/delete-lijsten:

- [`CollectionDesc` en `InstanceDesc`](https://github.com/defold/defold/blob/6050b64028aa7ed87f4372709b52bc860ee1b874/engine/gameobject/proto/gameobject/gameobject_ddf.proto#L63-L125)
- [vooraf begrensde collectionstorage](https://github.com/defold/defold/blob/6050b64028aa7ed87f4372709b52bc860ee1b874/engine/gameobject/src/gameobject/gameobject_private.h#L212-L284)
- [collectioninstantiatie in vaste arrays](https://github.com/defold/defold/blob/6050b64028aa7ed87f4372709b52bc860ee1b874/engine/gameobject/src/gameobject/gameobject.cpp#L1449-L1607)

Dit bewijst het nut van scenes, maar niet dat Defolds C-structs of Godots
hostrijke objectmodel als Lua-tables moeten worden nagebouwd. BMSX moet hun
ownership en fasering volgen met een representatie die bij de 33.8688-MHz guest
past.

VS Code custom text editors leveren het hostcontract: de visual view deelt één
textdocument met de gewone editor en schrijft minimale edits naar dat document.
De sceneview wordt dus geen tweede authored database:

- [gedeeld textdocument](https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L108-L114)
- [documentedits en undo/redo](https://github.com/microsoft/vscode-docs/blob/9d199617aec5afda97740da77c0df87d08388553/api/extension-guides/custom-editors.md#L140-L169)

## Waar de huidige carts werkelijk voordeel hebben

### `2024`

`cart.lua` bouwt drie rootobjecten: portret, tekst en controller. De positionele
compositie is visueel te editen. Of de cart die drie objecten als scene wil
authoren is een productkeuze, niet een performanceverbod. Zij is wel de
negatieve controle voor opt-in ownership: zolang zij de scenelibrary niet
importeert, blijven ROM en runtime bytegelijk.

### `nemesis_s`

De root bestaat uit vier statische scherm-/directorobjecten. Dat is juist een
geschikte eerste structured scene: authored order, prefabidentiteit, Space en
positie worden brondata waarop een visual editor direct kan projecteren. De
stage is een grotere authored ruimtelijke compositie:
`nemesis_s_stage.yaml` bevat een 32-rijige tilemap, restartpunten,
muziekgrenzen en actor-glyphs; `stage.lua` decodeert die eenmaal naar tiles en
een ordered actor-spawnlijst. Beide bronnen leveren Studio-waarde, maar hun
runtimeconsumenten hoeven daarom niet dezelfde representatie te krijgen.

### `pietious`

Dit is de sterkste scene-workload:

- `create_world` bouwt dertien rootobjecten en legt concrete relaties zoals
  castle -> room, room -> player en director -> UI/player/castle;
- `castle_map.yaml` bevat 24 rooms en 122 authored objectplacements van
  negentien soorten;
- `castle/map.lua` leidt daar runtimevelden, voorwaarden, ids en collisiondata
  uit af;
- `room/spawner.lua` bezit conditionele admission, persistent defeat/itemstate,
  roomwissels en concrete prefabopties.

Een sceneview kan tilemap, objectplacements, selectie, transforms en
references aanzienlijk beter authoren dan raw YAML. Een generieke scene-loader
mag echter niet de progression- en roomsemantiek uit `room/spawner.lua`
overnemen. Dat is cart-owned gameplay, vergelijkbaar met een Godot-script dat
naast de scenecompositie blijft bestaan.

### `2025`

`new_game` bouwt dertien rootobjecten: zes tekst-/achtergrondobjecten, vijf
combatvisuals en twee directors. Layout wordt deels uit schermmaten berekend en
de directors ontvangen directe objectreferences en samengestelde lijsten. Een
visual sceneview is nuttig voor de zichtbare compositie; berekende layout en
gameplaywiring blijven gewone Lua. De editor moet dynamische expressies als code
behouden in plaats van ze tot literals te normaliseren.

## Drie verschillende workloads, niet een universele recordshape

De huidige carts tonen drie professionele categorieën:

1. **Root assembly** — een kleine Lua-functie maakt objecten en verbindt ze.
   Voorbeelden: alle vier `cart.lua`-bestanden. Directe gecompileerde Lua is de
   baseline en ondersteunt references zonder een string-ABI of resolver.
2. **Placement collection** — veel voornamelijk statische instances met
   transforms en authored metadata. Voorbeelden: Pietious rooms en Nemesis'
   stage. Hier kan een retained of cooked compacte representatie voordelig zijn.
3. **Dynamische spawn** — kogels, enemies, loot, effects en conditionele
   progression. Dit blijft gameplaycode en wordt niet tot scene verklaard.

Godot en Defold ondersteunen eveneens zowel authored scenes/collections als
runtime-instantiatie vanuit code. BMSX hoeft daarom niet iedere `world:spawn`
onder één scene-API te brengen om scenes serieus te nemen.

## Eerste representatiebesluit

`STUDIO-SCENE-WORKLOAD-01` heeft eerst de vier release-O3-carts gemeten en
daarna de Nemesis-root buiten de productiebranch omgezet naar het patroon van
ActionEffect. De scene-library bewaart een directe definition; de ordered
records bevatten `member_id`, `definition_id` en de bestaande `World:spawn`-
options. Instantiatie maakt de echte objecten in authored order en retourneert
een scene-local membermap. Er is geen definitionkopie, compiler,
`SceneInstance`, `World`-veld of framewerk.

| maat | directe Nemesis-root | opt-in scenedefinitie | verschil |
| --- | ---: | ---: | ---: |
| BLua-image | 633.688 bytes | 634.580 bytes | +892 bytes |
| statische functies | 1.771 | 1.776 | +5 |
| statische instructies | 80.855 | 80.948 | +93 |
| statische basiscyles | 101.103 | 101.228 | +125 |
| uitgevoerde instructies in vijf seconden | 2.546.542 | 2.546.723 | +181 |
| uitgevoerde basiscyles in vijf seconden | 2.876.131 | 2.876.350 | +219 |
| uitgevoerde tables in vijf seconden | 18.511 | 18.521 | +10 |

De +219 cycles zijn initialization/instantiatie, niet de 50-Hz-route. Een
release-O3-build van `2024`, die de nieuwe module niet importeerde, bleef
SHA-256- en byte-identiek. De overhead is dus eigendom van de cart die voor de
structured scene kiest. Zij koopt daarmee een canonieke ordered compositie,
stabiele scene-local membernamen en een directe bron voor de visual editor; dat
is productfunctionaliteit en geen vermomde optimalisatie.

De relevante representaties blijven per workload:

| Variant | Analogie | Wat zij moet bewijzen |
| --- | --- | --- |
| directe Lua assembly | huidige carts | kleinste ROM/load voor kleine graphs; references en berekende waarden blijven native Lua |
| opt-in directe scene-definition | ActionEffect | **gekozen voor rootcompositie:** één authored definitie zonder gekopieerde records; alleen de importer betaalt |
| verlaagd sceneprogramma | BT/FSM | extra admissionwerk is alleen toegestaan wanneer het herhaalde load/reconcilewerk aantoonbaar verlaagt |
| immutable placementdata in ROM | Defold collection / BMSX `rodata` | grote collections besparen ROM/heap en laden binnen budget zonder een algemeen Lua-objectmodel |

Een eerste synthetische O3-proef met dezelfde vier en 128 triviale spawns gaf:

| workload | directe Lua ROM | `rodata` ROM | extra `rodata` loadcycles | extra initheap |
| --- | ---: | ---: | ---: | ---: |
| 4 instances | 81.540 bytes | 81.792 bytes | +156 | 1 table, 2 closures |
| 128 instances | 94.226 bytes | 84.274 bytes | +3.600 | 1 table, 2 closures |

Dat tweede resultaat verandert het rootbesluit niet. Het laat zien dat grote
placementcollections mogelijk een compactere producer-owned representatie
verdienen: immutable data bespaart in de synthetische 128-case bijna 10 KiB
voor ongeveer 0,53% van één 50-Hz-CPU-frame aan eenmalig loadwerk. De echte
Pietious-rooms en Nemesis-stage krijgen daarom later een afzonderlijk
placementbesluit; zij blokkeren de directe root-scene niet.

## Performance- en ownershipgate

- Een release-O3-cart zonder scene-import is bytegelijk en heeft exact nul
  scene-init, tables, closures, branches of framewerk.
- `World:spawn`, update, render, Registry en de bestaande mutation barrier
  veranderen niet om een sceneconsument mogelijk te maken.
- Scene admission draait niet als system en wordt niet iedere tick bezocht.
- Een definitie wordt niet eerst naar een tweede verzameling Lua-records en
  maps gekopieerd. Verlaging moet minder retained gueststate of minder herhaald
  werk opleveren en wordt gemeten.
- Memberidentity gebruikt de direct authored scene-local guestwaarde.
  Host-objectidentity,
  table-shape-probes en stringlabels voor pseudo-types zijn geen representatie.
- Prefab-/cartcode blijft eigenaar van betekenisvolle constructioninput en
  mutatie. Een scenevoorziening schrijft niet willekeurig objectfields.
- De bestaande `World`-barrier blijft de enige structurele commitgrens. Er komt
  geen tweede algemene structural batch of rollbackmodel.
- Meet ROM-bytes, statische instructies/cycles, init table/closure-creations,
  eerste load, roomwissel, reload en de normale update/renderprofielen van de
  echte carts.

## Studio-ownergrens

De Studio-front-end is een host-side custom editor op het bestaande
`EditorTextModel`. Zij mag verschillende bronadapters hebben voor Lua assembly,
Pietious' roomdata en Nemesis' stagebron, maar alle edits gaan naar dezelfde
canonieke bron en dezelfde undo/save/Hot-Resume-route. Een adapter is pas
generiek wanneer twee echte bronnen dezelfde semantiek en representatie delen.

Outliner, selectie, camera, collapse-state en pane-layout zijn host-viewstate.
De runtime blijft eigenaar van echte `WorldObject`s. Live preview vereist later
een expliciete correspondence- en mutatiegrens; de host leest niet
`world._objects`, scant geen heap en maakt geen schaduwwereld.

## Bouwvolgorde

1. **`CARTLIB-SCENE-COLLECTION-01`** — land de gemeten opt-in directe
   definition/instantiationowner zonder wijziging aan `World` of `prefab`.
2. **`NEMESIS-ROOT-SCENE-01`** — maak de vier bestaande rootspawns de eerste
   productieconsument en bewijs de echte cartflow.
3. **`IDE-LUA-NUMERIC-LITERAL-EDIT-01`** — bewijs eerst één generieke minimale
   language-owned edit voor bestaande signed numeric literals. De huidige AST
   volstaat daarvoor; table insertion/removal/reorder wacht op een afzonderlijk
   full-fidelity token-/trivia-ontwerp en wordt niet met feature-local
   sourcetekstlogica nagebootst.
4. **`IDE-SCENE-SOURCE-ADAPTER-01`** — bouw op die bestaande canonical source
   een source-preserving visual projectie plus één echte transformedit. Geen
   runtimewijziging als de bestaande consumer de edit al kan laden.
5. Meet de echte grote placementbronnen afzonderlijk voordat daar `rodata` of
   een ander sceneprogramma voor wordt gekozen.
6. Retained reconcile, picking en directe live preview volgen pas wanneer de
   source-editor een concrete mutatie van een levende instance vereist.

### Literal-editowner: grens vóór de visuele adapter

De live controle van `IDE-LUA-NUMERIC-LITERAL-EDIT-01` vond drie fouten: de
vervanging van de volledige unary-range maakt van `-(42)` de ongeldige bron
`17)`, verwijdert comments tussen `-` en de literal en plakt in `return-42`
het keyword aan de nieuwe waarde. Een losse literal vervangen door `-42`
is bovendien geen contextvrije expressie-edit: in `2^2` verandert dat de
operatorbinding. De scene-editor krijgt geen eigen correctiepad hiervoor.

`IDE-LUA-TABLE-VALUE-EDIT-01` vervangt daarom de te algemene API door een
**complete table-field-value**-edit. Dat is de werkelijke authoringgrens van
de bestaande consumer. Een field bezit zijn hele value-expression; een
literal in een berekening is geen editable field-value. De language-owner
schrijft uitsluitend de numeric token en, bij een tekenwisseling, de
bestaande unary-minus-token. Haakjes, comments en whitespace daartussen
blijven bytegelijk. Meerdere tokenedits vormen één geordende textmodelbatch,
geen tweede undo-owner. Dit vereist geen lexer-, parser- of compilerwijziging.

| Representatie | Owner / consumer |
| --- | --- |
| `LuaTableField`, met complete `value`-AST | toolchain syntax; sceneprojectie bewaart het field in plaats van alleen de expressie |
| geordende `EditorTextEdit[]`, of niet-editable dynamische value | `ide/language/lua/source_edits.ts`; geen feature-local range- of tekenbewerking |
| documentmutatie, één undo-element, saved/installed revisies | bestaand `EditorTextModel` en working-copy/apply-services |

De huidige callsites zijn de literal-edittests, de Nemesis-sceneprojectietests
en `tests/conformance/runtime_replay/studio_scene_source.ts`. Er is nog geen
product-UI- of framecallsite; ongewijzigde frames, compiler en TS/C++-machine
krijgen geen extra werk of state. De bron wordt alleen op een expliciete edit
gelezen; een ongewijzigde waarde bewaart ook exponentnotatie en creëert geen
undo-element. Table insertion/removal/reorder blijft de aparte full-fidelity-
syntaxgate; deze beperkte token-edit pretendeert die niet op te lossen.

Productiereferenties:

- [Roslyn `CSharpSyntaxGenerator`](https://github.com/dotnet/roslyn/blob/d7b7579180d60dcff342863163485202f778fb34/src/Workspaces/CSharp/Portable/CodeGeneration/CSharpSyntaxGenerator.cs#L3364-L3442)
  bewaart syntax/trivia en behandelt operatorprecedentie bij het opbouwen van
  expressies. BMSX serialiseert geen expression-subtree: de huidige AST mist
  daarvoor de haakjes/trivia. De concrete table-value-grens voorkomt juist dat
  de feature ontbrekende syntaxcontext moet raden.
- [VS Code `CustomTextEditorModel`](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/workbench/contrib/customEditor/common/customTextEditorModel.ts)
  houdt custom views aan het resource-owned textmodel en zijn save-lifecycle;
  [custom-editor undo/redo](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/workbench/contrib/customEditor/browser/customEditorInput.ts#L358-L365)
  blijft documentgeschiedenis, geen aparte visuele historie.

#### Uitvoeringsbewijs (2026-09-06)

- De 10 gerichte literal-/sceneprojectietests bewijzen sign flips, geneste
  haakjes, line-/long-bracketcomments, CRLF, hexconventies, no-op en één
  documentmutatie/undo-element. De gewijzigde snippets worden ook werkelijk
  door BLua32 gecompileerd en uitgevoerd, waaronder O3; computed fields worden
  niet herschreven.
- De echte BIOS/Nemesis-Studio-lus doorloopt dezelfde nieuwe sceneproef op
  software, WebGL2 en WebGPU. Zij verandert het bestaande title-member in
  `scenes/root.lua`, behoudt handgeschreven grouping/comment en alle andere
  bytes, en gebruikt fysieke undo/redo/save plus de gewone Hot-Resume-owner.
  De bestaande title-actor behoudt identity en x. Na de daaropvolgende
  **expliciete** productreboot heeft de normaal geïnstantieerde actor x=17.
  Geen speciale guestprobe, vervangende scene-runtime of handmatige
  world-mutatie is toegevoegd.
- De finale bronweergaven zijn vastgelegd in
  `/tmp/bmsx-scene-edit-final-{software,webgl2,webgpu}.png`: geïnspecteerd,
  dezelfde gedecodeerde pixels, bestaand IDE-tiny-font en `SOURCE APPLIED`.
  Dit is bronweergavebewijs, geen visuele scene-editor- of fysieke
  GPU/SNES-mini-performanceclaim.
- Regressie: Lua 861 geslaagd, één bestaande skip; Hot Resume 92 assertions;
  IDE-typecheck, strict architecture-boundaries, core-parity, indentation en
  diff-check geslaagd. De brede test-typecheck houdt dezelfde 52 bestaande
  diagnostics; die is niet groen verklaard.

`IDE-SCENE-SOURCE-ADAPTER-01` blijft open voor de echte bedienbare visuele view.
Deze proef sluit alleen de geteste bronbewerking en definitie-/instantiegrens;
zij is geen algemene live-reconcilevoorziening of UI-acceptatiegate.

## No-go's

- scenes afwijzen omdat de eerste Lua-runtime fout was;
- alle `world:spawn`-aanroepen tot scene maken;
- een `SceneInstance`, tombstone-map, propertyschema of commandbuffer bouwen
  voordat een huidige cart die state nodig heeft;
- een typelabeltabel of DTO-validator voor gewone Lua-values;
- scene-/Studio-types in machine, ROM-header, TOC of C++ core;
- een cartlib-`studio`-module, host Lua-RPC, raw-worldscan of tweede Runtime;
- een cooker bouwen om ontbrekende ownership of lifecycle te maskeren;
- dynamische Lua-expressies door de editor uitvoeren of normaliseren;
- een vaste UE/Unity-layout kopiëren in plaats van de 384x288-workflows te
  ontwerpen met de bestaande IDE tiny font.
