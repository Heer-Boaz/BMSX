# Lua completion values: absent return lanes are not absent alternatives

2026-09-11, baseline `bc6dc56fd`. B04 producer contract, written before edits.
This does not admit wider graph edits or turn navigation's may-target array
into an exclusive API-call proof.

## Live failure and references

`SemanticBuilder` retains written function returns, but an empty return, `nil`
or an unmodeled expression has an undefined first value. `FunctionSummaryStore`
drops that contribution. Reaching the end of a function contributes nothing
either. Consequently `if enabled then return callback end` has only the known
callback in its return relation, even though its first result can also be nil.

Production code studied:

- [Luau `getFallthrough`](https://github.com/luau-lang/luau/blob/47cda63705c25633d757bacdcb7c9c6190625cad/Analysis/src/TypeInfer.cpp#L84-L187)
  distinguishes falling out of a body from explicit return and non-exiting
  loops. Its statement traversal does not enter nested function bodies.
- [TypeScript branch/loop labels and return flow](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/binder.ts#L1510-L1599)
  give different exits actual control-flow edges. A loop break is not a function
  return; alternatives meet at the enclosing continuation.

BMSX supports `goto` whereas Luau does not. Its live compiler binds labels per
function, including labels inside nested blocks, and `HALT_UNTIL_IRQ` resumes.
Therefore a last-statement heuristic, a recursive `hasBreak` scan or assuming
ordinary Lua lexical label scope is not a correct implementation here. Nor may
the spelling `error(...)` prove non-return: its binding can be replaced.

The implementation review also checked [Clang's reverse compound traversal,
label map and goto successors](https://github.com/llvm/llvm-project/blob/d44c6a2b2527b7a93b7927a271fce5f584305afa/clang/lib/Analysis/CFG.cpp#L2993-L3022).
Its `VisitLabelStmt` / `VisitGotoStmt` at lines 3579–3668 retain forward jump
targets until bound, rather than abandoning analysis when a goto is encountered.
BMSX uses that continuation model, without C++ destructor/scope-unwinding logic.

## Owning representation

- Add nil to the existing typed semantic literal domain. Nil and unknown are
  different language facts. This is source tooling, not a new VM/guest value.
- Every written function return contributes a first result: nil for no result,
  the bound value when modeled, otherwise an explicit unknown. A missing modeled
  value must not make the written return disappear.
- A generic source completion analysis determines whether the body end is
  reachable. It builds only continuation/branch/loop/label edges, not one node
  for every ordinary expression. Nested functions own separate bodies.
- Literal truthiness follows Lua: nil/false are false; zero and empty strings
  are true. Conditions which require value analysis retain both paths. Numeric
  and generic loop bounds are not evaluated by this source-control-flow owner.
- Unbound/duplicate labels, a break outside a loop or parser-recovery statements
  produce an unresolved completion fact, not invented valid control flow.
- The binder publishes completion flags with the immutable function-body facts;
  unchanged files share them across snapshots. Summary construction consumes
  those flags without walking syntax again: reachable body end adds nil;
  unresolved completion adds unknown. Temporary graph/worklist storage is reused
  across bodies within a file bind. No statement execution, state-map cloning
  or iteration cap.

The existing relation remains a flow-insensitive may-value relation. This slice
does not remove unreachable written return alternatives, model all result lanes,
fix module-return export unions, preserve every unknown assignment or separate
hypothetical analysis contexts. Those distinctions remain explicit B04 work;
neither Lens nor a new completeness flag may overclaim them.

## Required evidence

Independent body/branch/loop/nested-function/goto/HALT fixtures; explicit nil,
empty and unmodeled returns; real summary-instantiation propagation and compiled
BLua first-result oracles. Measure fresh binding/summary/query cost against the
baseline using the existing synthetic and real-workspace harnesses. Then run the
ordinary Studio regression workflows, not a test-only Lua evaluator.

## Measured result

Four alternating isolated process pairs against `bc6dc56fd`, Node 22.23.1 on
Core Ultra 7 265KF. Existing source-query profilers, with the same retained-parse
and fresh-query boundaries as the preceding slices. Medians in milliseconds:

| Surface | Before | After |
| --- | ---: | ---: |
| Real workspace cold symbol query | 228.876 | 235.875 |
| Real workspace initial parse + binding | 256.270 | 253.279 |
| Edited-file binding | 3.432 | 3.563 |
| Bind 1,024 ordinary functions / methods | 4.842 / 3.487 | 4.935 / 3.529 |
| Summaries, 1,024 ordinary functions / methods | 0.545 / 0.595 | 0.555 / 0.581 |
| First query, 1,024 ordinary functions / methods | 2.587 / 2.627 | 2.695 / 2.621 |
| All 256 uncalled receiver queries | 8.112 | 7.525 |
| 256 callsites, unwritten / written parameter | 7.322 / 8.643 | 7.126 / 8.695 |
| Recursive inputs, 64 links | 12.308 | 12.459 |

The cold query is slower, not faster: its ranges are 220.616–231.422 /
232.861–251.458 ms. It retains the same source target and 1,690 summaries, now
304 rather than 303 frames, and 855 rather than 833 call evaluations. A separate
temporary frame trace identifies the additional valid call as the input-effect
component factory used by the game director. No new callee is claimed solely
from an equal target count. Peak process RSS medians are 299.7 / 305.0 MiB,
not retained-heap measurements.

The first experiment cost more in method binding. Terminal continuations now
return directly without entering the reachability worklist; bodies without
labels do not clear an already-empty map. Scratch buffers remain reused, while
the immutable completion flag belongs to the bound file, not each new query.
Neither these changes nor the faster receiver workload close B04's latency gate.
Known-plus-unknown return information is not removed to recover the old timing.

Nine independent tests pass, including many branch/loop/jump cases within the
table-driven tests. Compiled BLua confirms nil, ordinary and callback results;
the cross-block jump oracle runs at O0 and O3. Two earlier tests which explicitly
expected missing return alternatives now assert the corrected nil/unknown
contract. Full Lua suite: 1,444 passed, one existing skip, no failures.

The malformed-source fixture initially used strict parsing and then a recovery
case which discards a statement. It now uses the real retained `ErrorStatement`
producer. Completion flags do not replace file/parser diagnostics: recovery can
also omit syntax, which remains a separate barrier to a closed source result.

Artifacts and baseline-substitution scripts: `/tmp/bmsx-return-flow/`.

Final validation also passes IDE typecheck, debug Studio build, strict
architecture audit (zero issues), core parity, indentation and diff checks.
The tests-project typecheck has the same 51 baseline diagnostics, not a clean
result. Actual full Studio and Pietious navigation workflows pass separately on
software, WebGL2 and WebGPU, including Source/Back, Undo and Save/Hot Resume.
These protect existing workflows; B04's stronger source query and B03/B06
authoring remain open.
