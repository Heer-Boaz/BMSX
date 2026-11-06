# Stadsburg authoring

The editable level lives in `carts/nemesis_s/authoring`. The builders write directly
to `carts/nemesis_s/res`; the cartridge build consumes those checked-in resources.
Run these commands from the repository root:

```sh
python -m pip install -r scripts/nemesis_s/stadsburg/requirements.txt
python scripts/nemesis_s/stadsburg/build_level.py
npm run build:toolchain:cart -- nemesis_s --debug
```

This produces `dist/nemesis_s.debug.rom` and its matching BIOS. After pulling
checked-in resource changes, only the cartridge build is needed. In Studio,
choose **Build cartridge → nemesis_s → Debug**, wait for completion, then use
that job's **Open published build in new Studio window** action. Building does
not replace the cartridge already running in another window. Reboot applies
Lua source edits to that installed cartridge; changed PNG and YAML resources
require opening the newly built cartridge. A Studio URL with `?build=…` keeps
selecting that exact build.

`level.yaml` places quays, buildings, street details, water and enemy encounters.
`prefabs.yaml` assembles the named objects from the stable drawing IDs in
`tileset.yaml`. Its image paths point either to the cartridge's active tiles or
to `authoring/terreintegels`, which retains drawings not currently used by the map.
The build packs the active drawings into the numeric stage map and compiles the
water, tree, roof-snow and winch animations. The native terrain roles remain the
source of collision state.

Loaded hoists have three health points and take damage from the player's
weapons. Their animation clips own both the visible load and its solid cells;
destroying a load clears both, while keeping the chain and support. The load
stays destroyed through later poses and is restored on a stage or checkpoint
reset. Stationary loaded hoists use the same behavior.

Tree rest drawings, eight native wind cels and fixed trunk/branch masks live in
`authoring/stad6m`; `authoring/stadsgroen/registratie.json` names those sources.
`bake_stadsgroen.py` validates their palette, fixed core and foot, and previews
the exact cels. `greenery_steps` sets their timing. The trunk and main branches
stay fixed while the secondary twig tips follow and settle after a gust.

After editing source art or registration, validate the greenery and import all
static town drawings before building the level:

```sh
python scripts/nemesis_s/stadsburg/bake_stadsgroen.py
python scripts/nemesis_s/stadsburg/bake_stad.py
python scripts/nemesis_s/stadsburg/build_level.py
```

The `source_provenance` record and `houtbron_r24` rasters retain the older source
drawings. Current trees use dark-red wood (`#a02020`), white snow and black;
shrubs use dark green. Native drawings use at most two inks per aligned 8×1 row.
The current facades, traffic, wharf modules, greenery and street furniture are
editable native PNG sources in `authoring/stad6m`. Earlier drawings remain in
`authoring/stadsleven` as provenance and for the small background vehicles.
Their `native` entries in
`authoring/stad/registratie.json` import those exact pixels through `bake_stad.py`,
without resampling or quantization. The baker checks the palette and 8×1 ink
limit and reuses identical tiles from the existing catalog. `stage_symbol` and
per-tile-row `stage_symbols` preserve native collision roles: distant contours
and vehicles, tree silhouettes, lamp shafts and water reflections remain open.

Foreground architecture combines historic houses with newer harbor buildings.
The narrow canal house has a neck gable and stacked domestic bays; the corniced
front has tall windows and a distinct shop floor. The low house has one storey
under a snow-covered hip roof. The warehouse separates a gabled loading wing
from the adjoining gun-support hall, with shuttered loft openings and braced
timber loading doors. Workshop glazing, a rolling shutter, boiler-room intake
and paired service doors distinguish the two small harbor buildings. The
bridgewatch house has a flat projecting cap, an observation bay with corner
returns and a recessed entrance. Window surrounds, eave shadows, material
joins and restrained masonry clusters are drawn at native resolution.

All sixteen active foreground building sources share a night-lighting palette:
light blue (`#4060e0`) marks the moonlit main wall planes, while dark blue
(`#2020e0`) remains on roof planes, recessed service bays, wall returns and
shadowed joints. Stone, snow, glazing, warm windows, timber doors and shop
canopies keep their separate inks. Domestic windows use grouped glass panes,
a stone head, a dark upper reveal and a projecting sill with a short cast
shadow. Workshop glazing uses connected reflections inside one dark opening;
the storefronts sit behind their canopies with a separate entrance recess.
Warm domestic light belongs to an inhabited room or a grouped floor; quiet
storeys retain dark-blue glass inside the same frames, reveals and sills.
Shop light is concentrated below the canopy: the cafe has a broad lit frontage,
while the bakery has two display bays in dark-red painted timber, a grey sill
and a recessed entrance on the right. Its left pane stays cool and the right
pane forms one warm display. The grocer has a recessed entrance on the left
and one broad warm display on the right, held by a connected green fascia,
uprights and paneled base. These distinct storefront layouts share the same
native roof and ground contacts; their door openings remain six pixels high.
The bicycle shop keeps its upper floors quiet. Large cool workshop and bridgewatch glazing,
timber loading doors and the dark alley gate give the street distinct pauses
between these warm groups.
Quay and wharf walls use a dark-red body with connected mortar courses and
restrained red edge light. At the native world scale, these groups suggest
masonry rather than drawing an oversized brick in every tile. The native
`quay_masonry_1088x32` and `ceiling_masonry_512x32` sources compose different
course shapes and unequal quiet intervals across a whole wall region. Their
widths cover the longest uninterrupted quay and overhead wall respectively.
The quay field sits above the wet foot at tile row 20; its bottom eight pixels
form the shallow quay, and its courses keep the same world height through
joined street steps. Ceiling courses start at row zero and retain the same
world phase through overlapping depths. Neither field cycles vertically.
The snow/coping and existing blue wet foot define the upper and lower edges.
Two separate 24×32 native bridge panels compose the left and right landheads.
Their `prefab_patch` registrations import the panels into the named prefab
at a tile coordinate, retaining its other entries, including null cells and
the explicit sky-clearing tile. This keeps later source edits connected to
the assembled bridge through the ordinary town baker.
Dedicated bridge tiles form a constructed arch ring with a
recessed crown block and short joints that stop before the aperture. Keep
mortar cuts inside the solid ring and retain its continuous inner contour.
Bright red belongs to its upper-left face and selected outer edges; the right
return and lower springers stay dark.
The same dark-red contact runs through the native building plinths, lamps,
static tree socket and wharf modules. Cellar portals and stair railings keep
their own contours and inks instead of inheriting the wall texture.
Snow has a white upper surface and a grey lower plane where the roof offers
enough pixels. Broad wall planes stay quiet; shadows belong to cornices,
sills, returns and structural joins rather than scattered surface marks.
Native source contours, occupied terrain cells, ground-contact positions and
rooftop support lines stay fixed when these interior material rows are drawn.
The distant architecture stays black and dark blue, with small shadows beneath
cornices and inside entrances; broad far-wall masses and window axes remain
readable. The existing two-ink-per-8×1 rule applies to both layers.

Architectural references include [De Steeman on the Bloemgracht](https://www.hendrickdekeyser.nl/de-huizen/de-steeman),
[Herenstraat 41](https://stadsherstel.nl/monumenten/herenstraat-41/),
[the bakery storefront at Reguliersgracht 67](https://stadsherstel.nl/monumenten/reguliersgracht-67/),
[the timber shopfront at Reestraat 15](https://stadsherstel.nl/monumenten/reestraat-15/),
[Pakhuis De Appel](https://stadsherstel.nl/monumenten/pakhuis-de-appel/)
and [Piet Kramer's Beltbrug bridgewatch house](https://arcam.nl/architectuur-gids/brugwachtershuisje-beltbrug/).
The drawings adapt their architectural principles to the game palette and
pixel scale; they are original stylizations, not resized photographs or
literal replicas. Native occupied cells, ground contacts and rooftop weapon
support lines retain their established positions.

The town's main scale is 8/3 pixels per metre, using the unchanged 16×10-pixel
Kartonion as a fictional six-metre vehicle. Human-scale foreground art has been
redrawn at approximately two thirds of its former size. Foreground cars draw at
12×6 pixels, with two-row glazing and separate two-pixel wheel contacts; parked
front-view trucks draw at 7×11 pixels. The station canopy
spans 32 pixels and leaves 12 pixels clear beneath it; its door opening is six
pixels high. The separate car and trucks stand on the same ground line.
Ordinary house doors are six pixels high, storeys about eight to nine pixels,
and handrails three pixels above their walking surface. A one-pixel stair rise
is still the smallest available step, so stairs are a readable approximation.
Wharf stairs descend 16 pixels to their lower walking surface. Measure these
details against visible ground, since the bottom prefab tile can contain quay
masonry or a submerged foot. Building, water and tree-root anchors are retained
when their canvases shrink. The native S/R markers identify the centre and
foot line of each rooftop weapon. Roof weapons retain their original 32×24
artwork and body colliders, centred on that point with a centred laser or smoke
outlet. Their original 24×16 wreck keeps the same foot line. Ceiling cannons
also retain their 32×24 geometry and 24×16 wreck. The terrain spans,
industrial bridges/winches and other combat sprites retain their established
dimensions. The side camera, long approach and departure, and broad open-water
sections stay fixed.

Light, warm, cyan or green accents distinguish foreground objects. The smaller
7×4-pixel cars use the existing lighter blue to remain distinct from the dark
blue distant house contours. Miniature bicycles retain their subdued blue silhouettes.
The authoring groups describe that visual depth within the fixed side view.

The five winter backdrops are editable native PNGs in `authoring/achtergrond`:
the town (2384×160), warehouse wharf (824×160), inner harbor (632×160),
lock wharf (512×160) and outer harbor (984×160). Each covers its own passage
without repeating the whole scene; the city clock tower occurs once.
`level.yaml` owns their spans, source offsets, scene joins and the
world spans that expose the full starfield. They scroll on the same character
grid as the terrain. `night_sky_height` keeps four existing blue stars in the
top 40 pixels visible over the town, above the distant skyline. The open night
sky leaves the flying corridor clear of cloud patterns.
The opposite bank uses individually painted whole buildings from
`achtergrond/architectuur.png`. `ontwerp.yaml` names their atlas rectangles and
places them into waterfront blocks. Roofs, gables, bearing corners and window
axes belong to each drawing; changing a width or selecting a generic roof
cannot distort their proportions. Ordinary fronts are 13–17 pixels wide, with
five-pixel storeys, 2×2 dark windows and three-pixel domestic doors; warehouse
loading doors are larger. Foreground storeys remain
eight to nine pixels high. Far buildings share the ground line at y132, above
the usual near-street contact at y146. There is no image resampling.
The references recorded in `ontwerp.yaml` include Rapenburg 13 for the stepped
gable, the Grachtenmuseum's facade types, De Twee Harde Bollen for stacked
loading openings and the Montelbaanstoren for the harbor clock-tower structure.
These are original stylized buildings, not miniature replicas of the monuments.
Stepped, neck, bell and spout gables, corniced fronts and industrial sheds have
distinct silhouettes. The clock tower has a masonry base and two supported
open lanterns. Long blocks share quay footings, interrupted by narrow alleys
and deliberate harbor inlets. Each passage leaves clear silhouettes around
the near roofs, so a distant roof does not become an apparent extra storey.
Scene joins preserve whole buildings. There is no whole-surface stipple or
cloud layer.
These five sources own the far architecture and shoreline. The earlier
separate distant-house and quay placements are no longer stamped into the
foreground map. Removing the old quay overlay exposes the original water
modules beneath it; their source pixels, dimensions and animation timing stay
unchanged.
The mill is framed by an intentional black arena; the open approach and
departure retain the full starfield.

`build_level.py` calls `bake_achtergrond.py` to compile the backdrop and compose
its exterior pixels around the existing foreground. Enclosed black windows,
doors and masonry remain opaque. A one-pixel black separation around fixed
foreground ink keeps blue facades on different planes from joining. Moving
animation cells are excluded from that fixed edge. Each resulting 8×1 row keeps
at most two inks; existing foreground ink takes priority. Animation cels use the same
composition while their native patterns continue to own collision and cargo
damage. Destroyed cargo exposes the background; resetting restores its art.
Native animation patterns are read from the loaded catalog and retained in
cartridge resources even when a pattern is not visible in the rest frame.
Water sources, terrain roles, encounter placements and the six-metre scale are
independent of these visual compositions.
The generated drawings are checked in as 256×256 pattern banks; the cartridge
shares their 8×8 views across foreground, backdrop, animation and new games.

Run `python scripts/nemesis_s/stadsburg/draw_achtergrond.py` after deliberately
editing the architecture atlas or its block composition. It stamps the complete
drawings at their exact native sizes into the five editable source PNGs.
Normal level builds consume those five PNGs directly, including any subsequent
hand edits. The composed level and the separate backdrop are available under
`previews/level_achtergrond_native.png` and `previews/achtergrond_native.png`.

The Python dependencies are pinned for reproducible resource bytes.
Preview images and check reports are generated locally and ignored by Git.
