# Lua parameter context: entry values are not writable bindings

2026-09-10, baseline `065c67047`. A prerequisite correction within
[B04](behavior_source_authoring_design.md), not a completed source-origin API.

## Reproduced error

```lua
local original<const> = { original = true }
local replacement<const> = { replacement = true }
local function change(value) value = replacement return value end
local selected<const> = change(original)
```

The public resolver gave both objects both member names. A summary used one
`Parameter` term for the incoming argument value and its writable source
binding. Substituting the actual argument into an assignment's destination
published `original -> replacement`. Forwarding calls and closures could make
the same error. This is a generic language-owner bug, not a cartlib API issue.

## Production references and applied distinction

- WALA keys locals by
  [call-graph node and SSA value number](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/LocalPointerKey.java#L15-L41).
  Its [calling constraints](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/SSAPropagationCallGraphBuilder.java#L1630-L1680)
  connect actual values to formals and callee returns to caller results; an
  assignment to a formal is not an assignment to the caller's variable.
- WALA's [field-read constraints](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/SSAPropagationCallGraphBuilder.java#L953-L983)
  identify fields through the receiver values. A different spelling or local
  holding that receiver does not create different object storage.
- Lua's own [parameter/body binding](https://github.com/lua/lua/blob/v5.4.8/lparser.c#L958-L1008)
  treats parameters, including implicit `self`, as locals. This is the semantic
  rule; BMSX does not need to copy Lua's register allocator or WALA's Java IR.

BMSX applies the entry-value versus writable-binding distinction in its existing
summaries. It does **not** introduce SSA control flow, a second evaluator, or
whole-program execution/reaching-write certainty.

## Owning representations

| Owner | Contract |
| --- | --- |
| Binder facts | Existing write references identify the exact declaration, including captured writes in nested bodies. A write still exists when its RHS has no modeled value. |
| `FunctionSummaryStore` | `Parameter` means immutable function-entry value. A named formal with binding writes instead has an ordinary `Local` source-binding term, initialized from that entry value. |
| Never-written formal | Source binding and entry value share the input term. There is no extra alias/storage layer to allocate or traverse. This uses binding-write facts, not absence from possible-value results. |
| `SemanticInstantiationQuery` | Existing actual-to-input substitution remains unchanged. A writable binding uses the existing closure-owned `ContextRoot(Local, frame)`, so replacement cannot assign to the actual argument. |
| `SemanticDemandIndex` | A write to a captured `Local` is an effect outside the writing body, just as a captured module binding is. Its declaration spelling is not the criterion. |
| Location queries | An existing rooted access path can refer through an alias at any base depth. Term lookup retains its operator/key and does not synthesize more paths while following reverse aliases. |

For example, a write through `object.inner.values[key]` must be visible when
`object` is a local parameter binding holding the same receiver as the reader.
The old location walk only substituted the immediate base. The corrected walk
checks every base in the path, using `SemanticTermStore.retainedAccessWithBase`.
It retains the existing distinction between root aliases and table containment;
index keys still use forward value alternatives. A retained scratch path is
reused per query depth, and there is no arbitrary path-depth/query cap.

The summary build makes one pass over file write references. It does not scan
all writes per parameter or allocate new frames/aliases for read-only formals.
Instantiation, compiler emission, guest execution, cartlib, machine ABI and C++
are unchanged. All edited execution paths here are host semantic tooling.

## Rejected consumer-side expansion

The first experiment introduced a binding cell for every parameter and eagerly
resolved complete value alternatives during producer activation. Small tests
passed, but the real Nemesis workspace query went from under a second to a run
stopped after 76.9 seconds. Isolated variants identified the eager query
expansion as the expensive part. That experiment was removed, not hidden behind
a timeout, fallback, cache exception or game-specific restriction. The landed
design changes the summary representation and retains the demand-driven solver.

## Gates

`tests/lua/semantic_parameter_context.test.ts` uses independent Lua fixtures:
input versus writable binding, omitted arguments, RHSs without modeled values,
shadowing, captured formals/locals, forwarding, separate argument/replacement
pairs, object mutation, deferred callbacks and nested indexed storage. Query
order is exercised on fresh snapshots. Compiled BLua separately distinguishes
rebinding from writes through the shared object.

The resolver remains flow-insensitive: `selected` in the example has possible
values from both before and after the assignment. The actual compiled return
after replacement has only the runtime replacement. These are different
contracts; the test must not pretend that a may-value union is execution.

Validation on Node `v22.23.1`:

- `npm run test:lua`: **1,317 passed, one existing skip, zero failures**;
  includes the 14 independent parameter-context cases.
- Toolchain Lua and IDE `tsc --noEmit`: passed. The tests project's **51
  pre-existing diagnostics** match the baseline by file/code/message and
  multiplicity; that project is not claimed typecheck-clean.
- Architecture-boundary strict audit: zero issues; core-parity audit and
  indentation check: passed. Browser Studio, headless tooling, BIOS, Nemesis
  and Pietious debug builds: passed.
- Actual browser `--studio` workflows and `--studio-navigation pietious`:
  **passed on software, WebGL2 and WebGPU**, including source/history and
  existing Studio workflow gates. These are regression checks, not evidence
  that the remaining source-authoring contracts are complete.
- `git diff --check`: passed.

### Measured cost, not a speedup claim

Four paired baseline/current processes used identical esbuild bundles except
for the three edited semantic-owner files. Synthetic figures are medians of
the four process medians (10 warmups, 25 measured samples per process).
File facts are retained; the fresh-query measurement includes workspace
construction and every returned-member lookup, not parsing or rendering.

| Synthetic fixture | Baseline ms | Corrected ms |
| --- | ---: | ---: |
| 32 callsites, read-only parameters | 0.620 | 0.661 |
| 256 callsites, read-only parameters | 3.915 | 3.980 |
| 32 callsites, written middle parameter | 0.306 | 0.381 |
| 256 callsites, written middle parameter | 3.791 | 3.956 |
| 1,024 bodies, summary construction only | 0.615 | 0.745 |
| 1,024 bodies, fresh query of one call | 2.789 | 2.845 |

The forwarding fixture uses three bodies. Its written variant deliberately
uses `value = value`, exercising binding-write classification without changing
the result. Both versions instantiate 96/768 calls at 32/256 callsites, in two
passes. Correct storage for written parameters and the file write-reference
pass have a measurable cost; the patch does not eliminate it. Retained
256-callsite lookups remain about 0.005–0.006 microseconds per lookup in the
batched synthetic test; those timings are not a latency guarantee.

The live Nemesis/cartlib corpus (191 files, 1,690 summaries) was also measured
with the existing `profile_lua_semantics.ts` probe at `self.actioneffects`:

| Four-process median | Baseline | Corrected |
| --- | ---: | ---: |
| Initial symbol resolution | 226.7 ms | 228.3 ms |
| Complete profiling process | 0.705 s | 0.690 s |
| Process maximum RSS | 293,476 KiB | 292,740 KiB |

The target is unchanged, with 89 instantiated calls; the corrected demand
schedule takes five passes rather than four. This field query has no incoming
call-hierarchy groups: it is not a benchmark of a large incoming hierarchy.
The full process includes corpus loading and edit probes. Maximum RSS is not
retained heap or a GC-allocation measurement. Neither these measurements nor
the browser gates establish guest performance, arbitrary-query complexity,
complete source origins or exclusive-callee certainty.

## Still open

- [Hypothetical composition versus call-instantiated effects](lua_write_ownership.md#still-open-hypothetical-projection-is-not-execution-evidence)
  still needs an explicit query-context contract. This correction does not make
  the possible-symbols API a source-completeness or exclusive-callee proof.
- The implicit-`self` read/write mismatch found by this slice is corrected in
  the subsequent [receiver-binding slice](lua_receiver_binding.md), including
  compiled execution and shared captured cells through Hot Resume.
- Unknown written contributions, all return lanes, source occurrences,
  statement order and the previously documented compiler prototype-id collision
  are not completed by this slice. Lens recognition/edit admission is unchanged.
