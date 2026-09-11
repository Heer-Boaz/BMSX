# Written assignments and unknown value contributions

2026-09-11, baseline `bccb86240`. B04 producer work; not a closed source query
or permission to broaden Lens recognition or mutation admission.

## Reference and live owner, before implementation

TypeScript's
[`createFlowMutation` and `bindAssignmentTargetFlow`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/binder.ts#L1401-L1410)
retain the actual written node independently of the assigned type. Its checker
[`getTypeAtFlowAssignment`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/checker.ts#L29038-L29066)
distinguishes compound assignment from copying the RHS. These are the relevant
boundaries, not a mandate to transplant JavaScript narrowing or its entire CFG.

BMSX's `semantic/model.ts` currently omits unmodeled assignment values, missing
initializers and unknown logical operands. It also deduplicates distinct written
assignments by semantic value. `FunctionSummaryStore` consequently cannot retain
an unknown alternative which was never produced. Bound owned-expression roots
do not repair this: equal literal values are not equal source occurrences.

## Contract

- Every visited expression produces a semantic value, including explicit unknown
  for computations the value analysis does not evaluate. Unknown is an abstract
  language value, not missing/corrupt binder state or a runtime fallback. Reuse
  the immutable unknown value/result instead of allocating for every arithmetic
  expression. Name/declaration discovery remains separate from value knowledge.
- Each declaration contribution retains its actual assignment/function/table/
  iteration syntax and target/field index. Repeated writes and self-assignments
  remain distinct occurrences. No encoded coordinates or synthetic expressions.
- Existing non-declaration value-flow facts also retain their actual syntax and
  slot. Logical operand transfers and builtin prototype effects are still
  transfers, not misclassified written storage assignments. Their syntax kind
  and relation distinguish these from assignment statements/table fields.
- Evaluate every written RHS and resolve assignment targets in the existing
  language order. Missing lanes after a single-valued tail produce nil; an
  expanding call/vararg tail contributes unknown for additional result lanes
  until multi-result semantics exists. Do not reuse the first result as another
  lane. Surplus RHS expressions still bind their calls and references.
- Compound assignment produces an unknown computed result, not an alias to its
  RHS or a named function declaration. Both operand references remain visited.
- Unknown does not establish root identity. Constant bindings and module exports
  with unknown values must not union unrelated declarations with one abstract
  unknown root. Ordinary value relations retain the unknown contribution.
- File facts retain occurrences; summary term sets and query relations own value
  deduplication. Remove the binder's per-body value-dedup map rather than keeping
  a second parallel source index. No per-query AST rescan.

The existing syntactic call/vararg classification is duplicated in compiler value
flow and diagnostics. Put that syntax fact in the shared AST owner and consume
it there and in assignment binding; the bytecode compiler keeps its additional
module-binding/prototype optimization knowledge. The live parser erases grouping
parentheses; this slice does not invent a different semantic rule for them.

## Scope, cost and proof

TS tooling only; no cartlib, guest runtime or C++ representation change. Hot
owners: expression/statement binding, declaration/member indices, identity union,
summary construction and the existing demand/instantiation consumers.

Independent fixtures must cover identical-valued writes at different syntax,
unknown/compound/nil assignments, parallel lanes, surplus RHS, table and logical
contributions, nested-closure ownership and immutable snapshot lifetimes. Use
compiled BLua results as the oracle for assignment behavior at O0/O3. Measure
real workspace and synthetic bind/query costs against the baseline, and run the
actual Studio Source/Back, Undo and Save/Hot Resume routes on all renderers.

This remains a flow-insensitive may relation: no reaching-definition proof,
call-context correlation, alias-clobber completeness or cross-file editable
document ownership is promised. Module return/control-flow modeling and expanded
result lanes remain separate limitations. B03 reparenting and B06 property edits
remain required outcomes after those source-query/resource gates, not replaced
by this prerequisite.

## CPU oracle finding: local initializer register ownership

The new shadowing/parallel-initializer oracle reproduced `9, 9` instead of
`9, 3` for `local left = 3; do local left, right = 9, left; return left, right end`
on both the baseline and current code at O0/O3. Binding points the RHS at the
outer local correctly. Codegen folds the first initializer without reserving
its position, places the second initializer's temporary in the first local's
future register, then overwrites that temporary when publishing the first local.

Lua 5.4's [`localstat`/`adjust_assign`](https://github.com/lua/lua/blob/v5.4.8/lparser.c#L1725-L1760)
materialize consecutive result slots before activating the new locals.
BMSX can retain delayed constant emission, but each initializer's allocation
must start at or above its eventual local slot, including positions occupied
by earlier folded constants. The existing `reserveTempRange` owns this; reserve
the preceding result positions before evaluating each RHS. Do not add a second
temporary bank, reverse source evaluation, or compensate in semantic binding.
Local activation and the special recursive const-closure path stay unchanged.

## Workspace finding: unknown is not a shared object identity

The first complete workspace query did not finish normally: after 77 seconds it
was still consuming a core and roughly 877 MiB RSS; the diagnostic process was
terminated. Small fixtures distinguish the bug from mere new work: two unrelated
bindings with arithmetic alternatives, followed by a member write through one,
make navigation attribute that member to the other. The member-write join indexes
their common abstract unknown as though it were a common object. Reverse-location
and prototype joins have the same representation assumption. Isolating only the
reverse-location or only the prototype-owner route does not repair the query.

TypeScript's [`getPropertiesOfObjectType`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/checker.ts#L14986-L15005)
queries members only for object representations. Applying that boundary here is
an inference for BMSX's existing term solver, not a copy of TypeScript's algorithm:
unknown remains a value contribution, but it cannot establish storage identity
or key a known member/prototype alias join. Access paths rooted in unknown remain
unknown too. The term owner retains this classification at construction; consumers
do not repeatedly walk paths or guess from host objects. Reads of an unknown
receiver retain unknown, rather than yielding a known member from an unrelated
receiver. Unknown writes still do not constitute a complete alias-clobber model.

The follow-through probe also reproduced the false join for `nil`, booleans,
numbers and strings. The identity owner now retains canonical literal-root
classification through unions before term paths exist; this avoids a late
literal compile changing an already cached path's identity classification.
Terms distinguish location identity, literal value and unknown, including their
access paths. The member, reverse-location and prototype joins consume that
representation directly. No per-query path walk or feature-specific filter.

Demand selection needs a separate distinction: removing *all* scalar dependencies
loses the real workspace target, because a concrete string can select keyed
producers. Keep that forward value dependency, but never reverse it into every
binding containing the same scalar. Unknown has no concrete producer identity.
The original forward assignment/return facts still retain scalar and unknown
contributions. With the corrected direction and joins, the uncapped real query
finishes and retains the original target. Paired measurements remain necessary;
the first successful diagnostic sample was 251 ms, not a latency win.

This does not turn the navigation API into a closed known/unknown source result.
In particular, projecting a binding's possible values to member locations is
not itself a complete account of unresolved derived reads or alias clobbers.
The input contributions and unknown-rooted paths are retained; the stronger
source-query result still has to consume that distinction explicitly.

## Measurements

Four alternating isolated baseline/current process pairs, Node 22.23.1 on
Core Ultra 7 265KF, using the existing six semantic profilers. No browser/build
ran concurrently with timing. Baseline substitutes `bccb86240`'s changed semantic
owners, including the selection, location and instantiation consumers. Medians
are the mean of the two middle process results, in milliseconds:

| Surface | Before | After |
| --- | ---: | ---: |
| Real workspace cold query | 242.608 | 253.897 |
| Real workspace initial parse + binding | 266.240 | 264.190 |
| Edited-file binding | 4.632 | 5.498 |
| Bind 1,024 ordinary functions | 4.764 | 4.648 |
| Summaries, 1,024 functions | 0.547 | 0.566 |
| First query, 1,024 functions | 2.606 | 2.630 |
| Bind 1,024 methods | 3.535 | 3.476 |
| Summaries, 1,024 methods | 0.583 | 0.627 |
| First query, 1,024 methods | 2.625 | 2.403 |
| All 256 uncalled receiver queries | 7.785 | 7.695 |
| 256 calls, unwritten parameters | 7.207 | 7.318 |
| 256 calls, written parameters | 8.657 | 8.775 |
| Recursive inputs, 64 links | 12.091 | 12.292 |

Real-query ranges: 234.019–243.904 / 250.469–261.646 ms. Peak process RSS medians:
299.8 / 314.6 MiB, not retained heap. Corpus: 191 files / 1,217,268 bytes and 1,690
summaries; target remains `cartlib/actioneffects/actioneffect_component.lua:62:14`.
Frames grow 304→319, call evaluations 855→969, value evaluations 2,581→2,898,
member evaluations 1,286→1,456, location evaluations 2,021→2,292 and prototype
evaluations 2,689→2,904. Passes remain ten; static-callee/effect-body counts remain
2,086/109. These additional results have not been certified as a complete source
execution graph. The real latency and edited-file costs regress: B04's latency
gate remains open. Do not recover the old time by discarding unknown facts.

Artifacts: `/tmp/bmsx-assignment-flow/`; `before-location-identity/` is the
aborted first measurement attempt, not final evidence. `final/` contains the
paired results. Temporary diagnostic bundles used explicit bounded sampling to
inspect runaway work; no production timeout, query cap or cart exception exists.

The compiler fix reserves existing result positions rather than allocating an
entire second scratch bank. CPU tests exercise mixed folded/runtime initializers,
shadowing, surplus expressions, closures and multi-result tails at O0/O3. This is
not a full guest-frame, GPU or SNES-mini performance measurement.

## Validation

- Thirteen independent contribution/identity tests pass, including actual
  instantiation of a captured unknown write and CPU oracles at O0/O3. The
  metatable oracle uses a real system-module boot binding and VM primitive, not
  a replacement implementation. The minimal CPU harness alone does not install
  BIOS primitives; the first version of that fixture exposed this test setup
  omission and was corrected at its boot boundary.
- Full Lua suite: 1,457 passed, one existing skip, zero failures. Two previous
  function-source assertions now also expect the real nil initializer; they
  still distinguish every function body and discarded RHS expression.
- IDE typecheck, debug Studio build, strict architecture audit (zero issues),
  core parity, indentation and diff checks pass. Tests-project typecheck has
  exactly the same 51 baseline diagnostics, not a clean result.
- Actual full Studio workflows and Pietious navigation pass on software,
  WebGL2 and WebGPU: Source/Back, autosave, Undo, graph operations and ordinary
  Save/Hot Resume. These are existing-workflow regressions, not evidence that
  B03 reparenting or B06 property authoring has been delivered.
