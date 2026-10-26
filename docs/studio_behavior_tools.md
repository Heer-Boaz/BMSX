# Shared behavior source tools

## Design references

The ownership boundaries follow these production implementations:

* [VS Code bulk text edits](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/bulkEdit/browser/bulkTextEdits.ts):
  resource-owned models and expected versions are independent of an editor view;
  applying uses ordinary model history. BMSX already owns context admission and
  a review/history service; semantic plans use those rather than a second writer.
* [VS Code bulk edit service](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/bulkEdit/browser/bulkEditService.ts):
  planning/preview and application are separate. Generating an edit is not Save.
* [Godot remote debugger tree](https://github.com/godotengine/godot/blob/master/editor/debugger/editor_debugger_tree.cpp):
  remote instance identity belongs to the debugging session, not scene-source
  labels. This is a boundary reference for the remaining Actor integration,
  **not** justification to reconstruct canonical source from running objects.

## Ownership

`BehaviorSourceDocuments` and its registration index consume an explicit
`EditorTextModelService`. CartEditor constructs one workspace owner and shares it
with Behavior Lens and conversation source tools. Neither tools nor views create
another semantic project or parse source just to display the same generation.
BT list membership and ActionEffect written-field indices are immutable, cached
by their actual source definition and shared with graph/property commands. FSM
entry admission already has a generation index. Graph selection and layout are
not prerequisites to read or edit a source occurrence.

The tool reference table only names retained source occurrences in one prompt.
It is not a behavior database, runtime identity, generic command dispatcher or
serialized AST. Read results include exact source ranges, owner versions,
partial resolution, and FSM entry/possible-outcome relations. They do not claim
that a branch executes or that a runtime guard succeeds. Repeated semantic ids
and shared constructors remain distinct authored registration occurrences.

Each `sources` entry maps its opaque `file` address to the actual source
identity (`domain`, `path`), captured version and read-only state. Source ranges
use that address in `range.path`; consumers resolve it through `sources`, not
by decoding the address or assuming the registration's domain. The logical
resource path remains a label, not filesystem authority.

The first source-edit operations are FSM initial selection; BT child removal,
duplication and adjacent ordering; and ActionEffect expression replacement.
The ordinary visual commands and tools use the same admission facts and syntax
edit producers. A tool produces one ordinary `WorkspaceEditProposal`, never
calls `pushEditOperations` itself, never opens a fake Lens and never saves or
executes Lua. Source changes (including dependencies not shown in the Lens),
Undo, workspace replacement and disconnect retire prompt authority. A completed
prompt may leave its review for the user; only that review can apply it.

Edits target the written constructor/list entry/property. A shared initializer
can affect other consumers; tools do not promise complete dynamic-use discovery.
BT edits move/copy expressions, not evaluated objects, so order/frequency can
change. Empty selectors are not repaired. Dynamic or computed membership is
not treated as a dense list. ActionEffect values use the existing Lua expression
parser, including protection of untouched field separators from trailing line
comments. No new source serialization or cartlib ABI is introduced.

## Representation and performance

Behavior source tools consume Studio source facts, independently of machine,
BIOS, cartlib and guest-value representations. They do not execute guest code.
Work occurs only on an explicit source query/edit or a normal Lens generation
update. Registration discovery is shallow; full topology is lazy. Reads reuse
workspace generation caches; the tool transport projection is built once per
requested registration and reused, without pixel layout or guest evaluation.

## Source versus runtime

Authored registration tools and live Actor/FSM/BT/ActionEffect inspection have
separate subjects and lifetimes. Runtime operations retain their explicit
physical target and borrowed-value lifetime; source handles cannot name a
running instance. Source transition or transfer edits use their owning
consumer-impact review. Source review, Save, build and installation remain
separate operations.
