# BIOS OS ordinary example: finite execution evidence

Date: 2026-10-18. Working directory: /home/boaz/BMSX.

HEAD: b23de821f2d531ea16e909951f281dae53ee67de

Branch: master

## Scope and ownership

Only six new source files under carts/bios_os_manual/ and tests/carts/bios_os_manual/ were authored by this agent. No existing repository files, compiler/runtime/harness, policy, architecture document or historical PDF were edited. No commit or push. Generated build artifacts are not source edits.

The numeric result storage is typed BSS. Mutable observations are ordinary retained guest Tables and strings in an ordinary results module; they are not encoded in words. The entry has no assertions, checks/fallbacks, calendar/time encoders or facade helpers. All 4 actual functions are called. No leading-! or Table-valued formats. Reference organization prerequisite was fulfilled by the root agent using official Lua loslib.c and CPython time documentation on GitHub; no foreign time behavior was imported.

## Bounded authoring correction

The first build rejected module<const> results because observations={} is not a compile-time constant/static-symbol export. Corrected the authored module declaration (ordinary results module); no compiler/runtime change or policy suppression. The preserved first-attempt log is /tmp/bmsx-bios-os-example-build-01.log.

## Print-layout-only follow-up and historical evidence

The shared publisher exposed horizontal overflow in the last literal entry chunk. Only the two requested argument lines were reflowed: os.difftime after its first argument and the final print arguments onto shorter lines. No executable meaning, settings, policy, CSS or publisher source changed. The current entry is 110 lines. The ordinary-output block in README was refreshed against the new replay (same diagnostic text).

The pre-reflow successful source/artifact evidence is historical, not proof for the current source bytes. It remains at /tmp/bmsx-bios-os-example-evidence-before-print-reflow.md with corresponding build/retained/ordinary logs named -before-print-reflow.log. Its artifact was 5951b13a8aca21a57d416d5e2ed7388917e39da7a2443c6b1045832e7e9cc9f8, its entry SHA-256 was 172c901757aa660114c14cbf242446d82a294e83cf7589082625304fc1843ed7 and its ROM SHA-256 was 582382d4b9b3d2335d1dec57cfda88d2cd50950765d550cf03dbbd2d9a141d42. New build, retained 74 and separate ordinary replay all completed exit 0 after the final reflow. Current hashes/artifact/logs follow.

## Final source and runtime-artifact SHA-256

```text
3da3013b728df086dfe5209527c8cb61e53b2ef8a858f8c5db10bf4a55d55aa2  carts/bios_os_manual/entry.lua
bf6aff8d4c7b73723b8ee6ac1256bf549e702d23c75fb7f7cf60bb524d2a32bb  carts/bios_os_manual/results.lua
e60eb957e9c9ff1356a800b057537da2652e68a4021d36d32423ac61ba0f7d83  carts/bios_os_manual/res/manifest/manifest.rommanifest
f571615fcd3dbbda6dbac32151ed5e4edddc7f98af47e83153b745fc8f362fd1  carts/bios_os_manual/README.md
8b27f91e7f94b726c1c3702a08d38f6ee0e1bfedeb11234900e0d61a4814c4ce  tests/carts/bios_os_manual/bios_os_manual_assert.lua
49cebe082095c99bc2a9a17e97044a2007e07414b1c90b9b4be408b80d8f4e5a  tests/carts/bios_os_manual/ordinary_timeline.json
53583493f125f8fc1db0ba02badc306c2c8092203f9da846f8692cf02bd35246  dist/bios_os_manual.debug.rom
01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664  dist/system/bmsx-bios.debug.rom
a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470  dist/host_headless_tooling.debug.js
```

Final published cart artifact ID: 241d79997e6a5c300035e81636cd50bb6d0c8fbaee418c7b3a24fec6efbe9207.

## Build tooling (exit 0)

Command: npm run build:product:node-headless-tooling -- --debug

```text
npm notice run bmsx-workspace@1.0.0 build:product:node-headless-tooling
npm notice run npm run build:product -- --target node-headless-tooling --debug
npm notice run bmsx-workspace@1.0.0 build:product
npm notice run npm run build:toolchain:host-system-atlas && npx tsx scripts/products/product_builder.ts --target node-headless-tooling --debug
npm notice run bmsx-workspace@1.0.0 build:toolchain:host-system-atlas
npm notice run npx tsx scripts/render/generate_host_system_atlas.ts
npm notice run bmsx-workspace@1.0.0 npx
npm notice run 'tsx' scripts/render/generate_host_system_atlas.ts
Host system atlas -> machine/{ts,cpp}/render/host_overlay/atlas.generated (up-to-date)
npm notice run bmsx-workspace@1.0.0 npx
npm notice run 'tsx' scripts/products/product_builder.ts --target node-headless-tooling --debug
╔═════════════════════════════════════════════════════════════════════════════╗
║                      BMSX PRODUCT BUILDER by Boaz©®℗™                       ║
╚═════════════════════════════════════════════════════════════════════════════╝

◆ Product
› Target         · node-headless-tooling
› Debug          · enabled
✔ Node headless tooling → dist/host_headless_tooling.debug.js
✔ Product build complete → node-headless-tooling

```

## Unchanged-quality final cart build (exit 0)

Command: npm run validate:toolchain:cart -- bios_os_manual --debug

No quality settings, lint suppressions, compiler options or configuration files were changed. This command ran the ordinary system/cart compile/lint stages.

```text
npm notice run bmsx-workspace@1.0.0 validate:toolchain:cart
npm notice run npx tsx scripts/rompacker/rompacker.ts --mode rompack --force -romname bios_os_manual --debug
npm notice run bmsx-workspace@1.0.0 npx
npm notice run 'tsx' scripts/rompacker/rompacker.ts --mode rompack --force -romname bios_os_manual --debug
╔═════════════════════════════════════════════════════════════════════════════╗
║                          BMSX BUILDER by Boaz©®℗™                           ║
╚═════════════════════════════════════════════════════════════════════════════╝
› Target         · bios_os_manual
› Recipe         · debug -O3
[1] Capture inputs
[2] Lint system
[3] Scan system resources
[4] Load system resources
[5] Build system textures
[6] Compile system audio events
[7] Build system assets
[8] Compile system Lua
[9] Write system ROM
[10] Scan resources
[11] Load resources
[12] Generate GX textures
[13] Compile audio events
[14] Generate ROM assets
[15] Compile cartridge Lua
[16] Lint cart + shared Lua
[17] Write cartridge ROM
[18] Publish artifact
[19] Export artifact
Build published and exported (2.4s)
› Artifact       · 241d79997e6a5c300035e81636cd50bb6d0c8fbaee418c7b3a24fec6efbe9207
```

## Actual retained TS suite (exit 0)

Command: npm run headless:test -- bios_os_manual tests/carts/bios_os_manual/bios_os_manual_assert.lua

One named integration case, time_and_calendar_observations, passed. 74 explicit assertions follow a bounded completion wait (8 ticks). This fresh derived image is not the byte-identical ordinary ROM, and linked addresses may differ.

```text
npm notice run bmsx-workspace@1.0.0 headless:test
npm notice run sh -c 'rom="$1"; test="$2"; if [ -z "$rom" ] || [ -z "$test" ]; then echo "Usage: npm run headless:test -- <gameromname> <test-file>"; exit 1; fi; shift 2; node dist/host_headless_tooling.debug.js --system-rom dist/system/bmsx-bios.debug.rom --test "$test" "$rom" "$@"' -- bios_os_manual tests/carts/bios_os_manual/bios_os_manual_assert.lua
[bootrom:headless] Loading ROM: /home/boaz/BMSX/dist/bios_os_manual.debug.rom
[bootrom:headless] Loading system ROM: /home/boaz/BMSX/dist/system/bmsx-bios.debug.rom
[test] time_and_calendar_observations: passed
```

## Separate ordinary TS timeline execution (exit 0)

Command: npm run headless:tooling -- --debug --input-timeline tests/carts/bios_os_manual/ordinary_timeline.json bios_os_manual

Full ordered execution log follows, including every one of the 26 OS-prefixed diagnostics and the separate C continuation from %n. First two lines are actual sampled observations, not constant expected readings. No sampling equality, monotonicity, RTC, realtime, timezone service or reset-origin claim. Print Number text is rounded.

```text
npm notice run bmsx-workspace@1.0.0 headless:tooling
npm notice run node dist/host_headless_tooling.debug.js --system-rom dist/system/bmsx-bios.debug.rom --debug --input-timeline tests/carts/bios_os_manual/ordinary_timeline.json bios_os_manual
[bootrom:headless] Loading ROM: /home/boaz/BMSX/dist/bios_os_manual.debug.rom
[bootrom:headless] Loading system ROM: /home/boaz/BMSX/dist/system/bmsx-bios.debug.rom
[bootrom:headless] Starting game (debug=true, frameIntervalMs=20.096000200638468).
[bootrom:headless] TTL set to 60000ms.
[bootrom:headless:input] [capture] screenshots -> /home/boaz/BMSX/tests/carts/bios_os_manual/screenshots
[bootrom:headless:input] [timeline:ordinary_timeline.json] arming presentation-frame timeline
BMSX SYSTEM ROM
CPU       BLUA32
VIDEO     320X240 50HZ
CARTRIDGE READY
OS samples	1.036	1	1
OS sampled dates	Thu Jan 01 00:00:01 1970	1970-01-01 00:00:01
OS noon	43200	1970	1	1	12	0	0	5	1	false	kept
OS normalized	1.70917e+09	2024	2	29	1	2	3	5	60	false
OS epoch fields	1970	1	1	0	0	0	5	1	false
OS negative fields	1969	12	31	23	59	59	4	365	false
OS calendar	2021 21 20 | 01 01  1 001
OS names	Fri Friday | Jan January Jan
OS clock fields	13:02:03 | 01 PM | 13:02 | 01:02:03 PM | 13:02:03 | 13:02:03
OS composites	2021-01-01 | 01/01/21 | 01/01/21 | Fri Jan 01 13:02:03 2021
OS weeks	2021 | 2020 20-W53 | 00 00 | 5 5
OS next ISO year	2018-12-31 2019-W01-1
OS zone literals	offset +0000 zone BMSX %
OS separators	A	B
C
OS default format	Thu Jan 01 00:00:00 1970
OS E modifiers	Fri Jan 01 13:02:03 2021 | 20 01/01/21 13:02:03 21 2021
OS O modifiers	01  1 13 01 01 02 03 | 5 00 53 5 00 21
OS missing field	false	field 'year' missing in date table
OS fractional field	false	field 'hour' is not an integer
OS civil range	false	field 'year' is out-of-bound
OS timestamp range	false	time is out-of-bound
OS invalid conversion	false	invalid conversion specifier '%Q'
OS invalid modifier	false	invalid conversion specifier '%Ea'
OS differences	90	-1	9.0072e+15	inf	nan
OS fractional t2	false	os.difftime t2 must be an integer.
OS fractional t1	false	os.difftime t1 must be an integer.
[bootrom:headless] Input timeline completed.
```

## Limits and final hygiene

The timeline selects zero-based presentation offset 4; its completion is not an output assertion or startup/frame/cycle guarantee. The successful retained suite separately checks exact fields, strings, errors and numeric values. No native, full-range civil arithmetic, optimizer/general runtime-parser, performance, reset/persistence, SDK or whole-console acceptance is claimed. CPU7, general Table length/string slicing, BZ01 and LS01 remain OPEN. No runtime boundary blocked this bounded program.

Final git diff --check: exit 0, no output.
