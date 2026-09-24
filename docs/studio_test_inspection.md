# Retained test-target inspection

## Design gate

This slice binds read-only inspection to the physical failed test execution. It
is not live test debugging: Lua rejects resume of a failed coroutine. The separate
[live test debugger](studio_test_debugger.md) composes the test runner's
admission hook with source control, without swapping the authoring runtime.
Shared TestInspection/compiled TestStack machinery serves both lifetimes; this
retained attachment does not acquire live execution authority.

References studied before implementation:

- [VS Code debug model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts): scopes and variable references belong to a particular session/thread/frame; children load on demand.
- [Lua 5.4 debug API](https://github.com/lua/lua/blob/v5.4.8/ldebug.c): stack/local inspection names the actual Lua thread and activation.
- [Debug Adapter Protocol](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json): stack, scopes and variables have separate identities and suspended lifetimes.

Live owners were inspected: `TestRun` retains one failed execution,
`TestExecution` receives the actual failed phase thread, and guest
`testlib/execution.lua` retains phase threads. Teardown runs in a different
thread; the author's CPU and its active frame indices cannot describe these
values. Historical `ScenarioResultService` records must not retain guest values.

| Representation | TypeScript | C++ counterpart / impact |
| --- | --- | --- |
| Failed coroutine | `Thread`, `ThreadStatus.Failed`, retained `CallFrame[]` | `Thread`, same status, retained frame vector |
| Local | Actual frame's `ValueSlots` register window | Frame register window of tagged `Value` words |
| Upvalue | Existing CPU `readClosureUpvalue`, open frame or closed encoded value | Existing `readUpvalue`; no new evaluator |
| Table | `ValueTag.Table`, stored entries, heap `hashId` | Tagged table and heap identity; no host shape classification |
| Location | Compiled image + physical domain/address/PC | Same raw machine representation; source socket remap is tooling only |
| Source | Accepted test build's source and ROM byte views | Host tooling, no guest ABI change |

No mirrored runtime/BIOS code changes are required. Normal execution hot paths
(`runWorkbenchHostFrame` → `ScenarioRunService.advance` → `TestRun.advance` →
`TestExecution.advance`, CPU instruction dispatch, coroutine resume/error and
GPU execution) gain no observer hook or per-instruction/frame scan. Failure
recording retains already-computed stack metadata. Inspectors, scope indexes,
source decoding and value pages are created only on explicit inspection.

The shared value reader must bind actual `CallFrame` objects, not assume the
currently active CPU thread. Authoring stop inspection uses that same reader.
Target disposal retires all borrowers before releasing the machine. Closing an
inspector releases only its borrow. No rollback, machine retargeting, execution
or synthetic heap snapshot is involved.

Heap reads describe the retained target **at case end, after any cleanup**, not an immutable
copy of the heap at the throw. Individual failure contexts identify the original
phase/thread, failure cycles and trace PC separately. A quarantined active CPU
uses its next/current PC, not a fabricated throw instruction. Failed threads
have their failure trace PC. Prepare/runner failures without a retained guest
activation explicitly have no such thread.


## Shared attachment and UI

`ScenarioRunService.canInspect/inspect` compares exact retained result identity.
Result history alone cannot authorize an attachment. The `TestExecution` owns
borrowers and retires them before physical disposal. A rerun/new failure releases
the older target; historical strings remain readable. An independent UI or
conversation can detach without disposing the target or other attachments.
Guest cleanup may explicitly close a failed coroutine; its state then reports
`thread-closed` with no frame handle, rather than reading released registers.

The ordinary command is **Scenario Lab: Inspect Retained Test Target** for the
selected result. Keyboard/pointer expansion loads phase stacks, frame scopes
and value pages. Tables preserve alias/cycle identity, with no eager recursive
walk. Enter/Details shows full text or the exact compiled frame source. Escape
returns to the tree/results. Source-free property inspections hide the unused
Source action. Layout/paint never inspects guest registers or traverses tables.

`InspectionValues` is shared with authoring inspection, but each instance belongs
to one physical suspension. Locals read actual `CallFrame.registers`; upvalues
read that closure's capture through the existing CPU accessor. Values retain
guest kinds and stored table keys; unavailable compiler locations are explicit.

`TestDebugImage` owns source provenance. Accepted compiled source strings are
retained directly, including unsaved dependencies. BIOS/companion source records
hold zero-copy ROM byte views, decoded with the central UTF-8 decoder only on an
explicit source read. Physical execution domains/PCs remain unchanged; only
resource domains map the derived test socket back to the authored socket.

## Conversation tools

- `studio_inspect_test_target {result}` opens/replaces this prompt's attachment.
- `studio_read_test_stack {stack,start,count}` reads one failure's own stack.
- `studio_read_test_frame_scopes {frame}` exposes its locals/upvalue references.
- `studio_read_test_values {reference,start,count}` pages scopes or stored tables.
- `studio_read_test_frame_source {frame}` returns exact compiled source or explicit
  unmapped-source coverage, never a newer editor model.

All handles belong to the prompt/attachment. A new target, closed attachment or
retired prompt cannot silently refresh an old reference. There is no polling,
extra inference, new server or Codex-specific UI button. New tool names require
a newly created native Codex thread after rebuilding/reloading the ordinary
Studio/server; resumed threads retain their previously admitted catalog.

Receipts identify `role: retained-test`, `mode: post-mortem`,
`heap: retained-at-case-end`, failure versus observation cycles/video tick, and
`canResume/canStep/canEvaluate: false`. Budget/fault quarantine can end a case
without completing cleanup. Test image pixels, live stop/step/debug-rerun,
selected-frame evaluation and semantic builder tools remain explicitly open.

## Validation (2026-09-24)

- Real compiled tests inspect separate body/teardown locals (including identical
  names), closure captures, shared/cyclic tables, BIOS source and authored source
  domains in **both cartridge sockets**. Dirty newer source never replaces the
  compiled source. Actual authoring and retained-target state are compared before
  and after reads. O0/O3 quarantine tests check the current PC rather than PC-4.
- Guest cleanup explicitly closing the failed coroutine produces `thread-closed`.
  Replacement, foreign handles, prompt retirement, multiple attachments, new-run
  disposal and single immediate disposal notification are covered. Borrowers
  release guest references before the physical target is disposed.
- Full Lua suite: **2465 passed, 1 skipped**. Full rompacker suite: **162 passed**;
  final attachment/lifetime checks: **3 passed**. Full assistant suite:
  **36 passed**. The final expanded inspection workflow separately passes on
  **software, WebGL2 and WebGPU**, including ordinary inspection, Close and rerun
  invalidation. Each uses **10 model requests, 1 explicit prompt, 1 connection**.
- Those browser tests use the real authorized HTTP transport and native Codex
  app-server with a deterministic offline Responses fixture. This proves the
  tool round trip, not live-model reasoning or account sign-in. The visible
  ordinary tree and read-only compiled source were exercised with keyboard
  input; final WebGL2/WebGPU screenshots were visually inspected. Source setup
  was automated: this is not a UI-only authoring claim.
- The full ordinary Studio workflow passes on WebGL2 (**8981 host frames**),
  including manual tests, debugger, rewind and authoring controls.
- Browser Studio and Node tooling builds and IDE/common/browser/Node typechecks
  pass. The tests project retains **96 baseline diagnostics**, with zero added
  or removed diagnostics after normalizing source line positions.
- Strict architecture audit: zero issues. Core parity audit, indentation checks
  and `git diff --check` pass. No TS/C++ machine or BIOS semantics changed; this
  does not claim a native Scenario Lab adapter or a throughput benchmark.

Logs: `/tmp/test-inspection-{lua,rompacker,products,tests,build,audits}-final.log`,
`/tmp/test-inspection-assistant.log`, `/tmp/test-inspection-browser-final.log`,
`/tmp/test-inspection-lifetimes-final.log`, `/tmp/test-inspection-studio-final.log`. Browser request bodies and screenshots:
`/tmp/bmsx-studio-chat/test-inspection-*`.
