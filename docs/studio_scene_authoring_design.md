# Studio scene-authoringarchitectuur

Status: **Directe opt-in scenedefinitie en eerste source-propertyview gebouwd;
retained live-reconcile nog niet ontworpen.**

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

De huidige callsites zijn `SceneEditorPane`, de literal-edittests, de
Nemesis-sceneprojectietests en
`tests/conformance/runtime_replay/studio_scene_source.ts`. Ongewijzigde frames,
compiler en TS/C++-machine krijgen geen extra werk of state. De bron wordt alleen op een expliciete edit
gelezen; een ongewijzigde waarde bewaart ook exponentnotatie en creëert geen
undo-element. Table insertion/reorder blijft de aparte full-fidelity-syntaxgate;
removal heeft inmiddels zijn eigen language-owner en onderstaande UI-slice.
Deze beperkte number/sign-tokenedit pretendeert die niet op te lossen.

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

Die eerdere proef liet `IDE-SCENE-SOURCE-ADAPTER-01` open voor de echte bedienbare
visuele view. Zij sloot alleen de geteste bronbewerking en definitie-/instantiegrens;
zij is geen algemene live-reconcilevoorziening of UI-acceptatiegate.

### `IDE-SCENE-SOURCE-ADAPTER-01`: focus- en commandowner eerst

**Voorafgaande focus-slice.** De eerste aanzet
leidde Undo/Redo af uit `EditorPane.input instanceof WorkingCopyEditorInput`
en gaf iedere pane `hasPendingEdits = false` en een succesvolle
`commitPendingEdits()`-stub. Die aanzet en de nog niet aangesloten
integercontrol zijn teruggenomen. Een ander capabilityflag of een wrapper
rond dezelfde inferentie zou deze grens niet herstellen.

De audit op `0b67396b9` legde het ontbrekende contract vast:

- `EditorPane` bezit input-/viewlifecycle, niet de keuze tussen een gefocust
  tekstveld en de onderliggende documenthistorie.
- Undo/Redo zat in de code-editorbindings; `undo_controller` herstelt ook
  cursor en selectie. Rechtstreeks `workingCopy.undo()` vanuit de basisklasse
  zou die concrete viewverantwoordelijkheid overslaan.
- Globale keyboardcommands werden vóór pane-input afgehandeld; pointerchrome
  werd vóór pane-pointerinput afgehandeld. Een propertyveld kreeg daardoor
  niet vanzelf een submit- of focusovergang vóór Save, Hot Resume of tabwissel.
- `setActiveTab` veranderde de actieve tab voordat de vorige pane werd
  losgekoppeld. Achteraf een veto of successtub op `clearInput` toevoegen is
  dus geen samenhangende focus-/inputovergang.

De professionele referentie scheidt deze verantwoordelijkheden:

- [VS Code `EditorPane`](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/workbench/browser/parts/editor/editorPane.ts#L106-L154)
  bezit de input-/viewlifecycle.
- [VS Code `MultiCommand`](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/browser/editorExtensions.ts#L203-L250)
  en [focusafhankelijke tekstcommands](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/browser/coreCommands.ts#L305-L350)
  laten concrete bijdragen de commandafhandeling bezitten. Editor-tekstfocus
  en focus in een invoerveld zijn verschillende targets. Een target dat geen
  wijziging uitvoert blijft de command afhandelen; lege historie is geen reden
  om alsnog het onderliggende document te wijzigen.
- [VS Code custom-editorbijdrage](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/workbench/contrib/customEditor/browser/customEditors.ts#L132-L170)
  registreert haar eigen Undo/Redo-route. De inputclassificatie staat bij die
  bijdrage, niet als editbeleid op iedere pane.
- [Godot `EditorSpinSlider`](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/editor/gui/editor_spin_slider.cpp#L630-L738)
  behandelt submit en focusverlies bij de concrete invoercontrol. BMSX kan
  daarbij niet stilzwijgend rekenen op DOM-focus: de IDE is canvas-rendered.

`IDE-FOCUS-COMMAND-01` herstelt nu die focusgrens in de bestaande IDE:

- `input/focus.ts` bezit één controltarget met keyboardhandler, concrete
  commandbijdragen en focus-/blurnotificaties. Er is geen parallelle
  widget-`active`-state of Undo/Redo-inferentie op de pane-basisklasse.
- `TextField` bezit veldhistorie en publiceert zowel typen als Undo/Redo via
  dezelfde content-event. Documenthistorie blijft bij het gedeelde
  `EditorTextModel`; de code-editorbijdrage gebruikt `undo_controller` voor
  viewherstel. Lege of read-only historie valt niet door naar een ander model.
- Keyboard en Edit-menu kiezen dezelfde target. Tabwissel blur't de oude
  control voordat de actieve tab en pane-input veranderen. Modale input wordt
  vóór alle achtergrondchrome afgevangen, niet met guards in ieder veld.
- Find is query-invoer, geen source. Rename accepteert zijn refactor expliciet
  en annuleert de onafgemaakte invoer bij focusverlies, zoals VS Code. Dit is
  **geen** generiek beleid voor een toekomstige propertycontrol.

De echte browserproef `runtime_replay/studio_focus.ts` bedient keyboard, Edit-
menu, Find, Rename, quick-inputvelden en tabwissel via inputevents in de normale
Studio-compositie.
Zij controleert document- versus veldhistorie, repeat tot lege historie,
Cut/Paste, read-only gegenereerde bron, blur op het nog gekoppelde oude resource
en focusretour van Resources naar de niet-codepane Scenario Lab.
`studio_workflows.ts` vervolgt Save/Hot Resume met een actief veld en
controleert ook dat de echte modale prompt achtergrondinput blokkeert. Dezelfde
proef draait met software, WebGL2 en WebGPU en de bestaande IDE tiny font.

Validatie: `npm run test:studio-workflows`, `npm run test:lua` (867 geslaagd,
één bestaande skip), `npm run test:hot-resume` (92 assertions), IDE-typecheck,
core-parity- en strikte architecture-boundary-audit. De brede
`tsc --noEmit -p tests` heeft dezelfde 52 bestaande diagnostics als de schone
`f16edc7ca`-baseline; deze slice voegt geen test-typefout toe.

**Acceptatiegate na de focus-slice:** de concrete source-propertycontrol
en haar acceptatie van complete, gedeeltelijke of ongeldige draftinvoer bij
Save, Hot Resume en focusverlies. Geen stille propertydiscard, geen save/apply
van ongemerkt oudere bytes en geen per-command `commitPendingEdits`-sprinkling.
De werkende Find-/Rename-route bewijst het focusfundament, niet een nog niet
gebouwde scenecontrol. Pas een fysiek bediende minimale scene-edit via hetzelfde
sourcemodel sluit `IDE-SCENE-SOURCE-ADAPTER-01`.

### `IDE-SCENE-SOURCE-ADAPTER-01`: bedienbare bronproperty

**Geïmplementeerd op één bestaande productiebron:** open Nemesis
`scenes/root.lua`, kies **View → Scene Editor**, selecteer een member en bewerk
x/y/z. Dit is een bronview op de directe `scene_library.register`-compositie,
geen nieuwe scene-database, runtime-inspector of 3D-viewport. De bestaande
IDE-tiny-font, retained list en gedeelde action bar vormen het 384×288-scherm.
**Source** navigeert naar de geselecteerde definitie in hetzelfde document.

#### Eerst bestudeerde productieowners

- [Godot `EditorSpinSlider`](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/editor/gui/editor_spin_slider.cpp#L630-L738)
  scheidt tijdelijke veldtekst van de property en accepteert bij submission of
  focusverlies. De control programmeert expliciet volgende/vorige focus.
- [Godot scene-save](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/editor/editor_node.cpp#L2512-L2535)
  verwerkt editorwijzigingen vóór het opslaan;
  [`EditorData::apply_changes_in_editors`](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/editor/editor_data.cpp#L427-L431)
  roept de betreffende bijdragen aan. BMSX heeft één gefocuste canvascontrol,
  niet Godots node-inspector of een permanente draft op iedere pane.
- [VS Code `SettingNumberRenderer`](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/workbench/contrib/preferences/browser/settingsTree.ts#L1991-L2050)
  houdt invoertekst, validatie van menselijke invoer en propertymutatie uit elkaar.
  De eerder onderzochte custom-text-editor- en tokeneditowners blijven leidend
  voor documentidentiteit en bronbehoud.
- [VS Code `OutlineModel` source-elementidentiteit](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/contrib/documentSymbols/browser/outlineModel.ts#L36-L54)
  behoudt namen over edits en onderscheidt herhaalde namen met bronranges. De
  sceneview gebruikt dit voor selectie, niet als runtime-objectidentiteit.
- [Godot `LineEdit` selectieforeground](https://github.com/godotengine/godot/blob/34d06658a85845111a50db9e485ec4a0701d4298/scene/gui/line_edit.cpp#L1447-L1554)
  gebruikt een aparte tekstkleur voor de geselecteerde span. De integercontrol
  gebruikt daarvoor de bestaande IDE-themekleur, zonder per-frame substringkopie;
  een fout blijft ook met geselecteerde tekst zichtbaar aan de veldrand.

Niet overgenomen: Godots expressie-evaluator, lege tekst als nul, stille
ongeldige-invoerdiscard of desktop-engine-sceneopslag in cartlib.

#### Concrete lifecycle

| Gebeurtenis | Effect |
| --- | --- |
| Typen / veld-Undo/Redo | Alleen het concrete `TextField` verandert; nog geen Lua-edit. |
| Enter of geldige focusovergang | Eén integeracceptatie geeft één bronbatch via het bestaande language-owned tokeneditpad. Veldhistorie wordt afgerond; documenthistorie blijft behouden. |
| Save / Hot Resume / Reboot | Eén command-admissionpunt accepteert het echte `InputEdit` vóór dirty-modelselectie, prompt of asynchrone sourcecapture. Save is ook beschikbaar voor een pending veld op een schoon document. |
| Ongeldige Enter / sourcecommand | Veld blijft gefocust, de tekst blijft staan en de IDE toont een fout; geen broncapture of runtimewijziging. |
| Escape | Expliciete annulering, geen documentedit. |
| Ongeldige focusovergang | Draft wordt afgewezen en gereset met de zichtbare melding “Invalid integer edit cancelled; source unchanged.” Er blijft geen verborgen draft aan een andere member/resource hangen. |
| Tab / Shift+Tab | Volgt de door de view geprogrammeerde editable controls. Code-Tab blijft bronbewerking. |
| Member-/resourcewissel, tab sluiten of IDE verbergen | De normale blurroute voltooit de oude control terwijl haar input nog gekoppeld is, niet achteraf op de nieuwe resource. |

Het pane bezit alleen zijn concrete documentcommands. Geen `instanceof`
selectie of succesvolle draftstub op de generieke `EditorPane`; Find en Rename
krijgen geen impliciete propertyacceptatie. Pointerhit-testing kiest het
werkelijke kindveld vóór een focusovergang, zodat klikken ín dat veld geen
kunstmatige parent-blur veroorzaakt.

`SceneEditorController` herbouwt de projectie uitsluitend bij een nieuwe
`EditorTextModel.version`. De view bewaart labels, selectie, geometry en
focusvolgorde. De renderer parse't geen Lua en bouwt geen rij-/propertyrecords
per frame. De invoer accepteert decimale signed-32-bit integers; de bronreader
biedt alleen complete literal/unary-minusvelden daarvoor aan. Een expressie
zoals `origin + 1` blijft zichtbaar als Lua-source. Explicit-key/dynamische
compositie blijft expliciet partial. Er komt geen float-/Q16-conversie in de
feature, geen guest-validatie en geen nieuwe code op het worldtickpad.

De property verandert de **scenedefinitie voor nieuwe instanties**. Save
installeert geen Lua; Hot Resume installeert de bron en voert de bestaande
`<init>`-route uit, maar verplaatst of vervangt de levende actor niet. De view
zegt dit zichtbaar. Live-instance-edits blijven een afzonderlijk nog te
ontwerpen cartlib-/correspondencecontract.

#### Bewijs (2026-09-07)

`tests/conformance/runtime_replay/studio_scene_source.ts` gebruikt nu echte
View-menu-, member-, property-, Source- en tabhit-targets, keyboardtyping en de
normale Save/Hot-Resume-prompt. Geen rechtstreekse modelcall voert de geteste
visuele propertymutatie uit. Alleen de fixture voegt handgeschreven comment/
grouping en unsupported sourcevormen toe. De proef controleert onder meer:

- lokale veldhistorie zonder document-fallthrough, één undo voor sign+getal;
- focusretour, Tab/Shift+Tab, code-Tab en blur op de oude resource bij panehergebruik;
- ongeldige Enter/Save/Hot Resume en zichtbare afwijzing bij focusverlies;
- shared-model Source-navigatie, undo-readback, readonly, herhaalde namen en partial/dynamische bron;
- Save vóór broncapture en Save & Resume met een nog onafgemaakt numeriek veld;
- exact behouden comments/grouping, actoridentity/x behouden bij Hot Resume,
  en de normaal geïnstantieerde actor met x=17 na expliciete productreboot;
- gepauzeerde machine ongewijzigd tijdens edits en IDE hide/reopen.

Dezelfde productroute draait op software, WebGL2 en WebGPU. De runner controleert
ook de werkelijk geschreven Lua-bestanden via de echte workspace-file-API.
De screenshots `/tmp/bmsx-scene-ui-final-{software,webgl2,webgpu}.png` zijn
UI-bewijs, geen fysieke-GPU- of SNES-mini-performancebewijs. Deze host-only
slice wijzigt machine, C++, cartlib en carts niet.

Regressie: 872 Lua-tests geslaagd, één bestaande skip; Hot Resume 92 assertions;
IDE-typecheck, strikte architecture-boundaries, core-parity, indentation en
`git diff --check`. De brede tests-typecheck houdt dezelfde 52 bestaande
diagnostics als de schone `6d6e454ef`-baseline.

## Direct sourcemember verwijderen (2026-09-08)

`IDE-SCENE-MEMBER-REMOVE-01` sluit aan op de nu bewezen capture-layoutowner;
het is uitsluitend IDE-werk. Geen wijzigingen aan machine, C++, cartlib of de
Lua-definitie van een cart. Het contract vóór de UI-diff:

- De sourceprojectie bewaart het echte `LuaTableField`, niet een afgeleid
  verwijderbereik. Eén `ParsedLuaChunk` uit de bestaande analysis-cache voedt
  de semantic projectie, syntaxadmission en language-owned separatorverwijdering.
- De normale `sceneEditor.title`-menubijdrage levert Remove. De bestaande
  sourcecommand-admission accepteert het gefocuste integerdraft vóór ranges
  worden gelezen. Ongeldige menselijke tekst blijft zichtbaar en gefocust;
  verwijderen begint niet. Readonly, recovered syntax, geen selectie en een
  geselecteerde dynamische compositie bieden geen structurele mutatie aan.
- Na acceptatie herleest de controller de actuele sourcegeneratie. Eén
  `EditorTextModel.pushEditOperations` verwijdert het complete veld plus zijn
  volgende separator; exterior comments/whitespace blijven exact staan. Een
  geaccepteerde property is een eigen voorafgaande document-Undo-eenheid.
- Focus gaat vóór verwijderen naar het concrete pane dat documenthistorie
  bezit. De verwijderde selectie wordt expliciet gewist; een gelijknamige
  overlevende rij wordt niet ongevraagd de nieuwe edit-target. Alleen de eerste
  projectie selecteert automatisch de eerste rij. Undo/Redo veranderen dezelfde
  bron, niet een tweede scenegraph of een apart selectie-undo-model.
- Selectie volgt een bronbereik via de werkelijke textmodelwijzigingen, niet de
  label-/outline-id. De eerste productproef vond anders een echte fout bij
  Remove → Undo → gelijknamige rij selecteren → Redo. De documentowner
  publiceert nu replacementlengtes in toepassingsvolgorde, ook voor inverse
  geschiedenis en alleen het nieuwe gedeelte van een coalesced type-edit.
  De gedeelde text-owner mapt één retained bronspan per open scene-input;
  volledige vervanging/deletie klapt het bereik dicht. De bestaande
  model-servicecallback onderhoudt dit ook bij een verborgen sceneview, zonder
  nieuwe inputabonnementen, een render-diff of een tweede selectiehistorie.
  De oude label-/range-idgenerator en zijn `Set` zijn verwijderd: de lijst heeft
  naast zijn syntaxfields en tracked selectie geen synthetische ids nodig.
- Het pane onthoudt de bronversie waaraan zijn controls zijn gebonden. Zo kan
  command-admission de projectie synchroniseren zonder de daaropvolgende
  control-/layoutupdate weg te nemen. Stabiele frames behouden parse, rijen,
  controls en layout; geen nieuwe frame-loop of worldtickwerk.
- Save en Hot Resume blijven de normale bronroute. `<init>` verandert de
  definitie voor toekomstige instanties, niet de reeds levende actor. De
  capture-layoutchecks blijven actief, zonder reboot of dummycapture als uitweg.

Voor de concrete operatie zijn deze productie-implementaties opnieuw gelezen:

- [VS Code notebook `runDeleteAction`](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/workbench/contrib/notebook/browser/controller/cellOperations.ts#L123-L186):
  structurele wijziging via het documentmodel; focus en selectie zijn onderdeel
  van de operatie, niet een bijwerking van toevallige nieuwe arrayindices.
- [Godot `SceneTreeDock::_delete_confirm`](https://github.com/godotengine/godot/blob/6a0f6f32cfb2ce4cc5bad6641d0afda413b62a9d/editor/docks/scene_tree_dock.cpp#L2933-L3040):
  eigen Undo-actie en het loskoppelen van de inspector na verwijderen.
- [Godot `EditorData::apply_changes_in_editors`](https://github.com/godotengine/godot/blob/6a0f6f32cfb2ce4cc5bad6641d0afda413b62a9d/editor/editor_data.cpp#L427-L431):
  concrete editors leveren hun pending waarden vóór sourceconsumptie. BMSX
  gebruikt daarvoor de reeds gebouwde `InputEdit`-/commandroute.
- [VS Code `IModelContentChangedEvent`](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/common/textModelEvents.ts#L40-L86)
  en [`nodeAcceptEdit`](https://github.com/microsoft/vscode/blob/48ac1875628144c02d79ff412e0323af9991dfc7/src/vs/editor/common/model/intervalTree.ts#L398-L490):
  de documentowner levert concrete changes en source-markers volgen die
  changes. BMSX gebruikt `NeverGrowsWhenTypingAtEdges` plus
  `collapseOnReplaceEdit`, zonder VS Codes complete decoration-/intervaltree.
  BMSX-history publiceert zijn opeenvolgende bewerkingen in echte applicatievolgorde,
  niet alsof elke inverse offset nog naar hetzelfde beginsnapshot verwijst.

Niet overgenomen: Godots live-nodeverwijdering, selectierescue, force-redraw-hack
of een notebookdocument naast Lua. De BMSX-owner blijft het Lua-textdocument.
De productproef doorloopt de werkelijke pointer-, draft-, Undo/Redo- en
Save & Hot Resume-route op software, WebGL2 en WebGPU; types en syntax-unittests
zijn daarvoor geen vervanging.

### Bewijs en kosten

`tests/conformance/runtime_replay/studio_scene_removal.ts` vervangt de eerdere
source-only capturetrial door de normale Remove-hit-target. Zij bewaart ook de
vier echte source-installaties en hun capture-/actoridentitychecks. Bewezen:

- een ongeldige draft blokkeert Remove met veldfocus en zichtbare fout;
- een geldige x=18-draft wordt vóór de structurele edit geaccepteerd; een
  vastgehouden pointer verwijdert precies één volledig gegroepeerd member en
  zijn separator, met exterior comments/whitespace exact behouden;
- document-Undo herstelt eerst de verwijderde bron mét x=18, daarna pas de
  propertyacceptatie; Redo, lege inspector/focusroute en no-selection-admission
  gebruiken dezelfde histories en controls;
- gelijknamige members blijven ook bij reselection → Redo correct; een verborgen
  sceneview volgt zijn bronbereik door een voorafgaande code-edit en zijn Undo;
- laatste/enige members verwijderen laat de lijst leeg en de inspector zonder
  editable controls; één Undo per member herstelt de oorspronkelijke bron;
- recovered syntax, readonly en geselecteerde dynamische source worden niet
  structureel gewijzigd; een ander direct member in een partial compositie
  blijft beschikbaar;
- Remove → Save & Hot Resume → Undo → reapply → Undo bewaart de oorspronkelijke
  zes capture-cellen en de levende Nemesis-actor. Geen guest-disposal of
  impliciete reboot. De bestaande daaropvolgende property-/reboot-/rewind-/
  foutreparatieproeven en de echte workspace-file-API blijven onderdeel van de run.

De vereenvoudigde non-growing marker-mapping is apart vergeleken met de
ongewijzigde `nodeAcceptEdit`-functie uit de hierboven gepinde VS Code-revisie:
**569.772 combinaties**, allemaal gelijk (niet-lege ranges in documenten van
1–16 code-units, insertielengtes 0–6). De repositorytests dekken ook de
eventvolgorde, meerdere edits per batch, inverse/coalesced geschiedenis,
retentie van events en volledige revert/restore. De mapping introduceert geen
syntaxheuristiek of matcher op namen.

Alleen echte documentmutaties maken de immutable event-array en één record met
offset/deletielengte/insertielengte per replacement. Geen extra brontekstkopie.
Stabiele zichtbare frames behouden dezelfde parse, rijen en controls; de oude
synthetische idgenerator vervalt. Een kleine Node 22.23.1-proef (3 warmups,
9 samples, 10.000 single-value textmodelbatches met één listener) mat een mediaan
van **4,78 ms vóór / 5,32 ms na** de nieuwe change-events. Dit is alleen
textmodel-eventkost, niet totale IDE-/GPU- of guestperformance; de machine- en
worldtickpaden veranderen niet.

Regressie: **927 Lua-tests geslaagd**, één bestaande skip; IDE-typecheck groen.
De tests-projecttypecheck heeft exact dezelfde **52 bestaande diagnostics** als
de schone baseline. Strikte architecture-boundaries, core-parity, indentation,
productbuild en `git diff --check` slagen. Alle drie de browserbackends slagen
met fault-gated output en bytegelijke eindbeelden; software is visueel bekeken.
Artefacten: `/tmp/bmsx-scene-remove/` (inclusief de eerst falende Redo-proef,
de referentie-oracle, microbenchmark en de complete browserproef).
Geen C++-/cartlib-/compiler-/ROMwijziging; geen nieuwe native-runtimeclaim.

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
