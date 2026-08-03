# Handover: terminal/debugger/Hot Resume/audio recovery

Date: 2026-08-03

Branch: `master`

The user committed every preceding recovery step, including the earlier
scheduler follow-up, deliberately so later work could not accidentally reset or
revert unrelated changes. Those commits stay in history. Continue from the live
checkout and never reset or revert them based on hashes or worktree descriptions
in this handover.

## Hot Resume init execution ownership (2026-08-03)

The CPU-hold change committed in `f883c509d` made the fault scenario return to
the host, but it was a workaround at the wrong owner. The root architectural
error was that the IDE Hot Resume task pushed annotated-init completion frames
and then synchronously drove them through `runSuspendedUntilDepth()`. A guest
breakpoint, print, hardware wait, or fault was therefore executed from inside a
tooling task instead of by the ordinary host-frame scheduler.

For an ordinary user-mode Hot Resume, the runtime task compiles, proves
relocation, installs media, relocates physical execution state, prepares the
debugger, and pushes raw completion-call frames while the scheduler is idle. It
then returns. The next ordinary `runWorkbenchHostFrame()` slice executes those
frames through the normal CPU/device scheduler. Guest output, breakpoint hooks,
device deadlines, Lua faults, BIOS monitor rendering, and input consequently
retain their existing owners.

A request made from the physical BIOS monitor uses the two-phase IDE/debugger
plan described below. Phase one only builds candidate media and arms an exact
user-frame fence. The plan raises an independent programmatic source on the
same physical supervisor-request line; the input owner combines it with the
host source as a wired OR. BIOS performs the physical supervisor exit through
its normal system-controller and exception-return path. Only after the
scheduler reaches that fence does a second runtime task prove the retained
frame prefix, discard the failed init-call batch, install the candidate, and
stage fresh init frames. Neither phase executes guest code inside the task.

The committed mirrored `cpuHeld()` behavior and its physical
`runSuspendedUntilDepth()` tests remain. That is a generic synchronous host-call
boundary, but Hot Resume is no longer a caller. No machine, CPU, firmware, ROM,
or cart path gains knowledge of Hot Resume, init batches, or source revisions.
The only executor extension is an opt-in raw pre-maskable-interrupt hook mask in
the already instrumented specialization; NMI delivery retains priority and the
ordinary uninstrumented runtime loop is unchanged.

The permanent Hot Resume IDE scenario now injects a call on a numeric value
inside the existing annotated `init`, invokes the real `performHotResume()`
action, and first proves that the tooling task neither executes guest code nor
stops at the init breakpoint. One ordinary machine frame reaches that
breakpoint. The scenario later waits for the physical fault word, asserts
supervisor mode plus the firmware monitor's halted input loop, captures the
physical terminal, posts a real F1 press/release, and captures the IDE source
overlay. The current run passes 89 assertions, including Hot Resume from an
existing
cart breakpoint and nested Hot Resume while stopped inside the annotated init.
Resume suppression is now a tooling-owned LIFO stack of physical frame depths,
so the newly pushed init reaches its own breakpoint without consuming the
relocated older frame's one-shot suppression; continuing then executes both
prints without the older frame immediately stopping again. It additionally
repairs the faulted init from the live BIOS monitor without reboot, proves that
phase one writes no machine/media state, that the internal fence does not become
a debugger stop, that the fixed init runs once, and that the retained game loop
continues without a second fault sequence. The current captures
are `tests/ide/screenshots/frame_00676.png` for the complete, sharp BIOS fault
at `entry.lua:21:2` and `frame_00689.png` for the subsequent IDE source overlay.
There is no separate post-recovery screenshot; recovery is proven by the live
CPU/media/global/fault-sequence assertions.

The separate `monitor_fault_probe` test still uses its source-defined,
uninitialized framebuffer. Rainbow pixels visible through transparent terminal
cells are therefore deterministic retained-underlay data, not damaged terminal
glyphs. Supervisor circuit 1 intentionally uses source-alpha composition over
retained cartridge circuit 2; making it opaque or clearing the cart fixture to
hide that data would degrade or mask the real architecture. That scenario now
waits on the physical fault word, captures the BIOS monitor, sends real F1, and
captures the IDE, but it is coverage rather than a product fix. Its current
three-assertion run passes; `frame_00068.png` is the firmware terminal and
`frame_00081.png` is the later IDE overlay.

The reported reboot-time font corruption was a real product defect, not a test
defect. Its producer correction is already part of the committed HEAD lineage,
so it does not appear in this follow-up diff. `ide/runtime/lua_pipeline.ts` now
lays out system public assets before compiling the rebuilt firmware;
`toolchain/ts/rompack/asset_symbols.ts` keeps final payload lengths as concrete
compile-time values while only layout-dependent addresses relocate; and
`toolchain/ts/rompack/blua32_tail.ts` preserves the immutable system payload.
This prevents the rebuilt BIOS font upload length from becoming an invalid
runtime operand. The Hot Resume scenario rebuilds the system ROM, cold reboots,
and captures the resulting physical boot font before continuing.

## `<init>` semantic correction (2026-08-03)

The implementation in `9078b7bbf` did not match the agreed design. It gave
`<init>` automatic cold-runtime call semantics and spread the annotation over
cart modules with no source callers. Both behaviors are rejected.

The actual language contract is deliberately narrow:

```lua
local function init<init>()
    -- the cart's existing preparation code
end

init()
```

- `<init>` adds **no call** to ordinary program execution. The explicit source
  `init()` remains the one and only cold preparation call.
- A program may mark multiple zero-argument, non-vararg, top-level local
  functions, both in its entry chunk and in statically required source modules.
  This language capability does not require carts to distribute their
  preparation across modules.
- The compiler emits each ordinary closure and retains it in a private slot so
  tooling can publish one raw callable vector. Hot Resume invokes the retained
  closures in dependency and lexical order after installing compatible code.
- The CPU, firmware, ROM header, runtime state and cart runtime know nothing
  about source revisions or Hot Resume. The annotation is a compiler/tooling
  contract only.
- `new_game()` remains exactly where existing carts already owned and called
  it. Hot Resume neither looks up nor invokes that name.

All cart changes introduced by the rejected distributed-init migration were
undone against parent `d5998b5eb`. For the `<init>` correction itself, the only
intended cart-source differences from that parent are these six existing entry
declarations changing from `function init()` to `local function init<init>()`
while their existing explicit `init()` calls remain.

- `carts/2025/cart.lua`
- `carts/emptycart/entry.lua`
- `carts/hot_resume_test/entry.lua`
- `carts/nemesis_s/cart.lua`
- `carts/pietious/cart.lua`
- `carts/vblanktest/entry.lua`

There are no cartlib or module-local `<init>` functions. The extra Pietious
`game_session.lua` from the rejected migration is removed, and the old
Pietious cart and headless test ownership are restored. Useful library support
for rebinding retained FSM, behaviour-tree and timeline runtime objects remains,
but it is reached only through the existing cart `init()` body and its explicit
calls.

The validation contract for this correction is stronger than compilation:
compiler execution tests must prove annotation-only cold count zero, including
multiple annotations in source modules, and an explicit cold `init()` count
one; linker tests must reject annotation add/remove/reorder/identity changes;
the full IDE scenario must prove Hot Resume reruns
`init` exactly once without rerunning `new_game`, reaches an init breakpoint,
prints through the terminal path, survives repeated revisions and reboots
without corrupting the font; and Pietious must pass its real headless world
scenario.

Current completion evidence:

- Relative to `9078b7bbf`, the compiler correction is exactly the deletion of
  the emitted `MOV`/`CALL` sequence at an annotated declaration. The existing
  multi-annotation, module ordering, hidden-slot and tooling-vector machinery is
  otherwise unchanged.
- All 748 files under `carts/` were compared to parent `d5998b5eb`. There are
  zero mismatches beyond the six declaration-line changes listed above, and the
  only shipped Lua `<init>` annotations remain those six.
- The compiler execution test uses four annotations across an entry and two
  source modules: cold execution leaves the counter at zero; the explicit
  tooling call then produces the dependency/lexical result `1234`. A separate
  test proves explicit source `init()` runs once cold and once more through
  tooling.
- The full Hot Resume IDE scenario passes 89 assertions over rejected edits,
  two consecutive revisions, system-only and no-op refreshes, retained heap
  identity, `init` counts, unchanged `new_game` count, breakpoint continuation,
  guest `print`, dual-cartridge selection, cold reboot, an init fault that
  reaches the physical terminal before explicit IDE entry, and repair/resume
  from that live monitor without reboot.
- The reboot breakpoint and the short cold-boot terminal were captured at
  `tests/ide/screenshots/frame_00635.png` and
  `tests/ide/screenshots/frame_00638.png`; both fonts are intact. The faulting
  Hot Resume captures and full diagnostic surface are documented above.
- Full Lua reports 540 tests: 539 pass and 1 is skipped; rompacker passes
  96/96. Pietious
  rebuilds and passes its real enter-world host test. `2025` and `nemesis_s`
  rebuild successfully. Machine and toolchain TypeScript compilation and the
  Browser Studio debug product build pass.
- AEM cold state is initialized once when its owner module loads. The existing
  cart `aem.reload()` calls now rebind event definitions without resetting live
  audio state during Hot Resume; no cart callsite or public API was added.

## Current continuation brief

The scheduler/fault-recovery implementation is now one IDE-owned vertical
slice. Continue from the live checkout; do not reconstruct it from the historical
commits summarized above and do not reset or revert the user's commits.

No commit has been requested.

## Current control flow

### User-mode Hot Resume

1. The IDE runtime task applies source overrides, compiles the candidate media,
   proves relocation against the live physical frames, installs it, updates
   debugger bindings, and stages the applicable system/cartridge annotated-init
   functions as ordinary completion frames.
2. The task returns without executing a guest instruction. Dirty code-tab
   sources are marked installed only after the media installation succeeds.
3. The next ordinary host frame executes the staged functions. Breakpoints,
   output, waits, IRQs and faults therefore use the ordinary instrumented
   CPU/device scheduler.

### Supervisor/fault recovery

1. Phase one compiles and lays out candidate media but performs no media or CPU
   write. It records the exact underlying user-frame
   `(depth, execution-domain, PC)` and arms an internal debugger fence.
2. The host frame waits until raw `SYS_STATUS` publishes
   `SUPERVISOR_RESUMABLE`, samples the aggregated request low for one machine
   update, and then raises only the plan-owned programmatic request source. It
   does not simulate a keyboard shortcut, write a supervisor control register,
   alter CP0, or call a system-controller method. A held host source remains
   independent.
3. BIOS owns monitor exit and restores its saved cartridge selection, EPC and
   status before exception return.
4. The instrumented CPU observes the selected raw domain/PC before pending
   maskable-interrupt delivery as well as before instruction execution. Pending
   NMI is delivered first. The fence can therefore stop before the exact
   retained user instruction without becoming a user debugger stop or editor
   presentation.
5. Synchronous fault capture writes the raw payload early. BIOS writes and
   flushes the physical monitor, enables its display, clears older queued
   firmware VBlank tickets, crosses the following VBlank, and only then issues
   `SYS_CONTROL.SUPERVISOR_FAULT_PUBLISH`, which advances the public fault
   sequence. After `executeHostUpdate()`, the workbench drains complete
   `SYS_PRINT` lines before reading that sequence and before consuming the
   fence. A new sequence wins: the generic plan lifecycle lowers only its own
   request source and the IDE presents the physical fault after firmware output.
6. If the sequence is unchanged and the fence was reached, the host queues phase
   two at the idle runtime-task boundary. It proves relocation against the
   supervisor-free retained prefix, discards the failed physical completion
   root or the incomplete prefix of its IDE-owned init-call batch, installs the
   candidate, relocates the retained state, and stages that work with the calls
   requested by the fresh rebuild. It again executes no guest instruction.
7. Only a successful phase-two installation marks the captured dirty code-tab
   sources as applied. The next ordinary frame executes init and continues the
   retained game.

A reboot from the editor action, host menu, or headless harness first discards
the generic debugger plans: the pending control plan and fence are cancelled,
its programmatic request source is lowered, and retained init-batch records are
cleared. The
ordinary cold-boot owner then proceeds. An unexpected new fault cancels only the
pending plan; it does not rewrite or hide the physical fault.

## Init-call batch ownership

Every staged Hot Resume dispatch is made from raw execution-domain and
function-record address words. The debugger plan manager records a LIFO batch
descriptor with its first physical frame index and the ordered execution-domain
word for every consecutive root. Cartridge is pushed first and system second,
so the CPU's normal LIFO order executes system first. Completed descriptors are
inspected and pruned when a subsequent Hot Resume is prepared, not on every host
frame.

A synchronous fault identifies a physical completion root from the existing
CPU `returnToCompletionLatch` bit. If that root falls within an IDE-owned init
batch, completed calls are the suffix above it and recovery restages exactly the
incomplete prefix through the faulting root. Thus a system-first fault retains
both calls, while a later cartridge fault does not repeat completed system
preparation. If the root is unrelated to such a batch, its exact marked frame is
used. The mirrored generic CPU abort primitive unwinds from that frame index and
clears the completion-result latch. It knows nothing about batches, tooling,
revisions or init, and already-performed guest writes are not rolled back.

## Representation and hot-path table

| Concern | TypeScript representation/owner | C++ representation/owner | Runtime/hot-path effect |
| --- | --- | --- | --- |
| Execution domain and PC | raw `ExecutionDomainId`, frame depth and 32-bit PC in CPU/debugger state | raw domain word, frame index and `u32` PC | Ordinary uninstrumented bulk loops contain no debugger hook or source lookup. |
| Exact user fence | IDE-owned `(frame depth, domain, PC)` plus one CPU-owned raw hook/mask binding | mirrored `ExecutionHookBinding` retains the native callback context and raw masks | The shared scheduler calls one CPU entry with only depth and budget. That entry checks the binding once before each bulk interpreter burst and selects its normal or instrumented specialization. The instrumented burst snapshots the binding, so hook-side reconfiguration affects only the next burst; the normal specialization never reads it. There is no scheduler mode branch, indirect strategy call or callback argument bundle. |
| Physical completion root | `CallFrame.returnToCompletionLatch`; `CPU.readFrameReturnsToCompletionLatch()` and `abortCompletionCall(frameIndex)` | mirrored raw latch bit and exact frame-index operations | Read/abort occur only while preparing fault recovery, never in instruction dispatch. |
| Init-call batch | debugger-plan-manager LIFO `{ firstFrameIndex, executionDomains[] }` records | none | Created when IDE stages consecutive roots; incomplete prefixes are decoded only during later recovery and records are otherwise pruned on Hot Resume/reboot. Machine code never classifies a batch. |
| Init dispatch | raw execution-domain word plus raw tooling-function record address in ordinary completion frames | mirrored generic completion-frame capability; native has no Hot Resume caller | IDE stages at the idle boundary; the next normal frame executes it with no Hot Resume branch. |
| Synchronous host result call | CPU completion frame and completion-value latch | mirrored frame and borrowed latch span | `Runtime.callClosure` remains the owner of `runSuspendedUntilDepth`; Hot Resume is not a caller. The committed physical `cpuHeld()` return remains. |
| Supervisor exit request | independent host/programmatic `Input` source levels plus one cached wired-OR output; raw sticky status/fault-sequence MMIO reads | no IDE plan; native machine consumes the same physical input/status contract | The input hot getter remains one boolean read. A nested monitor fault preserves the request; only supervisor leave or reset consumes it. |
| Fault publication | BIOS `SUPERVISOR_FAULT_PUBLISH` command after console/terminal/display commit; controller advances the raw sequence | mirrored raw command bit and `u32` sequence | One command at fault presentation only; no normal-loop polling, delay, string match, or terminal buffer. |
| Breakpoints and steps | tooling statement maps, raw domain/PC maps, LIFO physical-frame-depth resume suppressions | CPU sees only the generic hook words | No source path, symbol, revision or editor state enters the CPU. |
| Object/global relocation | tooling object-local slot and prior installed name/layout mapping | installed-image raw register slots | Revision build/install boundary only, not instruction dispatch. |
| Voice-clock hold | raw APU/system-controller hold state | mirrored physical hold state | Supervisor transition/APU service boundary; unrelated to the IDE plan. |

## Machine/tooling boundary audit

- Candidate revisions, breakpoint maps, fence identity, dirty-source completion
  and init-batch records all live under `ide/`; the rejected
  `RuntimeHotResumeState` no longer exists.
- The CPU additions are representation-level operations over raw frame state and
  a generic instrumented pre-maskable-interrupt hook mask. They contain no Hot Resume,
  source, editor, revision or batch branch.
- The system controller owns only a raw supervisor-fault publication command.
  BIOS emits it after committing the physical monitor. Neither owner contains
  IDE, revision, source-map, init-batch, or Hot Resume policy.
- The execution-owner follow-up changes no BIOS, cart, cartlib, compiler or
  toolchain source. The six
  committed entry-cart `<init>` declaration changes documented above remain the
  complete cart-language adoption. The committed BIOS fault-publication boundary
  remains unchanged.
- No machine-state capture/restore, transactional rollback, corrupt-state
  fallback, compatibility payload, or second guest scheduler was introduced.

## Continuation and validation gates

Inspect the live HEAD and worktree before every continuation; this document does
not pin either. The CPU execution implementation has one scheduler source in
each runtime. Do not restore the deleted TypeScript generator/template pair or
duplicate the scheduler merely to specialize CPU instrumentation.

Before claiming this boundary complete, run the machine and IDE TypeScript
builds, focused mirrored CPU/system/memory tests, the Release native test
surfaces, the full Lua suite, the core-parity and architecture audits, indentation
and `git diff --check`. Builds are not runtime proof: force the real Hot Resume
IDE scenario, the real headless system-print terminal scenario and the Browser
Studio debug build. Inspect the Release native object to prove the normal
interpreter specialization contains no execution-hook load or callback, the CPU
entry performs only the one pre-loop mode check and the executor slice contains
no hook-presence branch or callback argument bundle.

The 89-assertion IDE scenario proves both scheduler ownership and live fault
repair: phase one does not install media, leave supervisor mode, discard the
failed completion call or execute init; firmware exits physically; phase two
installs the fixed media; init and its `print` run exactly once through normal
frames; `new_game` remains at one; the original fault sequence does not advance;
the internal fence is not surfaced; no completion root remains; and the
retained game loop advances without reboot.

The retained fault/IDE captures remain:

```text
tests/ide/screenshots/frame_00676.png  # sharp physical BIOS init fault
tests/ide/screenshots/frame_00689.png  # later explicit IDE source overlay
```

The reboot breakpoint and short cold-boot terminal remain
`frame_00635.png` and `frame_00638.png`, with intact fonts. No separate screenshot
was added after live fault recovery; that final continuation is asserted from
physical CPU, media, global and fault-sequence state.

## Non-negotiable continuation rules

- Start from the live diff and the real owner files; do not reset or revert the
  user's commits.
- Do not reintroduce synchronous Hot Resume guest execution through
  `runSuspendedUntilDepth()`.
- Do not put revisions, source maps, init batches, relocation policy or tooling
  control into the CPU, system controller, firmware or cart code.
- Do not replace the physical supervisor-request input with a key simulation,
  direct MMIO/CP0 write or host call into firmware/system-controller control.
- Preserve `fault capture -> physical terminal/display commit -> discard old
  VBlank tickets -> fresh VBlank -> fault publication -> host output drain ->
  fault-before-fence consumption` ordering, and cancel pending plan state on
  all reboot entry points.
- Do not roll back guest side effects from a failed init. Weird but physical
  retained state remains deterministic.
- Do not add guards, fallbacks, migrations, facade layers, silence injection,
  output buffering or ordinary-loop debugger overhead.
- Treat builds as compile evidence. Keep the 89-assertion real IDE run, physical
  monitor probe and real cart run as the behavioral gates.
