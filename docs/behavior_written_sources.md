# Behavior Lens consumes written workspace sources

2026-09-12; baseline `21e97060b`. A B04 consumer slice, **not completion of
B04's API-binding/call-context contract or B03/B06 authoring**.

## Source, not an inverse interpreter

The recognizer now takes the real immutable workspace snapshot. Its
`BehaviorSourceReader` consumes `LuaWrittenSourceQuery`; the old Lens-local
const-initializer traversal and alias/mutation walker are removed. Registration
ids, table constructors, BT type expressions, FSM concurrency/initial values
and callbacks use the same written-source boundary. An ordinary local does not
need `<const>` to expose its sole written initializer.

Direct module exports and reexports retain their own files. A constructor,
callback body and returned literal can each have a different source owner from
the registration. Repeated uses of one constructor remain separate graph
occurrences. Callback paths are still bound in each consuming FSM scope, not
globally by their literal value.

The reader selects a written expression only when there is one terminal and no
unresolved contribution in that written query. **This is not an exclusivity,
execution or purity proof.** Competing initializers, unknown computations,
factory results and named-member boundaries are not silently flattened to the
first known table. This slice does not activate the contextual call solver for
every picker entry or substitute a second member resolver in Lens. Those richer
queries remain an explicit next consumer step.

`writtenSourceExpression` belongs to the language source owner. It interprets
the actual assignment/field/return lane, not a navigation range; implicit nil
and missing result lanes have no manufactured expression. Value-transfer syntax
is narrowed to the forms its binder actually produces. Tables and functions
already carry their original owned syntax.

The written query also retains constructors reached by explicit storage
mutations, including containing tables. Constructor initialization is not a
later mutation. This traversal shares the query's binding/module inputs and is
retained once per snapshot; it neither executes writer bodies nor calls unknown
callbacks pure. A mutation through a different importing file therefore marks
the written definition partial as well.

## Generations, inspection and history

- Source documents and the registration catalog invalidate on the workspace
  snapshot, including negative module lookups. A list of previously found
  provider files is not a sufficient cross-generation dependency certificate.
- Document file revisions identify the displayed source owners without pinning
  complete binder tables or old workspace snapshots in each hidden view.
- The source index has an invalidation lifetime. Source changes in its domain,
  changes to shared system sources and replacement generations revoke gestures,
  menus, inspections and source reviews. A review's write model is not its only
  possible dependency. The shared review control exposes the same disposable
  lifetime pattern as the workbench menu/inspector controls.
- Source opens the provider's ordinary code editor. Editing there and Undo
  refresh the existing Lens inputs; the registration's independent text history
  stays untouched. This is read-many/write-one through the existing source
  editor, **not** a multi-model graph Undo system. Imported graph mutation
  commands remain unavailable until their operation-specific write/input owner
  is implemented.
- File syntax recovery blocks new mutations but does not erase known list
  topology. Keeping those concepts separate preserves weighted-edge selection
  through an unrelated syntax error and Undo. Cyclic source expansion is bounded
  by the actual active constructor identities, not an arbitrary depth cap.

## Production references applied

The [TypeScript refactor owner](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/refactors/extractSymbol.ts)
works on actual syntax with its semantic context. The
[XState machine extractor/editor](https://github.com/statelyai/xstate-tools/blob/fc7a85d780cd8ea4ea21fb423f2477e01e2f1dc3/packages/machine-extractor/src/MachineExtractResult.ts)
edits authored configuration, not reconstructed runtime state. These are the
matching ownership boundaries, not permission to copy XState's callee-name
matching, Recast mutation or printer roundtrip. Resource/model lifetimes follow
the [previously studied VS Code/Roslyn implementations](behavior_source_resources.md).

## Validation scope

`behavior_imports.test.ts` uses independent multi-file BT/FSM/effect sources,
ordinary aliases, reexports, shared callback scopes, competing/unknown origins,
cross-file mutation, recovery and provider Edit/Undo. The registration-index
test adds previously absent exports without changing the registering file.
Written-source tests cover real lane syntax and retained mutation facts. Review
and weighted-selection tests cover dependency invalidation and recovery.

`studio_behavior_imports.ts` uses two real working copies, the command palette,
physical Source navigation and Undo. Its temporary source is never installed
in the paused machine. The existing full Studio and navigation workflows remain
required on software, WebGL2 and WebGPU; unit/typecheck success alone does not
close those gates.

Validated: **1680 Lua tests passed, 1 skipped**; toolchain and IDE typechecks;
strict architecture boundaries, core parity and indentation. The full Studio
workflow and the Pietious navigation workflow both passed on **software,
WebGL2 and WebGPU**, including the independent imported-source fixture. The
navigation capture was visually inspected. The tests-project typecheck retains
its 51 pre-existing diagnostics (compared by diagnostic, not merely by count).

The first three isolated baseline/current pairs used the same 191 Nemesis and
cartlib files. Catalog median: **14.722 -> 2.845 ms**. Projecting three real
documents, including the first workspace mutation query: **5.878 -> 18.583 ms**;
the later BT/effect projections were about 0.92/0.10 ms. All pairs retained 32
registrations and 187 source nodes, without constructing the may-call solver.
This shifts work from a file-local scan to a shared workspace query; it is not a
claim that every latency problem is solved. Binding, workspace indexing and
those source phases were timed separately. Temporary scripts and logs live in
`/tmp/bmsx-source-consumer/`; broader call-query latency remains open.

## Still open

The shallow API candidate test still uses `moduleTargetBinding`. It is **not**
the frozen-export proof required by the design; this slice does not broaden or
declare it correct. API replacement/unknown writes, contextual member/factory
consumption, paired wrapper applications, richer origin inspection, imported
graph write owners, cross-depth BT drag and ActionEffect authoring remain the
main route. No guest/cartlib/BIOS/machine representation was added.
