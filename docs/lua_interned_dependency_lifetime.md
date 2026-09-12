# Interned access identities and growing query facts

2026-09-12. Baseline `273cd2677`. This is a B04 query-owner correction, not
the broader source-origin proof or BT reparenting feature.

## Reference and live ownership

Salsa distinguishes an interned value's lifetime from mutable query inputs.
Its [interned read tracking](https://github.com/salsa-rs/salsa/blob/e021c01d4939408c89c9325ad2426660117a8b32/src/interned.rs#L254-L287)
omits a dependency edge for a slot that cannot be reused; the same file's
[field lookup](https://github.com/salsa-rs/salsa/blob/e021c01d4939408c89c9325ad2426660117a8b32/src/interned.rs#L969-L1005)
reads immutable interned fields directly. Its reusable-slot and cross-revision
stamp rules are not transplanted into BMSX.

In the live BMSX owner, `SemanticTermStore` never replaces an interned access
identity during a workspace snapshot. The value, storage, write and prototype
relations attached to that identity can still grow. Previously all retained
path lookups subscribed to the base's entire access-path collection, including
successful lookups. Adding `object.other` could therefore re-evaluate a query
whose interned `object.field` identity had not changed.

| Read | Can its answer change in this snapshot? | Dependency |
| --- | --- | --- |
| Existing member/index/unary access identity | No | None |
| Absent named access | Once, when that path is created | Exact name and base |
| Absent indexed access | Once, when that path is created | Exact key term and base |
| Absent unary access | Once, when that path is created | Access kind and base |
| Complete indexed-path collection | Yes, on each new concrete index | Indexed extent of the base |
| Relation emptiness | Once, on its first row | Separate empty-to-nonempty publication |
| Relation row or exact count | Yes | Existing row/extent dependency |

`SemanticDependencyPairIndex` belongs beside the existing single-key fact index,
not in Lens. It retains sparse numeric key pairs without string encoding or
manufacturing a `TermID` for a missing storage path. Path misses are indexed by
operand first: many bases consume the same member name or key. This avoids a
separate nested map for every base encountered during alias traversal.

Successful path reads allocate no dependency. An absent path subscribes until
its producer creates that exact identity; no later producer replaces it. The
existing conservative dependency graph need not retract that historical edge,
because it will not publish another change for that path. An unknown index key
still means the existing element-path representation, not a concrete index.

`TermRelation.empty` expresses the predicate actually consumed by member
traversal. Reading an exact prototype count just to compare it with zero
previously invalidated those readers on every later prototype insertion.
The empty predicate has a demand-created dependency, while prototype joins
continue to read the growing exact extent and forward/reverse rows.

No dependency is removed from value relations or from aggregate queries. There
is no global "immutable query" switch, timeout, candidate cap, source-object
cache, cross-edit reuse or cart-specific exception. Old snapshots keep their
own terms and dependencies; edits still create the appropriate new universe.

## Evidence and remaining gate

Independent fixtures cover all six access kinds, both pair coordinates,
negative-to-positive lookup, unknown indexed keys, collection growth, and
continued value-relation invalidation through an already known access identity.
The relation fixture distinguishes the one-shot empty predicate from its still
changing count and row. Existing recursive/prototype/source-generation tests
remain required: fewer evaluations alone do not prove a correct query answer.
Five of these access-owner probes fail when bundled with the baseline term
owner; all seven new tests and the 18 existing dependency tests pass now.

The independent growth profiler uses the pre-slice public owners, allowing the
same fixture to bundle both versions. It reads existing and missing paths,
introduces eight unrelated fields, then creates the requested missing path.
It does not substitute a no-work query or discard a possible value.

Four alternating baseline/current process pairs, Node 22.23.1 on the same
Intel Core Ultra 7 265KF host. Synthetic rows are medians of four process
medians, with retained binder facts where the existing profiler uses them.

| Boundary | Baseline ms | Current ms |
| --- | ---: | ---: |
| Path growth, 32 bases | 0.181 | 0.127 |
| Path growth, 256 bases | 0.975 | 0.427 |
| 32 repeated positive/negative static callees | 0.167 | 0.159 |
| 256 repeated positive/negative static callees | 0.219 | 0.220 |
| 32 uncalled receivers | 1.149 | 1.257 |
| 256 uncalled receivers | 8.076 | 8.190 |
| 1024 functions, one demanded call | 2.861 | 2.696 |
| 1024 methods, one demanded call | 2.682 | 2.771 |
| 256 callsites, never-written formals | 7.298 | 7.546 |
| 256 callsites, written formals | 9.258 | 9.453 |
| Recursive inputs, 8 links | 0.929 | 0.950 |
| Recursive inputs, 64 links | 12.485 | 12.339 |
| Real workspace cold symbol query | 258.004 | 256.891 |

The path-growth cases perform 640→96 and 5120→768 evaluations respectively.
Both still observe the final requested path. The real diagnostic corpus is
191 files / 1,217,268 bytes, not an independent or stable cart fixture. Both
versions return the same declaration and retain all 1690 summaries / 319 frames.
Call evaluations go from 969 to 955, value evaluations from 2898 to 2719, complete
member reads from 1456 to 1339, location evaluations from 2292 to 2097, and
prototype evaluations from 2904 to 2602. Static callee/effect-body counts remain
2086/109. No possible argument or target was dropped to lower those counts.

This is **not a demonstrated overall cold-query speedup**. The paired cold
ranges overlap: 252.006–266.030 ms versus 241.596–257.823 ms. Several small
workloads are slightly more expensive, including the 32-receiver case by
0.108 ms. Full process wall medians are 0.735/0.715 s and peak-RSS medians
307.7/309.6 MiB; these are not retained-heap or GC-allocation measurements.
Unpinned earlier runs on this host had higher absolute times for both versions;
they are retained, not combined into the paired result. Finer dependencies
remove repeated work but do not remove the substantial cold construction cost.

An initial two-key layout nested by base rather than operand was also measured
and replaced. It created unnecessary nested maps in broad alias traversal;
the final operand-first layout keeps the same fact/dependency contract. This
is a storage decision in the shared index, not a special case for a game.

The cold-construction, relation-traversal and cross-edit gates remain open.
This slice does not finish B04 or authorize B03/B06 source edits. In particular,
one resolved callee or one known source contribution is not a completeness proof.

Reproduction:

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_access_paths.ts
```

Paired harnesses, CPU profile, intermediate experiments and validation output
are retained in `/tmp/bmsx-query-latency/`. Measurements exclude concurrent
builds, tests and browsers; actual Studio workflows are a separate gate.

The final paired measurements above are in `by-operand/`; the earlier
base-first layout is in `final/`. Directory names from intermediate runs are
not a claim that they describe the landed implementation.

### Validation

- Full Lua suite: **1598 tests, 1597 passed, one existing skip**. No failures.
- Toolchain Lua and IDE typechecks pass. The tests project retains exactly
  the previous 51 diagnostics by file/code/message/multiplicity; it is not
  claimed type-clean.
- Strict architecture-boundary audit: zero issues. Core-parity, indentation,
  browser Studio debug build and `git diff --check` pass.
- Full actual Studio workflow, Pietious Source/navigation/Undo workflow and
  fresh-page session recovery pass separately on software, WebGL2 and WebGPU.
  The six workflow/navigation captures are byte-identical to the A07 captures;
  the software views were also inspected. The Studio source fixture deliberately
  includes diagnostics; this does not claim new graph UX or low-end-host speed.
- The first combined browser command was terminated with signal 15 after both
  three-backend workflow matrices had passed and while recovery was starting.
  Its incomplete recovery log is retained as `reload-terminated.log`. Recovery
  was rerun separately and all three backends passed; the terminated run is
  not counted as a passed recovery gate.

No compiler/guest/runtime representation or TS/C++ mirror changed.
