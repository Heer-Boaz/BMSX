# Debug ROM source packaging

Debug is an execution-equivalent image with inspection data, not a compiler
checkpoint. ROMs store canonical UTF-8 Lua source exactly once per source asset,
private BLua32 symbols and the guest-readable BIOS diagnostic directory. The
latter reuses those source ranges; generated sources may need their own bytes.
No lexer token stream, AST, occurrence directory or parser cache is packaged.
Release continues to omit authored source/private debug data. Neither mode
instruments the guest or changes compilation optimization settings.

## Reference implementations inspected before implementation

- [Lua `dumpFunction` / `dumpDebug`](https://github.com/lua/lua/blob/master/ldump.c):
  executable prototypes and selected debugger records, not parser trees.
- [Godot parser cache](https://github.com/godotengine/godot/blob/master/modules/gdscript/gdscript_cache.cpp):
  parser/analyzer state has an explicit in-process source owner and lifetime.
  Its [export plugin](https://github.com/godotengine/godot/blob/master/modules/gdscript/register_types.cpp)
  separately chooses the exported script representation. BMSX already executes
  BLua32 instructions, so exporting even a token cache would be redundant here.

The inference for BMSX is an ownership correction, not a new compressed AST
format or an extra mandatory sidecar/network service. Self-contained Studio
editing, Hot Resume, Scenario Lab and BIOS inspection remain available.

## Representation and callsites

| Owner / callsite | TypeScript | C++ / guest | Frequency |
| --- | --- | --- | --- |
| ROM TOC | `program_module` decoded from flags; one source byte range | Same flag in `RomTocEntry`; same physical record | Package admission/tooling encode |
| `generateRomAssets`, `buildScenarioTestSourceAssets` | Captured source bytes and explicit role | No source compiler | Offline build |
| `parseBlua32SourceModules` | Parse canonical program text directly once per compilation | No parser/AST representation | Offline and Scenario compilation |
| `buildTestCartridge` | Reuse parsed program chunks; load selected source-only dependencies once | Native CPU executes resulting bytecode | Explicit isolated test build |
| `collectProgramSources`, `buildLuaSourceAssetChanges` | Existing syntax owners; publish source text and membership, not syntax cache | No Studio policy | Accepted source rebuild |
| `rom_dir.parse_rom`, `list_entries` | Guest code | Same guest code: new entry stride | ROM indexing/listing |
| `rom_dir.record_for_entry` | Guest code | Same guest code: new metadata/collision offsets | First resource lookup; retained records unchanged |
| `entry_matches`, `find_by_token`, `find_in_roms`, `decode_payload`, `decode_meta` | Existing guest directory/data path | Identical path; no additional branches/decoding | Resource lookup/use |
| CPU, renderer, audio | Unchanged instructions/datapaths | Same; no AST decoding | Execution hot paths unchanged |

The old two AST address words are removed. TOC entries are 84 bytes:
flags at 48 (`ROM_TOC_FLAG_PROGRAM_MODULE = 1`), metadata at 52/56,
model texture at 60/64, collision at 68/72, timestamp at 76/80. All other
fields retain their positions. Non-module/source-only records emit a clear bit;
module membership is not inferred from filenames, parse success or a payload's
presence. Producers, TS/native directory codecs and `cartlib/rom_dir.lua` move
together; rebuild firmware, cartridges and hosts. There is no old-format reader.

Parser diagnostics remain Lua source diagnostics, including authored filename
and line/column, rather than binary-cache decoding errors. The unused syntax
codec, compiled-payload API and storage-only tests are deleted.

## Native footprint

The libretro owner already maps the package read-only and does not eagerly
parse Lua or load private symbols. `loadBlua32ToolingImage` is used for fault
reporting, not in the frame loop. Removing parser payloads reduces package size
without adding decompression, a native parser, another ROM copy or larger
hardware windows. It does not by itself establish that a particular game is
playable on physical SNES Mini hardware.

## Measurements and validation

Before/after with the same build settings and assets, apart from the matching
firmware directory constants (decimal bytes):

| Debug package | Before | After | Removed |
| --- | ---: | ---: | ---: |
| BIOS | 13,017,267 | 7,902,059 | 5,115,208 (39.3%) |
| Nemesis | 46,751,012 | 29,817,560 | 16,933,452 (36.2%) |

All 44 BIOS and 223 Nemesis source assets remain. Symbols remain 1,876,391 /
5,145,588 bytes, and BIOS diagnostics remain 1,459,310 / 3,374,050 bytes.
The rest of the decrease is removed AST payload alignment and smaller TOC
records. BIOS's reserved asset partition and machine address-window limits are
not changed. Package offsets may move; this is not a claim that relocatable
cartridge code bytes stay identical at different load addresses.

Seven warmed, isolated Node 22.23.1 samples (two warmups, GC outside each timed
operation) over the original 44 / 190 program modules:

| Source-to-compiler work (median ms) | BIOS | Nemesis |
| --- | ---: | ---: |
| Former build: parse + encode AST + decode AST | 245.30 | 732.09 |
| Former Scenario input: decode AST | 75.61 | 212.42 |
| Canonical source: decode UTF-8 + parse directly | 56.85 | 162.68 |

These are tooling-front-end timings, excluding lowering/linking and other build
stages, not gameplay or physical SNES Mini performance. The baseline is
`4a8da3797`; raw comparisons and samples are in
`/tmp/bmsx-rom-source-review/measurement-isolated.log`.

Validation:

- 206 ROM/build/Scenario tests, including source-only admission, current-source
  isolated execution, O0/O3 executable equivalence and debugger metadata.
- 72 affected Lua/source/edit/probe tests; removed tests exercised only the
  deleted syntax storage format, not retained parser/editing behavior.
- Hot Resume on rebuilt two-slot media: 93 assertions.
- Native C++ tests: 33 pass, including directory encode/decode with both source
  roles and all relocated range fields.
- Nemesis and independent preload TS/C++ replay/history match; host rewind and
  libretro pause/rewind ABI tests pass on the rebuilt media.
- Browser Studio, Node tooling and WSL libretro build; product, script and test
  typechecks; architecture-boundary and mirrored-core audits pass.
- Production SNES Mini Release cross-build passes its ABI audit against the
  imported target rootfs. QEMU/Cortex-A7 additionally admits the debug BIOS and
  Nemesis package and receives 240 software video callbacks. This is a loader/
  libretro smoke check, not a physical-device memory/FPS/playability measurement.

BIOS and Nemesis debug/release artifacts, the Hot Resume fixtures and affected
host products were rebuilt locally. Other previously built carts must also be
rebuilt for the new directory contract; no compatibility shim is shipped.
