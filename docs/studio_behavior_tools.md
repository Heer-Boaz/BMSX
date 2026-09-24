# Shared behavior source tools

## Design gate

References studied before implementation:

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

This slice is IDE source tooling only: no machine, BIOS, cartlib, C++ or guest
value representation changes. No runtime hot-path callsites are modified.
Work occurs only on an explicit source query/edit or a normal Lens generation
update. Registration discovery is shallow; full topology is lazy. Reads reuse
workspace generation caches; the tool transport projection is built once per
requested registration and reused, without pixel layout or guest evaluation.

## Still open in the complete toolset

These source tools are **not** semantic live Actor/FSM/BT/ActionEffect inspection
or mutation. Raw live values already have separate inspection tools. Actor
operations must respect World mutation boundaries and borrowed runtime-value
lifetimes rather than reuse source handles. FSM transition retargeting and BT
cross-parent transfer also remain separate source operations: their existing
consumer-impact review must not be skipped. Cart/frame Terminal context,
cross-turn test-debugger control, and Save/build/install acceptance remain on the
full runtime-tools plan.

## Validation (2026-09-24)

* Ten new source-tool tests cover supplied (not global) working copies, cached
  reads without reparsing, duplicate/unresolved registrations, imported shared
  FSM parents and actual transition proof, absent initial insertion, all four BT
  list edits, ActionEffect expression boundaries, generated/recovered source,
  foreign/expired handles, dependency changes, disconnect and ordinary Undo.
* The real browser -> authorized HTTP -> native Codex app-server -> deterministic
  local Responses fixture exercises all five tools on software, WebGL2 and
  WebGPU. Per backend: three prompts, twelve model requests, one connection, no
  review polling. Keyboard/pointer review Apply updates the actual FSM graph,
  BT graph and effect properties; ordinary Undo/Redo retains exact source.
  Completed screenshots were inspected, including
  `/tmp/bmsx-studio-chat/behavior-webgpu-{review-0,builder-0,builder-1,builder-2}.png`.
  Fixture setup edits working copies programmatically: this is automated
  integration/visible-control evidence, not UI-only development or live-model
  reasoning/account authentication.
* Full Lua suite: 2495 pass, one skip. Rompacker: 182 pass. Full assistant suite:
  42 pass; the final semantic-tool tests also pass independently on all three
  backends. The ordinary WebGL2 Studio workflow completes 9086 host frames,
  including existing builder edits, navigation, history and test debugging.
* Browser Studio/Node tooling builds and product typechecks pass. Tests-project
  typechecking has 95 existing diagnostics (96 before; one obsolete extra edit
  argument removed). Normalized comparison introduces none. Strict architecture
  audit: zero issues; core parity, indentation and diff checks pass. No C++,
  machine, BIOS or cartlib code changed in this source-only slice.
* `profile_behavior_tools.ts` measures 96/3072 synthetic registrations: cold
  discovery about 11/64 ms; first three reads including whole-file topology
  about 6/49 ms. Warm retained-projection lookup medians were 0.02/0.06 us in
  the batched in-process probe. Those numbers exclude transport, rendering and
  model latency, and are not a total-Studio-frame or runtime benchmark. Repeated
  reads retain identical projections and no extra parser calls.
