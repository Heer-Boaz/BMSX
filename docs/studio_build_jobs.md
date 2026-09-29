# Workspace builds, publication and recovery

Implemented 2026-09-29. This covers the offline producer/package workflow,
server-owned jobs, and the Studio window connection. It does **not** implement
full-media replacement inside a running emulator or change embedded chat lifetime.

## Commands and surfaces

- `npm run build:toolchain:cart -- cpu_soak --debug -O3` captures saved inputs,
  resolves its BIOS dependency, publishes one complete immutable bundle, and
  exports those exact files to `dist`. No server or assistant is required.
- `--store-dir` selects the artifact store (default `.bmsx/builds`);
  `--output-dir` selects the mutable export. `--mode bios` publishes a system-only
  bundle. `-respath` still supports authored resources outside the worktree.
- BIOS ROMs and sidecars live under `<output-dir>/system/`; cartridge files remain
  at `<output-dir>/<name>[.debug].rom`. The conventional layout is also used inside
  newly published bundles. Browser product pages and Node launch defaults use it;
  libretro launch scripts pass `<output-dir>/system` as the frontend system directory.
- Build the browser host separately with `npm run build:product:browser-player -- --debug`.
  Then package an **existing** artifact and host:
  ```sh
  npm run deploy:browser -- --artifact <id> --host-dir dist --output-dir /tmp/game-export
  ```
  The destination must be new/empty. Packaging neither recompiles a ROM nor builds
  a missing host. The package includes its artifact ID and selected host hashes.
- On the existing `startserver.sh` server, use **Studio: Build Cartridge** and
  **Studio: Build Jobs**. Build means saved files, not implicit Save. Choose the
  cartridge and debug/release/optimization recipe. Job details offer current
  status, on-demand bounded logs, cancellation and the exact artifact ID.
- External agents use the same server's MCP tools: `studio_build_targets`,
  `studio_build_cart`, `studio_list_builds`, `studio_read_build`,
  `studio_cancel_build`, `studio_read_artifact`. They need neither a browser tool
  context nor a Studio Codex login. A completed build is **available**, not installed.
- Embedded Studio Codex receives these same definitions as dynamic tools. The
  Node adapter dispatches them directly to the same jobs owner; they never travel
  through a browser runtime context. Closing a chat does not cancel admitted work.
- Standalone Studio declares no server/build capability. Local source editing,
  Terminal and the IDE remain independent; they do not probe for missing services.

## Owners

`build_inputs.ts` captures file bytes, membership, metadata and model dependencies.
`build.ts` resolves/captures both system and cart inputs before compilation;
`compile.ts` consumes that snapshot and is loaded only for actual compilation.
The producer takes an explicit system/cart domain. Cart names are labels, never
hidden mode switches: a cartridge named `system` remains a cartridge. CLI modes
and server jobs construct complete typed build options at their respective boundary.
The cart key binds its effective recipe, source inputs and the **actual selected
system output digests**, including the BIOS import library. It never reads a
mutable `dist` sidecar. Diagnostics use the captured source, not a later disk edit.

`artifacts.ts` owns `.bmsx/builds/{staging,artifacts,actions}`. An entire media bundle
is staged privately and committed by a directory rename. The artifact ID covers
recipes, input identities and output digests. Action indexes contain references,
not another copy of the build. An immutable local result is consumed directly;
mutable exports are checked separately so a no-op does not rewrite them. Ordinary
exports remain separate file replacements, **not** the publication catalog.

`hosts/node/builds/ledger.ts` owns durable request receipts in `jobs.sqlite`.
SQLite exclusive locking keeps one server owner per store, including between
commits; a killed process releases the OS lock. No stale PID-file guessing or
manual lock-directory deletion. This uses Node's built-in SQLite API (Node 22.23
was exercised; that Node release prints its experimental-API warning). There is
no new npm dependency or version pin. [VS Code's SQLite storage owner](https://github.com/microsoft/vscode/blob/main/src/vs/base/parts/storage/node/storage.ts)
is the reference for committed storage, and SQLite documents the precise
[exclusive locking semantics](https://www.sqlite.org/pragma.html#pragma_locking_mode).

`StudioBuildJobs` owns admission, the bounded queue and one worker. Large source
buffers and CPU work stay in the worker. A caller supplies a UUID before admission;
that ID plus the same request yields the same receipt. A different request with
that ID is rejected. Equality compares target, debug and optimization values,
independently of JSON property order, for pending admissions and retained receipts.
The server commits admission **before** acknowledging it.
A lost response is reconciled by that ID, not by creating another build.

`StoredBuildRequests` commits each unacknowledged browser request under its own
storage key before sending it. Other windows observe per-key storage changes;
they never write an older whole-collection snapshot over another window's IDs.
Storage events read the current committed key, so a delayed event cannot resurrect
a receipt this window has already acknowledged. The previous array format is
migrated once. Storage failure prevents submission; there is no in-memory-only
substitute for the recovery record.

HTTP receipts and the observation stream update the same bounded browser job
view. The producer assigns each job observation a `(generation, sequence)` version.
The ledger advances the generation once per server lifetime under its existing
exclusive transaction. Coalesced progress advances only the in-memory sequence;
durable state transitions persist their version along with the receipt. Recovery
therefore supersedes even progress that was observed but never persisted. A late
HTTP response, stream change or snapshot cannot overwrite a newer job observation.
HTTP inspection also returns the newest known observation to its UI caller, not
the older response it just reconciled. Original ledger records receive their
initial version in a schema migration, never through read-time fallback values.

Workers write only private staging files and report structured progress/results;
they cannot publish. Disconnection from their process owner terminates them.
Cancelling waits for worker termination. Once the owner enters publication,
publication wins and cancellation returns its actual result. The ledger records
publication intent before commit. On restart, committed bundles become completed
jobs; other unfinished jobs become interrupted and are **not** restarted.

The server retains 50 recent observations in memory and at most eight waiting
requests. Logs are capped at 256 KiB and fetched only on demand. Progress is
coalesced; it is not an ever-growing event journal. Receipts/artifacts remain on
disk for explicit lookup and exact packaging. There is intentionally no automatic
artifact GC that could delete an ID retained by an external client. A disposable
workspace can use a separate `serve-dist --build-store <directory>`; do not remove
an active store. Cleaning `dist` never deletes published media or job receipts.

## Connection and cooperation

`StudioConfiguration.server` explicitly declares the channel and its independent
tool/build capabilities. `StudioServerConnection` owns one registration/recovery
loop. It observes one `StudioSessions` protocol regardless of active pane, build,
CLI daemon or account state. Server admission still belongs to `StudioHttpSession`.
Tool operations remain in `StudioToolRequests` and lose authority when that
registration retires. No Lua call, source write, prompt or build request is replayed.

The channel carries server incarnation, new window identity, an initial build
snapshot and ordered changes. Snapshot subscription has no initialization gap.
Backpressured build changes coalesce into a replacement snapshot; tool requests
are not coalesced or replayed. ROMs, images and logs do not enter the heartbeat
stream. A subscriber disappearing never stops an admitted job.

Liveness: one ping every 5 seconds, acknowledgement/silence deadlines of 15
seconds, a 10-second registration deadline. Recovery uses jittered 250 ms to
5-second delays with a 60-second retry window; a registration already in progress
can take up to its 10-second deadline. A completed heartbeat round trip resets
backoff and renews the budget on subsequent loss; registration alone does neither.
Permanent admission/format errors stop
recovery. Timing is measured on the local desktop/LAN setup below, **not certified
for phone background scheduling**. Visibility/online are wake hints, not evidence
of health. Freeze/cached navigation retires the registration and restoration opens
a fresh one without replacing editor models or drafts.

The persistent status icon distinguishes local, connecting/reconnecting, connected
and disconnected by shape/color. Click/tap it or run **Studio: Server Connection**
for details and contextual Retry. This reports workspace connectivity, not an
assistant's login. Recovered build snapshots update availability without installing
media, resetting a target, saving drafts or continuing gameplay.

Permanent admission/protocol failure remains stopped across visibility, online
and suspension/restoration hints; only explicit Retry clears it. A temporary
network outage may still recover on those hints. The build capability does not
depend on this observation channel: an explicit build or status read can succeed
while the stream is unavailable. Its actual HTTP receipt remains visible in
Build Jobs, while the connection indicator still reports disconnected. This is
not an automatic HTTP polling fallback or a replay of the build request.

### Focused production-code rereview

The additional review used [VS Code's per-key browser storage and cross-window
notifications](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/services/storage/browser/storageService.ts)
and its [single reconnection loop and permanent-failure handling](https://github.com/microsoft/vscode/blob/main/src/vs/platform/remote/common/remoteAgentConnection.ts).
The [Web Storage specification](https://html.spec.whatwg.org/multipage/webstorage.html)
explicitly warns against assuming a lock across windows; replacing a shared JSON
array was not an adequate request store. BMSX uses atomic independent keys for
these small receipts, rather than adopting VS Code's entire database service or
its in-memory fallback policy.

[Bazel's disk cache](https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/lib/remote/disk/DiskCacheClient.java)
was also reread for immutable content, separate action references and temporary-file
publication. The existing media producer still follows that ownership split.
Bazel additionally syncs files for machine-crash durability; BMSX's stated
process-crash publication guarantee below has **not** silently become a power-loss
guarantee as a result of this review.

The [AWS MQTT client](https://github.com/awslabs/aws-c-mqtt/blob/main/source/client.c)
also distinguishes a completed handshake from sufficiently stable recovery before
resetting reconnect backoff. BMSX uses its existing heartbeat round trip as that
evidence, not a new stability timer, MQTT session policy or command replay. The
previous immediate reset on registration let a repeatedly closing stream defeat
both backoff and the finite recovery budget.

## Evidence and limits

- Real CLI option change O0 -> O3 produces different cart bytes without `--force`;
  no-op reuses the artifact and leaves the export unchanged. External program
  sources and source-free carts now resolve a complete media build normally.
- Packaging hash readback matches the selected BIOS, cart and host receipts.
  The exported player then booted on an assets-only host, without Studio API
  requests. Evidence: `final-package/` and `package-boot.png` in the directory below.
- Real worker and existing HTTP/MCP server: concurrent duplicate admission creates
  one job, discarded HTTP acknowledgement and closed MCP subscription do not stop
  it, queued/active cancellation terminates, and an unauthorized request is denied.
- Real Codex app-server with the deterministic local Responses fixture calls the
  embedded build tool and receives its receipt; closing chat leaves the producer
  running to completion. This verifies native tool routing, not paid inference.
- Publication-intent recovery is exercised against committed/missing artifacts.
  A real SIGKILL test reacquires the database and reports the admitted job as
  interrupted, never replayed. A competing ledger owner is rejected.
- Real browser HTTP streaming: silent acknowledgement loss recovers in about
  20.2 seconds, old tool contexts retire, new registration/admission is obtained,
  and repeated resume/wake calls do not create parallel streams.
- Product UI inspected in light/dark themes. Keyboard-driven Build succeeded;
  the registration was suspended while the worker finished, then its replacement
  snapshot showed completion. Server stop -> bounded recovery -> disconnected ->
  explicit Retry was inspected visually. The same Terminal draft remained visible
  before/after recovery. No embedded assistant requests were made in that probe.
  Evidence: `/tmp/bmsx-artifacts-06v4SH/ui-*.png` and `ui-evidence.json`.
- A follow-up clicked the actual permanent status icon and inspected shortened
  recipe/details copy. It caught the shared status renderer ignoring the message
  color and painting successful builds as alerts; the renderer now consumes the
  feedback owner's color. Evidence: `ui-final-*.png` in that directory.
- The connection/build owners were exercised against the actual server over a
  LAN HTTP origin with `isSecureContext=false` and `crypto.randomUUID` unavailable.
  Build admission and streamed completion succeeded using the existing shared
  UUID owner. This is not full-emulator LAN acceptance: the unchanged browser
  audio startup rejects that origin before Studio starts (see below).
- Standalone product, native conversation viewing and real MCP Lua/frame/image
  workflows were rerun. The MCP fixture now waits for actual cart selection and
  frame admission instead of mistaking a historical boot acknowledgement for
  current readiness. No emulator behavior was changed.

A synthetic page-lifecycle event tests our owner wiring, not physical iPhone
suspension or actual BFCache eligibility. Those still require device verification.
The full browser host currently requires `crossOriginIsolated=true` for its
SharedArrayBuffer audio backend. A plain LAN HTTP URL fails at that pre-existing
startup boundary; localhost product checks do not establish phone/LAN delivery.
Trusted HTTPS delivery or an explicit audio-transport redesign is separate work,
not something this connection implementation silently substitutes or disables.
Artifact rename guarantees process-crash visibility, not filesystem/power-loss
atomic durability across the artifact store and SQLite. Full-media installation,
embedded chat reconnection, cross-host caches and automatic artifact collection
are not implied by this work.

Validation totals: ROM packer 186/186; connection/build/entry 13/13; assistant HTTP
13/13; browser standalone/conversation/MCP 6/6. IDE, Node and common-host typechecks
pass, architecture boundary audit reports zero, and `git diff --check` is clean.
The broader scripts typecheck still reports the pre-existing unused
`createRuntimeSourceState` import at `scripts/bootrom/platforms/node_tooling_entry.ts:72`;
this is not a claim of an entirely green repository.
The broader test-project typecheck also reports errors in untouched Lua/graph
fixtures; the changed build/connection tests have no type errors in that output.

Follow-up review evidence (2026-09-29):

- Chromium reproduced a second window erasing an uncertain request, an accepted
  HTTP receipt absent from Build Jobs, and repeated registration after a permanent
  403. Targeted recovery/storage checks now pass, including independently delayed
  HTTP replies and stream snapshots in both orders. No mutation is resubmitted.
- Real worker/HTTP/MCP/restart coverage verifies increasing observation versions;
  original ledger records migrate without losing request identity. A new server
  generation supersedes unpersisted progress without persisting progress ticks.
- The **actual product UI** exposed an additional command-availability bug during
  the check: Build Cartridge was disabled by observation-channel failure. That
  gate is removed. With only the stream deliberately denied (403), keyboard-driven
  build admission, visible queued receipt, explicit inspection and completed
  artifact retrieval now work. The icon stays disconnected. Wake/suspension hints
  cause no extra registration; explicit Retry reconnects with the Terminal draft
  intact. Screenshots were opened and inspected in light/dark themes:
  `/tmp/bmsx-nareview/ui-*.png`, with receipts in `ui-review.json`.
- This is an injected stream failure on localhost, not physical phone or LAN
  acceptance. Full-media installation and the previously noted LAN audio boundary
  remain outside this review.
- Reopening a saved active Terminal exposed a separate startup failure before the
  connection owner is constructed: `canEvaluate` reaches `activeCartridgeSlot`
  before the CPU owns an active execution image. The follow-up
  [boot-owner fix](studio_boot_operations.md#workspace-restoration-review-2026-09-29)
  closes admission before pane restoration, without clearing sessions or adding
  a CPU fallback. A saved active Terminal now survives cold opening and real
  reload in the server-backed product; connection composition runs afterwards.

### Critical implementation review (2026-09-29)

Three faults were reproduced before correction, rather than inferred from green
typechecks or a desired architecture:

- A server repeatedly accepted registration and immediately ended the stream.
  The old client stayed reconnecting past its recovery budget. The real HTTP /
  Chromium check now reaches disconnected and stops attempts; a heartbeat round
  trip, not registration, is the reset boundary.
- The real CLI treated a cart named `system` as a BIOS request, including using
  its cart resource directory for BIOS compilation. Explicit build domains now
  produce a cartridge for that name. A separate real `--mode bios` run still
  produces only the BIOS and its sidecars.
- Identical request fields in a different insertion order were rejected during
  admission and receipt lookup. The real worker check now accepts both orders
  as the same request while rejecting a changed recipe. Worker dispatch also
  carries complete `MediaBuildOptions`, not a differently shaped request that
  merely claimed that type at the receiving end.

Validation: ROM packer 187/187; connection/build observation 8/8; socket and
assistant HTTP/entry 22/22. IDE and Node typechecks and the strict architecture
boundary audit pass; debug and release browser Studio products build. The actual
keyboard-driven Studio build/reconnect workflow was rerun and its screenshots
opened in both themes: an HTTP build completes while observation is denied, the
red disconnected icon remains truthful, explicit Retry turns it green, and the
Terminal draft survives. No assistant process or paid inference was used.
Evidence: `/tmp/bmsx-critical-review/` (including `ui-review.json`, `ui-*.png`
and the before/after reproduction logs). The page-lifecycle hints in that probe
are synthetic, not physical phone suspension or a BFCache certification.

**Original output-namespace defect (corrected below):** system and cart compilation
shared flat artifact filenames. A real cart build named `bmsx-bios` overwrote the staged BIOS
ROM, then reported successful publication/export. Reading the published bytes
back disagreed with the BIOS digest in that artifact's receipt; its cart digest
matched. This also makes reusing that bundle as a BIOS result unsafe. The review
used a private store, not the user's published artifacts. Reproduction:

```sh
node --import tsx scripts/rompacker/rompacker.ts --mode rompack \
  -romname bmsx-bios -respath carts/cartridge_data_conformance/res --debug \
  --store-dir /tmp/bmsx-output-collision-store \
  --output-dir /tmp/bmsx-output-collision-export
```

The `system` mode-dispatch fix did not repair this. It was left explicit rather
than concealing it with a reserved-name exception, post-publication hash fallback
or silently renamed cart. The follow-up below corrects the output ownership.

### Output ownership follow-up (2026-09-29)

The review compared [Bazel artifact root-relative paths](https://github.com/bazelbuild/bazel/blob/master/src/main/java/com/google/devtools/build/lib/actions/Artifact.java)
and [Meson's target directories and output filenames](https://github.com/mesonbuild/meson/blob/master/mesonbuild/backend/backends.py).
The adopted principle is qualified output identity, not either build framework.

The media producer gives BIOS compilation a `system/` directory, then qualifies
its unit-local output receipts once when constructing the complete media receipt.
Cartridge names remain cartridge names, including `system` and `bmsx-bios`.
Cached BIOS copies and linker imports use that same directory. Publication still
commits the whole directory; export preserves the receipt paths and creates parent
directories only for files needing a write. HTTP downloads match the full relative
path against the artifact's declared outputs, never an arbitrary filesystem path.

Packaging selects both ROM paths from the chosen artifact, writes them into the
host page, and copies its files without renaming or rebuilding. Browser hosts read
the declared system-ROM URL, just as they read the declared cartridge URL. This
also allows an intact previously published flat bundle to be explicitly packaged
with a new host: its own receipt supplies its paths, with no legacy-layout branch.
Published artifacts and old export files are not rewritten or deleted. Fresh builds
get new action keys through the existing toolchain-content identity. Previously
corrupted artifacts are not repaired or silently substituted.

Startup consumers, outside the per-frame runtime:

| Consumer | System media selection | Native/runtime impact |
| --- | --- | --- |
| Browser player / Studio | Product page's `data-system-rom`; deployment uses the selected artifact path | No machine or guest changes |
| Node player / tooling | Explicit `--system-rom`, otherwise `system/` beside the cart | Once at launch, no frame-path lookup |
| C++ libretro | Existing frontend system directory plus `bmsx-bios.rom` | Core unchanged; launch scripts select `dist/system` |

The original corruption check failed before the fix and now verifies the actual
published/exported bytes against both BIOS and cart digests. Real CLI probes cover
cold compilation, three unchanged builds, system-only reuse after a colliding-name
cart, and a second cart reusing that BIOS. All three resulting artifacts matched
their receipts; no-op export timestamps remained unchanged (0.20-0.21 seconds per
warm CLI invocation on this machine, not a cross-machine performance guarantee).
The colliding-name executable cart boots in Node using the default BIOS path and
in the freshly built C++/libretro core using the explicit frontend system directory.
This is media-loading evidence, not a new full runtime-parity claim.

Both a new qualified bundle and an intact earlier flat bundle were packaged with
the newly built browser host, checked against their output digests, then run on an
assets-only HTTP server. The browser fetched the exact distinct system/cart paths
declared in each page, reached the running cart, and made no Studio API requests.
The server-backed Studio build/reconnect workflow was driven through its actual
keyboard UI and screenshots inspected in light/dark themes. Standalone Terminal
evaluation, Save, real page reload and offline editing also passed, without a server.
Evidence: `/tmp/bmsx-review-output/`, including the initial failing corruption
check, CLI/cache measurements, Node/native boot logs, UI captures and package
receipts/screenshots under `run-1tYZja/`.

Follow-up checks: ROM packer 188/188, connection/build observation 8/8, entry 6/6
and standalone browser 2/2; IDE/Node typechecks and strict architecture audit pass.
Browser player/Studio debug and release, Node player/tooling debug and libretro
release products were built. No C++ machine changes, second build service, runtime
path fallback or cart-name restriction was introduced.
The broader scripts typecheck was also rerun: its sole error remains the existing
unused `createRuntimeSourceState` import in `node_tooling_entry.ts:72`, not a new
error in the changed producer or packaging code.

### Native parity follow-up (2026-09-29)

Scope: media export/admission, firmware Terminal, frame evaluation, runtime
save/replay/rewind and native presentation. Studio/server availability is not a
C++ machine feature. No machine representation or per-frame path was changed.

The follow-up found another consumer of the old flat layout: the SNES Mini
workflow passed `/inputs` as its frontend system directory, and its acceptance
record hashed only top-level files. With newly exported media the ARM core failed
to load `/inputs/bmsx-bios.rom`. The same core and media boot with
`/inputs/system`, without a fallback or copying the BIOS back beside the cart.
The Makefile default now agrees, and the acceptance record enumerates all input
files in sorted root-relative path order, including BIOS sidecars under `system/`.
Input read/hash failures terminate publication rather than recording an empty digest.

References checked: [RetroArch's frontend system-directory configuration](https://github.com/libretro/RetroArch/blob/master/configuration.c)
(also read in the local production checkout), and [Nix's sorted, named recursive
archive entries](https://github.com/NixOS/nix/blob/master/src/libutil/archive.cc).
The latter informs complete path-qualified input identity, not a new archive
format or dependency.

Actual validation, using existing runners:

| Check | Result |
| --- | --- |
| `test:terminal-parity` | Byte-identical output from real BIOS monitor HID input in TS/C++; session/cart globals, closures, tuples, errors and frame locals |
| `test:cartridge-conformance` | Both produce `READY\|STEP1\|STEP1`; immutable media hashes unchanged |
| `test:frame-evaluation-parity` | 21 cases at O0 and O3; complete decoded states, including suspended scopes, match |
| `test:runtime-replay` | Full states match for `nemesis_s` and preload fixture at three replay checkpoints and after history branching; host/native/libretro pause and rewind checks pass |
| `test:render-parity` | `renderhwtest` (3) and `bare_metal_cart` (146) captures match pixel-for-pixel across TS software, C++ software and C++ GLES2 |
| Native frontend checks | Libretro environment, save-state envelope and host UI input: 3/3 |
| `build:platform:libretro-snesmini` | Fresh ARM core, target-root ABI audit and QEMU smoke: 16/16 video frames; actual cart boot; all four exported input hashes and both artifact hashes verified |

**Open host-layer finding:** `audit:core-parity` still fails: TS
`render/host_overlay/bitmap.ts` is unclassified, and its `Bitmap` command extends
`Host2DKind`/`Host2DRef` without a C++ counterpart. Its only current production
producer is Studio's image preview; native menus and firmware Terminal do not
submit it. This is a host command-surface/audit-scope discrepancy, not a measured
guest-machine divergence. It was neither hidden by an audit exclusion nor filled
with unused native texture-lifetime machinery. Deciding whether arbitrary host
bitmaps are a shared rendering capability is a separate owner-boundary change.

Evidence: `/tmp/bmsx-native-parity-20260929/`, including the old/new ARM
system-directory reproductions and final build/ABI logs. These checks do not
certify every opcode, audible device output, browser WebGL/WebGPU presentation,
or physical SNES Mini hardware. The ARM check is a boot smoke, not an ARM
full-state parity comparison. No new tests or server dependencies were added.

### No-op cost

Three warm CLI samples after publication, including Node/tsx startup, complete
BIOS + cart input capture and mutable export digest checks:

| Debug -O3 target | Elapsed | Peak RSS |
| --- | --- | --- |
| `cpu_soak` | 0.23-0.24 s | 103-105 MiB |
| `nemesis_s` | 0.33-0.35 s | 186-188 MiB |

No compiler/converter work or export timestamp change occurred. The earlier
first-slice `cpu_soak` cart-only baseline was 0.18-0.19 s / 87-94 MiB; it did not
capture/resolve a complete BIOS build. This is a broader operation, not a claim
that adding system ownership is free. Immutable local results are not redundantly
rehashed. Logs: `/tmp/bmsx-artifacts-06v4SH/final-*.log`.
