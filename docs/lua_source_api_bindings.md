# Authored API paths through ordinary Lua locals

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

**Still open:** API reexports through another module's implementation, wrappers
and runtime-replaced exports are not newly resolved here. Existing imported
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
