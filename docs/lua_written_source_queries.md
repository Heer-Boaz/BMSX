# Written-source queries

Implementation boundary, starting at `88257f807`.

## Reference and contract

Roslyn's [ValueTracker](https://github.com/dotnet/roslyn/blob/0c14b7cb5e382318c4322e29e045f48b11c641ca/src/Features/Core/Portable/ValueTracking/ValueTracker.cs#L73-L133)
follows written definitions, assignments, parameters and returns through bound
operations. Its [operation collector](https://github.com/dotnet/roslyn/blob/0c14b7cb5e382318c4322e29e045f48b11c641ca/src/Features/Core/Portable/ValueTracking/ValueTracker.OperationCollector.cs#L25-L44)
does not turn navigation targets into an execution proof. The tracked item keeps
its own document and source span. BMSX likewise needs a source query over retained
language facts, distinct from canonical value/location identity.

The first query exposes **written contributions**, not an exclusive runtime value
or an execution trace. It preserves the use expression, every actual write and
its function-body owner. Equal literals remain separate source occurrences.
Unknown computations and implicit result lanes remain explicit contributions;
neither a missing definition nor a cycle becomes a known empty result.

Queries must not re-bind an identifier from its spelling, re-run a Lens-local
evaluator or recover syntax from an interned literal. `readLuaExpressionSource`
consumes the existing reference binding/receiver, owned-expression identity and
typed literal syntax. Calls and indexers without a complete reference record
retain their producer's source in `readValuesBySyntax`. The literal conversion
is shared with the binder, not independently implemented in the query.

The existing declaration-write index is published rather than rebuilt for each
query. There is no new index entry for each identifier, member, literal or owned
constructor. In particular, an unknown iteration value still has a written loop
binding: the source query follows that binding without changing the may-value
solver's unknown iteration value.

Cache source queries on the immutable workspace that owns the binder facts.
Do not flatten a chain's transitive sources at every node: that would copy a
quadratic number of origins. Retain a source graph and traverse its reachable
nodes once when collecting origins. Calls and access paths keep their actual
language representation until their respective query owners supply evidence.

This query alone does not complete B04: correlated call applications, unknown
member/callee contributions, multi-resource consumers and latency remain gates.
In particular, a written initializer is not proof that an imported API field is
immutable, that an assignment has executed or that an object is used only once.
The Lens must not infer those guarantees from a one-element source result.

## Implemented boundary

- `WorkspaceSymbolResolver.writtenSources` is lazy and belongs to one immutable
  workspace. Written-source tracking does not activate the may-call solver or
  introduce a Lens-specific cache. New snapshots also replace negative answers;
  unchanged file facts remain shared, not re-bound by the query.
- Expression uses, declaration writes, formal/receiver entry inputs and expression
  transfers are distinct nodes. Each retains its actual file and binder entry.
  Reassigning a parameter or `self` does not erase its incoming input.
- Global storage contributions include all declaring files. This does not merge
  same-named locals or property paths, select lifecycle writers by name, or execute
  a function body. A captured write retains its body owner even when uncalled.
- Known and unknown logical operands remain separate inputs. Builtin transfer
  facts come from the binder, not another builtin-name matcher in the query.
- Cyclic dependencies remain edges in the source graph; an iterative trace visits
  each reachable node once. `terminals` is not a completeness or runtime-exclusivity
  certificate. Modules, access paths and ordinary call results remain explicit
  boundaries pending their respective origin/publication queries.
- Incomplete `options.` syntax no longer aliases the value of `options` in the
  binder. Completion still receives the real receiver through `memberAccesses`.
  The recovery expression produces unknown, not a fabricated member value.

No registration recognition or authoring gate is widened in this slice. It does
not supply context-correlated origins for factory calls, module publication,
member writes or generated trees. B03 reparent and B06 property editing are still
the UX goals, not replaced by this source query.

## Cost and validation

The initial all-expression index added about 16 ms to workspace binding. A sparse
read index still duplicated identifier/member facts and added about 14 ms. Both
were removed before landing. The final index retains only call/indexer reads;
the existing reference and owned-value indices keep their own representations.

Node 22.23.1, Core Ultra 7 265KF; four alternating, isolated baseline/current
process pairs against `88257f807`. All three changed existing semantic owners
are substituted in the baseline bundles. Same 191 files / 1,217,268 source bytes
and the real `self.actioneffects` target; no concurrent builds/browser tests:

| Measurement | Baseline | Current |
| --- | ---: | ---: |
| Cold workspace symbol query | 264.022 ms | 264.072 ms |
| Initial workspace binding | 263.602 ms | 265.258 ms |
| Edited-file binding | 5.166 ms | 4.879 ms |
| Whole profiler peak RSS | 307.7 MiB | 316.2 MiB |

Cold query ranges: 253.008–269.546 / 258.864–269.814 ms. Initial binding ranges:
261.223–272.125 / 251.505–276.701 ms. These are measurements, not an overall
latency improvement or a closed B04 latency gate. All may-solver work counts
remain equal: 1,690 summaries, 319 frames, 969 call evaluations, 2,898 value
evaluations, 1,456 member evaluations and ten solve passes.

RSS is not retained-heap accounting. A separate four-pair `--expose-gc` experiment
retains one workspace over the same sources, without activating either query
engine. Post-GC heap growth from the pre-bind sample is 93.94 / 97.60 MiB
(ranges 93.932–93.944 / 97.589–97.610): about **3.66 MiB** for the published write
index and retained reads. It is not zero-cost and does not change guest RAM.

`profile_written_sources.ts` measures retained binder facts, fresh query owner
plus trace, then batches of 10,000 cached expression/trace reads. One process,
ten warmups and median of 25 samples, not the paired whole-workspace experiment:

| Aliases | Cold source query | Cached lookup |
| --- | ---: | ---: |
| 1 | 0.003 ms | 0.008 µs |
| 64 | 0.023 ms | 0.008 µs |
| 1,024 | 0.222 ms | 0.008 µs |
| 4,096 | 1.058 ms | 0.008 µs |

Those chains need zero new read-index entries: their existing references supply
the bindings. Query memory grows with the demanded source graph, not one copied
transitive origin set per intermediate alias. Repeated reads return the retained
graph; these warmed lookups are not complete pointer/IDE latency measurements.

Fifteen independent source tests cover literals, ordinary aliases, unknown and
compound writes, implicit lanes, cyclic aliases, all-file global writes, parameters,
receiver writes, builtin transfers, iteration bindings, parser recovery and
immutable snapshot replacement. CPU oracles run at O0/O3 for compound assignments,
written parameters and `self`. No cartlib, machine, C++ runtime or per-frame path
changes.

Final validation:

- Full Lua suite: **1,487 pass, one existing skip, zero failures**. Toolchain build
  and IDE typecheck pass. The tests project has exactly the same **51 baseline
  diagnostics**; it is not described as typecheck-clean.
- Forced browser-Studio debug build and actual full Studio plus Pietious Source/
  navigation workflows pass on **software, WebGL2 and WebGPU**. These include
  Source/history/Undo and the existing Hot Resume routes, with uncaught-page-error
  gates. Existing source-lookup HTTP 404 messages remain. No new authoring gesture
  or imported-origin UI is claimed by these regression runs.
- Strict architecture audit: zero issues. Core parity, indentation and final diff
  checks pass. Artifacts: `/tmp/bmsx-source-query/`; `eager-index` and
  `sparse-read-index` are intermediate measurements, not the landed code.

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/semantic_written_sources.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_written_sources.ts
```
