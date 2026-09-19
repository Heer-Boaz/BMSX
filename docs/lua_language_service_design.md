# Lua language-service layering

## Decision

Interactive IDE features (hover, go to definition, completion, signature help,
find references) resolve through a **definition-based** layer, the way a
language server does it (TypeScript's checker, LuaLS): the meaning of a name
follows from its declarations and the definitions they name, computed lazily,
cached per file and bounded per request. What other code may write into an
object at run time does not contribute.

The may-call solver (`LuaSemanticQueryStore`) remains only behind explicitly
requested whole-program views (call hierarchy). It never runs for hover,
completion, signature help or navigation.

Where the definitions do not determine a value (a parameter filled by callers,
a field attached by another component), the layer answers "unknown" instead of
guessing. Precision beyond definitions is added later with LuaLS-compatible
annotations (`---@class`, `---@field`, `---@type`, `---@param`), not with
whole-program inference.

## Why

Measured 2026-09-19 (fresh snapshot per query):

| Workspace | Query | Solver | Frames |
|---|---|---|---|
| pietious | `director.lua:96` `world:set_space` | 2958 ms | 2075 |
| pietious | `director.lua:98` `self.ui` | 2969 ms | 2021 |
| nemesis_s | `player.lua:1151` `enemy:receive_player_projectile` | 801 ms, no answer | 991 |
| nemesis_s | `actioneffect_component.lua:10` `bind_state_path` | no answer cold, correct after other queries | 6 |

The solver is unbounded in practice and its answers depend on query order.
The cart compiler never constructs it (verified: zero query stores while
compiling 208 pietious sources), so moving the IDE off it changes no codegen.

## Model

A **shape** is a table identity with a definition site: a table constructor, a
declaration whose written value is one, or a module export.

`typeOf(expression)` yields shapes (or unknown) by these rules, each evaluated
once per snapshot and memoized:

| Expression | Shapes |
|---|---|
| `{ … }` | the constructor's shape |
| name bound to a declaration | union of the declaration's written values (alias chain, as in `resolveDefinitionFunctionTargets`) |
| `require('m')` | the module's export value |
| `a.b` (static member) | members `b` of `typeOf(a)` |
| `f(…)` | return values of the definition-resolved `f`, context-insensitive, memoized per function |
| `setmetatable(t, mt)` | `typeOf(t)` with prototype `mt.__index` |
| `self` in `function C:m()` / `function C.m(self)` | instances of `C` |
| a parameter | unknown (annotation later); an explicit first `self` of a body the binder projects onto a receiver is that receiver |
| `t[k]`, table elements | unknown (element typing from `t[i] = v` is a possible later extension) |
| member path without a value of its own (`function base.tools.byte()`) | a path shape `base.tools`, so writes and reads through any alias of that path meet |

`membersOf(shape)`:

1. fields of its constructor;
2. static assignments whose name path starts at the shape's declaration
   (`function C.f`, `function C:m`, `C.x = …`), scoped as in the definition
   hover: a local owner's members in its own file, a global owner's anywhere;
3. `self.x = …` inside methods of the shape (as LuaLS infers class fields);
4. the prototype chain, from `setmetatable(C, { __index = B })`, `C.__index = C`,
   and **prototype summaries** (below).

**Prototype summaries.** A function whose body sets a metatable `__index` on
data reachable from its parameters gets a summary, computed once per function
from its own body: e.g. `prefab.define(source)` sets
`source.class.__index → source.base or world_object`. At a call site whose
arguments are static (a table constructor naming declarations), the summary is
applied: `prefab.define({ class = director, base = world_object })` makes
`world_object` the prototype of `director`. Call sites with non-static
arguments contribute nothing. This is definition-based: one level, the callee's
own body, the call site's own arguments. It covers the 94 `prefab.define` uses
without a framework-specific rule.

**Bounds.** Alias and prototype chains stop at depth 8 and on revisits; return
inference follows definition-resolved callees only, context-insensitive, with
the same depth bound. No rule enumerates writers elsewhere in the program.

## Incrementality

Per-file facts (shape definitions, static members, `self` fields, prototype
edges, return expressions, prototype summaries) are pure functions of a file's
`FileSemanticData` and are cached on it. Cross-file answers are memoized per
workspace snapshot and derived from those facts, so an edit re-derives only
queries that read the changed file's facts. Requests are synchronous but
bounded; the frame never runs a whole-program fixpoint.

## Consumers

| Feature | Before | After |
|---|---|---|
| Hover on members/methods | `getQueryStore().member(...)` | `membersOf(typeOf(receiver))` |
| Go to definition | same as hover | same as hover |
| Completion members (`getMembers`) | `getQueryStore().allMembers(...)` | `membersOf(typeOf(receiver))` |
| Signature help (`resolveCallableTargets`) | `callee(...)` / `functions(...)` | definition-resolved callee |
| Find references | candidate refs by name, each resolved through the solver | same candidates, resolved through the layer |
| Hover signature of bindings | already definition-based | unchanged |
| Call hierarchy | solver | solver (explicit, k-limited) |

## Precision contract

| idetest (nemesis_s) | Under this model |
|---|---|
| `semantic_inherited_factory` | kept: `prefab.define` prototype summary, static `self.events` field, factory return |
| `semantic_dynamic_receiver` (`enemy`, `primary.collider`) | receivers are callback parameters / collision results: unknown without annotations |
| `semantic_heap_effect_receiver` (`owner.state_machines`) | field attached by another component at run time: unknown without a `---@field` |

The latter two now assert the contract: a receiver determined by definitions
resolves (`self:initialize_options`, `self:rebind_effect`), and the dynamic
receivers carry no semantic label rather than a wrong one. They are extended
again when annotations land.

The solver's own specification tests (`semantic_value_graph`,
`semantic_recursive_parameters`, `semantic_keyed_shapes`,
`semantic_parameter_context`, `semantic_runtime_value_flow`,
`semantic_receiver_binding`, and the parameter-dependent cases elsewhere) query
it through the explicit `resolveWholeProgram*` / `getWholeProgramMembers` API,
which call hierarchy uses. Interactive APIs never reach it.

## Verification

- `tests/lua` cases per rule of the `typeOf` table, per `membersOf` source and
  for prototype summaries, including two-file cases for scoping.
- Every IDE feature above gets a test that it does not construct the query
  store (`getSemanticQueryMetrics` must not be reached; a construction counter
  in the test).
- Gate: `npm run test:lua` at its single pre-existing failure; the three
  idetests pass under the contract above; the baseline table re-measured with
  every interactive query well under one frame budget.

## Results (2026-09-19)

| Query, fresh snapshot | Solver | Definition layer |
|---|---|---|
| pietious `world:set_space` | 2958 ms | 86 ms (index build) |
| pietious `self.ui` | 2969 ms | 68 ms |
| nemesis_s `self.events:emit` | 237 ms | 61 ms |
| every member reference in pietious (21 135), warm | — | 125 ms total, 0.006 ms average |

Against the solver on 300 sampled member references per workspace: zero
contradicting answers and zero targets the solver does not also produce;
82–83 % of the solver's resolved references resolve identically, the rest are
parameter- or effect-derived (the intended contract change).

Incrementality (step 5): per-file facts live in a `WeakMap` on each file's
`FileSemanticData`, so an edit re-derives only the edited file. Prototypes are
found lazily per table from the sites that name it (its constructor or a
declaration holding it, as a `setmetatable` target, a call argument, or a field
of a call's table-constructor argument), instead of scanning every call. After
an edit the first member query costs 1.4–4.6 ms (was ~33 ms); the edited file's
rebind (7–21 ms for pietious' largest files) is now the dominant per-edit cost.
Lazy site discovery resolves 13 fewer of pietious' 21 135 member references
than the eager scan did: prototypes applied through sites that do not name the
table directly.

In the IDE, stopped at a breakpoint in pietious `director.lua` (the scenario
that previously exhausted a 4 GB heap): `world` 36.5 ms on the first query of a
session, `self.ui` 1.3 ms, `self.effects` 1.6 ms, frames 1–2 ms.

## Order of work

1. `typeOf` / `membersOf` with the table's rules and tests; switch hover and go
   to definition for member references.
2. Completion (`getMembers`) and signature help.
3. Prototype summaries (`prefab.define`); inherited-factory idetest.
4. Find references through the layer; the solver remains only for call
   hierarchy.
5. Per-file fact caching across snapshots (edit cost).
6. Later, separately: LuaLS-compatible annotations.
