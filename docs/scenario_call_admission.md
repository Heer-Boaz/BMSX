# Scenario call admission

## Owner decision before implementation (2026-09-08)

The live cinematic stack is `entry → vblank.wait → irq → setup → ... →
dma.wait0_idle`. Setup was injected above an unreturned IRQ frame and waits
for a sequence published by that IRQ path. Extending its timeout is not a fix.

`Runtime.callClosure` is a current-context execution primitive. Debugger/tooling
callers may deliberately inspect that context; silently running their interrupted
program first would change its meaning. Scenario protocol callbacks, in contrast,
are ordinary guest work, not IRQ handlers. Their admission belongs to
`ScenarioExecutionService`, shared by interactive Studio and headless scenarios.

The existing `CpuExecutionState.runSuspendedUntilDepth` already executes actual
instructions up to a physical return boundary, through the common device
scheduler. Use that operation before admitting a new protocol call when an
exception frame is present. A blocked backend, parked handler or debugger stop
does not admit the call. The existing protocol phase remains unstarted and the
ordinary host loop remains responsible for further execution/cancellation.
This actively executes to the return boundary; it is not an IRQ-mode guard
which retries forever at the same PCRTC edge.

No IRQ mask writes, usermode coercion, host DMA polling, new request queue,
guest-value copying, save-state fields or cartlib test hooks. Completion frames
already admitted continue through the existing completion latch and frame loop.

## Production references

- LLVM LLDB, commit `9bc8df6b880ef04a90e5b9ff05afd07f6fbdf562`:
  [`ThreadPlanStepOut`](https://github.com/llvm/llvm-project/blob/9bc8df6b880ef04a90e5b9ff05afd07f6fbdf562/lldb/source/Target/ThreadPlanStepOut.cpp)
  identifies the return frame separately from executing the subsequent operation.
  [`ThreadPlanCallFunction`](https://github.com/llvm/llvm-project/blob/9bc8df6b880ef04a90e5b9ff05afd07f6fbdf562/lldb/source/Target/ThreadPlanCallFunction.cpp)
  treats inferior calls as deliberate execution, not an ordinary property read.
  BMSX uses its physical frame-depth boundary, not LLDB's ABI stack checkpoint or
  host thread restoration.
- MAME's [`device_scheduler`](https://github.com/mamedev/mame/blob/master/src/emu/schedule.cpp)
  services device deadlines during actual CPU execution. BMSX's existing shared
  executor already owns that contract; Scenario Lab must not drive DMA itself.

## TS/C++ representation table before the diff

| Representation / operation | TypeScript | C++ | Ownership |
| --- | --- | --- | --- |
| Active frames | `CPU.frames: CallFrame[]` | `CPU::m_frames: vector<CallFrame*>` | Existing CPU stack, no copied view |
| Exception membership | `CallFrame.isExceptionFrame` | `CallFrame::isExceptionFrame` | Existing physical frame flag |
| Outermost exception return depth | `CPU.readExceptionReturnFrameDepth(): number` | `CPU::readExceptionReturnFrameDepth(): int` | New read-only projection; first exception frame's index, `-1` when absent |
| Return-boundary execution | `cpuExecution.runSuspendedUntilDepth(depth)` | `cpuExecution.runSuspendedUntilDepth(runtime, depth)` | Existing executor, unchanged |
| Closure admission and completion | `CPU.beginCompletionCall`, completion latch | Same method / latch | Existing raw machine representation, unchanged |
| Scenario protocol phase | `ScenarioExecutionService` | No scenario tooling in player core | Existing TS tooling owner; no Studio policy added to native runtime |

## Callsites / performance

- `ScenarioExecutionService.guestCallCompleted`: inspect the return depth only
  before starting a new loader/ready/setup/update call. Execute an outstanding
  exception path before pushing the callback. No scan while that call is pending.
- `hotResumeLuaRuntime` preparation: replace its existing open-coded search for
  the outer exception frame with the CPU-owned read operation. Its supervisor
  plan, request-line policy and installation order stay unchanged.
- Neither normal nor instrumented opcode dispatch gains a branch or allocation.
  The new projection scans the retained stack only when requested by tooling.
  The executor and device hot-path callsites are unchanged in both languages.

## Required proof

- Mirrored CPU tests: absence, IRQ, nested NMI, actual return to the outer
  continuation without executing its next instruction; no status-word repair.
- Actual shipped cinematic scenario completes, not merely times out. Ordinary
  DMA/IRQ work must execute and assertion output must be inspected.
- Actual IDE host chord and cancellation still restore canonical media.
- Existing Studio Hot Resume/debugger workflows on all browser backends;
  native CPU/system-controller tests, typechecks and architecture/parity audits.

## Adjacent proven launch defect (before its diff)

The physical Palette test, extended only by pausing gameplay before Run, fails
to reach scenario setup: the old host Requested pause blocks the new test.
Run/Rerun are explicit execution intents, not view transitions. A first-item
`started` media-session event belongs to the run service, after successful
build/installation and protocol start. The workbench controller consumes it
through the existing `HostExecutionControl.requestExecution(true)`. It clears
only Requested pause; fullscreen/device-interaction holds retain their owners.
Neither failed preparation nor Cancel publishes a start event. Later items in
an already-started batch do not override a subsequent user Pause.

This follows successful-start ownership rather than optimistic button state:
[Godot `EditorRun::run`](https://github.com/godotengine/godot/blob/6a0f6f32cfb2ce4cc5bad6641d0afda413b62a9d/editor/run/editor_run.cpp#L189-L204)
sets playing status after successful process creation. BMSX retains one Runtime
and uses its existing host pause-reason owner, not Godot's process model.
The existing media-session event contract gains the actual start transition;
there is no new lifecycle facade or runtime/guest launch flag.

Proof includes failed source preparation preserving old pause/media/cycles,
successful Run from pause, an independent host hold, real cinematic completion,
Rerun/Cancel, and canonical-media restoration.

## Preparation/publication boundary (before its diff)

The failure probe exposed a second launch-owner error: invalid test source
changed machine cycles from `35392628` to `0`, despite never installing a test
cartridge. The service created its media session before compiling the first
test, then its failure path "restored" and rebooted the still-original media.
Dirty canonical media was also installed before that test had compiled.

Prepare canonical ROM layers and the first scenario ROM as unpublished build
outputs. Only after both builds succeed and cancellation admission is checked
may the service install them and create the active media session. A failed or
cancelled initial build has nothing to restore. Later-item failure does restore
canonical media because a test cartridge is genuinely active then. The pure
preparation module owns the two build outputs; the run service owns publication,
execution and the media-session lifetime. No capture/rollback transaction.

VS Code's [debug launch owner](https://github.com/microsoft/vscode/blob/a47dab6a0a5258924b2454f64fc373fc7e657677/src/vs/workbench/contrib/debug/browser/debugService.ts#L546-L559)
finishes and checks prelaunch work before starting the session. Here the actual
source/compiler producers are the existing `buildBlua32Media`,
`layoutBlua32MediaInstallation` and `buildScenarioCartridge`, not an extra
preflight validator or duplicate parser.

## ROM publication is not CPU image installation

The Git owner history distinguishes three operations:

- `32014f272` removed `CPU.applyExecutableMediaRevision` and source-revision
  representations from the CPU.
- `f96f1e312` removed `CPU.installExecutionImage`; execution ownership moved to
  the physical address space, followed by direct ROM-record execution.
- IDE `installBlua32Media`, introduced under that name in `2e2adeb24`, remains
  the existing ROM-byte publication and source-bookkeeping owner. This slice
  does not reintroduce it or add an execution-image installation API. Its
  machine writes use `Memory.installSystemRom` and
  `CartridgeController.installRom`, mirrored physical operations in TS/C++.

The new scenario preparation module consumes finished ROM bytes and linker
outputs. Source revisions, diagnostic maps and accepted-source bookkeeping
remain IDE/toolchain data; the CPU receives none of them.

## Validation

- Mirrored TS/C++ CPU tests cover no exception, cart IRQ, nested NMI and actual
  RFE back to the outer continuation without executing its next instruction.
  Native CPU-supervisor and system-controller CTest targets pass.
- The actual shipped `nemesis_s_cinematic_flow_assert.lua` now passes its guest
  assertions, rather than reaching the host deadline. Shipped stage-boot,
  gameplay-pause and game-over scenarios also pass with unchanged cart sources.
- `command_palette_scenario.idetest.js`: ten assertions through physical
  keyboard/Palette input cover Run from user pause, real setup, IDE-chord
  suspension and Cancel restoring the same Runtime and canonical ROM bytes.
- `scenario_preparation.idetest.js`: ten assertions use actual dirty-program
  and invalid-test compilation, repair and cancellation. Failed/cancelled
  preparation preserves old cycles, ROM bytes and installed-source baseline;
  valid preparation publishes the accepted program and passes the cinematic.
- Complete browser Studio workflows pass on software, WebGL2 and WebGPU:
  existing rewind/Hot Resume/source/debugger cases, failed preparation,
  successful Run with an independent fullscreen hold, cinematic completion,
  Rerun/Cancel and return to the canonical Scene Editor. Final Palette captures
  were inspected; the recent intentional compile-error toast is not a machine
  fault. The preparation diagnostic remains in its retained failed test result.
- Lua: 964 passed, one existing skip. ROM packer: 122 passed. IDE typecheck
  passes; broad test typechecking retains the same 52 baseline diagnostics.
- Strict architecture audit: zero issues. Core-parity audit, indentation and
  `git diff --check` pass. Browser Studio and Node headless-tooling products
  were rebuilt. Logs and captures: `/tmp/bmsx-scenario-admission/`.

This proves the shipped callback/IRQ flow and its host interruption boundaries,
not termination of arbitrary non-yielding Lua in the existing synchronous
completion executor. No claim of universally preemptible inferior evaluation
is made by this slice.
