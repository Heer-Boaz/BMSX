# Studio resource context and lifetime

Status: resource diagnostics and document lifetime implemented, with the later
[multi-file review](studio_workspace_edit_review.md) and
[assistant contribution](studio_assistant_contribution.md) consuming those owners.
The original pre-implementation audit below was at `0f2f709bc`.

## Live owner findings

- Text models already own source/version and shared multi-file history. Model
  resolution fences asynchronous reads at workspace teardown. A retained model
  instance, not a path plus a resettable version number, identifies its lifetime.
- Bulk-edit admission currently checks version/writability but not membership
  in its history owner. A proposal retaining disposed or foreign models can
  reach source invalidation/history writes before failing.
- Source review closes on source edits, not document disposal. Its accepted
  input must retire when the document owner releases it, including when an
  identical resource/version is subsequently reopened.
- Diagnostics are keyed to `CodeEditorInputId`, scheduled by global timers and
  only dirtied by changes to a retained code input. Visual-only working copies
  lack diagnostics. Cache entries can survive workbench replacement; dependency
  changes do not invalidate another document's version-only cache. YAML receives
  an empty entry despite having no diagnostic provider.

## Direction

Keep model/history as the only source writer. Admission proves that every
target belongs to this live history before the first invalidation/write. Model
disposal retires review/control observers synchronously, without rollback,
path-based resurrection, a second source store or runtime metadata.

Save has the same resource-lifetime admission: its concrete session model owner
must still hold the exact model instance before snapshot capture or persistence.
Matching resource paths and version numbers cannot admit a retired/foreign copy.
Already accepted writes still drain before teardown; they are not cancelled or
rolled back midway. Two probes failed before this correction; all 16 Save tests
and the IDE/browser/Node typechecks pass afterwards.

Diagnostics belong to a session-owned resource service above the shared
semantic project. Results name resource and model revision; unsupported,
pending and unrequested coverage must not be presented as a clean workspace.
Problems and code squiggles project that service, not the other way around.
Closing a code tab is not document disposal. Workspace teardown cancels timers
and retires queued computations. Unchanged frames do not scan source or create
context snapshots.

General text-edit review and platform security follow these owner corrections;
neither an agent protocol nor an extra generic operation bus is introduced here.

## Implemented contract

`ResourceDiagnosticsService` is created by workbench composition and retires with
that session. It retains model/revision result identities and explicit coverage:
ready, pending, unsupported, failed, or no entry (unrequested). It batches queries
by domain against the existing incremental semantic project; it does not create
another source store or parser. Lua global/dependency edits invalidate retained
consumers, including consumers whose own model version is unchanged. Registry
source revision events cover discovery, overrides and generated source changes
without a code-input/model event. Model-owned source shadows its saved base.

Only source/lifetime events invalidate results. Visibility enables background
work, not document lifetime. The existing clock/background queue schedules work;
there is no frame-time poller and font changes no longer trigger analysis.
Disposal cancels timers and retires queued task identities. Problems reports
coverage and navigates to the exact live source model. Editor rows retain only
their squiggle projection.

The shared history now rejects disposed/foreign targets before notifying or
editing any participant. Source-review observers retire synchronously on model
disposal. Actual shutdown releases semantic/model owners only after source and
workspace persistence drain. No capture/restore, path-based resurrection or
second undo service was introduced.

## Validation

- Three new lifetime probes failed against the pre-fix implementation; all pass
  now. Eight resource-diagnostics cases cover visual-only models, coverage,
  dependency/system/socket changes, unopened source discovery/overrides,
  failure, hide/resume, queued disposal and retained-result reuse. One obsolete
  tab-cache ownership test was replaced by resource-level coverage.
- Full Lua suite: **2290 passed, 1 skipped**. ROM packer: **158 passed**. IDE,
  browser and Node typechecks/product builds pass; strict architecture audit
  remains **0 issues**. The full tests-project baseline remains 112 diagnostics;
  this is still known validation debt, not a passing check.
- Actual WebGL2 browser scenario `--studio-resource-context` passes: Scene Editor
  without a code input -> background error -> Problems keyboard navigation ->
  shared model -> tab close -> Undo -> actual workbench shutdown with queued
  diagnostics. YAML coverage remains unsupported. Guest actor, installed media
  and cycles remain unchanged throughout analysis. Both visual/source screenshots
  were inspected. This is automated browser evidence, not UI-only authoring.
- Actual WebGL2 `--studio-session` passes cold page reload. Rebuilt Node boot
  workflow passes 9 assertions; Hot Resume heap workflow passes 47 assertions.
- A 100-cycle unchanged-result probe adds no parses/publications and preserves
  result/marker-array identity. Retained Problems painter profile: 16 vs 1024
  markers takes about **12.0/12.2 us** (tiny font) and **9.3/9.2 us** (MSX), with
  equal visible command counts. This measures painter work, not whole-frame or
  semantic-query performance, and is not a before/after performance claim.
- Changed-file indentation and `git diff --check` pass.

## Production references studied before implementation

- VS Code's [model service subscribes to document disposal](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/editor/common/services/modelService.ts#L30-L45).
  BMSX uses its own model lifetime, not VS Code's closed-file history cache.
- [Bulk text edits](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts#L195-L281)
  retain model references and admit versions before applying shared history.
  BMSX also admits ownership before any participant's pre-edit notification.
- [MarkerService](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/platform/markers/common/markerService.ts#L139-L186)
  owns markers by resource and producer, independently of editor widgets.
  BMSX does not copy marker normalization, extension DTO checks or service registries.

## Follow-through: semantic projects belong to their document owner

Preparing source-bound assistant diagnostics exposed an owner mismatch: the
resource service accepted an explicit `EditorTextModelService`, but its semantic
project lookup always used global editor models. A regression reproduced a foreign
working copy shadowing an unopened dependency with the same path. This was fixed
at the shared semantic registry before exposing another tool, not hidden behind
an assistant-specific parser or a copied set of source files.

Project lookup and reset now require the concrete document owner plus execution
domain. The registry retains one project per pair; ordinary code, highlighting,
Rename, visual-source views and diagnostics still share their existing project's
incremental deltas and immutable snapshots. `ResourceDiagnosticsService` passes
its actual owner to analysis. Model-owner clear automatically disposes that
owner's projects, including when the models have no visible inputs. Equal paths
and reset version numbers in a reopened workspace cannot revive an old project.
Resetting or clearing one owner does not touch another. No compatibility overload
silently chooses global models.

Admission adds one constant-time owner lookup to semantic-project access. There
is no source scan, alternate parser, extra background task or per-frame context
capture. One teardown subscription is retained per document owner, even after
repeated resets. The existing semantic environment/builtin and diagnostic
scheduling owners are unchanged.

Validation:

- The foreign-owner diagnostic case failed before the fix; it now passes.
  Three additional ownership tests cover isolated same-path documents, automatic
  clear/reopen, immutable retained snapshots and scoped reset. Two thousand warm
  queries reuse their exact snapshots with **zero parses**; 100 resets retain
  exactly one teardown subscription.
- Full Lua suite: **2348 passed, 1 skipped**. IDE/browser/Node typechecks and both
  product builds pass; strict architecture audit: **0 issues**. The tests-project
  typecheck retains the same **96 diagnostics** after normalizing source locations;
  it is not green. Changed-file indentation and `git diff --check` pass.
- The actual resource-context browser workflow passes on software, WebGL2 and
  WebGPU: visual-only diagnostics, Problems navigation, shared Undo and shutdown,
  with unchanged guest state. This is automated browser evidence, not UI-only
  authoring.
- The existing model-sync/behavior-index size probe at 1/64/256/1024 models
  measured warm retained reads at **0.016/0.031/0.037/0.036 microseconds**, and
  edit-plus-Undo queries at **0.37/0.94/0.86/7.14 ms**. These are one-run scaling
  measurements, not a before/after comparison or an inference-latency guarantee.

The same production ownership principle was checked against VS Code's
[resource marker service](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/platform/markers/common/markerService.ts)
and Copilot's pinned
[diagnostics tool](https://github.com/microsoft/vscode-copilot-chat/blob/5863f5a7088958050792b5dccbe8b46c6e13eccc/src/extension/tools/node/getErrorsTool.tsx):
the client consumes the language service instead of constructing another analyzer.
BMSX keeps explicit unsupported/unrequested coverage rather than copying the
reference tool's missing-file-to-empty-result behavior.
