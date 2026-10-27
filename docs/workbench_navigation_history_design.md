# Workbench navigation history

## Scope and references

One workbench Back/Forward owner records concrete editor destinations and
contribution-owned locations. It does not reinterpret every destination as text
coordinates, and individual tools do not create parallel navigation stacks.
Part composition and open routing belong to the
[Studio workspace contract](studio_workspace_design.md); registration matching
and previews belong to [definition inputs](workbench_definition_inputs_design.md).

VS Code stores editor identity with an optional contribution-owned pane
selection. Resource-backed destinations can be reopened through their editor
registration; non-reopenable input destinations end with that input's lifetime.
See its pinned [selection contract](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/common/editor.ts#L270-L324)
and [history owner](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/workbench/services/history/browser/historyService.ts#L1638-L1825).

## Destinations and admission

- An entry names its concrete destination group and either a retained input or
  a registered resource-editor identity. Resource identity is `(contextId, path)`;
  an installed socket, label or filesystem-path guess is not a destination.
- A closed resource editor can be reopened through its registration. An input
  without that capability retires its history entries on disposal. Removing a
  group retires that group's entries without clearing unrelated destinations.
- The active pane supplies an optional `EditorPaneSelection`. History owns its
  lifetime but does not inspect Lua, graphs, list ordinals or document contents.
  The contribution compares locations and restores its selection during the
  destination's single activation, after source refresh and before controls bind.
- Explicit tab, Source and picker navigation capture the departure before
  changing destination. Opening another registration does not overwrite the
  departed input's identity or bookmark. Ordinary cursor movement or panning is
  not itself a navigation jump.
- An asynchronous opening retains its departure and borrows a stack-owned
  destination. Only admitted navigation transfers the departure to the opposite
  stack and consumes the destination. Rejected or superseded requests do not
  consume a still-live entry or redirect it to a later-focused group.
- Back/Forward restore under capture suppression. Eviction, branch pruning,
  reset, destination retirement and consumption dispose owned selections and
  subscriptions. A preview replacement can retire a captured departure before
  its opening completes; that retired entry cannot enter the history afterward.

The frontend initializes the shared history once. Creating a group or attaching
one of its reusable panes is not permission to reset that history. Frontend
activation identifies the current part/group without changing the ownership
of retained destinations.

## Contribution-owned locations

Text locations use UTF-16 offsets mapped through canonical model changes.
The Source control reveals that selection in its current layout. History does
not transplant visual scroll rows or restore an earlier wrapping preference;
full editor-view snapshots separately own reading position and presentation.
Visual locations retain source-correspondence bookmarks, including FSM return
evidence and BT occurrence ancestry. They do not retain an old graph object or
source-generation AST. Deleting an occurrence makes it unselected, rather than
selecting a namesake or the next ordinal.

The presentation consumes viewport restoration, including an asynchronously
published graph layout. Initial positioning and automatic selection reveal must
not overwrite that requested location. The history owner does not calculate
viewport geometry.

Restoring a destination does not edit source, install Undo state, acquire a
runtime subject, reset a simulation or invoke Hot Resume. Source changes only
map retained bookmarks. Navigation, working-copy Undo and serialized editor-view
snapshots have distinct lifetimes.

Back and Forward are shared workbench commands. Their keyboard admission covers
code, graphs, properties and lists, including committing the originating focused
draft through its existing edit boundary. They are not gameplay bindings or a
second pair of Behavior Lens commands.

## Retained code-view correspondence

`CodeEditorInput` owns its `CodeEditorViewBinding` even while no code pane is
attached. The model publishes an old-buffer boundary before each atomic edit;
the binding captures cursor and anchor offsets there and maps them through the
final application-order changes.

A typed code-edit selection result applies only to its matching view edit-source
identity. Sibling views map their own locations instead of consuming another
view's selection result. The canonical text model knows neither code views nor
graph selections. Wrapped visual scroll rows remain layout coordinates, not
text-buffer line numbers.

This separation follows [VS Code's model-change cursor handling](https://github.com/microsoft/vscode/blob/7f59d5e01a7fafeba8e83cdfd9d8493f2beeeaca/src/vs/editor/common/cursor/cursor.ts#L207-L249)
and the affinity rules in [CodeMirror ChangeDesc](https://github.com/codemirror/state/blob/9c801279cb83011e6f92af778f4443406e8f1200/src/change.ts#L105-L144)
and [SelectionRange](https://github.com/codemirror/state/blob/9c801279cb83011e6f92af778f4443406e8f1200/src/selection.ts#L64-L79).
Studio uses its existing PieceTree and change-event representation, not another
text store or per-frame cursor repair.

## Cost and lifetime

Each stack retains at most 64 entries. A capture allocates an entry and the
contribution's coordinates, not a document copy, parsed graph or machine
snapshot. Text changes map subscribed retained locations; stationary frames do
no history capture or remapping. Code-view correspondence reuses its scratch
position. Disposing an entry releases its subscriptions; disposing a view
releases its binding. These are bounded-work and lifetime contracts, not an
end-to-end latency claim.
