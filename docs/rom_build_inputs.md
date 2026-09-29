# Offline ROM producer: captured inputs and build receipts

Implemented 2026-09-29 after the independent review of the
[build design](studio_cart_build_design.md). This is the first producer slice,
not a server build API, immutable artifact store or full-media installer.

## Ownership

`scripts/rompacker/build_inputs.ts` owns resource discovery, file capture and
manifest reading. Each logical file is read once into a retained buffer and
hashed from that buffer. Source text is decoded lazily and retained. File bytes
and source modification metadata come from the same open descriptor. This is a
prepared input set, not an atomic snapshot of independently edited directories.

The CLI supplies discovered program, library and Scenario source files and the
selected BIOS import file. Resource discovery and glTF/GLB dependency discovery
join that same set. The glTF owner parses the document once, captures external
buffers **and images**, including files outside resource roots, and passes the
prepared document to conversion. GLB payloads borrow captured buffer ranges.

Library dependency analysis, linting, compilation, source packaging, resource
decoding and Lua error snippets consume the captured input. They do not reread
newer files or rescan directories. The host-atlas producer and source-cartridge
test producer use the same capture boundary. This does not introduce a second
Studio document/workspace model.

The approach follows esbuild's separation of
[filesystem inputs](https://github.com/evanw/esbuild/blob/main/internal/fs/fs.go)
and [retained parse inputs/options](https://github.com/evanw/esbuild/blob/main/internal/cache/cache.go),
without adopting its whole incremental build engine. The distinction between
recipe/input identity and output digests also follows the
[Bazel Action/ActionResult model](https://github.com/bazelbuild/remote-apis/blob/main/build/bazel/remote/execution/v2/remote_execution.proto),
not a new remote-execution framework.

## Reuse and output ownership

`build_state.ts` owns the receipt for one conventional output:
`<output-directory>/.bmsx/<rom-filename>.build.json`. That ignored directory keeps
producer state out of resource discovery, source control and ordinary exports.

A receipt binds:

- Effective domain, debug and optimizer options, project root and toolchain
  source/package identity, including Node version/platform/architecture.
- Captured content digests, logical filenames, membership and resource roots.
  Lua modification timestamps are included because the produced source records
  emit them for workspace reconciliation, not because mtime establishes freshness.
- Digests of the ROM and all sidecars produced by its finalizer.

Changing options, deleting or renaming an input, changing bytes without advancing
mtime, or changing an external glTF dependency invalidates reuse. Matching inputs
are insufficient if an actual output is missing or its bytes changed. Missing
receipts mean no recorded build; malformed receipts are errors, not silently
accepted or repaired state. `--force` explicitly requests a fresh build.

Freshness is decided before importing the compiler/linter/native converters. A
no-op performs capture/content comparison but no AST compilation, texture/audio
conversion or output rewrite. Raw captured buffers are reused on a real build;
there is no read-discard-reread pass solely for hashing.

The finalizer hashes the bytes as it writes the already known ROM header,
payloads, padding and TOC. It no longer reopens the ROM just to overwrite the
header. Sidecar digests come from their emitted buffers. The receipt is published
only after finalization; no filesystem-mtime ordering trick remains.

**Limit:** conventional BIOS outputs still use separate renames. The receipt
detects a missing or mismatched set on the next invocation, but does not make
those files one atomic publication for concurrent readers. Complete immutable
artifact publication, cancellation/admission receipts, dependency-set selection
and deployment migration remain the next build-domain work. These receipts are
not yet installable artifact identities. No connection/recovery or TS/C++ machine
semantics changed in this slice.

## Observed validation

All CLI checks used private `/tmp` outputs, leaving the user's `dist`, running
server and carts untouched. Recorded byte counts/hashes below describe this
checkout; they are not fixed test contracts.

- `cpu_soak`: `-O0` produced 592500 bytes. Subsequent `-O3` **without force**
  rebuilt to 795092 bytes and matched a separately forced O3 control byte for
  byte. The next identical invocation preserved output bytes and mtime.
- Forced O3 `cpu_soak` and asset-heavy `nemesis_s` matched pre-change ROMs byte
  for byte. `bare_metal_cart` also built with its authored glTF resources.
- A real temporary cart was built after a same-mtime YAML edit, binary-asset
  rename/removal and same-mtime edit of a glTF buffer outside `res`. ROM readback
  confirmed the changed data value, asset membership and mesh vertex; comparison
  did not rely solely on a log saying that the build succeeded.
- An invalid YAML conversion exited unsuccessfully and left the previous ROM
  and its receipt unchanged. BIOS build/no-op/removal of the symbols sidecar
  rebuilt the missing sidecar with the original bytes.
- The preload source-cartridge fixture successfully ran through the migrated
  discovery/compiler/linker/writer path. This is producer evidence, not guest
  execution or IDE installation evidence.
- `npm run test:rompacker`: 187/187 passed. The new tests cover captured-input
  consumption, dependency/membership changes and recipe/output binding; the old
  mtime-only contract suite was removed. Architecture boundary audit: 0 issues.
- Scripts typecheck reports the existing unused `createRuntimeSourceState`
  import in `scripts/bootrom/platforms/node_tooling_entry.ts:72`, also present at
  the starting commit. No new type errors were reported. It is not claimed clean.

### Cost measurements

Wall time and peak RSS from `/usr/bin/time`, same local checkout, debug O3 CLI:

| Cart / invocation | Before | After |
| --- | --- | --- |
| cpu_soak forced build | 1.39 s / 286 MiB | 1.22 s / 294 MiB |
| cpu_soak no-op | 0.58 s / 202 MiB | 0.18–0.19 s / 87–94 MiB |
| nemesis_s forced build | 6.67 s / 755 MiB | 6.71 s / 773 MiB |
| nemesis_s no-op | 0.63 s / 204 MiB | 0.28–0.29 s / 186–189 MiB |

The after no-op ranges are three consecutive invocations; forced builds and the
before values are single samples, not a statistical no-regression guarantee.
Capturing the roughly 72 MiB nemesis resource tree initially increased no-op RSS;
moving compiler/linter/converter loading behind the freshness decision eliminated
that net regression in these observations. No-op still reads/hashes input bytes
and output bytes; the implementation does not substitute a timestamp cache for
content correctness or claim zero-I/O incremental builds.
