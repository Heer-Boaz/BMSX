# Cartlib recovery

Status: uitvoerbaar werkplan. Dit document legt alleen de gewenste architectuur,
de migratievolgorde en het vereiste bewijs vast. Het is geen
implementatiegeschiedenis, bestandsinventaris of tweede architectuurhandboek.

## Doel en grens

Cartlib wordt opnieuw een kleine, snelle cart-bundled game-engine. Normale
cartcode werkt met `world`-objecten, features en `imgid`. Cartcode hoeft geen
interne registries, ECS-systemfactories, framebufferpagina's of fysieke
texture-/CLUT-plaatsen te kennen.

Dit maakt cartlib niet tot firmware en maakt GX niet minder programmeerbaar. De
BIOS blijft firmware. De machine blijft de fysieke emulator. Een cart die raw
GX wil programmeren houdt directe toegang tot texturecoördinaten, CLUT-woorden,
GP0, command lists en MMIO.

De huidige worktree is het vertrekpunt. Recente verbeteringen worden niet
teruggedraaid alleen omdat oudere code anders werkte.

## Taal- en naamregel

De Lua-dialect accepteert geen hoofdletters in identifiers. Alle Lua-modules,
locals, tabellen, methods en componentkeys gebruiken daarom `snake_case`.
Namen zoals `world`, `schedule`, `world_renderer` en `presentation` hieronder
zijn de werkelijke Lua-vorm; het zijn geen hoofdletterige engine-types.

## Niet-onderhandelbare besluiten

- Geen backwards compatibility, aliases, forwarding modules of deprecated
  exports. Na migratie bestaat het oude contract niet meer.
- Geen gedrag-behoudende verhuizing van code waarvan ownership of representatie
  fout is. Contract en callers veranderen samen.
- Geen generieke `game`, `host`, service-locator, dependency-DAG of multi-world-
  facade. Eén cartridge gebruikt één `world`.
- Intern geproduceerde data wordt direct geconsumeerd. Geen DTO-validatie,
  fallbacks, guards of wrappers rond eigen runtime- of producerrepresentaties.
- Hot paths maken geen tijdelijke tables, closures of iteratorstate. Ze scannen
  geen globale registry en sorteren niet zonder dirty revision.
- `imgid` is het normale imagecontract, niet een beperking van geavanceerde
  carts.
- Raw UV's, absolute texturecoördinaten, CLUT-woorden, GP0 en MMIO blijven
  first-class.
- Upload admission publiceert de nieuwe binding onmiddellijk. Rendering wacht
  niet op DMA- of IMGDEC-completion. Oude, partiële of ongeïnitialiseerde VRAM
  mag zichtbaar zijn terwijl de transfer nog loopt.
- De ROM-producer bepaalt fysieke VRAM-plaatsing; cartlib bevat geen runtime
  VRAM-allocator.
- Typechecks en unit tests zijn geen runtime- of performancebewijs.

De oude TypeScript-engine is alleen een referentie voor heldere namen en
verantwoordelijkheden. De oude globale Registry, hostservices, generators,
rendergraph en dynamische frameworklagen komen niet terug.

## Waarom de huidige architectuur fout is

De zichtbare lelijkheid komt niet vooral door namen, maar door verkeerde owners:

1. `world` bezit objectstorage én een system manager én de frame-loop.
   `world:update()` hardcodeert stages; `world:render()` behandelt presentation
   als een ECS-stage.
2. Lifecycle heeft meerdere waarheden: `world`-tabellen, Registry,
   `dispose_flag`, immediate despawn en een apart end-of-framepad.
3. Queries lekken private `active_space`-tabellen of bouwen iteratorstate en
   filteren Registry-buckets in framewerk.
4. Rendering, clear, draw target, fence, display origin en page rotation zitten
   samen in een render-system met aparte single- en double-bufferklassen.
5. Generated producerdata lekt naar cartcode als namen zoals
   `sprites_texture`, `sprites_clut`, `framebuffer_front` en
   `framebuffer_count`. Dat zijn fysieke plaatsingsdetails, geen cartconcepten.

Recente nuttige verbeteringen blijven bruikbaar: dense lijsten, swap-remove,
phase-lokale systemarrays, cached inputprogramma's en één retained GX-
commandbuffer. Zij worden onder de juiste owner geplaatst in plaats van
weggegooid.

## Ownergrenzen

### Machine en BIOS

De machine bezit GX/ICU/GEO/APU-registerfiles, latches, FIFOs, DMA, fysieke VRAM
en timing. De BIOS bezit boot en firmware-services.

Geen van beide bezit `world`, sprites, featurecomposition, residencybeleid of
de cart-frame-loop. Cartlib programmeert hardware; het emuleert hardware niet.

### Cartridge entry

De cart entry bezit:

- displaymodus;
- IRQ-registratie en maskers;
- de exacte volgorde van gameplay, VBlank, render, transfers en presentation;
- keuze van de cart-features en presentationconfiguratie.

De entry importeert geen interne systemfactorylijst en geen generated fysieke
VRAM-layoutmodule.

### ROM-producer

De producer bezit imagepacking, fysieke VRAM-plaatsing, alignment en
overlapcontrole. Hij genereert statische data in de representatie die cartlib
nodig heeft. Hij genereert geen breed runtime-DTO met aliases voor iedere
mogelijke consumer.

### `world`

`world` is de enige owner van levende objecten, ids, `space`-partities,
lifecycle en alle object-, tag-, type-, component- en visualindexen.

### `schedule`

`schedule` bezit alleen stagevolgorde, systemorder en structurele barriers. Het
bezit geen objectstorage, framebufferstate of VBlank.

### Features

Een feature bezit zijn componentkey, retained queryviews, systems en eventuele
feature-indexen. Voorbeelden zijn input, FSM, behaviour tree, timelines, action
effects en collision. Er is geen centrale componentcatalogus die al die owners
weer samenvoegt.

### `world_renderer`

`world_renderer` bezit de retained draw-commandbuffer en vertaalt actieve visual
components naar GX-commands. Het bezit geen display origin of page rotation.

### `presentation`

`presentation` bezit de cart-side draw/display pages, clearbeleid, fence,
submit en page advancement. Het is geen ECS-system en geen hardwaredevice.

### Image- en texture-owner

De image/texture-owner bezit `imgid`-resolution, gedeelde atlas-/textureidentity,
de actuele raw binding en uploadprogrammering. Cartcode ziet normale images via
`imgid`; raw callers kunnen de lage-level route rechtstreeks gebruiken.

## Runtimecontract

### `world`, `space` en objecten

Er is één cart-owned `world`. Een `space` is een wederzijds exclusieve
world-partitie, geen renderlayer. De actieve `space` bepaalt welke retained
active views systems lezen.

`world` onderhoudt minimaal:

- één dense lijst van alle levende objecten en een directe id-index;
- globale en per-`space` type- en tagbuckets;
- de actieve objectlijst van de geselecteerde `space`;
- actieve componentbuckets per feature-owned componentkey;
- één actieve visualbucket plus een visual revision.

Een `world_object` bewaart gameplaydata en callbacks, maar schrijft nooit in die
indexen. Het gebruikt zijn toegewezen `world`. `world_object` en componenten
importeren geen globale world-singleton om lifecycle te omzeilen.

Prefabdefinitions blijven cart-wide constructiedata. De live spawnroute loopt
via `world`: reserveer eerst id en object, wijs `world` toe, bouw het prefab en
zijn componenten volledig, en publiceer het pas daarna bij de geldende barrier.
Zo kan geen system een half opgebouwd object zien.

Despawn heeft één opdracht en één commitroute. Het oude onderscheid tussen
`mark_for_disposal`, queued disposal en immediate `world:despawn()` verdwijnt.

### Structurele barriers

Voor iedere schedule-stage opent `schedule` een structurele scope en commit
`world` na de stage. `world` kent de naam van de stage niet.

Tijdens een actieve stage:

- blijven alle dense querylijsten stabiel;
- worden spawn, despawn, `space`-move, activate/deactivate, tagmutatie,
  component attach/detach en enable/disable bij de volgende barrier zichtbaar;
- blijft teardowngevoelige parent-/componentstate intact tot membership uit de
  views is verwijderd;
- krijgen systems geen per-item guards voor pending mutation.

De directe value state mag al de nieuwe waarde tonen. Indexed membership blijft
de stage-snapshot. Er komt geen rollback, transaction of statecapture.

Buiten een schedule-scope gebruikt `world` dezelfde commitoperatie direct. Er
bestaan dus geen twee lifecycle-implementaties.

Een despawncommit doet in deze volgorde:

1. verwijder actieve object-, component- en visualmembership;
2. verwijder tag-, type-, `space`- en id-membership;
3. voer despawncallback en event uit op nog intacte objectstate;
4. detach componenten en feature-indexen;
5. unbind en finaliseer het object.

`world:clear()` gebruikt dezelfde despawntransitie voor alle objecten. De vaste
`space`-topologie, retained bucketidentiteiten, views en `schedule` blijven
bestaan; de gedeclareerde initiële `space` wordt opnieuw geselecteerd.

### Queries en retained views

Publieke objectqueries geven bestaande dense arrays terug, read-only by
contract. Ze maken geen iteratorobject of resultaatkopie. De basisvorm is:

```text
world:active_objects()
world:active_objects_by_type(type_key)
world:active_objects_by_tag(tag)
world:objects()
world:objects_by_type(type_key)
world:objects_by_tag(tag)
world:get(id)
```

`active_*` betekent actieve objecten in de geselecteerde `space`.
Ongekwalificeerde `objects*` omvat alle levende `space`-partities.

Een query zonder resultaat geeft één `world`-owned lege dense array. First
lookup is rechtstreeks `bucket[1]`. `find_by_*`, `find_any_by_*`, `all_*`-
aliases en `objects_with_components` verdwijnen.

Features vragen bij composition een retained componentview aan en bewaren die.
Een `space`-switch wijzigt de backing bucket van die view bij de barrier; het
system wordt niet herbouwd en zoekt niet iedere frame opnieuw in
`world.active_space`.

Tag- en typebuckets zijn echte `world`-indexen. Zij worden niet uit een globale
Registry gefilterd. Hot cartcode die een lijst nodig heeft, loopt direct over de
dense array met een numerieke loop.

### `schedule` en featurecomposition

De vaste runtime-stages zijn semantisch:

```text
input
action_effects
gameplay
physics
animation
```

Presentation is geen stage. Een cart entry roept `schedule:update(dt_ms)` en de
render/presentationowners expliciet aan in zijn eigen cadence.

Stagevolgorde en systemorder worden bij composition vastgelegd. De framehotpath
loopt alleen over de reeds geordende flat stage-array. Geen filtering, sorteren,
factorybouw of dependencyoplossing per frame.

Carts kiezen semantische features of een cart-owned worldmodule. Zij importeren
geen interne systems en geven geen willekeurige numerieke priorities door.
Een cart-specifieke executor, zoals elevatorlogica, wordt als cart-owned feature
op een benoemde stage/order gecomposeerd.

Iedere feature levert zijn complete tijdowner. Een action-effectcomponent zonder
system dat zijn cooldowntijd bijwerkt is niet toegestaan. Input sampling hoort
bij de inputfeature; de cart declareert alleen mappings en leest playerinput.

## Render- en GX-contract

### Visuals en `world_renderer`

Een visualcomponent bevat alleen retained authoringstate: owner, zichtbaarheid,
depth/offsets, `imgid` en de scalars die zijn visualtype nodig heeft. Hij bezit
geen framebuffer of pagepolicy.

`world` verhoogt de visual revision bij membership- of depthwijzigingen.
`world_renderer` rebuildt en sorteert zijn retained visualprojection alleen als
die revision verandert. Een onveranderd frame loopt de bestaande geordende
projection af en bouwt commands zonder allocatie of sort.

`world_renderer` gebruikt één retained BSS-commandbuffer. Custom visuals mogen
in diezelfde commandroute image-local of absolute raw commands schrijven.

### `presentation`

`presentation` wordt eenmaal geconfigureerd voor één of twee door de producer
geplaatste framebufferpages. De policy wordt niet als twee verschillende
systems geïmplementeerd.

Bij één page zijn draw en display dezelfde page. Bij twee pages houdt
`presentation` expliciet front en back bij:

- render schrijft naar back;
- submit is fenced;
- display origin wijzigt pas volgens de bestaande fence/completionsemantiek;
- daarna wisselen front en back;
- de volgende draw target wordt de nieuwe back.

Initial clear en per-frame clear volgen één expliciet clearbeleid. Er is geen
per-frame branch die opnieuw moet ontdekken hoeveel pages bestaan.

`presentation` en `world_renderer` wachten nooit zelf op VBlank. De cart entry
behoudt zijn bestaande volgorde. Een cart met twee displayframes per gameplay-
tick blijft dat doen; een cart met één VBlank tussen update en render blijft dat
doen.

De grens tussen `world_renderer` en `presentation` gebruikt bestaande raw page-
en sizewoorden of directe scalarargumenten. Er komt geen frame-DTO.

### `imgid`, bindings en uploads

Generated output wordt gesplitst in twee kleine ownerrecords:

1. presentationconfiguratie met de fysieke framebufferpages en grootte;
2. semantische image-/texturebindings voor de assets die de producer plaatste.

Cartcode kent semantische ids, geen fysieke slotnamen. Een normale upload is in
de vorm `gx_texture.upload(imgid)`. `gx_texture.load()` en `image.load()`
verdwijnen omdat zij geen runtime load uitvoeren.

`image.resolve(imgid)` en de texture-owner mogen retained records cachen. Een
sprite behoudt publiek zijn `imgid` en source-scalars; resolution gebeurt
éénmaal bij de image/renderergrens, niet via een hashlookup en allocatie per
frame.

Wanneer meerdere `imgid`s dezelfde atlastexture delen, delen zij één retained
texturebinding. Upload admission wijzigt die binding vóór IMGDEC klaar is.
Drawcommands mogen daardoor onmiddellijk naar de nieuwe bestemming verwijzen.
Er komt geen `ready`, rollback of old-bindingfallback.

De standaard image-API ondersteunt zonder tijdelijke tables:

- volledige image draw;
- source rect met `source_x`, `source_y`, `source_width`, `source_height`;
- arbitrary image-local quad met acht UV-scalars en acht destination-scalars.

De image-owner vertaalt image-local UV's aan de datapathgrens naar direct16- of
palette4-pagecoordinates en CLUT-woorden. De bestaande absolute raw quad-, GP0-
en MMIO-routes blijven daarnaast beschikbaar.

Een lage-level uploadvariant mag raw destination- en CLUT-woorden aannemen. Die
route woont bij de texture-owner; feature- of cartfiles definiëren geen lokale
encodinghelpers.

## Migratie

### Stap 1: runtime-owner herstellen

- Implementeer `world`-owned lifecycle, indexes en retained views.
- Implementeer `schedule` met flat stages en barriers.
- Migreer objecten, componenten en prefabs naar de ene mutationroute.
- Verplaats ieder system naar zijn feature-owner en bind retained views bij
  composition.
- Migreer alle live callers van de gewijzigde API.
- Verwijder Registry, de generieke ECS-owner, `world:update()`, `world:render()`,
  allocationqueries en het dubbele disposalpad.

Deze stap is niet klaar zolang een feature private `world`-/`space`-tabellen
leest of oud en nieuw lifecyclecontract naast elkaar bestaan.

### Stap 2: render- en GX-owner herstellen

- Implementeer `world_renderer` op de retained visualview/revision.
- Implementeer één `presentation`-owner voor één- en tweepagebeleid.
- Splits produceroutput in presentationconfig en semantische bindings.
- Migreer componenten en cart entries naar `imgid` en scalar source/quad APIs.
- Behoud per cart de bestaande IRQ-, VBlank-, upload- en displaycadans.
- Verwijder het render-ECS-system en de generated layout-API volledig.

Deze stap is niet klaar zolang carts `*_texture`, `*_clut`, framebufferaliases
of een single/double render-system kennen.

### Stap 3: publiek oppervlak opruimen

Beoordeel iedere resterende module op drie vragen:

1. welke state bezit zij;
2. welke representatie passeert haar grens;
3. is zij gedeelde cart-SDK of cart-specifieke code.

Een module zonder helder antwoord wordt verwijderd of naar de echte cart- of
feature-owner verplaatst. Oude paden blijven niet bestaan als compatibility.

Live callers worden uit de checkout/compiler-importgraph bepaald. Er komt geen
handmatig JSON-bestands-, consumer- of hot-functionregister.

## Validatie

Voor iedere ownerwijziging is het bewijs proportioneel aan de wijziging:

- compile en unit tests voor het gewijzigde contract;
- een echte headless run van iedere geraakte cart;
- lifecycleprobes voor spawn, detach, disable, tagmutatie, `space`-switch,
  despawn en clear tijdens een stage;
- orderprobes die iedere feature exact eenmaal op de juiste stage uitvoeren;
- queryprobes voor directe dense membership en `bucket[1]`-lookup;
- visual-revisionprobes: geen rebuild op onveranderde frames, exact één rebuild
  na membership/depthwijziging;
- presentationprobes voor één page en front/back-rotatie;
- een vertraagde uploadprobe die vóór IMGDEC-completion al de nieuwe binding in
  drawcommands ziet;
- imageprobes voor full draw, source rect, image-local quad en absolute raw
  quad;
- guest-heapmetingen na warm-up voor een vaste steady topologie;
- renderparity voor GX-wijzigingen en raw hardwarecarts als onafhankelijke
  regressiegate.

Typecheck/buildsucces wordt niet als headless, heap- of pixelbewijs beschreven.
Een performanceclaim vereist gemeten heap/profilerdata op de echte frame-loop.

## Drift die expliciet verboden is

Een implementatie is fout wanneer zij:

- cartlib firmware noemt of gedrag naar de BIOS verschuift;
- raw GX-authoring verstopt achter een high-level capabilitiesysteem;
- rendering op transfercompletion laat wachten;
- een runtime VRAM-allocator toevoegt;
- Registry naast nieuwe `world`-indexen laat bestaan;
- oude APIs met aliases of forwarding modules bewaart;
- `world` opnieuw scheduler of presentationowner maakt;
- presentation terugbrengt als ECS-stage;
- single en double buffering opnieuw als twee systemklassen bouwt;
- per-frame query-, sorteer-, callback- of commandrecordallocaties toevoegt;
- handmatige repo-inventarissen bouwt in plaats van live owners en callers te
  wijzigen;
- historische TypeScript-frameworkmachinerie kopieert in plaats van alleen de
  betere ownershiplessen toe te passen.

## Definitie van klaar

De recovery is klaar wanneer het oude runtime- en GX-contract fysiek weg is,
alle live callers rechtstreeks het nieuwe snake_case ownercontract gebruiken,
steady update/render geen guest-heapchurn veroorzaken, raw GX-routes behouden
zijn, transferincompleetheid rendering niet blokkeert en de werkelijk geraakte
carts headless en waar relevant pixelmatig zijn bewezen.
