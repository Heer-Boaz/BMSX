# Lua completion: demand scope before cross-edit caching

2026-09-16. Baseline: `bff12a1dc`. This investigation concerns the Lua
language service shared by Studio completion and navigation, not guest execution.

## Production comparison

The following repository heads were fetched and their implementations inspected
on 2026-09-16. The links pin the examined code rather than following `main`.

| Implementation | Observed ownership and computation | Consequence for BMSX |
| --- | --- | --- |
| [VS Code completion provider](https://github.com/microsoft/vscode/blob/0cb5d323cfabb50d8b06f33b8615dac66c2b52b5/extensions/typescript-language-features/src/languageFeatures/completions.ts#L761) | The editor delegates `completionInfo` to its language service. | Changing the editor widget or moving this work to a worker would not correct an oversized semantic query. |
| [TypeScript completion](https://github.com/microsoft/TypeScript/blob/cf8cf4f6c17ada5e920949ad984791ceb9ce06df/tsc/internal/ls/completions.go#L1004), [expression cache](https://github.com/microsoft/TypeScript/blob/cf8cf4f6c17ada5e920949ad984791ceb9ce06df/tsc/internal/checker/checker.go#L7682) | Member completion obtains the receiver's type and enumerates its properties. The checker retains expression results on node links. The current checked implementation is under `tsc/internal`, in Go; earlier BMSX notes linked historical TypeScript sources. | Cache a result under its actual expression/semantic owner. A reverse search relation is not the receiver's value or type. |
| [LuaLS completion](https://github.com/LuaLS/lua-language-server/blob/7a73c7889c1ec981dfd76fba38f5096379f62f99/script/core/completion/completion.lua#L680), [field lookup](https://github.com/LuaLS/lua-language-server/blob/7a73c7889c1ec981dfd76fba38f5096379f62f99/script/vm/field.lua), [node compilation](https://github.com/LuaLS/lua-language-server/blob/7a73c7889c1ec981dfd76fba38f5096379f62f99/script/vm/compiler.lua#L2719) | Completion asks for the parent's fields. Node compilation follows variable/global/source relationships and retains results by source object; it installs a node before recursive compilation. | Demand receiver values and their fields through existing query owners. Preserve the distinction between search candidates and resolved values. |
| [rust-analyzer item tree](https://github.com/rust-lang/rust-analyzer/blob/fa88768e772857f332bc8383e3a1c5a4212f9a6e/crates/hir-def/src/item_tree.rs#L12), [body inference](https://github.com/rust-lang/rust-analyzer/blob/fa88768e772857f332bc8383e3a1c5a4212f9a6e/crates/hir-ty/src/infer.rs#L1075) | Declaration structure provides an invalidation barrier against body edits; inference is a tracked query keyed by body identity. | Separate reusable declarations from body-dependent results. Lua writes performed inside functions can change other objects, so Rust's boundary cannot be copied without tracking those effects. |

These are architectural comparisons, not timing comparisons against running
VS Code or LuaLS on this cart. The BMSX changes below follow from our own
reproductions and traces; the production code supplies the ownership model.

### Cache invalidation is not, by itself, the demonstrated defect

[LuaLS's version watcher](https://github.com/LuaLS/lua-language-server/blob/7a73c7889c1ec981dfd76fba38f5096379f62f99/script/vm/node.lua#L515)
clears its node cache on file version events, with an optional delayed path.
Its [general VM cache](https://github.com/LuaLS/lua-language-server/blob/7a73c7889c1ec981dfd76fba38f5096379f62f99/script/vm/vm.lua#L82)
also observes the global version. TypeScript's current
[program reuse](https://github.com/microsoft/TypeScript/blob/cf8cf4f6c17ada5e920949ad984791ceb9ce06df/tsc/internal/compiler/program.go#L304)
separates reused program inputs from checker initialization.

BMSX already retains unchanged bound files and unchanged query answers. A new
semantic universe after an edit does cost work, but that alone does not establish
that persistent semantic caches are the correct first repair. Reusing a wrong
dependency graph would retain its incorrect answers and unnecessary work.

## What the trace proved

The real query is completion on `motion:` in
`carts/nemesis_s/enemies/noot.lua`. Baseline analysis instantiated 1,542 calls.
Tracing admissions showed text rendering, binary decoding and FSM code generation
becoming involved. Some construction dependencies are legitimate; their names
alone are not evidence that they can be removed.

One specific edge was demonstrably wrong: `compile_definition_transitions(self)`
acquired `text_component.render_visible_glyph_rows` as an additional callee.
Function identities had not collided. The candidate path was:

```text
forward-declared local -> nil -> projected renderer field
                      -> renderer method -> function body
```

Two defects combined:

1. Static/projected field writes called `connectTerms(value, field)`, while its
   scalar rule assumes `connectTerms(storage, value)`. This created outgoing
   edges from `nil`, numbers and booleans to unrelated storage. Equal scalar
   contents do not establish a shared object location.
2. `retainStaticCallTargets` promoted the candidate graph's reachability into
   `directTargetsByCall`. The call graph then treated those candidates as bound
   targets, retaining false call facts and instantiating unrelated bodies.

A second independent reproduction uses two functions stored into one variable:

```lua
local function first() return {} end
local function second() return {} end
local selected = first
selected = second
first()
```

The baseline reports both functions as callees of `first()`. This proves the
candidate/proof problem independently of scalar field writes. The conservative
analysis may retain both values for `selected()`; that does not make `first()`
call `second()`.

## Implemented ownership repair

`SemanticDemandIndex` now retains selection candidates separately from lexical
direct targets. Effect/name/forwarding selection still uses candidates. Only
bound references and the existing forward value resolver can establish actual
call applications. The candidate list reuses the direct list when it adds
nothing, and copies it only when additional candidates exist.

Field relations now consistently run from storage to the assigned value. The
existing scalar rule consequently prevents reverse traversal from scalar values
without new per-query checks. No solver cap, cart exception or runtime heap path
was introduced; snapshot/cache lifetime is unchanged.

Regressions cover both false-callee examples, scalar writes at module and
receiver scope (`nil`, `false`, `0`, `''`), and retained alias-chain resolution.
The alias-chain test checks the resolved query result rather than requiring the
selection index itself to assert a callee. Actual applications, not only
navigation labels, are checked for the shared-function example.

## Measurements

Five alternating baseline/current process pairs, Intel Core Ultra 7 265KF,
191 Lua files / 1,218,055 UTF-16 source units / 1,690 function summaries.
No builds or test suites ran concurrently. Bundled baseline and current runners
use the same corpus and assertions.

| Query | Baseline median (range) | Repaired median (range) |
| --- | ---: | ---: |
| First component completion | 711.0 ms (686.0–736.4) | 368.4 ms (327.4–380.4) |
| After velocity-expression edit | 614.9 ms (607.8–623.3) | 277.7 ms (270.8–283.1) |
| After unrelated method addition | 611.2 ms (583.0–629.0) | 245.1 ms (241.6–255.6) |

| Work for the cold query | Baseline | Repaired |
| --- | ---: | ---: |
| Instantiated calls | 1,542 | 510 |
| Call evaluations | 7,051 | 2,216 |
| Value evaluations | 18,515 | 6,249 |
| Member evaluations | 10,696 | 3,158 |
| Solver waves | 26 | 24 |

The diagnostic dependency graph falls from about 147,000 entries / 531,000
edges to 63,000 entries / 158,000 edges. These retained-graph counts are not
measurements of all transient allocations or GC time.

Three alternating process pairs of the existing smaller profilers checked
independent receivers, direct functions/methods and parameter forwarding.
Most query medians stayed similar or improved. Two increased: 32 receivers
from 1.017 to 1.043 ms, and 256 callsites with written parameters from 6.010
to 6.342 ms. This is a correctness repair with a substantial improvement on
the demonstrated cart workload, not a universal speedup. Those profiles retain
parsed/bound facts, use fresh semantic queries and exclude guest execution.

Cold/edit timing includes snapshot creation, query-store construction and
completion; edit samples also bind the changed file. Initial whole-workspace
binding, UI rendering and guest execution are excluded. Unchanged repeats retain
the same answer without additional solver work. These are language-service
measurements, not a new user-authoring or device-runtime validation.

Reproduce the workload with
`tests/conformance/lua_source/profile_component_completion.ts`. Paired results,
baseline/current bundles, diagnostic traces and CPU profile are retained under
`.bmsx/authoring/nemesis-user-session/performance/receiver-proof-*` and
`demand-trace-*` (local ignored artifacts).

## Why the previous optimization trials did not help

The cache-entry trial changed allocations on cache misses but retained roughly
the same 147,000 dependency nodes and 531,000 edges. It did not remove the
underlying unnecessary analysis. The shared indexed-storage join trial added
dependencies instead: about 156,000 nodes and 622,000 edges, with worse latency.
Both were removed. Their measurements are historical local experiments, not
claims about the production references.

The successful change reduces incorrectly selected work at its owner. It does
not make every completion instant: 245–368 ms is still material latency, and
each edit still constructs new summaries and demand indices. The next justified
investigation is to measure construction versus demanded body analysis after
this repair, then design stable per-file/body inputs and effect invalidation if
construction dominates. Retaining old numeric term IDs or copying the monotone
solved graph across edits is not a valid incremental design. Further query
pruning likewise needs a demonstrated irrelevant dependency, not a time budget
or a list of known cart functions.

## Validation

- `npm run test:lua`: 1,899 passed, one pre-existing skip, zero failures.
- `npm run compile:toolchain`: passed.
- `npm run audit:architecture-boundaries:strict`: zero issues.
- Five full-corpus benchmark pairs and three pairs of the smaller profilers,
  including answer and unchanged-query work assertions.
- `git diff --check`: passed.
