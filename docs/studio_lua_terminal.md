# Studio Terminal

`View > BIOS Terminal` opens the **actual BIOS monitor**. It works without a
server or assistant. Studio draws its ordinary completed scanout and routes
focused keyboard input to the existing HID device. The same firmware runs on
TypeScript and native C++.

## Operation

- HELP, MEM, REGS, FAULT, FRAMES, LUA, CLS, CONT and REBOOT are the existing BIOS
  commands. Completion, command editing/history, pager, scrollback and cursor
  belong to `machine/bios/shell/*` and `machine/bios/tty/*`.
- The pane admits supervisor entry through the existing physical input request
  line, after outstanding GPU work settles. It runs on the normal host frame
  scheduler even while Studio holds ordinary gameplay.
- Keyboard focus is the same embedded-game focus used by Game View. Shift+F1
  or clicking outside the scanout releases it to Studio; clicking the scanout
  focuses firmware again. Opening the terminal command/tab also focuses the
  shell. No ordinary guest key becomes a global IDE shortcut.
- Changing tabs suspends the monitor without CONT, stack unwind or state restore.
  Reopening resumes that same physical shell and its guest-owned history.
- CONT leaves the BIOS through the real exception return. Studio holds
  the actual NMI caller before its next instruction or maskable IRQ, including
  returns into BIOS/IRQ code, and retains independent host pause. A physical BIOS visit retires an old source stop;
  hardware quiescence may finish a pending IRQ before NMI admission. It does not
  have the pinned-frame semantics of programmatic evaluation. Clicking/reopening Terminal admits a new entry.
- Workspace persistence records only the tab. The shell/environment are guest
  machine state, not another serialized host session.

There is no Studio-owned HELP parser, editable console, output transcript,
command history, "machine replaced" notice or host Lua interpreter.

## Programmatic evaluation is not another terminal

Debugger and agent tools need structured return values and selected-frame
bindings rather than simulated typing. `ide/runtime/lua_evaluation.ts` admits
one explicit `shell/repl` operation through `scheduleRuntimeGuestCall`:

- `cart`: free names read/write the actual ordinary global registerfile.
- `session`: the BIOS-owned persistent isolated environment.
- `frame`: the installed scope at a current source-debugger stop. Locals/captures
  resolve before globals; the pinned IRQ and its ancestors do not advance.

The loader, protected calls, environment, RAM function records and captured
closures remain in firmware and the ordinary CPU. Results are formatted once
at return, then published after GPU/history work settles. `print` output is
bounded **per operation** (2,048 lines); unsolicited game output is not copied
into a host console. No source is saved or installed and there is no writeback
pass, rollback, alternate interpreter or recovery fallback. If the machine/BIOS
is broken, this evaluator cannot replace it.

`studio_evaluate_lua`, `studio_evaluate_frame`, `studio_control_lua` and
`studio_terminal_status` retain their explicit operation protocol. Cancelling
before CPU admission revokes that admission; cancelling running work suspends
its real frames and mutations. A later explicit Continue resumes it. A physical
fault uses normal monitor/debugger recovery; reset interrupts the operation.
The operation stores no input draft, command history or terminal scrollback.

## Owners and representations

| Representation | TypeScript | Native C++ | Change |
| --- | --- | --- | --- |
| Supervisor request/status | Existing input line and SYS register words | Mirrored physical device | None |
| Shell command/editor/history/output | BIOS guest BSS and firmware | Identical firmware | None |
| Completed terminal image | Existing presenter scanout | Existing host scanout | Studio draws it in a pane |
| Studio admission/hold | `ide/runtime/bios_terminal.ts` control plan | No native Studio | Existing debugger/scheduler, not another CPU pump |
| Explicit evaluation/locals | BIOS loader plus source-frame binding | Same firmware and diagnostic directory | No firmware/CPU change |
| Agent result receipt | `ide/runtime/lua_evaluation.ts` | No native agent receipt | Operation only; duplicate console removed |

Affected execution callsites: opening schedules once through `RuntimeTaskQueue`;
`runWorkbenchHostFrame` runs the existing debugger plan. The explicit Terminal plan
observes SYS readiness during entry, then the retained physical NMI root. Its
instruction and pre-maskable hooks cover all execution domains: a physical NMI
can return into BIOS/IRQ code as well as a cart. No guest values are copied and
no hooks are installed in ordinary gameplay. This costs one root-depth check
per instruction while the interactive shell is open, not guest cycles. Output capture has one inactive-operation branch at the
existing system-output flush, not another decoder or collector.

Production reference: [VS Code TerminalInstance](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts)
connects its view to the real process input/output owner instead of implementing
another shell. BMSX's real shell is firmware and its existing transport is HID
plus scanout, not an OS PTY. [Frame-binding history](studio_terminal_contexts.md)
records the previous evaluator work independently of the removed Lua-only UI.
