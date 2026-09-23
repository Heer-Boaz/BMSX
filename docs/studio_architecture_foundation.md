# Studio architecture foundation before agent integration

Status: foundation work in progress, 2026-09-23; gates 1-4 implemented and local
file/whole-workbench portions of gate 5 validated. The external process/tool
boundary remains open: Codex integration is **not admitted** by this work. The user requested the
whole IDE/Studio ownership model to be corrected first, rather than adapting an
agent to accidental UI internals.

## Target architecture

| Owner | Owns | Must not own |
| --- | --- | --- |
| Product composition | Workspace/session lifetime, concrete browser/Node resources and isolated-machine construction | Source-edit or test-case semantics |
| Workspace/source catalog | Canonical authored files, resource identity, source admission and persistence | A second editable copy reconstructed from ROM assets |
| Editor model/history | Text, revisions, dirty/saved identity, tracked ranges and cross-resource undo | Active tab, rendering, machine state or agent conversation |
| Workbench operations | Admission, captured inputs, pending lifetime and explicit results of Save/build/apply/run | Status-message parsing, implicit success from a queued callback, or hidden active-widget inputs |
| Language owners | Source syntax, binding, diagnostics and source-coordinate conversions | Cart-specific runtime policy or host object classification of guest values |
| Runtime tooling | Installed source correspondence, debugger plans and suspended guest inspection | Authored source ownership, host-heap reflection or retained guest references across execution |
| Test collection/run/results | Discovery, immutable accepted sources, case execution and retained results | Replacing/restoring the author's running machine or constructing frontend resources |
| Workbench contributions | Views, focus, commands, navigation and presentation of operation results | Private text/history, storage mutation or duplicate execution pipelines |
| Platform adapters | Filesystem/network/process capabilities and their lifecycle/security | Game semantics, editor selection or guest ABI |

The existing source-first Behavior Lens, Scene Editor, code/YAML views, Actor
Lab, Scenario Lab and Game View remain clients of these owners. A future Codex
contribution will have the same rights and boundaries; it does not get an
exception or an alternative source-writing route. This is not a generic plugin
framework, service locator or wholesale singleton-to-DI rewrite.

Each slice must improve an ordinary Studio workflow without Codex: reliable
Save feedback, actual execution results, isolated tests, shared edit history or
session lifetime. A future agent consumes those improvements; it is not the
reason to introduce parallel owners or to postpone unrelated product value.
Only contracts needed by the proposed agent capabilities are integration gates,
not every outstanding IDE feature or test-fixture issue.

## Eventual Codex position (design only)

The workbench remains authoritative; an agent is another client, not a second
editor or an emulator extension:

```text
Code / Scene Editor / Behavior Lens / Scenario Lab / future Codex view
                             |
      resource models + shared history + explicit workbench operations
                    /                         \
    canonical workspace storage         runtime and test owners

future Codex view <-> secured local transport <-> Codex App Server process
```

- A local process belongs to the Node/platform composition, never the machine
  or a guest Lua runtime. The browser view owns conversation presentation only.
  An agent request must not inherit the default blocking-pane pause policy.
- Context comes from resource/revision-aware workbench owners: selected source,
  diagnostics, current view and explicit runtime/test evidence. Missing semantic
  coverage stays missing; an empty code-tab cache is not a clean workspace.
- Proposed edits are reviewed and admitted against the workspace lifetime and
  exact model versions, then use existing shared history. Codex must not write
  files behind the models or invent a separate authored-data representation.
- Save, build, actual installation, guest initialization and tests expose their
  own results. A queued request or a status message is never proof of success.
- Conversation reconnect cannot revive retired proposals. Process lifecycle,
  authentication/origin checks and capability limits precede any privileged
  transport. The existing development server is not that security boundary.

The locally inspected Codex App Server is the candidate transport, not an SDK
embedded in Studio. Its protocol/tool support must be pinned and exercised when
integration is admitted. No process endpoint, agent pane, tool dispatcher or
network permission has been added by this groundwork.

## Live baseline

Inspected at `c55bf6d24` on `master`, with a clean checkout:

- Resource-owned `EditorTextModelService` and `EditorUndoRedoService` already
  provide version admission and joint multi-file history. Preserve them.
- `TextFileSave` currently mixes persistence, AEM application, toast/error UI and
  a `Promise<void>` result. Saves have no workbench-owned pending lifetime;
  shutdown cannot join them. Repeated Save may repeat the same write/application.
- Hot Resume captures authored revisions, but its promise can complete after
  compile rejection or before deferred installation. Reboot and guest-call
  completion have distinct lifetimes too. Do not disguise them behind one
  boolean command result.
- The isolated test runner owns case semantics correctly, but `testing/target`
  and `testing/run` import frontend composition/presentation owners. The strict
  architecture audit reports four existing violations at these boundaries.
- Diagnostics are currently keyed to retained code inputs; their cache has a
  source version. A future resource-based client must not equate missing cache
  entries with an error-free whole workspace.
- Source review currently presents single-model semantic impacts, not general
  multi-file text diffs. Document/history ownership is already general; review
  presentation is a separate, still unimplemented capability.
- The default editor pane suspends guest execution. A future live/long-running
  tool must explicitly select its execution policy, not inherit a network-length
  pause accidentally.
- The development HTTP server binds to all interfaces by default and permits
  wildcard CORS. It is not an admissible privileged process/agent transport.

Baseline: IDE typecheck passes; Lua suite **2255 passed, 1 skipped**; architecture
audit **4 issues**. These are automated baseline observations, not UI proof.

## Ordered implementation gates

1. **Result-bearing, session-owned source saves.** Capture once, serialize saves
   per working copy, share an in-flight save of the same revision, preserve newer
   edits, distinguish source persistence from AEM build/application failure,
   and drain admitted saves before source/session teardown. UI presents the
   result; it cannot manufacture it. Recovery observes actual model saves.
2. **Isolated test-machine ownership.** Keep case execution/results in testing;
   place real machine/presentation resource ownership below the feature and
   supply it at the composition boundary. Delete the backward dependencies,
   rather than exempting test features from the audit or moving the same invalid
   composition behind a facade.
3. **Execution operations and source evidence.** Make build rejection, deferred
   installation, actual installation, initialization and guest failure observable
   at their real owners. Keep authored, locally persisted, remotely persisted
   and installed state distinct. No generic operation bus or parallel scheduler.
4. **Resource-oriented context and proposal lifetime.** Diagnostics/context and
   future reviews reference a workspace lifetime, resource and source revision.
   Source/cart changes retire proposals; reopening cannot revive old edit rights.
   Existing model history remains the only writer.
5. **Platform and whole-workbench validation.** Account for shutdown/reconnect,
   input ownership, runtime holds and transport security. Validate source, visual
   and test workflows on the same owners, with browser-visible evidence distinct
   from headless/model tests. No Codex process until these relevant gates pass.

Each completed gate must carry implementation, tests and updated owner contracts
in a coherent commit. Partial work is not a declaration that the entire IDE is
architecturally correct. New findings amend this plan, not permission to drift
into unrelated cartlib, CPU, renderer or hardware changes.

## Production references studied

- VS Code [`TextFileEditorModel.save/doSave`](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/services/textfile/common/textFileEditorModel.ts#L733-L826)
  owns pending saves and revision identity; completion does not clean newer
  edits. BMSX keeps its own smaller snapshot/history representation and does not
  copy VS Code's compatibility checks, save participants or DI framework.
- VS Code [`StoredFileWorkingCopy`](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/services/workingCopy/common/storedFileWorkingCopy.ts#L834-L950)
  separates saved/dirty state from pending-operation lifetime.
- VS Code [`TestService`](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/testing/common/testService.ts)
  separates run requests/controllers from result ownership. BMSX's accepted test
  isolation remains a physical machine per case, not editor-state rollback.
- VS Code [`BulkTextEdits`](https://github.com/microsoft/vscode/blob/1fe7285a1162756215a684ee702b16d0ce42bdb4/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts)
  admits model versions and uses shared history; BMSX already has this boundary.
- MAME [`mame_machine_manager::execute`](https://github.com/mamedev/mame/blob/mame0280/src/frontend/mame/mame.cpp#L279-L312)
  constructs/runs/releases each physical machine at frontend composition. BMSX
  keeps its existing bounded scheduler and raw ICU input, not MAME's framework.

## Performance and representation constraints

All added coordination is at explicit user-operation and lifecycle boundaries.
No new CPU hooks, per-frame source serialization, polling saves, redundant
parsers or duplicated authored databases. Stable-frame UI reads retained state.
No TS/C++ machine representation change is part of these foundation gates; a
later proposal requiring one must supply the mirrored representation/callsite
audit before editing.
Gate 3's audit found a prerequisite violation of the existing physical completion
call contract. Its separately audited TS/C++ correction uses existing frame
bits and boundary scans, not a new representation or IDE state in the machine;
see [completion-call boundaries](completion_call_boundaries.md).

## Implementation evidence

### Gate 1: accepted Save lifetime

Implemented `TextFileSaveService`, explicit source/application outcomes,
per-resource sequencing/coalescing, shutdown drain, command-side feedback and
model-save-driven recovery. No new per-frame work. The workspace record owner's
local/remote persistence distinction remains as documented above; this gate does
not claim remote acknowledgement or change Hot Resume completion semantics.

Validation:

- IDE typecheck; Lua suite **2264 passed, 1 skipped**, including nine new save
  admission/lifetime/failure/ownership cases.
- Headless Studio user-I/O author/run/live-edit: **1 passed**; canonical YAML
  edit/save in Pietious and Nemesis: **2 passed**. The saved Nemesis screenshot
  was inspected; these remain automated UI workflows, not manual-only evidence.
- Browser software workflow passed its actual AEM apply/rejection/retry and
  source-save checks, then failed in the unrelated behavior-source fixture at
  `studio_behavior_source.ts:71` (`entries[0].field.range` has the old AST shape).
  The same failure was reproduced in a separate unmodified `c55bf6d24` worktree.
  The full browser workflow is **not green** and remains a gate-5 issue.
- Changed-file indentation and `git diff --check` passed. The four pre-existing
  test/composition architecture violations remain for gate 2.

### Gate 2: physical test-target construction

Implemented a type-only test-target contract and injected creation at Studio/CLI
composition. `OffscreenMachine` owns real machine/render resources; `TestRun`
owns case input and policy. The concrete machine is returned directly, without
a wrapper. Player and offscreen construction share socket-image decoding at its
existing media owner. The boundary rules are unchanged, and the strict audit is
now **0 issues** rather than four.

Updated the obsolete Scenario-run section of `ide/ARCHITECTURE.md`: it still
described the deleted callback protocol and same-authoring-machine restore path.
The live isolated-run owners, not that old prose, determined this slice.

Validation:

- IDE, browser-host and Node-host typechecks pass. Lua suite **2264 passed,
  1 skipped**; ROM packer suite **138 passed**. The latter covers O0/O3 real
  execution, ICU waits/capture, cancellation, both sockets, failed-target
  lifetime and product-construction failure. Unit-case probes reject renderer
  or presenter access.
- Browser Studio and Node tooling product builds pass. Through rebuilt Node
  tooling, five empty-cart BIOS unit cases and Nemesis
  `held_fire_cadence` pass through the actual CLI.
- Actual WebGL2 Studio test-runner workflow passes: named failures/successes,
  teardown, source rerun, retained isolated failure, cinematic execution and
  cancellation. The named-results screenshot was inspected. This is automated
  browser evidence, not a manual-only claim.
- One serial 24-case profile per checkout: baseline `c55bf6d24` **5.812 s**, new
  owner **5.905 s**; median case **230.76 / 235.13 ms**, peak process RSS
  **284.85 / 265.87 MiB**. Both use **35,091,168 boot cycles** per case and pass
  the existing 512 MiB gate. This small sample is not a general performance
  guarantee or a statistically significant regression estimate.
- The full tests-project typecheck has **112 pre-existing diagnostics**,
  confirmed by comparison with the unchanged baseline. The normalized diagnostic
  list is identical after this slice. It remains a validation debt alongside
  the broad browser fixture failure above, not a passed typecheck.

Gates 3-5 remain open. In particular, zero forbidden imports does not prove
correct operation completion, resource-context lifetime or platform security,
and does not admit Codex integration.

### Gate 3a: Hot Resume results (partial gate 3)

`HotResumeService` now owns captured inputs and request lifetime; the existing
runtime/debugger owners report admission, installation, completion, rejection,
physical fault, infrastructure failure and cancellation. Init batches follow
their actual thread, including nested requests and coroutine switches. No second
scheduler or agent-specific route exists. Reset/shutdown retire open operations;
command feedback follows the latest request rather than stale callbacks.

The audit also found completion errors escaping through the interrupted game's
`pcall`/coroutine boundary. That generic TS/C++ prerequisite was fixed separately
using existing physical return-route bits, with eight previously failing O0/O3
probes and 28 full TS/C++ snapshot-parity vectors. The CPU has no source revision
or operation metadata.

Validation and reproduction are recorded in
[Studio execution operation results](studio_execution_operations.md): focused
software/WebGL2/WebGPU Studio workflows, source-capture and real supervisor
fault/recovery checks, Node no-op heap probe (47 assertions), 2275 Lua passes
(1 skip), 147 ROM packer passes, successful product builds/typechecks, and zero
architecture boundary issues. The tests-project baseline remains exactly 112
diagnostics; the broad behavior-source browser fixture is still a separate
known failure. This is automated runtime/UI evidence, not UI-only development.

### Gate 3b: exact source-save acknowledgement (partial gate 3)

The workspace record owner now reports whether the exact write reached the
project-file provider or only local storage. Lua, YAML and AEM carry the same
result through their existing save owners. Commands warn about local-only saves
and independently report failed runtime application. Reconnect preserves later
unsaved model edits. No extra storage layer, retry worker or frame-time work was
introduced. Contract, production references and validation are recorded in
[source save acknowledgements](studio_source_save_acknowledgements.md).

### Gate 3c: startup and Reboot results

`BootService` now owns captured inputs, preparation, installation, physical reset
and request lifetime. Run-menu, quick-menu and headless Reboot share the existing
queue and result. Source rejection preserves stopped execution; newer queued
requests, external reset/restore and shutdown retire old work. Startup source
rejection now retains the independent launch hold when the editor closes,
repairing a reproduced reset-observer ownership bug. Successful startup performs
one physical reset instead of two. Reset completion deliberately says nothing
about arbitrary, potentially non-terminating guest initialization.

The [boot contract and validation](studio_boot_operations.md) record eleven
real-runtime service tests, software/WebGL2/WebGPU browser workflows including
ordinary Run/quick-menu input, a nine-assertion rebuilt Node workflow, Hot Resume
and source-save regressions, 2280 Lua passes (1 skip), 158 ROM packer passes,
successful product builds/typechecks and zero architecture issues. Automated
runtime/UI evidence remains distinct from UI-only authoring. The 112
tests-project diagnostics and broad behavior-source fixture debt remain visible.

**Gate 3's scoped operation/source-result work is implemented.** Gates 4 and 5
remain open. Codex integration is not yet admitted; resource/context lifetime and
platform security do not follow from successful Save/Reboot operations.

### Gate 4a: resource diagnostics and document disposal

The session-owned diagnostics service now covers working copies independently
of code tabs, retaining exact model/revision results and explicit missing,
pending, unsupported and failed coverage. Source-registry/model events retire
dependent results, including unchanged consumers. Shared history rejects foreign
or disposed models before any source invalidation; reviews observe document
disposal. Shutdown releases model/semantic owners after persistence drains.

[Resource context evidence](studio_resource_context.md) records 2290 Lua passes
(1 skip), 158 ROM passes, green product typechecks/builds, zero architecture
issues, real visual-only diagnostics/Problems/navigation/Undo/shutdown browser
evidence, cold session reload and rebuilt Node operation regressions. The
tests-project baseline remains 112 diagnostics. General multi-file review and
the platform/security gate remain open; no agent integration is admitted yet.

### Gate 5a: local file-transport authority

The development server now defaults to loopback. A per-process capability and
Host/origin admission protect file IO; traversal/symlink escapes and wildcard
CORS are removed. Explicit LAN presentation has no workspace capability.
The browser file provider coalesces admission and renews only explicitly rejected
sessions; ordinary source-save acknowledgements and reconnect keep their owners.

[Platform boundary evidence](studio_platform_boundary.md) records six real HTTP
process probes, three provider lifetime probes, 2293 Lua passes (1 skip), green
product typechecks/browser build, zero import-boundary issues and actual Save,
resource-context, cold-session and isolated-test browser regressions. This is
not a process sandbox or permission to attach Codex: general multi-file review
and whole-workbench validation remain open.

### Gate 5b: whole-workbench browser regression

Repaired the broad Studio test fixtures to consume the current snapshot-owned
AST locations and source-edit APIs. The fixtures no longer fabricate a second
semantic document. Session checks and the capture profile now account for all
actual editor input kinds. No product behavior or authored cart was changed.

Validation against the owners from gates 1-5a:

- The complete `--studio` browser workflow passes on **software, WebGL2 and
  WebGPU**, including code/visual shared-source edits, cross-file Rename and
  Undo/Redo, Behavior Lens, Scene Editor, real test-target execution/cancellation,
  debugger/Run controls, pointer ownership and both Studio fonts. WebGPU also
  passes actual asynchronous VRAM readback checkpoints. The final WebGL2
  screenshot was inspected. These are automated browser workflows, not UI-only
  authoring evidence.
- Rebuilt Node classic entry-edit/Hot Resume workflow: **93 assertions passed**.
  Its supervisor probe uses the current TS hardware specification, not a
  remembered address from a different hardware layout.
- Tests-project typecheck debt drops from **112 to 99 diagnostics**, with none
  remaining in `tests/conformance/runtime_replay`. The whole tests-project
  typecheck is still not green.
- Session capture profile at 4/32/128 source documents (12/96/384 inputs) reads
  each source snapshot once. Unchanged capture measured 12.3/78.2/307.6 us;
  capture plus encoding 17.5/108.5/543.6 us. This is a single size-scaling probe,
  not a before/after or universal performance claim.
- Changed-file indentation and `git diff --check` pass.

The earlier broad-workflow fixture failure is resolved. General multi-file
review and remaining lifetime admission still precede agent integration; browser
coverage alone does not establish those architectural contracts.

### Gate 4b: captured context and general multi-file review

Implemented explicit source-reading contexts, one-shot workspace proposals and a
transient review pane. Ordinary Rename can now preview all edited files and then
apply through joint history, without saving/installing or holding guest execution.
Context lifetime starts before delayed results, observes catalog/dependency
changes and retires even on empty-workspace teardown. Session persistence omits
review inputs by construction; it cannot restore old edit rights.

[Workspace edit review](studio_workspace_edit_review.md) records owner contracts,
production references, 2309 Lua passes (1 skip), actual multi-file review and
shared Undo/Redo browser evidence, complete WebGL2 and cold-session regressions,
preparation/reflow measurements, product validation and the remaining 96
tests-project diagnostics. Source/resource/review foundation gates are now
implemented. The next admission concerns the real external process/protocol and
its capabilities, not another editor-specific source-writing path.

### Gate 5c: real external-process contract audit (adapter still open)

[Codex process admission](studio_codex_process_contract.md) pins the locally
generated 0.156.1 protocol and records five real-process/offline-model probes.
They prove dynamic tool round-trip, rejected shell/patch calls, interruption and
EOF teardown. The audit also disproved a security assumption: an empty MCP map
override retains inherited servers and can still launch their processes. The
adapter must own its profile/working directory and capability admission; merely
adding auth to a generic JSON-RPC proxy is explicitly rejected. No production
agent endpoint or account connection is admitted by these tests.

### Gate 5d: owned local process adapter

The [Node adapter](studio_codex_process_contract.md#owned-node-adapter) now owns a
private profile/process directory, exact external version/config admission,
continuous stdio correlation and explicit connection/turn lifetimes. Cancellation
retires tool rights immediately, joins actual process exit and cannot replay a
late reply into a new turn. Configured MCP inheritance is rejected before thread
creation. This is a real adapter exercised with the actual CLI and an offline
model fixture, not a public JSON-RPC tunnel. Browser transport, account connection
and the visible workbench assistant remain unconnected.
