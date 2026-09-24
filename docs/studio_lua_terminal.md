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
- A final call forwards all results in a return or argument list, including nil
  and false (`return pcall(fn)`, `table.pack(fn())`). Parentheses deliberately
  select one value (`return (fn())`). A zero-result builtin produces no result,
  rather than a manufactured nil.
- Up/Down at the input's first/last source line browse the last 100 commands and
  restore the unfinished draft when returning to the present. Multiline input
  uses the shared selection, clipboard and undo control.
- Manual input defaults to **Cart globals**. Free identifiers read/write the
  ordinary registerfile: `score = score + 1` changes the binding read by compiled
  cart code. **Context** / `Terminal: Select Lua Context` also offers an
  **Isolated session** with its own persistent namespace. Both survive commands
  and closing the view. Locals last one input unless captured by a retained
  closure. Neither context injects module-local or selected-frame variables. At a source
  breakpoint, the same picker additionally offers explicit installed frames;
  those evaluate live locals/captures before cart globals.
  There is no copied global registerfile, namespace proxy or writeback pass.
  Context is fixed per call and recorded in its receipt and historical input.
  History recalls source into the visibly selected context, not an old scope.
- `getglobal(name)` and `setglobal(name, value)` access the **real ordinary
  global registers**, including cart values and published module roots. Returned
  tables/functions are live guest objects. In isolated-session context these
  are explicit operations; an unqualified `score` names a Terminal variable.
  In cart context the unqualified name already accesses that register. System registers and
  frame/module locals are not exposed through this API. See
  [named register access](global_register_access.md).
- The isolated environment initially binds the ordinary base functions and the live
  `table`, `string`, `math`, `os`, `coroutine` and `lua_compiler` libraries.
  Its `load` defaults to this session environment; an explicit fourth argument
  still selects an ordinary guest environment table. Library references are
  real guest objects, **not a sandbox** or read-only copies.
- Cart-context `load` uses the ordinary BIOS loader: without an explicit fourth
  argument, free names access ordinary globals, including the live standard
  libraries. An explicit fourth argument selects an environment table in either
  context.
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
`scheduleRuntimeGuestCall` completes an already active IRQ for cart/session
admission. Selected-frame admission instead pins that IRQ and every ancestor,
then invokes the named BIOS frame evaluator above them. Compilation and execution run
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

The ordinary server advertises `studio_terminal_status`, `studio_evaluate_lua`,
`studio_evaluate_frame` and `studio_control_lua`. They invoke this same session service without opening
a pane, synthesizing a click or adding a Codex-specific Terminal button. Tool
arguments must select the listed authoring target and explicit `cart` or
`session` context. The manual selection is not changed by a conversation call.
Use `studio_evaluate_frame` with a current source-stack handle for lexical frame
bindings; a `frame` string passed to `studio_evaluate_lua` is rejected, never substituted. See the
[binding contract](studio_terminal_contexts.md).
The [shared source debugger](studio_source_debugger.md) can step a stopped
Terminal call without replacing its execution plan. Terminal status exposes
both the active call and the last settled evaluation with its identity and
bounded historical output; a return reached through debugger controls therefore
does not lose its result. This is formatted history, not a retained guest borrow.
As with the other dynamically admitted Studio tools, start a new Studio
conversation to obtain tools added or extended since an older thread was created. The
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

The BIOS monitor accepts `LUA <source>` for ordinary globals and
`LUA --session <source>` for isolated bindings. It uses the same
`shell/repl.evaluate` and compiler. Expressions/statements, captures, nested load, protected
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
| Session / cart bindings | `shell/repl` guest environment table / real ordinary global registers | Same firmware and registerfile ownership |
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

The [binding-context implementation](studio_terminal_contexts.md) now compiles
implicit ordinary globals using those named boot primitives. A RAM chunk
inherits its caller's execution image, so emitting cart-local slot ordinals
under the BIOS caller would be incorrect. The preceding
[named-access slice](global_register_access.md) removed the stale CPU
global-table duplicate. Selected-frame bindings remain a separate debugger/
compiler contract; neither named access nor cart context supplies lexical locals.

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
  references for the still-open frame context work, not a justification to
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

## Firmware call-result arity gate

The audit found that the firmware compiler emitted every call with one result.
`return f()` therefore truncated real guest tuples, including `pcall` and
`string.find`. Its parser also discarded parentheses. Lua's production
[`retstat`, `funcargs` and `primaryexp`](https://github.com/lua/lua/blob/v5.4.8/lparser.c)
distinguish an open final call from a call adjusted to one value. BMSX now keeps
that distinction in its owned syntax and lowers it to the existing BLua32 arity
operands. No packed result table, source rewriting or host evaluator belongs in
this path.

| Representation | TypeScript runtime | Native C++ runtime | Producer change |
| --- | --- | --- | --- |
| Call syntax | Shared BIOS parser / syntax factory | Same ROM firmware | Preserve whether parentheses suppress result expansion |
| Value-position call | Existing `CALL C=1` | Same raw instruction | Unchanged single-value lowering |
| Final return-list call | Existing `CALL C=0`, `RET B=0` and physical frame top | Same raw instruction/top | Request and forward the complete tuple |
| Final argument-list call | Existing `CALL C=0`, enclosing `CALL B=0` | Same raw instruction/top | Consume all trailing results, including an empty tuple |
| Return storage | Existing register window and ordinary growth for actual results | Same register window | No per-result wrapper, table or copy loop in emitted code |

Changed callsites are BIOS `emit_call_expression`, `emit_return_statement`,
parser parenthesis/call production and `syntax_factory.call_expression`.
`emit_value` and statement-call lowering explicitly request one result. CPU
CALL/RET, protected calls, GC, save state, scheduler and Terminal admission are
unchanged. Only compile-time arity selection is new; there is no extra work per
game instruction. Validate mixed prefix/tail returns and arguments, methods,
parentheses, nil/false, actual empty tuples, large tuples and generated syntax
on both runtimes and through ordinary Terminal/tool transport. The existing
BLua implicit/empty-statement return convention is outside this slice.

### Firmware call-result validation (2026-09-24)

- The new O3 regression suite initially failed 15 of 21 cases. All 44 O0/O3
  tests now pass: exact tuple arity, retained nil/false, parenthesized calls,
  nested calls/methods, left-to-right evaluation, empty tails, 260-value tails
  and generated syntax. Retained forwarding loops allocate no guest wrappers
  between explicit collections after warmup.
- Twenty shared firmware O0/O3 vectors pass on TS/C++, with full serialized-state
  equality. The selected-frame fixture returns tuples through the real protected
  REPL, not a host result adapter. Public selected-frame admission remains closed.
- Identical HID input to the actual BIOS Terminal on TS and native C++ gives
  byte-identical output. `string.find` returns both positions; `pcall` forwards
  its complete tuple; a zero-result `setglobal` no longer prints a false nil.
- Ordinary keyboard/pointer Terminal workflows pass on software, WebGL2 and
  WebGPU, including visible tuple results and parenthesized calls. The real
  browser -> authorized HTTP -> Codex app-server -> deterministic Responses
  fixture receives full session/cart/protected/nested-load tuples and both
  `string.find` positions. The workflow still uses one connection and 16 model
  requests; no additional request, tool or button was introduced. Full assistant
  suite: 45 pass. Inspected the WebGPU `lua-tuples` and
  `terminal-tools-webgpu-conversation-results` screenshots. This is automated
  UI/transport evidence, not live-model reasoning or personal-account login proof.
- Full Lua suite: 2607 pass, one skip; ROM suite: 185 pass. Product typechecks
  and BIOS/Nemesis/Studio/Node builds pass. Tests-project diagnostics remain the
  same 95 baseline entries after normalizing positions. Strict architecture
  audit: zero issues; core-parity, changed-file indentation and `git diff --check`
  pass.
