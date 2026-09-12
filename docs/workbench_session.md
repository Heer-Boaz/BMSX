# Workbench session restoration (A07)

Status: A07 complete for the contracted workbench session surface.
Source/input/group admission and contribution-owned session serialization are separate.
Broader behavior authoring and full-host/physical-target performance remain open.

## Production references

VS Code at `7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca`:

- [`EditorGroupModel.serialize/deserialize`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor/editorGroupModel.ts#L1163-L1280):
  the group owns ordered inputs and active/preview topology; concrete editor
  serializers own each input's representation.
- [`IEditorSerializer`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor.ts#L460-L478):
  a contribution reconstructs its editor, rather than a workspace storage layer
  classifying editor implementation fields.
- [`AbstractEditorWithViewState`](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/browser/parts/editor/editorWithViewState.ts):
  capture the current view at clear/close/save while the input still lives.
  A view-state value is not the editor widget, its disposable subscriptions, or
  an executable document. No polling/serialization of every input on each frame.

The compatibility readers, optional third-party extension recovery and fixed
memento capacity in that application are not BMSX requirements.

## Verified live boundaries

| State | Current owner | Consequence |
| --- | --- | --- |
| Accepted source text, dirty baseline and Undo | `EditorTextModelService` / `EditorTextModel` | One working copy may have code, scene and several behavior inputs. Backups stay per resource, not per tab. |
| Input identity / label / disposal | `AbstractEditorInput` and contribution input classes | A resource path alone cannot identify two FSM views in one file. Do not merge those inputs. |
| Tab order, active and preview | `EditorTabGroupModel` | These must be restored as group state, not inferred from dirty files or the first code tab. |
| Control attachment / focus | `EditorPanes` | Resolve inputs and their source models before attaching the chosen active pane. No host Lua calls or runtime replacement. |
| Source selection and viewport | Existing contribution navigation selections | Their source bookmarks and view coordinates are useful, but the disposable navigation objects are not a storage format. |
| Dirty record generation / local-remote publication | `workspace/storage.ts`, `autosave.ts`, source override owners | Preserve the existing generation/record arbitration; session metadata does not make stale source authoritative. |
| Browser final local checkpoint | `ide/browser/studio.ts` `pagehide` → `persistWorkspaceSessionLocally` | This path already exists. Do not invent another browser unload pipeline. |

At the A07 audit, `WorkspaceAutosavePayload.codeEditorViews` only contained views of dirty
models. `applyWorkspaceAutosavePayload` clears the models and initializes the
entry tab, then restores dirty files/code coordinates. That cannot restore clean
tabs, tab order or visual inputs. This is separate from the corrected missing-
metadata crash. `persistWorkspaceSessionLocally` already captures an `All`
generation synchronously; the missing part is the editor session representation.

At the audit there was also a lifecycle dependency: `CartEditor.shutdown` disposed
Scenario Lab and the panes before its final workspace save. A visual-input
snapshot must be taken while those owners still exist, after ordinary focus/
capture detachment has finished accepted edits. Capturing after destruction and
reconstructing missing values would be the wrong boundary.

## Implementation contract

1. **Contribution-owned view-state values.** Separate the existing plain source
   bookmarks/viewport values from the navigation selection's live subscriptions.
   Navigation and persistence consume the same capture/restore implementation.
   Do not stringify an `EditorPaneSelection`, AST, graph layout, input or model.
2. **Registered input serializers.** Use the same typed contribution/factory
   structure already used by `EditorPanes`. Each of the five current input kinds
   owns its identity and view payload; the group owns only ordered envelopes and
   active/preview selection. No `instanceof` cascade in autosave and no fake code
   tab created merely to represent a visual input.
3. **Independent group and backup state.** Replace dirty-only code-view metadata
   with editor-session state while retaining resource-owned dirty records.
   Hydrate admitted working copies before deriving visual inputs, then restore
   the group and attach its actual active pane. Multiple behavior inputs sharing
   one working copy remain distinct. The source stays canonical Lua.
4. **Existing checkpoint/lifetime owners.** Group changes and normal workspace
   saves publish metadata; the existing pagehide checkpoint captures the current
   accepted state. Shutdown captures before disposing contribution owners.
   Pending widget drafts, captures, popups and worker tasks are not workspace
   state. Autosave must not force an in-progress property draft to commit.
5. **Source-generation admission.** A newer ROM/canonical source can legitimately
   reject an older dirty record: `workspace_storage.test.ts` already proves this.
   Keep that source-owner decision. Source-dependent positions must not be applied
   as if they belonged to the rejected bytes. Preserve editor topology separately
   from whether its old source selection can be restored; never choose a nearby
   FSM/BT as a substitute. This is current record arbitration, not old-format
   support. No compatibility reader or fallback payload is authorized.

Persistent scope is workbench context: code/resource views, scene selection and
scroll, distinct behavior occurrences with selection/pan/zoom, and Scenario Lab's
test-side context. A Scenario Lab input is not its runtime task/result history.
Guest state, active tests, recorded runs, rewind history, playback and host pause
are not recreated by workspace restoration.

## Required evidence before marking A07 complete

- Independent source fixtures, not game-specific line/definition assertions.
- Round-trip clean and dirty models, code + scene + two behaviors in one file,
  active visual input, tab order, preview, source selection and pan/zoom.
- One restored working copy shared by its views; source navigation stays clean;
  accepted dirty text is restored exactly. No promise to serialize Undo history.
- Newer-source rejection, deleted selected occurrences, and exact domain identity;
  no foreign AST ranges interpreted against another buffer.
- Real browser reload using the existing local-storage/pagehide path, not merely
  calling the deserializer against the same live input objects. Test cold source
  derivation and asynchronous graph layout before asserting restored geometry.
- Snapshot before shutdown disposal and after valid focus-detachment semantics;
  invalid/uncommitted widget text must not become canonical source accidentally.
- Measure idle/checkpoint work and retained state with increasing tab counts.
  No per-frame source scan, serialization or semantic analysis.
- Existing full Studio/source/Undo gates on software, WebGL2 and WebGPU, ordinary
  type/audit/build gates, and an honest record of remaining A08 hardware limits.


## Landable prerequisite: admission, not persistence (2026-09-12)

The owner pass found that `ResourceEditorResolver` selected a contribution without
activating it, but the built-in factories still inserted tabs. Backup loading
therefore required a code/editor input merely to acquire its working copy. This
was not a serializer problem and could not be hidden behind a serializer API.

- Lua/AEM source admission is now `working_copy/text_file_model.ts`. AEM loading
  uses `EditorTextModelService.resolve`: one in-flight read per full identity,
  existing dirty model preserved, read errors forwarded, pending generation
  retired on workspace clear. No empty intermediate source or hidden code view.
- Code/viewer factories return inputs without group membership changes.
  Separating the resource viewer's content refresh from its scroll state still
  belongs to the subsequent contribution view-state work.
- `openEditorTab` owns admission before activation. The group deduplicates input
  identity and releases unused candidates; a surviving input's view is retained.
  This covers source/Back reopening and runtime-error source navigation too.
- Recovery loads admitted source models first. Its current code-view metadata
  explicitly creates those views afterward. This is not yet the new session
  format and does not claim to restore clean tabs or visual selections.

References beyond the serializer work:
[VS Code text model manager](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/services/textfile/common/textFileEditorModelManager.ts#L337-L460)
separates model resolution and in-flight reads from editor views;
[editor group opening](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor/editorGroupModel.ts#L290-L436)
resolves an offered input against existing group membership. BMSX does not copy
its third-party extension recovery or legacy format branches.

Evidence is recorded after the full gate below. The focused real Studio gate
already fails against `0d3ee8355` at the no-group-mutation assertion, and passes
on software/WebGL2/WebGPU with the new owners. It also verifies concurrent input
admission, preview retention, clean source and unchanged paused-machine cycles.
Independent model tests cover coalesced reads, errors and teardown during a
pending read, including the successor generation. No per-frame callback, scan,
serialization or semantic query is introduced by this prerequisite.

### Admission prerequisite validation

- Full Lua suite: **1582 tests, 1581 pass, 1 existing skip**. Targeted workspace
  tests also pass after removing the now-unused editor resolver from the restore
  fixture, proving that backup hydration has no editor-factory dependency.
- IDE TypeScript passes; tests TypeScript has the same **51** normalized baseline
  diagnostics, with no additions/removals. Architecture boundaries reports zero
  issues; core parity, indentation, browser build and `git diff --check` pass.
- Full Studio and Pietious source/navigation workflows pass on **software,
  WebGL2 and WebGPU**, with actual isolated source transport and fault gates.
  The tiny-font software output was inspected. These are browser conformance
  results, not a claim about every physical device or manual UX use case.
- The first broad run caught an introduced preview-pinning regression in Back.
  It was corrected at navigation: live destinations activate without pinning;
  resource history can reopen a preview and does not unpin an existing pinned
  input. A dedicated history test and all final browser runs cover this case.
- The added source-resolution work runs on explicit load/restore, not the frame
  path. Deterministic tests count source reads and retained models. No checkpoint
  latency, end-to-end GC or SNES Mini performance claim follows from those counts.
  The actual A07 session capture/restore performance gate is still open.

Artifacts: `/tmp/bmsx-session/`; final admission logs have
`*-admission-final.log`, with the separate focused old/new browser comparison in
`baseline-resolution.log` and `smoke-resolution.log`. The earlier
`studio-admission.log` intentionally records the failed intermediate Back case.


## Contribution sessions and detached controls (2026-09-12)

The workspace now stores an `editorGroup` independently of `dirtyFiles`, replacing
`codeEditorViews` rather than maintaining a second compatibility format. The group
owns order and active/preview indices, with opaque `{kind, value}` envelopes.
Each of the five contributions registers its serializer at composition. Plain
`view_snapshot.ts` values are also used by the existing navigation selections;
only live navigation subscribes to text changes. Persistent copies never acquire
model subscriptions or mutate with later Undo.

Code snapshots use UTF-16 cursor/anchor offsets. Scene snapshots use mapped
root/member ranges. Behavior snapshots identify registration and subtree-use
occurrences, including pending hidden-edit bookmarks. Two views of the same
source model remain different inputs. Scroll/zoom restoration waits for the
actual retained geometry, including the asynchronous FSM worker. A source
fingerprint (length and existing `hashText`) is cached once per buffer version;
changed admitted bytes do not receive old source positions. This is a
non-cryptographic view change detector, not proof of source identity under
adversarial collisions. No whole source is duplicated in each tab payload.

Scenario Lab persists only its test selection, scope expansion and scroll, not
its test runtime or results. Resource viewers persist resource identity and
scroll and resolve content from the correct socket's package. Restoration does not depend on preserving old viewer objects. The separate
resolve-time content/scroll coupling found in this pass is addressed below.

The real reload uncovered a missing pane boundary, not an autosave-null case:
non-code panes closed the old code search and measured their content using the
old code gutter after the code widget had detached. Cleanup now belongs to
`CodeEditorPane.clearInput`; the widget explicitly has no model/view while a
visual pane is active. Workbench content bounds are shared without calculating a
text gutter. Workbench resize dispatches to the attached pane's layout capability.
Closing Find preserves the code selection, matching
[VS Code FindWidget._hide](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/contrib/find/browser/findWidget.ts#L625-L647).
No stale widget is retained to make a visual editor work.

`browser_studio_session.ts` uses the actual Studio composition and product file
API in an isolated workspace. A genuine page navigation fires the production
pagehide checkpoint; the subsequent import has fresh models, controls, runtime
and workers. The independent authored fixture keeps `module<entry>` because
recovered source overrides participate in the existing cold-boot compiler path.
This is not a new promise to execute an older ROM while retaining unbuildable
recovered source. Pause and rewind are deliberately not restored as workspace
state. Shutdown evidence reads the persisted record after input disposal, rather
than asserting only that the inputs had once existed.

### Final session validation

- Lua: **1590 tests, 1589 pass, 1 existing skip**. The focused session/storage/
  bookmark/code-binding set has **71/71** passes. Hidden reparent bookmarks are
  captured without parsing and survive JSON round-trip without selecting another
  shared initializer occurrence; later Undo cannot mutate the persisted copy.
- IDE TypeScript, strict architecture boundaries (**zero issues**), core parity,
  indentation, debug browser build and diff checks pass. Tests TypeScript retains
  the same **51 normalized baseline diagnostics**, no additions or removals.
- The actual page-reload, full Studio, and Pietious source/navigation suites pass
  on **software, WebGL2 and WebGPU**. Reload additionally checks first activation
  of both BTs, asynchronous FSM geometry, original code selection, an unchanged
  focused draft and the actual local session record after shutdown. Tiny-font
  software output was inspected. No physical device was exercised.
- `profile_workbench_session.ts` measured actual contribution captures plus JSON
  encoding with 33,265 source characters per document and three inputs per model:

  | Documents / inputs | First capture | Warm capture + encoding | Serialized characters | Retained probe heap |
  | --- | --- | --- | --- | --- |
  | 4 / 12 | 1.499 ms | 0.016 ms | 5,455 | 1,168,528 B |
  | 32 / 96 | 2.133 ms | 0.105 ms | 43,433 | 2,657,272 B |
  | 128 / 384 | 5.554 ms | 0.566 ms | 173,789 | 8,100,720 B |

  One initial snapshot read per working copy; zero additional source reads
  during repeated cursor checkpoints. Warm unchanged captures cost 0.011,
  0.076 and 0.330 ms respectively and return the preceding group value. The
  measurements ran without concurrent builds/tests/browser runs. Heap figures
  include fixture working copies, source projections and inputs after explicit
  Node GC; they are not just the new mementos' footprint. Timing excludes storage
  IO, browser frames, GPU work and end-to-end GC latency. Idle autosave absence
  remains covered by storage tests. These measurements do not close A08.

Artifacts: `/tmp/bmsx-session/{lua,ide,tests,boundaries,parity,indent,build,studio,
navigation,reload}-session-final.log` and `profile-session-final.jsonl`. Early
`session-reload-wip*.log` files retain failed lifecycle and invalid-fixture
attempts; they are not the final pass logs.

Run the probe with:

```sh
TSX_TSCONFIG_PATH=tsconfig.base.json node --expose-gc --import tsx \
  --import ./tests/lua/test_setup.ts \
  tests/conformance/runtime_replay/profile_workbench_session.ts
```

The resource viewer follow-up below closes resolve-time content/scroll coupling.
B03 cross-parent authoring, B04 source-query/latency, B06 property authoring and
A08 whole-host/physical-target evidence are not marked complete by this work.


## Resource-viewer content refresh follow-up

The session gate exposed a second, independent issue: `resolveResourceViewerInput`
rebuilt an entire viewer state and replaced the input's previous scroll position
with the content factory's zero. Keeping the old input without refreshing its
content would hide that bug behind stale data. Capturing/restoring the old scroll
around the replacement would preserve the wrong producer boundary.

The input now owns one retained `view`, while `buildResourceViewerContent` only
produces replaceable content. `updateContent` publishes the new content and label;
it does not replace or write the viewport. Input identity, resource navigation,
normal layout clamping and the persisted `{resource, scroll}` representation are
unchanged. There is no extra frame callback, cache, fallback or per-frame
allocation. One view object is retained per input.

Production reference: VS Code's
[media preview refresh](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/extensions/media-preview/src/mediaPreview.ts#L75-L112)
updates resource content independently of its
[view coordinates](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/extensions/media-preview/media/imagePreview.js#L288-L323).
BMSX already retains its viewport directly, so no webview recreation or
capture/reapply workaround is copied.

This follow-up is specifically the content/view lifetime boundary. It does not
claim a redesign of the pre-existing asset metadata formatting or completion of
the disabled image preview renderer. Those implementations are not moved into a
new service or presented as a validated generic asset inspector.

Validation: **78/78** focused tests and **1591 Lua tests / 1590 pass / 1 existing
skip**. IDE typecheck, strict boundaries, parity, indentation, browser build and
diff checks pass; tests TypeScript retains the same 51 baseline diagnostics.
The actual reload workflow passes on all three backends, including repeated
resource resolution before reload. Independent data fixtures prove that content
really changes while input/view identity and scroll remain stable; unchanged
labels emit no new group event. Artifacts: `/tmp/bmsx-session/*-viewer-final.log`
and `viewer-targeted.log`. The preceding full Studio/Pietious matrix belongs to
the main A07 commit; this follow-up reruns the targeted real browser workflow.
