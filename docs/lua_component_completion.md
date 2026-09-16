# Receiver completion and keyed storage

2026-09-16. This repairs the shared Lua query owner used by Studio completion
and navigation. It does not change cart APIs or guest execution.

The later [production comparison and dependency-scope investigation](lua_completion_analysis.md)
records a further repair to candidate/callee ownership, with updated measurements.
The measurements below describe the earlier `bff12a1dc` baseline.

## Failure and design references

Completion on `self:get_component(Component)` could return the actor's methods
or another component's methods. Enumerating every name in the workspace also
caused hundreds of separate solver rounds. Caching that answer hid repeated
work on an unchanged document, but did not make the answer correct or edits fast.

Production implementations studied before implementation:

- [VS Code's TypeScript completion provider](https://github.com/microsoft/vscode/blob/main/extensions/typescript-language-features/src/languageFeatures/completions.ts)
  delegates semantic completion to the language service.
- [TypeScript's completion service](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/completions.ts#L3755-L3822)
  obtains properties from the receiver's apparent type. BMSX uses its existing
  Lua value/prototype analysis rather than introducing a TypeScript type system.
- [WALA's CPA context selection](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/CPAContextSelector.java)
  keeps actual instance keys in call contexts. Here, specialization is limited
  to formal parameters that determine indexed writes.
- [TypeScript's retained language-service program](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/services.ts)
  checks project/file versions, reuses documents and supplies `oldProgram` to
  the next program build. This is not a promise that every old semantic answer
  remains valid after an edit.

## Ownership and changes

| Owner | Responsibility |
| --- | --- |
| `assignment_values.ts` | Refine stored RHS values using the last local assignment in the current basic block. Simultaneous assignments read all old inputs before updating bindings. Calls, branches/loops and captured mutations preserve conservative values. Functions without assignments to local bindings need no extra AST traversal. |
| `FunctionSummaryStore` / `SemanticTermStore` | Keep stable allocation/literal/abstract-value identities distinct from mutable source bindings and access paths. The binder's written facts remain unchanged. |
| `SemanticDemandIndex` | Index receiver names, parameter forwarding, indexed writers and module/global key aliases. Candidate selection alone cannot publish effects. Name-independent forwarding work is shared across queries. |
| `SemanticCallGraph` | Bind key-producing actual origins separately, retain callsite contexts and wait for proven callees. Producer activation uses the existing dependency-aware query lifetime. |
| `SemanticInstantiationQuery` | Propagate metatable/prototype associations along forward value assignments, including constructor results. |
| `SemanticMemberQuery` | Read matched storage's RHS values without interpreting its key again. Retain symbolic storage matches for field writes even without a known allocation. Follow prototypes of resolved objects; shared storage aliases do not make siblings into the same receiver. |
| `LuaSemanticQueryStore.allMembers` | Discover receiver-specific candidate names, demand them together, and retain the complete answer through the common dependency lifecycle. |

An indexed read previously added another indexed location as a value and then
evaluated that location's broader key. A shared bucket could consequently expose
other buckets. The explicit read-to-storage relation now supplies location
witnesses without introducing that false forward value edge. This matters for
both stored objects and `store[key].field = value` on symbolic external storage.

This remains a may-analysis. Argument lanes that are not key-producing retain
their symbolic contexts; control-flow predicates and arbitrary relationships
between several arguments are not solved as path constraints. Conservative
extra fields can remain. There are no cart names, lifecycle-name exceptions,
query caps or runtime heap lookups in the implementation.

## Evidence and latency

`semantic_keyed_shapes.test.ts` covers eight combinations of direct/bucketed
storage, inheritance chains and shared allocation bodies; module/global IDs;
straight-line, simultaneous, parameter, branch and captured assignments; symbolic indexed
field writes; numeric computed keys; sibling prototypes; and returned callbacks.
The existing semantic suite, including inactive-function effects, recursive
parameters, source provenance and dependency invalidation, also passes.

Four separate Node processes, Intel Core Ultra 7 265KF, retained workspace,
191 Lua files / 1,218,055 UTF-16 source units / 1,690 function summaries:

| Query | Median | Range |
| --- | ---: | ---: |
| Cold component completion | 705.1 ms | 690.8–728.3 ms |
| After changing the velocity expression | 678.2 ms | 646.9–699.7 ms |
| After adding an unrelated actor method | 620.6 ms | 587.7–651.0 ms |
| Repeating the same query unchanged | 0.001–0.003 ms | warm lookup only |

Cold/edit timing includes snapshot creation, lazy query-store construction and
completion; edit rows also include binding the changed file. Initial binding
of the whole corpus, UI rendering and guest execution are excluded. The warm
lookup is timed without the subsequent result assertion. Every run checks that
velocity methods are present, actor methods are absent and a warm read performs
no additional solver work. These are elapsed-time samples, not GC/allocation or
end-to-end typing latency measurements.

The cold query retains 1,542 call contexts and settles in 26 worklist waves.
**Cold/edit latency is still too high for instant interactive completion.**
The editor already retains unchanged bound files and unchanged query results.
An edit still creates a new term universe; solved inter-file facts are not yet
reused across edits. Further reuse needs explicit invalidation/retraction of
derived facts, not carrying the old monotone graph into a changed program.

The smaller existing profilers were also compared with `6236dd058`, in three
alternating baseline/current process pairs. Each process uses ten warmups and
25 samples; these rows are medians of the process medians. Parsing is retained,
but the query store is fresh for each sample. No concurrent builds/tests ran.

| Query | Baseline ms | Current ms |
| --- | ---: | ---: |
| 32 independent receivers | 1.179 | 1.083 |
| 256 independent receivers | 7.712 | 5.831 |
| 32 functions, one demanded call | 0.226 | 0.240 |
| 1024 functions, one demanded call | 2.740 | 2.530 |
| 32 methods, one demanded call | 0.121 | 0.144 |
| 1024 methods, one demanded call | 2.472 | 2.578 |
| 32 callsites, never-written parameters | 1.119 | 1.214 |
| 256 callsites, never-written parameters | 7.091 | 5.499 |
| 32 callsites, written parameters | 0.783 | 0.703 |
| 256 callsites, written parameters | 8.729 | 6.021 |

This is not a performance win on every workload: additional indices and
refinement still cost roughly 0.01–0.11 ms in the regressing rows. Avoiding an
unnecessary AST traversal in functions without local assignments removed a
larger intermediate regression. Artifacts and exact baseline are retained in
`.bmsx/authoring/nemesis-user-session/performance/`.

Reproduce from the repository root:

```sh
npx tsx --tsconfig tsconfig.base.json --import ./tests/lua/test_setup.ts \
  tests/conformance/lua_source/profile_component_completion.ts
```

Actual headless Studio verification used the UI-authored Bouncer cart:
Ctrl+Space after replacing the method with `set_v` offered
`set_velocity_pixels_per_second`; Tab accepted it and Save retained the restored
call. Ctrl+click navigated to the velocity component definition. Input requests
and screenshots are in `.bmsx/authoring/nemesis-user-session/`, with the full
authoring/playback evidence in `VALIDATION.md`. This is not a browser or native
host runtime claim.

Validation: 1,895 Lua tests passed, one pre-existing skip, zero failures;
toolchain Lua and Studio TypeScript checks; Node headless tooling build; strict
architecture audit (zero issues); and `git diff --check`.
