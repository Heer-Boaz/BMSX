# Cartlib recovery

Status: werkplan. Geen implementatiegeschiedenis of inventaris.

## Doel

Cartlib wordt een kleine cart-bundled game-engine met duidelijke owners. Normale
cartcode gebruikt World-features en `imgid`; lage-level GX-programmering blijft
rechtstreeks beschikbaar.

De huidige worktree is het vertrekpunt. Recente verbeteringen worden niet
teruggedraaid omdat oudere code anders werkte.

## Vaste besluiten

- Geen backwards compatibility, aliases of forwarding modules.
- Cartlib is geen firmware; de BIOS is firmware.
- De machine bezit registers, FIFOs, DMA, VRAM en GX-datapaths.
- De cart entry bezit displaymodus, IRQ-wiring en VBlankcadans.
- `imgid` is het normale imagecontract.
- Raw UV's, texturecoördinaten, CLUT-woorden, GP0 en MMIO blijven first-class.
- Een upload publiceert zijn binding bij admission. Rendering wacht niet op DMA
  of IMGDEC; onvolledige VRAM mag zichtbaar zijn.
- Eigen producerdata wordt direct geconsumeerd: geen guards, DTO-validatie,
  fallbacks of representatiewrappers.
- Hot paths alloceren geen tijdelijke tables, closures of iteratorstate en
  sorteren alleen na een relevante wijziging.
- De oude TypeScript-engine is alleen referentie voor namen en ownership. Oude
  Registry-, service- en hostlagen komen niet terug.

## Owners na de recovery

### World

World is de enige owner van objecten, ids, Spaces, lifecycle en object-, tag-,
type-, component- en visualindexen. Objecten, componenten en prefabs muteren die
state via World; Registry verdwijnt als tweede waarheid.

Queries geven retained dense lijsten/views terug. Leeg resultaat gebruikt één
World-owned lege lijst. First lookup is `bucket[1]`; allocation-iterators en
`find_*`-aliases verdwijnen.

Structurele wijzigingen tijdens een stage worden bij de stagebarrier zichtbaar.
De lopende dense lijsten blijven gedurende de stage stabiel. Buiten een stage
gebruikt World dezelfde commitroute direct.

### Schedule en features

Schedule bezit alleen vaste stages, vaste systemorder en barriers. World kent
geen stage-enum en heeft geen `update()` of `render()`.

Features bezitten hun componentkey, retained views en systems. Carts kiezen
features; zij bouwen geen lijst met interne ECS-systemfactories of numerieke
priorities.

### WorldRenderer en Presentation

WorldRenderer leest de retained visualview en bouwt commands in één retained
commandbuffer. Het sorteert alleen wanneer visualmembership of depth wijzigt.

Presentation bezit draw/display page, clearbeleid, submit/fence en page
advancement. Single en double buffering zijn configuratie van dezelfde owner,
niet twee ECS-systemklassen. De cart-loop bepaalt wanneer Schedule, VBlank en
Presentation draaien.

### Images en producerdata

De ROM-producer bepaalt fysieke VRAM-plaatsing en genereert afzonderlijk:

- framebuffer-/presentationconfiguratie;
- semantische imagebindings.

Normale cartcode uploadt en tekent via `imgid` en importeert geen generated
layoutmodule met namen zoals `sprites_texture` of `sprites_clut`. De image-owner
vertaalt `imgid` naar de actuele raw binding.

Sprite source-rects en image-local quads gebruiken scalars, geen tijdelijke
rect-, UV- of vertextables. Custom visuals houden daarnaast de raw commandroute.

## Implementatie

### 1. Runtime

- Maak World de enige lifecycle- en indexowner.
- Voeg retained queryviews en stagebarriers toe.
- Maak Schedule de enige executor.
- Verplaats systems naar hun feature-owner terwijl hun contract verandert.
- Migreer alle live callers van de gewijzigde API.
- Verwijder Registry, de generieke ECS-owner, `world:update()`, `world:render()`,
  allocation-queries en het dubbele disposalpad.

Klaar wanneer geen feature private World-/Space-tabellen leest en het oude
runtimecontract niet meer bestaat.

### 2. Rendering en GX

- Vervang het render-ECS-system door WorldRenderer en Presentation.
- Splits generated presentationconfig van semantische imagebindings.
- Migreer cart entries van layoutwoorden naar `imgid`-uploads.
- Behoud de bestaande VBlank- en displaycadans van iedere geraakte cart.
- Voeg scalar source-rect en image-local quadondersteuning toe.
- Verwijder het oude render system en de generated layout-API.

Klaar wanneer page rotation één owner heeft en carts geen fysieke
`*_texture`/`*_clut`-layoutnamen meer kennen.

### 3. Publiek oppervlak

Beoordeel resterende modules alleen op:

1. welke state ze bezitten;
2. welke representatie de grens passeert;
3. of ze gedeelde cart-SDK of cart-specifieke code zijn.

Modules zonder helder antwoord verdwijnen of verhuizen naar hun echte owner.
Oude paden blijven niet bestaan als compatibilitylaag.

## Werkwijze en bewijs

- Werk vanuit live owners en callers, niet vanuit handmatige JSON-inventarissen.
- Commit per coherent ownerstuk; vermenigvuldig een patroon pas na review.
- Review op ownership, hot-pathallocaties en compatibilityresten.
- Voeg alleen tests toe voor werkelijk gedrag of afwezigheid van het oude
  contract; geen tests voor inventarisbureaucratie.
- Typechecks en unit tests zijn geen runtimebewijs.
- Bouw en draai de geraakte carts werkelijk headless.
- Gebruik renderparity voor GX en heap/profilerdata voor performanceclaims.

De recovery is klaar wanneer oude contracten fysiek weg zijn, alle live callers
het nieuwe ownercontract gebruiken, steady update/render geen guest-heapchurn
veroorzaken, raw GX-routes behouden zijn en IMGDEC/DMA-incompleetheid rendering
niet blokkeert.
