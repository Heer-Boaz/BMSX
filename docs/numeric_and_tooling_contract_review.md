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
