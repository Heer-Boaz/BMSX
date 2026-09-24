# Parsed Lua source storage

`toolchain/ts/lua/syntax/serialization.ts` owns the persisted full-fidelity
syntax schema. It uses the existing binary serializer; ROM builders and Studio
do not invent separate encodings. Stored unit/span ordinals are local to one
chunk. Imports create fresh occurrences while retaining shared span identity,
relative positions, statement parts, lexical trivia and diagnostics.

Before changing this representation, the reference was Clang's
[AST record writer](https://github.com/llvm/llvm-project/blob/main/clang/lib/Serialization/ASTWriterStmt.cpp):
schema-owned scalar records rather than serializing a second live object graph.
Our span directory is one numeric array of repeated
`(unit ordinal, relative start, relative end)` triples. The decoder materializes
only the actual `LuaSyntaxSpan` objects, not intermediate per-span records.
Canonical Lua text, tokens, recovery data and debugger coverage are not removed.
There is no compression dependency, legacy-format fallback or larger ROM window.

| Owner / callsite | TypeScript | C++ | Frequency |
| --- | --- | --- | --- |
| `rombuilder.compileLuaChunkBuffer` | Encode parsed source assets | No syntax encoder | ROM build |
| `source_media.buildLuaSourceAssetChanges` | Encode edited program modules | No Studio | Accepted source rebuild |
| `blua32_image_builder.decodeBlua32SourceModules` | Decode source assets for linking | No syntax decoder | Tooling build/load |
| CPU, renderer, BIOS compiler | Do not decode this tooling schema | Same physical bytecode/ROM contract | No hot-path changes |

Changed syntax payloads are rebuilt with their owning toolchain. The BIOS
rebuild check includes `toolchain/ts`; executable cartridges depend on the
rebuilt BIOS import artifact. The hardware's 16 MiB system-ROM limit is unchanged.
An oversized package now reports its actual byte count and excess at the packer
boundary.

## Measured evidence

Using the same 44 current BIOS Lua sources with the old and new codec:

- Parsed source payload: 5,785,150 -> 5,075,077 bytes (710,073 bytes smaller).
- Seven warmed local samples, excluding parsing: median encoding 156.53 ->
  114.82 ms; decoding 62.35 -> 58.27 ms. This is a local tooling measurement,
  not a gameplay performance claim. Raw samples: `/tmp/frame-span-bench.log`.
- Full-fidelity syntax/statement/update tests and the firmware frame suite pass
  together (96 cases before the additional scope-retirement vectors). Existing
  syntax tests compare tokens, diagnostics, retained/shifted snapshots, shared
  identity, deterministic bytes and O0/O3 compiler output.
- The BIOS with the new scope-lifetime firmware builds to 16,084,995 bytes,
  leaving 692,221 bytes under the unchanged window. The same firmware with the
  previous codec exceeded that window; no source/debug feature was disabled.
