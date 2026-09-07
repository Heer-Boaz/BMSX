# Lua capture identity

## Boundary and scope

Scene field removal exposed a Hot Resume dependency: removing the title member
from `nemesis_s/scenes/root.lua` eliminates one capture in `root_scene.register`.
Compacting the fresh closure would make its director slot read the old title
cell. The existing rejection is necessary. This slice supplies compiler-owned
capture provenance; it does **not** yet preserve closure layouts across edits or
publish the Scene Editor Remove action.

## Production reference

Roslyn's [closure analysis](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Compilers/CSharp/Portable/Lowering/ClosureConversion/ClosureConversion.Analysis.cs)
associates captures with bound variables and their defining closure scope.
Its [Edit and Continue slot allocator](https://github.com/dotnet/roslyn/blob/ca7d6c1a040cda9fecd1ffe3720fb971251ace67/src/Compilers/Core/Portable/Emit/EditAndContinue/EncVariableSlotAllocator.cs)
uses syntax correspondence and closure identity before reusing a previous slot.
BMSX adopts the separation of declaration identity, capture slot and physical
storage, not CLR display classes or runtime-throwing rude-edit methods.

Dart's [hot reload design](https://github.com/dart-lang/sdk/blob/main/runtime/docs/hot-reload.md)
keeps existing closures attached to old functions. That is not the desired BMSX
semantics and is not an escape route around the current rejection.

## Representation contract

| Owner | TypeScript | C++ | Meaning |
| --- | --- | --- | --- |
| Compiler/debug symbols | `capturedLocals: CapturedLocalDebug[]` / `Blua32CapturedLocalDebug[]` | `vector<Blua32CapturedLocalDebug>` in tooling symbols | One source record per captured declaration: defining `functionId`, `name`, `definition`, `scope`. No register or heap address. |
| Compiler | `upvalueBindingsByProto: readonly number[][]` | No native compiler | Each closure slot references the compilation's captured-local table. Transit captures retain the ultimate defining declaration. |
| Linked debug symbols | `upvalueBindingsByFunction: readonly number[][]` | `vector<vector<u32>>` | Linker-owned indices into the linked captured-local table, **not** durable cross-revision IDs. |
| Function record | `UpvalueDesc { inStack, index }` | Existing function-record upvalue descriptor | Unchanged creation route: parent register or parent closure slot. |
| CPU | Existing closure/upvalue cells | Existing closure/upvalue cells | Unchanged guest state, instruction encoding, save state and execution. |

The compiler allocates provenance only on first capture of a bound local and
shares its index through descendants. Optimization compacts bindings alongside
descriptors. Source maps transform each declaration record once. The linker
emits only referenced records and relocates current and tombstoned bindings from
their respective source tables. A tombstone keeps its original declaration even
if its defining function has been rebuilt; indexing that function's **new**
local-debug slots would alias another revision's declaration.

Symbols change version in TS and C++; there is no legacy reader. The debugger
reads names through binding indices without reconstructing a names array.
The Hot Resume guard retains the current layout checks and also rejects a
different defining function. Declaration/scope correspondence is not yet used
to admit a changed layout. Provenance is a
prerequisite for subsequent lexical correspondence and pre-lowering slot reuse,
not permission to reinterpret existing cells.

## Call sites and performance boundary

- `FunctionBuilder.declareLocal` / `resolveUpvalue`: source compilation only.
- `compactUnusedUpvalues`: compile-time optimization; no extra instruction pass.
- `mapProgramMetadataSourceRanges`: compilation with source maps only.
- `linkBlua32*` debug assembly: ROM build or explicit source rebuild only.
- TS/C++ symbols codecs: tooling media encode/decode only.
- `closureLayoutMatches`: explicit Hot Resume build only.
- Intellisense frame inspection: explicit runtime-value query; direct indexed
  lookup, no per-query capture map/array.
- CPU `CLOSURE`, `GETUP`, `SETUP`, open-cell closing, IRQ dispatch, GC and
  checkpoint capture/restore: **no changes or added metadata access**.

## Remaining gate

Slot preservation needs actual old/new lexical correspondence before lowering.
Name equality, capture discovery order and parent registers are not that
correspondence. Deleted declarations, new captures, shadowing, implicit receivers,
anonymous functions and multiple source edits must be accounted for at that owner.
The present common-prefix/suffix PC mapping is not a general syntax map and must
not be repackaged as one. No linker-only descriptor padding after optimization:
the defining value's initialization may already have been removed.

## Validation — 2026-09-08

Baseline: `bfec3ce38`. Artifacts: `/tmp/bmsx-capture-layout/`.

- `npm run test:lua`: **899 pass**, one pre-existing skip. Actual BLua execution
  accompanies capture tests: disjoint scopes, redeclarations within one scope,
  nested shared readers/writers and distinct implicit receivers. O3 compaction
  keeps provenance aligned; linking drops unreferenced capture records. Generated
  source maps preserve indices and map declaration/scope ranges to authored Lua.
- `npm run test:rompacker`: **122 pass**. Relinking distinguishes current
  declarations from tombstones in two subsequent generations, retains old
  provenance when the defining parent changes, and drops unreferenced origins.
  Capture-table renumbering does not change identity; a different defining
  function does. Actual compiled capture contraction remains rejected.
- Complete rebuilt native CTest suite: **28/28 pass**, including symbol format,
  CPU replay and libretro save-state. The real BIOS and Nemesis symbol assets
  also pass **TS encode → C++ decode/encode → TS decode**, with complete decoded
  symbol equality, not just matching field counts.
- Lua and IDE typechecks pass. The tests-project typecheck has exactly the
  baseline's **52 diagnostics**, with no added or changed diagnostic. Strict
  architecture-boundaries reports zero issues; core-parity, indentation and
  `git diff --check` pass. These checks are not the runtime proof below.
- Actual browser Studio workflows pass on **software, WebGL2 and WebGPU**:
  pause/rewind, source inspection, breakpoint/fault repair, Hot Resume, source
  save, AEM save and existing scene-position editing/cold instantiation. All
  three final screenshots are byte-identical to the baseline; the software
  screenshot was inspected. Expected negative-workflow diagnostics still appear
  in the test log. This is not a Remove-action pass or exhaustive workflow proof.
- Recompiling all **179 actual Nemesis modules**, including generated modules,
  reproduces the remaining gate: removing lines 30–37 of `scenes/root` still
  shrinks `root_scene.register` from six captures to five. Each remaining slot
  now carries its actual defining module/local rather than just a spelling.

### Cost boundary

Rebuilt BIOS and Nemesis executable images are byte-for-byte identical to the
baseline: **294,780** and **634,580 bytes** respectively. All pre-existing debug
metadata other than the replaced capture-name representation is also equal.
No CPU instruction, function creation descriptor, cartlib code or emulated
datapath was changed.

| Debug-symbol payload | Before | After | Captured declarations / closure slots |
| --- | ---: | ---: | ---: |
| BIOS | 2,683,850 B | 2,718,548 B | 347 / 750 |
| Nemesis | 10,826,332 B | 11,102,830 B | 1,867 / 3,450 |

These are **tooling symbol costs**, not guest heap objects. Debug ROM size grows
by 34,696 B and 276,500 B including package alignment. There is no old-symbol
compatibility path; debug media must be rebuilt with the version-5 toolchain.

Node 22.23.1, O3 compilation of the same 179 modules from retained parses,
three warm-ups and seven forced-GC samples per implementation: median compile
time **1,137.72 → 1,128.22 ms**; median retained compiled-result heap
**17,484,896 → 17,568,872 B** (+83,976 B). The timing difference is not a speedup
claim. It shows no material regression in this targeted sample; it is not a
33 MHz guest benchmark, a whole-build peak-memory bound or a native memory
measurement.
