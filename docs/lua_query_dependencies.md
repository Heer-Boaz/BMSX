# Lua query dependencies and indexed joins

2026-09-11. Baseline `e0594da89`. This changes the shared semantic query
owner, not Behavior Lens, the binder's language rules or the guest runtime.
The stronger correlated source query in [B04](behavior_source_authoring_design.md)
remains open.

## Problem and production references

A global revision invalidated unrelated answers and repeatedly scanned every
retained call. Individual caches also disagreed about cycles, empty results and
changes discovered during evaluation. The baseline real-workspace query made
267,931 location-collector calls, for 19,664 distinct `(term, revision)` pairs;
some unchanged pairs were visited 91 times. These are instrumented work counts,
not elapsed-time measurements.

The architectural references are WALA's:

- [fixed-point system](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/util/src/main/java/com/ibm/wala/fixedpoint/impl/DefaultFixedPointSystem.java#L107-L125):
  statements register their input/output dependencies;
- [changed-variable worklist](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/util/src/main/java/com/ibm/wala/fixedpoint/impl/AbstractFixedPointSolver.java#L235-L247):
  a changed variable schedules its users, rather than every statement;
- [points-to and object/field indices](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/demandpa/alg/DemandRefinementPointsTo.java#L689-L755)
  and [field propagation](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/demandpa/alg/DemandRefinementPointsTo.java#L1837-L1906):
  indexed intermediate relations avoid rematching every read against every
  possible writer. The exact SSA/heap/context abstraction is WALA's, not BMSX's.

## Ownership

| Owner | Contract |
| --- | --- |
| `SemanticTermStore.dependencies` | One dependency graph for the snapshot-local term universe. Fact-row and query identities are separate from Lua term identities. Nothing is written into immutable binder facts. |
| Fact indices | Reads subscribe to the actual row, including absent rows. Successful insertion publishes forward, inverse, name, summary-context or extent changes at the index owner. Deduplication during writes does not accidentally subscribe the producer to its own duplicate check. |
| `SemanticQueryEvaluation` | One keyed evaluation lifecycle, shared by call processing, value demand, public answers and derived queries. Cache hits still establish dependencies. Evaluation records its starting revision, so writes during evaluation cannot be mistaken for consumed inputs. |
| `SemanticQueryResults` | Retained array approximations and per-depth working buffers. Cycles read the last complete approximation, initially empty. A changed result wakes readers, including a late reader of an already-dirty producer. Self and mutual dependencies are retained; unchanged output does not keep a cycle alive. |
| Call worklist | Identity is `(callsite, owner frame)`. Invalidation only schedules; it never evaluates synchronously inside a fact write. Pending work is deduplicated and drained to quiescence. |
| Member/prototype joins | Inverted indices map possible receiver values to existing write-row IDs, prototype target values to owners, and owner locations to prototype sources. They are derived lookup relations, not new assignments, reverse aliases or call facts. |
| Public member/function queries | Retain answers through the same dependency lifecycle and finish required producer work before returning. No independent per-feature revision cache. |

The graph retains read edges for its snapshot lifetime. Dirty propagation is
coalesced, not a claim of minimal dependency sets. Row granularity follows the
owning index: access paths are grouped by base; an extent read depends on the
whole relation. Join maintenance depends on its source rows, while consumers
read matching derived rows. Empty prototype relations skip an empty join but
still subscribe to its extent, so the first later prototype invalidates the
answer. This is ordinary empty-set semantics, not a missing-state fallback.

Value/location relations grow monotonically within this analysis snapshot.
The derived joins therefore accumulate existing fact-row/term identities; they
do not rebuild or serialize the program. Queries, fact indices, dependency
edges, work queues and scratch buffers are retained. A source edit still creates
a new semantic snapshot/term universe. This does **not** yet provide incremental
reuse of solved inter-file facts across edits.

Dependency tracking alone was insufficient: an intermediate version still
performed the full same-name write comparison for each receiver. It retained a
quadratic number of comparison dependencies and regressed the independent
receiver workload. The indexed join addresses that repeated work at its owner,
not with a timeout, context limit, cart exception or UI cache.

## Correctness and scope

`semantic_query_dependencies.test.ts` uses independent source fixtures and
direct fact-index tests. It covers negative results, unrelated writes, cached
child dependencies, coalesced invalidation, writes during evaluation, late
cyclic readers, self/mutual fixed points, forward/inverse/name/extent indices,
new retained access paths, new actual frames, worklist identity and an initially
empty prototype join. Public queries retain solved work after unrelated queries.
The existing recursive/parameter/source tests and compiled BLua O0/O3 oracles
remain required; cache tests alone are not a language correctness proof.

`SemanticDemandIndex` remains selection-only. Only the existing proven-callee
path instantiates calls and publishes execution effects. Recursive actuals are
not dropped to improve timing. Source projections remain may-analysis, not
exclusive/correlated execution evidence. No new graph-edit admission, cartlib
branch, machine field, compatibility path or mirrored runtime change is added.

## Measurements and gates

Four alternating baseline/current process pairs, Node 22.23.1 on the same
Intel Core Ultra 7 265KF, without concurrent builds, tests or browsers. Baseline
bundles substitute `e0594da89`'s changed semantic owners into the same harness.
Synthetic rows are medians of four process medians, using the existing retained-
fixture profilers. They exclude parsing, rendering and guest execution, but
include a fresh workspace and all requested queries.

| Query | Baseline ms | Current ms | Frames, both |
| --- | ---: | ---: | ---: |
| 32 uncalled receivers | 0.622 | 1.097 | 0 |
| 256 uncalled receivers | 5.503 | 7.729 | 0 |
| 1024 functions, one demanded call | 2.828 | 2.854 | 1 |
| 1024 methods, one demanded call | 2.611 | 2.819 | 1 |
| 256 callsites, three never-written formals | 4.337 | 7.452 | 768 |
| 256 callsites, three written formals | 4.614 | 8.320 | 768 |
| Recursive input chain, 8 links | 0.518 | 1.000 | 2 |
| Recursive input chain, 64 links | 9.247 | 14.271 | 2 |
| Real workspace `self.actioneffects` symbol query | 646.095 | 316.036 | 303 |

The real corpus has 191 files, 1,217,268 bytes and 1,690 summaries. Both versions
resolve the same declaration, without reducing the retained frames. Cold
symbol-query ranges are 632.734–651.330 ms and 312.288–316.220 ms; full profiler
wall-time medians are 1.105 s and 0.785 s. Maximum-RSS medians are 289.8 and
292.2 MiB. These are host-process peaks, not retained-query allocation counts.
The symbol measurement includes lazy query-store construction. A trivial warm
call-hierarchy read is not a measurement of cold member resolution.

The current query performs 1,015 call evaluations, 3,140 value evaluations,
2,688 location evaluations, 3,118 prototype-query evaluations and 253 join-index
evaluations. Worklist waves are eleven, versus five old global passes; those
counts describe different scheduling algorithms and are **not** comparable
units of work. The 256-receiver fixture performs two name-index evaluations
instead of maintaining a separate writer-comparison dependency set per query.

**The latency/performance gate is still open.** The real cold query is roughly
halved, but 316 ms on this CPU is still too slow. Small independent workloads
regress due to the added dependency/evaluation state, despite removing the
intermediate quadratic comparison cost. This is a shared invalidation/indexing
foundation, not a completed performance win for every query. Reducing cold
store construction, dependency-recording cost and repeated join refinement must
precede treating this as latency-ready for broader authoring. Cross-edit reuse
needs explicit input/snapshot ownership, not another feature-local cache or
moving the same synchronous delay behind a timeout.

A separate instrumented sample attributes 124.472 ms of its 312.800 ms cold
query to query-store construction (identities, summaries, demand index,
instantiation and initial call facts). That is a measurement of one sample,
not a subtraction from the paired median or proof that construction is the
only remaining bottleneck.

Reproduction entrypoints:

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_receiver_projection.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_function_sources.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_parameter_context.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_recursive_inputs.ts
npx tsx --tsconfig tsconfig.base.json scripts/dev/profile_lua_semantics.ts \
  --incoming carts/nemesis_s/player/player.lua:1179:9 \
  carts/nemesis_s/player/player.lua carts/nemesis_s cartlib
```

The game corpus is a diagnostic workload at this revision, not a stable test
fixture. Exact paired timings above use esbuild bundles rather than tsx startup.
Artifacts: `/tmp/bmsx-query-dependencies/final/`, with bundle/measurement scripts
and isolated CPU/phase profiles in the parent directory.

Validation:

- `npm run test:lua`: 1,377 passed, one pre-existing skip, zero failures.
- Toolchain Lua and IDE `tsc --noEmit`: passed. Tests-project diagnostics remain
  exactly the same 51 as the baseline by file/code/message/multiplicity; the
  tests project is **not** claimed type-clean.
- Strict architecture-boundary audit: zero issues. Core-parity and touched-file
  indentation audits: passed. No runtime parity surface changed.
- Browser Studio, headless tooling, BIOS, Nemesis S and Pietious debug builds:
  passed. All three rebuilt ROMs are byte-identical to their pre-slice bytes.
- Actual browser `--studio` and `--studio-navigation pietious` gates: passed
  separately on software, WebGL2 and WebGPU. All six final captures were
  inspected and are byte-identical to the predecessor slice's corresponding
  captures. These prove existing workflow regressions, not new graph UX or B04
  completeness. The Studio fixture deliberately includes source diagnostics.
- `git diff --check`: passed.
