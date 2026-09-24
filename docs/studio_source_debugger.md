# Shared source debugger operations

## Design gate

Before implementation, studied VS Code's [debug session](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugSession.ts)
(`sendBreakpoints`, `next`, `stepIn`, `stepOut`, `continue`, `getLoadedSources`)
and the [DAP contract](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json).
Requested source locations and their actual installed bindings are different;
a continue/step acknowledgement is not a stopped event. BMSX uses those
contracts without an adapter process, generic command facade or another CPU loop.

The runtime breakpoint model owns requested source lines, compiled bindings and
change notifications. Gutter controls, persistence and tools share it. Exact
statement locations bind; blank/optimized-away lines remain explicitly unbound.
Tools read installed source through image-scoped handles, not dirty working-copy
receipts. Replacing the installed image expires those handles.

The source-execution owner admits one operation and observes ordinary host-frame
execution. Continue, Into, Over and Out resolve on an actual stop, control-plan
boundary, interruption, fault or machine replacement. Source steps require a
source-debugger stop. Continue can also begin from an ordinary paused target.
An existing Terminal guest-call plan is retained, not replaced by a fake plan.
Tool execution retains Requested pause and can run behind the workbench, except
blocking workbench modals. Manual source commands use the same owner with their
game presentation policy. No source operation silently seeks/bypasses history.

The shared `SourceDebugger` matcher does not install CPU hooks or drive a
Runtime. Its composition installs the binding. Steps select an actual CPU
thread, not a depth that could belong to another coroutine. All three step modes
stay on that thread; breakpoints can still stop other threads. Return/failure
ends the operation before resumer code with `thread-completed`. Resume
suppression identifies the actual thread and frame activation. Statement
binding is shared with the isolated test-debugger kernel, not with its mutable
breakpoint requests or execution policy.

Cancellation releases only this operation's debugger intent. It pauses its own
still-current execution but never newer manual transport or guest-call intent.
Source-operation ownership, host transport revision and history revision are
separate. A guest-call boundary ends stepping before ordinary gameplay resumes.
The Terminal retains its last settled, formatted result separately from the
active call, so a debugger-controlled return remains observable on demand.

The real cart test exposed a pre-existing depth-only return fence: returning to
a HALT-waiting caller can let the physical scheduler enter IRQ before the next
debugger hook. That IRQ reuses the returned call's stack depth. Guest-call plans
now distinguish a completion root by its existing `returnToCompletionLatch`
flag; exception-return admission remains a distinct boundary. No IRQ statement
is mistaken for a source Step Out while the Terminal still claims to be running.
The receipt records the actual stopped machine position, which can include a
hardware wakeup/IRQ entry, not an invented earlier RET timestamp.
Host-frame composition also restarts history collection in the same frame that
a mutation plan ends. Its checkpoint is admitted before source-operation
observers settle; GPU-backed capture cannot surprise the next tool as a delayed
post-completion admission.

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Physical execution | CPU raw domain, PC and depth; instrumented bulk executor | Same raw CPU contract | None |
| Completion root | Physical frame `returnToCompletionLatch` | Same physical frame flag | IDE plan reads existing representation |
| Statement/inline location | Installed compiler symbol metadata | No native IDE | Tooling only |
| Requested/bound breakpoint | Shared IDE breakpoint model | No native IDE | Remove UI ownership |
| Execution intent/completion | IDE debugger + HostExecutionControl | Native host execution unchanged | Shared IDE operation |
| Lua Terminal | Existing BIOS REPL and guest-call plan | Same BIOS REPL | No evaluator/ABI change |

Hot paths: the uninstrumented TS/C++ opcode loops, machine scheduler and
renderers stay unchanged. The existing instrumented execution hook consumes
precomputed PC maps. Step maps are cached per installed image set instead of
rebuilt for each step. Host-frame composition observes the operation before
execution and after presentation, with an idle return; no per-frame source scan,
allocation or provider request. Breakpoint binding runs on explicit changes or
image installation. Source catalogs/text are read on demand. The active guest
call's existing instrumented `shouldStop` checks the completion-root flag as
well as depth; ordinary gameplay has no such plan or check.

## Tools and limits

- `studio_list_debug_sources` lists source handles for the installed BIOS and
  cartridges. `studio_read_debug_source` reads that exact text and its current
  breakpoints. Listing again replaces this prompt's catalog; installing another
  image expires affected handles. Working-copy editing uses its separate source
  tools and review receipts.
- `studio_set_breakpoints` replaces one source's requested lines, preserving
  every other source. An empty list clears that source. Results include exact
  bound PC/column/inline-depth locations or an explicit unbound reason. The
  ordinary gutter and workspace persistence use the same model; a gutter toggle
  now also reports an unbound request instead of claiming a binding.
- `studio_resume_debugger` accepts `continue`, `into`, `over`, or `out` and waits
  for a real outcome. Runtime status advertises availability. Continue may run
  indefinitely without a stop; the conversation's existing Stop cancels only
  its own execution. It neither discards the Terminal stack nor undoes mutations.
- Source control is for the authoring target's current execution, not an
  independent suspended-coroutine attachment or a retained failed-test target.
  Source coordinates refer to installed code. A new inspection is required
  after any execution; old frames/values cannot be refreshed in place.

No buttons, server, provider polling, hidden source installs or command-string
tool are added. Reload the built Studio and restart an already-running existing
server to load its updated tool catalog. Start a new conversation to admit the
new tool names; the installed Codex resume protocol retains the original
thread's dynamic tools.

## Validation (2026-09-24)

- Browser -> authorized existing server -> production Codex app-server -> local
  deterministic Responses fixture passes on software, WebGL2 and WebGPU. All
  breakpoints and source controls in this workflow are model-side tool requests,
  not harness-injected debugger commands. The fixture reads the installed
  `cartlib/world/world.lua`, requests one emitted and one blank line, calls the
  actual Nemesis world method through Terminal, reads its stopped stack, steps
  Into/Over/Out, observes completion of the same evaluation and clears its
  breakpoints. A second conversation turn really runs the game behind chat;
  visible Stop interrupts that owned execution and leaves it paused. Exactly
  18 model requests, two prompts, one connection and one interrupt per backend;
  no polling. Full assistant suite: 30 pass.
- Dirty working-copy text and installed media remain unchanged. The initial
  source stop is line 336 and Step Into reaches installed line 337. Old frame
  handles expire. WebGL2/WebGPU conversation/Stop screenshots were inspected;
  their summary text comes from the deterministic fixture, not live-model
  reasoning. No new buttons or private server were used.
- O0/O3 unit tests cover actual physical/inline steps, cached statement PCs,
  bound/unbound lines, idempotent updates, persistence/change notification,
  stale installed-source handles, owned cancellation, newer manual intent,
  retained guest-call plans, async history work, faults, reset and shutdown.
  Two additional raw-CPU tests reproduce a returned completion root followed
  by IRQ entry at the same stack depth and prove that no IRQ instruction is
  executed before the call's completion is observed. Focused bundle: 116 pass.
- Full Lua suite: 2459 pass, one skip. Complete ordinary Studio workflows pass
  on software/WebGL2/WebGPU; WebGL2 was rerun after the history-admission fix.
  These include ordinary source stepping, Hot Resume, hover, rewind, canonical
  scene editing and isolated scenarios. This is automated workflow evidence,
  not a UI-only development session or proof that Codex can yet drive builders.
- Browser Studio and Node tooling builds and IDE/common/browser/Node typechecks
  pass. The tests project still has its same 96 pre-existing diagnostics after
  normalizing source line positions. Strict architecture audit: zero issues;
  core parity and real BIOS Terminal TS/C++ HID/output parity pass. Changed-file
  indentation and `git diff --check` pass.
- No machine/BIOS/native code, uninstrumented dispatch, opcode or register
  representation changes. Ordinary idle host frames add only the operation
  observations. This is ownership/hot-path inspection evidence, not a new
  general throughput benchmark.

Scenario run/wait/cancel and read-only retained failure inspection are now
implemented in their separate shared services/tools. Selected-frame
[Terminal evaluation](studio_terminal_contexts.md), [live test debugging](studio_test_debugger.md)
and selected [behavior source edits](studio_behavior_tools.md) now have their own
public routes. Extended frame recovery/restore and the complete
reproduce/fix/save/install/rerun workflow remain open. Live-model reasoning and personal
phone/LAN interaction are not demonstrated by these deterministic fixtures.
