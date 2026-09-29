# Studio cartridge builds and exact-media installation

Status: research and proposed design, **not implemented or an approved migration
contract**. Initial audit against `8b64051de`; build/deploy and connection findings
rechecked on 2026-09-29 against `407a6cd72`. This complements
[program tools](studio_program_tools.md), [source lifecycle](studio_source_lifecycle.md)
and [standalone Studio](studio_standalone.md). The
[connection lifecycle review](studio_connection_lifecycle_review.md) covers the
independent connection workstream and its integration with these builds. Existing
contracts are not changed by either proposal.

Scope clarification: the existing build/deploy chain is **not a constraint**.
Replacing its entrypoints, output layout or orchestration is permitted where
ownership requires it. The recommendation must be justified by correctness and
measured build behavior, not by minimizing the diff or maximizing a rewrite.
This concerns the cartridge/media build and deployment chain, not choosing a
build system for the native emulator. The earlier CMake/Ninja migration options
were a scope error and are withdrawn.

## Conclusion

Use the existing server for workspace build jobs and publication notifications.
Do not implement this as a shell-command endpoint followed by a file watcher and
Reboot. The essential boundaries are:

1. The toolchain owns the actual build inputs and complete output artifacts.
2. The Node host owns accepted jobs, worker lifetime and observable job state.
3. Studio's execution owner installs an explicitly selected artifact into one
   live target. Editor documents and conversation are not that target.

These are responsibilities, not a mandate for three new facade classes. They
do not require an additional server, a homegrown general-purpose build framework,
an agent-specific build engine or a guest service.

## Findings in the current owners

| Owner | Observed behavior | Consequence |
| --- | --- | --- |
| [rompacker entrypoint](../scripts/rompacker/rompacker.ts) | CLI, progress presentation and build orchestration are combined. Cart linking reads the BIOS imports sidecar from the output directory; it does not first build the BIOS. | Running the current command is not a complete dependency plan. Keep the compiler/resource algorithms, but correct their input and publication ownership; do not use human-readable stdout as a protocol. |
| [resource discovery/loading](../scripts/rompacker/rombuilder.ts) | Dependency discovery parses Lua from disk; resource loading reads it again. Asset loading and manifest reads occur at different stages. | A source edit during a build can affect different stages differently. An mtime check does not provide an immutable input set. |
| `isRebuildRequired` in that same file | Compares current files' mtimes against the ROM. It has neither the previous input membership nor the effective optimization options. | Changed options can incorrectly reuse a ROM; removed inputs are not tracked as a change in the input set. Option invalidation was reproduced below; removal is a source-inspection finding. |
| `finalizeRompack` in that same file | Stages output, then replaces BIOS symbols, imports and ROM using separate renames. | Each file replacement is useful, but the complete set is not published at one visibility boundary. |
| [BIOS imports](../toolchain/ts/rompack/blua32_bios_imports.ts) and [linker](../toolchain/ts/rompack/blua32_linker.ts) | Imports contain public function addresses and the cartridge static-RAM base. The system ROM embeds the same public library as the sidecar. | Record the actual link dependency. Stable public export ordering does not establish that arbitrary BIOS builds are interchangeable. No new guest compatibility/version mechanism is needed. |
| [BootService](../ide/workbench/services/execution/boot.ts) | Reboot captures retained Lua documents, reads workspace overrides, prepares source-derived media and resets. | Reboot cannot promise to install an already built ROM unchanged. Newer source may replace the artifact's program. |
| [Lua installation](../ide/runtime/lua_pipeline.ts) and [source state](../ide/runtime/sources.ts) | Source installation replaces layers and installed Lua maps. `installRuntimeRomLayers` does not reconstruct complete asset packages. | Renaming this operation to full-ROM reload would leave the wrong owner model. |
| [tooling media loader](../toolchain/ts/rompack/media.ts), [IDE state](../ide/workbench/state.ts) | Full media preparation already exists; physical reset already invalidates debugger, Terminal and actor execution state. | Reuse these boundaries, while preserving document identities and rebuilding the actual full-media tooling base. |
| [Studio startup](../ide/browser/studio.ts), [tool sessions](../hosts/node/studio/sessions.ts) | The frame loop retains its runtime/workbench. Closing a window retires its tool channel and assistant connection. | Page reload loses session continuity. A browser tool stream must not own a workspace build job. |
| [server composition](../scripts/serve-dist.mjs), [deployment configuration](../ide/common/studio_configuration.ts) | Workspace authorization and explicit optional capabilities already exist. | Build availability is its own server capability, independent of Codex login and external-tool connectivity. |

### Measured standalone build defect

The real CLI was run with `cpu_soak`, the existing BIOS import sidecar and private
output under `/tmp`, without modifying sources or `dist`. All three commands
exited successfully:

| Request, in order | Observed output | ROM bytes | SHA-256 prefix |
| --- | --- | --- | --- |
| `-O0 --force` | Builds | 592500 | `48a6f95d4b5ed3f1` |
| `-O3` | Reports `Rebuild skipped`; ROM mtime and hash remain unchanged | 592500 | `48a6f95d4b5ed3f1` |
| `-O3 --force` | Builds | 795092 | `d6cc1c537086b17e` |

Reproduction from the repository root, with no existing server required:

```sh
out=$(mktemp -d)
cp dist/bmsx-bios.debug.rom.blua32-imports "$out/"
node --import tsx scripts/rompacker/rompacker.ts --mode rompack --skiptypecheck \
  -romname cpu_soak --debug --output-dir "$out" -O0 --force
sha256sum "$out/cpu_soak.debug.rom"
node --import tsx scripts/rompacker/rompacker.ts --mode rompack --skiptypecheck \
  -romname cpu_soak --debug --output-dir "$out" -O3
sha256sum "$out/cpu_soak.debug.rom"
node --import tsx scripts/rompacker/rompacker.ts --mode rompack --skiptypecheck \
  -romname cpu_soak --debug --output-dir "$out" -O3 --force
sha256sum "$out/cpu_soak.debug.rom"
```

This establishes a correctness defect in the existing CLI independently of any
Studio integration. The byte counts and hashes are observations of this checkout,
not frozen test expectations or performance benchmarks. This review does not fix
the defect. Making all server builds use `--force` would hide it, not improve the
standalone producer.

## The relevant build/deploy chain

The problem is the media pipeline:

```text
saved Lua/assets + selected BIOS link inputs
    -> BMSX compiler and rompacker
    -> complete, identified ROM/tooling result
    -> publication through the existing server
    -> explicit installation in the running Studio target
```

The same compiler/packer operation must serve CLI, Studio and agent requests.
There is no reason to rebuild the C++ emulator, move cartridge compilation into
CMake/Ninja, or introduce a general-purpose build-system migration for this
workflow. esbuild is a reference for job lifetime, not a replacement Lua/asset
compiler.

The existing scripts are first-class developer tools, not disposable scaffolding.
Professionalizing them means consistent command/options behavior and deliberate
boundaries between CLI presentation and build execution. The producer supplies
structured progress, source diagnostics and a concrete result; the CLI renders
those for a person, while the server consumes the same operation in its worker.
This is not merely extracting `main()` into a wrapper: input, dependency and
publication ownership must actually change where the current pipeline is wrong.
Readable CLI output remains valuable and is never the server's data protocol.

The existing media chain can still need substantial redesign: input capture,
BIOS dependency selection, compiler/asset pipeline boundaries, incremental
invalidation, output layout and publication. Correct these owners rather than
adding an endpoint around the current CLI. The size of that change is not
limited by existing scripts or filenames.

Relevant deployment findings remain:

- [npm workflows](../package.json) repeatedly sequence BIOS and cart commands.
  A full media build should resolve those dependencies itself. A cart-only build
  instead consumes an explicitly selected existing BIOS link input.
- [Browser deployment](../scripts/products/deploy_builder.ts) reads an existing
  cart from `dist` to obtain its manifest and builds a browser host during
  packaging. [Page generation](../scripts/products/browser_build.ts) then refers
  to mutable host/ROM filenames; it does not preserve the bytes selected earlier.
  Packaging a chosen result should instead consume that result and an explicitly
  selected host product. Building the host is a separate operation, not part of
  cart reload.
- `dist` mixes build outputs and deployable contents. Scratch files, retained
  build results and exported deployments have different lifetimes. Cleaning an
  export must not remove a build result still referenced by a Studio session.

Separate **build**, **publish/package** and **install**. A combined command can
compose them, but packaging/installing a chosen result must not silently rebuild
it from newer sources. Existing CLI entrypoints may change; retaining a second
incompatible path merely for compatibility is not required.

The running Studio/emulator host remains in place during media installation.
Standalone export may package an existing host with the selected media and
browser-owned workspace configuration. Changes to the emulator or Studio program
itself are a different development workflow, not a prerequisite for this one.

## Production references and their limits

- **VS Code:** its [task service](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/tasks/browser/abstractTaskService.ts)
  has explicit save-before-run behavior; the [debug task runner](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugTaskRunner.ts)
  observes task completion/cancellation before launch. Adopt the separation of
  Save, Build and Launch, not the complete task-provider framework.
- **esbuild:** [build contexts](https://github.com/evanw/esbuild/blob/main/pkg/api/api_impl.go)
  own active work; cancellation waits for that work to finish. Concurrent rebuild
  callers can share the active result. BMSX must not copy that last policy blindly:
  a request for newer sources cannot silently receive an older in-flight build.
- **Build Server Protocol:** [task lifecycle and compilation notifications](https://build-server-protocol.github.io/docs/specification)
  distinguish target, request correlation, progress, diagnostics and completion.
  Adopt those semantics; implementing the entire BSP protocol is unnecessary for
  one existing server and toolchain.
- **Bazel Remote Execution:** the [Action and ActionResult schema](https://github.com/bazelbuild/remote-apis/blob/main/build/bazel/remote/execution/v2/remote_execution.proto)
  distinguishes command/input identity from output digests. Use that distinction
  for provenance and exact loading, not a distributed build/cache infrastructure.
- **Kubernetes client-go:** [watch-list initialization](https://github.com/kubernetes/client-go/blob/master/tools/cache/reflector.go)
  establishes initial state and subsequent updates without a gap. For BMSX, one
  server can provide snapshot-then-deltas directly; no distributed controller or
  unbounded event journal is required.
- **Node:** [filesystem-watch caveats](https://nodejs.org/api/fs.html#caveats)
  include platform/filesystem differences and inode replacement. A watcher is
  not proof of build completion or a reliable cross-platform publication channel.

The BMSX decisions below are derived from those patterns and the live owner
audit; none of these references supplies BMSX's media-installation semantics.

## Input, job, artifact and installed state are different

Keep separate identities for:

- the accepted build request/job;
- the recipe and the input bytes actually used, including BIOS link inputs;
- the complete published artifact set, with identities derived from its content;
- the media currently installed in a particular Studio target.

A job is not a ROM version. Two jobs can produce the same ROM. A later completed
job is not necessarily based on newer sources. `dist/cart.debug.rom` is a mutable
output name, not an immutable version identifier. A git commit alone does not
identify a dirty workspace build.

### Save and input preparation

Build consumes saved source. An explicit Save-and-Build composition awaits the
existing canonical Save owner; a plain Build must not silently save drafts or
discard them. Other windows' unsaved documents are not implicitly part of it.

Move input ownership into the producer's preparation phase. Dependency scanning,
compilation, linting, resource conversion and diagnostic snippets must consume
the same retained bytes for each logical input. The existing resource buffers
should be reused, including for fingerprints; do not copy the whole repository
or reread every file solely to hash it. External asset dependencies must enter
this same boundary, rather than being reopened later by a decoder.

An input set becomes immutable when preparation completes. This does **not**
promise an atomic filesystem snapshot at the instant the user clicked Build:
independent external editors do not participate in a workspace transaction.
Queued jobs must make their not-yet-prepared state explicit. Later edits remain
later authoring state, not a reason to retarget the running job. Compilation and
diagnostics describe the bytes captured, not whichever source happens to be on
disk when an error is displayed.

Record the recipe's effective options and toolchain identity as well as input
content. Input identity includes logical paths and membership, so removal and
renaming cannot disappear from invalidation. Track BIOS imports, generated-module
inputs, resource-conversion options and compiler options at their actual owners.
An unchanged timestamp is not proof that this recipe/input set matches a previous
build. Changed `-O` options must never reuse a different recipe's ROM.

Correct no-op detection is part of the standalone producer, not a server cache.
Avoid recompiling, converting resources or rewriting outputs when the complete
recipe/input identity is unchanged. Reuse captured bytes and dependency work;
do not add a second scan/parse pipeline just for freshness checks. Report why work
was required using those same dependency facts, not a parallel diagnostic model.
Exact artifact identification is required; universal bit-reproducibility and a
general cross-build cache are not claimed by this proposal. Reuse cannot precede
establishing the complete dependency boundary.

### Job ownership and cancellation

The existing server accepts a repository build target/recipe, not an arbitrary
shell string supplied through a build API. Existing shell permissions are a
separate capability and do not need changing.

Run the CPU-heavy producer in a child process/worker, not the server event loop.
Initially serialize workspace jobs and isolate each job's outputs. No concurrent
writers share mutable BIOS sidecars. Retain only job metadata in the server;
large source/output buffers belong to the worker and artifact storage.
Managed workers prepare private outputs; the job owner admits publication through
the shared producer implementation. An orphaned worker must not independently
promote a result after its owner has stopped. Offline CLI execution uses the same
publication implementation under its own command lifetime.

Use explicit queued, preparing, building and publishing phases, followed by an
actual terminal outcome. These names are illustrative, not a frozen wire schema.
Progress comes from producer work, not estimated timers. Diagnostics retain
logical source paths and input provenance; output is available in the ordinary
host UI, not injected into the Lua Terminal or repeatedly into model context.
An editor decorates a current document only when the diagnostic's source version
matches; otherwise show the build's captured-source diagnostic, not an error at
an unrelated location in a newer draft. Producer cancellation and structured
diagnostics must also work in the offline CLI, not just through server jobs.

Closing an observation stream stops observing, not building. Cancel is a separate
job operation: request producer cancellation and acknowledge the terminal result
only after the worker can no longer publish. If publication already completed,
cancellation cannot erase that artifact or report that no output was produced.
Stopping a composite Build-and-Load must also revoke its pending load intent.

A client-generated request correlation ID allows lookup after a lost acceptance
response. To extend that guarantee across a Node restart, persist the accepted
request/recipe receipt before acknowledging admission or starting its worker.
In-memory IDs alone are insufficient. Publication must bind that job to its
committed output identities so restart can reconcile a lost completion record.
Job IDs do not enter ROM content identity. High-frequency progress is not a
durable event journal; retain the receipts and outcomes needed for reconciliation.
Specify the storage failure/durability boundary rather than claiming a disk write
survives every power failure.

Reconnecting looks up the original request; it does not automatically POST
another build. No current receipt is not, by itself, proof that an in-flight
admission never happened. Distinct build requests are not merged just because
their target names match. A repeated correlation ID refers to the same admitted
recipe, never permission to replace it with newer options.

### Complete publication and BIOS dependencies

Write job outputs under private staging, then publish an immutable descriptor
only after every referenced file is complete. It identifies ROMs, tooling
sidecars, input/recipe provenance and dependency relationships. Stage and commit
within the artifact store's filesystem; publish one logical result rather than
asking readers to infer a group from separate file replacements.

This is a build-output commit boundary, not a transaction around machine writes.
Atomic visibility is also distinct from power-loss durability; the storage
implementation must state its durability guarantee rather than assuming rename
provides both. Incomplete staging is never offered for installation.

A cart links against an explicitly selected BIOS import artifact associated
with its system ROM. The offline linker continues consuming its public import
library, not private BIOS symbols. The planner resolves this dependency before
cart compilation; no mutable sidecar can change underneath it.

A full media build resolves BIOS source as a dependency; a cart-only action uses
its explicitly selected system artifact. Either way, installation names a
coherent system/cartridge set, including the second socket where relevant, or
rejects the plan with the unresolved dependency. Do not silently pair a new cart
with an unrelated system image. If compatible BIOS substitution is later wanted,
its rule belongs to the actual linker contract, not filename or version heuristics.

Publication and job completion expose the exact artifact. Build-and-Load retains
that artifact identity, never a later lookup of "latest". Conventional `dist`
output paths may remain CLI outputs, but managed builds/loads must not use them
as identity or synchronization. Retention must protect referenced results and
provide explicit cleanup; neither artifacts nor transcript/log memory may grow
without an ownership policy.

## Notifications, CLI builds and connection loss

Provide one workspace observation channel with an initial authoritative snapshot
and ordered changes after it. Register the subscriber and take its snapshot at
the same owner boundary. A separate GET followed by subscribe has a lost-event
window. Reconnect obtains current state again; no exactly-once event claim or
whole-history replay is needed. Slow subscribers must not create an unbounded
output queue; progress can be coalesced, and state is recoverable by resubscribing.

Availability notifications update UI state, not the emulator or the conversation.
No notification starts a Codex turn. Several windows can observe the same build
without any of them being reset. Build & Load is a still-valid explicit intent
owned by its requesting target, not a broadcast action restored into a new tab.

The CLI remains useful without Studio. Both managed and standalone CLI builds
must use the same input preparation and artifact publication implementation.
Recommended connected mode: explicitly submit to the existing server's job owner,
then observe that job. It uses the same admission, cancellation and publication
path as Studio, providing **guaranteed live notifications** without a second
announce-after-build protocol. The connection is configured through the existing
authorized host surface, not guessed localhost ports or a Studio dependency
inside the compiler. Never silently switch a failed connected submission to an
offline build: the original job might already be running.

An offline CLI result can be discovered when the server opens/refreshes its
catalog. A watcher may prompt that refresh, but cannot be the correctness
mechanism. Therefore the earlier promise that *any arbitrary CLI rewrite of a
dist ROM automatically produces a reliable live notification* is withdrawn.
Producer-side publication integration is required for that guarantee.

Server shutdown terminates owned workers. Abrupt process loss must likewise leave
them unable to publish. On restart retain published results and distinguish
interrupted jobs from successful or cancelled ones. Do not silently rerun them or
infer success from a ROM filename. Recovery reconciles committed publication
records if the process stopped between publication and reporting completion.
Durable worker reattachment is not part of this proposal.

## Exact installation without restarting Studio

Prepare/download the selected immutable media and its full tooling packages
before entering the existing runtime mutation queue. Building must not hold that
queue or block frame stepping, ordinary authoring or agent traffic.

An admitted installation names the live target and its expected media generation.
If that target was replaced during preparation, reject the stale load intent;
do not select another window or a newer artifact. On admission:

1. Quiesce execution through the existing execution/task owners.
2. Install the selected raw media and publish the matching full tooling base:
   asset packages, source registries, installed source facts and symbols.
3. Reset physical execution and invalidate stale debugger/Terminal/actor handles
   and the old rewind timeline through their existing owners.
4. Retain resource-owned documents, unsaved text, undo history, views and the
   conversation. Refresh semantic/resource bases without replacing working copies.

This requires a genuine full-media installation boundary. Neither page reload
nor wrapping `BootService.reboot` nor changing only `installRuntimeRomLayers`
meets it. Reuse preparation and reset primitives where they actually match;
do not preserve source-overlay behavior in the exact-artifact route.

Preparation failure leaves the current target untouched. Once physical writes
occur, report their actual effects; do not implement machine capture/rollback.
"Installed and reset" does not mean guest initialization succeeded. Existing
execution, Terminal, image capture and Scenario Lab supply that later evidence.
Keep the existing host-pause policy rather than resuming gameplay implicitly.

Installed provenance also changes when Hot Resume, AEM application or ordinary
source Reboot installs derived media. It must no longer claim to be the untouched
published artifact. This state belongs at existing media-installation boundaries,
not a per-frame comparison or a second machine model.

## Tool and deployment scope

Workspace build operations belong to the Node build owner. Runtime installation
belongs to a selected live Studio context. Today's MCP route forwards all domain
tools through a browser; server-owned build operations must not acquire that
window lifetime merely to fit the current dispatcher. Compose the two scopes
explicitly, with shared definitions for embedded Codex and external MCP and no
second build implementation.

Studio commands and agent calls use the same build and installation admission.
The combined action is composition, not an alternative source/build path. A
build tool should return a job reference/result; waiting observes that job and
does not require busy polling or keeping one chat turn alive.

Without the server capability, full workspace builds are unavailable with a
clear explanation. Editor, Studio, Lua Terminal and local source workflows still
work. No probing loop, hidden API-key requirement or browser imitation of the
Node packer is introduced.

Artifact descriptors and job IDs stay host/toolchain-side. TS/C++ hardware still
consumes raw ROMs; no change to CPU opcodes, guest state or cartridge ABI is
proposed. Any later mirrored-runtime edit first requires the repository's
representation/callsite audit.

## Implementation gates and evidence

Start with the target/dependency/artifact model and its producer/publication
ownership, migrating CLI/deployment callers rather than leaving two planners
indefinitely. Then establish server job ownership and exact full-media installation
at their respective owners before composing Studio/tool actions. Connection
recovery is an independent workstream, not a prerequisite for improving the
standalone CLI. A prototype endpoint must not define incorrect lower-level behavior
as its permanent contract. A larger build/deploy migration is acceptable; a new
generic framework is not a goal in itself.

Before implementation, resolve these remaining details against live owners:

- Enumerate every file-reading asset/compiler/lint path and its reusable input
  representation, including dependencies opened by third-party decoders.
- Specify the full package/resource refresh while retaining documents; identify
  every installation edge that updates media provenance.
- Specify admission-receipt/publication storage and artifact/log cleanup ownership.
  Connected CLI submission uses the same job owner; no second offline fallback or
  watcher-based promise of reliable external-build notification precedes that work.
- Measure the media pipeline on real cold/no-op, changed-Lua, changed-asset,
  removed-input and changed-option builds. Verify dependency invalidation and
  avoid unnecessary parsing, resource conversion and output rewriting.

Acceptance must include observed output, not just typechecks or fixture tests:

### Standalone producer and packaging

Run these with no Studio, server or Codex process:

| Situation | Required evidence |
| --- | --- |
| Cold build, then identical no-op | Complete result on the first run; no compiler, resource conversion or output rewriting on the second. Measure elapsed time and peak memory rather than treating a skipped message as proof. |
| Change optimization options or compiler/converter inputs | Correct invalidation and output provenance, without requiring `--force`. |
| Remove/rename an input or change Lua, an asset or a link dependency | The result reflects the actual input set; no stale embedded resource or mixed BIOS/cart result. |
| Edit a source during the build | Scan, lint and compilation describe the same captured input, not a mix of rereads. |
| Fail or cancel before publication | Useful diagnostics/non-success exit and no partially published result; any previous result remains separately identified, not presented as new success. |
| Package a selected result after sources and conventional `dist` outputs change | The export still contains the explicitly selected host/media; no hidden host or cart compilation. |

Reuse the existing CLI presentation facilities where appropriate. Do not parse
human stdout as an API or add tests that freeze progress wording. Assess warm
build cost on representative asset-heavy carts as well as the small `cpu_soak`
correctness probe; neither one successful build nor this review establishes an
incremental performance result.

### Studio/server integration

| Situation | Required evidence |
| --- | --- |
| Change Lua plus a YAML/texture asset, build, then load | The real target executes the selected ROM and displays/reads the changed asset; compiled provenance and loaded artifact agree. |
| Type/save while an earlier build runs | Diagnostics refer to the captured input; newer drafts and undo survive loading the earlier artifact. |
| Two windows and two requests | Each request keeps its identity; only the explicitly chosen target loads. |
| Disconnect/reconnect or lose the acceptance response | The same job is observed, no duplicate build and no resurrected auto-load intent. |
| Stop the server between accepting, publishing and recording completion | Receipt/publication reconciliation reports interrupted or completed honestly, without rerunning work or losing an already committed result. |
| Cancel during build; cancel after publication | No publication after acknowledged pre-publication cancellation; completed artifacts are reported honestly. |
| Change BIOS, including with a second cart present | The dependency plan names a coherent set; no old import sidecar/new ROM mixture. |
| Perform source Reboot/Hot Resume after artifact installation | Installed provenance describes derived media, not the unchanged published build. |
| Run the configured connected CLI and an offline CLI build | Explicit publication drives live notification; offline discovery is not falsely described as guaranteed push. |
| Shut down the server or use standalone Studio | Capability status is honest; local IDE/Terminal work and no retry spam occurs. |
| Package a previously selected result after sources change | Deployment still contains the selected host/media, not a newly mixed build. |

Apart from the explicitly recorded CLI invalidation experiment, the tables above
are future acceptance criteria. No runtime implementation, performance result or
visible UI acceptance is claimed by this research document.
