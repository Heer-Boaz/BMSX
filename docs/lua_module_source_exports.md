# Module source exports

Starting at `7a3681262`; this extends written-source tracking, not the runtime
loader or the executable module ABI.

## Owner and reference

[TypeScript's export-assignment binder](https://github.com/microsoft/TypeScript/blob/c63de15a992d37f0d6cec03ac7631872838602cb/src/compiler/binder.ts#L3135-L3156)
retains the actual export declaration. The applicable BMSX export syntax comes
from the live `compiler/passes/module_contract.ts`: one expression in the final
top-level return. The compiler's selector and the semantic producer must agree;
an earlier or nested return is not silently a second export declaration.

This is deliberately not a transcription of
[Lua's runtime require](https://github.com/lua/lua/blob/v5.4.8/loadlib.c#L648-L676).
BMSX also has compile-time module/static-function bindings and dynamic export
slots. The previous CPU proof already showed that an early return can bypass a
dynamic export-slot store. Returning a table from that early return does not
publish that table to an importer.

## Source-query contract

- A shared module-syntax selector feeds the compiler and binder. The binder
  retains the canonical return statement next to its existing source value.
- Other written returns in module evaluation are retained separately from
  returns in function bodies. They are publication-control evidence, not more
  exported values. The query must not treat their expressions as module exports.
- A module source edge may follow the written canonical export to its own file.
  A possible bypass remains an explicit publication boundary alongside that
  source. This is a written-source graph, not a reaching-definition analysis or
  a claim about the configured static/runtime module binding.
- Unresolved imports and modules without a canonical written export stay source
  boundaries. Do not manufacture a constructor or copy standard Lua's nil/true
  loader policy into the source query.
- No per-query workspace parse/alias scan. Module exports are indexed once on
  first demand for the immutable snapshot; negative answers die with that snapshot.

Independent tests must cover direct and aliased exports, reexports, factories,
missing and newly-added modules, non-export returns, bypasses and source-owner
identity. CPU tests use the actual BMSX compiler at O0/O3, not a host evaluator.
The stronger module/callee proof and B03/B06 authoring remain open.

## Evidence

The six new independent written-source tests fail against `7a3681262` while its
original fifteen still pass. They pass with the new owner; the full Lua suite
has **1,494 pass, one existing skip, zero failures**. The module CPU test confirms
the actual unshaped/early-return/nil behavior at O0/O3. All 123 ROM-packer tests,
the toolchain build and IDE typecheck pass. The tests project still has exactly
the same 51 baseline diagnostics, not a clean typecheck. Boundary/parity/indent
audits pass.

Four alternating isolated baseline/current process pairs, Node v22.23.1 on
Core Ultra 7 265KF; all five changed existing language owners substituted in
baseline bundles. Same real 191 files / 1,217,268 bytes and target as the preceding
slice, with no concurrent builds or browser probes:

| Boundary | Baseline | Current |
| --- | ---: | ---: |
| Cold workspace symbol query | 265.617 ms | 266.666 ms |
| Initial bind | 269.071 ms | 262.974 ms |
| Edited-file bind | 4.874 ms | 4.582 ms |

Cold query ranges overlap (256.299–278.103 / 254.724–278.250 ms); every reported
solver work count is unchanged. This is no broad latency improvement claim.
The independent module-chain probe includes a fresh source-query owner and its
module index over retained binder facts: 1/64/256/1,024 links take median
0.002/0.027/0.062/0.189 ms in one process. Repeated expression+trace lookup is
about 0.008 microseconds, measured in 10,000-lookup batches. It does not activate
the may-call engine, measure a full UI operation or prove lower-end performance.
Artifacts are in `/tmp/bmsx-module-sources/`.

The forced browser-Studio build and actual Studio plus Pietious Source/navigation
workflows pass on software, WebGL2 and WebGPU, including their uncaught-error
gates. These are regression proofs for existing Source/Undo/Hot Resume routes,
not a claim that an imported-origin authoring UI is already implemented.
