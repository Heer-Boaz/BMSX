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
