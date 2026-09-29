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
that ID is rejected. The server commits admission **before** acknowledging it.
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
can take up to its 10-second deadline. Permanent admission/format errors stop
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
