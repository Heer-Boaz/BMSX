# BIOS runtime compiler example: finite execution evidence

2026-10-18; baseline `5b264d38a`, master. Current software authority. No
architecture manuscript or historical PDF used. No runtime/compiler/BIOS,
policy, publisher, stylesheet, schema or shared-harness edits.

## Program and source grounding

Actual complete ordinary cartridge: 23-line numeric-BSS/guest-Table
results module and 137-line `module<entry>` program. Generated syntax
uses installed factories and symbol keys, not local ABI/word encoders. No
entry assertions, validation/fallback or BIOS rebinding. Fifth-argument custom
scope is a self-owned Table descriptor with read/write callbacks, not a forged
firmware/debug-frame descriptor. Metadata admission/order and callback calls:
`machine/bios/compiler/semantic.lua:151-187,267-287`;
`machine/bios/compiler/compiler.lua:76-97,420-442,950-974,1881-1895`.

Official Lua [base-library load organization](https://github.com/lua/lua/blob/master/lbaselib.c)
was inspected on GitHub before implementation, for signature/results/error
presentation only. Stock Lua grammar, reader callbacks, binary loaders and
other semantics were not BMSX facts or author inputs.

## Finite authorship correction and earlier artifact

The first ordinary build rejected one-off call-result caches `tree` and
`symbol_tree`. Authored program now passes factory chunks directly to
`compile_syntax`; no lint suppression, fake use, helper or compiler change.
Preserved first log: `/tmp/bmsx-bios-loader-example-build-01.log`. No execution
from this rejected build is claimed.

The earlier valid 12-diagnostic program/artifact `50822af2f4bf383825b29a20a3e097ae1817aaebf394959c3ee4b2f61b0b8d37`
predates the fifth-argument self-owned scope addition. Its logs without `-final`
are historical, not current-source proof. The final unchanged-quality build,
38-assertion suite and independent 13-diagnostic ordinary execution all exit 0.

## Final source/artifact identity

Published build artifact: `1d94a471f0a5adf6a98c9fd84a6012b60dc16f0d52f19c3812b97a939f6e42b8`.

```text
ef911e554858b176aaec2e8042ae253ec5ede8fc550a191e4d45a9ad5ba3aa1f  carts/bios_loader_manual/entry.lua
53bb04c9d407a29c64ac99f4615490647813d0f76a537b9ae07d2aaa581a64c5  carts/bios_loader_manual/results.lua
fc0a148866536d61073954a669def42731bc90bfc5395620d10a9c07a5aadc5e  carts/bios_loader_manual/res/manifest/manifest.rommanifest
17397dc75d72af1d4cc97def81c9c94a8fe52adf1947a0fc6d34beac38151804  carts/bios_loader_manual/README.md
5807d7e94b2aab2ae0ae0e9021fcc364398d9099de15f23b75675d8319dad6b8  tests/carts/bios_loader_manual/bios_loader_manual_assert.lua
120ac0aa42b4303ebefb206a909c662e4c0c9bbdfd9e4663233d35ef70473ea8  tests/carts/bios_loader_manual/ordinary_timeline.json
195fe4e134f0b63a17c1eff1f699b674226f1ce410371aa14f99a1b17046398d  dist/bios_loader_manual.debug.rom
01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664  dist/system/bmsx-bios.debug.rom
a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470  dist/host_headless_tooling.debug.js
```

## Current commands and actual finite results

Tooling was freshly built earlier this turn and existing emptycart base unit
case passed: `/tmp/bmsx-bios-loader-baseline-{tooling,build,guest}.log` and
`/tmp/bmsx-bios-loader-baseline-evidence.md`. That base case is not this ordinary
cartridge's execution proof.

### Unchanged-quality build — exit 0

```sh
npm run validate:toolchain:cart -- bios_loader_manual --debug
```

```text
npm notice run bmsx-workspace@1.0.0 validate:toolchain:cart
npm notice run npx tsx scripts/rompacker/rompacker.ts --mode rompack --force -romname bios_loader_manual --debug
npm notice run bmsx-workspace@1.0.0 npx
npm notice run 'tsx' scripts/rompacker/rompacker.ts --mode rompack --force -romname bios_loader_manual --debug
╔═════════════════════════════════════════════════════════════════════════════╗
║                          BMSX BUILDER by Boaz©®℗™                           ║
╚═════════════════════════════════════════════════════════════════════════════╝
› Target         · bios_loader_manual
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
Build published and exported (2.3s)
› Artifact       · 1d94a471f0a5adf6a98c9fd84a6012b60dc16f0d52f19c3812b97a939f6e42b8
```

### Retained integration case — exit 0

```sh
npm run headless:test -- bios_loader_manual tests/carts/bios_loader_manual/bios_loader_manual_assert.lua
```

```text
npm notice run bmsx-workspace@1.0.0 headless:test
npm notice run sh -c 'rom="$1"; test="$2"; if [ -z "$rom" ] || [ -z "$test" ]; then echo "Usage: npm run headless:test -- <gameromname> <test-file>"; exit 1; fi; shift 2; node dist/host_headless_tooling.debug.js --system-rom dist/system/bmsx-bios.debug.rom --test "$test" "$rom" "$@"' -- bios_loader_manual tests/carts/bios_loader_manual/bios_loader_manual_assert.lua
[bootrom:headless] Loading ROM: /home/boaz/BMSX/dist/bios_loader_manual.debug.rom
[bootrom:headless] Loading system ROM: /home/boaz/BMSX/dist/system/bmsx-bios.debug.rom
[test] runtime_compilation: passed
```

### Separate ordinary timeline — exit 0

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_loader_manual/ordinary_timeline.json bios_loader_manual
```

```text
npm notice run bmsx-workspace@1.0.0 headless:tooling
npm notice run node dist/host_headless_tooling.debug.js --system-rom dist/system/bmsx-bios.debug.rom --debug --input-timeline tests/carts/bios_loader_manual/ordinary_timeline.json bios_loader_manual
[bootrom:headless] Loading ROM: /home/boaz/BMSX/dist/bios_loader_manual.debug.rom
[bootrom:headless] Loading system ROM: /home/boaz/BMSX/dist/system/bmsx-bios.debug.rom
[bootrom:headless] Starting game (debug=true, frameIntervalMs=20.096000200638468).
[bootrom:headless] TTL set to 60000ms.
[bootrom:headless:input] [capture] screenshots -> /home/boaz/BMSX/tests/carts/bios_loader_manual/screenshots
[bootrom:headless:input] [timeline:ordinary_timeline.json] arming presentation-frame timeline
BMSX SYSTEM ROM
CPU       BLUA32
VIDEO     320X240 50HZ
CARTRIDGE READY
Load environment	0	3	8	8
Load external scope	12	14	14	1000
Load globals	7	9	9
Load child	15	25
Load modes	42	nil	attempt to load a text chunk (mode is 'b')
Load false mode	nil	Attempted to get length of an unsupported value.
Load false environment	nil	false	Attempted to index field on a non-table value.
Load source error	nil	[load:manual.invalid] unexpected character at 1:8
Load nil results	1	nil	1	nil
Load result expansion	3	1	3	nil	9
Load syntax factory	42
Load generated symbol	7
Load syntax error	false	[load:manual.invalid_syntax] break outside loop at 1:1
[bootrom:headless] Input timeline completed.
```

The integration case waits up to 64 test ticks for completion, then makes 38
explicit assertions. Its fresh derived TS image is distinct from ordinary
playback. The timeline offset 8 terminates ordinary playback; it is not an
assertion or latency guarantee. All 13 `Load ...` lines are present with raw
tab separators, followed by timeline completion. No measured whole-call cycles,
forced GC/reclamation, exhaustion/cache reuse, snapshot/reset, native parity,
all-input/grammar/optimizer or SDK/whole-console completeness is claimed.
The dynamic unary-& lowering hole and common Table-length dependency remain
open and no repair is inferred. Actual-source, public-reader and PDF checks
are separate review passes; successful execution is not their approval.
