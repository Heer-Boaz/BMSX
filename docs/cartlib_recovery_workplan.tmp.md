# Tijdelijk cartlib recovery-workplan

Status: uitvoerbaar architectuur- en migratieplan; nog geen implementatie.

Dit bestand is de repo-zichtbare coördinatiebron voor de cartlib-recovery. De
duurzame paraplu blijft `CARTLIB-SURFACE-01` in
[`open_architecture_slices.md`](open_architecture_slices.md). Commitgeschiedenis
hoort niet in dit bestand; gebruik daarvoor `git log`. De enkele oude hashes in
de referentiesectie zijn bewuste designankers uit de door de gebruiker gevraagde
september/oktober-audit, geen voortgangslog.

Laatste live audit: 2026-08-04, op `49d4c9baf204`. De bestaande worktree bevat
lopende cartlib/GX-wijzigingen. Die wijzigingen zijn het vertrekpunt en mogen
niet worden gereset, teruggedraaid of vervangen door de oude HEAD-versie.

## Opdracht en definitie van klaar

Cartlib wordt weer een kleine, snelle, begrijpelijke cart-bundled game-engine:

- cartcode kiest semantische worldmodules en werkt normaal met `imgid`;
- cartlib-owners bezitten schedule, lifecycle, indexes, rendering en de
  standaard residency/bindinggrens; gespecialiseerde transferpolicy mag
  cart-owned blijven;
- de cartridge blijft zelf eigenaar van displaymodus, IRQ-masker en exacte
  VBlank-/gameplaycadans;
- de machine-emulator blijft eigenaar van fysieke GX-registers, latches,
  FIFO's, VRAM en datapaths;
- de BIOS blijft de firmware; cartlib wordt nergens firmware genoemd en neemt
  geen BIOS-verantwoordelijkheid over;
- geavanceerde carts houden directe MMIO-, GP0-, texture-coordinate-, CLUT- en
  command-listtoegang;
- de framehotpaths alloceren niet, filteren niet, sorteren niet zonder dirty
  reden en lopen alleen over de kleinst mogelijke retained dense set.

Klaar betekent niet alleen dat de vier huidige high-level carts compileren.
Klaar betekent dat het oude contract fysiek weg is, alle twaalf live cartlib-
consumers force-builden, de vier high-level carts het nieuwe contract werkelijk
uitvoeren, TS/C++ software en GLES2 pixel-parity groen zijn, de raw GX-carts
groen blijven en de vaste-topologieprobes geen guest-heapgroei tonen.

## Niet-onderhandelbare regels

1. **Geen backwards compatibility.** Geen aliases, forwarding modules,
   deprecated exports, dubbele manifestparser, adapter naar de oude API of
   tijdelijk dual runtimecontract.
2. Iedere slice migreert alle live callsites en verwijdert het oude contract in
   dezelfde slice. Een half gemigreerde branch is geen afgeronde slice.
3. Geen cosmetische wrappers. Een nieuwe module of retained view moet een echte
   owner, state of datapath bezitten.
4. Geen guards, fallbacks of DTO-validatie voor data die de BMSX-producer zelf
   maakt. Repareer de producer of eigenaar.
5. Geen generiek multi-worldframework, service locator, dependency-DAG of
   `Game`/`Host`-facade. Eén cartridge heeft één World; daar is geen abstracte
   hostlaag voor nodig.
6. Geen gedrag-behoudende verhuizing van fout ontworpen code. Eerst het juiste
   contract ontwerpen, daarna de callsites rechtstreeks migreren.
7. Geen runtimeallocator voor VRAM. De ROM-producer plant fysieke plaatsing;
   cartlib consumeert de gecompileerde representatie.
8. IMGDEC/DMA-completion is geen render-readinessgate. Een toegelaten upload
   publiceert zijn nieuwe binding onmiddellijk. Oude, partiële of nog
   ongeïnitialiseerde VRAM mag zichtbaar zijn totdat de transfer klaar is.
9. `imgid` is het normale authoringpad, geen capabilitiesandbox. Raw UV's,
   absolute texture-coördinaten, CLUT-woorden, GP0 en direct MMIO blijven
   first-class.
10. Typechecks en unit tests zijn compile-/contractbewijs, geen runtimebewijs.

## Live probleembeeld

De concrete voorbeelden zijn symptomen van vijf verkeerde authorities:

1. **World is storage, registry, scheduler en frame-loop tegelijk.** De phase-enum
   staat dubbel in `cartlib/ecs.lua`; `world:update()` hardcodeert de volgorde;
   `world:render()` maakt presentatie een ECS-phase.
2. **Lifecycle heeft twee waarheden.** Objecten schrijven rechtstreeks in
   `_by_id`, `_spaces` en `_obj_to_space`; daarnaast bestaan registry,
   `dispose_flag`, immediate despawn en een apart end-of-frame disposalpad.
3. **Queries hebben geen eigenaar.** Hot systems lezen
   `world.active_space.active_components_by_type`; openbare tag/typequeries
   alloceren iteratorstate en scannen een globale registry met objecten,
   componenten en singletons door elkaar.
4. **Presentatie is een ECS-systemfactory.** Het huidige render system bezit
   commandbouw, clear, target, fence, display origin en page rotation en splitst
   dit in een single- en double-buffer-`system`.
5. **Producerdata lekt als misleidende runtime-API.** `sprites_texture` is geen
   texture maar een gepakt raw VRAM-destination-originwoord; `sprites_clut` is
   een raw CLUT-originwoord. `framebuffer`, `front`, `back` en `count` zijn
   redundante aliases rond hetzelfde fysieke plan.

Er zijn ook goede recente stukken die behouden moeten worden:

- phase-lokale flat systemarrays;
- dense componentlijsten en swap-remove;
- deferred structurele mutatie;
- gecompileerde/cached inputbindings;
- één retained BSS GX-commandbuffer;
- producer-side VRAM-bounds- en overlapvalidatie;
- raw integer GX-woorden zonder hostachtige decodeobjecten.

## Referenties en historische lessen

### Historische TypeScript-engine

De september/oktober-2025-engine is een naamgevings- en
verantwoordelijkheidsreferentie, niet een te porten implementatie.

| Historisch anker | Les die blijft | Wat niet terugkomt |
| --- | --- | --- |
| `eff88ebf6` / `e71596ebc` | `World` en `WorldObject` zijn heldere domeinnamen. | De globale `$`, Registry en hostdiensten in World. |
| `a18859929` | `Space` is een echt benoemd world-partition. | Generators, filters, proxy-indexes en kopieerende scopequeries. |
| `fa4ab012c` / `b887f25ee` | Systemen hebben een expliciete stage en vaste order. | World als executor, per-frame statsallocaties en meerdere phase-enums. |
| `4cca5572a` / `076f0c03d` | Een cart-owned `WorldModule` is de juiste compositiegrens. | Dependency-ID's, conditionele nodes, Kahn-sort en cycle fallback. |
| `56ad2e4f3` | Een normale sprite draagt logische image identity (`imgid`). | WebGPU-handles, render graphs, dynamische extract/prepare-machinery en `GameView`. |

### Productiereferenties

- [MAME `psxgpu_device`](https://github.com/mamedev/mame/blob/master/src/devices/video/psx.h#L26-L59)
  en [retained `update_screen`](https://github.com/mamedev/mame/blob/master/src/devices/video/psx.cpp#L645-L792):
  fysieke VRAM, displayregisters en drawstate horen bij het machine-device.
  Cartlib programmeert dat device maar bezit het niet.
- [Flecs staging](https://github.com/SanderMertens/flecs/blob/master/src/stage.c#L2-L16):
  structurele wijzigingen worden aan sync points zichtbaar. BMSX neemt alleen
  die zichtbaarheidsregel over; de single-thread guest krijgt retained flat
  dirty arrays, niet Flecs' allocators of generieke commandrecords.
- [Bevy `Sprite`](https://github.com/bevyengine/bevy/blob/main/crates/bevy_sprite/src/sprite.rs#L19-L42)
  en [RenderAsset](https://github.com/bevyengine/bevy/blob/main/crates/bevy_render/src/render_asset.rs#L109-L151):
  normale authoring behoudt image identity en optionele source rect tot de
  renderer/residencygrens. BMSX gebruikt hiervoor statische `imgid`-records en
  raw woorden, niet Bevy's dynamische handle-/extractmodel.
- [bgfx `frame`](https://github.com/bkaradzic/bgfx/blob/master/include/bgfx/bgfx.h#L2290-L2327):
  één expliciete presentation-owner bezit page/frame advancement. In BMSX
  blijft de cart-loop daarboven eigenaar van de VBlankcadans.

## Definitieve lagen en owners

| Laag | Enige verantwoordelijkheid | Heeft nadrukkelijk niet |
| --- | --- | --- |
| Machine TS/C++ | GX/ICU/GEO/APU-registerfiles, latches, FIFOs, DMA, VRAM en datapaths | World, sprites, residency policy of cart frame-loop |
| BIOS | boot, firmware-services en system-ROM-beleid | cartlib schedule, world lifecycle of cart presentation policy |
| Cartridge entry | display mode, IRQ-wiring, VBlank-/gameplaycadans, keuze van cartmodule en presentation mode | interne cartlib-systemfactorylijst of raw generated layout DTO |
| ROM producer | image packing, fysieke VRAM-layout, overlapvalidatie en generated ownerdata | runtime residency state of rendering |
| `World` | levende objecten, Spaces, lifecycle en indexes | schedule, input sampling of presentation |
| `Schedule` | stagevolgorde, systemorder, querybinding en structurele barriers | objectstorage, framebuffer pages of VBlank |
| Feature/WorldModule | eigen componentkey, eigen volledige systems en featurestate | globale implementatieregistry of cart-facing priorities |
| `WorldRenderer` | retained commandlist en visual -> GP0-commandbouw | display origin, fence of page rotation |
| `Presentation` | cart-side draw/display page, clear/fence/submit/swap | GX-device-emulatie, displaymodus of VBlank-loop |
| GX image/texture owner | `imgid` -> retained source -> actuele raw binding; upload admission | runtime VRAMallocator of transfer-readinessfallback |

## Definitieve runtimecontracten

### World en Space

- Er is één cart-owned World-instance. Dit plan introduceert geen hypothetische
  multi-worldondersteuning.
- `cartlib/world/space.lua` definieert `Space` als een **wederzijds exclusieve
  world-partition**. Een Space is geen renderlayer of UI/background-overlay.
- De `WorldModule` declareert bij boot de vaste Space-topologie en precies één
  initiële actieve Space. Na boot bestaat geen publieke dynamische `add_space`-
  route; een Space is onderdeel van de cartcompositie, niet van gameplaystate.
- World bezit alle globale en per-Space dense lijsten en alle indices. Object en
  component schrijven nooit in private World-tabellen.
- `WorldObject` bewaart data en callbacks en gebruikt uitsluitend zijn toegewezen
  `self.world` om structurele wijzigingen aan te vragen. Het importeert geen
  globale World-singleton.
- Prefabconstructie reserveert het object-id via World voordat componenten
  worden attached. `WorldObject.new()` vraagt niet zelf een globale id op.
- `cartlib/prefab.lua` bezit uitsluitend cart-wide definities/construction.
  De publieke live route is `world:spawn(prefab_id, options)`: World reserveert
  id en object, wijst `self.world` toe, laat de prefabowner de definitie op dat
  nog ongepubliceerde object bouwen en publiceert het pas na volledige
  initialisatie bij de geldende barrier. `prefab.spawn` en een prefabimport van
  de globale World verdwijnen.
- `object:despawn()` is de ene publieke destruction-opdracht. World bepaalt of
  die opdracht bij de volgende barrier of direct wordt gecommit. Het oude
  `mark_for_disposal()` en de overloaded `world:despawn(id_or_obj)` verdwijnen.

De openbare query-API retourneert bestaande read-only-by-contract dense arrays,
geen generator, closure of iteratorstate:

```text
world:active_objects()
world:active_objects_by_type(type_key)
world:active_objects_by_tag(tag)
world:objects()
world:objects_by_type(type_key)
world:objects_by_tag(tag)
world:get(id)
```

Ongekwalificeerd `objects*` betekent alle levende Spaces; `active_objects*`
betekent de actieve Space en `active == true`. Een first lookup is rechtstreeks
`bucket[1]`. Daarom bestaan `find_by_*`, `find_any_by_*`, `all_objects_*` en
`objects_with_components` niet meer. Een legitieme query zonder matches
retourneert één World-owned immutable lege dense array; dat is de normale lege
queryrepresentatie, geen corrupt-statefallback en geen callsiteallocatie.

Per World/Space komen retained dense indexes voor:

- live objects en id;
- object type;
- object tag;
- active objects;
- active components per module-owned componentkey;
- active visuals.

`_space_order`, `space.by_id` en `active_objects_by_tick_order` verdwijnen: de
live audit vond geen consumer die hun dubbele waarheid rechtvaardigt.

### Structurele zichtbaarheidsregel

Schedule opent vóór iedere stage een structurele scope en commit na de stage.
World kent de stage-id niet.

- Dense querylijsten blijven gedurende de hele stage stabiel.
- Spawn, despawn, Space move, activate/deactivate, tagwijziging en component
  attach/detach/enable worden bij de eerstvolgende barrier zichtbaar.
- Een actieve-Spacewissel die tijdens een stage wordt aangevraagd, wisselt bij
  diezelfde barrier alle gebonden viewpointers atomair; geen system ziet een mix
  van oude en nieuwe Space-buckets.
- Attach wordt pas gepubliceerd nadat het object en component volledig zijn
  geïnitialiseerd. Tijdens een actieve stage voeren detach en despawn geen
  `on_detach`, `unbind`, componentdestructie of objectfinalisatie uit.
- De lokale value state verandert bij de opdracht: `has_tag()` en
  `component.enabled` lezen dus de nieuwe waarde, terwijl indexed membership
  tot de barrier dezelfde stage-snapshot blijft.
- Tot de barrier blijven bij detach/despawn de teardown-sensitive parent-,
  binding- en componentvelden intact. Bij de barrier verwijdert World eerst alle
  relevante querymembership en pas daarna draaien `on_detach`, `unbind` en
  finalisatie. Een later system in dezelfde stage ziet daardoor nooit een half
  ontmanteld component.
- Built-in systems vertrouwen die snapshot en krijgen geen per-item
  `enabled`/despawn-guard; structurele uitsluiting begint in de volgende stage.
- Gewone objectvelden blijven gewone directe writes. Er komt geen rollback,
  snapshot, transaction of representatie-fallback.
- Buiten een schedule-scope gebruikt World exact dezelfde commitoperatie direct.

World gebruikt herbruikte flat queues:

- één dirty-objectlijst voor lifecycle/Space/active state;
- één dirty-componentlijst voor attach/enabled state;
- parallelle retained object/tag-arrays voor tagbucketwijzigingen.

Er komen geen per-mutatie commandtables. Eén pointer kan per queue maar eenmaal
pending zijn. Despawn is een eindstate in de objectreconcile en geen apart
end-of-framepad.

Een despawncommit verloopt exact zo:

1. verwijder het object en zijn componenten uit actieve querymembership;
2. verwijder tag-, type-, Space- en id-membership;
3. voer `on_despawn` en het despawn-event uit terwijl het object nog volledig is;
4. detach componenten en hun feature-owned live-instance-indexes;
5. unbind en finaliseer het object.

`world:clear()` gebruikt voor ieder object dezelfde transitie. Het despawnt alle
objecten, maar behoudt de gedeclareerde Space-objecten, alle bucketidentiteiten,
Schedule en retained views; daarna selecteert het opnieuw de gedeclareerde
initiële Space. Carts hoeven en mogen Spaces na een clear dus niet opnieuw toe
te voegen. Er is geen afwijkend clearpad.

### Componentkeys en retained queryviews

- Iedere componentmodule bezit één guest-stringkey. Voorbeelden zijn `fsm`,
  `behaviour_tree`, `timeline`, `sprite` en `collider_2d`.
- Module-table identity, host object identity en constructornaam zijn geen
  guestrepresentatie.
- `cartlib/components/types.lua` verdwijnt volledig.
- Schedule bindt systems tijdens compositie aan retained queryviews. Een view
  heeft stabiele identity en wijst met `items` naar de actuele Space-bucket.
  Alleen `set_space()` verandert die pointer.
- Schedulecompositie materialiseert in iedere gedeclareerde Space vooraf een
  echte bucket voor iedere gebonden componentkey en active-object-typekey.
  Componentattachment appendt daarna in die bestaande bucket; er is geen
  gedeelde empty bucket en geen late pointerreparatie.
- Twee systems op dezelfde key delen één view. Omdat de Space-topologie en
  bucketidentiteiten na boot vaststaan, verandert uitsluitend `set_space()` de
  `items`-pointer.
- Systemhotloops lezen alleen `self.components.items` of een gebonden
  active-object-typeview en gebruiken numeric loops.

De retained view is geen cosmetische wrapper: zonder die stabiele identity zou
iedere systemupdate opnieuw World/Space moeten opzoeken of bij Spacewissel
opnieuw opgebouwd moeten worden.

De live hot callsites die in 1A verplicht naar gebonden views migreren zijn:

| Owner na migratie | Huidige callsite(s) |
| --- | --- |
| action effects | `cartlib/ecs/systems/action_effect_runtime.lua` |
| behaviour tree | `cartlib/ecs/systems/behaviour_tree.lua` |
| FSM | `cartlib/ecs/systems/fsm.lua` |
| overlap/GEO | `cartlib/ecs/systems/overlap_2d.lua` |
| screen boundary | `screen_boundary_capture.lua` en `screen_boundary.lua` |
| tile collision | `cartlib/ecs/systems/tile_collision.lua` |
| timeline | `cartlib/ecs/systems/timeline.lua` |
| input actions | `cartlib/input/action_effect/system.lua` |
| Pietious elevator | `carts/pietious/elevator/system.lua` |

Na migratie importeert geen van deze systems de globale World-module en leest
geen system rechtstreeks een `Space`-private bucket.

### Schedule en WorldModule

`cartlib/ecs/schedule.lua` wordt de enige executor. De definitieve stagevolgorde
behoudt de vijf huidige structurele barriers en hun effectieve semantiek:

1. `input` — consumeert de ICU-snapshot die al bij VBlank is gelatcht, werkt
   retained input-/decisionstate bij en armt de volgende ICU-sample;
2. `effects` — action-effecttijd en cooldowns;
3. `gameplay` — FSM en cart-specifieke simulatie;
4. `physics` — boundary resolution, overlap en tile collision;
5. `animation` — timeline/framevoorbereiding.

`presentation` is geen stage.

Een systemdefinition bevat alleen boot-time data: `stage`, owner-owned `order`,
querykeys en construct/updatefunctie. De volledige ingebouwde executietabel is:

| Stage | Systemowner | Order | Gebonden query |
| --- | --- | ---: | --- |
| `input` | PlayerInput sampling/arm | -200 | geen objectquery; retained ICU/PlayerInput-state |
| `input` | screen-boundary capture | -100 | componentkey `screen_boundary` |
| `input` | behaviour tree | 0 | componentkey `behaviour_tree` |
| `input` | input action | 10 | componentkey `input_action_effect` |
| `effects` | action-effect cooldown | 32 | componentkey `action_effect` |
| `gameplay` | FSM | 0 | componentkey `fsm` |
| `gameplay` | Pietious elevator/custom | 20 | active-object-typekey `elevator_platform` |
| `physics` | screen-boundary resolve | 30 | componentkey `screen_boundary` |
| `physics` | overlap/GEO | 42 | componentkey `collider_2d` |
| `physics` | tile collision | 45 | componentkey `tile_collision` |
| `animation` | timeline | 0 | componentkey `timeline` |

Iedere owner reserveert een unieke semantische order binnen zijn stage.
`registration_index` is uitsluitend een deterministische total-order
tiebreaker, nooit een semantisch orderingcontract. De surface-inventaris en
compositietests bewijzen dat orders uniek zijn; de framehotpath valideert dit
niet. De framehotpath doet geen sort, filter, tableconstructie of dependencylookup.

Een `WorldModule` is een plain cart-owned compositietable met deze concrete
shape en bootroute:

```lua
local world_module<const> = {
	spaces = { 'main' },
	initial_space = 'main',
	systems = {
		player_input,
		screen_boundary,
		behaviour_tree,
		input_actions,
		action_effects,
		fsm,
		collision_2d,
		timeline,
	},
	extensions = { elevator_system }, -- alleen echte cart-owned extensions
}

local w<const> = new world()
w:configure_spaces(world_module.spaces, world_module.initial_space)

-- Op de door de cart gekozen gameplaycadans:
w:update()
```

Cartlib-featuremodules leveren
hun complete interne systemset; de cart kiest semantische modules, niet
`cartlib/ecs/systems/*`-factories of cartlib-priorities. Voorbeelden:

- screen-boundary bevat zowel pre-capture als resolve;
- action-effects bevat zijn tijd/cooldownexecutor;
- PlayerInput bevat ICU arm + retained action sampling;
- een Pietious-elevatormodule bevat zijn eigen custom systemdefinition.

Er komt geen centrale `with_fsm`/`with_bt`-catalogus, dependency-DAG, `when`
predicate of cycle fallback. De cartmodule noemt iedere semantische module exact
eenmaal. Cartlib-owners bepalen onderlinge order; een custom cartsystem bepaalt
alleen zijn eigen stage/order.

WorldModulecompositie en Spaceconfiguratie gebeuren eenmaal bij cartboot en
overleven `world:clear()`. Daardoor verdwijnen zowel de verborgen eis dat
`world.systems:replace()` vóór `add_space()` moet lopen als de herhaalde
`add_space()`-calls uit carts.

De action-effectexecutor verhoogt alleen de componenttijd in zijn dense view.
Hij loopt niet met `pairs` over alle granted effects: `trigger` en
`cooldown_remaining` vergelijken rechtstreeks met het retained absolute
`cooldown_until`. Een verlopen deadline hoeft niet op nul te worden
teruggeschreven.

### Rendering, presentatie en visual order

- single-page: unfenced submit, vaste display/draw page;
- double-page: fenced submit, originwijziging na fence en page swap.

De cart kiest een van beide eenmaal en configureert daarbij exact één clear-
policy: een retained clear color of geen clear. De constructor bindt de passende
begin-/submitroute; er is geen hardcoded zwart, per-frame policybranch,
`framebuffer_count`-branch of allocatie en er zijn geen single/double
ECS-subclasses.

De exacte double-page boot- en pagevolgorde is:

- initialisatie: display page A, draw page B; A en B worden volgens dezelfde
  cart-configured clearpolicy wel of niet gecleard;
- de eerste afgeronde render wordt fenced op B; pas na de fence wordt origin B;
- afgeronde display origins zijn daarna `B, A, B, A, ...`;
- volgende draw pages zijn daarna `A, B, A, B, ...`.

Voor single-page blijven display en draw beide A en is submit unfenced.

### GX layout, image identity en residency

`scripts/rompacker/gx_vram_layout.ts` blijft producer-owner van één fysiek
VRAM-plan: framebuffers, reserved regions, texture placements, CLUT-placements
en overlapvalidatie. Dat begrip is dus geldig; het is alleen geen cart-facing
runtime-DTO.

De manifestvorm heeft één canonieke semantiek. `images` bevat uitsluitend
logische image-id's; filenames, directories, globs, `@atlas=N` en numerieke
groupkeys zijn geen alternatieve invoervormen:

```yaml
gx_vram_layout:
    framebuffers:
        - { x: 0, y: 0, width: 256, height: 192 }
    reserved:
        system: { x: 704, y: 720, width: 320, height: 304 }
    placements:
        stage:
            texture: { x: 512, y: 256, width: 384, height: 256 }
    texture_groups:
        stage:
            images: [ground, stage_clouds, stage_enemies]
            mode: direct16
            placements: [stage]
            default_placement: stage
    coexistence_sets:
        gameplay: [stage]
```

Iedere cart-image hoort exact eenmaal bij één semantische texture group. Iedere
group produceert exact één texture-resource met één producer-intern `AssetId`;
`imgmeta.gx_texture_resid` bevat datzelfde `AssetId` en
`bmsx/gx/texture_bindings` is met exact die identity gekeyed. Daardoor kan
`_atlas_00` niet als verborgen tweede naam blijven bestaan.

Een group met `default_placement` ondersteunt `upload(imgid)`. Een group met
meerdere placements maar zonder default ondersteunt uitsluitend de expliciete
`upload_to(imgid, placement_id)`-route. De producer kiest nooit stilzwijgend de
eerste placement en cartlib heeft geen runtimefallback.

`working_sets` heet `coexistence_sets`, omdat het uitsluitend valideert welke
placements tegelijk fysiek bezet mogen zijn en niets activeert. De producer
emit via `scripts/rompacker/gx_runtime_modules.ts` twee owner-private
ROM-modules: `bmsx/gx/presentation_config` en
`bmsx/gx/texture_bindings`. Presentation config bevat alleen raw page-
originwoorden en raw size. Texture bindings mappen het interne texture-AssetId
en de semantische placement naar raw destination- en CLUT-destinationwoorden.
`bmsx/gx_vram_layout`, `framebuffer/front/back/count` en
`${slot}_texture`/`${slot}_clut` verdwijnen volledig.

Dit is verplicht één producerwijziging over
`scripts/rompacker/gx_vram_layout.ts`, het nieuwe
`scripts/rompacker/gx_runtime_modules.ts`, `atlasbuilder.ts`,
`texture_atlas_contract.ts`, `rombuilder.ts`, `rompacker.ts`,
`rompacker.rompack.d.ts`, `toolchain/ts/rompack/generated_modules.ts` en de
relevante `gx_texture_contract`, `texture_packing`,
`blua32_image.module_paths`- en `lua_sources`-tests. Geen van deze owners mag
`@atlas=N`, `_atlas_N` of de oude generated module blijven produceren of
accepteren.

Alleen `cartlib/gx/presentation.lua` importeert presentation config. Alleen de
GX texture-owner importeert texture bindings. Gewone cartcode importeert geen
generated GX-module.

Normaal pad:

```text
imgid -> retained image source -> shared texture resource
      -> actuele raw texture binding -> GP0 command
```

`cartlib/gx/texture.lua` bezit cached texture resources en actuele bindings:

- `resolve(imgid)` resolveert identity; `load` verdwijnt;
- `upload(imgid)` programmeert de producerbinding van het gedeelde texture
  resource achter dat image;
- `upload_to(imgid, placement_id)` is toegestaan voor cart-owned residency
  zoals de twee semantische 2025-backgroundplaatsen;
- `upload_raw(texture, destination_word, clut_destination_word)` blijft de
  gelijkwaardige raw route; alle destinations zijn raw woorden en direct16
  geeft letterlijk `0` als CLUT-woord door, nooit `nil` of een default;
- `upload`, `upload_to` en `upload_raw` schrijven de destination- en CLUT-
  bindingvelden van hetzelfde gedeelde retained texture-record **vóór** hun
  `imgdec.upload`-write;
- een cart-owned pending policy publiceert niets: bindingpublicatie gebeurt pas
  wanneer die policy werkelijk een van de drie uploadcalls uitvoert;
- completion ruimt uitsluitend transferschedulingstate op. Zij muteert,
  herpubliceert, herstelt of rolt de drawbinding nooit terug en maakt geen
  tweede `ready`-state.

`cartlib/gx/image.lua` bezit `resolve(imgid)` en deze allocation-free scalar
drawsurface op het retained source-record:

```text
image.draw(draw, source, x, y, color, flip_flags, blend_mode)
image.draw_rect(draw, source,
    source_x, source_y, source_width, source_height,
    x, y, color, flip_flags, blend_mode)
image.draw_quad(draw, source,
    source_x0, source_y0, source_x1, source_y1,
    source_x2, source_y2, source_x3, source_y3,
    x0, y0, x1, y1, x2, y2, x3, y3,
    color, blend_mode)
```

De rectwaarden zijn image-local integer `x`, `y`, `width` en `height`; de quad
ontvangt acht image-local integer UV-scalars en acht destinationscalars, nooit
een rect-/vertex-/UV-table. De image-owner vertaalt die waarden aan zijn
datapathgrens naar direct16 pagecoordinates of naar palette4 texture-page- plus
CLUT-woorden.

`SpriteComponent` blijft `imgid`-gedreven en krijgt retained scalar
`source_x`, `source_y`, `source_width` en `source_height` voor crop/reveal.
`CustomVisualComponent` behoudt rechtstreeks de command list en kan per frame
de image-local quadscalars of absolute raw UV's schrijven.
`direct16_quad`, `palette4_quad`, `cartlib/gx/gpu`, `cartlib/gx/gp0`, direct
MMIO en `bare_metal_cart` blijven bestaan. Er komen geen tijdelijke rect-/UV-
tables in de drawhotpath.

## Migratieslices

De core hieronder heeft twee onderling afhankelijke werkstromen maar is **een
verticale oplevering**. Runtime zonder nieuwe presentatie zou de carts zonder
renderer achterlaten; presentatie vóór de nieuwe Worldviews zou opnieuw tegen
de verkeerde internals worden gebouwd. Daarom zijn `RUNTIME` en `GX` geen los
shipbare tussenstappen. Binnen de worktree mogen lokale tussentoestanden bestaan;
de opgeleverde core bevat nooit oud en nieuw naast elkaar.

```text
CARTLIB-CORE-01
  |-- RUNTIME workstream
  `-- GX workstream
        |
        v
CARTLIB-SURFACE-01
        |
        v
CARTLIB-FINAL-01
```

Vóór de eerste code-edit van `CARTLIB-CORE-01` worden
`scripts/cartlib_surface_inventory.json` en `scripts/cartlib_hot_paths.json`
vanuit de dan live worktree vastgelegd. Zij zijn scope- en performancebewijs,
geen excuus om oude modules langer te laten bestaan; dispositions en doelpaden
worden in dezelfde slices bijgewerkt.

### 1A. `CARTLIB-CORE-01/RUNTIME` — één World/lifecycle/query/schedule-authority

Dit is de runtimewerkstroom van de substantiële core-slice; schedule wordt niet
eerst cosmetisch uit World gehaald terwijl het nog tegen registry en private
Space-tabellen praat. Deze werkstroom wordt pas opgeleverd samen met 1B.

#### Runtimeimplementatie

1. Voeg `Space` en de definitieve World-owned dense indexes toe.
2. Vervang registry-backed lifecycle door de ene structurele commitroute.
3. Laat object, component en prefab uitsluitend via World muteren; geef prefab
   ids vóór componentattachment en migreer live spawn naar
   `world:spawn(prefab_id, options)`.
4. Laat tags/type/active/component/visual membership door dezelfde World-owner
   onderhouden.
5. Voeg retained component- en objectqueryviews toe en migreer alle systems van
   `world.active_space...` naar boot-time binding.
6. Verplaats systems naar hun feature-owner terwijl hun contract verandert:
   `fsm/system.lua`, `behaviourtree/system.lua`, `timeline/system.lua`, de
   collision/physicsowners en input/action-effectowners. Niet alleen renamen.
7. Bouw de definitieve Schedule en cart-owned WorldModulecompositie.
8. Migreer 2025, cartlib_test, Nemesis en Pietious, inclusief het custom
   elevatorsystem, naar semantische modules.
9. Laat PlayerInput binnen de inputmodule ICU arm/sampling bezitten; cartcode
   behoudt alleen mappings en PlayerInput-consumptie.
10. Integreer de action-effectruntime in zijn featuremodule. Nemesis en
    Pietious mogen geen action-effectcomponent meer hebben zonder tijdowner.
11. Maak visual depth revision-based en migreer alle directe runtime-z-writes.
12. Verwijder oude code en tests in dezelfde slice.

De vier huidige cart-querycalls worden rechtstreeks gemigreerd: elevator en
projectile-limit gebruiken `active_objects_by_type(...)`; Pietious room cleanup
gebruikt `objects_by_tag(...)` over alle Spaces. Zij krijgen geen iterator- of
scope-adapter.

#### Runtimepaden fysiek verwijderen

- `cartlib/registry.lua` en `registrypersistent`;
- `cartlib/components/types.lua`;
- `cartlib/ecs.lua` als system manager/base-systemowner;
- `cartlib/ecs/systems/*`;
- `world.systems`, `system_manager:replace`, `update_phase`;
- `world.current_phase`, `world:update()`, `world:render()`;
- `prefab.spawn` en iedere prefab/objectimport van een globale World-instance;
- `tick_group.presentation` en iedere tweede phase-enum;
- `dispose_flag`, `mark_for_disposal`, `queue_object_disposal` en het losse
  end-of-frame disposal-loopje;
- allocation-iterators, registry scans en alle `find_*`-/`all_*`-aliases;
- `active_objects_by_tick_order`, `_space_order` en `space.by_id`.

#### Registryconsumers

- FSM-library onderhoudt een feature-owned dense lijst attached
  FSM-componenten voor hot rebind.
- Behaviour-tree-owner onderhoudt instances per root-id voor hot rebind.
- EventEmitter is een module-owned eventbus en geen entity.
- World bezit object/tag/type/id/componentmembership; geen tweede shadowindex
  probeert dezelfde vraag te beantwoorden.

#### Runtimeacceptatie

Nieuwe cartlib_test-probes bewijzen:

- exacte stage- en systemorder;
- ieder feature-system precies eenmaal;
- custom extension op zijn opgegeven stage/order;
- spawn, deactivate, component disable, tag toggle en despawn midden in één
  stage veranderen de lopende iterator niet;
- alle wijzigingen zijn precies eenmaal zichtbaar in de volgende stage;
- een attach wordt nooit vóór volledige initialisatie gepubliceerd; detach en
  despawn laten latere systems in dezelfde stage intacte state zien en voeren
  teardown pas uit nadat membership bij de barrier verwijderd is;
- Spacewissel verandert retained viewpointers zonder system rebuild;
- `world:clear()` behoudt Schedule/WorldModule, Space- en bucketidentity, maakt
  alle bound views leeg en herselecteert de gedeclareerde initiële Space;
- cooldowntijd verloopt en input edges verschijnen eenmaal per gameplay tick;
- world clear en gewone despawn hebben dezelfde callbackvolgorde;
- tag/type first lookup is bucket `[1]`, zonder registryscan.

De runtimeprobes krijgen afzonderlijke entrypoints zodat een fout niet door een
latere presentatieassert wordt gemaskeerd:

- `tests/carts/cartlib_test/cartlib_schedule_runtime_assert.lua`;
- `tests/carts/cartlib_test/world_index_runtime_assert.lua`.

### 1B. `CARTLIB-CORE-01/GX` — producerbindings, WorldRenderer en Presentation

#### GX-implementatie

1. Splits generated ownerdata in presentation config en texture bindings.
2. Migreer manifest groups van filename-`@atlas=N` naar semantische producerdata
   en hernoem `working_sets` naar `coexistence_sets`.
3. Implementeer `WorldRenderer` op de retained visualview uit runtime-slice 1.
4. Implementeer expliciete single-/double-page Presentation zonder ECS.
5. Maak GX image/texture-resolve en configured/raw uploads het definitieve API.
6. Voeg scalar sprite source rect en image-local arbitrary UV-quad toe.
7. Migreer alle vier high-level carts en hun manifests in dezelfde slice.
8. Behoud per cart de bestaande display mode, IRQ-wiring en VBlankcadans exact.
9. Verwijder de oude generated module, flat exports en render system fysiek.
10. Corrigeer architectuurdocumentatie die cartlib abusievelijk firmware noemt
    of zegt dat cartlib IMGDEC via firmware aanroept; cartlib schrijft MMIO.

#### Cartmigratiematrix

| Cart | Runtime/presentation | Residency | Cadans die exact blijft |
| --- | --- | --- | --- |
| `2025` | single page, WorldRenderer + Presentation | cart-owned pending/in-flight policy op semantische background A/B bindings; geen raw layoutimport | `vblank -> schedule:update -> vblank -> world_renderer:render(presentation) -> pending upload` |
| `cartlib_test` | minimale standard module, single page | regressieframe met full imgid, crop, arbitrary image-local UV en absolute raw GP0 | `schedule:update -> vblank -> world_renderer:render(presentation)` |
| `nemesis_s` | single page | `texture.upload('ground')`; cart entry kent geen `stage_texture` | `schedule:update -> vblank -> world_renderer:render(presentation)` |
| `pietious` | double page, fenced | `texture.upload('pietolon_stand_r')` resolveert het gedeelde palette4 resource; cart entry kent geen `sprites_texture/clut` | een gameplay tick over twee displayframes: `schedule:update -> vblank -> world_renderer:render(presentation) -> vblank` |

`2025/texture_residency.lua` mag transfer admission, pending en completion blijven
plannen. De naam `active` mag daar alleen completion/scheduling betekenen; de
shared drawbinding is al bij admission gewijzigd. Geen test of code mag die
binding terugzetten of rendering tot IMGDEC-done blokkeren.

Pietious behoudt ook zijn bootcadans exact: texture-upload admission;
Presentation initialiseert/cleart volgens policy A en B, met display A/draw B;
daarna world clear/build; daarna de bestaande pre-loop `vblank.wait()`; pas dan
de bovenstaande `update -> vblank -> render -> vblank`-loop. De page-acceptatie
verwacht eerste completed origin B en vervolgens `B, A, B, A, ...`, met draw
pages `A, B, A, B, ...` na die eerste submit.

#### GX-paden fysiek verwijderen

- `cartlib/ecs/systems/render.lua`;
- het reeds verwijderde `cartlib/render/world.lua` blijft weg;
- `bmsx/gx_vram_layout` en zijn generated pathconstants;
- `buildGxVramLayoutModuleSource` nadat split codegen eigenaar is;
- `framebuffer`, `framebuffer_front`, `framebuffer_back`,
  `framebuffer_count`, `${slot}_texture` en `${slot}_clut` runtimeexports;
- `gx_texture.load` en `image.load`;
- iedere cart-import van een generated GX layout/configmodule.

#### Contracttests

- Producer: fysieke bounds, page/CLUT-alignment, semantic groups,
  coexistence-overlap, shared texture identity en exacte generated modules.
- IMGDEC: start een vertraagde upload, bouw/presenteer vóór done IRQ en bewijs
  dat GP0 al de nieuwe binding gebruikt. Het scanoutbeeld mag oud, partieel of
  ongeïnitialiseerd zijn. Na completion zijn de nieuwe pixels zichtbaar.
- Standard authoring: dezelfde asset full en cropped via `imgid`.
- Advanced authoring: zowel direct16 als palette4 gebruiken acht per frame
  gewijzigde image-local UV-scalars plus acht destinationscalars; daarnaast een
  absolute raw GP0-quad. Geen rect-/UV-/vertextableallocatie.
- Presentation: single page blijft display/draw A/A. Pietious start display A,
  draw B; completed origins zijn B/A/B/A, volgende draw pages A/B/A/B en origin
  verandert uitsluitend na de fence.

De cart-runtimeprobes hiervoor zijn:

- `tests/carts/cartlib_test/presentation_runtime_assert.lua`;
- `tests/carts/cartlib_test/imgdec_binding_runtime_assert.lua`;
- `tests/carts/cartlib_test/image_uv_runtime_assert.lua`;
- `tests/carts/cartlib_test/visual_projection_runtime_assert.lua`.

### 2. `CARTLIB-SURFACE-01` — hele publieke cartlib-oppervlak

Dit is geen losse renamepass. Iedere naamwijziging gaat samen met een echte
owner- of contractcorrectie.

#### Naamregels

- Owners zijn zelfstandige naamwoorden: `World`, `WorldObject`, `Space`,
  `Component`, `Schedule`, `WorldRenderer`, `Presentation`.
- Componentlocals gebruiken consequent snake_case (`fsm_component`), geen mix
  van `fsmcomponent`, `state_machine_component` en constructornamen.
- `resolve` betekent retained identity ophalen; `upload` betekent een transfer
  programmeren; `render` betekent visual commands bouwen; Presentation
  `submit` betekent submit/fence/page advancement.
- `slot` en raw destinationnamen bestaan alleen in producer/GX-ownercode.
- `imgid`, prefab-id, Space-id, object type en componentkey blijven hun
  guestrepresentatie;
  er komen geen handle-/DTO-wrappers omheen.
- `system` is alleen een interne schedule-executor. Carts importeren
  worldmodules/features.

#### Module-voor-module disposition

| Huidige familie | Definitieve richting |
| --- | --- |
| `world/*`, `prefab.lua` | World/Space/object/component/prefabconstructie met één lifecycleauthority; prefab blijft cart-wide definitionowner, World blijft live-instanceowner. |
| `ecs.lua`, `ecs/systems/*` | vervangen door Schedule plus feature-owned systems; oude paden weg. |
| `fsm/*`, `behaviourtree*`, `timeline/*` | behouden als herbruikbare features; eigen keys, systems en hot-rebind instance-indexes; geen registryimport. |
| `input/player*`, `input/action_effect/*`, `action_effects.lua` | duidelijke PlayerInput-, input-action- en action-effectowners; iedere feature levert zijn complete systems; geen centrale componentcatalogus. |
| `collision/*`, `physics/*`, `collision2d.lua` | component/system bij domeinowner, raw GEO-orchestratie blijft low-level; ongebruikte `prohibit_leaving_screen_component` en zijn dode systemtak verdwijnen. |
| `render/*`, `sprite.lua`, `text/*`, `font.lua` | imgid-componenten + WorldRenderer; sprite/text objectnamen en paden worden consistent; geen presentation- of world-global reach-through. |
| `gx/*`, `dma.lua`, `irq.lua`, `apu.lua`, `aem*` | blijven first-class cart-side hardware/programming APIs; niets verhuist naar BIOS onder het voorwendsel firmware. |
| `bin.lua`, `romdir.lua`, `memory.lua` | blijven bij de ROM-/memoryboundary; geen lokale decodehelpers in feature- of cartfiles. |
| `registry.lua`, `components/types.lua`, `fsm/trace.lua` | verwijderen. `fsm/trace.lua` heeft geen live consumer. |
| `progression.lua` | naar Pietious: groot game-specifiek event/progressionprogramma zonder tweede cartconsumer. |
| `velocity.lua` | naar Pietious: muteert het Pietious-specifieke speed/accum-fieldcontract. |
| `util/bool01.lua`, `util/rol8.lua` | uit cartlib; inline of Nemesis-owned omdat de live uses debug/tape-specifiek zijn. |
| overige `util/*` | alleen behouden bij een echte gedeelde lage-level owner; `swap_remove` wordt de centrale dense-indexoperatie, geen lokale kopieën. |

Voor iedere resterende public module wordt vóór oplevering vastgelegd:

1. wie de state bezit;
2. welke cart(s) de API werkelijk gebruiken;
3. welke representatie over de grens gaat;
4. welke hot callsites bestaan;
5. waarom de module herbruikbare cart-SDK is en geen cart-specifieke dump.

Modules zonder antwoord worden verwijderd of naar de cartowner verplaatst; ze
krijgen geen facade om hun bestaan te rechtvaardigen.

#### Exhaustieve surface-inventaris

`scripts/cartlib_surface_inventory.json` wordt de machineleesbare scopegrens.
Het bevat **ieder** bestand dat bij de slice-start of in de eindstate onder
`cartlib/**/*.lua` staat, met:

- huidige pad en definitieve owner;
- disposition `keep`, `move` of `delete` en bij `move` het doelpad;
- alle live cart-/toolingconsumers;
- de representatie die de modulegrens passeert;
- benoemde hot functions en bijbehorende runtime-/contracttests.

`tests/lua/cartlib_surface_inventory.test.ts` vergelijkt de filesystemset met
de inventaris, eist dat iedere `keep`/`move`-uitkomst bestaat en dat iedere
`delete`-uitkomst en ieder verboden oud pad ontbreekt. Dit is een toolinggate
voor reposcope, geen runtime DTO-validatie of cartlib-hotpath.

De consumerkolom wordt niet uit vier showcasecarts afgeleid. De force-buildset
is exact de live cartlib-consumers uit de audit:

```text
2025
cartlib_test
cartridge_conformance
cpu_soak
emptycart
fade_probe
hot_resume_test
monitor_fault_probe
nemesis_s
pietious
renderhwtest
system_print_test
vblanktest
```

`bare_metal_cart` en `esther` importeren cartlib momenteel niet en horen daarom
niet valselijk in deze inventaris; zij blijven wel onafhankelijke raw/render-
regressiegates waar hieronder genoemd.

#### Event- en lifecycle-opruiming

- EventEmitter verliest registry- en `registrypersistent`-identiteit.
- De ongebruikte `persistent` listenerflag en zijn branches verdwijnen.
  Module-owned listeners bezitten hun eigen expliciete subscribe/unsubscribe-
  lifetime; object/componentlisteners eindigen bij unbind.
- Object/component unbind verwijdert zijn subscriptions rechtstreeks via de
  eventbusowner.
- FSM/BT rebind gebruikt feature-owned instance-indexes en geen generieke
  entityregistry.

### 3. `CARTLIB-FINAL-01` — bewijs, docs en afwezigheid van het oude model

1. Werk `docs/architecture.md` bij met de definitieve cart/BIOS/machinegrens,
   schedule, World, Presentation, imgid/raw routes en incomplete-VRAM-regel.
2. Werk `CARTLIB-SURFACE-01` in `open_architecture_slices.md` alleen bij met de
   nog werkelijk open risico's; kopieer geen implementatiegeschiedenis.
3. Voeg een public-surface/absence gate toe die oude modulepaden en namen
   verbiedt.
4. Verwijder oude tests in plaats van ze als compatibilitytests te behouden.
5. Run de volledige debug-, native-, parity-, heap- en profiler-validatie.

## Validatiecommando's

```sh
npm run build:product:node-headless-tooling -- --debug --force
npm run build:toolchain:bios -- --debug --force
for c in \
	2025 cartlib_test cartridge_conformance cpu_soak emptycart fade_probe \
	hot_resume_test monitor_fault_probe nemesis_s pietious renderhwtest \
	system_print_test vblanktest; do
	npm run build:toolchain:cart -- "$c" --debug --force
done

npm run headless:test -- 2025 tests/carts/2025/2025_combat_intro_skip_assert.lua
npm run headless:test -- cartlib_test tests/carts/cartlib_test/gte_plus_runtime_assert.lua
npm run headless:test -- nemesis_s tests/carts/nemesis_s/nemesis_s_stage_boot_assert.lua
npm run headless:test -- pietious tests/carts/pietious/pietious_enter_world_assert.lua
npm run headless:test -- cartlib_test tests/carts/cartlib_test/cartlib_schedule_runtime_assert.lua
npm run headless:test -- cartlib_test tests/carts/cartlib_test/world_index_runtime_assert.lua
npm run headless:test -- cartlib_test tests/carts/cartlib_test/presentation_runtime_assert.lua
npm run headless:test -- cartlib_test tests/carts/cartlib_test/imgdec_binding_runtime_assert.lua
npm run headless:test -- cartlib_test tests/carts/cartlib_test/image_uv_runtime_assert.lua
npm run headless:test -- cartlib_test tests/carts/cartlib_test/visual_projection_runtime_assert.lua
npm run headless:test -- renderhwtest tests/carts/renderhwtest/renderhwtest_affine_boot_assert.lua
npm run headless:test -- vblanktest tests/carts/vblanktest/vblanktest_irq_assert.lua
npm run ide:test -- cartlib_test tests/ide/cartlib_steady_state_heap.idetest.js

set -o pipefail
npm run headless:tooling -- --input-timeline tests/carts/2025/2025_demo.json 2025
node tests/carts/2025/analyze_2025_headless.mjs tests/carts/2025/screenshots
npm run headless:tooling -- --input-timeline tests/carts/nemesis_s/nemesis_s_demo.json nemesis_s 2>&1 | tee /tmp/nemesis_s_headless.log
node tests/carts/nemesis_s/analyze_nemesis_s_headless.mjs /tmp/nemesis_s_headless.log
node tests/carts/nemesis_s/analyze_nemesis_s_frames.mjs tests/carts/nemesis_s/screenshots
npm run test:pietious-scanout-headless
npm run test:cartridge-conformance
npm run test:hot-resume
npm run test:system-print-headless
npm run test:quick-menu-headless
npm run ide:test -- monitor_fault_probe tests/ide/monitor_fault_probe.idetest.js
npm run headless:tooling -- --input-timeline tests/carts/fade_probe/fade_probe_demo.json fade_probe
```

Voeg de nieuwe schedule/world/presentation/IMGDEC/UV-probes aan deze fase toe;
ze mogen niet alleen TypeScript-source inspecteren. De nieuwe 2025- en Nemesis-
frameanalyzers toetsen betekenisvolle niet-blanke scene-/sprite-/transitie-
kenmerken; zij vergelijken niet alleen twee renderbackends met elkaar.

### Native en render-parity

```sh
npm run build:product:node-headless-tooling -- --force
npm run build:product:libretro-wsl -- --force
npm run build:libretro-host
npm run build:toolchain:bios -- --force
for c in 2025 cartlib_test nemesis_s pietious; do
	npm run build:toolchain:cart -- "$c" --force
	node scripts/render/pixel_parity.mjs "$c"
done
npm run test:render-parity

# test:bare-metal-frame-scan bouwt zelf niets en gebruikt debug tooling.
npm run build:product:node-headless-tooling -- --debug --force
npm run build:toolchain:bios -- --debug --force
npm run build:toolchain:cart -- bare_metal_cart --debug --force
npm run test:bare-metal-frame-scan
```

`pixel_parity.mjs` bewijst hier alleen dat TS software, C++ software en C++
GLES2 hetzelfde beeld leveren; identieke blanke of anderszins verkeerde frames
kunnen nog steeds gelijk zijn. De 2025-/Nemesis-/Pietious-/quick-menuanalyzers
leveren het semantische beeldbewijs. `bare_metal_cart` en `renderhwtest` zijn de
onafhankelijke capabilitygates die bewijzen dat de high-level migratie raw GX
niet heeft ingeperkt.

De generated-module-export-/pathtests bewijzen bovendien dat de oude modulepaden
niet meer door een cart gedefinieerd of via een forwarding stub geïmporteerd
kunnen worden en dat alleen de twee nieuwe owner-private paths gereserveerd zijn.

## Valkuilen die dit plan expliciet verbiedt

- alleen `run_phase` naar `schedule.run_phase` verplaatsen;
- iteratorstate poolen terwijl de juiste owner-owned index ontbreekt;
- een queryview toevoegen die iedere frame alsnog World opzoekt;
- registry behouden 'voor hot resume'; FSM/BT bezitten hun eigen instances;
- `find_by_tag` sneller maken maar de onnodige API laten bestaan;
- een `Game`, `RuntimeHost` of `CartlibFacade` boven de cart-loop zetten;
- automatisch single/double kiezen via `framebuffer_count` in iedere frame;
- Presentation displaymodus of VBlank laten verbergen;
- `imgid` vervangen door een GPU-/VRAM-handle in normale components;
- raw UV/GP0 ontoegankelijk maken om het standaardpad mooier te maken;
- wachten op IMGDEC, blank renderen, binding terugrollen of een ready-fallback
  toevoegen;
- cartlibcode naar BIOS verhuizen omdat zij hardware programmeert;
- filename-`@atlas` blijven accepteren naast een nieuwe manifestvorm;
- oude modules als aliases achterlaten om tests of carts geleidelijk te
  migreren;
- alleen build/typecheck rapporteren als bewijs van correcte runtime of
  performance.
