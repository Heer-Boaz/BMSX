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
