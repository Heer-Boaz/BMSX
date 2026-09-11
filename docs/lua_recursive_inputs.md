# Lua recursive inputs and retained read propagation

2026-09-11, baseline `0d767e8a1`. A generic prerequisite for
[B04](behavior_source_authoring_design.md), not completion of its stronger
source-origin or correlated-root-context contract.

## Reproduced failure

```lua
local leaf = { marker = 11 }
local root = { next = leaf }
local function walk(value)
    if value.next then return walk(value.next) end
    return value
end
local result = walk(root)
return result.marker
```

The old instantiator reused the ancestor frame but discarded the recursive
argument. Its parameter remained a substitution of the first actual. Public
member resolution found only `next` on `result`; compiled BLua returned `11`
at O0 and O3. Wider UI searches cannot repair that missing value-flow edge.

Adding that edge alone was insufficient: longer chains exposed read answers
cut by recursion and cached without propagation. Indexed reads manufactured
progressively longer terms. Deferred producers behind fields/elements and
indexed writes through writable formals needed their dependencies retained.

## Production references

- WALA's [calling constraints](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/SSAPropagationCallGraphBuilder.java#L1604-L1686)
  connect actuals to stable formal points and caller results to target returns.
  The implementation discusses recovering implicit parameters under recursion.
- [`LocalPointerKey`](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/LocalPointerKey.java#L14-L85)
  keys locals by call-graph node/value number;
  [`ExplicitCallGraph`](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/impl/ExplicitCallGraph.java#L120-L155)
  canonicalizes method/context nodes. Node reuse does not discard new inputs.
- [`DemandRefinementPointsTo`](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/demandpa/alg/DemandRefinementPointsTo.java#L1417-L1490)
  separates points-to propagation, field accesses and tracked flow relations.
  Its [read matching](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/demandpa/alg/DemandRefinementPointsTo.java#L2301-L2360)
  finds stores through the read base's possible objects. Arbitrarily alternating
  forward values and reverse aliases does not establish object identity.
- [`AbstractFixedPointSolver.changedVariable`](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/util/src/main/java/com/ibm/wala/fixedpoint/impl/AbstractFixedPointSolver.java#L235-L247)
  schedules statements using the changed variable. BMSX's global-revision
  reconsideration is not equivalent to that dependency-indexed worklist.

These distinctions fit BMSX's existing query representation; this is not a copy
of WALA's complete SSA, heap abstraction or context selector. WALA's refinement
budgets do not justify avoiding our ownership defects. No query/time/depth cap
is added here.

## Owning contracts

| Owner | Contract |
| --- | --- |
| Summaries | `Parameter` is an entry value. Written formals have separate initialized `Local` bindings; never-written formals need no extra writable binding. |
| Instantiation | `ContextRoot(Parameter, frame)` retains initial and recursive actual contributions. Frame reuse must not discard incoming values. Captures retain their lexical frame. |
| `values` | Assignment/argument/return relations, also used for storage aliases and prototype propagation. |
| `readValues` | Monotone member/index/element answers. They participate in forward propagation and revision, **not** reverse storage aliases or assignment publication. A read answer is not a write or location equality. The forward-only relation has no inverse index; storage/prototype relations retain their bidirectional representation in `term_relation.ts`. |
| Member queries | Retain forward read inputs separately from location/prototype candidate comparisons. Value requests demand exact producer calls. Read answers feed the fixed-point solve, not a one-level recursive cache. |
| Location traversal | Resolve the requested read's bases, then walk back through storage aliases. Never follow other values of a reverse-discovered alias. Root-alias closure is cached against assignment-relation growth. |
| Term store | Non-mutating member/index/element/instance lookups consume existing locations. Unknown indices keep the aggregate-element representation. Reading absent storage does not manufacture access paths. |
| Demand index | Object effects through writable formals follow binding dependencies. A parameter used only as a key does not make a private table escape. Selection is not an executed-call fact. |
| Query store | Member and function queries finish required producer/read propagation before caching. Broad source projection remains broader than call-rooted execution. |

Queues, per-depth scratch and indexed relations are retained. This is host
TypeScript tooling: no guest/cartlib code, separate evaluator, Lens-specific
inference, runtime ABI or C++ emulation change.

## Experiments and evidence

Broad alias analysis is not inherently infeasible. Rejected variants exposed
BMSX defects, not a reason to omit required answers:

- Semantic expansion inside candidate walks became very slow: a probe was
  stopped after 47 seconds; another forward/reverse variant took about 31.
- Publishing read answers as assignment aliases mixed unrelated objects and
  broke metatables. Separating those relations preserves the answers correctly.
- Creating empty locations during reads generated work without supplying
  stores. Read-only lookup removed that churn. Intermediate probe timings are
  not measurements of the final implementation.
- One-hop recursion tests were insufficient. Direct/mutual 32-link chains,
  nested indexed arrays and computed actuals now exercise propagation further.

`tests/lua/semantic_recursive_parameters.test.ts` covers entry-point identity,
omitted inputs, root-call separation, long chains, indexed reads, deferred
value/function producers, callbacks, computed actuals, reverse-alias direction,
closure captures and missing-member lookup. Compiled BLua O0/O3 runs provide
separate runtime oracles. Semantic answers remain may-value unions, not the
single runtime result. Existing parameter/projection tests now assert the entry
point and incoming actual instead of requiring obsolete direct substitution.
No mutable game sources or cartlib API spellings define these fixtures.

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/semantic_recursive_parameters.test.ts \
  tests/lua/semantic_parameter_context.test.ts \
  tests/lua/semantic_projection_ownership.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_recursive_inputs.ts
```

### Paired measurements

Four alternating baseline/current process pairs, same source tree and Node/
esbuild configuration, without concurrent tests or builds. The baseline bundles
use `0d767e8a1`'s six changed semantic owners. Synthetic rows report the median
of the four process medians; each process uses the retained-fixture profiler's
warmup/sample loop. They exclude parsing, rendering and guest execution.

| Query | Baseline ms | Current ms | Retained frames |
| --- | ---: | ---: | ---: |
| 32 uncalled receivers | 0.724 | 0.654 | 0 / 0 |
| 256 uncalled receivers | 4.823 | 5.625 | 0 / 0 |
| 1024 function declarations, one demanded call | 2.809 | 2.655 | 1 / 1 |
| 1024 method declarations, one demanded call | 2.736 | 2.758 | 1 / 1 |
| 256 callsites through three never-written formals | 3.873 | 4.398 | 768 / 768 |
| 256 callsites through three written formals | 3.980 | 4.665 | 768 / 768 |
| Real workspace `self.actioneffects` symbol query | 246.175 | 640.751 | 102 / 303 |

The real-workspace corpus has 191 files, 1,217,268 bytes and 1,690 summaries.
The symbol query's process ranges are 243.815–247.795 ms and 632.080–646.696 ms;
solve passes increase from four to five. Full profiler wall time is 0.695 s
versus 1.080 s (ranges 0.69–0.71 and 1.07–1.09), maximum-RSS medians 284.6
versus 291.3 MiB. Both resolve the same source declaration. The additional
context/dependency propagation is **not a performance win over the incomplete
baseline**. The global revision solver still causes broad repeated work;
removing answers or merging distinct frame inputs is not an acceptable remedy.
This slice closes the reproduced propagation defects, not the latency problem.
The frame counts do not prove that every activated context is necessary.
A separate isolated V8 CPU profile points primarily at location/prototype
matching (`collectLocationAlternatives` and `collectSemanticPrototypeSources`),
not argument publication. That is evidence for the next dependency/retained-
query owner change, not grounds for an arbitrary context limit. The CPU profile
also contains substantial GC time; it does not attribute allocation counts to
individual owners.

The independent recursive fixture, on the current implementation, measures
0.525 ms at 8 links and 9.404 ms at 64 links; both retain exactly two root
frames and find the correct leaf declarations. These are single-process
medians (ten warmups, 25 samples), not a paired speedup claim: the old
implementation does not produce the required answer. Bounded frame growth
does not imply linear query time.

Replaying this same checked-in fixture through the baseline bundle fails its
first assertion: zero leaf targets instead of two. The current bundle passes
both chain lengths. That comparison uses the public resolver entrypoint, not
new internal APIs unavailable on the old implementation.

Artifacts for this run: `/tmp/bmsx-recursive-inputs/final/` (paired JSON/timing
files), `recursive-current.jsonl` and `current-isolated.cpuprofile` in that
directory's parent.

### Integration gates

- `npm run test:lua`: 1,364 passed, one pre-existing skip, zero failures.
- Toolchain Lua and IDE `tsc --noEmit`: passed. The tests project retains the
  same 51 diagnostics as `0d767e8a1` by file/code/message/multiplicity; it is
  **not** a clean tests-project typecheck.
- Strict architecture-boundary audit: zero issues. Core-parity generation/
  classification audit and touched-file indentation check: passed.
- Browser Studio, headless tooling, BIOS, Nemesis S and Pietious debug builds:
  passed. All three rebuilt ROMs are byte-identical to the pre-slice ROMs.
- Actual browser `--studio` workflows and `--studio-navigation pietious`:
  passed separately on software, WebGL2 and WebGPU. All six final captures were
  inspected. These are existing navigation/source/history/Hot Resume regression
  gates, not new graph UX or full B04 source-analysis evidence.
- `git diff --check`: passed.

## Remaining boundaries

- Context selection/cycle policy is not redesigned. Source projections and
  instantiated calls still share the broad may-analysis; different recursive
  closure environments need an explicit context policy. `CallFact` is not yet
  B04's correlated source-application result.
- Global revision-based reconsideration remains. Dependency-local worklists
  are a further architectural performance improvement, not replaceable by a
  traversal limit. Repeated location matching also needs retained query
  dependencies, not merely a call-queue replacement: alias/prototype candidate
  reads and their invalidation belong to that owner. A measured corpus does
  not establish worst-case complexity.
- Source occurrences, all return lanes, unmodelled writes, statement order and
  complete literal-key normalization are not completed. For example, a
  parameter-held string key and a named-member term still need a unified key
  contract. This is not an exclusive-callee or source-completeness proof.
- B03's broader graph transfers and the stronger B04 query remain open. No new
  graph-editing admission or UI capability is claimed.
