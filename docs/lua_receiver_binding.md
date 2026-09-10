# Lua receiver binding: one lexical read/write route

2026-09-10, baseline `157d8027f`. Follow-through on the
[parameter-context correction](lua_parameter_context.md), within B04.

## Reproduced error and production references

```lua
local original = { initial = 11 }
local replacement = { updated = 22 }
function original:change()
    self = replacement
    return self
end
local result = original:change()
```

The binder resolved the write as a global declaration and the read as an
implicit receiver. This was not just an IDE query error: ordinary BLua
compilation at O0 and O3 left `result` pointing to `original` and wrote the
replacement to global `self` instead.

Lua's production parser inserts
[`self` as a local before the explicit parameters](https://github.com/lua/lua/blob/v5.4.8/lparser.c#L992-L1008).
Its [`singlevaraux` lookup](https://github.com/lua/lua/blob/v5.4.8/lparser.c#L435-L474)
finds locals/upvalues by lexical scope, for both expression and assignment
uses. BMSX follows that binding rule, without fabricating a written parameter
token or source declaration for an implicit parameter.

WALA likewise uses the same lexical storage key for
[reads and writes](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/cast/src/main/java/com/ibm/wala/cast/ipa/callgraph/AstSSAPropagationCallGraphBuilder.java#L384-L434).
Its [dispatch operator](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/SSAPropagationCallGraphBuilder.java#L1715-L1797)
processes actual receiver/argument points-to contributions rather than treating
the spelling of a method as a call edge. The applicable distinction is binding,
value and dispatch, not transplanting WALA's Java IR into the Lua binder.

## Owning representations

| Owner | Contract |
| --- | --- |
| Builder scope | Its binding map holds the currently active declaration or implicit receiver per name. It does not allocate unused per-name stacks; historical source bindings remain in declaration facts and positional scope indices. The receiver retains the existing body-owned value source, with no fake `Decl` or syntax range. |
| Method entry | Insert the implicit binding first, then explicit parameters. Ordinary locals, parameters, nested methods and closures obey the same scope walk. |
| Identifier binding | Reads, assignment targets, single-name function definitions and function-name prefixes use one producer. There is no read-only `self` exception beside a global-write route. |
| `Ref.binding` | Retains the identifier's storage source, independently of the optional written declaration/navigation target. Declaration sources are retained once per declaration rather than recreated for each read. |
| Summary | Binding-write references classify both named and implicit parameters. A written receiver has an ordinary local binding initialized from its immutable entry value; an unmodeled RHS still counts as a write. |
| Scope queries | `implicitSelfValue` belongs to the declaring method only. Lookup follows lexical shadowing instead of returning an inherited cached receiver value. |
| Prototype query | Match an owner once and consume its existing `TermRelation` adjacency list, rather than repeating the same location walk for each outgoing prototype edge. No new cache or truncated search. |
| Compiler / Hot Resume | Existing `implicit_self` references, receiver locals, captured cells and capture-layout correspondence consume the corrected binding. No new register representation, runtime metadata, cell migration or compatibility path. |

The three receiver/path/scope stacks and the second identifier-write resolver
are removed. Source annotation ranges still refer to actual written uses.
Updating a function signature does not invent a declaration for a function
assigned to the implicit binding.

## Method dispatch and demand planning

The old binder also replaced `self:method()` with the original method-owner
path and could publish that path's declaration as a direct target, including a
post-binding namesake lookup. Rebinding `self`, or calling the method with a
different explicit receiver, invalidates that assumption. Those paths are
removed; the existing value/summary query resolves method receivers instead.

Removing that shortcut exposed a selector limitation: effect-call relevance
could propagate through one unresolved receiver call, but would not propagate
its name to another such hop. Thus a real `outer -> relay -> write -> _write`
chain stopped before its field write. The demand owner's existing fixed point
now closes candidate relevance transitively, using one name set instead of
separate selectable/propagating sets. Candidate selection does **not** publish
callee facts or instantiate namesake functions. Those remain query-engine
operations after callable resolution, on the actual call context.

This is not a new exclusive-callee proof. The possible-value query remains
flow-insensitive: after reassignment it can report both the entry and
replacement receiver's methods. Source authoring must not treat that set as
proof of exact runtime control flow. The broader hypothetical-composition
boundary documented in B04 remains open.

## Measured prototype-query correction

The first implementation passed functional gates but increased the real Nemesis
symbol query from **229.1 to 333.8 ms** in four paired processes. CPU profiles
located most of the extra work in repeated location walks below prototype
lookup, not the candidate-name fixed point. The queried relation contained
215 edges but only 72 distinct owners. Looking up every edge separately walked
the same owner's alternatives again for each target.

The member-query owner now uses the relation's existing first/next adjacency
index: match each distinct owner once, then collect all its targets. This applies
the per-receiver lookup distinction illustrated by
[WALA's instance-field constraints](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/ipa/callgraph/propagation/SSAPropagationCallGraphBuilder.java#L967-L982).
It does not add a cache over recursively growing location results, remove
prototype contributions, or restore the incorrect binder target shortcut.

## Independent validation

`semantic_receiver_binding.test.ts` covers read/write identity, global and
outer-local shadowing, explicit `self` parameters, delayed local visibility,
nested methods, closures that outlive their method, unmodeled writes,
single-name function replacement, member definitions and dispatch after
replacement, including inherited methods from multiple possible receivers.
Both query orders are exercised for receiver/member isolation.
Forwarding tests use 1/4/8 receiver-dependent hops and verify that observed but
non-writing namesakes and uncalled objects stay unmodified. The runtime
fixtures compile and execute ordinary BLua at O0 and O3; no cart source,
mock cartlib API or host-side Lua interpreter is the expected-result oracle.

`capture_retention.test.ts` additionally creates real reader/writer closures,
rebinds their shared receiver, installs an edited writer through the existing
Hot Resume revision proof and verifies both the retained value and subsequent
writes from the new body. The receiver cell is not recreated.

Validation on Node `v22.23.1`:

- `npm run test:lua`: **1,330 passed, one existing skip, zero failures**.
- Toolchain Lua and IDE `tsc --noEmit`: passed. The tests project's **51
  pre-existing diagnostics** match the baseline by file/code/message and
  multiplicity; that project is not claimed typecheck-clean.
- Strict architecture-boundary audit: zero issues; core-parity and indentation
  checks: passed. Browser Studio, headless tooling, BIOS, Nemesis and Pietious
  debug builds: passed.
- Actual browser `--studio` workflows and `--studio-navigation pietious`:
  **passed on software, WebGL2 and WebGPU**, including Source, Undo, Save,
  Hot Resume and existing fault/recovery gates. These are regression checks,
  not completion of B04 or the requested visual redesign.
- `git diff --check`: passed.

The Scene Editor browser gate also exposed an incorrect test barrier: checking
runtime idleness before waiting for the Save prompt could accept the queue's
initial idle state. It now waits for prompt completion and runtime/guest-init
completion together. The installed-source assertion is unchanged; no extra
sleep, relaxed assertion or runtime fallback was introduced.

### Comparative cost

Four paired processes, alternating baseline/current order, used identical
esbuild bundles except for the five changed semantic-owner files. No browser
or test suite ran concurrently. Synthetic timings are medians of four process
medians, each using 10 warmups and 25 samples. Binder timing retains the parse;
summary timing reconstructs identities/summaries; fresh query timing reconstructs
the workspace. These are different measured boundaries.

| Synthetic fixture / measured operation | Baseline ms | Corrected ms |
| --- | ---: | ---: |
| 1,024 explicit-parameter functions / binder | 4.921 | 5.242 |
| 1,024 implicit-receiver methods / binder | 3.880 | 4.135 |
| 1,024 functions / summaries | 0.739 | 0.630 |
| 1,024 methods / summaries | 0.765 | 0.673 |
| 1,024 functions / fresh workspace and one member query | 2.830 | 2.781 |
| 1,024 methods / fresh workspace and one member query | 2.721 | 2.847 |
| 256 forwarding callsites, read-only parameters / all result queries | 4.045 | 4.000 |
| 256 forwarding callsites, written middle parameter / all result queries | 4.023 | 4.193 |

The one-call fixtures retain one instantiated call/pass in both versions;
the 256-callsite fixtures retain 768 instantiated calls and two passes.
The larger binder/method cases are not a speedup claim. The binding model has
changed, even though it no longer retains unnecessary per-name scope arrays.

The actual Nemesis/cartlib corpus has 191 files and 1,690 summaries. The existing
`profile_lua_semantics.ts` probe resolves `self.actioneffects`:

| Four-process median | Baseline | Corrected |
| --- | ---: | ---: |
| Cold file analysis | 295.7 ms | 275.9 ms |
| First symbol resolution | 245.5 ms | 258.2 ms |
| Complete profiling process | 0.745 s | 0.735 s |
| Process maximum RSS | 288,786 KiB | 296,182 KiB |

The target is unchanged. The query's instantiated call count increases from
89 to 102; solve passes decrease from five to four. Removing repeated prototype-owner walks
avoids the large initial regression, but this first symbol query still costs
about 13 ms more. The full profiling process includes source loading and edit
probes; it is not a full IDE interaction. The field has no incoming hierarchy
groups. Maximum RSS is not retained heap or an allocation/GC measurement.
None of these figures establishes guest performance, arbitrary-query complexity
or source-completeness/exclusive-callee certainty.

## Remaining boundaries

- B04 still needs explicit hypothetical versus instantiated query contexts,
  source occurrences, unknown contributions and completeness contracts.
- The compiler prototype-id collision from the earlier function-source slice
  remains separate; no suffix-on-collision or runtime repair was introduced.
- Lens recognition and structural edit admission are unchanged. This removes
  a generic producer error; it does not complete cross-file authoring or
  authorize arbitrary graph reparenting.
