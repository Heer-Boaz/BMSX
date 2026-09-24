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

## Physical frame-evaluation gate

The next layer executes against a pinned ancestor on the evaluator's own guest
thread. It is not evaluation on an independently resumable coroutine. Lua's
[debug library](https://github.com/lua/lua/blob/master/ldblib.c) and
[physical local access](https://github.com/lua/lua/blob/master/ldebug.c) read/write
the real stack; VS Code JS Debug's
[frame evaluator](https://github.com/microsoft/vscode-js-debug/blob/main/src/adapter/evaluator.ts)
passes an explicit frame to the execution owner. BMSX keeps name resolution out
of the CPU and does not copy their generic temporary-name or global-hoisting
fallbacks.

| Data | TypeScript | C++ | New owner behavior |
| --- | --- | --- | --- |
| Thread | Tagged `Thread`, `frames` | Tagged `Thread*`, `frames` | Existing guest/GC representation |
| Local location | Physical frame index and register index; `ValueSlots` | Same indices; tagged `Value` register window | Boot get/set primitives transfer raw values directly |
| Upvalue location | Selected frame closure cell, open or closed | Same closure cell | Existing open/closed cell datapath, no synthetic capture |
| Frame count | `thread.frames.length` | `thread.frames.size()` | Raw stack depth, not a source stack |
| External binding | Guest descriptor: index, upvalue, available, is_const | Identical guest table | Compiler resolves after own lexical names, before globals/environment |
| Evaluation lifetime | Firmware scope holds guest thread until protected evaluation returns | Same firmware/GC | Expiration clears thread; escaped closures error, never access a reused frame |

Affected runtime callsites are the five new cases in
`CPU.callBuiltinFunction` / `CPU::callBuiltinFunction`: `FrameCount`,
`GetFrameRegister`, `SetFrameRegister`, `GetFrameUpvalue`, `SetFrameUpvalue`.
Upvalue writes reuse `copyRegisterToUpvalue` / `writeUpvalue`. Only generated
external-binding accesses call them, through firmware scope accessors. They add
no allocation to the primitive datapath. Compiler bind/prepare/emission and
`shell/repl.evaluate` change at explicit submission. Scope/accessor closures are
allocated once per frame evaluation; execution uses ordinary CALL/RET and the
existing scheduler. Normal/debug dispatch loops, frame push/pop, GC traversal,
save-state encoding and render loops gain no scope check or metadata lookup.
Boot installation/retirement now includes five more private primitive slots;
that cost is paid at startup, not per frame or instruction.

These are trusted firmware primitives, captured before boot registers are
cleared, not a public raw-slot debug API. The admission owner must supply valid
installed locations for exactly the selected suspension. A scope owns references
to locations, never copied local values or writeback. Const/unavailable binding
errors are compilation errors, including inside a nested function. A nested
public `load` still has its normal global/environment semantics. A closure may
escape; only its later access to an expired frame binding fails. A value copied
explicitly into a new evaluation-local variable has ordinary Lua lifetime.
Pre-error writes remain real.
The REPL captures its loader and protected-call primitive during firmware
initialization. Assigning to the public `pcall` or `lua_compiler.load` binding
changes that guest binding, not the evaluator's execution/protection mechanism.

A physical slot is not a deoptimization promise: optimized caller instructions
may no longer reload a source value, and an eliminated assignment has no
writable source location to reconstruct. The eventual installed-symbol
admission must respect this. Fixture-owned parameter locations below prove the
datapath, not a native source resolver.

The borrower must keep the selected activation pinned until scope closure.
Protected return/error closes the scope; cancellation, abort, frame relocation,
rewind and external coroutine closure require the execution admission owner to
retire that borrow before changing the stack. This is an explicit owner
obligation, not an instruction-loop stale-frame check. That public admission
lifecycle is not implemented by the core scope alone. The coroutine fixture
suspends and resumes a pinned activation; it does not authorize arbitrary
concurrent execution against its frame.

The firmware core alone does not admit a Studio frame handle or discover native
frame names. Those consumers remain gated on at-stop admission, shared binding
metadata, and target/lifetime tests; there is no public tool `frame` context
until that full route exists.

## Capture-location producer gate

Live inspection found a missing producer fact: the optimizer lowers an inlined
`GETUP`/`SETUP` to a caller register or caller upvalue, but previously retained
only local-slot locations. Capture identity must survive that lowering and
subsequent upvalue compaction. It is not valid for evaluation to reinterpret a
missing captured name as an ordinary global.

The existing physical diagnostic directory is the eventual firmware-readable
metadata owner; no second source-symbol database belongs in the CPU. Before
extending that directory, the compiler must emit correct capture locations for
physical and logical inline frames. LLVM's
[location-list producer](https://github.com/llvm/llvm-project/blob/main/llvm/lib/CodeGen/AsmPrinter/DwarfDebug.cpp)
keeps declaration identity separate from optimized locations; Lua's
[local lookup](https://github.com/lua/lua/blob/master/ldebug.c) consults the
function's debug metadata at the selected PC. BMSX does not adopt synthetic
temporary names or manufacture values for eliminated locations. VS Code JS
Debug's [evaluator](https://github.com/microsoft/vscode-js-debug/blob/main/src/adapter/evaluator.ts)
likewise selects an explicit frame rather than substituting global evaluation.

| Representation | TypeScript/toolchain | C++ tooling | Execution effect |
| --- | --- | --- | --- |
| Capture origin | Existing `capturedLocals` declaration index | Same symbol index | Not a same-name search |
| Located capture | `CaptureSlotDebug`: origin, register/upvalue location or explicit absence, inline call chain | Mirrored symbol record | Compiler remaps with GETUP/SETUP lowering and compaction |
| Register availability | Final instruction-word liveness intervals | Same intervals | Reuses the existing liveness pass |
| Inspection binding | Binding carries its physical location, independent of Locals/Upvalues presentation | No native Studio frontend | Reads the selected actual register/cell only on demand |

Affected callsites are compiler `finalizeCode`, `buildInlineExpansion`,
`compactUnusedUpvalues`, `buildProgramDebugPoints`, metadata source mapping,
linker capture relocation, symbols encoding/decoding and explicit frame-scope
inspection. CPU dispatch, frame push/pop, closure layout, GC, scheduler,
save-state format, renderers and firmware execution receive no change. Debug
metadata cannot keep an otherwise unused runtime upvalue alive.

Implemented: required capture-slot metadata for physical and nested inline
frames, exact call-chain mapping, final liveness, origin relocation and native
symbol encoding/decoding. The ordinary inspector, hover and shared conversation
frame/value tools consume these locations. Dead captures retain their names and
constness without retaining cells. Removed functions have no current capture
scopes, while their physical closure layout remains separately described for
Hot Resume. Debug ROMs must be rebuilt; there is no old-symbol fallback.

A regression also established that folding after inlining can remove the high
end of the remapped register window. The liveness producer now leaves those
locations empty instead of interpreting an out-of-window bitmap access as live.
This corrects both ordinary inline locals and register-backed captures without
enlarging the guest frame or running another liveness pass.

These records describe lowered captures, not a deoptimization or complete
source-language evaluator. They do not reconstruct compile-time constants that
never acquired a captured cell. Firmware-readable named scopes and at-stop
frame-evaluation admission remain separate gates, including that lexical
coverage; the public Terminal still has only cart/session contexts.

### Capture-location validation (2026-09-24)

- Actual O0/O3 execution covers mutable/const captures, register-backed and
  closure-backed locations through two inline levels, repeated inline calls,
  eliminated capture cells and removed high registers. Shared conversation
  scope/value requests read the same real table. Metadata reads do not touch
  registers; inspection leaves guest heap usage and machine time unchanged.
- Source-map tests preserve physical indices while mapping inline chains to
  authored source. Relinking separates current and removed capture origins.
  TS and native symbols round-trip register, upvalue and absent locations.
- Full Lua: 2531 pass, one skip. Rompacker: 182 pass. The browser -> ordinary
  authorized server -> Codex app-server -> deterministic Responses suite passes
  all 45 tests on software/WebGL2/WebGPU, including actual stopped-cart scope
  reads and ordinary Scenario Lab inspection. Stack conversation screenshots
  were inspected. This is automated integration evidence, not live-model
  reasoning, personal authentication or a new native frame-name frontend.
- Native symbol-format test, ten TS/C++ physical frame-evaluation parity vectors
  and the actual BIOS monitor Terminal parity all pass. BIOS/Nemesis and
  browser/Node products were rebuilt. Product typechecks pass; the tests project
  retains the same 95 baseline diagnostics after normalizing line positions.
  Architecture boundaries report zero issues; core parity, indentation and
  `git diff --check` pass.
- Eight representative programs at O0 and O3 have identical complete `Program`
  hashes against `6f28e0108`, including instructions, prototypes and constants.
  The patch changes no machine or per-frame dispatch path. This is
  code-generation/ownership evidence, not a general throughput benchmark.

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

## Physical evaluator core validation (2026-09-24)

- Twelve focused O0/O3 tests execute the actual firmware compiler and frame
  accessors. They cover direct local and open/closed upvalue writes, table
  identity, nil/false and exact multi-return tuples, retained pre-error writes,
  const/unavailable compilation errors, lexical shadowing, generated-symbol
  identity and explicit environment precedence. Escaped accessors reject reads
  and writes after protected completion/error; explicitly copied lexical values
  retain ordinary closure semantics. A weak-reference test verifies that an
  expired accessor does not retain its completed guest thread.
- `test:frame-evaluation-parity` runs ten of those firmware vectors natively
  and on TypeScript, using identical O0/O3 ROMs. Full final runtime snapshots
  match. A coroutine keeps a live frame scope across yield, collection and a
  deliberate HALT; both runtimes encode/decode/apply the full save state there,
  retain the exact CPU graph, then resume the same scope. The saved active
  runtime states also match across TS/C++. Normal restore presentation
  invalidation remains owned by the GPU, not normalized away in these tests.
- Two O0/O3 allocation tests compile a frame-access loop once, warm the call
  stack, and repeat 10,000 direct read/write iterations above its pinned
  ancestor. Guest allocation accounting before collection and global register
  count remain unchanged. This is a bounded guest-allocation measurement, not
  an assertion about all host allocations or universal performance.
- Mutation of public `pcall` and `lua_compiler.load` reproduced an evaluator
  failure before the ownership fix. The REPL now captures its own compiler and
  protection functions at initialization; both runtime vectors verify real
  mutation/error handling and scope expiry while the public names are changed.
- Full Lua: 2,525 pass, one skip; rompacker: 182 pass. The CP0 resume test still
  asserts fault cause, continued execution and user-mode restoration, with a
  1,000-cycle completion budget rather than the former 100-cycle startup cap
  (the current O0/O3 fixture takes 109 cycles). Product typechecks pass; tests
  retain the same 95 baseline diagnostics after source-position normalization.
- The ordinary physical BIOS monitor parity test passes through real HID input
  on TS/native C++. The keyboard/pointer-driven Studio Terminal workflow passes
  on software/WebGL2/WebGPU, including the updated protected-invocation source
  breakpoint, pause, retained draft, save/restore and reboot. WebGPU result and
  paused screenshots were inspected. This is automated runtime/UI evidence,
  not a UI-only development session or personal-phone test.
- Full assistant/browser: 45 pass through the real app-server and deterministic
  local Responses fixtures. Each of the three Terminal workflows still makes
  exactly 16 expected model requests with one connection; frame context remains
  explicitly rejected. Conversation-produced Terminal results and the retained
  paused stack were also visually inspected. BIOS/linked Nemesis, browser
  Studio and Node tooling builds pass. Strict architecture audit: zero issues;
  core-parity audit, indentation and `git diff --check` pass.

These fixtures supply their own exact physical locations. They do **not** prove
installed-source frame admission, native frame-name resolution, cancellation
retirement or frame-context conversation tools. Those gates remain open; the
public Terminal still accepts only `cart` and `session`. There is no added
Codex button, public raw-slot command, provider poller or new machine-state
format.

## Firmware-readable scope gate

The diagnostic directory in each physical ROM owns its packed names and
locations. Extend that producer, not the CPU with host symbols or a source-name
service. The firmware resolver consumes exact function address, PC and logical
inline depth. Declaration visibility is distinct from register liveness: an
unavailable inner declaration must still shadow an available outer one.

References studied before implementation: Lua's `luaG_findlocal` in
[ldebug.c](https://github.com/lua/lua/blob/master/ldebug.c) resolves an actual
activation using prototype metadata; LLDB's
[DWARFDebugInfo](https://github.com/llvm/llvm-project/blob/main/lldb/source/Plugins/SymbolFile/DWARF/DWARFDebugInfo.cpp)
indexes debug information separately from execution; MAME's
[debugcpu.cpp](https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcpu.cpp)
keeps debugger symbols outside CPU instruction execution. BMSX uses its existing
ROM directory and boot-primitive mechanism instead of adding another VM.

| Data | TypeScript producer/runtime | C++ / shared firmware | Hot-path effect |
| --- | --- | --- | --- |
| Function/frame/binding records | Installed linked symbols lowered to raw directory words | Identical offsets/constants; BIOS reads ordinary ROM | ROM construction only |
| Visibility/live locations | Half-open function-relative word intervals; exact inline chains | Binary search of the same interval records | Explicit scope lookup only |
| Names | Interned UTF-8 directory bytes | Existing BIOS UTF-8 decoder | Decode only for requested scope |
| Frame header | Existing thread frame: function address, PC, call-site PC, completion-latch flag, execution domain | Same raw frame fields | One boot primitive, no metadata in CPU |
| Scope descriptors | Firmware name -> index/upvalue/available/const | Same compiler external-scope records | No copied guest values or writeback |

Affected callsites: ROM-builder and Hot Resume tail diagnostics production;
`CPU.callBuiltinFunction` / `CPU::callBuiltinFunction` for one raw header read;
BIOS scope resolution on explicit request. No opcode-loop branch, frame field,
GC edge, snapshot field, scheduler work or renderer change. Boot retirement
includes the new private primitive. Scope lookup must not change cartridge bus
selection to inspect another domain. Public frame evaluation remains gated on
complete lexical coverage and pinned-stop admission/cancellation.

## Installed-name resolver validation (2026-09-24)

- Twenty O0/O3 firmware tests cover actual named local/capture writes, const
  rejection, unavailable shadowing, repeated inline invocations, physical
  upvalues remapped to caller registers, missing diagnostics and RAM functions
  without installed symbols. Completion-call injection resolves the retained
  ancestor's own PC and changes its live parameter without advancing its PC,
  frame depth or HALT state. The latter admission probe is a CPU test, not a
  public debugger-stop evaluation feature.
- Fourteen firmware vectors pass on TypeScript and native C++ with identical
  full final snapshots; the live coroutine/save-restore vector also retains
  identical suspended snapshots. Names in the new vectors come from the actual
  packed directory, not fixture-supplied locations. Two ROM tests compare every
  mapped instruction and logical inline depth against installed Studio scopes.
  Native interval/metadata-format tests pass.
- The raw fault test takes 101 cycles including boot-slot retirement. Its
  non-timing completion limit is now 1,000 cycles; exception-root, trap-cause
  and fault-reason assertions remain intact. Full Lua: 2,539 pass, one skip.
  Rompacker: 184 pass. Product typechecks and browser/Node builds pass. The
  tests-project diagnostic multiset is unchanged at 95 baseline entries after
  source-position normalization. Strict architecture audit: zero issues;
  core-parity, indentation and `git diff --check` pass.
- The ordinary BIOS Terminal still produces byte-identical TS/native output
  from real HID input. The manual Studio Terminal workflow and all 45 assistant
  integration tests pass on software/WebGL2/WebGPU. WebGPU results, pause and
  conversation screenshots were inspected. The rebuilt physical fault probe
  still prints `entry.lua:15:3` and its actual source line; its six assertions
  pass and the monitor/source-overlay captures were inspected. These are
  automated runtime/UI checks, not live-model or personal-phone evidence.
- Scope tables add 457,714 bytes to the debug BIOS and 1,117,968 bytes to the
  debug Nemesis ROM. Twenty warmed re-encodings averaged about 23 ms and 60 ms
  respectively on this workstation during validation. This is bounded tooling
  cost, not a universal throughput benchmark. Resolution is explicit; no source
  lookup, table construction or new hook is added to ordinary frame execution.

Rebuild BIOS and linked debug carts together for the extended directory. The
public Terminal still accepts only `cart` and `session`. Complete free-name
coverage, stopped-cart/data-bus admission, borrow retirement on cancellation,
rewind/replacement, native frame selection and conversation frame context remain
open. The existing stack-conversation screenshot also retains a breakpoint
status label after its completed Terminal result; this slice does not change
that UI status owner. No Codex-only control or provider polling was introduced.

## Outer lexical-name ownership gate

Physical capture layout is not a complete lexical environment. Lua's
[`singlevaraux`](https://github.com/lua/lua/blob/master/lparser.c) distinguishes
compile-time constants from values needing an upvalue, while LLVM retains
[declarations without locations](https://github.com/llvm/llvm-project/blob/main/llvm/lib/CodeGen/AsmPrinter/DwarfDebug.cpp)
for optimized-out variables. Installed frame evaluation must likewise distinguish
an absent name (eligible for global resolution) from a lexical declaration with
no physical location (not eligible). A debugger must not allocate extra captures
or recover a value from an unrelated caller frame to close this gap.

The compiler publishes binder-selected outer local/parameter/receiver
declarations at each function's definition, independently of its machine upvalue list. Existing
capture-origin metadata becomes lexical-declaration metadata; outer-binding
locations refer to it, while physical `upvalueBindings` still describe only
actual cells and retained Hot Resume prefixes. This is a representation change,
not an alias or a second name-denial table. Source mapping, inline lowering,
relinking, firmware diagnostics and ordinary inspection consume that owner.

| Data | TypeScript/toolchain | C++ / firmware | Execution effect |
| --- | --- | --- | --- |
| Visible outer names | Binder visibility and declaration identity at function definition | Installed lexical declarations and outer locations | Compilation only; no source walk during execution |
| Actual closure cells | Existing prototype descriptors and upvalue bindings | Unchanged physical closure descriptors | No new captures, GC edges, frame slots or heap values |
| Missing location | Explicit null plus empty word intervals | Existing diagnostic unavailable descriptor | Firmware compiler rejects lexical access, never substitutes a global |
| Name/source identity | Source-mapped declaration, independent of capture demand | Mirrored symbols codec and shared ROM directory | On-demand inspection only |

Affected callsites: `FunctionBuilder.compileFunctionExpression`/`finalizeCode`,
inline expansion/upvalue compaction, compiler source mapping, symbol relocation
and encoding, diagnostic directory construction, and explicit frame inspection.
No CPU, scheduler, save-state or renderer hot-path callsite changes. Complete
`Program` comparisons must verify that metadata does not change emitted code,
constants, stack requirements or physical captures.

Static `.bss`/`.data`/`.rodata` and type names do not own local registers and are
not included in this local/parameter/receiver representation. Their evaluation
semantics and coverage remain an explicit gate before public frame context; do
not infer full dialect coverage from the outer-local tests. The installed ROM
and symbols consumers must be rebuilt together for the new metadata schema.

## Outer lexical-name validation (2026-09-24)

- O0/O3 compiler tests distinguish unused locals, folded constants, parameters,
  implicit receivers, explicit `self` shadowing, recursive const-function names
  and declarations that only become visible after the function definition.
  Static-module predeclaration does not make later locals visible. Hot Resume
  keeps the original physical cell prefix while reporting a newly shadowing,
  uncaptured declaration as unavailable. Source mapping preserves this identity
  and the existing physical locations.
- The new firmware vector failed before the producer change on both O0 and O3.
  It now rejects reads/writes of unavailable lexical names without reading or
  changing same-name globals; a newly declared evaluation-local still shadows
  normally. Sixteen firmware vectors pass with identical full TS/native final
  snapshots, plus identical suspended/save-restored coroutine snapshots. Native
  symbols tests also preserve declarations that have never owned a capture.
- Full Lua: 2,551 pass, one skip. Rompacker: 184 pass, including failed Scenario
  Lab threads where a callback's uncaptured name must not borrow another frame's
  value. Sixteen complete `Program` hashes remain identical to the pre-slice
  compiler, including instructions, constants, stack sizes and captures.
- The shared BIOS Terminal remains byte-identical under actual TS/native HID
  input. All 45 assistant integration tests and the manual Terminal workflow
  pass on software/WebGL2/WebGPU. The conversation stack test additionally checks
  the real cart's uncaptured `clear_color` binding through the tool transport on
  all three renderers. Terminal results/cart-context and conversation screenshots
  were inspected. This is automated runtime/UI evidence, not live-model or
  personal-phone testing.
- BIOS and Nemesis debug ROMs, browser Studio and Node tooling were rebuilt.
  Product typechecks pass; the tests-project diagnostic multiset remains the same
  95 baseline entries after position normalization. Strict architecture audit:
  zero issues; core-parity, changed-file indentation and `git diff --check` pass.
  Repository-wide indentation still flags five unchanged files in `ide/runtime`,
  tests and `third_party/cjson`; this slice does not reformat them.
- The broader names cost debug storage: the packed scope directories now occupy
  1,273,585 bytes in BIOS and 2,647,762 bytes in Nemesis. Twenty warmed encodings
  averaged about 40 ms and 86 ms respectively after the validation jobs finished.
  No source lookup, capture allocation or new hook enters normal guest execution;
  these figures measure tooling work, not universal throughput.

Public frame context remains closed pending static-storage/type coverage,
selected-stop/cart-bus admission, borrow retirement on cancellation and machine
replacement/rewind, native frame selection, and conversation frame admission.
The ordinary cart/session Terminal and source inspection are not gated on those
unfinished frame-evaluation capabilities.
