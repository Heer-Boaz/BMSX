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

## Documents, inputs and panes

`editor/model/` owns canonical text models. Workbench working-copy services own
text-model resolution, persistence and source-edit publication. Source-backed
visual tools consume those models rather than keeping another authored copy.

Contributions own concrete retained editor inputs; `workbench/ui/tab/` owns
their group membership.
An input identifies an editor and retains its view state and model references;
it is not the document itself. Different inputs can present the same document.
`workbench/services/editor/` owns editor-kind resolution and pane attachment:
a pane is a reusable control
bound to one input, not the lifetime owner of that input or its source.

Shared window/control code owns presentation and input mechanics. Contributions
own their subjects and register their commands on the appropriate focus target.
`input/` owns keyboard focus and pointer-gesture routing independently of which
view or physical target happens to be active.

## Workbench Quick Input

`workbench/services/quick_input/` owns picker/input sessions, presentation and
focus lifetime. Providers own their actual catalog, matching and ordering;
`QuickPickModel` consumes the provider's projection. Features contribute those
providers and actions rather than adding feature-specific matching to the shell.
