# Source call graph

Starting at `788e6858d`. This connects the retained call applications to written
source ancestry; it does not replace the call solver or claim runtime execution.

## Reference and contract before implementation

[WALA's explicit call graph](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/impl/ExplicitCallGraph.java#L159-L215)
keeps source-callsite edges distinct from interned method/context nodes and
retains predecessors. [Roslyn's argument tracking](https://github.com/dotnet/roslyn/blob/0c14b7cb5e382318c4322e29e045f48b11c641ca/src/Features/Core/Portable/ValueTracking/ValueTracker.OperationCollector.cs#L160-L191)
keeps the ordered written arguments grouped rather than flattening unrelated
contributions together. Neither implementation's runtime guards, thread model
or representation shortcuts are adopted here.

The live BMSX solver already retains `(site, owner context)` and each application
into an interned target frame. That is not yet enough to follow a registration
inside a wrapper backwards: a shared target frame may have several incoming
applications, and its first caller is not its complete source ancestry.

- Binder call facts retain their actual call AST. The navigation callsite points
  at that same fact, also for anonymous or computed callees without a reference.
  No source recovery through encoded positions, callee spelling or result IDs.
- The existing call graph owns a lazily built incoming-application index. New
  applications update its target row and tracked dependency; source consumers
  must not scan all workspace calls on each lookup.
- The source query collects a finite graph of calls, applications and activation
  nodes. It retains each call's ordered bound inputs and written AST as one tuple.
  It does not independently flatten id/definition argument origins or equate
  an interned frame with one incoming source occurrence.
- Activation nodes distinguish module evaluation, hypothetical body projection
  and call instantiation. Lexical closure ancestry is separate from caller edges.
  Positive frames are not automatically module-rooted or execution witnesses.
- Numeric solver frames remain inside the language owner. The source result
  exposes identity-bearing graph nodes, original function-flow facts and call
  syntax. Resource paths remain those of the retained AST, not the head query's
  file. No new cartlib metadata or Lens wrapper evaluator.
- Queries use the existing dependency machinery, including negative predecessor
  reads, recursive edges and later applications. No independent revision clock,
  query cap or transitive copy at every intermediate call.

Known applications remain a may-call set, not a completeness certificate. The
graph preserves an unresolved head call with its arguments even if there is no
known target. It does not reinterpret argument-tail expansion or turn source
tuples into runtime argument values. Written argument substitution, unknown
member/callee contributions and resource-owned editor consumption still have
their own proof obligations. B03/B06 authoring remains on the work list.

Independent tests must cover paired wrapper inputs, shared frames with distinct
callers, recursive predecessor cycles, projected ancestry, closures from another
activation, imported factories, unresolved anonymous/computed calls, warm query
reuse and invalidation after a new incoming edge. The full language suite and
real workspace/Studio regressions remain gates.

The first probes expose a distinction in the live demand engine: materializing
a body's projected value facts does not mean its caller-context query has run.
`SemanticCallGraph.compose` currently uses the instantiation projection flag for
both. Querying a callee before its wrapper can therefore suppress the wrapper's
later caller query. Those two owners need distinct completion state. An ancestry
query must also request the particular predecessor sites it actually follows;
otherwise later caller frames need not instantiate that source-call edge.

The query-order regression is independently red on `788e6858d`: requesting the
wrapper after its callee returns no instantiated caller contexts instead of two.
The correction gives the call graph its own caller-query state; the instantiation
owner still controls body projection. Source ancestry requests the predecessor
sites it follows through the existing call query, not a second callee selector.

At this slice's baseline, the closure ancestry test first established the two
callable applications through another query. The later
[closure-caller-context slice](lua_closure_caller_contexts.md) removes that
prerequisite for its tested module-rooted factories, including imports and
nested/stored/forwarded closures. **Discovering every closure use remains open**:
factory and callback uses through aliases local to another function are not
solved by an incoming index alone. The subsequent
[callable-use query](lua_callable_use_demand.md) follows those existing bindings
to their exact callee sites. None of these slices is a completeness certificate
for the future source-editor consumer.

## Evidence

- 26 independent call-context tests pass, including the query-order regression,
  shared frames, recursion, negative dependency reads, later incoming edges,
  imported factory paths and lexical closure ancestry. The paired-input fixture
  also executes on the CPU at O0 and O3. No cart-specific source line is needed
  by these contract tests.
- Full Lua suite: 1,507 passed, one existing skip, no failures. Toolchain and IDE
  typechecks pass; the tests project retains exactly its 51 baseline diagnostics.
  Architecture/parity/indentation audits pass.
- The actual Studio workflow and Pietious Source/navigation browser gates pass
  on software, WebGL2 and WebGPU. This is regression coverage, not proof of a
  source-editor integration that this slice deliberately has not implemented.
- Four alternating isolated-process comparisons against `788e6858d`, using the
  same 191-file / 1,217,268-byte Nemesis/cartlib workspace:

  | Boundary | Baseline median | Current median | Baseline / current range |
  | --- | ---: | ---: | --- |
  | Bind workspace | 265.518 ms | 263.714 ms | 260.554–272.848 / 254.960–267.397 ms |
  | Cold `self.actioneffects` symbol query | 263.849 ms | 265.853 ms | 248.637–267.635 / 249.933–297.142 ms |
  | Edited-file semantic update | 3.817 ms | 4.385 ms | 3.458–5.562 / 3.443–5.349 ms |

  All solver work counts remain identical: 1,690 summaries, 319 frames, 10
  passes and 969 call evaluations. This is not a cold-query speedup, nor is a
  roughly 266 ms interactive cold query the eventual performance goal.
- The independent source-ancestry probe at 1/64/256/1,024 callers takes
  0.045/0.689/2.520/21.435 ms cold, including creation of a fresh query store but
  excluding binding, execution and rendering. It retains 3/129/513/2,049 calls
  and application edges. Warm lookups in 10,000-lookup batches are approximately
  0.009/0.009/0.009/0.016 microseconds each. These narrow retained-query numbers
  are not end-to-end Studio latency claims.

Artifacts: `/tmp/bmsx-source-call-graph/`. An earlier paired run is retained in
its `initial/` directory; the final run also avoids redundantly asking the
instantiation owner to compose an already queried body.

## Contextual written values (2026-09-12)

Follow-up starting at `1fda33ae3`. The call graph now feeds a demand-only
`LuaSourceValueQuery` through `WorkspaceSymbolResolver.contextualSources`.
This is the call/alias part of B04, **not** completion of its member-origin,
resource-model or authoring contracts.

### Production references and representation

WALA's
[parameter/return transitions](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/demandpa/alg/DemandRefinementPointsTo.java#L1227-L1345)
label interprocedural edges with their caller and callsite, using its existing
target solver. Roslyn's
[operation/argument collector](https://github.com/dotnet/roslyn/blob/0c14b7cb5e382318c4322e29e045f48b11c641ca/src/Features/Core/Portable/ValueTracking/ValueTracker.OperationCollector.cs#L106-L218)
retains actual operations and groups argument contributions. Both were read
before implementation. BMSX applies these ownership distinctions; it does not
copy WALA's fallback branches, optimistic assumptions or refinement framework,
nor Roslyn's task/threading infrastructure.

| Owner | Representation and lifetime |
| --- | --- |
| Written-source query | Original argument expressions, bound callee facts, first-result return statements and body completion. Every occurrence owns its original `FileSemanticData`; equal literals are not source identities. |
| Function summaries / term store | Parameter ordinal and body remain known after assignment makes the binding writable. The entry-owner map no longer destroys that fact to choose storage. A separate local-storage owner still produces `Local` for written formals, `Parameter` for read-only formals. No extra alias for read-only inputs. |
| Call graph | Exact `(site, owner frame)` lookup uses the existing work-item index, not a linear search of all contexts or a second index in Lens. Only this solver creates call applications. |
| Source-call query | Module/function activation objects, lexical scope, retained incoming/application rows. Function application targets are represented as function activations, not cast from the module/function union. Row replacement preserves consistency of earlier trace snapshots. |
| Source-value query | A point is `(written occurrence, activation)`. Written edges preserve writer scope; argument and return edges retain the original application object. Queries and negative/late dependencies use `SemanticQueryEvaluation`. |

Consumers choose a source-call context **before** tracing its argument lanes.
Different calls therefore do not cross id/definition origins. A shared analysis
frame still has several incoming applications; the returned graph preserves
their labels. A consumer must not turn independently flattened terminal lists
into a Cartesian product, or mistake module connectivity for runtime execution.

Captured parameters follow the lexical creator, not the caller of a returned
closure. A write in another body remains a projected contribution with its
own owner; it is not labelled as an executed write in the requesting activation.
Projection inputs remain visible boundaries. Recursion and alias cycles remain
finite graph edges rather than repeated stack expansion or capped queries.

The source argument owner uses semantic ordinals, including a colon receiver.
An omitted fixed argument is an actual implicit nil occurrence at its callsite;
an additional lane of a tail call/vararg remains unknown with that same site
and ordinal. The existing first-result solver does not suddenly claim full
multi-result analysis. Empty return and reachable fallthrough keep distinct
nil occurrences; unresolved completion is not discarded.

Known factory returns can now lead back through arguments into a different
file. The result also retains a **call-result boundary** with its callee source
point and known applications, including an empty application set. One known
function is not an exhaustive-callee certificate: a conditional unknown
replacement remains reachable by tracing that callee source. Member/index
paths remain explicit boundaries of the written-source owner, not a hidden
second field evaluator in this query or a Lens-specific exception.

### Review and validation obligations

- Independent fixtures cover ordinary aliases, paired wrapper inputs, lexical
  factories, imported providers/module factories, reassigned and captured
  formals, receiver lanes, nil versus expanded arguments, empty returns,
  recursion, shared frames, unknown callees and source generations.
- Late application and predecessor publication must invalidate an already
  retained trace; its old result must not gain applications without matching
  return edges. Warm reads must preserve both result identity and evaluation
  counts.
- Review found that the term store's existing parameter-owner map discarded
  writable formals. Exposing that map as complete source-entry metadata was
  wrong. The correction keeps entry identity and storage classification
  separate in the producer, rather than adding a guard or reconstructing an
  ordinal at the feature callsite.
- Contextual discovery and full traces need their own cold measurements, in
  addition to paired real-workspace and ordinary-query regression measurements.
  Existing browser Source/Back routes are regression coverage only until the
  multi-resource Lens consumer is connected.

### Validation of contextual written values

Artifacts: `/tmp/bmsx-source-bindings/`. The independent fixtures also execute
the relevant Lua on the CPU at O0/O3. The editor-model test changes only an
imported factory, retains the importing file's binder facts, and checks the new
provider range, non-mutating reads and Undo; it does not substitute for the
not-yet-connected multi-resource Lens consumer.

- Full Lua suite: **1,631 passed, one existing skip, zero failures**.
- Toolchain and IDE TypeScript pass. The tests project still reports the same
  **51 baseline diagnostics**, comparing complete diagnostic blocks after
  normalizing locations; it is not a clean typecheck.
- Strict architecture audit, core parity, indentation and `git diff --check`
  pass. This slice changes no guest/runtime representation or C++ code.
- Fresh browser Studio build; Studio workflows and source navigation pass on
  software, WebGL2 and WebGPU. All six end captures are byte-identical to the
  previous slice. Captures were inspected, not treated as proof of new Lens
  authoring or correct UX everywhere in the pre-existing screens.

Four alternating isolated process pairs against `1fda33ae3`, Node 22.23.1,
Core Ultra 7 265KF/WSL, unpinned hybrid cores. Numbers are medians, not budgets:

| Cold query boundary | Before | After |
| --- | ---: | ---: |
| Real Nemesis workspace, `player.lua:1179:9` | 253.061 ms | 251.045 ms |
| 1,024 retained call contexts | 17.797 ms | 17.641 ms |
| 1,024 source ancestries | 21.337 ms | 20.848 ms |
| Closure-source lookup, 1,024 unrelated bodies | 17.250 ms | 16.551 ms |
| 32 ordinary parameter/member queries | 1.055 ms | 1.190 ms |
| 256 written parameter/member queries | 8.864 ms | 8.989 ms |

Real-workspace ranges overlap (241.580–255.543 versus 250.055–255.309 ms);
some synthetic cases are slower. Real-workspace solver work is unchanged:
1,690 summaries, 319 frames, 955 call / 2,719 value / 1,339 member evaluations.
Median process wall time is 0.71 s on both versions; peak RSS is 320,834 versus
321,266 KiB. These are not heap-allocation or whole-IDE latency measurements,
and roughly 250 ms is still too slow for the interactive latency gate.

The new `profile_contextual_sources.ts` traces both argument lanes for every
caller through aliases and factory returns: 1 / 64 / 256 / 1,024 callers take
0.225 / 1.464 / 4.649 / 33.247 ms cold. Warm point-plus-trace lookups take
0.023–0.050 microseconds in 10,000-read batches, with no additional query
evaluations. Cold includes fresh query owners and call discovery, but excludes
parsing, rendering and guest execution. No previous implementation exists for
this complete trace workload, so those figures are not a speedup claim.
