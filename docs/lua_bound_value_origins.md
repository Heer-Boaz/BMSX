# Bound value origins: syntax identity, not encoded source coordinates

2026-09-11, baseline `b3a98cbc9`. This is part of B04, not permission to broaden
the Behavior Lens recognizer or claim exclusive/correlated source results.

## Reference and live owner, before implementation

TypeScript's [`getNodeId` and `getNodeLinks`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/checker.ts#L1450-L1456)
identify actual syntax nodes, while checker links belong to their checker.
Its [`DocumentRegistry`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/services/documentRegistry.ts#L315-L340)
shares immutable source versions, not solved answers across different programs.
Those ownership boundaries are applicable here; TypeScript's mutable AST links
and entire checker are not being copied.

BMSX's binder currently manufactures `table:file|line|column`,
`expression:file|line|column`, `module-table:module` and nested receiver strings.
The query store re-hashes those keys; reconstructing a source occurrence from
one would lose the actual AST/snapshot owner. The binder can instead retain the
source object when it first creates the bound value. Unchanged file analyses
already survive workspace edits by identity.

## Representation and lifetime

- A bound owned root has an opaque numeric identity and its actual `LuaExpression`.
  Its role distinguishes the expression value from a function's implicit receiver.
  An implicit receiver is not a second written expression or runtime object.
- The binder interns expression values per actual AST node and publishes this
  immutable map with `FileSemanticData`. Repeated requests reuse the bound source;
  no process-global AST cache or source-coordinate decoder is needed.
- Root IDs are language-analysis identities, not guest words, compiler prototype
  IDs, persistent editor bookmarks or cross-snapshot solved terms. Rebinding a
  file creates new owned identities; retained unchanged file data reuses its own.
- Module export unions still belong to `WorkspaceValueIdentityIndex`. A returned
  table keeps its real constructor syntax rather than a synthetic module-table
  key. A module alias and a constructor are not the same source occurrence.
- Function-local ownership consumes those bound sources directly. Method receiver
  identity stays separate from closure identity and explicit source parameters.
- Value unioning remains value unioning. Equal literal values can still merge;
  this change does not yet preserve every written literal/assignment contribution,
  separate hypothetical call effects or establish mutation applicability.

No TS/C++ runtime edit is involved. Hot construction consumers are the file
binder, `WorkspaceValueIdentityIndex`, `SemanticTermStore.compileRoot` and
`FunctionSummaryStore` local-owner indexing. Measure both binding and querying;
an extra syntax map must not be described as a free performance optimization.

`SemanticTermStore` retains the compiled term for each raw root, using the
snapshot-local dense root index. Parameter/local ownership and identity unions
are immutable at this boundary, so their maps and classification need not be
revisited on every reference. This is not a source-object cache or a memo copied
to another workspace generation. Distinct raw roots which union to one value
still contribute their own flags when first compiled. A numeric literal compiled
after its const declaration must mark that canonical value numeric, just as a
string literal already did; the old order-dependent numeric omission is fixed.

## Required evidence

Independent repeated-expression, same-coordinate/different-snapshot, module
export, closure/implicit receiver and unchanged-file-sharing tests. Existing
generic semantic and compiled BLua oracles remain required. Paired real-workspace
and synthetic construction/query measurements must retain the same targets and
report regressions rather than hiding them with a feature cache.

## Measurements

Four alternating isolated baseline/current process pairs, Node 22.23.1 on
Core Ultra 7 265KF, using the existing conformance profilers and identical
bundling. Baseline substitutes `b3a98cbc9`'s four changed language owners.
Figures are medians of the four process results (synthetic results themselves
use repeated samples), in milliseconds:

| Surface | Before | After |
| --- | ---: | ---: |
| Real workspace cold symbol query | 233.696 | 228.744 |
| Real workspace initial parse + binding | 259.988 | 270.343 |
| Edited-file binding over the profiler's retained parses | 5.188 | 3.931 |
| Bind 1,024 ordinary functions | 4.985 | 4.979 |
| Bind 1,024 methods | 3.928 | 3.537 |
| Summaries, 1,024 functions | 0.597 | 0.564 |
| Summaries, 1,024 methods | 0.620 | 0.586 |
| First query, 1,024 methods | 2.552 | 2.674 |
| All 256 uncalled receiver queries | 7.829 | 8.225 |
| 256 callsites, unwritten parameters | 7.115 | 7.264 |
| 256 callsites, written parameters | 8.371 | 8.463 |
| Recursive inputs, 64 links | 12.033 | 12.039 |

The real corpus remains 191 files / 1,217,268 bytes, 1,690 summaries and 303
instantiations, with the same source target. Call work is 833 rather than 843
evaluations; value evaluations are 2,580 rather than 2,581. Other reported query
counts are unchanged. Query ranges overlap (228.922–236.783 vs
220.126–235.379 ms), so this is not a substantial workspace latency improvement.
Process peak RSS medians are 302.8 / 301.6 MiB, not retained heap measurements.

Several synthetic queries and initial workspace binding cost more, while method
binding improves. The first origin-only experiment also regressed the receiver
workload; snapshot-owned raw-root interning removes repeated ownership lookups,
but does not make every workload faster. These costs remain visible. No feature
cache, removed alias propagation, timeout or claim that B04's latency gate is
closed accompanies this representation correction.

Artifacts and the paired bundling script are in `/tmp/bmsx-source-context/`.
The existing reproducible harnesses are `tests/conformance/lua_source/profile_*`
and `scripts/dev/profile_lua_semantics.ts`. None of these numbers measures a
complete host frame, GPU, gameplay or an SNES-mini.

## Validation

- Five independent origin/root tests pass, covering actual constructor/call
  syntax, implicit receiver versus closure, retained parser nodes in a fresh
  bind, changed imports with an unchanged consumer and late literal flags.
- Full Lua suite: 1,434 passed, one existing skip, zero failures. This includes
  the existing compiled BLua function/receiver/capture oracles, not only map tests.
- IDE typecheck, debug Studio build, strict architecture audit (zero issues),
  core parity, indentation and diff checks pass. Tests-project typecheck has
  exactly the same 51 baseline diagnostics; it is not clean.
- Actual Studio workflows and Pietious navigation pass on software, WebGL2 and
  WebGPU, including hidden source refresh, source/history, autosave, zoomed
  graph edits and normal Save/Hot Resume. No extra test-only renderer or Lua
  evaluator is used.

The stronger source query and B03/B06 authoring remain open. This slice removes
encoded owned-source identity, not the remaining value/source/context distinction.

## Follow-through: literal payloads, before implementation

The next producer boundary is the literal root. It currently discards the typed
`SemanticLiteralValue` and consumers identify its kind by inspecting the encoded
key prefix. TypeScript's
[`createLiteralType`, `getStringLiteralType`, `getNumberLiteralType`](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/checker.ts#L20211-L20251)
instead retain kind/value and intern the primitive value in the checker.

BMSX will retain that existing discriminated payload directly. The identity
index can key literals by their string/number/boolean values without converting
them to strings; the term owner consumes `literal.kind`. The existing central
source-key encoding remains only where a binder path key is requested,
not as the stored literal representation and never with a Lens-local decoder.
Source equality compares typed scalar payloads with the same value identity as
the map (including equal NaNs and sign-insensitive zero), without allocating keys.
This still describes a value, not the written occurrence of every equal literal.

### Literal follow-through evidence

Four alternating isolated process pairs against `52037b2cf`, with the same
Node/hardware/harnesses as above. Medians in milliseconds:

| Surface | Before | After |
| --- | ---: | ---: |
| Real workspace cold symbol query | 227.124 | 230.087 |
| Real workspace initial parse + binding | 261.773 | 260.736 |
| Edited-file binding | 5.282 | 4.145 |
| Bind 1,024 ordinary functions | 4.934 | 4.829 |
| Bind 1,024 methods | 3.574 | 3.423 |
| Summaries, 1,024 ordinary functions | 0.572 | 0.544 |
| First query, 1,024 methods | 2.689 | 2.641 |
| All 256 uncalled receiver queries | 8.100 | 7.727 |
| 256 callsites, unwritten / written parameter | 7.129 / 8.326 | 7.146 / 8.410 |
| Recursive inputs, 64 links | 12.085 | 11.772 |

The real query ranges overlap (226.132–232.918 / 226.167–232.983 ms).
Every reported query-work count and target is unchanged; peak process RSS
medians are 296.3 / 294.6 MiB. This is a representation correction, **not** a
claimed workspace latency win. The remaining cold-query cost and the small
parameter-workload regressions are not hidden by a timeout or feature cache.

The sixth independent test exercises typed literal payload retention, distinct
primitive identities, signed zero and representable non-finite constants.
Full Lua suite: 1,435 passed, one existing skip. IDE typecheck, debug Studio
build, strict architecture audit, core parity, indentation and diff checks pass;
the tests-project typecheck retains exactly the same 51 baseline diagnostics.
Actual full Studio workflows and Pietious source/navigation workflows pass on
software, WebGL2 and WebGPU separately. This guards the current UI; it does not
claim the still-open B04 query or B03/B06 authoring has been delivered.
Artifacts: `/tmp/bmsx-literal-values/`.
