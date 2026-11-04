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

The town's main scale is 8/3 pixels per metre, using the unchanged 16×10-pixel
Kartonion as a fictional six-metre vehicle. Human-scale foreground art has been
redrawn at approximately two thirds of its former size. Foreground cars draw at
13×5 pixels and parked front-view trucks at 7×11 pixels. The station canopy
spans 32 pixels and leaves 12 pixels clear beneath it; its door opening is six
pixels high. The separate car and trucks stand on the same ground line.
Ordinary house doors are six pixels high, storeys about eight to nine pixels,
and handrails three pixels above their walking surface. A one-pixel stair rise
is still the smallest available step, so stairs are a readable approximation.
Wharf stairs descend 16 pixels to their lower walking surface. Measure these
details against visible ground, since the bottom prefab tile can contain quay
masonry or a submerged foot. Building, water and tree-root anchors are retained
when their canvases shrink; rooftop enemy markers follow the new roof supports.
The terrain spans, industrial bridges/winches and combat sprites retain their
established dimensions. The side camera, long approach and departure, and broad
open-water sections stay fixed.

Light, warm, cyan or green accents distinguish foreground objects. The smaller
8×4-pixel cars and miniature bicycles use only subdued blues and black, like the
distant house contours. The authoring groups describe that visual depth within
the fixed side view.
The Python dependencies are pinned for reproducible resource bytes.
Preview images, pattern-bank exports and check reports are
generated locally and ignored by Git.
