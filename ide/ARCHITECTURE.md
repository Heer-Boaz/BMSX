# IDE and Studio ownership

This is a map of the Studio implementation, not a feature specification or an
implementation journal. Repository-wide composition and dependency boundaries
are described in [the software architecture](../docs/architecture.md#studio-ownership).

## Owners

| Area | Responsibility |
| --- | --- |
| `editor/` | Text models, editing, code-view layout/rendering and editor contributions. |
| `workbench/` | Studio shell, editor groups, panels, windows, shared controls and tool contributions. |
| `language/` | Language-specific source adapters, highlighting, formatting and queries shared by tools. |
| `input/`, `commands/` | UI focus, gesture routing, keyboard dispatch and workbench commands. |
| `runtime/` | Studio's source catalog, execution/inspection integration and connection to physical targets. |
| `workspace/` | Authored records, workspace files and storage contracts. |
| `browser/`, `node/` | Platform-specific Studio integrations. |
| `common/`, `theme/` | Shared primitives and presentation tokens, without feature-owned state. |

Reusable text-editor machinery belongs in `editor/`; its workbench presentation
belongs in the corresponding `workbench/contrib/` contribution. Shared shell
controls belong in `workbench/ui/`, while workbench services own cross-control
lifetimes. A feature keeps its subject, commands and domain-specific projection.
Sharing a control does not transfer the feature's ownership to that control.

Language tools consume the compiler/frontend owners in `toolchain/`. Studio
uses host and machine services for physical execution; editor views do not own
a compiler, filesystem transport or a second machine loop.

## Composition

`workbench/workbench.ts` composes the shared `StudioWorkbench`. Browser Studio
adds `RuntimeIdeState` and `RuntimeCartEditor` for frontend input and presentation.
The server-owned Node Studio composes the same workbench in an isolated worker.
Session, transport, source authority and physical-target boundaries are defined
by the [repository architecture](../docs/architecture.md#studio-ownership), not
by the kind of editor currently visible.

## Workspace and execution

`workbench/workspace/` owns the attached workspace root, editor-session storage
and recovery namespace. `contrib/home/` presents that workspace through an
ordinary editor input and pane. `workbench/mode.ts` chooses the startup editor
after session restoration; changing the active editor does not choose a project
or install a cartridge. Project selection belongs at workspace attachment, not
inside Home or a tool pane. Physical execution remains with the workbench's
execution services and their explicit targets.

Platform composition supplies an admitted source context before workspace
attachment. Node workspace metadata and browser-owned metadata retain those
opaque identities. A source-folder open has its own selection; matching paths
do not select an arbitrary named project. Build receipts retain their exact
project admission independently of immutable artifact generations. Browser
published-build navigation preserves that receipt, not merely an artifact ID.
Frontend and native source recovery consume explicit context/session namespaces;
canonical file Save addresses remain separate from
[recovery storage](../docs/studio_source_recovery_design.md).

## Documents, inputs and panes

`editor/model/` owns canonical text models. Workbench working-copy services own
text-model resolution, persistence and source-edit publication. Source-backed
visual tools consume those models rather than keeping another authored copy.
The source catalog supplies canonical file addresses. Text-file loading, Save
and canonical recovery comparison consume that admitted file authority.
Diagnostics are indexed once by canonical model/version; Source presentation
projects ready row markers through its own layout rather than an active-editor bucket.
`CodeDocumentProjections` owns model-bound highlighting and semantic scheduling.
Font-generation measurements are shared by attached views; each `CodeLayout`
owns wrapping, visual rows and its control's inline-text projection.

Contributions own concrete retained editor inputs. `EditorGroupView` owns its
group model, pane cache, focus/capture scopes and tab-strip control. Tab layout,
hover and gestures live in that strip, not in frontend-wide chrome state.
An input identifies an editor and retains its view state and model references;
it is not the document itself. Different inputs can present the same document.
Source inputs own their model-to-view subscriptions. Closing one releases its
view without disposing the canonical model or another input's view.
`EditorCloseController` admits user closes across the frontend's groups, including
composite working copies and last-view Save/Discard/Cancel decisions. It rechecks
canonical state and surviving views after awaited decisions or writes.
`TextFileSaveService` owns accepted writes and their captured source snapshots;
groups own final view retirement. Forced owner teardown is separate from user
close admission. Opening and activation settle the attached focused control's
draft before changing group membership or pane attachment.
The group's Source pane keeps plain reading mementos for ordinary reopening,
separate from serialized view state and explicit navigation selections.
Text history retains source selections and inert editing origins, not viewport
coordinates or control references. Source history commands name their invoking
view; sibling views track the canonical text changes independently.
Each Source pane owns a concrete `CodeEditorControl`: native text input, focus,
selection gestures, viewport, caret and render caches belong to that instance.
Find, Rename, Suggest and hover are pane-bound contributions. Source actions
retain that pane and its group; they do not resolve through a primary editor.
`workbench/services/editor/` owns editor-kind resolution and pane attachment:
a pane is a reusable control
bound to one input, not the lifetime owner of that input or its source.

The frontend owns shared navigation history. Captured selections belong to their
group/input lifetime and name their destination group. Opening admission is
group-local; a delayed attachment does not reactivate a group after the user
has moved elsewhere. Actions retain the invoking control's group through popup
focus. Constructing or disposing a group cannot reset another group's history.

Shared window/control code owns presentation and input mechanics. Contributions
own their subjects and register their commands on the appropriate focus target.
`input/` owns keyboard focus and pointer-gesture routing independently of which
view or physical target happens to be active.

## Workbench Quick Input

`workbench/services/quick_input/` owns picker/input sessions, presentation and
focus lifetime. Providers own their actual catalog, matching and ordering;
`QuickPickModel` consumes the provider's projection. Features contribute those
providers and actions rather than adding feature-specific matching to the shell.
