# Matched Lua table/call workload

This is the supplied `rebuild_modes.lua` workload: 1,825 objects, six source
calls and seven named field writes per object, plus the list and its writes.
The pool is constructed and retained in every variant. `reuse` still allocates
a fresh list; `ctor` initializes fields before writing them again. Their timing
differences are not pure allocation or call-cost measurements.

The original pool, helper functions and `frame()` are retained verbatim except
for BLua's mandatory lowercase identifiers (`N_OBJECTS`, `MODE`, `Actor`). The
local lint exemption preserves the experiment: adding `<const>`, inlining
getters/setters or rewriting the nil-producing expression changes this workload.
No game code, guest costs or table representation is modified.

`normal`, `ctor` and `reuse` use the same ROM. `nogc` is deliberately unsupported:
there is no guest GC-stop operation. The standalone native benchmark grants one
work unit at the next vblank and waits for completion and a halted CPU before
granting the next. A unit may occupy multiple guest frames. After ten warmups,
the harness invokes the existing collector once outside all measured intervals,
matching the original script's untimed collection. Then it measures 200 units.
Every result must be 4,998,675. Completion never means a partly executed unit.

Build the cartridge with the ordinary packer:

```
npm run build:toolchain:cart -- lua_rebuild_bench -O3
```

Configure the native test build with `BMSX_DIAGNOSTIC_CPU_TIMING=ON`,
`BMSX_DIAGNOSTIC_CPU_SLICES=OFF`, and `BMSX_BUILD_TESTS=ON`. Build target
`bmsx_lua_rebuild_benchmark`, then run through the bounded test runner:

```
npm run test:exec -- <build>/bmsx_lua_rebuild_benchmark \
  dist/system/bmsx-bios.rom dist/lua_rebuild_bench.rom normal
```

The diagnostic is default-OFF and Linux-only. It times actual
`CPU::runUntilDepth` slices with monotonic and thread-CPU clocks, without opcode
counters in generated code. JSONL output is deferred until the run finishes;
records are preallocated. Report CPU-thread time and guest cycles per completed
unit, GC counts/time, compilation work and guest ticks. The CPU envelope includes
vblank IRQ handling and the small cart completion protocol; it excludes device
advancement, host rendering, audio draining, inspection and background compiler
CPU time. It is not an exact entry/return function profiler. Do not subtract an
unrelated idle-cart frame or label scheduled idle cycles as executed work.

`beginMonotonicNs` and `endMonotonicNs` bound each complete work unit for
host-sample correlation. Those wider intervals also contain device advancement
and harness control; their difference is not CPU-slice time. Exclude startup,
warmup and the untimed collection from profiles, and keep measured units with
and without collection distinguishable. `BMSX_NATIVE_PERF_MAP=ON` publishes the
generated-code ranges for Linux `perf` without per-instruction probes.

This test boots the real BIOS and advances all devices, but consumes GPU commands
without rendering them and rejects readback. It does not exercise libretro,
Mali, ALSA, presentation latency or a complete Pietious room. Use identical ROMs
on x86 and ARM. Retain the compiler options and raw records with any measurements.
PUC's integer arithmetic and GC policy differ from BLua32; identical source does
not mean identical implementation work, and a matched microbenchmark is not a
whole-game speedup claim.
