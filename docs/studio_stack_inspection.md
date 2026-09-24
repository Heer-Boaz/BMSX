# Suspended stack and frame scopes

## Design gate

Studied before implementation: VS Code's
[StackFrame.getScopes and ExpressionContainer](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts)
bind lazy scopes/variables to a stopped frame. The
[DAP scopes and object-reference lifetime contract](https://github.com/microsoft/debug-adapter-protocol/blob/main/debugAdapterProtocol.json)
requires a frame identifier from the current suspension, not a reusable stack
index. These are ownership references, not a reason to introduce an adapter or
copy external-adapter defensive validation into the machine.

The existing runtime inspection owns stop-scoped frame and value handles.
`stack_trace.ts` maps physical frames and installed inline call chains;
`lua_inspection.ts` resolves compiler-owned local/upvalue locations. The CPU
already exposes raw frame registers and upvalues. No source concepts enter it.
Only the current CPU thread's live stack is exposed in this slice. A retained
fault diagnostic is reported separately, not silently substituted for that
stack. Suspended coroutines and retained test targets need their own attachment.

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Frame identity | Physical frame index, execution domain, function address and PC | Same physical CPU data | None |
| Local value | `CPU.readFrameRegister`, tagged guest `Value` | `CPU::readFrameRegister`, native `Value` | None |
| Captured value | `CPU.readFrameUpvalue` | `CPU::readFrameUpvalue` | None |
| Names, lexical/inline scope, live locations | Installed compiler symbol metadata in IDE | No native IDE | Tooling-only resolution |
| Borrowed frame/value handle | Existing RuntimeInspection lifetime | No native registry | New IDE scope/reference kinds |

Hot paths: no changes to either CPU, instruction dispatch, scheduler, firmware,
host-frame loop or rendering. Stack mapping, scope enumeration and register
reads run only on explicit inspection requests. Stack/scope metadata is cached
once per inspection; values and table pages reuse its existing borrowed-value
registry. No evaluation, heap copy, guest allocation, provider polling or second
execution loop is permitted. Existing invalidation before execution, restore,
reset and tool-context retirement expires both frame and value references.

An O0/O3 recursive-call test exposed a wrong symbol producer: the compiler
published a local's whole block as its scope, including its initializer. The
CALL input can temporarily occupy that future local's register. Register
liveness alone could therefore expose the callee as the unfinished result.
The compiler now emits the binder's actual visibility boundary as the existing
scope range's start. This also corrects ordinary hover and named-register
Hot Resume proofs; hover no longer repeats a binder visibility check. The
symbol shape is unchanged in TS/C++, and native symbol readers consume the
same corrected ranges. Rebuild debug ROMs to obtain corrected metadata.
Lua's [localstat/localfunc](https://github.com/lua/lua/blob/master/lparser.c)
similarly makes debug locals visible after initialization; BMSX retains its own
compiler liveness and installed-source representation instead of copying Lua's
VM storage. This is compile-time metadata work only, not a runtime check.

Frame locations always refer to installed symbols, not current working copies.
Recursive invocations have distinct handles; virtual inline frames retain their
physical-frame index and inline depth. Local scope resolution uses the exact
inline call chain and compiler live-word ranges. An unavailable register is
reported explicitly, never read as nil or resolved in an older invocation.
Shadowed bindings keep their declaration ranges instead of collapsing by name.
Upvalue scopes belong to the physical closure; virtual inline frames do not
pretend to own a separate closure. This is read-only inspection, not frame-context
Terminal evaluation or source stepping.

## Tools

1. `studio_runtime_status` exposes the target and inspection availability. A
   current source stop includes its reason, raw domain/PC and inline depth.
   Completed Terminal execution can still be followed by asynchronous history
   maintenance; completion is not a promise that every target operation is idle.
2. `studio_inspect_runtime` opens a suspended, idle target. Its coverage separates
   installed global bindings from the current CPU stack.
3. `studio_read_runtime_stack` pages top-first frames for that inspection ID.
4. `studio_read_frame_scopes` resolves one returned frame handle, lazily.
5. `studio_read_runtime_values` reads scope/table pages. Local/upvalue definitions
   use installed module paths and one-based ranges. A local without a compiler
   location is `unavailable`, not a guest nil value. Unmapped RAM functions and
   missing symbol sets have explicit scope coverage, not guessed local names.

The existing server and conversation transport carry these tools. There is no
new Codex control, background inspection feed, source install or hidden resume.
Use a new conversation to admit the additional tool names: the installed Codex
0.156.1 thread/resume protocol retains the thread's original dynamic tools;
Studio binds this tool set at thread/start, not by rewriting stored history.

## Validation (2026-09-24)

- Actual browser -> authorized server -> production Codex app-server -> local
  deterministic Responses fixture passes on software, WebGL2 and WebGPU. A
  Terminal call enters the real Nemesis `world_class:active_definition_view`,
  stops on its installed source breakpoint, and the model-side fixture receives
  six live frames, the actual receiver/locals, its captured table and an
  explicitly unmapped RAM caller. Continuation completes the same guest call;
  old handles expire, dirty source stays uninstalled and gameplay remains
  paused. Exactly 14 model requests, one prompt and one connection per run;
  no polling. Full assistant suite: 27 pass. Conversation screenshots showing
  the returned values were inspected; their text comes from the fixture, not
  a live model's reasoning.
- Eleven new O0/O3 tests cover recursion, caller versus inline scopes, shared
  captures, shadowed declarations, nil/false, folded/dead locations, incomplete
  initializers, in-flight assignments, fault versus live-stack identity and
  expired/foreign handles. Metadata-only reads do not touch registers; unavailable
  locations never read a stale register. Guest heap and machine time stay fixed.
  The focused inspection/compiler/conversation bundle passes 59 tests.
- Full Lua suite: 2445 pass, one skip. Source-map coverage additionally verifies
  that a local in a generated test wrapper receives the authored visibility
  boundary. The ordinary WebGL2 Studio workflow passes, including hover,
  debugger stepping, multiple Hot Resume edits, rewind, scene editing and
  isolated scenarios. These are automated workflows, not a UI-only development
  session.
- BIOS/Nemesis, browser Studio and Node tooling builds pass. IDE/common/browser/
  Node typechecks pass; the tests project retains exactly its 96 baseline
  diagnostics after normalizing source line positions. Architecture audit:
  zero issues; core parity and native symbol-format tests pass. The physical
  BIOS Terminal conformance still matches TS and C++ byte for byte.
- Five representative programs compiled at both O0/O3 against `123bbdc30` and
  this slice produce identical complete `Program` hashes, including instruction
  bytes, prototypes and constants. Only tooling metadata changes; neither normal
  CPU loop nor host-frame loop changes. This is code-generation/ownership
  evidence, not a new general throughput benchmark.

Source-debugger control tools are now covered by [the shared source debugger](studio_source_debugger.md).
Still open: selected-frame Terminal
evaluation, scenario execution/attachment, semantic builder operations and the
complete reproduce/fix/install/rerun workflow. Live-model reasoning and personal
account authentication are not established by deterministic provider fixtures.
