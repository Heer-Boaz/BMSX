# Terminal binding contexts

## Implementation gate

The shared Terminal is an executor, not a second Lua interpreter. Context is
explicit in each evaluation receipt and historical input. Manual input defaults
to `cart`; the ordinary context picker also offers the persistent isolated
`session` namespace. Conversation requests always specify their context and do
not change the manual selection. Recalling source history uses the selected
context, like a debugger REPL; it does not secretly restore an older scope.

The BIOS loader without an explicit environment resolves unbound source names
to ordinary global registers. Lexical parameters, locals and upvalues still win.
An explicit environment table continues to select table-backed bindings. This
belongs in the compiler, not a metatable proxy or a Terminal-only rewriter.
`lua_compiler.compile_syntax` has the same rule; unbound generated lexical-symbol
identities remain errors, not stringified globals.

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Source identifier | Firmware syntax name / lexical symbol identity | Same guest syntax | Binder distinguishes lexical, environment and ordinary-global access |
| Global name | Guest StringId captured in RAM chunk constants | Same StringId | Compiler emits calls to existing boot get/set primitives, never caller-image global ordinals |
| Authoritative value | CPU ordinary global ValueSlots | CPU ordinary global tagged Value vector | Unchanged; direct read/write, no copied namespace or writeback |
| Executable | Firmware RAM function record and closure captures | Identical records/captures | Existing MOV/CALL path; no new opcode or CPU state |
| Isolated session | Firmware-owned environment table | Same table | Explicit session context retains existing semantics |
| Selected frame | Installed source scopes + physical suspended frame | Native has no source-debugger frontend | Still separate work; never substituted with cart/session |

Affected execution callsites: firmware `semantic.bind_identifier`, compiler
`prepare_path_operands`, `emit_path` and `emit_assignment` run only during explicit
load/compile_syntax. Loaded ordinary-global accesses use the existing
`CPU.callBuiltinFunction` / `CPU::callBuiltinFunction` GetGlobal/SetGlobal cases:
one name lookup and encoded value transfer; first definition reserves a register.
`shell/repl.evaluate` selects the compilation environment on submission.
Studio `LuaTerminalSession.evaluate` and physical monitor command submission
carry explicit context. No changes to normal/instrumented opcode dispatch,
GETGL/SETGL, GETSYS/SETSYS, scheduler, renderer, or idle per-frame work.

Named accesses are dynamic at execution, including inside retained closures.
The compiler captures the immutable boot access primitives, not the mutable
public `getglobal`/`setglobal` variables. An assignment to those names cannot
redirect identifier lookup. The system register bank remains separate; `irq`
in cart context is the cart's ordinary binding, not the BIOS vector. This is not
a sandbox: explicit Lua execution can mutate globals and live objects, and
pre-error writes remain performed. Load without an explicit environment now
has ordinary-global semantics rather than rejecting all free names.

The physical monitor uses `LUA <source>` for cart globals and
`LUA --session <source>` for the isolated session. Both execute the same BIOS
compiler and REPL on TS and C++; there is no native host evaluator.

## Production references studied

- [Lua parser lexical/global resolution](https://github.com/lua/lua/blob/master/lparser.c):
  lexical resolution precedes global lowering. BMSX lowers to its authoritative
  registerfile rather than copying Lua's table storage model.
- [Lua interactive loader](https://github.com/lua/lua/blob/master/lua.c):
  expression-first compilation and protected execution, not source substitution
  after execution failure.
- [VS Code REPL](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/replModel.ts)
  and [expression evaluation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugModel.ts):
  the frontend submits an expression and explicit selected frame to the executor;
  it does not implement scope resolution itself.
- [LLDB expression declaration resolution](https://github.com/llvm/llvm-project/blob/main/lldb/source/Plugins/ExpressionParser/Clang/ClangExpressionDeclMap.cpp):
  frame declarations are a separate compiler/debugger binding contract. This is
  the reference for subsequent frame-context work, not evidence that it exists.

## Selected-frame declaration contract

Before adding frame evaluation, the installed compiler symbols must distinguish
declaration mutability from physical location availability. `isConst` is a
required declaration fact on local slots and captured-local origins. It means
Lua `<const>` binding, not a frozen table, a constant-propagation result, or an
assertion that an optimized register is writable. A mutable declaration may
still have no live location. Inlining, source mapping and transitive captures
preserve this fact from the defining declaration. Dirty editor text does not
replace installed metadata.

| Representation | TypeScript | C++ | Execution impact |
| --- | --- | --- | --- |
| Authored binding | `LocalBinding.kind` -> required `isConst` on `LocalSlotDebug` | Consumes the same compiled symbols; no second compiler | Emitted once during compilation |
| Inline local | Remapped register and unchanged declaration flag | `Blua32LocalSlotDebug::isConst` | Tooling metadata only |
| Captured binding | `CapturedLocalDebug.isConst`, shared by upvalue binding indices | `Blua32CapturedLocalDebug::isConst` | Cell representation unchanged |
| Installed symbols | `Blua32SymbolsImage` binary serialization | Explicit symbols encoder/decoder | Read at tooling load, not by opcode dispatch |
| Inspection entry | `RuntimeLuaFrameBinding.isConst` -> `InspectedEntry.isConst` | No native Studio inspection frontend | On-demand suspended reads only |

Affected callsites: `FunctionBuilder.declareLocal` and `resolveUpvalue`, optimizer
`buildInlineExpansion`, symbol encode/decode, `runtimeLuaFrameScopes`, and
`InspectionValues.read`. Source-map and linker record propagation retain the
field. There are **no affected gameplay hot-path callsites**: CPU normal/debug
dispatch, closure allocation, upvalue closing, GC, scheduler, renderer, guest
compiler and firmware monitor are unchanged. No per-instruction check, new
runtime state, scope copy, or extra guest read is introduced.

The ordinary Scenario Lab property tree displays `<const>` on bindings; shared
runtime/test conversation results carry the boolean. Table children do not
inherit it. Globals have no lexical declaration flag in this contract.
This follows the separation in the
[Debug Adapter Protocol variable hints](https://github.com/microsoft/debug-adapter-protocol/blob/main/specification.md#types_variablepresentationhint)
and LLDB's declaration/location checks linked above, without adopting a second
protocol or a host evaluator.

This is a prerequisite, **not an implementation of selected-frame evaluation**.
That evaluator must bind exact installed locations, respect shadowing and
unavailable locals, and define escaped-closure lifetime. It must be admitted at
the selected stop, not after silently finishing the active IRQ. Native named
frame evaluation also needs firmware-readable binding metadata; host symbols
alone are not native Terminal feature parity. Normal compiler named registers
are monotonically allocated (`popScope` removes names, not slots), but repeated
inline invocations and loop activations still make an indefinitely retained
raw frame/register index an incorrect lexical capture model.

## Validation (2026-09-24)

- The actual browser -> authorized ordinary HTTP -> native Codex app-server ->
  deterministic local Responses workflow passes on software, WebGL2 and WebGPU.
  Conversation calls implicitly mutate a real ordinary global and the installed
  World object, execute nested `load`, retain pre-error writes, then observe the
  distinct isolated session. Context is present in receipts and scrollback;
  the manual choice is unchanged. The ordinary context selector reads back both
  namespaces. Breakpoint/Continue, queued cancellation, visible Stop, later-prompt
  control, dirty-source retention and stale operation rejection still pass.
  Sixteen expected model requests, one connection per workflow; no provider
  polling. Screenshots were inspected.
- The ordinary `--studio-terminal` workflow passes on all three renderers:
  default cart context, palette context selection, nested load, captures, print,
  errors, pause/continue, source stops, input history, pane close/reopen,
  save/restore and reboot. This is automated runtime/UI evidence, not a UI-only
  development session or physical-phone test.
- `test:terminal-parity` sends identical HID commands to the physical BIOS
  monitor on TypeScript and native C++. Debug-transmit output is byte-identical,
  including implicit reads/writes, the actual cart `new_game` call, local
  shadowing, retained closures with live global reads, nested load, isolation,
  nil/false, case handling and pre-error mutation. No host evaluator or injected
  global values. This is native firmware/runtime evidence, not a native Studio
  frontend or source-frame evaluator.
- Four compiler tests cover O0/O3, caller-image independence, mutable public
  accessor names, local/upvalue shadowing, tuple/loop/path/method emission,
  explicit environments, late global definitions, separate system bank,
  generated lexical-symbol identity, collection and exact restore. A retained
  loaded loop performs 10,000 global increments with unchanged guest allocation
  accounting **before** collection and unchanged register count. This is a
  bounded no-allocation check, not a universal performance benchmark. Boot
  primitives are captured at module initialization; firmware clears their
  boot-only registers afterwards.
- Final focused compiler/Terminal/global bundle: 18 pass. Full Lua: 2,508 pass,
  one skipped. Full assistant/browser: 45 pass. Rompacker: 182 pass. Product
  IDE/common/browser/Node typechecks and Studio/Node builds pass. The tests
  project retains its same 95 pre-existing diagnostics (normalized multiset
  compared with the pre-slice baseline), not a clean tests-project typecheck.
  Strict architecture audit: zero issues; core-parity audit, indentation and
  `git diff --check` pass.

These fixtures prove execution and transport, not live-model reasoning or
personal-account authentication. Selected-frame Lua bindings, test-target
evaluation, cross-turn test-debugger handoff, conversational Actor mutation and
complete apply/save/build/install/rerun acceptance remain open. Rebuild the BIOS
and linked carts together; old BIOS firmware does not implement the new context
argument. Existing conversations retain their original tool schemas as described
in [conversation compatibility](studio_assistant_conversations.md).

## Declaration metadata validation (2026-09-24)

- The same browser -> ordinary authorized HTTP -> Codex app-server ->
  deterministic Responses workflows now verify declaration flags on live
  Nemesis receiver/parameter/local/upvalue entries on software, WebGL2 and
  WebGPU. Each uses its existing 14 requests and one connection. A const local
  can simultaneously be `unavailable`; no value is reconstructed.
- The failed-test workflow verifies a `<const>` table binding and the actual
  member changed by teardown, through both conversation tools and the ordinary
  keyboard-driven Scenario Lab inspector. All three renderers pass (10 requests,
  one connection each). The inspected WebGPU screenshot visibly shows
  `probe <const> [string]` and mutable member `answer = 99`. This is automated
  integration/UI evidence, not a UI-only development session or live-model test.
- Fifty focused tests pass, including O0/O3 transitive captures, distinct
  shadowed declarations, dirty-source independence, generated source mapping,
  inline remapping, dead mutable locations and retained capture layouts.
  Const table-member mutation remains ordinary Lua. Inspections leave guest
  time/heap accounting unchanged and do not add register reads for metadata or
  unavailable locations.
- Full Lua: 2,513 pass, one skip. Rompacker: 182 pass. Full assistant/browser:
  45 pass. Native C++ symbol-format tests round-trip both declaration flag
  values. BIOS/Nemesis, browser Studio and Node tooling builds pass. Product
  typechecks pass; the tests-project diagnostic multiset remains the same 95
  pre-existing entries after source-position normalization. Strict architecture
  audit: zero issues; core-parity, indentation and `git diff --check` pass.

Debug ROMs must be rebuilt to carry the required symbol field; there is no
legacy-symbol default. Neither CPU implementation, BIOS evaluator nor machine
state format changes in this slice. Native codec coverage is not native named
frame evaluation. Selected-frame evaluation and its firmware metadata/lifetime
contract remain open as described above.
