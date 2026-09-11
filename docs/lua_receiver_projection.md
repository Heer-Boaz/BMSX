# Lua receiver projection: an inferred shape is not a module write

2026-09-10, baseline `be8980a50`. A further owner correction within
[B04](behavior_source_authoring_design.md). This does **not** complete the
separation of hypothetical analysis from call-instantiated value relations.

Historical slice record: the subsequent [recursive-input correction](lua_recursive_inputs.md)
introduces retained formal entry points and separate read-answer propagation.
The module-versus-projection ownership described here remains unchanged.

## Reproduced failures

```lua
local original = {}
local actual = {}
function original:configure() self.field = 22 end
original.configure(actual)
return original.field, actual.field
```

Compiled BLua at O0 and O3 returns `nil, 22`. The semantic instantiation owner,
however, used to publish an extra inferred receiver write just by demanding
`field`, before or after instantiating the one selected call. The demand index
had already mixed hypothetical `self`-shape writes into its module-write list.
This was not a runtime write, and did not require any call frame.

Publication also tried to find the writing body with
`summaryOwner(write.value)`. That is the RHS owner, not the write owner. A
literal or module value has no function owner; a captured parameter can belong
to an enclosing function rather than the method containing the write.

A separate source-navigation counterexample exposed the other half of the
projection contract:

```lua
local original = {}
local function factory()
    local captured = { token = true }
    function original:configure() self.field = captured end
end
function original:read() return self.field.token end
```

Possible-value navigation could not find `token` from the receiver's `field`.
A projected nested body needs its lexical bindings and their table writes,
not only aliases or a specially copied first-level `self` field. The corrected
query finds the actual written `token` declaration, without pretending that
the uncalled `factory` executed. A separate CPU probe appends real calls and
verifies the resulting `true` at both optimization levels.

## Production references and applied boundaries

- WALA's
  [target/context selection](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/PropagationCallGraphBuilder.java#L667-L687)
  keeps the selected method and analysis context together. Its
  [resolved-call processing](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/SSAPropagationCallGraphBuilder.java#L1574-L1601)
  connects a caller/callsite to that target before applying calling constraints.
  A name-selection index is not itself such an edge.
- WALA's
  [property and lexical access handling](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/cast/src/main/java/com/ibm/wala/cast/ipa/callgraph/AstSSAPropagationCallGraphBuilder.java#L353-L434)
  keeps field writes and captured binding accesses with their own receiver or
  defining scope. The expression supplying a value does not own its destination.

These implementations were read before editing. BMSX applies these owner
distinctions to its existing summaries and query engine; it does not acquire
WALA's SSA, reachability model or context-sensitive proof by borrowing names.
In particular, BMSX's broad navigation projection remains a different contract
from analysis rooted at selected program entrypoints.

## Implemented ownership

| Owner | Contract |
| --- | --- |
| Immutable file/function facts | Unchanged. Each function retains its own raw receiver, member writes and lexical owner. |
| `SemanticDemandIndex.staticWrites` | Module-owned writes only. No projected method write is copied into this collection. |
| `SemanticDemandIndex.receiverWriters` | Name-to-summary selection index for possible receiver shapes. It retains each writing body once, not a copied write or an RHS-derived owner. Existing term relationships remain selection dependencies. |
| `SemanticInstantiationQuery.demandName` | Publishes module writes and writes belonging to already instantiated frames. It neither composes an uncalled function nor infers its receiver. |
| `SemanticInstantiationQuery.projectName` | Explicitly requests source projection. It selects receiver-writing bodies and materializes the requested name from already projected bodies. |
| `compose` | Retains the selected body's lexical parent projections, aliases and demanded member writes. Nested local-table fields use the same summary-write path as receiver fields. |
| `instantiate` | Unchanged actual-to-formal and closure-frame owner. A method called with a different receiver writes through that actual argument. |
| `SemanticMemberQuery` / `LuaSemanticQueryStore` | Explicitly request the broader projection used by navigation, including intermediate access-path members. They do not silently treat it as execution evidence. |

The index does not construct a second set of projected write objects. Conversion
from a summary term to a projected term occurs when the instantiation/query owner
publishes the demanded fact. Name/body lists and membership bits are retained;
each newly requested name is paired with already projected bodies, and each
newly projected body with already requested names. Repeated requests do not
republish those pairs. Frame-write materialization remains independent.

All changed production paths are TypeScript **source tooling**, not emulated
CPU, BIOS, cartlib, Hot Resume application, ROM ABI or C++ runtime. No per-worldtick
work, guest metadata, separate evaluator, compatibility path or Lens-specific
interpreter is introduced.

## Regression evidence

`tests/lua/semantic_projection_ownership.test.ts` has fourteen independent cases:
module versus receiver owners; different RHS owners; repeated writes by one
body; literal/module/function RHSs; demand before and after actual instantiation;
projection before and after name demand; source-query order; captured local
tables; and compiled O0/O3 execution. No mutable game name, source line or cartlib
API spelling defines these fixtures.

The two actual-receiver cases and the two nested-source-query cases fail on
`be8980a50` using the same public test entrypoints, and pass with the correction.
The former expose the unwanted projected write; the latter expose a missing
source declaration. The remaining cases exercise the new producer contract and
retained publication schedule, not just the presence of a new method.

### Measured costs

Node v22.23.1; four isolated, alternating baseline/current process pairs.
Bundles differ only in the four edited semantic-owner files. Synthetic timings
are medians of four process medians, each with ten warmups and 25 samples.
The new `tests/conformance/lua_source/profile_receiver_projection.ts` uses
distinct receivers with the same member spelling and uncalled writer/readers.
It verifies the precise declaration for each receiver, not only target counts.

| Fresh workspace + query, retained file facts | Baseline ms | Corrected ms |
| --- | ---: | ---: |
| 32 receiver projections, all field queries | 0.704 | 0.697 |
| 256 receiver projections, all field queries | 4.869 | 4.755 |
| 256 forwarding callsites, read-only parameter | 3.936 | 3.950 |
| 256 forwarding callsites, written parameter | 3.915 | 4.031 |
| 1,024 function bodies, one returned-member query | 2.774 | 2.783 |
| 1,024 method bodies, one returned-member query | 2.678 | 2.739 |

The receiver fixture retains zero instantiated calls and zero CallFact passes:
source projection must not inflate that metric into fictitious execution.
Its warm 256-receiver lookups are approximately 0.0054 / 0.0053 microseconds
per lookup in the batched loop; such tiny JIT-sensitive timings are not a UI
latency guarantee. The written-parameter case has a small measured increase,
so this is not a universal speedup or zero-cost claim.

The real Nemesis/cartlib corpus has 191 files and 1,690 summaries. At the existing
`self.actioneffects` query, the four-process median is 254.6 / 247.0 ms, with the
same target, 102 instantiated calls and four passes. Complete profiling-process
time is 0.72 / 0.70 s; maximum RSS is 294,760 / 293,374 KiB. This query has no
incoming hierarchy groups. Those figures do not measure large call hierarchies,
retained heap, allocation counts, guest execution or browser frame latency.

Validation:

- `npm run test:lua`: **1,344 passed, one existing skip, zero failures**.
- Toolchain Lua and IDE `tsc --noEmit`: passed. The tests-project typecheck has
  the same **51 pre-existing diagnostics** as the baseline, compared by
  file/code/message/multiplicity; it is not claimed typecheck-clean.
- Strict architecture-boundary audit: zero issues; core-parity audit,
  indentation check and `git diff --check`: passed.
- Browser Studio, headless tooling, BIOS, Nemesis S and Pietious debug builds:
  passed. All three rebuilt ROMs are byte-identical to the pre-slice ROMs.
- Actual browser `--studio` workflows and `--studio-navigation pietious`:
  **passed separately on software, WebGL2 and WebGPU**. Final captures were
  inspected. These are source/navigation/history and existing Studio regression
  gates, not evidence of new graph UX or completed B04 source analysis.

Temporary probes, paired measurements and logs are in `/tmp/bmsx-query-contexts`;
the independent fixtures and shared profiler are checked in.

## Still open: analysis context, not a certainty flag

Once a navigation query explicitly requests projections, their aliases and
member writes still share the existing may-value relation with contextualized
calls. Recursive hypothetical call processing and `CallFact` aggregation do
not yet expose separate entry contexts. `compose` of a captured setter can
still contribute its possible value without a runtime call. The original
[public-query counterexample](lua_write_ownership.md#still-open-hypothetical-projection-is-not-execution-evidence)
therefore remains relevant: rechecked on this patch, navigation still returns
`first` and `second`, with zero instantiated calls and zero CallFact passes.

This slice fixes write selection/publication ownership and missing projected
lexical fields. It does not establish reaching writes, statement ordering,
exclusive callees, unknown-contribution completeness, every return lane,
source occurrences or multi-file edit lifetime. The stronger B04 source query
and wider B03 graph-edit admission remain open; no UI consumer is granted
extra certainty from a singleton target or a positive frame count.
