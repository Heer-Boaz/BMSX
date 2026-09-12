# Closure creators and demanded caller contexts

Baseline `7d0b5a30b`, 2026-09-12. This caller-demand correction does not close B04.

## Contract before implementation

WALA's [scope-mapping instance keys](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/cast/src/main/java/com/ibm/wala/cast/ipa/callgraph/ScopeMappingInstanceKeys.java#L60-L117)
retain a function value's creator separately from its caller. Its
[lexical read constraints](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/cast/src/main/java/com/ibm/wala/cast/ipa/callgraph/AstSSAPropagationCallGraphBuilder.java#L385-L411)
consume the defining environment, not a similarly named current caller.
BMSX already has corresponding lexical frame ownership; it lacks part of
the *demand* needed to discover those existing contexts from a cold source read.

The independent returned-closure test previously established `left()` and
`right()` explicitly before asking about a call inside their common closure
body. Without those prerequisite queries it returns zero invoked heads rather
than two. The source ancestry consumer must not preseed a preferred query order.

Three owners remain distinct:

1. Instantiation projects captured bindings and materializes body effects.
2. The call graph discovers callers and schedules particular source sites in
   both already known and subsequently discovered owner frames.
3. The source ancestry query consumes those retained contexts and applications;
   it does not select callees or infer runtime execution from a positive frame.

Requesting a nested body must also request its lexical creator. Projecting
the creator's bindings does not perform that caller query. Module boundaries
expose a second distinction: reverse caller selection should consume the
existing call graph's known incoming sites, not reopen broad module aliases
just to discover a proven static callsite.

An initial experiment walked incoming callers for every body projection. It
passed the focused closure probes but increased the real symbol query from
319 to 612 frames and 955 to 3145 call evaluations. It is rejected: a member
value query and a query enumerating caller contexts do not ask the same question.

The implemented boundary is a tracked, demand-only caller-context query in the
call graph, invoked by `callContexts`. It follows lexical creators and known
incoming sites using the shared dependency/evaluation owner. Incoming fact
rows invalidate that demand, including empty rows and later discovered edges.
Its recursion uses retained query state, not a traversal cap. Site admission
is shared with ordinary callee queries so new owner frames receive the same
site request; a projected work item is not a substitute for that lifetime.

This is not permission to equate a may-call set with all possible execution.
**Remaining boundary:** a factory and its returned closure both used through
body-local aliases inside another function still require callable-use discovery.
The cold `localFactory` probe in `/tmp/bmsx-closure-discovery/cases.ts` records
that gap. It must not be hidden by pre-querying its uses, an all-body scan,
a test that enshrines the missing answer, or a module/cart-specific path.
The generic consumer must retain that uncertainty until the corresponding
use/dependency owner is implemented. B03/B06 authoring stays gated.

Required evidence includes cold/warm queries, two captured environments,
nested/stored/forwarded/imported closures, uninvoked closures, cycles and late
incoming edges; the complete language suite and actual Studio flows; and
paired demand/performance measurements that include unrelated bodies.

## Implementation and evidence

`SemanticCallGraph` owns caller-context demand separately from `compose` and
the ordinary callee query. It follows lexical creators and the retained
`CallFact` incoming row. Anonymous functions have no declaration-indexed
incoming row; their lexical owner and application edges are not replaced by a
fabricated declaration. `queryCall` owns site admission into the projected,
existing invocation and subsequently created invocation contexts. New facts
invalidate caller demand through the shared dependency graph; publication does
not recursively evaluate that query inside `retainFact`.

Seven new independent tests cover cold nested/stored/forwarded/imported
closures, an uninvoked closure, late incoming facts and unrelated creators.
The original lexical-owner test now starts cold, with no `left()`/`right()`
prequery. Direct/nested/stored/forwarded fixtures also execute at O0 and O3.
The full call-context suite covers recursive/reused frames and negative facts;
the new late-fact test changes an incoming row without adding an invocation to
the queried closure, so application invalidation cannot accidentally mask a
missing incoming dependency. Warm reads retain result identity and metrics.

Four alternating baseline/current process pairs, Node 22.23.1 on the same
unpinned Intel Core Ultra 7 265KF host. No concurrent BMSX build, test or browser
process was used during profiling. Synthetic rows are medians of four process
medians; the profilers retain binder facts and include a fresh query store.

| Boundary | Baseline ms | Current ms |
| --- | ---: | ---: |
| Caller contexts, 1024 sites | 17.823 | 17.795 |
| Source ancestry, 256 callers | 2.585 | 2.667 |
| Source ancestry, 1024 callers | 20.597 | 20.663 |
| 1024 functions, one demanded call | 2.719 | 2.778 |
| 1024 methods, one demanded call | 2.693 | 2.663 |
| 256 sites, never-written formals | 7.204 | 7.355 |
| 256 sites, written formals | 9.128 | 9.201 |
| Recursive inputs, 64 links | 12.468 | 12.921 |
| Real workspace cold symbol query | 255.449 | 253.989 |

The real diagnostic corpus is 191 files / 1,217,268 bytes. Both versions return
the same declaration with the same 1690 summaries, 319 frames, 955 call
evaluations, 2719 value evaluations, 1339 member reads, 2097 location evaluations
and 2602 prototype evaluations. The new caller-context query performs **zero**
evaluations for that ordinary symbol query. This is not a cold-query speedup
claim: ranges overlap (245.464–267.316 / 252.797–261.147 ms). Full-process wall
medians are both 0.725 s; peak RSS is 312.6/314.1 MiB, not a GC-allocation measure.
Some smaller queries cost more; the latency gate remains open.

The new independent closure-source profiler requests only the first closure,
with 1/128/1024 unrelated creators present. Cold medians are
0.151/0.784/10.825 ms. All retain **4 frames, 6 call evaluations and 3 caller-
context evaluations**; only eager summary/static-call construction grows
(3/257/2049 summaries). Retained-query batch averages are approximately
0.009/0.009/0.016 microseconds per read, not end-to-end UI latency. The old
incomplete answer is not presented as a faster baseline for this workload.

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_closure_sources.ts
```

Artifacts, red probes and rejected experiments are in
`/tmp/bmsx-closure-discovery/`; exact final paired measurements are in `final/`.
Validation: **1605 Lua tests / 1604 pass / one existing skip**; toolchain and IDE
typechecks, strict architecture boundaries, core parity, indentation and browser
build pass. The tests-project typecheck retains exactly the baseline's 51
diagnostics, comparing file, diagnostic code, message and multiplicity with
line/column positions removed.

Actual full Studio workflows and Pietious Source/navigation workflows pass on
**software, WebGL2 and WebGPU** (six backend gates). These include source,
context menu, drag/Undo, Hot Resume, scenario cancellation and autosave routes.
All six final captures are byte-identical to the preceding dependency slice.
The runner uses isolated copied workspaces and a fresh port, not the user's
running Studio server. The reload-only matrix from the preceding slice was
not rerun for this call-query change. No new Lens authoring feature or closure-
specific browser proof is claimed from the existing regression routes.
