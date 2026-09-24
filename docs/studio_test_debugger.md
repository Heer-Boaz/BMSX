# Live test-debugger ownership

## Gate: live owners and production references (2026-09-24)

The prior post-mortem slice and the live-debugger execution kernel are
implemented. The integration section below records live Scenario Lab UI and conversation tools built on that kernel.

Studied before editing:

- [VS Code debugSession](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugSession.ts), next/stepIn/stepOut and continued-event handling: execution names a thread, and continued threads retire their stack/variable requests.
- [VS Code debugModel](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts): stack/scopes retain session and thread identity.
- [VS Code testServiceImpl](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/testing/common/testServiceImpl.ts): run/debug admission and cancellation name concrete tests and run identities.
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
Authoring value handles retire before execution. Live test inspection handles likewise retire synchronously before resume or cleanup.

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

## Live integration

`ScenarioRunService.start(caseId, 'debug')` admits exactly one named case;
module/project selections reject before a run is recorded. `ScenarioRun.mode`
is the accepted run profile and propagates through `TestRun` to `TestExecution`.
Rerun preserves the profile while resolving current source. Preparation has no
physical debugger yet: `waitForDebugger` observes its creation or a terminal
preparation outcome. Run completion waits ignore debugger events. A paused host
frame services the backend once and ends batching without executing the CPU.

`TestStack` captures one actual thread's physical PCs and compiled locations.
`TestInspection` owns stack/frame/scope/value handles; `TestTargetInspection`
adds case-end failure policy and `TestStopInspection` adds a live-stop receipt.
They share stored-value and compiled-source reads, not a fake common fault.
At a thread-completed stop the selected thread remains explicit: Failed frames
are inspectable with their fault PC, while Dead has no stack. The resumer's
activation is never substituted for the completed thread. Continue proceeds
through the runner, not by resuming a failed coroutine.

`TestDebugger` owns every live borrow and expires them **before** resume,
cleanup, finish or target disposal. Observed stop revisions reject stale
conversation control. `execute` waits for a real stop or termination; request
cancellation pauses only its own still-current intent, never a later manual
Continue. Ordinary UI uses the same debugger, sources and attachments. Reads
and control do not install any authoring media, invoke guest evaluation, rewind
the authoring target or change its pause reasons.

### Ordinary Studio

Selecting a case exposes **Debug**. Active debug runs show only contextual
Continue/Into/Over/Out, Pause, Breakpoints, Inspect and Stop actions. No new
global key capture or Codex button is added. **Breakpoints** uses the existing
Quick Input surface: select an immutable compiled source, then a line to toggle.
It reports actual binding status; later editor text never supplies coordinates.
**Inspect** opens a lazy stack/globals tree; expand a frame for locals/upvalues,
or press Enter for full read-only compiled source. Model-initiated resume closes
this ordinary UI borrow just as a manual step does. Source text/values are never
read during paint. Both tests and results controls register Inspect explicitly;
focus-return parents are not command-context inheritance.

### Conversation tools and authority

- `studio_debug_test {scope}` admits one case.
- `studio_wait_test_debugger {run}` waits once for preparation plus a stop or termination.
- `studio_list_test_debug_sources {run}` and `studio_read_test_debug_source {run,source}` expose captured images.
- `studio_set_test_breakpoints {run,source,lines}` replaces that source's exact requests.
- `studio_inspect_test_stop {run,revision}` opens a current stop borrow.
- `studio_resume_test_debugger {run,revision,mode}` awaits real Continue/Into/Over/Out completion.
- `studio_pause_test_debugger {run}` pauses an owned run without cancelling its case.
- Shared `studio_read_test_stack {stack,start,count}`, frame scopes/source and
  value tools consume this borrow or a separately opened post-mortem attachment.
  The stack parameter no longer mislabels all inspected stacks as failures.

Run/source/inspection handles and cancellation authority stay prompt-scoped.
A prompt may observe a manually started debug run but cannot resume it or alter
its breakpoints. As with existing test execution, finishing/stopping/disconnecting
the prompt cancels unfinished runs it started with bounded cleanup. A paused
owned test therefore does **not** persist into the next conversation turn.
Cross-turn debug-session handoff is not implemented or implied by history.
Aborting an observation wait alone does not cancel a run. No background provider
polling or extra inference turn is used to watch progress.

Test-target Lua evaluation, rewind and pixels remain separate work. Semantic
builder tools and the complete reviewed fix/save/install/rerun workflow also
remain open; this slice does not complete the overall integration objective.

## Kernel validation (2026-09-24)

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


## Integration validation (2026-09-24)

- Five new service/tool tests drive real isolated machines: sockets 0/1, O0/O3,
  single-case admission, accepted versus later-edited source, exact breakpoint
  binding, Into/Over/Out, stop-bound frame/local/global/table/source reads,
  expired/stale references, unchanged authoring machine, manual observation
  without control authority, pause, operation supersession, prompt cancellation,
  cancelled/failed preparation and working-copy retirement. A stopped host frame
  calls the real backend service once, not sixteen no-op grants. Kernel tests
  additionally inspect the actual Failed/Dead thread at a completed-thread stop.
- Native Codex app-server -> ordinary authorized HTTP -> browser tools -> real
  TestExecution: software, WebGL2 and WebGPU all pass. A deterministic local
  Responses fixture chooses tool requests; this is not a live model's reasoning
  or personal-account authentication. It binds compiled breakpoints, steps
  Into/Over/Out, reads the actual `amount = 20` local despite newer editor text,
  then completes the test and observes its pass. While that conversation is
  stopped, the ordinary UI inspects the very same target/thread. A separate
  keyboard/pointer workflow performs Debug, compiled-source breakpoint selection,
  Continue, Into, Inspect, Over and completion without tool calls. Visible chat
  Stop retires another owned test and awaits cleanup. One connection, two prompts
  and at most 22 scripted model requests per workflow; waits do not poll.
- Screenshots of the actual compiled source, shared stopped locals, ordinary
  breakpoint/step UI, conversation result and Stop were captured under
  `/tmp/bmsx-studio-chat/test-debugger-{software,webgl2,webgpu}-*.png`. The visible
  UI was inspected. Fixture setup edits working copies programmatically, so this
  is automated integration/visible UI evidence, **not** UI-only development.
- Full Lua: 2485 pass, one skip. Full rompacker: 182 pass. Full assistant: 39 pass;
  the three new native-Codex/browser workflows also pass again after the final
  changes. The ordinary Studio WebGL2 workflow passes (8913 host frames),
  including source debugging, Hot Resume, Terminal, rewind and isolated tests.
- Browser Studio and Node tooling builds and product typechecks pass. Tests
  project: the same 96 pre-existing diagnostics, with no additions/removals after
  normalizing positions. Strict architecture boundary audit: zero issues.
  Core-parity audit, changed-file indentation and diff whitespace pass.
- No machine, BIOS, native C++ or uninstrumented interpreter code changed.
  Normal test execution allocates no debugger or inspection state. No idle-frame
  stack/heap traversal, provider polling, replacement authoring runtime or
  secondary server was introduced. These ownership checks and focused cycle/
  snapshot assertions are not a new general throughput benchmark.
