# Studio scene-authoringarchitectuur

Status: **`STUDIO-SCENE-RUNTIME-DESIGN-02`; sceneconcept geaccepteerd,
runtime-representatie nog niet gekozen**

Scenes zijn een legitiem engine- en Studio-concept. De fout in de eerste
implementatie was niet dat zij scenes introduceerde, maar dat zij zonder
productieworkload een desktop-runtime naar Lua vertaalde. Daardoor betaalde
iedere `World` voor een `SceneInstance`, structurele commandbuffer, gekopieerde
definitionrecords, maps en tombstones, ook wanneer de cart geen scene gebruikte.
Die implementatie is verwijderd; het scenevraagstuk blijft open.

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
   BT en een cart zonder scenes mag niet voor scenes betalen;
3. authored input wordt alleen verlaagd wanneer dat aantoonbaar werk uit een
   herhaald pad haalt;
4. runtime-instances bewaren alleen hun noodzakelijke veranderlijke state;
5. Hot Resume vervangt de producer-owned definitie en rebindt alleen werkelijk
   bestaande consumenten;
6. de owner consumeert echte Lua-/guestwaarden rechtstreeks. Er is geen tweede
   tabel met labels als `number`, `string`, `asset_id` of `object_reference` en
   geen DTO-validator die Lua-types nogmaals modelleert.

Voor scenes is load/unload in beginsel een koud pad. Een BT-achtige compiler is
daarom geen standaardantwoord. Eerst moet blijken of een concrete scene vaak
genoeg wordt geladen of groot genoeg is om verlaging te rechtvaardigen. Anders
is ActionEffect-achtige directe admission, of zelfs uitsluitend bestaande
Lua-code, de kleinere professionele keuze.

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
compositie is visueel te editen, maar drie directe spawns rechtvaardigen geen
scene-runtime. Deze cart is de negatieve controle: een scenevoorziening is pas
goed wanneer `2024` haar niet hoeft te importeren en exact dezelfde ROM- en
runtimekosten houdt.

### `nemesis_s`

De root bestaat uit vier statische scherm-/directorobjecten. Ook hier is een
algemene runtime waarschijnlijk duurder dan de huidige directe Lua. De stage is
wel een echte authored ruimtelijke compositie: `nemesis_s_stage.yaml` bevat een
32-rijige tilemap, restartpunten, muziekgrenzen en actor-glyphs; `stage.lua`
decodeert die eenmaal naar tiles en een ordered actor-spawnlijst. Studio kan
daar direct waarde leveren met visuele stagecompositie en positionele edits,
zonder de runtime naar een generieke scene te dwingen.

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

## Te meten representaties

`STUDIO-SCENE-WORKLOAD-01` vergelijkt de volgende varianten buiten de
productiebranch, met de bestaande directe cartcode als nulmeting:

| Variant | Analogie | Wat zij moet bewijzen |
| --- | --- | --- |
| directe Lua assembly | huidige carts | kleinste ROM/load voor kleine graphs; references en berekende waarden blijven native Lua |
| opt-in directe scene-definition | ActionEffect | één authored definitie zonder gekopieerde records; alleen de importer betaalt; reload/rebind alleen als een echte instance dat nodig heeft |
| verlaagd sceneprogramma | BT/FSM | extra admissionwerk is alleen toegestaan wanneer het herhaalde load/reconcilewerk aantoonbaar verlaagt |
| immutable placementdata in ROM | Defold collection / BMSX `rodata` | grote collections besparen ROM/heap en laden binnen budget zonder een algemeen Lua-objectmodel |

Een eerste synthetische O3-proef met dezelfde vier en 128 triviale spawns gaf:

| workload | directe Lua ROM | `rodata` ROM | extra `rodata` loadcycles | extra initheap |
| --- | ---: | ---: | ---: | ---: |
| 4 instances | 81.540 bytes | 81.792 bytes | +156 | 1 table, 2 closures |
| 128 instances | 94.226 bytes | 84.274 bytes | +3.600 | 1 table, 2 closures |

Dat is nog geen productbesluit. Het laat juist zien dat één representatie niet
voor beide workloads wint: direct Lua is beter voor vier instances; immutable
data bespaart bijna 10 KiB bij 128 instances voor ongeveer 0,53% van één
50-Hz-CPU-frame aan eenmalig loadwerk. De volgende proef gebruikt de echte
Nemesis-root, Pietious-root, één kleine Pietious-room en de grootste room.

## Performance- en ownershipgate

- Een release-O3-cart zonder scene-import is bytegelijk en heeft exact nul
  scene-init, tables, closures, branches of framewerk.
- `World:spawn`, update, render, Registry en de bestaande mutation barrier
  veranderen niet om een sceneconsument mogelijk te maken.
- Scene admission draait niet als system en wordt niet iedere tick bezocht.
- Een definitie wordt niet eerst naar een tweede verzameling Lua-records en
  maps gekopieerd. Verlaging moet minder retained gueststate of minder herhaald
  werk opleveren en wordt gemeten.
- Memberidentity gebruikt een producer-owned guestwaarde. Host-objectidentity,
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

1. **`STUDIO-SCENE-WORKLOAD-01`** — meet de vier echte rootassemblies en de
   kleine/grote placementworkloads; leg per cart vast welke authored handeling
   de sceneview verbetert.
2. **`IDE-SCENE-SOURCE-ADAPTER-01`** — kies op basis daarvan één bestaande
   canonical source en bouw een source-preserving visual projectie plus één
   echte edit. Geen runtimewijziging als de bestaande consumer de edit al kan
   laden.
3. Alleen wanneer een huidige cart daarna load/unload/rebind mist, krijgt een
   optionele cartlib-sceneowner een eigen gemeten slice. Zijn API wordt afgeleid
   van de winnende workload en van FSM/BT/ActionEffect, niet vooraf verzonnen.
4. Runtimecorrespondence, picking en directe preview volgen pas nadat die
   concrete scene-instanceowner bestaat.

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
