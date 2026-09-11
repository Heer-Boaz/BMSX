# Lua call applications: a call edge is not its interned target frame

Baseline `b2c79f19c`. This is part of B04, not completion of BT reparenting or
ActionEffect property authoring. Those UX endpoints remain open.

## Reference and owner contract (before implementation)

WALA's [ExplicitCallGraph](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/impl/ExplicitCallGraph.java#L97-L118)
interns a method/context node separately from its
[caller-node/callsite target edges](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/impl/ExplicitCallGraph.java#L197-L228).
The relevant code was read, including its context interface. The applicable
principle is preserving edges independently of shared nodes; its Java analysis,
node caps and runtime argument validation are not BMSX implementation recipes.

The retained query uses the existing `SemanticQueryResults`, not a new Lens
cache. Salsa's [fetch path](https://github.com/salsa-rs/salsa/blob/e021c01d4939408c89c9325ad2426660117a8b32/src/function/fetch.rs#L28-L45)
was reread: refreshing and consuming a memo must still record a tracked read.
The worklist's site/owner lookup is a map, not a scan through every earlier
owner at that site. Result consumption is a retained lookup independent of the
number of callers; it does not enqueue every caller again on each warm read.

The live BMSX call worklist already keys evaluations by `(site, ownerFrame)`.
Instantiation owns actual-to-formal substitution and shares recursive frames.
But the contextual argument tuple is overwritten in one scratch array, and
the retained public navigation fact only has `(site, function declaration)`.
Neither a navigation fact nor the first inputs used to intern a frame accounts
for all incoming call applications.

The correction stays in the existing query-store:

- `SemanticInstantiationQuery.bindCall` produces the immutable contextual
  callee/argument/result terms together. Module calls consume their existing
  summary directly. Projected and instantiated inputs are bound once per work
  item, not on every dependency reevaluation.
- Static call selection and contextual inputs remain different representations.
  The summary producer retains the call's body owner. Demand indices select that
  same summary call, rather than copying it to append an owner. Otherwise a call
  found through an index fails the composition list's identity-based membership
  test. Contextual inputs are not passed to those static selection queries.
- `SemanticCallGraph` retains that work item's owner context and its applications
  to `(callee summary, callable term, target frame)`. A recursive edge is retained
  even when its target frame already exists and receives merged inputs.
- `callee`, incoming and outgoing remain declaration-navigation queries. A new
  internal semantic `callContexts` query retains the contextual tuples rather
  than taking a Cartesian product of independently resolved arguments.
- These are analysis contexts, **not runtime execution witnesses**. A positive
  instantiated frame can descend from a hypothetical body projection. Retained
  application edges preserve that ancestry; a positive number alone does not
  establish module-rooted execution. The projection/actual effect relation is
  not made disjoint by this change.
- The result belongs to this immutable workspace's query-store, not a global
  cache. Known callable applications do not constitute a closed callee set:
  unknown contributions and source-write occurrence queries are separate work.
- Warm `callContexts` consumers read the call work item's existing dependency
  node. New targets publish a changed query result; changes to callee inputs
  invalidate consumers before a later query happens to solve them.

No Lens consumer is allowed to use frame arrays or a single known target as an
authoring proof. This is a retained query representation, not a second source
evaluator, runtime API, guest allocation or cart-specific wrapper expansion.

## Evidence to collect

Independent fixtures: two wrapper applications with paired ids/definitions;
one source call under separate callers; nested closures and method receivers;
recursive inputs reaching an existing frame; anonymous/reassigned callees;
module and hypothetical contexts; retained identity on repeat queries and fresh
identity after workspace replacement. Existing navigation/dependency tests,
real workspace cold/warm cost and actual Studio Source/Undo routes remain gates.

## Measurements

Four alternating isolated baseline/current process pairs on Node `v22.23.1`,
Intel Core Ultra 7 265KF. Both builds use the same harness; the baseline bundles
all five changed existing semantic owners from `b2c79f19c`. These measurements
ran without a browser, build or test process competing for the CPU.

| Boundary, milliseconds (median of four paired process samples) | Baseline | Current |
| --- | ---: | ---: |
| Real Nemesis workspace cold symbol query | 253.985 | 254.477 |
| Initial parse/bind | 260.513 | 265.414 |
| Edited file bind | 4.793 | 3.979 |
| 1,024 function bodies, summaries | 0.583 | 0.602 |
| 1,024 function bodies, query | 2.725 | 2.813 |
| 1,024 method bodies, summaries | 0.602 | 0.612 |
| 1,024 method bodies, query | 2.625 | 2.680 |
| 256 uncalled receivers | 7.562 | 7.970 |
| 256 calls, unmodified parameter | 7.220 | 6.903 |
| 256 calls, written parameter | 8.846 | 9.247 |
| Recursive workload, 64 | 12.467 | 11.944 |

The real cold-query ranges overlap: **248.118–259.293 ms** versus
**250.912–258.112 ms**. Its 191 files, 1,217,268 source bytes, target
`cartlib/actioneffects/actioneffect_component.lua:62:14`, 1,690 summaries,
319 frames, 969 call evaluations and all other reported solver work counts are
unchanged. Peak process RSS medians are 307.5/307.8 MiB, not retained-heap
measurements. Some small queries cost more; this is not a latency improvement
claim or a closed B04 latency gate. Binder code is unchanged in this slice.

The new independent `profile_call_contexts.ts` additionally measures this API:

| Callers of one wrapper | Fresh store + query, ms | Retained read, microseconds |
| --- | ---: | ---: |
| 1 | 0.079 | 0.011 |
| 64 | 0.918 | 0.011 |
| 256 | 2.363 | 0.011 |
| 1,024 | 17.169 | 0.011 |

This is one process with repeated samples, not four process pairs. The 10,000
retained reads per sample return the same result and add no semantic evaluations.
The cold query retains 2,049 analysis frames at 1,024 callers, including the body
projection; this is not a runtime allocation count. No guest, render, lower-end
hardware or full-host latency claim follows from these numbers.

Artifacts: `/tmp/bmsx-call-applications/`. `initial/` predates canonical summary
call selection and retained collection queries; `final/` contains the final
paired measurements. The intermediate test failure for aggregate callback
forwarding was caused by passing copied calls to identity-based selection. The
final producer/index representation and the original regression test cover it;
it was not suppressed or turned into a compatibility branch.

## Validation

- Full Lua suite: **1,470 passed, one existing skip, zero failures**. The 13
  independent call-context tests also pass separately, including a BLua CPU
  oracle at O0/O3 for the two id/definition pairs. The CPU compares guest strings
  in Lua; a host assertion does not confuse guest `StringValue` words with JS
  strings.
- IDE typecheck passed. The tests project still reports exactly the same **51
  baseline diagnostics**, with an empty diagnostic diff.
- Strict architecture boundary audit: zero issues; core parity audit, indentation
  check and `git diff --check` passed. These are tooling changes, not a mirrored
  machine/runtime representation change.
- Debug Studio build and the actual full Studio workflow plus Pietious Source/
  navigation workflow passed on **software, WebGL2 and WebGPU**. Those are
  existing UI regression routes, not a claim that the pending B03/B06 UI was
  implemented by this query slice.

Still open: a source query over written occurrences and unresolved contributions;
separation of hypothetical effects from application-specific source evidence;
resource-owned imported definitions and edit lifetime; BT reparent gestures and
ActionEffect drafts/edits. Call application retention does not close those gates.
