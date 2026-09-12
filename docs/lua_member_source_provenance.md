# Named member source provenance

2026-09-12; starting at `2bdca2655`. Contract and implementation evidence for
the next B04 source boundary. This does not admit broader BT/FSM/ActionEffect
writes.

## Production references and live evidence

- [WALA field flow edges](https://github.com/wala/WALA/blob/f58f4d0893a9a022c4aa4f980b751e3159c42c13/core/src/main/java/com/ibm/wala/demandpa/flowgraph/DemandPointerFlowGraph.java#L234-L300)
  retain the field operation, base and RHS in their analysis context. A field
  name alone does not identify the storage/value flow. Its aggregate array
  modelling is not evidence of a unique editable Lua array element.
- [Roslyn ValueTracker](https://github.com/dotnet/roslyn/blob/0c14b7cb5e382318c4322e29e045f48b11c641ca/src/Features/Core/Portable/ValueTracking/ValueTracker.cs#L75-L154)
  follows actual declarations and assignments through bound symbols and source
  operations. Navigation to one declaration is not equivalent to reconstructing
  every value origin from that declaration's display range.

The independent factory probe in `/tmp/bmsx-field-sources/probe.ts` creates two
objects from one `make(id, task)` body, then passes their `definition` fields
to a wrapper. CPU O0/O3 both prove the separate `walk`/`run` results. The baseline
source traces stop at `access-path` for both reads. There is no cartlib API,
shipped game definition, line-number oracle or host heap in that probe.

The baseline owners explain why a Lens-only lookup would be wrong:

- The binder retains individual `DeclarationValueEntry` writes, including the
  exact syntax, RHS and containing body, indexed by declaration.
- `SummaryWrite` retains only compiled base/name/value/declaration; equal RHS
  values can collapse during summary construction.
- `WriteSet` retains contextual value terms but not the original source write
  and its writer frame. A frame cannot in general be recovered from a literal
  RHS or a captured/global destination.
- `SemanticMemberQuery` returns member values/declarations, discarding
  the matching write rows. Looking up those declarations from the caller would
  lose a factory's writer context and turn its actual parameter into a generic
  projected parameter.

## Owner contract

1. Summary production retains the original binding-write fact, not a rebuilt
   AST range or full copied file model. Reuse the existing body/declaration
   grouping and the binder's module declaration index.
   Source occurrences with equal values remain distinguishable. Inferred shape
   members with no authored write remain explicitly without an RHS origin.
2. The instantiation owner retains both the original write and its module,
   projected-body or invocation scope when publishing named field writes. The
   source reader consumes that scope; it never infers it from host identity,
   field spelling, a returned value's shape or whichever caller is active.
3. The member query exposes the write witnesses selected by its existing
   location/prototype/value joins. No second alias solver or workspace-wide
   same-name scan in `LuaSourceValueQuery` or Behavior Lens. Ordinary navigation
   still projects declaration ids at its own output boundary.
4. Contextual source tracing follows those witnesses into the correct writer
   activation and retains the actual RHS occurrence. Read provenance is not an
   exhaustiveness certificate: unknown bases/calls and unwritten/inferred
   contributions cannot disappear because one named write was found.
5. Numeric/dynamic index reads and array-element aggregates stay explicit
   boundaries until their own source-key contract exists. Do not treat aggregate
   element values as a unique field index. This is not a hidden compatibility
   path for unsupported authoring.
6. Cache/dependency lifetime stays in the shared semantic query owners. Repeat
   traces reuse retained results; later admitted call/write facts invalidate
   the relevant result. No per-frame source scan or global-revision polling.

## Evidence required

Use the existing contextual-source fixture/CPU harness, not another copy:
two factory instances with the same field declaration, same-name unrelated
tables, module imports, captured writes, duplicate equal RHS occurrences,
unknown contributions, projected versus admitted bodies, later dependencies
and retained repeat queries. Existing member/navigation/projection semantics
must remain correct. Measure summary/query cost on the real workspace and a
fan-out fixture before claiming the representation change is acceptable.

Only after this boundary works may the source recognizer consume it. This
document and a green may-member query alone do not close B04 or cross-parent
graph editing.

## Implementation and review

| Owner | Retained representation |
| --- | --- |
| Summary production | The existing per-body declaration grouping holds original write facts. Named writes retain each RHS occurrence; value aliases still deduplicate equal terms. Module facts use the binder's declaration index and exclude body writes. |
| Instantiation | `WriteSet` adds source-fact and frame columns. Deduplication includes both; a literal or captured destination does not erase its writer. Frame representation remains module `0`, projection `-summary`, invocation `>0`. |
| Member solver | Its existing retained declaration-result column becomes matched write-row ids. All existing location/prototype joins populate it; navigation converts rows to declaration ids at output. No second join or extra per-read provenance array. |
| Written-source query | A declaration write is interned once, whether reached through a binding or a field. A named read retains a source-anchored base with the final member step removed, not a fabricated AST. Literal string keys already arrive as named steps from the binder. |
| Contextual source query | Member edges point to original writes in their writer activation. Each read retains its own base, name and known origins. Base tracing remains separate from result tracing, like the existing callee/return separation. |

The source query uses the same call/effect demand owners and tracked member
joins as ordinary queries. Inferred rows without an authored RHS and empty
write joins report `unwritten-member`. A projected source write is not relabelled
as an admitted invocation. An unknown replacement remains a call-result
boundary; unknown base contributions remain inspectable through the read's
base. These are explicit analysis boundaries, not runtime fallbacks.

Review caught an unnecessary cross-body lookup in the first draft: looking up
all writes to a declaration and filtering by body for each summary can repeat
work when many bodies write the same field. The final producer instead retains
original facts in its existing body-local grouping. No second index or copied
file model is needed. The existing function-source profiler's `--shared-field`
mode covers 32/1,024 bodies writing one shared field.

New nested field demands can invalidate an earlier read of the same factory
base. The shared contextual profiler now includes demand and subsequent answer
capture in its cold timing; retained timing begins after those demands. The
warm batches assert unchanged semantic and source evaluation counts. This is
not a retry or warmup loop in Studio, nor a claim that requesting new facts
never invalidates an earlier answer.

Only TypeScript language tooling changes. No compiler lowering, guest ABI,
machine state, cartlib API or mirrored C++ hot path is changed. The recognizer
still has its own integration/completeness gate; this slice does not silently
enable cross-parent editing from a may-value answer.

## Validation

The factory-read regression fails on the baseline with no literal origin for
`left.id`; the implementation finds the actual caller's `left`/`right` and
`walk`/`run` separately, including nested `definition.task`. Independent fixtures
also cover unrelated same-name fields, duplicate equal writes, imported
providers, captured storage, projected bodies, prototype method provenance,
unknown bases/replacements, later admitted writers and retained warm queries.
The factory, duplicate-write and captured-storage fixtures run on the actual
CPU at O0/O3. Prototype provenance is a semantic query test; the bare CPU
harness does not install BIOS boot primitives. No replacement metatable
implementation or new copy of the system boot harness was added for it.

- Full Lua suite: **1,659 passed, one existing skip, zero failures**.
- Toolchain and IDE TypeScript pass. The tests project retains exactly its
  **51 baseline diagnostics**, comparing complete diagnostic blocks after
  normalizing locations; it is not a clean typecheck.
- Strict architecture audit, core parity and indentation pass.
- Fresh browser Studio build; full Studio and Pietious Source/navigation gates
  pass on software, WebGL2 and WebGPU. All six end captures are byte-identical
  to the preceding slice; Studio and navigation captures were inspected. This
  is regression coverage, not broader recognizer or cross-parent-edit proof.
- `git diff --check` passes. The string-prefix color/casing report and harness
  review remain separately open in `behavior_authoring_ux_review.md`.

### Performance

Three alternating isolated process pairs against `2bdca2655`, Node 22.23.1,
Core Ultra 7 265KF/WSL; no simultaneous test/build/browser workload. The final
source-query runs separately follow the review that removed an empty call-solver
drain from non-member traces. Both versions use the same profiler fixture.

| Boundary | Baseline median | Current median |
| --- | ---: | ---: |
| Real 191-file / 1,217,268-byte workspace: `player/player.lua:1179:9` | 254.966 ms | 258.992 ms |
| 256 ordinary parameter/member queries | 7.553 ms | 7.478 ms |
| 256 written-parameter/member queries | 10.006 ms | 9.379 ms |
| 1,024 bodies writing one field: identities/summaries | 0.894 ms | 0.872 ms |
| 1,024 methods writing one field: identities/summaries | 0.797 ms | 0.900 ms |
| 1,024 bodies writing one field: fresh workspace and first member query | 3.193 ms | 3.723 ms |
| 1,024 methods writing one field: fresh workspace and first member query | 2.868 ms | 3.323 ms |
| 1,024 source contexts, both lanes through ordinary aliases/returns | 33.239 ms | 34.023 ms |

Some cases are slower. Real-workspace ranges overlap (251.819–281.607 versus
257.883–274.178 ms); all semantic work counts remain identical: 1,690 summaries,
319 frames, 955 call / 2,719 value / 1,339 member evaluations. Median process
wall time is 0.74 versus 0.73 s and peak RSS 330,496 versus 322,868 KiB. These
are not allocation measurements, a claimed speedup, or closure of the roughly
259 ms cold-query latency gate.

The new named-field query has no equivalent successful baseline operation.
For 1/64/256/1,024 factory callers, discovery and both argument traces take
0.357/3.013/19.074/98.229 ms cold over retained binder facts. Retained point-plus-
trace reads take 0.022–0.047 microseconds in 10,000-read batches, with no new
semantic/source evaluations. This deliberately measures all caller contexts,
not just a single convenient origin; it is not an end-to-end Studio, slower-
hardware or per-frame performance claim.

Artifacts: `/tmp/bmsx-field-sources/`; final general profiles in `paired/`, final
source queries in `source-query-final/`. Earlier drafts, failed probes and
setup failures are retained separately rather than counted as passing evidence.
