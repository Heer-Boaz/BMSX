# BT source reparenting

2026-09-12; builds on `aaa45e955` and the existing source transfer/relocation
owners. This implements the same-document part of B03, not cross-file Undo,
factory-instance editing or completion of B04's API-identity work.

## Owners and interaction

- [LimboAI TaskTree](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/task_tree.cpp)
  normalizes between/on-item drop sectors to a parent and insertion position.
  [Its editor](https://github.com/limbonaut/limboai/blob/3f14ea4c26911e8b8e30c6bcdb575fc589a59deb/editor/limbo_ai_editor_plugin.cpp)
  checks ancestry and records the operation in ordinary Undo. BMSX uses the
  same distinction, adapted to its top-down graph: side sectors insert beside
  a node; the middle sector appends to its compatible authored list. An empty
  parent is a destination and an only child is a drag source.
- The graph control owns pointer capture, cancellation, edge scrolling and
  coordinate transforms. The contribution owns list roles, source topology and
  lexical relocation. A box means inside a parent; an insertion line means
  before/after a member. Feedback never changes source or layout.
- `BehaviorTreeTransferAnalysis` is retained for one gesture. A compatible
  target must be in the same write resource, outside the travelling syntax,
  acyclic, and preserve free bindings. Shared constructors use their actual
  recognized list consumers, not just visible ancestry. No generated weight,
  default node, child-to-choice conversion or inferred missing list.
- Dropping across lists opens the existing source-edit review. It names the
  travelling expression, source/destination list uses, and eager source reads
  and operations. This is a **written-source move**, not a promise that changing
  initialization order preserves other runtime behavior. Alias initializers
  stay where they were; inline initializers travel. Review cancellation changes
  no bytes. Dependency invalidation closes the review. Removing the only random
  choice explicitly warns that the current cartlib evaluator cannot execute the
  resulting empty selector; a source editor does not fabricate a replacement.
  Empty sequence/selector behavior follows `cartlib/behaviour_tree/node_program.lua`.
- The language owner enumerates potential evaluation in the expression, stopping
  at function bodies as [Closure Compiler's AstAnalyzer](https://github.com/google/closure-compiler/blob/master/src/com/google/javascript/jscomp/AstAnalyzer.java)
  does. It does not invent a purity verdict, execute code, or classify a known
  callback body as eager execution. Lexical relocation still examines captured
  free bindings in those bodies.
- The existing lossless field-transfer owner moves text and trivia, returning
  the exact inserted field range. One text-model operation owns removal,
  insertion, Undo and Redo. Edit-associated source bookmarks use the selected
  destination occurrence and travelling suffix, not a child rank or shared
  initializer identity. Like [VS Code text drag](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/vs/editor/contrib/dnd/browser/dnd.ts),
  cancellation and history stay with existing editor owners.

## Proof required

Independent fixtures: deeper/shallower moves; only child into empty parent;
weighted choice retained whole; shared-list occurrences; cycle, shadow and
foreign-resource refusal; evaluation phase; source invalidation during review;
one Undo/Redo with selection; no mutation during hover. Real pointer/review/
source/Undo flow on all three Studio renderers. Hover reuses its analysis and
feedback; measure gesture setup separately from retained motion.

## Executed evidence

- Independent authored fixtures cover the cases above, including a shared list
  selected through its second use and a complete weighted-choice wrapper.
  A compiled CPU oracle demonstrates that moving eager initializer syntax
  changes its execution order; the UI does not assert purity. Existing compiled
  cartlib transfer tests still prove deeper/shallower task order and sharing.
- 1,688 Lua tests pass, one existing skip (1,689 total). Toolchain and IDE
  typechecks pass; the tests project retains exactly its 51 pre-existing
  diagnostics. Strict architecture boundaries, core parity, indentation and
  diff checks pass. There are no machine, cartlib or C++ changes.
- Full Studio workflows and Pietious pointer navigation pass on software,
  WebGL2 and WebGPU. The new independent fixture exercises physical cross-depth
  and only-child drops, review cancellation/held Apply/palette Apply, Source,
  text Undo/graph Redo and proposal invalidation. Existing Remove/Duplicate
  cancellation tests now aim at the side sector rather than an ambiguous card
  centre. The review and moved graph were inspected in real tiny-font WebGL2
  captures, not a mock renderer.
- The separate `--studio-bt-reparent` flow now boots independent executable Lua
  through ordinary Save/Reboot. It physically moves a task into a nested
  sequence, accepts the source review, saves through the real workspace API,
  and Hot Resumes the living component. Guest ICU input executes task order
  `123 -> 213`; one Undo, Save and second Hot Resume restores `123`. Actor,
  component and blackboard identity remain unchanged, including the retained
  semantic blackboard value `73`. All three renderers pass. The test never calls
  guest closures or writes guest tables from the host; it does not claim to
  preserve old compiler-owned task memory across program replacement.
- The browser harness now owns scenario composition once, not in three copied
  backend branches. Backend construction, real WebGPU callback/readback checks
  and final software framebuffer publication stay with their renderer project;
  the existing pre-/post-reboot ordering is preserved. This follows the existing
  FSM live fixture and [VS Code's debugger automation](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/test/automation/src/debug.ts):
  drive actual commands/input and wait for their observable state, rather than
  simulate the implementation under test. Artifacts: `/tmp/bmsx-bt-live/`.
- After this harness change the complete existing Studio workflow also passes
  on software, WebGL2 and WebGPU, including its intentional fault/recovery and
  real WebGPU readback lifetime cases. The tests-project typecheck has exactly
  the same 51 diagnostics as `04913678b`; strict boundary, core parity,
  indentation and diff checks pass. There are no product/runtime changes in
  this dedicated proof slice.
- B04's broader API/context ownership and foreign-resource authoring remain open.

### Isolated pointer cost

Node 22.23.1, four baseline/current process pairs against `aaa45e955`, identical
esbuild bundles, ten warmups and median-of-25 samples per process. Values below
are medians across those processes, in microseconds per operation. Setup is
batched by 100; pointer and paint work by 1,000. The input and semantic snapshot
already exist, so setup excludes parsing and source projection.

| Sibling entries | Operation | Baseline | Current |
| --- | --- | ---: | ---: |
| 24 | Gesture construction | 0.268 | 1.690 |
| 1,024 | Gesture construction | 0.191 | 18.175 |
| 24 | Moving pointer | 0.042 | 0.044 |
| 1,024 | Moving pointer | 1.585 | 1.572 |
| 24 | Preview paint + quad construction | 4.142 | 4.153 |
| 1,024 | Preview paint + quad construction | 11.372 | 11.077 |

Construction is deliberately more expensive: it now builds the source-list and
relocation analysis once per gesture. Stable hover/drag performs zero target
queries; measured stationary paths remain below 0.06 microseconds here. The
profiler asserts retained graph/document, feedback and quad-buffer identity,
and no source changes. These are not complete-frame, GPU, heap or GC claims.
Raw logs, profiling bundles and captures are in `/tmp/bmsx-bt-reparent/`.
