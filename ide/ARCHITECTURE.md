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
| `runtime/` | Execution/inspection integration, installed source generations and connection to physical targets. |
| `testing/` | Captured fixture programs, isolated test targets and their debugger/inspection lifetimes. |
| `workspace/` | Admitted source contexts, authored records, workspace files and storage contracts. |
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

Lua semantic projects index file facts by opaque resource address. A snapshot
binds each referrer's written import specifiers to those files; export facts
belong to a file, not a global module name. Compiler and Studio project producers
apply their own import policy. The Studio project retains the address-to-resource
mapping used by navigation and visual source editors; captions remain resource
labels rather than encoded semantic addresses. Module completion consumes the
project's preferred import catalog, independently of aliases accepted in written
imports.

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

`services/editor/editor_parts.ts` owns the frontend's permanent main part,
document-part membership, activation/MRU and normal opening destinations. An
`EditorPart` is an actual container with its own group, retained client bounds,
timeline, Quick Input and decision dialogs. Document parts use the shared window
container; they are not another Studio session or workspace. Opening a document
does not replace the main part's authored subject. Workspace storage records
part topology and requested placement independently of shared source recovery.
The main presentation family and document windows share the surface owner's
ordered window band. Window navigation raises actual parts; owned inspectors
stay in their window/modal presentation family. Shared window models retain
normal placement independently of maximized and collapsed presentation.

Shared execution composition owns the primary `RuntimeTransport` and
`RunTargetSelection`. Global run/debug controls and audio monitoring consume
that explicit selection; editor focus and Source navigation do not select a
target. Play admission retains its selection request until the physical session
is ready. Closing the selected target clears selection rather than choosing
another machine. Window-local runtime controls retain their own transport
binding independently of global selection.

`WorkbenchInteraction` owns automatic UI execution holds from the activated
control attachment. Keyboard focus, guest-input admission, popup invocation and
run-target selection remain distinct. Runtime clients publish their physical
transport and live-follow intent through `InputInteraction`; authoring controls
hold the primary target. Runtime commands and Timeline retain the logical client
attachment, independently of a temporarily hidden guest-input viewport.
Transients borrow the invoking interaction without
borrowing guest input. Attachment and transport retirement revoke that authority.
Finite workbench operations declare their execution intent at host admission;
they do not erase the UI or explicit pause reasons.

Platform composition supplies an admitted source context before workspace
attachment. Node workspace metadata and browser-owned metadata retain those
opaque identities. A source-folder open has its own selection; matching paths
do not select an arbitrary named project. Build receipts retain their exact
project admission independently of immutable artifact generations. Browser
published-build navigation preserves that receipt, not merely an artifact ID.
Frontend and native source recovery consume explicit context/session namespaces;
canonical file Save addresses remain separate from
[recovery storage](../docs/studio_source_recovery_design.md).

`workspace/source_catalog.ts` owns admitted source contexts, resource identities
and their explicit module/asset bindings independently of installed media.
Documents and semantic projects use context/path keys; canonical filesystem
addresses and display captions are separate producer metadata. An execution can
install no image, one image or several generations from the same context.
`runtime/sources.ts` retains each installation's physical domain and captured
source generation. Debugging and runtime navigation consume those captures,
not the current authoring registry or an inferred context-to-socket mapping.
Play and Scenario preparation capture an explicit authored source namespace;
the fixture compiler consumes it independently of the ROM's packaged assets.
Unit fixtures have their own entry rather than rebuilding the gameplay program.

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
group model, pane cache, tab/content surfaces, focus/capture scopes and tab-strip
control. Its container supplies focus ancestry and the retained work area before
descendant controls are constructed. Pane factories consume that group's actual
surface and extent. Layout publishes each group's retained title/content bounds;
paint and input use those same surfaces. Tab layout, hover and gestures live in
the strip, not in frontend-wide chrome state.
An input identifies an editor and retains its view state and model references;
it is not the document itself. Different inputs can present the same document.
Source inputs own their model-to-view subscriptions. Closing one releases its
view without disposing the canonical model or another input's view.
An input's optional fresh-view capability belongs to its contribution. It creates
independent retained state over shared working copies, not another document or a
copy of runtime inspection/input authority. Complex authoring tools retain their
concrete contribution factory; frontend commands do not reconstruct subjects
through filenames or persistence serializers.
`EditorCloseController` admits user closes across the frontend's groups, including
composite working copies and last-view Save/Discard/Cancel decisions. It rechecks
canonical state and surviving views after awaited decisions or writes.
`TextFileSaveService` owns accepted writes and their captured source snapshots;
it does not build or install assets. Explicit execution operations own those
changes and retain their selected target/image through asynchronous work.
Groups own final view retirement. Forced owner teardown is separate from user
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

Part-local prompts block their own part and retain its invocation and focus
return lifetime. Workspace-wide commands use explicitly workspace-owned
prompts. Closing a document part runs shared last-view close admission against
that part's actual dialog owner; cancellation reopens new input admission, not
outstanding asynchronous openings. Forced teardown retires the part's controls
and command authority without closing shared documents or sibling views.

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
