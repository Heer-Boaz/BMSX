# Studio execution operation results

Status: Hot Resume implementation complete, 2026-09-23. **Only gate 3a** of
[Studio foundation](studio_architecture_foundation.md), not permission to add Codex.
Reboot/startup completion remains separate follow-up work; it must not inherit a
Hot Resume result by analogy. Source-save acknowledgement is implemented at its
own boundary; see [source save acknowledgements](studio_source_save_acknowledgements.md).

## Pre-implementation owner audit at `5c2b0ba27`

- `commands/actions.ts` captures document revisions and queues compilation, but
  returned `Promise<void>` after that queue task, even for a rejected
  build or a deferred supervisor-return installation.
- `runtime/hot_resume.ts` owns relocation, installation and init admission.
  `HotResumeSupervisorPlan` returns through actual firmware before it queues
  installation. Discard/fault cleared its input line without notifying
  the requester; a queued installation has no request-lifetime admission.
- `RuntimeDebuggerPlanManager` retains init completion roots for recovery and
  rewind exclusion, but silently drops completed/discarded roots. Its records
  inspected the CPU's active thread rather than the thread on which
  their roots were staged. A coroutine switch is not completion.
- `workbench/host_frame.ts` already observes physical fault sequences and prunes
  completed init batches after execution. These are the notification boundaries;
  do not add a poller, scheduler or normal CPU-dispatch hook.
- State reset/restore and editor shutdown are the lifetime boundaries. A retired
  queued installation must not publish media into a replaced machine/session.

## Contract

The session's Hot Resume service accepts exact model snapshots and returns one
operation with two distinct promises:

1. **Admission**: the exclusive task either admitted immediate/deferred runtime
   work, or rejected/cancelled it. This does not promise installed or running code.
2. **Completion**: actual init roots returned, source/relocation was rejected,
   runtime infrastructure failed, a physical guest fault blocked the operation,
   or its lifetime was discarded. Each result states whether application had
   already occurred. Installed source remains installed when init faults.

The operation retains source snapshots and progress (`queued`, `building`,
`waiting-for-user`, `installing`, `initializing`, terminal result). Nested Hot Resumes retain
independent outcomes; an older init is neither silently replaced nor reported as
finished when a newer batch returns. A guest-failed batch remains physically
retained for recovery even after its request has a terminal failure result.
A breakpoint/pause is pending, not success or cancellation.

Source preparation belongs to the workbench service; relocation/installation
and physical completion notifications belong to runtime tooling; command UI
projects results and requests playback. The operation queue is released before
waiting on guest progress. Shutdown closes request admission, discards pending
operation lifetimes and joins already queued tasks, never awaits guest progress
or unwinds guest state to manufacture completion.
The service retains the latest request for command feedback; older completions
cannot overwrite a newer request's status. Reset/shutdown retire that projection
without changing already returned terminal outcomes. A new request replaces
old transient feedback with pending, and guest faults never leave a success
toast from an earlier request on screen.

## Representation and performance boundary

Source snapshots and operation outcomes remain IDE data. The IDE observes the
existing `Thread`, its physical completion-root
frames, execution domains/PCs and raw supervisor sequence. The CPU owns all of
those representations; the IDE does not add revisions or operation IDs to them.
Completion bookkeeping is retained per explicit request; idle frames allocate
nothing. Existing plan/batch and host fault boundaries publish transitions.
Auditing that contract exposed a physical prerequisite: inherited protected
calls/coroutine resumers could consume an init error or yield, making completion
ambiguous. The separate [completion-call boundary repair](completion_call_boundaries.md)
fixes both CPUs using their existing frame bit and boundary scans, after a
mirrored representation/callsite audit. It adds no IDE metadata, saved state or
normal-dispatch hooks.

## Reference implementation studied

VS Code's pinned
[`DebugSession`](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/debugSession.ts#L386-L403)
separates request dispatch from
[stopped/continued/terminated events](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/debugSession.ts#L1096-L1152)
and [session teardown](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/debugSession.ts#L1462-L1484).
BMSX uses those lifecycle distinctions, not DAP, extension-host facades, timeout
heuristics, compatibility guards or VS Code's service registry.

## Acceptance matrix

- Build and relocation rejection: explicit result; no installed-media/guest
  mutation, no runtime-queue failure latch for rejected authored input.
- Immediate application: captured revision installed; completion remains pending
  until every staged init root on its actual thread returns.
- Breakpoint and nested init: independent pending/completed outcomes.
- Physical init fault: applied source plus fault result; retained stack available
  for repair; a later gameplay fault cannot retroactively fail completed init.
- Supervisor return: admission before application; callback/install/readback
  failure, plan replacement, reset and shutdown all have terminal outcomes.
- Edits made after admission remain unapplied; no duplicate active-widget route.
- Real browser/CLI workflows and screenshots remain separate from unit/typecheck
  evidence. The pre-existing broad browser/test-project failures stay visible.

## Implemented evidence

- Eight debugger-plan tests cover real physical roots, nested batches, fault
  notification/discard and a compiled coroutine switch. Nine service tests use
  production BIOS/cart media to cover captured documents, compile/relocation
  rejection, no-init completion, nested init, cancellation, readback failure,
  host failure and shutdown without guest execution.
- Browser `--studio-execution-operations` exercises real Nemesis, commands,
  debugger breakpoints, two physical init faults, BIOS-return plan replacement,
  successful recovery, captured source application, injected **second-task** readback
  failure after firmware return, and actual reset cancellation. Run separately
  on software, WebGL2 and WebGPU. These are automated runtime/UI checks, **not
  UI-only authored development**. Screenshots of the breakpoint, fault and
  source-applied state were inspected.
- Rebuilt Node tooling executes eight no-source-change Hot Resumes through the
  same operation service; **47 assertions pass**, with tracked guest heap,
  function/constant/module counts and code bytes unchanged across those calls.
  This is that probe's no-regression evidence, not a universal performance claim.
- Full Lua suite: **2275 passed, 1 skipped**. ROM packer suite: **147 passed**.
  Machine, IDE, browser-host and Node-host typechecks pass. Both Studio/Node
  tooling product builds and strict architecture audit (**0 issues**) pass.
- The tests-project typecheck retains exactly the same **112** diagnostics as
  clean `5c2b0ba27` (normalized file/message comparison). The unrelated broad
  browser behavior-source fixture failure documented in the foundation was
  reproduced again after the preceding workflow checks passed. It remains a
  gate-5 limitation; this focused suite is not a whole-Studio green claim.
- The older `hot_resume_entry_edit.idetest.js` callsites now explicitly await
  admission. That whole legacy script is not certified by this slice: its
  fault probe still uses the obsolete `0x08010428` address. The new browser probe
  reads the actual specification-owned `IO_SYS_SUPERVISOR_FAULT_SEQUENCE`.

Reproduction:

```sh
npm run test:lua
npm run test:rompacker
npm run test:coroutines
npm run audit:architecture-boundaries:strict
node tests/conformance/runtime_replay/browser.mjs --studio-execution-operations \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/studio-operations.png
npm run ide:test -- hot_resume_test tests/ide/hot_resume_heap.idetest.js
```

The browser command requires built debug BIOS/Nemesis ROMs, the Studio graph
worker and Playwright, like the existing Studio workflow runner. The CLI probe
requires the rebuilt Node tooling product and `hot_resume_test` debug ROM.
