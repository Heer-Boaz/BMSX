# Studio architecture foundation before agent integration

Status: implementation preparation, 2026-09-23. Codex integration is **not
admitted** by this work. The user requested the whole IDE/Studio ownership model
to be corrected first, rather than adapting an agent to accidental UI internals.

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

## Performance and representation constraints

All added coordination is at explicit user-operation and lifecycle boundaries.
No new CPU hooks, per-frame source serialization, polling saves, redundant
parsers or duplicated authored databases. Stable-frame UI reads retained state.
No TS/C++ machine representation change is part of these foundation gates; a
later proposal requiring one must supply the mirrored representation/callsite
audit before editing.

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
