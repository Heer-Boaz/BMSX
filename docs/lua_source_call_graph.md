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

An explicit remaining boundary: discovering **every use of a returned closure**
is not solved by an incoming index. The closure ancestry test first establishes
the two callable applications through the existing call query, then checks that
source ancestry keeps the two lexical creation contexts separate from the two
invoking callsites. This is not an end-to-end closure-use discovery claim and
must not be used as one by the future source-editor consumer.

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
