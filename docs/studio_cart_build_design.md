# Studio cartridge builds and exact-media installation

Status: research and proposed design, **not implemented or an approved migration
contract**. Audited on 2026-09-29 against `8b64051de`. This complements
[program tools](studio_program_tools.md), [source lifecycle](studio_source_lifecycle.md)
and [standalone Studio](studio_standalone.md). Those existing contracts are not
changed by this proposal.

Scope clarification: the existing build/deploy chain is **not a constraint**.
Replacing its entrypoints, output layout or orchestration is permitted where
ownership requires it. The recommendation must be justified by correctness and
measured build behavior, not by minimizing the diff or maximizing a rewrite.

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
| `finalizeRompack` in that same file | Stages output, then replaces BIOS symbols, imports and ROM using separate renames. | Each file replacement is useful, but the complete set is not published at one visibility boundary. |
| [BIOS imports](../toolchain/ts/rompack/blua32_bios_imports.ts) and [linker](../toolchain/ts/rompack/blua32_linker.ts) | Imports contain public function addresses and the cartridge static-RAM base. The system ROM embeds the same public library as the sidecar. | Record the actual link dependency. Stable public export ordering does not establish that arbitrary BIOS builds are interchangeable. No new guest compatibility/version mechanism is needed. |
| [BootService](../ide/workbench/services/execution/boot.ts) | Reboot captures retained Lua documents, reads workspace overrides, prepares source-derived media and resets. | Reboot cannot promise to install an already built ROM unchanged. Newer source may replace the artifact's program. |
| [Lua installation](../ide/runtime/lua_pipeline.ts) and [source state](../ide/runtime/sources.ts) | Source installation replaces layers and installed Lua maps. `installRuntimeRomLayers` does not reconstruct complete asset packages. | Renaming this operation to full-ROM reload would leave the wrong owner model. |
| [tooling media loader](../toolchain/ts/rompack/media.ts), [IDE state](../ide/workbench/state.ts) | Full media preparation already exists; physical reset already invalidates debugger, Terminal and actor execution state. | Reuse these boundaries, while preserving document identities and rebuilding the actual full-media tooling base. |
| [Studio startup](../ide/browser/studio.ts), [tool sessions](../hosts/node/studio/sessions.ts) | The frame loop retains its runtime/workbench. Closing a window retires its tool channel and assistant connection. | Page reload loses session continuity. A browser tool stream must not own a workspace build job. |
| [server composition](../scripts/serve-dist.mjs), [deployment configuration](../ide/common/studio_configuration.ts) | Workspace authorization and explicit optional capabilities already exist. | Build availability is its own server capability, independent of Codex login and external-tool connectivity. |

## Whole-chain architecture, not just a cartridge endpoint

The broader audit found related ownership problems outside the packer:

- [npm workflows](../package.json) manually sequence product, BIOS, cartridge and
  run/test commands. This repeats dependency ordering at each caller.
- [Product builders](../scripts/products/product_builder.ts) already separate
  browser, Node and native products, but [freshness checks](../scripts/products/rebuild.ts)
  compare an output's mtime with the currently enumerated files. They retain
  neither the previous input membership nor a recipe identity.
- [Browser deployment](../scripts/products/deploy_builder.ts) reads an existing
  cart from `dist`, builds a browser host, and writes packaging into that same
  directory. It does not establish a BIOS/cart/host artifact set first.
- [Browser packaging](../scripts/products/browser_build.ts) writes bundles,
  worker assets, templates, pages and a shared webmanifest separately. `dist`
  currently mixes build outputs, runtime lookup names and deployment contents.
- [Host atlas generation](../scripts/render/generate_host_system_atlas.ts)
  produces both TS and C++ source files in the source tree before product builds.
  It avoids rewriting equal contents, but the dependency remains an npm-command
  prefix rather than a product dependency declared once.
- Native products already use [CMake/Ninja](../scripts/products/libretro_build.ts)
  and the [repo-local cross-build setup](../Makefile). Their actual compilation
  graph must not be duplicated as TypeScript file-by-file build logic.

The proposed target model is therefore broader:

```text
BIOS source/assets ---------------------> system artifact + public link library
cart source/assets + that link library -> cartridge artifact
host source + generated host assets ---> browser / Node / native product artifact

selected product + system + cartridges + deployment configuration
                                        -> complete deployment description/export
selected system + cartridges            -> media-install plan for a live target
```

Compiler options and toolchain dependencies belong to the relevant producer
actions. The diagram is not an extra guest runtime or a universal build DSL.
The same declared target/dependency plan must drive CLI, CI, Studio and agent
requests. A normal media build resolves BIOS and cartridge dependencies rather
than requiring every caller to remember an npm command sequence. A cart-only
action can consume an explicitly selected existing system dependency; it must
not silently ignore changed BIOS source while presenting itself as a full
project build.

Separate **build**, **package/publish** and **activate**. Packaging an identified
result must not rebuild its host or reread newer cart source. A user-facing
Build-and-Deploy command may compose those operations explicitly. The build
store, private scratch space and deployable product have different lifetimes;
`clean:dist` must not implicitly destroy artifacts still referenced by a running
Studio session. Existing filenames and npm aliases are not architectural
requirements. If retained, they must select this single model, not preserve a
second incompatible execution path.

Publish a complete browser product including its worker and static dependencies.
An already open page must not fetch an unversioned worker from a newer product
generation. The server serves a selected deployment; standalone export selects
the same product with browser-owned workspace configuration and no server
capabilities. Neither mode needs a separately compiled fake Studio variant.

Cart-media activation and host-product activation are different operations. A
cart build does not restart the IDE. Replacing Studio JavaScript or the emulator
host cannot be disguised as a cart reload: activate that product through an
explicit host restart/recovery flow. Likewise, if a media plan requires a changed
machine/tooling contract, surface that requirement rather than promising it can
run inside the old host. No new CPU version register is implied.

### Build backend decision

The architecture and the choice of executor are separate decisions:

| Option | Assessment |
| --- | --- |
| Endpoint around existing scripts plus a dist watcher | Reject: preserves the missing input, dependency and publication contracts. |
| Redesign the BMSX target/artifact/deployment model; use esbuild and CMake/Ninja for their native work | Current recommendation. Can be a substantial migration across scripts, packer and deployment, not a wrapper-only change. Keep BMSX-specific planning small and do not reproduce backend compilation graphs. |
| Generate a unified Ninja/CMake graph for all products and media | Viable alternative. Gains a mature executor, but requires proper Node/asset actions and dependency generation; it does not supply immutable inputs or coherent publication by itself. Compare build setup, cancellation, no-op cost and invalidation before deciding. |
| Adopt a broader hermetic system such as Bazel throughout | Not ruled out by migration size. Its action model is a useful reference, but its custom-toolchain/platform integration has not been evaluated here. This audit does not justify either adopting or rejecting that migration yet. |

[Ninja's dependency scan](https://github.com/ninja-build/ninja/blob/master/src/graph.cc)
tracks command changes as well as input/output timestamps; its
[build executor](https://github.com/ninja-build/ninja/blob/master/src/build.cc)
propagates unchanged outputs through `restat`. Those mechanisms are materially
different from our current output-newer-than-files shortcut, but still are not
filesystem snapshots. [VS Code CMake Tools](https://github.com/microsoft/vscode-cmake-tools/blob/main/src/drivers/cmakeFileApi.ts)
uses CMake's structured target/artifact/dependency model. If Studio needs native
target discovery, consume the [CMake File API](https://cmake.org/cmake/help/latest/manual/cmake-file-api.7.html)
instead of scraping console text or reconstructing its graph.

Do not run two competing freshness planners for the same action. Dependency
membership changes, recipe changes and generated inputs must have one owner.
Native and esbuild builds are not automatically hermetic because their outputs
receive an artifact ID; input capture/reproducibility guarantees must be stated
per producer. No universal snapshot or speedup is claimed here.

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
content. Exact artifact identification is required; universal bit-reproducibility
and build-result caching are not claimed by this proposal. Cache reuse must not
be introduced before the complete dependency boundary is established.

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

Closing an observation stream stops observing, not building. Cancel is a separate
job operation: request producer cancellation and acknowledge the terminal result
only after the worker can no longer publish. If publication already completed,
cancellation cannot erase that artifact or report that no output was produced.
Stopping a composite Build-and-Load must also revoke its pending load intent.

A client-generated request correlation ID allows lookup after a lost acceptance
response. Reconnecting does not automatically POST another build. Distinct build
requests are not merged just because their target names match.

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
For **guaranteed live notifications**, connected CLI builds must submit to the
job owner or explicitly announce their committed artifact to the server. The
connection is configured through the existing authorized host surface, not
guessed localhost ports or a Studio dependency inside the compiler.

An offline CLI result can be discovered when the server opens/refreshes its
catalog. A watcher may prompt that refresh, but cannot be the correctness
mechanism. Therefore the earlier promise that *any arbitrary CLI rewrite of a
dist ROM automatically produces a reliable live notification* is withdrawn.
Producer-side publication integration is required for that guarantee.

Server restart needs its own explicit lifecycle: retain published results,
terminate owned workers, and distinguish interrupted jobs from successful or
cancelled ones. Do not silently rerun them or infer success from a ROM filename.
Recovery must reconcile committed publication records if the process stopped
between publication and reporting completion. Durable worker reattachment is not
part of this proposal.

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

The useful implementation order is the target/dependency/artifact model and its
producer/publication ownership, exact full-media installation, then server/UI/tool
orchestration. Migrate CLI/deployment callers onto that model rather than leaving
two planners indefinitely. A prototype endpoint must not define incorrect
lower-level behavior as its permanent contract. A larger build/deploy migration
is acceptable; a new generic framework is not a goal in itself.

Before implementation, resolve these remaining details against live owners:

- Enumerate every file-reading asset/compiler/lint path and its reusable input
  representation, including dependencies opened by third-party decoders.
- Specify the full package/resource refresh while retaining documents; identify
  every installation edge that updates media provenance.
- Choose the explicit connected-CLI publication path and artifact/log cleanup
  ownership. No reliable external-build notification claim precedes that work.
- Compare the preferred backend composition with a unified Ninja/CMake plan on
  real cold/no-op, changed-source, removed-input and changed-option builds. Include
  generated TS/C++ assets, browser workers and native build configuration; do not
  select a system from its feature list alone.

Acceptance must include observed output, not just typechecks or fixture tests:

| Situation | Required evidence |
| --- | --- |
| Change Lua plus a YAML/texture asset, build, then load | The real target executes the selected ROM and displays/reads the changed asset; compiled provenance and loaded artifact agree. |
| Type/save while an earlier build runs | Diagnostics refer to the captured input; newer drafts and undo survive loading the earlier artifact. |
| Two windows and two requests | Each request keeps its identity; only the explicitly chosen target loads. |
| Disconnect/reconnect or lose the acceptance response | The same job is observed, no duplicate build and no resurrected auto-load intent. |
| Cancel during build; cancel after publication | No publication after acknowledged pre-publication cancellation; completed artifacts are reported honestly. |
| Change BIOS, including with a second cart present | The dependency plan names a coherent set; no old import sidecar/new ROM mixture. |
| Perform source Reboot/Hot Resume after artifact installation | Installed provenance describes derived media, not the unchanged published build. |
| Run the configured connected CLI and an offline CLI build | Explicit publication drives live notification; offline discovery is not falsely described as guaranteed push. |
| Shut down the server or use standalone Studio | Capability status is honest; local IDE/Terminal work and no retry spam occurs. |
| Package a previously selected result after sources change | Deployment still contains the selected host/media, not a newly mixed build. |
| Keep a page open while publishing a newer Studio product | Its worker/static dependencies stay with its product generation; media updates and host restarts remain distinct. |

No runtime implementation, performance result or visible UI acceptance is claimed
by this research document.
