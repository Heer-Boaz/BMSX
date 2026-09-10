# Lua function sources: bodies are not storage bindings

Implemented on 2026-09-10, against `8c8eb5964`. This is the first producer
boundary of [B04](behavior_source_authoring_design.md), not its completed
source-query contract or permission to broaden graph editing.

## Failure and production reference

The binder used a named destination declaration as the function's value. Two
function bodies writing the same member consequently shared a value key. The
file-wide return map overwrote the first body's returns when binding the second;
a second body without a return deleted the first body's returns entirely.
Methods also shared the implicit receiver and its summary ownership.

Microsoft TypeScript retains declarations on their symbols while binding a
function expression as its own declaration. The relevant production owners are
[`addDeclarationToSymbol`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/binder.ts#L648-L667)
and [`bindFunctionExpression`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/binder.ts#L3736-L3747).
The applicable distinction is syntax/body versus named binding, not TypeScript's
declaration-merging rules transplanted into Lua.

## Owning representations

| Surface | Before | Now |
| --- | --- | --- |
| Function body | Named declaration value, or expression value for anonymous functions | Every body has its own existing expression value and retains its actual `LuaFunctionExpression` |
| Destination | Inferred from the function-value root kind | Explicit optional `FunctionValueFlowEntry.declaration`; ordinary declaration/value-flow edges connect storage to the body |
| Return occurrences | File map keyed by function value; equal values deduplicated during binding | Each function flow retains its own written `LuaReturnStatement`s and modeled first values |
| Summary returns | Scan and match the file-wide return list for every function | Compile only the owning flow's returns; deduplicate equal terms here |
| Implicit receiver | Key shared by bodies writing the same member | Existing receiver key follows the distinct body value |
| Call hierarchy | Infer the enclosing named declaration from the function-value root | Read the explicit named binding; anonymous callbacks still use the nearest named enclosing flow |

`SemanticBuilder` produces these facts. `FunctionSummaryStore` consumes them;
the immutable file snapshot owns their lifetime. No parallel resolver, AST
copy, source-range lookup, runtime data, or Lens-specific rule is introduced.
The file-wide return map, separate return stack and flattening pass are removed.
Existing table-constructor allocation identities are not changed by this slice.

Two associated producer corrections preserve the same storage/body distinction:

- `local f; function f() ... end` assigns the existing lexical binding instead
  of inventing a namesake global.
- Surplus right-hand expressions in an assignment are still bound, but do not
  acquire the final left-hand destination. A discarded function expression is
  not another function stored in that destination.

The existing value solver models only the **first return lane**. Retaining the
full statement preserves the distinction between no return statement, bare
return, explicit nil and an unmodeled expression; it does not make those values
fully modeled. Value-term equality still is not written-occurrence identity.
Expression-value keys are not editor bookmarks or Hot Resume prototype IDs.

## Independent evidence

`tests/lua/semantic_function_sources.test.ts` has eleven fixtures independent of
game files, identifiers and line numbers. They cover separate body/return/self
ownership, equal written returns, unmodeled returns, nested closures and caller
attribution, lexical reassignment, surplus right-hand functions, and public
cross-module result resolution.

The CPU fixture installs two methods through two installer functions, captures
the first method, installs the second, and calls both on one receiver. Ordinary
BLua32 compilation/execution returns `11, 22`. It does not use a mock cartlib or
host Lua evaluator. The resolver fixture separately proves that possible result
members from both bodies survive; this is not a claim about exact reaching
definitions or exclusive call targets.

```sh
npx tsx --tsconfig tsconfig.base.json --test --import ./tests/lua/test_setup.ts \
  tests/lua/semantic_function_sources.test.ts tests/lua/semantic_function_summary.test.ts
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_function_sources.ts
```

Validation for this slice:

- Full `npm run test:lua`: 1,296 passed, one existing skip, zero failures.
- Lua toolchain and IDE project typechecks passed. The tests project still has
  51 diagnostics: an exact baseline/current comparison has identical files,
  codes, messages and multiplicities, ignoring shifted source offsets.
- Strict architecture-boundary audit: zero issues; core-parity audit passed.
- Debug browser Studio, node-headless tooling, BIOS, Nemesis S and Pietious
  builds passed.
- Actual browser Studio workflows and Pietious navigation passed separately on
  software, WebGL2 and WebGPU, including ordinary source/history operations.
  These remain regression gates, not a claim that B03/B04 or all UX is complete.

Reproduction commands and profiling boundaries also live in
[`tests/conformance/lua_source/README.md`](../tests/conformance/lua_source/README.md).

## Measured host cost

Node v22.23.1; four isolated baseline/current process pairs, using the same
bundled profiler. Baseline loads the three semantic owners from `8c8eb5964`.
Each process uses ten warmups and the median of 25 samples; the table is the
median of the four process medians, in milliseconds. Binding batches ten binds
per sample over one retained parse. The workspace query starts from retained
file facts and resolves a real member returned through one call.

| Named bodies | Bind before / after | Fresh identities + summaries before / after | Fresh workspace + first query before / after |
| --- | --- | --- | --- |
| 32 | 0.107 / 0.096 | 0.106 / 0.078 | 0.152 / 0.179 |
| 1,024 | 4.827 / 4.903 | 10.216 / 7.467 | 11.657 / 10.553 |

This is not a uniform speedup: the small fresh query is about 0.027 ms slower
and the larger bind about 0.076 ms slower. At 1,024 bodies, the process-median
ranges are 4.791–4.868 / 4.875–4.930 ms for binding, 9.961–10.369 /
6.822–7.980 ms for identities/summaries and 11.423–12.096 / 9.505–10.910 ms for
workspace/query. Retained lookup medians are about 0.012 microseconds in both
versions at that size; these tiny timings are JIT-sensitive, not thresholds.
Both versions retain the expected summary count, one instantiated call and one
CallFact pass.

Distinct function values require the ordinary storage/value edges that were
previously absent for named bodies. Removing the file-wide return scan reduces
summary work, but other file-wide scans remain; the whole summary builder is
not claimed to be linear. No per-frame or guest work is added. These measurements
exclude parsing, rendering, Hot Resume, guest execution and heap profiling.
Raw runs and browser captures are local artifacts under
`/tmp/bmsx-source-origins`; fixtures and the profiler are checked in.

## Remaining boundary: compiler prototype identity

A separate compiled probe exposed an existing compiler limitation:

```lua
local api<const> = {}
function api:read() return self.first end
local previous<const> = api.read
function api:read() return self.second end
local owner<const> = { first = 11, second = 22 }
return previous(owner), api.read(owner)
```

Two same-path declarations within the same enclosing function collide at
`ProgramBuilder` with `Duplicate proto id 'module:compiled.lua/entry/decl:api.read'`.
The binder fix covers these two source bodies; this **compiler limitation is
not fixed**. The successful CPU fixture above has distinct enclosing compiler
paths, while preserving the same shared-binding semantic regression.

Prototype allocation, source correspondence, capture layout and Hot Resume
matching must be considered together before changing this owner. Appending a
suffix after a collision or removing the uniqueness check is not the fix.
This finding does not authorize a new Lens source restriction or compatibility
path. The broader source-origin/completeness/callcontext queries and multi-file
document lifetime from B04 also remain open; its existing recognizer is unchanged.
