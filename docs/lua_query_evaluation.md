# Lua query consumption and demand-index maintenance

2026-09-11. Baseline `22aadb129`. This follows the shared dependency/index
foundation in [Lua query dependencies](lua_query_dependencies.md). It changes
the language query owner, not Studio feature caches, immutable binder facts,
cartlib or the machine. The stronger correlated source query in
[B04](behavior_source_authoring_design.md) remains open.

## Production references and ownership

- Salsa's [query fetch](https://github.com/salsa-rs/salsa/blob/e021c01d4939408c89c9325ad2426660117a8b32/src/function/fetch.rs#L28-L45)
  refreshes the memo before reporting the tracked read. This is the relevant
  consumption boundary: an absent/stale answer is not the result its caller
  consumes. BMSX retains its own monotone cycle approximations; this is not an
  implementation of Salsa's entire revision or cycle algorithm.
- WALA's [fixed-point worklist](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/util/src/main/java/com/ibm/wala/fixedpoint/impl/AbstractFixedPointSolver.java#L235-L247)
  schedules users of changed inputs. Its [definition/use index](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ssa/DefUse.java#L42-L76)
  illustrates indexing the immutable relation once instead of repeatedly
  scanning every body. BMSX applies those principles to prototype join rows
  and static candidate relevance, not WALA's SSA or heap representation.
- TypeScript's [checker links](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/checker.ts#L2916-L2926)
  and [structured members](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/checker.ts#L14952-L14980)
  keep derived answers with their semantic owner. Its [document registry](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/documentRegistry.ts#L315-L340)
  shares source records by version. Source-record sharing is not permission
  to reuse a solved checker answer in a different program.

### Consumed query results, not cache misses

`SemanticQueryEvaluation` distinguishes three cases:

1. A current result records the caller's dependency immediately.
2. An in-progress query records the dependency before returning its retained
   approximation. Self and mutual cycles remain real dependencies.
3. A stale query is evaluated and publishes its complete approximation before
   the caller records consumption. If its inputs changed during evaluation,
   its result remains unsettled and so does the consuming parent.

An evaluation still records its starting input revision. Publishing a changed
answer wakes consumers, not the producing query itself unless a real cycle
leads back. A previous query edge must not invalidate an evaluating parent
before that parent has consumed the refreshed child in this evaluation.

The shared dependency owner therefore keeps an evaluation capture on query
reads. Fact-row dependencies retain ordinary deduplicated edges; they do not
need a timestamp for every read. Each edge is stored once: fact edges in a set,
query edges with their last consumption capture. Repeated reads have a fast
last-reader path. Invalidation schedules work and never evaluates synchronously.

The graph still conservatively retains old fact dependencies and query edges
for the snapshot lifetime. This does not claim minimal dependency replacement,
cross-edit invalidation or Salsa-style red/green verification. No timeout,
recursion cap or missing-state rescue path participates in convergence.

### Complete member answers and indexed refinement

`SemanticMemberQuery` owns one complete read for `(base term, member name)`.
It retains value and declaration columns and publishes their changes together.
These columns are not zipped: a possible value need not have a declaration.
An empty answer is a result with dependencies, not an uninitialized cache.
Interning a query key does not create a member storage path.

`LuaSemanticQueryStore.allMembers` is itself a tracked aggregate over member
queries. A later field demand can discover inputs that change an earlier field
answer; the aggregate must finish that work before retaining its own answer.
An untracked concatenation followed by an array copy cannot establish this
contract.

Prototype owner/source indices now use `SemanticQueryWorklist`, shared with
call processing. Each newly retained source row is indexed once. Later input
changes queue the affected row, not another scan/refinement of the entire
prototype relation. Source joins subscribe to an owner's targets even when its
current location answer is empty. Derived joins only accumulate existing
term/fact identities; they remain distinct from assignments and execution facts.

### Static demand selection

`SemanticDemandIndex` retains positive and negative static callee selections
by callee term. Repeated callsites do not repeat the same alias traversal.
Receiver aliases are traversed independently of member-path existence; only
producer-retained member paths are consumed. The selector never manufactures
`alias.member` storage to cross an unwritten intermediate alias.

`SemanticEffectIndex` indexes writers and reverse candidate edges once from
completed summaries. A demanded effect name walks that index to a fixed point,
including cycles and unnamed bodies. Only requested bodies then compute and
retain their dependency-call slice; demanding one body does not slice every
body in the workspace. Named candidates remain selection-only. Only the
existing proven-callee/instantiation route publishes execution effects.

The identity owner also consumes an already-interned raw root when obtaining
its canonical root. Repeating the string-key lookup and constructing unused
encoded source keys served no consumer and has been removed. No source-object
identity cache or second encoding layer replaces it.

## Source edits and the remaining boundary

The project already shares unchanged immutable `FileSemanticData` between
snapshots. The added edit/remove/reintroduce fixture proves that an unchanged
consumer uses the new provider while older snapshots retain their exact old
declarations and source ranges.

Solved term IDs, union roots, contexts and monotone relations still belong to
one snapshot. Reusing them after an edit requires versioned semantic inputs and
retraction of outputs whose producers disappeared. Salsa's [memo revisions](https://github.com/salsa-rs/salsa/blob/e021c01d4939408c89c9325ad2426660117a8b32/src/function/memo.rs#L166-L233)
and stale-output handling illustrate why an extra map keyed by source object
or workspace revision is not that architecture. This slice does **not** add
cross-edit reuse of solved inter-file facts or strengthen the broad may-query
into an exclusive/correlated source proof.

## Measurements

Four alternating baseline/current process pairs, Node 22.23.1 on the same
Intel Core Ultra 7 265KF, without concurrent builds, tests or browsers. Baseline
bundles substitute `22aadb129`'s semantic owners into the same harness.
Synthetic rows are medians of four process medians. They use retained binder
facts and a fresh query owner per sample, excluding parsing and guest execution.

| Query | Baseline ms | Current ms | Frames, both |
| --- | ---: | ---: | ---: |
| 32 repeated positive/negative callees, 32 aliases | 0.172 | 0.148 | No instantiation |
| 256 repeated positive/negative callees, 32 aliases | 0.759 | 0.231 | No instantiation |
| 32 uncalled receivers | 1.260 | 1.133 | 0 |
| 256 uncalled receivers | 8.577 | 8.390 | 0 |
| 1024 functions, one demanded call | 2.968 | 2.842 | 1 |
| 1024 methods, one demanded call | 2.927 | 2.942 | 1 |
| 256 callsites, three never-written formals | 8.140 | 7.939 | 768 |
| 256 callsites, three written formals | 8.969 | 9.124 | 768 |
| Recursive input chain, 8 links | 1.021 | 0.960 | 2 |
| Recursive input chain, 64 links | 14.613 | 13.103 | 2 |
| Real workspace `self.actioneffects` symbol query | 333.760 | 255.383 | 303 |

The real corpus has 191 files, 1,217,268 bytes and 1,690 summaries. Both versions
resolve the same declaration. Cold symbol-query ranges are 326.107–341.273 ms
and 254.220–261.127 ms; full profiler wall-time medians are 0.815 s and 0.740 s.
Maximum-RSS medians are 301.9 and 301.3 MiB. These are process peaks, not retained
allocation counts. The cold symbol measurement includes query-store construction.
The old slice's separately measured 316 ms is not the baseline of this paired run.

The real query now performs 843 call evaluations, 2,581 value evaluations,
1,286 complete member evaluations, 2,017 location evaluations, 2,685 prototype
queries and 174 outer/name-index evaluations. Its new row-level counter records
2,007 prototype refinements. Static callee selection evaluates 2,086 distinct
callee terms; only 108 requested effect bodies are sliced. Old counters did not
measure every inner join/member traversal, so their totals are not comparable
to the sum of the new counters.

An independent 32-owner fixture establishes the incremental join boundary:
changing one owner's input performs exactly one additional row refinement;
adding a source to that owner and adding a new owner each perform one more.
Repeated callee fixtures retain both successful and empty results. No target or
recursive argument was removed to reduce measured work.

**The latency gate remains open.** A roughly 23% lower cold query is useful,
but 255 ms on this CPU is still too slow. The small-workload result is mixed:
most are lower, but the 256 written-formal median is 1.7% higher and the method
median is essentially unchanged. This does not erase the larger regressions
introduced by the previous dependency foundation relative to its predecessor.

Source/root object caches and per-read capture metadata on every fact edge
were measured and rejected. They added allocation/lookup cost rather than
removing enough work. The landed ownership correction timestamps query
consumption only; it does not hide these costs in a feature cache. Remaining
cold construction, relation traversal and cross-edit ownership need their own
measured work before broader graph-edit admission is considered latency-ready.

Reproduction uses the existing profiler entrypoints in
[the dependency slice](lua_query_dependencies.md#measurements-and-gates), plus:

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_query_selection.ts
```

The new fixture is independent of carts. The real game corpus remains a
diagnostic workload at this revision, not a stable unit fixture. Exact paired
timings use esbuild bundles rather than tsx startup. Artifacts and scripts:
`/tmp/bmsx-query-performance/final/` and its parent directory.

## Validation

- `npm run test:lua`: 1,386 passed, one pre-existing skip, zero failures.
  New fixtures cover consumption ordering, unsettled children, negative reads,
  row-level joins, static candidate cycles, demanded body slicing and source
  replacement/removal. Existing recursive and compiled O0/O3 oracles remain.
- Toolchain Lua and IDE `tsc --noEmit`: passed. Tests-project diagnostics remain
  exactly the baseline's 51 by file/code/message/multiplicity; that project is
  not claimed type-clean.
- Strict architecture-boundary audit: zero issues. Core-parity and touched-file
  indentation audits: passed. No mirrored runtime representation changed.
- Browser Studio, headless tooling, BIOS, Nemesis S and Pietious debug builds:
  passed. All three rebuilt ROMs are byte-identical to their pre-slice bytes.
- Actual browser `--studio` and `--studio-navigation pietious` gates: passed
  separately on software, WebGL2 and WebGPU. All six final captures were viewed
  and are byte-identical to the predecessor slice's captures. The Studio fixture
  deliberately contains source diagnostics. This proves existing workflow
  regressions, not new graph UX, B04 completeness or low-end-host latency.
- `git diff --check`: passed.
