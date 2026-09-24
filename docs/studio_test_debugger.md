# Live test-debugger ownership

## Gate: live owners and production references (2026-09-24)

The prior post-mortem slice and the live-debugger execution kernel are
implemented. Live test-debugging UI/tools are **not** implemented by this slice.

Studied before editing:

- [VS Code debugSession](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugSession.ts), next/stepIn/stepOut and continued-event handling: execution names a thread, and continued threads retire their stack/variable requests.
- [VS Code debugModel](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts): stack/scopes retain session and thread identity.
- [Lua ldebug.c](https://github.com/lua/lua/blob/v5.4.8/ldebug.c): hooks and frame access belong to an actual Lua state.

The initial audit found that the BMSX debugger mixed source breakpoint/step
matching with authoring control plans and direct CPU hook installation. The test runner owns a different
CPU hook for boot admission and explicit gameplay publication. Sharing either
hook by replacing the other is wrong. Source stepping also compared only frame
depths and suppressed a resumed breakpoint at the same depth on any active
thread. That representation could not be moved unchanged into test debugging.

## Representation and execution paths

| Concern | TypeScript | C++ counterpart / effect |
| --- | --- | --- |
| Thread | CPU `activeThread`, actual `Thread` with status and frame array | `Thread*`, same statuses and owned frame vector |
| Activation | Actual `CallFrame`, owning thread and depth | Owned `CallFrame`, register window |
| Source location | Physical execution domain, PC, inline depth from installed symbols | Same raw domain/address/PC; symbols are host tooling |
| Instrumentation | Existing CPU execution hook with domain/pre-interrupt masks | Same instrumented execution port; normal interpreter unchanged |
| Source debugger | Host tooling owns thread-scoped step/suppression and compiled points | No new opcode, register, MMIO or guest ABI |
| Authoring | Runtime debugger plans + host execution/history/task owners | Existing native machine semantics unchanged |
| Test | TestExecution owns admission, budgets, phase calls and its physical target | Guest phase-coroutine protocol unchanged |

Hot paths audited: CPU normal/instrumented `runUntilDepth`,
`CpuExecutionState.runSuspendedUntilDepth`, frame-scheduler game grants,
`TestExecution.advance/advanceWait`, `ScenarioRunService.advance`, and
`runWorkbenchHostFrame`. No new loop, opcode hook, allocation or symbol scan
belongs in uninstrumented execution. Debug metadata builds only on explicit
binding/step admission. Instrumented matching must remain direct map lookups.

## Implemented ownership

A source debugger consumes compiled images and physical breakpoint locations.
It knows CPU thread/frame identity, but never installs a CPU hook, accesses
working copies, drives the scheduler, resumes failed coroutines, or controls host
pause/history. Authoring composition combines it with its control plans. Test
composition combines it with admission/boundary handling. Each owns its one CPU
instrumentation binding and its execution completion/stop lifecycle.

Step commands are scoped to the selected physical thread; breakpoints remain
machine-wide. A different coroutine at equal/lower frame depth must not satisfy
Step Over/Out or consume another thread's resume suppression. Thread termination
is an explicit operation boundary, not a guessed caller frame in another thread.
Step Out is available at a coroutine root with an actual resumer, even at
physical depth one; it ends at that thread's termination, not inside the resumer.
Authoring value handles retire before execution. Live test inspection handles
remain part of the next integration slice below, not an implemented capability.

`TestExecution` accepts an explicit `debug` execution mode. It creates a
target-bound `TestDebugger` only for that mode. Ordinary runs allocate no source
debugger/catalog/step maps. The runner retains the one hook port and explicitly
unions source demand with its admission/publication masks. Publication keeps
its existing pre-maskable-interrupt fence. Source points cannot consume or
replace that fence. No generic hook subscription loop was introduced.

Debug admission stops after module initialization and before the already
prepared bind call executes. Source requests use captured derived images with
physical domains and separate original authored socket provenance. Exact
statement binding is shared with authoring through `source_breakpoints.ts`;
breakpoint state is not shared. Blank/optimized-away lines stay unbound. Source
text never comes from a newer editor buffer.

The kernel supports Continue/Into/Over/Out, manual pause, and event-driven
`wait()` for a real stop or termination. Only source stops permit stepping;
entry/manual/test-boundary stops permit Continue. Thread termination stops
before its resumer. A pending step also stops at a phase operation/publication
boundary instead of silently crossing into runner-owned gameplay. Paused grants
service pending backend work but execute no guest instructions or machine time.
Receipts describe CPU control; they do not claim completed GPU readback.

Cancellation clears debugger intent and disables user stops during the existing
bounded cleanup policy. It cannot re-enable execution on Failed/Dead threads,
unwind an uncooperative call or bypass case/phase budgets. Runner failures and
target disposal settle waiters. Aborting a waiter only detaches the observer;
command/conversation cancellation must explicitly pause or cancel its owned run.
Post-mortem inspection is still a separate read-only case-end attachment.

## Next integration slice

ScenarioRunService must admit one explicit debug case against captured sources;
ordinary Scenario Lab and conversations must use that same lifecycle. Add
stop-scoped stack/locals/globals inspection with borrowed handles retired before
resume, plus target-scoped source/control tools and ordinary UI. Do not reuse a
failure handle for a live stop or retarget the authoring debugger. Validate the
complete native Codex tool workflow and visible ordinary controls separately.

## Validation (2026-09-24)

- Fifteen real-machine kernel cases cover O0/O3 admission, exact compiled source
  and authored-socket provenance, into/over/out including coroutine roots,
  publication priority, thread failure/return before runner consumption,
  cancellation during body/teardown, budgets, waiter cancellation, runner
  failure and disposal. No private interpreter, renderer stub or authoring
  runtime swap is used. An ordinary run and a debug Continue with no source
  stops have identical final machine snapshots and charged cycles.
- The shared source-operation suite additionally covers equal-depth coroutine
  stepping, machine-wide breakpoints during a selected-thread step, nested
  activation suppression and its survival across Hot Resume. Installed step
  metadata is not rescanned between steps. Full Lua: 2485 pass, one skip;
  full rompacker: 177 pass.
- Browser Studio and Node tooling builds pass. Product typechecks pass; the
  tests project retains its same 96 existing diagnostics, with no new or removed
  diagnostics after normalizing line numbers. Strict boundary audit reports
  zero issues; core parity, changed-file indentation and diff whitespace pass.
- The full existing assistant suite passes (36 tests). Its native Codex
  app-server uses a deterministic local model fixture, not live-model reasoning.
  The authoring source-debugger workflow is also rerun on software, WebGL2 and
  WebGPU with real model-side breakpoint/step/Terminal requests and visible Stop.
  These are regression checks of existing tools, **not** proof of new live test
  tools. Source-debugger screenshots were inspected.
- One intermediate WebGL2 rerun timed out waiting for visible Stop to settle.
  Its cause is not established or claimed fixed. The test now asserts immediate
  local cancellation separately from provider completion and retains dispatch
  screenshots and HTTP command observations. The isolated WebGL2 rerun and the
  subsequent three-backend run pass; this observation remains a reliability
  follow-up, not a reason to add retries/fallbacks to the application.
- The ordinary Studio WebGL2 workflow passes (9001 host frames), including
  source debugging, Hot Resume, Terminal, rewind and isolated scenarios. This
  is automated workflow evidence, not a UI-only development session. There is
  no new live test-debugging UI in this slice to claim visually proven.
- Machine, BIOS, C++ and uninstrumented interpreter code are unchanged. The
  representation/hot-path audit above is ownership evidence, not a new general
  throughput benchmark or a claim of a native C++ IDE.
