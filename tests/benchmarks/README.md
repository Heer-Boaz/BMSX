# CPU execution gate

Run identical ROM bytes through the TS interpreter, generated JavaScript, the
C++ interpreter and native codegen. C++ comparison uses **two actual binaries**;
an observer hook forcing scalar execution in a native-enabled binary is not the
interpreter reference.

Production defaults to generated JS and C++ native execution. The gate selects
both reference and generated modes explicitly so a default change or reused
CMake cache cannot silently turn an interpreter comparison into codegen/codegen.

```sh
cmake -S machine/cpp -B build-native-cpu-default -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBMSX_BUILD_TESTS=ON \
  -DBMSX_ENABLE_NATIVE_BLOCKS=ON -DBMSX_ENABLE_GLES2=OFF -DBMSX_ENABLE_ZLIB=OFF
cmake -S machine/cpp -B build-native-cpu-default-scalar -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DBMSX_BUILD_TESTS=ON \
  -DBMSX_ENABLE_NATIVE_BLOCKS=OFF -DBMSX_ENABLE_GLES2=OFF -DBMSX_ENABLE_ZLIB=OFF
cmake --build build-native-cpu-default --target bmsx_cpu_execution_benchmark --parallel 4
cmake --build build-native-cpu-default-scalar --target bmsx_cpu_execution_benchmark --parallel 4

npm run test:exec -- npx tsx --tsconfig tsconfig.base.json \
  tests/benchmarks/cpu_execution.ts 1000000 3 \
  --native build-native-cpu-default/bmsx_cpu_execution_benchmark \
  --interpreter build-native-cpu-default-scalar/bmsx_cpu_execution_benchmark \
  --output /tmp/bmsx-cpu-gate > /tmp/bmsx-cpu-gate.jsonl
```

Use matching compiler/build options for the two C++ builds. Use `Release` for
production throughput; `Debug` also retains assertions and is a distinct gate.
Record the compiler, CPU and build flags alongside results. Do not compare Debug
with Release, or treat QEMU throughput as hardware throughput.

The default compiler optimization level is O3; `--opt-level 0` tests unoptimized
Lua. Optional `--filter 'math|concat|closure'` selects workloads and
`--grants 256,4096` selects CPU slice sizes. Omitting both C++ paths runs only the
two TS routes. Each JSON line contains the workload, backend, grants, actual
guest cycles, wall time, code-cache size and ROM/state SHA-256 provenance.

`dynamic_calls_32` and `dynamic_calls_128` traverse distinct function bodies
through table-selected calls, with three nested activations per iteration.
They retain real CALL/RET traffic at O3 and vary the executable working set,
rather than reusing one closure body at many table entries. For the small direct
`calls`/`closures` fixtures, also run `--opt-level 0`: O3 may inline those helpers.
`mixed_mmio` alternates RAM and the IRQ mask register at the same load/store
sites, exercising native/helper transitions without running device time or
raising interrupts. It does not measure IRQ delivery, DMA or scheduler costs.

The default `--warmup-passes 0` includes cold translation in the measured pass.
Use `--warmup-passes 1` for a second, measured invocation on the same machine,
retaining its code cache and guest heap. Larger values perform more invocations
before the final measured pass. `firstPassMilliseconds` always records the first,
cold invocation; `milliseconds` records the final pass. These are separate
measurements, not interchangeable results. V8 tiering and cache regeneration may
still occur during a warm pass.

## Measurement and verification

- Each sample has a fresh process and machine. The default measured pass starts
  with a **cold BMSX code cache**; explicit warmup passes retain that machine and
  its code cache. Code generation and guest GC occurring within the measured
  pass are included. V8 itself can optimize while the sample runs.
- Setup, process startup, Lua compilation/linking, serialization, file IO and
  verification are outside the CPU timer. Repetitions reverse backend order.
- Workloads run to a normal root return, without HALT/wait or idle-cycle credit.
  Total consumed guest cycles and the completion PC must match exactly across
  all four routes. A positive host grant admits an atomic instruction or bounded
  generated segment, so individual grant overruns, the number of host slices
  and the final grant's remaining budget may differ. All remain in the output;
  no debt is discarded or normalized before recording it. Per-boundary CPU
  regressions separately advance the interpreter to the generated route's
  actually consumed guest-cycle boundary and compare state there.
- Every sample is compared with the complete decoded existing runtime save
  state, including RAM, roots, object graph and device state, across backends,
  repetitions and grant sizes. Snapshots are deleted after comparison; an
  explicit output directory retains the input ROMs.
- Counted-store fixtures seed source registers before timing and check both ends
  of the destination RAM span. Their iteration count scales by span length, with
  at least 64 iterations, including the maximum 32,767-word operand.

This is an **active CPU execution** gate, not a scheduler, render, audio, browser
or complete-game FPS test. Repeat on representative hardware and validate those
surfaces separately. Shared-host timing is provisional; report distributions,
not a single best number.

The measurement boundaries follow [V8's benchmark setup/run/teardown separation](https://github.com/v8/v8/blob/main/test/js-perf-test/base.js).
Separate baseline executables and repeated comparisons are also used by
[Luau's benchmark driver](https://github.com/luau-lang/luau/blob/master/bench/bench.py).

## Real BIOS/cartridge execution with rendering

`runtime_execution.ts` compares two C++ binaries booting the stock BIOS and a
real cartridge. Build `bmsx_runtime_execution_benchmark` in separate native-ON
and native-OFF Release trees with `BMSX_ENABLE_GLES2=ON` and
`BMSX_BUILD_TESTS=ON`. This target currently requires Linux/EGL. For example:

```sh
GALLIUM_DRIVER=d3d12 EGL_PLATFORM=surfaceless npm run test:exec -- \
  npx tsx --tsconfig tsconfig.base.json tests/benchmarks/runtime_execution.ts \
  --native build-runtime-native/bmsx_runtime_execution_benchmark \
  --interpreter build-runtime-interpreter/bmsx_runtime_execution_benchmark \
  --system-rom dist/system/bmsx-bios.rom --rom dist/2025.rom \
  --timeline /path/to/keyboard-timeline.json \
  --frames 1000 --warmup 200 --rounds 4 --output /tmp/bmsx-runtime-gate
```

The D3D12 environment selects the WSL GPU driver on supported hosts; it is not
a portable default. Inspect the recorded GL vendor/renderer/version: a working
EGL context may otherwise be software rendering. No libretro frontend or
custom host is used by this executable.

The renderer ablation runs `commands`, `software` and `gles2` by default;
`--renderers commands,software` selects a subset. Every mode runs the real
scheduler, devices, audio emulation and guest BIOS/cartlib. Commands mode retires
the same command prefixes without host rasterization or scanout, and rejects
workloads needing GPU readback. It cannot be used to model arbitrary GPU-reading
carts. The other modes perform rendering and presentation into an offscreen
target. GLES explicitly waits for completion each presentation. There is no
window swap, audio sink, CRT, rewind or wall-clock pacing: this is **not** a
measurement of frontend FPS or asynchronous GPU throughput.

Input uses keyboard button timeline entries (`frame`, `event.type = "button"`,
`event.deviceId = "keyboard:0"`, `event.code`, `event.down`). Frame indices count
host steps from BIOS boot, unlike the custom libretro host's cartridge-start
clock. The host delta is fixed at the initial display period. Verify the captured
scene before assigning a workload or scene label to a timing result.

Verification records actual GPU emissions, separately from untraced timed runs:

- Final CPU/heap/RAM/device state and cached VRAM bytes must match across all
  modes. This does **not** compare GPU-rendered VRAM contents.
- Raw command words and latched draw state must match across all modes.
- Command timestamps must match across renderers for each CPU mode.
- Every interpreter/native timestamp difference is retained in
  `command-timing.json` and stdout. Positive segment admission can change device
  service boundaries; equal final state does not establish equal event timing.
  Use `--strict-command-timing` to fail on any such difference. There is no
  tolerance band or timestamp normalization.
- The final captured image must match between CPU modes using the same
  renderer. Captures are retained as raw RGBA with dimensions in stdout; this
  neither proves every intermediate frame nor software/GLES pixel parity.

Timed repetitions reverse order and verify final state again. `schedulerMs`
includes CPU execution, JIT preparation and devices, but excludes the separately
timed rendering scopes. `renderMs` includes driver work and GLES completion,
not pure GPU time. `totalMs` additionally includes presentation selection and
audio output servicing. Timings exclude warmup; tick/command/presentation counts
cover the whole run. ROM, binary and input hashes are recorded in provenance.

For a separate diagnostic pass, `--profile-compilation` enables the existing
native compilation counters. `compilation.prepareMs` covers the same post-warmup
window as the timing totals, while `coldPrefixPrepareMs` covers its preceding
warmup. These runs are labelled `compilation-profile`, not ordinary measurement;
the extra clocks have overhead. Code size is the final live cache size, not
bytes emitted only during the measured window.

The direct executable accepts the same inputs positionally:
`BIOS CART INPUT_WORDS RENDERER WARMUP FRAMES STATE TRACE_PREFIX_OR_DASH
[--profile-compilation]`. Run profilers through `npm run test:exec` too.
Sampling profiles describe on-CPU time, not blocked GPU waits. Callgrind counts
instructions under instrumentation; its wall time and simulated caches are not
hardware performance measurements. Keep compilation inside/outside the selected
scope explicit and do not drop unidentified generated-code samples.

The separate render ablation follows
[MAME's benchmark video/sound controls](https://github.com/mamedev/mame/blob/master/src/osd/modules/lib/osdobj_common.cpp);
real system boot and frame-driven regression execution are also used by
[DuckStation's regression host](https://github.com/stenzek/duckstation/blob/master/src/duckstation-regtest/regtest_host.cpp).
