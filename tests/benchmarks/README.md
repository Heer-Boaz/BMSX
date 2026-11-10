# CPU execution gate

Run identical ROM bytes through the TS interpreter, generated JavaScript, the
C++ interpreter and native codegen. C++ comparison uses **two actual binaries**;
an observer hook forcing scalar execution in a native-enabled binary is not the
interpreter reference.

```sh
cmake -S machine/cpp -B build-native-cpu-blocks -G Ninja \
  -DCMAKE_BUILD_TYPE=Debug -DBMSX_BUILD_TESTS=ON \
  -DBMSX_ENABLE_NATIVE_BLOCKS=ON -DBMSX_ENABLE_GLES2=OFF -DBMSX_ENABLE_ZLIB=OFF
cmake -S machine/cpp -B build-native-cpu-scalar -G Ninja \
  -DCMAKE_BUILD_TYPE=Debug -DBMSX_BUILD_TESTS=ON \
  -DBMSX_ENABLE_NATIVE_BLOCKS=OFF -DBMSX_ENABLE_GLES2=OFF -DBMSX_ENABLE_ZLIB=OFF
cmake --build build-native-cpu-blocks --target bmsx_cpu_execution_benchmark --parallel 4
cmake --build build-native-cpu-scalar --target bmsx_cpu_execution_benchmark --parallel 4

npm run test:exec -- npx tsx --tsconfig tsconfig.base.json \
  tests/benchmarks/cpu_execution.ts 1000000 3 \
  --native build-native-cpu-blocks/bmsx_cpu_execution_benchmark \
  --interpreter build-native-cpu-scalar/bmsx_cpu_execution_benchmark \
  --output /tmp/bmsx-cpu-gate > /tmp/bmsx-cpu-gate.jsonl
```

Use matching compiler/build options for the two C++ builds. `Debug` above retains
assertions; the project also applies its ordinary optimization flags. Record the
compiler, CPU and build flags alongside results. Do not compare Debug with
Release, or treat QEMU throughput as hardware throughput.

The default compiler optimization level is O3; `--opt-level 0` tests unoptimized
Lua. Optional `--filter 'math|concat|closure'` selects workloads and
`--grants 256,4096` selects CPU slice sizes. Omitting both C++ paths runs only the
two TS routes. Each JSON line contains the workload, backend, grants, actual
guest cycles, wall time, code-cache size and ROM/state SHA-256 provenance.

## Measurement and verification

- Each sample has a fresh process and machine with a **cold BMSX code cache**.
  Dispatch warmup/code generation and guest GC are included, not amortized away
  by an untimed machine warmup. V8 itself can optimize while the sample runs.
- Setup, process startup, Lua compilation/linking, serialization, file IO and
  verification are outside the CPU timer. Repetitions reverse backend order.
- Workloads run to a normal root return, without HALT/wait or idle-cycle credit.
  Grants can be overrun by atomic guest instructions; consumed cycles and the
  final remaining budget/PC must match exactly across all four routes.
- Every sample is compared with the complete decoded existing runtime save
  state, including RAM, roots, object graph and device state. Snapshots are
  deleted after comparison; an explicit output directory retains the input ROMs.
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
