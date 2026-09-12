# Callable uses: selection from retained bindings

Baseline `749278497`, 2026-09-12. This bounded use-discovery correction leaves
B04 open.

WALA's [DefUse](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ssa/DefUse.java#L54-L86)
indexes uses by their value identity, separately from interpreting the
instruction. Its [demand flow graph](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/demandpa/flowgraph/AbstractDemandFlowGraph.java#L70-L110)
admits a body's constraints on demand. These are owner references, not a reason
to import Java SSA, whole-program reachability or optimistic unknown removal.

The live source query discovers named creator callers but misses a returned
callback invoked through a body-local binding. The function value, contextual
return assignment and local binding are already present in the shared value
relation. The query does not follow their *uses* to the retained callsites.
Scanning every function body or making ordinary member queries traverse all
reverse aliases would answer a different, much more expensive question.

The correction has three boundaries:

1. `SemanticDemandIndex` indexes exact callee uses for every retained static
   call. It does not discard uses because a particular old consumer wants only
   root/local candidates. That projection policy belongs to that consumer.
2. A shared callable-use query follows the assignment relation backwards from
   the requested function value and its known lexical creator contexts. It
   selects callsites, not function targets. Reverse rows and creator-frame
   extents are tracked dependencies; warm queries do not rescan the workspace.
3. `SemanticCallGraph` requests those sites in their owners using the existing
   callee solver. Only resolved callees instantiate applications. Templates
   select source sites; their arguments remain bound to actual owner contexts.

There is no second evaluator or alias graph. Inferred read answers are not
converted into reverse assignments. No member-name coincidence or shared scalar
value connects unrelated bindings. The query must not interpret a selected use
or a positive analysis frame as proof of module-rooted execution. Existing
projection ancestry remains explicit.

This closes neither all possible callable-use discovery nor the full source
origin contract. Writes not yet materialized by their owner, unknown calls,
dynamic member paths and application-specific completeness remain separate
questions. The source editor does not gain permission to mutate every matched
caller's definition. B03/B06 authoring and resource-owned origin consumers remain
gated.

Required evidence: a cold nested factory without caller prequeries; anonymous
local callbacks; alias cycles and later assignment facts; imported and unused
closures; exact template selection and bound arguments; unrelated bodies;
O0/O3 guest results, full language tests, actual Studio routes and paired cost.

## Implementation

`SemanticCallableUseQuery` uses the existing `SemanticQueryResults`, numeric
term identities, creator-frame extent and `values.firstReverse` dependencies.
Traversal storage and call deduplication are reused; a warm read returns the
retained answer. It does not walk syntax, call `resolveCallable`, materialize
writes, or publish effects. Missing incoming assignment rows are real tracked
inputs, not a reason to cache an empty answer permanently.

The exact callee index replaces the restricted caller index; it is not a
parallel per-feature index. The ordinary projection consumer still selects
externally addressable/direct-local candidates. Source-context demand consumes
the complete exact index. `SemanticTermStore.retainedTemplate` removes contextual
roots at the representation owner, preserving access kind and both indexed
operands. It consumes existing paths and retains negative path dependencies;
it does not manufacture a source path or turn a template into a value alias.

Site selection returns the original owner-bearing `SummaryCall`. The callgraph
uses the existing registration path for current and later owner frames. An
experiment making that entire path a one-shot admission missed a later frame
published directly by the instantiation owner. The existing regression test
caught it; the shortcut was removed rather than weakening the test. More precise
frame-admission scheduling would require a separate dependency/lifetime change.

## Independent proof and costs

Three cold public-query probes fail on the baseline with zero module-rooted
heads: nested factory, anonymous binding cycle, and indexed callback. All now
find their two distinct callback applications. A member-callback control already
passed on the baseline and remains covered. Each executes at O0 and O3 and
checks captured values in guest code. The analysis test follows application
edges from the module: a positive frame descended only from a projection does
not pass that assertion. Existing unused/imported/recursive/late-frame tests
remain intact. Separate tests cover the complete callee index, reverse-row
invalidation, unrelated growth, alias cycles and path/template identities.

Four alternating baseline/current process pairs, Node 22.23.1, unpinned Intel
Core Ultra 7 265KF. No concurrent BMSX builds, tests or browsers during profiling.
Synthetic rows are medians of four process medians with retained binder facts
and a fresh query store. The diagnostic workspace is the same 191 files /
1,217,268 bytes; its cart sources are not a stable independent fixture.

| Boundary | Baseline ms | Current ms |
| --- | ---: | ---: |
| Caller contexts, 256 sites | 2.529 | 2.534 |
| Caller contexts, 1024 sites | 18.662 | 19.000 |
| Source ancestry, 256 callers | 3.075 | 3.018 |
| Source ancestry, 1024 callers | 21.571 | 21.846 |
| 1024 functions, one demanded call | 2.605 | 2.809 |
| 1024 methods, one demanded call | 2.754 | 2.768 |
| 256 sites, never-written formals | 7.884 | 7.822 |
| 256 sites, written formals | 10.033 | 9.814 |
| Recursive inputs, 64 links | 12.439 | 12.754 |
| Real workspace cold symbol query | 282.599 | 272.189 |

The real query retains the same answer, 1690 summaries, 319 frames and all
solver work counts (955 call / 2719 value / 1339 member / 2097 location /
2602 prototype evaluations). Caller-context and callable-use evaluations are
both zero for that ordinary symbol query. The cold ranges overlap:
269.373–287.436 / 260.191–280.589 ms. This does **not** establish an overall
speedup or close the latency gate. Process wall medians are 0.770/0.760 s and
peak RSS 314.2/312.7 MiB, not allocation or retained-heap measurements. Small
workloads include measured additional cost. Absolute timing differs from the
preceding run on this unpinned host; results from different runs are not paired.

The new independent body-local-use profiler has 1/128/1024 owner functions, all
using a common leaf function, but asks about only the first callback. Cold
medians are **0.207/1.226/17.708 ms**; every case performs **5 frames, 8 call
evaluations, 3 caller-context and 3 callable-use evaluations**. Summary/static
construction still grows with the file (3/257/2049 summaries). Retained reads
average roughly 0.009/0.009/0.016 microseconds in 10,000-read batches; these are
not UI latency measurements. The incomplete baseline answer is not used as a
faster comparison. The existing module-closure profiler also keeps its 4 frames
and 6 call evaluations as unrelated creators grow.

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_callable_uses.ts
```

Artifacts, red probes, rejected admission experiment and paired measurements:
`/tmp/bmsx-callable-uses/`.

## Validation

- **1613 Lua tests / 1612 pass / one existing skip**, including 48/48 focused
  call-context and term-dependency tests. None of the tests was changed to accept
  the failed one-shot admission experiment.
- Toolchain and IDE typechecks pass. Tests-project diagnostics match the same
  51 baseline entries after removing positions, preserving filename, code,
  message and multiplicity. The tests project is not typecheck-clean.
- Strict architecture boundaries (zero issues), core parity, indentation and
  forced debug Studio build pass. No guest, compiler or mirrored runtime ABI is
  changed.
- Actual full Studio and Pietious Source/navigation workflows pass on software,
  WebGL2 and WebGPU: six backend gates, including the existing context-menu,
  drag/Undo, Hot Resume, scenario cancellation and autosave routes. All six final
  captures are byte-identical to the preceding slice; the software Studio capture
  was also inspected. These isolated copied-workspace runs do not alter the
  user's running Studio server. The reload-only matrix was not rerun here.

These browser runs prove existing UI regression routes, not a new B03 gesture,
B06 property editor or imported-source UI. The closed boundary is discovery
through retained bindings; full source completeness, resource-owned consumers,
cross-edit reuse and cold latency remain open.
