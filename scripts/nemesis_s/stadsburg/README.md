# Stadsburg authoring

The editable level lives in `carts/nemesis_s/authoring`. The builders write directly
to `carts/nemesis_s/res`; the cartridge build consumes those checked-in resources.
Run these commands from the repository root:

```sh
python -m pip install -r scripts/nemesis_s/stadsburg/requirements.txt
python scripts/nemesis_s/stadsburg/build_level.py
npm run build:toolchain:cart -- nemesis_s
```

`level.yaml` places quays, buildings, street details, water and enemy encounters.
`prefabs.yaml` assembles the named objects from the stable drawing IDs in
`tileset.yaml`. Its image paths point either to the cartridge's active tiles or
to `authoring/terreintegels`, which retains drawings not currently used by the map.
The build packs the active drawings into the numeric stage map and compiles the
water, tree, roof-snow and winch animations. The native terrain roles remain the
source of collision state.

Tree branch pivots, masks and eight poses are authored in `bake_stadsgroen.py`;
`greenery_steps` sets their timing. Run `build_level.py` after changing those poses
or their placement. The trunk and main branches stay fixed while the selected
secondary branches rotate around their forks.

To resample the greenery or street source sheets after editing their source art
and registration, run the corresponding baker before building the level:

```sh
python scripts/nemesis_s/stadsburg/bake_stadsgroen.py
python scripts/nemesis_s/stadsburg/bake_stad.py
python scripts/nemesis_s/stadsburg/build_level.py
```

The greenery registration and `houtbron_r24` rasters retain the source drawings
used for the exact gray-to-dark-red wood conversion. Source hashes and palette
checks guard that conversion. Native drawings use at most two inks per 8×1 row.
The Python dependencies are pinned to the versions used to reproduce the R27
resource bytes. Preview images, pattern-bank exports and check reports are
generated locally and ignored by Git.
