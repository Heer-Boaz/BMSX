# Studio Lua Terminal

`View > Lua Terminal` opens a Lua REPL, not an operating-system shell and not a
replacement for the physical BIOS monitor. It works without Codex or a server.
The View command is also available in the command palette.
Execution requires a booted cartridge and is not admitted inside the BIOS
supervisor monitor or during another machine operation.

## Input and scope

- Enter submits one input; Shift+Enter inserts a newline. Held Enter does not
  repeatedly submit. The visible Run action also works with a pointer.
- Expressions return their values (`1 + 2`, `math.sqrt(9)`). Statements and
  explicit returns work too (`counter = 40; return counter + 2`).
- Up/Down at the input's first/last source line browse the last 100 commands and
  restore the unfinished draft when returning to the present. Multiline input
  uses the shared selection, clipboard and undo control.
- The **session has its own persistent namespace**. Assignments survive commands
  and closing the view. Locals last one input unless captured by a retained
  closure. These are not cart globals, module-local variables or selected-frame
  locals. There is no copied global registerfile and no writeback pass.
- The environment initially binds the ordinary base functions and the live
  `table`, `string`, `math`, `os`, `coroutine` and `lua_compiler` libraries.
  Its `load` defaults to this session environment; an explicit fourth argument
  still selects an ordinary guest environment table. Library references are
  real guest objects, **not a sandbox** or read-only copies.
- The firmware `load` subset remains the language boundary. For example, it
  supports lexical closures, calls, assignments, conditionals, numeric loops
  and `while`; table-constructor syntax and dynamic `require` are not added by
  the Terminal. The compiler reports unsupported input. There is no host-Lua
  fallback, cart source recompilation or hidden Hot Resume.

Output, errors and result tuples share bounded session scrollback (2,048
entries). `print` uses the existing BIOS console/debug-transmit device; Studio
observes the same complete lines as the host logger. Input and result strings
are snapshots, never retained borrowed guest objects. Transcript selection is
keyboard/pointer accessible; Ctrl/Meta+C copies the selected entry. Ctrl/Meta+L
or `Terminal: Clear Output` clears scrollback, not the Lua namespace/history.

## Execution and lifetime

Opening the Terminal inherits the ordinary workbench pause. Submission admits
one explicit guest completion call after outstanding GPU readbacks finish.
`scheduleRuntimeGuestCall` completes an already active IRQ before resolving the
firmware module and materializing its arguments. Compilation and execution run
on the ordinary scheduled CPU/device path, never inside a runtime mutation task.
The game continuation is held again when that completion frame returns. A
separate user pause is not cleared. Tool-directed execution stops rewind
collection rather than claiming these mutations came from recorded game input.

Control plans explicitly own their user-stop policy. Terminal calls honor
ordinary source breakpoints/steps; internal IRQ-return/rendezvous plans and
Actor Lab calls retain their existing suppression policy. A breakpoint suspends
the call's control plan without completing it or executing a second scheduler.

Only one call is admitted. Input entered while busy stays a draft; it is not
silently queued or executed later. Pause/Continue retains the physical call
stack and mutations. Continue from a normal breakpoint uses the debugger's
resume operation but retains Studio and user pause, unlike Continue Game.
Compilation and ordinary Lua runtime errors are protected by firmware `pcall`;
earlier mutations are not rolled back. A physical fault retains the existing
monitor/debugger recovery path. Infinite loops remain schedulable and pausable;
discarding their execution currently requires the existing explicit Reboot.
There is no fabricated cancellation/unwind or budget timeout.

The BIOS owns the environment and RAM closures as ordinary guest heap state.
Save/restore therefore saves/restores the session too. Reset starts a new Lua
namespace. Studio retains historical text and marks state replacement; it
retires pending observers before discarding debugger plans. Shutdown revokes
queued admission and drains its existing runtime tasks. Closing or detaching
the view does not disconnect or discard execution. Workspace serialization
stores only the Terminal tab, not a second copy of the guest environment.

## Owners

| Concern | Owner |
| --- | --- |
| Session environment, expression/statement loading, protected invocation | `machine/bios/shell/repl.lua` |
| Source parser/compiler, executable arena, RAM function records | Existing `machine/bios/compiler/*` |
| Admission, completion receipts, history and bounded transcript | `ide/workbench/services/terminal/*` |
| Scheduled guest call, IRQ return, breakpoint/physical fault control | Existing `ide/runtime/guest_call.ts` and debugger plans |
| Complete physical output lines | `hosts/common/system_output_log.ts`; optional observer does not consume the device twice |
| Draft, selection, measured rows and attached controls | `ide/workbench/contrib/terminal/*` |

There are **no TS/C++ machine changes**: the same firmware and raw RAM
function-record format execute on both machines. No opcode, register, machine
branch, global-table proxy, debugger heap root, or source-aware CPU state was
introduced. Ordinary gameplay does no REPL work. Output is decoded once;
unchanged scrollback is not remeasured per frame. New output measures only its
appended rows; font/width changes reflow retained entries.

## Codex boundary

The session service is independent of the pane and exposes an operation with a
completion result. **This slice adds no Codex execution tool.** A later adapter
must use this same admission/completion owner and explicit execution authority,
not the source-edit receipt or a server-side evaluator. Source proposals do not
become permission to run Lua. No operating-system shell, extra server, polling
or account controls are involved.

## Production references studied before implementation

- [Lua's interactive loader and protected REPL](https://github.com/lua/lua/blob/master/lua.c):
  expression-first loading, then statement loading on syntax rejection; only
  the accepted chunk executes. The alternate parse is input grammar selection,
  not recovery from invalid internal state. Locals do not survive separate
  inputs without a retained closure.
- [VS Code REPL model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/replModel.ts)
  and [view](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/repl.ts):
  session-owned input/results/output, bounded scrollback and input history;
  the view requests execution rather than implementing an interpreter.

## Validation

The automated `--studio-terminal` browser workflow uses actual Nemesis, BIOS
`load`, CPU scheduling and product input controls on software, WebGL2 and WebGPU.
It covers expression/statement results, print ordering, nil/false tuples,
persistent captures, local scope, nested load, syntax/runtime errors, history,
multiline input, copying output, pause/continue, breakpoints, busy drafts,
close/reopen, save/restore and reboot.
It is automated runtime/UI evidence, **not** a UI-only development session,
native-host Terminal UI, physical-phone test or Codex execution test.

Initial slice validation (2026-09-24):

- Terminal workflow passed on all three renderers; screenshots were inspected.
- Existing execution-operation and runtime-inspection workflows passed on WebGL2.
- Lua suite: 2,393 passed, one skipped, no failures; focused debugger/transcript
  tests: 32 passed.
- BIOS/cart and browser/headless-tooling builds passed. IDE, browser and Node
  product typechecks passed; the tests-project typecheck still reports its 96
  pre-existing diagnostics, not a clean typecheck.
- Strict architecture audit: zero issues. Changed-file indentation and
  `git diff --check` passed.

```sh
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- nemesis_s --debug
node tests/conformance/runtime_replay/browser.mjs --studio-terminal \
  dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom /tmp/studio-terminal.png
```
