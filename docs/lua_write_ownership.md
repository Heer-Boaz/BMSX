# Lua write ownership: the body is not the destination

2026-09-10, baseline `0c27e89f6`. Second producer correction for
[B04](behavior_source_authoring_design.md), following
[distinct function-body/return ownership](lua_function_source_ownership.md).
This does **not** complete source provenance or API-call certainty.

## Reproduced ownership failures

```lua
local selected = 0
local function left() selected = 11 end
local function right() selected = 22 end
```

The binder used one value list per destination declaration, without the body
containing each write. Summaries selected those lists by the declaration's
lexical owner. Consequently the two setters had no assignment aliases of their
own, while module aliases included `0`, `11` and `22` before instantiating either
function. Equal writes in different functions were also coalesced into one fact.
Nested functions could donate their writes to the outer function declaring the
destination. This is not a question of matching a cartlib registration spelling.

The same inference was wrong in the opposite direction:

```lua
local api<const> = {}
local function install() api.selected = { from_function = true } end
api.selected = { from_module = true }
local selected<const> = api.selected
return selected.from_module
```

The first mention of `selected` was inside `install`. The declaration-based
filter therefore omitted the later module member write. The public workspace
resolver returned no members for the local `selected`; it now finds
`from_module` in this independent fixture.

## Production implementations studied

- [TypeScript `bindContainer`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/binder.ts#L1010-L1061)
  separates ordinary function-body control flow from the enclosing flow. Merely
  binding a body does not make its writes part of the enclosing execution.
- [LLVM `AnalyzeGlobals` / `AnalyzeUsesOfPointer`](https://github.com/llvm/llvm-project/blob/d44c6a2b2527b7a93b7927a271fce5f584305afa/llvm/lib/Analysis/GlobalsModRef.cpp#L274-L334)
  records a store under the containing function even when the destination is a
  global. [`AnalyzeCallGraph`](https://github.com/llvm/llvm-project/blob/d44c6a2b2527b7a93b7927a271fce5f584305afa/llvm/lib/Analysis/GlobalsModRef.cpp#L490-L507)
  propagates those function effects through calls.

BMSX applies this ownership distinction to its existing binder/summaries. It
does not copy TypeScript's IIFE special case or add LLVM IR/alias analysis to
Lua, and this slice does not introduce a complete control-flow analysis.

## Implemented representation

| Owner | Contract |
| --- | --- |
| `SemanticBuilder` | Each `DeclarationValueEntry` retains its destination, modeled source, relation and containing `flow`. `undefined` flow means module evaluation. Equal values deduplicate only within that body and relation. |
| File facts | The flat declaration-value facts include all bodies with explicit ownership. Module member writes are separate from each function flow's `members`; a declaration's first mention cannot steal a later write. |
| Builder indices | Per-body deduplication does not scan other bodies writing the same binding. A separate declaration index supports existing member-declaration lookup. Both indices die with the builder; published facts are shared, not copied. |
| `FunctionSummaryStore` | Partition value facts by their actual flow once, then compile each summary's own values. No per-function whole-file value scan or declaration-scope assignment filter. |
| `WorkspaceValueIdentityIndex` | Only module-owned constant-value facts may establish context-independent unions. No scan of every function's declarations to guess assignment ownership. |
| `SemanticDemandIndex` | Module aliases select module-owned writes. Module member facts need no declaration-scope filter. Existing inferred receiver-shape projection remains here, not duplicated in the binder. |
| `SemanticInstantiationQuery` | Existing frame publication consumes the corrected summaries. Instantiating one setter cannot import the other setter's assignment through a shared destination list. |

The obsolete declaration-to-summary assignment-owner index, binder projection
flag set and end-of-bind value flattening/mapping pass are removed. The facts
remain host source tooling; cartlib, runtime, physical ROM ABI and C++ execution
are unchanged. Declaration identity still serves binding/navigation; it is not
an execution context.

## Evidence and scope

`tests/lua/semantic_write_owners.test.ts` contains seven independent fixtures:
different and equal writes to one captured binding, replacement member writes,
nested closures, a later module write, public workspace member resolution, and
actual summary instantiation with compiled BLua execution as a separate oracle.

The instantiation fixture starts with only the module's `0`, adds only `11`
after instantiating `left`, and only then adds `22` for `right`. The ordinary
compiler/CPU fixture calls both setters and returns the observed pair `11, 22`.
The semantic relation deliberately remains a may-value union, not a replay of
the variable's latest runtime state. No game names or mutable cart line numbers
are fixtures, and no mock cartlib or host evaluator is used.

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/semantic_write_owners.test.ts tests/lua/semantic_function_sources.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_function_sources.ts
```

### Measured host costs

Node v22.23.1; four isolated baseline/current process pairs, with identical
bundling and the existing profiler above. Each timing is the median of four
process medians, each with ten warmups and 25 samples. Binding uses a retained
parse; the fresh workspace query uses retained file facts and a real returned
member. Times are milliseconds unless stated otherwise.

| Named bodies | Bind before / after | Identities + summaries before / after | Fresh workspace + first query before / after |
| --- | --- | --- | --- |
| 32 | 0.104 / 0.101 | 0.077 / 0.050 | 0.170 / 0.166 |
| 1,024 | 4.854 / 4.783 | 6.827 / 0.607 | 9.947 / 2.792 |

At 1,024 bodies the summary-build process medians ranged from 6.521–7.256 ms
before to 0.593–0.644 ms after; workspace/query ranged from 9.361–10.693 to
2.692–2.822 ms. Retained query medians at that size were about 0.0126
microseconds in both versions. These tiny warm timings are JIT-sensitive.
Both versions retain the expected summary count, one instantiated call and one
CallFact pass. This fixture measures the removed whole-file-per-function scan,
not universal speedup, heap allocation, rendering, guest execution or Hot Resume.

Validation:

- Full Lua suite: 1,303 passed, one existing skip, zero failures.
- Toolchain and IDE typechecks passed. The tests-project typecheck retains the
  same 51 existing diagnostics as the baseline (identical
  file/code/message/multiplicity, ignoring shifted offsets).
- Strict architecture audit: zero issues; core-parity audit passed.
- Debug browser Studio, headless tooling, BIOS, Nemesis S and Pietious builds
  passed. Actual browser Studio workflows and Pietious navigation passed on
  software, WebGL2 and WebGPU separately, including source/history regression
  gates. This is not a new graph feature or source-completeness proof.

Temporary before/after probes, timings, validation logs and browser captures are
in `/tmp/bmsx-write-owners`; regression fixtures and the shared profiler are
checked in.

## Still open: hypothetical projection is not execution evidence

The original public-query counterexample still matters:

```lua
local first<const> = { first = true }
local second<const> = { second = true }
local selected = first
local function install() selected = second end
return selected.first, selected.second
```

Querying possible members of `selected` still returns both names without any
call to `install`. The incorrect module-owned assignment fact is gone, but
`SemanticCallGraph.activateDependencies` can compose the setter, and
`SemanticInstantiationQuery.compose` publishes projected aliases into the same
value relation. This is **not fixed by the producer correction**. Thus a
possible-value result, even with correct write owners, is not a reaching-write,
exclusive-callee or complete source-origin proof.

Before the stronger B04 query, hypothetical body analysis and call-instantiated
effects need an explicit context contract. Filtering out inconvenient global
aliases in Lens, using `instantiatedCalls` as a certainty flag, or dropping
all captured assignments during composition would not establish that contract;
the latter would also lose useful analysis inside uncalled bodies. Preserve the
existing navigation query's actual scope while designing the stronger relation.

This slice also does not retain every written value occurrence, model every
unknown value or return lane, prove statement ordering, broaden recognition,
or alter source-edit admission. B03 and the remaining B04 contracts stay open.
