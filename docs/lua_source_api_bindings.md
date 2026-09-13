# Authored Lua API paths

2026-09-13; baseline `a9abbf521`. D1 follow-through for the existing
[declarative authoring norm](behavior_definition_inspection_design.md#4-declaratieve-authoringnorm).
This is source discovery, not a loaded-definition catalogue or runtime callee
proof. Lua remains the authored document.

## Reference and ownership correction

Inspected TypeScript's production [v5.9.3 checker](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/checker.ts):

- [`isConstantReference`](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/checker.ts#L28870-L28894)
  distinguishes binding stability from a `const` spelling. An ordinary local
  without assignments can be stable; properties require their own evidence.
- [`isSymbolAssigned` / `markNodeAssignments`](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/checker.ts#L30166-L30242)
  retain assignment information, including nested functions, rather than
  treating AST visitation order as execution order.
- [`resolveAlias`](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/checker.ts#L4270-L4293)
  caches alias results at the symbol owner, not in each editor contribution.

BMSX already has a complete per-binding written-input index. It does not need
TypeScript's AST assignment scan, control-flow implementation or symbol flags
copied wholesale. The language-specific adaptation is a post-binding pass over
those existing facts, in `semantic/module_bindings.ts`.

The previous `moduleTargetBinding` tested only the immediate declaration kind.
It hid never-reassigned ordinary locals, but accepted const copies of aliases
whose values could change. Its transient name/alias maps also changed while
traversing closures and branches, which is not their runtime order. Those maps,
the redundant public alias list (no product consumer), and the qualifier flag
are removed rather than preserved behind a new recognizer.

## Producer contract

`LuaCallSite.moduleTarget` is a **written module/member path**, with these rules:

| Written form | Source admission |
| --- | --- |
| Direct builtin `require('module').member` | The binder's module root plus its static member path. |
| Local initialized from that root, with no other writes | Same path, whether or not the local has `<const>`. |
| Local copies and dot/literal-key member aliases | Follow the already bound declaration identity, including shadowing and function-local imports. |
| Assignment elsewhere, including a nested callback or branch | No stable import path for that binding or aliases depending on it. |
| Global/parameter inputs, builders, unknown keys or implicit result lanes | No guessed module path. Ordinary language queries and execution are unaffected. |

All written assignments are available before admission. Single-initializer
local aliases depend only on earlier visible lexical declarations; therefore
the binder's declaration order is dependency order. Each declaration is visited
once, a no-suffix alias shares its resolved path, and callsites consume that
index once before publishing immutable file facts. No recursive chain walk,
workspace solver, per-call write scan, query budget or per-frame cache is added.
The 10,000-alias probe checks both stack independence and shared result identity.

This deliberately does not infer reaching definitions across assignments. Even
a const snapshot taken before a later reassignment is source-only in this
classifier. Source editing, compilation and Hot Resume are not rejected. A
flow-sensitive improvement belongs at the language owner, not in the Lens.

Module **contents** are different from a local binding: `api.run = replacement`
does not change the local's written import path. The declarative authoring norm
excludes replacing the public registration API. The path is not frozen-export
or runtime-publication evidence; a contribution must never use it for either.
`module<const>` remains a separate explicit compiler ABI declaration.

## Consumers and lifetime

Behavior Lens owns the BT/FSM/ActionEffect module paths, member names and
argument roles. Scene Editor owns its scene-library registration role. They
consume the generic call fact directly; neither contribution reconstructs an
alias chain. A colon call still has a different argument ABI and is not admitted
as a dot registration.

The existing workspace snapshot, catalog, source-document and working-copy
owners retain and invalidate their results. Adding/removing a captured write
changes discovery; Undo restores it. No live heap read, new file/resource type,
cartlib hook, machine word or C++ runtime field is introduced. These are tooling
facts, not mirrored hardware data; guest hot paths are unchanged.

## Evidence and remaining scope

Independent fixtures cover ordinary/const imports, member aliases, shadowing,
parallel local initialization, nested and later writes, unknown inputs, all
three behavior APIs, scene discovery/project agreement and incremental Undo.
The existing BT, ActionEffect and scene workflow fixtures now also use ordinary
imports; imported FSM source editing and the compiled Set Initial/Hot Resume
fixture exercise that spelling through the existing product harness.

Workspace profiling reuses `tests/helpers/performance.ts`, separately reporting
retained-parse binding, fresh snapshot plus catalog, and retained-snapshot catalog
rebuilding. It prints the discovered registrations so equal timings cannot hide
lost results. Validation results are recorded below.

**Still open after the local-binding slice:** API reexports through another
module's implementation. The follow-through below now covers explicit return
aliases, not wrappers or runtime-replaced exports. Existing imported
*definition data* support is separate. Cross-file BT relocation and loaded
definition/instance inspection remain their own gates; this does not close D1,
D2 or D3 as a whole.

## Measured query cost

Three alternating baseline/current process pairs, Node 22.23.1, no concurrent
build or browser run. Each phase uses 10 warmups and the median of 25 samples;
the table is the median of the three process medians. The same 191 Nemesis and
cartlib files contain 1,217,338 UTF-16 source units. Every run discovers the
**same 32 registrations**, including identical resource, label and line.

| Host operation | Baseline | Current |
| --- | ---: | ---: |
| Bind all files from retained parses | 78.836 ms | 79.893 ms |
| New workspace snapshot and catalog | 4.039 ms | 4.086 ms |
| Rebuild catalog on a retained snapshot | 0.173 ms | 0.154 ms |

This is not a speedup claim. It measures the admission correction without
dropping source results, not total Studio latency, peak memory or guest timing.
Actual editor updates retain unchanged binder files rather than rebinding this
whole workspace. The profiler supplies retained parse objects explicitly: the
existing 24-file parse cache cannot retain all 191 inputs, so relying on it
would also measure repeated parsing. The preliminary runs did that and are not
the binder-only measurements above.

## Validation

- The ordinary-import Lens and scene-alias regressions both fail on the
  unchanged baseline and pass after the owner correction.
- Full `test:lua`: **1,733 passed, one existing skip**, zero failures.
- `compile:toolchain`, IDE typecheck and browser Studio build pass. Tests
  typecheck retains the same **51 pre-existing diagnostics**, compared by
  diagnostic text with the baseline rather than only by count.
- Full physical Studio workflows pass independently on **software, WebGL2 and
  WebGPU**. The reused fixtures exercise ordinary-import BT/ActionEffect/scene
  discovery and editing, imported FSM initial edits, navigation, dirty/Save,
  Undo/Redo, pause/rewind, and normal source application.
- The separate compiled FSM Set Initial workflow passes on all three backends:
  its ordinary module local survives three actual Hot Resume installations;
  cold reboot then instantiates the newly selected initial state. This is not
  inferred from source-only tests.
- Strict architecture boundaries report zero issues; core-parity audit,
  indentation check and `git diff --check` pass. No machine, host or cartlib
  production source changed. The software workflow screenshot was inspected.

The browser harness uses isolated source workspaces and its actual product
file API. Logs include the existing deliberate fault/compile-rejection probes
and fixture HTTP 404s; scenario gates passed without uncaught workflow errors. The user's
running server and IDE storage were not modified. These tests do not establish
native-host UI behavior, arbitrary Lua reflection or complete factory inference.

Run evidence: `/tmp/bmsx-module-bindings-{lua,workflows,initial-live}.log`,
`/tmp/bmsx-module-bindings-retained-{before,after}-{1,2,3}.json`, plus the
typecheck/build/audit logs with the same prefix. No additional browser test
driver, generated game ROM fixture or runtime validation layer was introduced.

## Explicit API reexports (follow-through from `2737af288`)

The binder now publishes an immediate `ModuleValueEntry.moduleTarget` using the
same completed local-write index as callsites. `LuaModuleImportQuery`, owned by
the immutable workspace resolver, consumes that fact. Contributions provide
their retained public module/member descriptors; no cartlib names or argument
roles enter the language layer.

The production reference is TypeScript's
[`getImmediateAliasedSymbol`](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/checker.ts#L33403-L33414)
and the cycle-aware, symbol-owned `resolveAlias` cache linked above. BMSX does
not copy CommonJS export merging or equate Lua import spelling with execution.
It matches against a requested **public anchor**: a bridge can lead to
`cartlib/fsm/library.register`, but moving that library's private implementation
must not normalize the public name away and break recognition.

Supported forms include `return require('api')`, `return api.member`, local
copies, literal-key members, and chains of these across files. A reexported
function can be called directly; it need not acquire a fictional `.register`
at the callsite. A colon call still has a different argument ABI.

Each snapshot indexes normalized module names once. Missing, ambiguous,
syntax-incomplete, bypassed or non-alias exports do not produce a forwarding
edge. Ordinary source editing and compilation remain available. Direct public
imports remain the written contract even without the library's implementation
source. These are source facts, **not frozen module values or runtime callees**.

`matchesImport` caches success/failure for each retained target descriptor and
`(module, remaining member-prefix length)`. Reexport members prepend to the
caller's path; the query matches those suffixes backwards instead of allocating
an expanded member path at every link. The traversal is iterative. Resolving
states terminate zero-member cycles; member-growing cycles consume the finite
requested path. There is no recursion limit, workspace solver, factory
execution, arbitrary cap, or expanded-path storage quadratic in chain depth.
Terminal modules already have their answer in the export index and do not get
an additional negative cache under each API. The binder finalizes its existing
export fact in place before publishing readonly file data, rather than copying
that fact into a second object.

### Scene projection and field lifetime

Behavior registration discovery and the Scene source chooser use this same
snapshot query. The chooser acquires one snapshot per execution domain per
invocation, not a fresh source context for each candidate.

Scene Editor now separates workspace revision from projection version. It
rechecks admission on a new workspace revision, but reuses the actual immutable
scene document when the consumer AST and accepted definitions are unchanged.
An unrelated edit or an equivalent reexport edit therefore does not reset
selection, layout or a focused value draft. Revocation changes the projection
even when the consumer text is untouched. Removed fields cancel their drafts
before releasing focus, so ordinary blur cannot publish an edit to a revoked
target. Command admission refreshes source targets as well.
The typed input's optional pre-commit lifecycle lets the source owner synchronize
that binding before parsing/publishing a pending draft, independently of the next
render update. Revocation cancels before releasing focus, so its reentrant blur
also cannot publish. Unchanged fields keep ordinary Enter/blur/Save behavior.

The matching view-lifetime reference is Qt's
[`QAbstractItemView::dataChanged`](https://github.com/qt/qtbase/blob/v6.9.0/src/widgets/itemviews/qabstractitemview.cpp#L3417-L3438),
[`updateEditorData`](https://github.com/qt/qtbase/blob/v6.9.0/src/widgets/itemviews/qabstractitemview.cpp#L4515-L4542)
and removal of affected editors in
[`rowsAboutToBeRemoved`](https://github.com/qt/qtbase/blob/v6.9.0/src/widgets/itemviews/qabstractitemview.cpp#L3556-L3579).
The borrowed principle is model-owned invalidation and editor lifetime, not
Qt's index representation or defensive widget checks.

API bridge files are query dependencies, not automatically composite editable
definition members. Save/Undo remain with the actual written source models.
No guest/cartlib, machine, C++ or runtime ABI changes are involved.

### Scope and evidence

This does **not** resolve table-aggregate exports such as
`return { register = api.register }`, wrapper functions, arbitrary factories,
runtime API replacement, or cross-file BT relocation. It does not implement
loaded-definition or live-instance inspection. Existing imported *definition
data* support remains separate from recognition of the registering API.

Independent probes cover all four contribution APIs, member order, direct
function reexports, private refactors behind the public anchor, ambiguous
normalized modules, bypasses, source-only cases, snapshot replacement and
provider-only Undo. A 10,000-module chain and member-growing cycles exercise
stack independence without query caps. The existing physical Studio workflows
are extended for scene draft revocation and an actually compiled FSM API bridge,
including normal Save/Reboot and Hot Resume; no new browser driver or fake ROM
is introduced.

### Reexport query measurements

Three alternating `2737af288`/current process pairs, the same retained-parse
profiler, 10 warmups and median of 25 samples. No concurrent validation or
browser process during profiling. All six runs have the same 191 files,
1,217,338 UTF-16 units and **32 identical registration resource/label/line
tuples**. Values below are medians of the three process medians.

| Host operation | Baseline | Reexports |
| --- | ---: | ---: |
| Bind retained parses | 80.750 ms | 80.227 ms |
| New snapshot and catalog | 4.191 ms | 4.510 ms |
| Rebuild catalog on retained snapshot | 0.162 ms | 0.201 ms |

This is not a speedup or zero-cost claim: cross-module admission adds about
0.32 ms to the fresh snapshot/catalog and 0.04 ms to catalog rebuilding in this
workspace. These are invocation/generation operations, not per-frame topology
or guest work. It does not measure total UI latency, peak memory or the separate
contextual factory/call queries. Artifacts:
`/tmp/bmsx-module-reexports-verified-{before,after}-{1,2,3}.json`.

### Reexport validation

- The independent reexported-registration regression fails on unchanged
  `2737af288` (no registrations) and passes with the language query.
- Full `test:lua`: **1,743 passed, one existing skip**, zero failures.
- Toolchain build, IDE typecheck and browser Studio build pass. Tests typecheck
  has exactly the same **51 pre-existing diagnostics**, compared by full text.
- Full physical Studio workflows pass on **software, WebGL2 and WebGPU**. The
  scene probe opens through a real reexport, preserves a valid focused draft
  across an equivalent provider edit, revokes it safely even when commit occurs
  before the next frame, and restores admission through provider Undo. It then
  exercises the existing tiny/MSX font, focus, scroll and ordinary source edits.
- The separate compiled FSM workflow passes on all three renderers. Its bridge
  is an ordinary saved Lua module, compiled by the normal toolchain. Set Initial,
  Undo and Redo each go through actual Hot Resume, retaining the live FSM/state
  and its mutable data. Cold reboot instantiates the changed initial state.
- Strict architecture boundaries report zero issues. Core-parity audit,
  indentation and diff checks pass. Software Scene and FSM captures were
  inspected. Intentional guest/compile-fault probes and fixture HTTP 404s remain
  in the browser log; workflow fault gates pass.

Final evidence is under `/tmp/bmsx-module-reexports-verified-*`, including
`workflows.log`, `initial-live.log`, `lua.log`, typechecks, build/audit logs and
per-backend screenshots. The user's browser server and IDE storage were not
modified. These are browser-host and tooling proofs, not a claim of native UI,
unrestricted Lua reflection or completion of D1/D2/D3 as a whole.
