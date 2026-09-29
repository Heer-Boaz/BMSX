# Studio startup and Reboot results

Status: implemented, 2026-09-23. Gate 3c of
[Studio foundation](studio_architecture_foundation.md), not Codex integration.

## Pre-implementation owner audit at `411b16616`

- Startup and Reboot mix source preparation, physical reset and editor feedback
  in `workbench/blua32_boot.ts`. Commands and the host menu queue that function;
  the headless harness bypasses the queue. Its boolean is not a retained result,
  and queued requests have no reset/shutdown lifetime.
- Startup raises `AwaitingLaunch`, but its preliminary physical reset invokes
  the shared reset observer, which clears that hold. A rejected initial source
  build then depends only on editor visibility to prevent executing packed code.
- The machine's real reset boundary is `Runtime.boot`/`onStateReset`. BIOS and
  cartridge entries are ordinary, potentially non-terminating Lua programs.
  There is no universal "game initialization finished" event. Do not infer it
  from a frame, an elapsed delay, the first cartridge PC or status text.

## Implemented contract

The session-owned `BootService` captures retained source revisions and the
requested entry at admission. Reboot prepares/installs/resets through the existing
exclusive queue. Startup runs synchronously after workspace recovery, before the
first host frame; it has no active machine workload to join. Construction of the
boot owner already sets `AwaitingLaunch`, so restored panes see closed execution
admission while source recovery is still in progress. The result
distinguishes physical `reset`, rejected preparation, failed
infrastructure and cancellation, and records whether media installation and
physical reset actually occurred. A reset result is **not** a passing game test
or successful guest initialization. Subsequent physical faults and debugger
stops remain observable through their existing owners.

Startup prepares sources before resetting hardware. A rejected initial build
still initializes the packed physical reset state for inspection, but leaves
the independent launch hold active: it must never execute that packed program
as a silent replacement for rejected authored source. A successful startup
needs only one physical reset. Explicit Reboot rejection leaves the previously
running machine, debugger stop and requested pause untouched.

New requests supersede older queued preparation. Reset/restore and shutdown
retire pending requests; the operation's own synchronous reset is not external
cancellation. Shutdown closes admission and joins queued work. Commands own
view transitions and feedback, not preparation, installation or success.
The Run menu, host menu and headless harness use this owner, not alternative
pipelines. Commands release requested pause and hide the editor only after a
successful reset. They report `Reboot: reset complete`, not game-init success.
Late Save/Reboot confirmation cannot reopen admission after shutdown.

Audio restart is part of the accepted Reboot. An audio failure after physical
reset reports that reset and installation have already happened, keeps execution
held and uses the queue's existing infrastructure-failure boundary. Nothing
restores the old machine to manufacture atomicity. A source-build rejection,
unlike a readback or transport failure, does not poison the exclusive queue or
invent a guest fault. Existing reset notification clears debugger plans,
completion batches, fault presentation and suspended inspection only when the
physical machine actually resets, not when preparation is requested.

No CPU/firmware change, guest-ready latch, per-frame polling, second scheduler,
source-to-machine metadata or rollback is part of this slice.

## Workspace restoration review (2026-09-29)

A persisted active Terminal reproduced a cold-start crash in
`applyWorkspaceAutosavePayload -> TerminalPane.activate -> canEvaluate ->
CPU.activeCartridgeSlot`. The boot owner existed, but did not set its launch
hold until `start()`, **after** pane restoration. The capability query therefore
reached an execution image that physical reset had not initialized. Server
connection composition had not even started; this was not a network failure.

`BootService` now sets its existing launch hold during construction. Recovery
can restore tabs and source models while Terminal/Actor execution remains
unavailable. Startup still consumes those recovered sources and releases the
hold only through the existing accepted-reset path. Moving physical boot ahead
of recovery would instead run stale packed sources. No extra readiness flag,
CPU fallback, discarded session or per-frame check is introduced. The inspection
test fixture explicitly acknowledges its already-reset runtime, rather than
pretending it is a cold-start workbench. Browser and Node share this owner;
native libretro already boots its runtime inside `LibretroContent` construction
before exposing it and has no Studio-pane restoration. No TS/C++ machine or
guest Terminal behavior changed.

Production code studied before the change:

- [VS Code TerminalService](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalService.ts)
  starts in `Connecting`, completes backend reconnection before publishing
  `Connected`, and awaits profile readiness where launch requires it. Restoring
  a view and admitting execution are distinct lifecycle concerns.
- [MAME running_machine](https://github.com/mamedev/mame/blob/master/src/emu/machine.cpp)
  begins in `PREINIT`, initializes devices/settings/UI, and enters `RUNNING`
  through actual reset. BMSX uses its existing launch hold for the analogous
  host admission boundary, not MAME's framework or a new state machine.

Validation of this correction:

- Before the change, the real server-backed product failed with the saved
  Terminal tab in an isolated workspace. The initial-admission assertion also
  failed. After the change, the same saved workspace starts and survives a real
  page reload without deleting the session or reopening Terminal by command.
  Lua returns `42` after both starts and the server connection is established.
- The standalone product repeats active-Terminal restoration using browser-owned
  persistence, then evaluates Lua successfully. Source creation/save/recovery,
  offline Lua/YAML/AEM edits and quota-failure recovery still pass with **zero**
  Studio API requests. Screenshots from both products were opened and inspected:
  `/tmp/bmsx-terminal-startup/after-*.png` and
  `/tmp/bmsx-studio-standalone/terminal-restored*.png`. These are actual product
  checks driven by Playwright keyboard/clipboard input, not a UI-only workflow
  or an assertion that terminal scrollback/drafts persist across process restart.
- ROM packer/boot checks: 186/186. Inspection-helper consumers: 187/187. The
  focused boot/Terminal/actor/debugger/frame-navigation set: 84/84 (overlapping
  the preceding suites). Standalone browser checks: 2/2. IDE/common-host
  typechecks and the strict boundary audit pass. Browser debug/release and Node
  tooling debug products were rebuilt. No native parity rerun is claimed.

Reproduce the retained regression with a rebuilt debug Studio and debug
BIOS/Nemesis ROMs:

```sh
node --import tsx --test tests/rompacker/boot_service.test.ts
node --import tsx --test tests/platform/studio_standalone.test.ts
```

## Production references studied before implementation

- MAME separates [reset scheduling](https://github.com/mamedev/mame/blob/mame0280/src/emu/machine.cpp#L418-L431)
  from [the actual reset notification](https://github.com/mamedev/mame/blob/mame0280/src/emu/machine.cpp#L895-L911).
  A machine reset is not a game-specific initialization guarantee.
- VS Code's [DebugSession launch request](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/debugSession.ts#L360-L377)
  is distinct from debuggee lifecycle; [restart retires existing requests](https://github.com/microsoft/vscode/blob/1.104.0/src/vs/workbench/contrib/debug/browser/debugSession.ts#L434-L447).
  BMSX uses those explicit boundaries, not DAP, a service registry or a framework.

## Validation

- Before the fix, the new browser scenario failed its first assertion: rejected
  startup had lost `AwaitingLaunch` through the preliminary reset observer.
  After the fix, closing the editor leaves cycles unchanged and does not run the
  packed cartridge. Successful source startup performs one reset rather than two.
- Eleven service tests use production-format BIOS/cart media and the real
  physical runtime. They cover exact source/entry capture, reset count, startup
  hold, Continue/frame-step exclusion, rejection without mutation, supersession,
  external reset, shutdown/join, readback failure, post-reset audio failure and
  first-bootable-socket policy.
- `--studio-boot-operations` passes on software, WebGL2 and WebGPU. It exercises
  an invalid project-file startup, real Run-menu Save/Reboot repair, actual BIOS
  and Nemesis execution, rejection at a physical Hot Resume init breakpoint,
  queued supersession and later typing, reset cancellation of that init,
  quick-menu Reboot from requested pause, injected readback failure, external
  physical reset and actual editor shutdown. Rejection, applied-source and
  quick-menu screenshots were inspected. This is **automated runtime/UI
  evidence**, not UI-only authored development.
- Rebuilt Node tooling passes a nine-assertion Reboot workflow through the same
  command/service: compile rejection, captured revision, supersession, physical
  reset before guest execution, then real cartridge execution. The existing
  no-source-change Hot Resume heap probe still passes all **47 assertions**.
- Hot Resume operation and Lua/YAML/AEM source-save browser regressions pass on
  WebGL2. Full Lua suite: **2280 passed, 1 skipped**. ROM packer suite: **158
  passed**. IDE/browser-host/Node-host typechecks, both Studio/Node tooling
  builds, strict architecture audit (**0 issues**), changed-file indentation
  and `git diff --check` pass.
- The tests-project typecheck still has **112 pre-existing diagnostics**;
  comparison with the preceding slice adds no diagnostic (one union's printed
  member order changes). The broad behavior-source browser fixture's documented
  old-AST failure remains separate debt; this is not a whole-Studio green claim.

Operation bookkeeping is per request, with no additional idle-frame work,
polling or CPU metadata. The reset-count and heap probes are specific
no-regression evidence, not a general performance claim.

Reproduction:

```sh
npm run test:lua
npm run test:rompacker
npm run audit:architecture-boundaries:strict
node tests/conformance/runtime_replay/browser.mjs --studio-boot-operations \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/studio-boot.png
npm run ide:test -- hot_resume_test tests/ide/boot_operations.idetest.js
npm run ide:test -- hot_resume_test tests/ide/hot_resume_heap.idetest.js
```

The browser runner requires built debug BIOS/Nemesis ROMs, the graph worker and
Playwright. It copies project files to a disposable directory and uses the
actual file API; the intentional invalid startup never touches authored cart
files. CLI probes require the rebuilt Node tooling and `hot_resume_test` debug
ROM. The older `hot_resume_entry_edit.idetest.js` callsite now awaits the reset
result, but that whole legacy script is not certified by this slice.
