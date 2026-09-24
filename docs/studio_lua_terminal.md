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
- `getglobal(name)` and `setglobal(name, value)` access the **real ordinary
  global registers**, including cart values and published module roots. Returned
  tables/functions are live guest objects. These are explicit operations; an
  unqualified `score` still names a Terminal variable. System registers and
  frame/module locals are not exposed through this API. See
  [named register access](global_register_access.md).
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

Both machines execute the same firmware and raw RAM function-record format.
Named global access adds two mirrored boot primitives and removes the obsolete
CPU global-table duplicate; saved registers are authoritative (file schema 3).
No opcode, global-table proxy, debugger heap root, source-aware CPU state or
per-instruction Terminal branch is introduced. Ordinary gameplay does no REPL work. Output is decoded once;
unchanged scrollback is not remeasured per frame. New output measures only its
appended rows; font/width changes reflow retained entries.

## Codex boundary

The ordinary server advertises `studio_terminal_status`, `studio_evaluate_lua`
and `studio_control_lua`. They invoke this same session service without opening
a pane, synthesizing a click or adding a Codex-specific Terminal button. Tool
arguments must select the listed authoring target and explicit `session`
context. `cart` and `frame` are rejected rather than silently substituted.
The [shared source debugger](studio_source_debugger.md) can step a stopped
Terminal call without replacing its execution plan. Terminal status exposes
both the active call and the last settled evaluation with its identity and
bounded historical output; a return reached through debugger controls therefore
does not lose its result. This is formatted history, not a retained guest borrow.
As with the other dynamically admitted Studio tools, start a new Studio
conversation to obtain tools added since an older thread was created. The
installed native resume contract does not rebind that thread's tool definitions;
see [conversation compatibility](studio_assistant_conversations.md).

Evaluation and Continue wait until a real return, protected Lua error,
breakpoint/pause, interruption or host error. Results include the evaluation
identity, formatted return values and bounded input/output/result entries;
retention or Clear loss is explicit (`outputTruncated`). Status reads are on
demand, not a provider polling loop. A debugger pause releases the tool waiter
so the conversation can issue a subsequent Continue with the same identity.

Conversation Stop, disconnection and request retirement revoke queued admission
or suspend the owned call. The suspended physical evaluation survives the
prompt, appears in the normal Terminal, and is controllable by a later prompt.
Settled waiters detach their cancellation listeners. Late cancellation does not
override newer manual Continue intent. A new evaluation cannot replace a paused
one, and source-edit approval is not interpreted as execution authority.

## Physical BIOS Terminal and native parity

The BIOS monitor accepts `LUA <source>` and uses the same `shell/repl.evaluate`
and guest environment. Expressions/statements, captures, nested load, protected
errors and retained mutations therefore have one firmware implementation on
TypeScript and C++. `HELP LUA` describes the command. The command word remains
case-insensitive; source preserves lowercase and Shift input. The firmware's
existing uppercase-identifier restriction still applies; string contents retain
case. The monitor keeps its ordinary command completion/history and bounded
single-line input; Studio's multiline editor is a different frontend.

The physical monitor evaluates on its actual BIOS call stack. It has no native
source-debugger frontend or Studio pause/Continue buttons. An infinite command
retains its ordinary CPU execution; this change adds neither an in-guest unwind
facility nor a native Codex server. Native parity here is firmware evaluation
and namespace semantics, not feature parity with an IDE that native does not
have. The TypeScript/C++ CPU, value and closure representations are unchanged.

### Implementation gate: conversation execution and physical monitor

| Representation | TypeScript machine | C++ machine |
| --- | --- | --- |
| Submitted source | Guest StringId, interned at admitted call / BIOS input boundary | Same guest string through BIOS input boundary |
| Compiled chunk and captures | Firmware RAM function records and ordinary guest closures/upvalues | Identical firmware records and guest closures/upvalues |
| Session bindings | `shell/repl` guest environment table, not CPU global registers | Same firmware-owned table |
| Results / print | Completion values formatted by suspended guest inspection; debug TX drained once | BIOS formats protected call results; ordinary debug TX |
| Call control | Existing workbench debugger plan, ordinary frame scheduler | Monitor's actual BIOS call stack, ordinary frame scheduler |

That initial tool/monitor slice needed no CPU/VM representation or hot-path
opcode changes. The affected
execution callsites are `runWorkbenchHostFrame` (one idle scalar check for
Terminal stop observation), `scheduleRuntimeGuestCall` (unchanged scheduled
admission), and BIOS monitor command submission / HID key translation. The
compiler and REPL run only on explicit evaluation. The physical monitor has no
host-side source debugger: parity here means the same firmware evaluation and
namespace semantics, not a fabricated native IDE.

Implicit cart-register and selected-frame bindings remain a separate
compiler/debugger contract. A RAM chunk inherits its caller's execution image,
so emitting cart-local slot ordinals under the BIOS caller would be incorrect.
The subsequent [named-access slice](global_register_access.md) removes the stale
CPU global-table duplicate and exposes the real registerfile through firmware
`getglobal`/`setglobal`. These do not depend on caller-image ordinals or pretend
to supply a stopped frame's lexical scope.

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
- [DAP evaluate context](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md)
  and [LLDB expression declaration resolution](https://github.com/llvm/llvm-project/blob/main/lldb/source/Plugins/ExpressionParser/Clang/ClangExpressionDeclMap.cpp):
  source/frame bindings are a debugger/compiler responsibility. These are design
  references for the still-open cart/frame context work, not a justification to
  add source-aware CPU state or a copied global table.
- [Playwright target stability](https://github.com/microsoft/playwright/blob/main/packages/injected/src/injectedScript.ts):
  the shared canvas UI test helper waits for the actual target rectangle, not
  merely the outer canvas. The conversation workflow deterministically expires
  a status row during hover, reproducing a formerly timing-dependent missed
  Stop click without changing application cancellation semantics.

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

Conversation/monitor slice (2026-09-24):

- The real browser -> authorized HTTP -> Codex app-server -> deterministic
  Responses fixture executes firmware Lua, receives a real BIOS breakpoint,
  continues the same call, reads print/nil/false results and protected errors,
  and rejects an unsupported context. Manual Terminal input observes the same
  namespace. Visible conversation Stop suspends an infinite call, a new prompt
  observes it, and stale evaluation identities are rejected. Explicit Reboot
  ends the retained call. Software, WebGL2 and WebGPU pass; screenshots inspected.
  This is transport/execution evidence, not live-model reasoning or phone proof.
- `npm run test:terminal-parity` sends identical physical HID input to the actual
  BIOS monitor on TypeScript and native C++. The complete debug-transmit output
  is byte-identical, including captures, case handling, nil/false, nested load,
  syntax/runtime errors and pre-error mutation. No IDE evaluator or CPU-global
  injection is involved. It is native runtime/firmware evidence, not native UI
  interaction or selected-frame binding proof.
- Full assistant suite: 24 pass. Lua suite: 2429 pass, one skip. Product IDE,
  common/browser/Node typechecks pass; tests-project diagnostics remain the same
  96 pre-existing errors. Focused lifecycle tests cover listener cleanup, queued
  cancellation, bounded output, replacement and newer execution intent. Actual
  queued admission cancellation is also exercised against the browser CPU.
