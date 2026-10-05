# Numeric and tooling ownership follow-through

## Scope

Preserve the existing GEO wire ABI. Correct its documentation and define the
arithmetic that implements it, rather than reverting the intentional f32
overlap migration (`bc3ee2d01`). Subsequent slices remove the unused IDE Lua
execution engine, retain the compiler recipe per image, and make Studio's
cartlib inspection contract explicit. None adds guest instrumentation.

## Numerical representation and hot paths (before implementation)

| Owner | TypeScript | C++ | Observable representation |
|---|---|---|---|
| GEO overlap records | raw u32, f32 decoded to Number | raw u32, float widened to double | binary32 bounds, vertices, translation, contacts |
| GEO SAT2 records | signed words decoded to Number | signed words widened to double | Q16.16 vertices, normal and depth |
| GEO XFORM2 | integer word arithmetic | i64 multiply/accumulate | signed integer coordinates and Q16.16 matrix |
| BLua POW | Number | double in a Value | binary64 number |
| Compiler folding | Number | not a native compiler responsibility | the same BLua numeric semantics |

GEO arithmetic hot callsites, mirrored in `machine/{ts,cpp}/machine/devices/geometry`:
`GeometryOverlap2dUnit.processPair`, `readPieceBounds`, `loadPolyView`,
`computePolyPairContact`, `projectPolyInto`, `computePolyAverageInto`,
`clipConvexPolygons`, `clipPlaneDistance`, `computeClipAverageInto`,
`readWorldVertexInto`, `writeResult`; `GeometrySat2Unit.processRecord`,
`projectVertexSpanInto`, `writeResult`. Controller admission and scheduling
continue to consume raw register words and are not changed.

POW hot callsites are the TS CPU `executeInstruction` POW dispatch and
C++ `cpu_dispatch.inl` POW dispatch. Cold evaluation also occurs in
`compiler/compile_time_number.ts` and `compiler/optimizer/values.ts`.

## References checked

- [Box2D's compiler policy](https://github.com/erincatto/box2d/blob/main/CMakeLists.txt):
  disable contraction explicitly instead of relying on target-dependent FMA.
- [Box2D determinism](https://box2d.org/posts/2024/08/determinism/): separate
  ordinary arithmetic from platform math-library functions.
- [V8 numeric implementation](https://github.com/v8/v8/blob/main/src/base/ieee754.cc):
  own the transcendental algorithm rather than delegating its contract to the
  host libm. Current V8 has also changed implementations over time; invoking
  the current host's `Math.pow` is not a stable machine definition.

## Validation boundary

GEO evidence must submit the same raw RAM/MMIO vectors to TS, native C++, and
ARM hard-float code, and compare result/status words, not formatted floats.
Include touching/near-touching shapes, axis ties, clipping, signed zero,
subnormal inputs and non-finite f32 patterns. QEMU ARM execution is cross-ISA
conformance evidence, not a claim to have run on physical SNES Mini hardware.

## GEO slice result

- `npm run test:geometry-parity`: 154 raw RAM/MMIO vectors agree between TS
  and native C++. The same vector command passed on the SNES Mini GCC 10.2
  hard-float build, executed with QEMU `-cpu cortex-a7` and the imported SNES
  Mini runtime root. This includes real contact/hit/depth assertions, not only
  matching two empty result buffers.
- ARM `overlap2d.cpp.o` and `sat2.cpp.o`: zero fused multiply/add/subtract
  instructions after applying the target policy.
- Existing GEO save-state/device tests: 7 passed; test project typecheck passed.
- No geometry datapath or coordinate representation changed in this slice.

The native conformance runner is `bmsx_geometry_conformance_runner` under
`BMSX_BUILD_TESTS`. Build it with the existing SNES Mini CMake toolchain to
exercise the ARM target. `tests/conformance/geometry/run.ts` accepts a runner
command plus its prefix arguments, for example `qemu-arm-static -cpu cortex-a7
-L .snesmini/rootfs <arm-build>/bmsx_geometry_conformance_runner`. The script
appends the generated vector path, compares every output word, and preserves
its temporary input file on failure.

## POW slice result

`machine/{ts,cpp}/spec/blua32/pow` adopts the fdlibm POW algorithm from
[V8 12.4.254](https://github.com/v8/v8/blob/12.4.254/src/base/ieee754.cc).
The CPU dispatches and both compiler evaluators consume it directly. Binary64
word access belongs to mirrored `common/float64`; no per-operation arrays,
objects or typed views are allocated. The underflow path uses normal-range
exponent adjustment followed by one subnormal rounding, without host `scalbn`.
The original Sun notice and V8 license are retained.

- `test:pow-parity`: 30,178 exact binary64 vectors agree in TS, native C++ and
  the SNES Mini ARM build under QEMU. Coverage includes signed zero, NaNs,
  infinities, underflow/overflow boundaries, negative/integral powers,
  near-one/large-exponent inputs, AEM gain/pitch ranges and seeded raw words.
- Lua execution tests compare dynamic POW with both constant evaluation paths
  at O0 and O3, plus independently recorded fdlibm result words.
- A bundled Node 22 microbenchmark of one million fractional powers measured
  about 93 ms for the owned TS kernel versus 23 ms for native `Math.pow`
  (warm runs, same sum). This is an explicit host-time cost of the portable
  algorithm, not extra guest cycles or an end-to-end cart performance claim.
  Integer shortcuts and square roots remain in the algorithm; no cache or
  guest lookup tables change its semantics.

## Source tooling slice

Reference: [TypeScript's parser entrypoint](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/compiler/parser.ts)
creates syntax through the parser independently of execution; [VS Code's host
error presentation](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/base/common/errorMessage.ts)
is owned by common host code, not a language VM. BMSX reuses its existing strict
`parseLuaChunk` entrypoint and retains only the needed common error-message
conversion, without copying VS Code's broad shape heuristics or fallbacks.

Removed the dead tree-walking interpreter, JS bridge and handler cache. The
workbench owns its suspended guest session directly; pure source queries,
parsing, diagnostics, boot preparation and Scenario Lab compilation no longer
require an interpreter or a guest inspection context. Runtime completion and
hover receive source and inspection owners explicitly. Semantic frontend
caching remains keyed by immutable snapshots and the retained builtin-descriptor
environment, not per-call objects or a never-executed global environment.

Validation: 149 source/semantic/completion/save tests and 90 boot, Hot Resume,
Scenario Lab and assistant/workspace runtime tests pass. IDE, scripts and test
projects typecheck; architecture boundary audit reports zero violations. These
are source/runtime-path checks, not a claim of a new visual UI audit.

## Per-image compilation recipe

Reference: [Clang AST serialization](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/clang/lib/Serialization/ASTWriter.cpp)
retains language/target options with the compiled artifact, not in a mutable
editor preference. BMSX's compiler emits its effective `optLevel` into
`ProgramMetadata`; the linker preserves it beside `traceStatements` and
`preloadModules` in each image's symbol metadata. BIOS, cart0 and cart1 consume
their own installed recipe when rebuilding. Scenario Lab takes the selected
cartridge's level instead of a workbench-global default.

Representation before mirrored edits: TS `OptimizationLevel` (0..3), C++ `u32`
in `Blua32DebugMetadata`, encoded as a number in the existing binary symbol
object. Call sites are compiler completion, symbol linking/encoding/decoding,
Studio source builds and test-media builds; none is a machine hot path.
New debug images must be rebuilt to carry this required metadata; readers do
not guess a recipe for an older image.

Validation: 70 recipe/symbol/linker/boot/Hot Resume/Scenario debugger tests pass.
The recipe test builds mixed BIOS/cart0/cart1 combinations, rebuilds in both
boot and live modes, republishes ROMs and reloads them before comparing levels.
Native `bmsx_rompack_format_tests` verifies C++ symbol round-tripping, including
nonzero optimization levels. Typecheck and boundary audit are clean.

## Cartlib inspection contract and formal parameters

References: [LLVM DILocalVariable argument identity](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/llvm/include/llvm/IR/DebugInfoMetadata.h)
is distinct from variable name and physical location; [LLDB library formatters](https://github.com/llvm/llvm-project/blob/llvmorg-20.1.8/lldb/examples/synthetic/gnu_libstdcpp.py)
read known library layouts instead of injecting target calls. Only those owner
boundaries are adopted, not LLDB's compatibility guesses and exception fallbacks.

Representation before mirrored edits: TS local-slot debug metadata gains a
formal `argumentIndex` (0 includes an implicit receiver; -1 is not a parameter),
mirrored as `i32` in C++ symbols. The compiler declares it in parameter order;
inlining retains it while independently relocating registers. Symbol codecs
preserve it. None of these callsites executes on the guest hot path. The PC
observer and guest instruction stream are unchanged; binding happens once per
installed image and uses argument positions rather than source spellings.

The cartlib-to-Studio read contract is now explicit in
`docs/cartlib_inspection_contract.md` with links at the source owners. It is a
same-build inspection ABI, not a second runtime DTO or a compatibility adapter.

Validation: 48 function-probe/event/actor/behavior/compiler/symbol and
release/debug execution tests pass, including renamed real event-emitter
parameters at O0/O3. Native symbol codec tests pass. Observer-disabled and
observer-enabled complete CPU state, cycle count and guest heap remain equal.

## Final regression and Studio authoring evidence

- Full Lua suite: 2,924 passed, zero failures; the existing disabled runtime
  integration placeholder remains skipped. Full ROM tooling suite: 203 passed.
- IDE, scripts and tests typecheck. Both core-parity and architecture-boundary
  audits pass. The layout manifest now names the source pipeline owners and
  excludes the deleted interpreter and bridge rather than requiring a facade.
- Rebuilt headless Studio, BIOS and `hot_resume_test`, then exercised the
  shipped input/clipboard/capture surface with `tests/ide/user_io_authoring.mjs`.
  Creating sources, running a cart, live-editing colors, adding an import,
  changing BIOS code, rejecting invalid syntax and an unmappable continuation,
  undo/redo, repairing and rebooting all pass. Rejected edits leave the previous
  game runnable; successful live edits do not restart its entry.
- Inspected the actual captures of both rejected edits and the running game.
  The authoring test checks execution/source behavior rather than freezing the
  diagnostic's English wording. This is real headless Studio UI evidence, not
  browser, mobile or physical SNES Mini validation.

Final native GEO/POW vector runs and native symbol-codec round-trips also pass.
The cross-ISA evidence and POW host-time cost remain as recorded above; none of
these checks claims exhaustive floating-point coverage or zero host overhead.

## GEO FMA negative control

The original 154 vectors also passed with contraction enabled on ARM. Their
positive parity result did not demonstrate sensitivity to the FMA regression.
A separate SNES Mini GCC 10.2.1 build now establishes the negative control:
`-fno-fast-math` stays enabled and only `-ffp-contract=off` becomes
`-ffp-contract=fast`. Disassembly contains eight FMA instructions in
`overlap2d.cpp.o` and three in `sat2.cpp.o` in that build.

Two concrete counterexamples are retained in `geometryVectors`, without the
exploratory search generator:

- `overlap-unfused-contact`: shared-edge triangles produce one contact with
  separate operations and no contact with contraction. This checks observable
  result publication, not just an intermediate double's last bit.
- `sat-unfused-normal`: translating a triangle along its selected edge gives
  a zero centre/normal dot product without contraction. With contraction its
  sign changes the published Q16.16 normal from `(-55263, 35228)` to
  `(55263, -35228)`. Hit and depth remain equal.

All 156 vectors pass TS/native x86 and TS/ARM Cortex-A7 under QEMU. The
FMA-enabled ARM build fails the same gate at the contact case; separate raw
runner comparisons confirm that both retained cases independently differ.
The strict ARM build agrees with native x86 on both.

To repeat the mutation, configure a separate ARM Ninja build with the existing
SNES Mini toolchain and `BMSX_BUILD_TESTS=ON`. Change only
`-ffp-contract=off` to `-ffp-contract=fast` in that build's generated
`build.ninja` (and its `compile_commands.json`), then build its
`bmsx_geometry_conformance_runner` with Ninja. Supply that runner through QEMU
to the existing `tests/conformance/geometry/run.ts` command. Regenerating CMake
restores the production flag. No production relaxation option was introduced.

## Remaining diagnostic-domain follow-up

The live resource-diagnostics path accepts `__bmsx_next` in BIOS, cart0 and
cart1 alike; an unrelated undefined name is correctly diagnosed in all three.
`createEditorSemanticFrontend` currently has no domain parameter and shares
one environment. The compiler's semantic frontend also unconditionally seeds
the boot names, so the policy needs an owner shared by these consumers.

There is no `retainAfterBoot` field in the current primitive representation.
All 29 boot primitive globals are cleared by the compiled system bootstrap.
A domain-aware correction must reflect that real producer contract: BIOS
initialization knows these names, carts do not inherit them as known globals.
That correction is not part of the GEO negative-control change.
