# Lua indexed-access value ownership

## Reproduction and owner before the edit

The physical Command Palette → Behavior Lens → `moon_death_ray` → expanding
timeline → Source route opens `enemies/moon_death_ray.lua:79:6` correctly. The
following idle parameter-hint request resolves the enclosing `fsm_library.register`
call and stalls inside `SemanticMemberQuery`, not inside the lens or renderer.
Inspector captures show alternating `collectAlternatives` /
`collectLocationAlternatives` calls while constructing new index terms.

The smaller, cart-independent counterexample is a pair of reciprocal maps:
`forward[first] = second; reverse[second] = first`. Resolving `objects[first]`
must evaluate the key's value. Instead, the query walked reverse storage
aliases of `first`, treating `reverse[second]` as a new key to expand, then
`reverse[forward[first]]`, and so on. A finite authored graph became an
unbounded family of manufactured access paths. The regression fails with a
stack overflow before the fix; the full workspace consumes sustained CPU.

## Representation contract

The indexed object may need location aliases to find writes to shared storage.
The index operand is a **value query**, not a location-equivalence query. Its
forward value alternatives are compared with the existing forward alternatives
of stored keys. Reciprocal references between tables do not equate their keys
or require enumerating every spelling that could produce the same value.

TypeScript's production checker keeps the indexed object and index value/type
separate in [`getIndexedAccessTypeOrUndefined`](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/checker.ts#L19589-L19654)
and consumes the index in [`getPropertyTypeForIndexType`](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/checker.ts#L19173-L19200).
BMSX retains its own Lua terms, table-key identities and query-store facts; it
does not copy TypeScript's type lattice, compatibility modes or error fallbacks.

The fix belongs in `SemanticMemberQuery`'s `TermKind.Index` datapath: consume
`collectAlternatives(key)` rather than `collectLocationAlternatives(key)`.
No signature-help suppression, query/depth/time limit, catch-and-empty result,
special cart name, new worker facade or runtime heap inspection. Existing
interned terms, revisions and scratch arrays retain their owners; no additional
allocation is introduced. The CPU, C++ machine and cartlib are unaffected.

## Behavior identity

A `BehaviorSourceDocument` already contains multiple `definitions`. Each
registration has its own behavior kind, authored identity/occurrence, row keys
and exact source ranges. The document is the text-model owner, not a one-FSM
limit. The subsequent [Behavior Quick Access](behavior_quick_access.md) slice
replaces file-level admission with individual registration choices. Regression
coverage distinguishes two FSMs and identically named states in one document.

## Validation

- The reciprocal-map regression in `tests/lua/semantic_value_graph.test.ts`
  fails with `RangeError: Maximum call stack size exceeded` before the owner
  fix. Afterwards it resolves both direct and indirect keys and rejects
  members belonging to the other key; termination alone is not the assertion.
- The actual Nemesis headless route reaches `79:6`, completes subsequent idle
  frames and renders the enclosing `fsm_library.register(machine_name,
  blueprint)` parameter hint. The pre-fix process stalls after Source reveal.
- `studio_behavior_navigation.ts` runs the physical palette, picker, outline
  expansion, selection and visible Source button against the real cart. It
  checks the exact cursor, the automatically resolved signature, subsequent
  keyboard input and reopening the retained lens without advancing the paused
  machine. The complete Studio workflow suite passes on software, WebGL2 and
  WebGPU; it does not select or mock a backend in this regression.
- Dedicated lens and registration-index tests distinguish `player` and `enemy`
  FSMs in one source, including repeated state names, separate source ranges
  and retained per-id lookup results. No additional cartlib schema is needed.
- `test:lua`: 967 passed, one pre-existing skipped test; `test:rompacker`: 122
  passed. IDE typecheck, strict architecture-boundary audit, core-parity audit,
  indentation check and `git diff --check` pass. The tests-project typecheck
  retains its 52 baseline diagnostics with no new diagnostics.
- Node headless tooling and browser Studio debug products were rebuilt.

This proves the reported navigation/query regression and the tested key
identities. It is not a claim of universal semantic termination or latency.
