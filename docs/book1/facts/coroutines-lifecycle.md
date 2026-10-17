# Frozen live-source facts: installed BIOS coroutine namespace

Baseline: `0620b06d2b6a4e1aaf2ce6f920aa61b058cf52ff`.
Read-only extraction; no owner, compiler, BIOS or runtime edits. No architecture.md, PDF or manuscript sources were read. This sheet contains source facts, not execution claims. All TS/C++ pairs below were inspected; no affected public-behavior disagreement was established. Public wrappers are a single shared BIOS source, not independently mirrored implementations.

## Installation, representation and arities

- `machine/bios/main.lua:4-7` installs `coroutine = require('coroutine')` after base/table/string. `machine/bios/coroutine.lua:1-9` captures the seven raw primitives plus error and frame scopes into locals. `:15-40` constructs and returns an ordinary table with **eight** public callable members. The seven named CPU primitives are not the public table slots: those slots hold BIOS closures.
- Primitive IDs are Create=14, Resume=15, Yield=16, Status=17, Running=18, Close=19, IsYieldable=20. Primitive global spellings are `__bmsx_coroutine_create/resume/yield/status/running/close/isyieldable`. Paired disposition **AGREE**: `machine/ts/spec/blua32/builtin.ts:16-22,55-61`; `machine/cpp/spec/blua32/builtin.h:25-31,64-70`. There is no Wrap primitive in this list; wrap is BIOS code.
- Created threads retain entry closure, language frames/register stack, protected-call continuations, status, resumer, call-base/result-count and error value. Initial status New; stack initially eight slots. Paired disposition **AGREE** on language state: `machine/ts/machine/cpu/thread.ts:7-26`; `machine/cpp/machine/cpu/thread.h:11-26`. TS stores value tags/scalars/references in ValueSlots; C++ stores Value words and Thread pointers. Do not substitute host-language function/object classification for the CPU guest tags below.
- Root/main thread is initialized Running, and is the initial active thread. Paired disposition **AGREE**: TS `machine/ts/machine/cpu/cpu.ts:262-264,485-492`; C++ `machine/cpp/machine/cpu/cpu.cpp:392-396`.
- The actual public closure arities are established by the shared BIOS declarations, not IDE help: create(fn) one fixed parameter; resume(thread, ...) one fixed plus variadic; yield(...) zero fixed plus variadic; status(thread) one fixed; running() zero fixed; close(thread) one fixed; isyieldable(...) zero fixed plus variadic; wrap(fn) one fixed, returning a variadic closure. Sources: `machine/bios/coroutine.lua:16-27,36-38`.
- Compiler metadata records declared parameter count and variadic flag: `toolchain/ts/lua/compiler.ts:5992-5997`. Generic caller-to-closure setup copies fixed parameters, supplies nil for missing ones and retains excess only for variadic functions. Paired disposition **AGREE**: TS CPU `:3252-3298`; C++ CPU `:2995-3045`. Thus fixed-parameter public wrappers do not forward arbitrary excess arguments; isyieldable is variadic specifically so omission differs from explicit nil.
- Semantic descriptors independently advertise all eight names/signatures: `toolchain/ts/lua/builtin_descriptors.ts:52-59`; these are editor metadata, not runtime enforcement.

## Eight public calls

### 1. `coroutine.create(fn) -> thread` (one result)

- `fn` must be a guest **Closure**, not merely any guest value called a function by a generic description. In particular a raw BuiltinFunction fails this requirement. Missing/nil/non-Closure raises Invalid argument. The primitive creates and returns one Thread; it does not execute entry code. Public BIOS forwards only its fn parameter. Sources: BIOS `:16`; paired disposition **AGREE**, TS CPU `:3690-3693,3731-3735`; C++ CPU `:1733-1736,1774-1779`; initial New state in paired thread owners above.
- New is publicly reported as suspended, not a distinct new string (mapping below).

### 2. `coroutine.resume(thread, ...) -> true, ...` or `false, error`

- First argument must have guest Thread representation; missing/non-Thread raises Invalid argument in the **calling** thread rather than becoming an ordinary resume false/error result. Paired disposition **AGREE**: TS CPU `:3775-3778`; C++ CPU `:1819-1820`. BIOS forwards its thread plus all variadic arguments (`coroutine.lua:17`).
- Only New or Suspended targets transfer. A current hardware exception frame also rejects transfer. Rejection returns exactly false plus one string: `cannot resume coroutine across a hardware exception` when an exception is active (takes precedence), otherwise `cannot resume non-suspended coroutine`. Target is not closed or changed by this rejection branch. Paired disposition **AGREE**: TS CPU `:3779-3787`; C++ CPU `:1821-1828`. The exception check scans active-thread frames for isExceptionFrame: TS CPU `:2052-2057`; C++ CPU `:2786-2791`.
- Accepted transfer records caller continuation base/count, sets caller Normal, sets target.resumer to caller, target Running and active target. On first resume, arguments after thread become entry closure arguments; entry reference is then cleared. On later resume, arguments after thread become results of the suspended yield call. Paired disposition **AGREE**: TS CPU `:3789-3806`; C++ CPU `:1830-1847`.
- Yielded values or entry return values are returned to resumer prefixed with true. Unhandled language error is returned prefixed with false and the original single error value, subject to boundaries below. Tuple count and nil positions move directly; no packing table is introduced. Paired disposition **AGREE**: TS CPU `:3747-3762,3767-3773,3809-3817,2965-2972`; C++ CPU `:1791-1806,1811-1817,1850-1858`, and `cpu_dispatch.inl:529-537`.
- Once yielded/finished/failed back to the caller, caller is Running and target.resumer is cleared. Paired disposition **AGREE**: TS CPU `:3747-3762`; C++ CPU `:1791-1806`.

### 3. `coroutine.yield(...)` / later returns resume arguments

- BIOS forwards all arguments/results (`coroutine.lua:18`). CPU tests yieldability, records the yield call's continuation base/result count, changes active created thread to Suspended, returns true plus supplied arguments to its resumer. When resumed later, the new resume arguments after thread become this yield call's result tuple. Paired disposition **AGREE**: TS CPU `:3765-3773,3799-3804`; C++ CPU `:1809-1817,1840-1845`.
- A non-yieldable call raises Invalid argument rather than yielding or returning a false result. Sources: same paired yield branches and yieldability predicate below.
- Yieldability is not the same operation as CPU HALT or returning to a host completion root. This sheet does not establish HALT/IRQ scheduling details.

### 4. `coroutine.status(thread) -> string` (one result)

- Requires guest Thread; otherwise Invalid argument. Raw primitive returns one numeric ThreadStatus ordinal; BIOS translates it to one string. Paired disposition **AGREE**: TS CPU `:3698-3706`; C++ CPU `:1741-1749`; shared BIOS `coroutine.lua:11-13,19`.
- Exact ordinal-to-public mapping (paired enum owners TS `thread.ts:7`, C++ `thread.h:11`, shared BIOS `coroutine.lua:12`):

  | CPU status | Ordinal | Public status |
  |---|---:|---|
  | New | 0 | suspended |
  | Running | 1 | running |
  | Normal | 2 | normal |
  | Suspended | 3 | suspended |
  | Dead | 4 | dead |
  | Failed | 5 | dead |

- Running denotes the active thread in normal transfer flow. Normal denotes the resumer currently waiting inside accepted resume. Suspended includes both never started and explicitly yielded threads. Dead cannot distinguish normal completion, closure, or failed entry execution. Sources: paired transfer/completion/error/close branches cited throughout.

### 5. `coroutine.running() -> thread, is_main` (two results)

- Returns the active Thread and boolean comparing it to rootThread; root returns true, created coroutine returns false. BIOS closure forwards both primitive results. Paired disposition **AGREE**: TS CPU `:3694-3697`; C++ CPU `:1737-1740`; BIOS `coroutine.lua:20`.

### 6. `coroutine.close(thread) -> true` or `false, original_error`

- Requires guest Thread; otherwise Invalid argument. Running and Normal cannot be closed: primitive raises Invalid argument, so public close does not normally return and its subsequent scope-retirement function is not invoked. Paired disposition **AGREE**: TS CPU `:3698-3712,3820-3823`; C++ CPU `:1741-1755,1861-1862`; BIOS `coroutine.lua:21-26`.
- New, Suspended, Dead and Failed can be closed. It returns true for all except Failed. Failed returns exactly false plus retained original error value, then still closes and clears retained error. A second close therefore returns true. Paired disposition **AGREE**: TS CPU `:3707-3712,3820-3839`; C++ CPU `:1750-1755,1861-1874`.
- Closing closes open upvalues and releases all frames; discards protected-call state; clears register-stack state and entry; sets status Dead. It does not resume remaining function code. Paired disposition **AGREE** on exposed effects: TS CPU `:3824-3838`; C++ CPU `:1863-1873`. Representation-specific cleanup: TS clears stackRegisters through stackTop and nulls active continuation references; C++ fills its stack buffer and clears continuation storage. No claim of identical internal buffer allocation/layout.
- Upvalues preserve their current guest values when detached from frames, rather than losing captured locals. Paired disposition **AGREE**: TS CPU `:3362-3374`; C++ CPU `:2967-2977`.
- Installed close is a privately captured `close_thread`: shared BIOS `coroutine.lua:21-26`. After primitive close returns (including false/error for Failed), `closed(thread, ...)` retires all borrowed frame scopes for that thread from frame 0, then forwards primitive results unchanged. Actual retirement is `machine/bios/debug/frame_scopes.lua:14-24` (nil scope.thread and remove registry entry). This is BIOS-owned cleanup, not a CPU callback to the replaceable public table slot.

### 7. `coroutine.isyieldable([thread]) -> boolean` (one result)

- Omission selects active thread. If an argument is provided it must be guest Thread; explicit nil is invalid, not equivalent to omission. Extra forwarded arguments are unused by this primitive. Paired disposition **AGREE**: TS CPU `:3698-3704`; C++ CPU `:1741-1747`; variadic BIOS wrapper `coroutine.lua:27`.
- Exact predicate: false for rootThread; false if the selected thread has any frame marked isExceptionFrame or returnToCompletionLatch; false if any active protected continuation is XPCallHandler; otherwise true. Paired disposition **AGREE**: TS CPU `:3738-3744`; C++ CPU `:1782-1788`. Continuation variants agree: TS `call_state.ts:6-10`; C++ `call_state.h:16-20`.
- **Status is not checked.** Therefore a created New or Dead thread with no disqualifying retained frames returns true. Failed also may return true (normal failed language frames do not themselves disqualify it). This query is not a test of whether resume will accept the selected thread. Source predicate above vs independent resume status gate (TS CPU `:3780`; C++ CPU `:1822`).
- Ordinary pcall and xpcall body continuation kinds do not forbid yielding. XPCallHandler does. This concerns the selected thread's active continuations, not the mere existence of an error handler function elsewhere.

### 8. `coroutine.wrap(fn) -> wrapped_function` (one result)

- BIOS creates one thread using captured primitive create, and returns a variadic closure. Calling the returned closure resumes that private thread with supplied arguments. On true it removes the boolean prefix and returns remaining tuple unchanged. Sources: shared BIOS `coroutine.lua:29-38`; creation/transfer/return semantics paired above.
- On false, `unwrap` checks the **raw numeric** status against Failed=5. Only Failed triggers the privately captured `close_thread` (with frame-scope retirement). It then invokes captured `__bmsx_error` with the first resume error result, preserving the guest value rather than converting it to text. A rejected resume is not by itself a close trigger; the actual raw-status Failed check still closes an already Failed target even when that resume was rejected. Other non-suspended statuses do not trigger Failed cleanup. In this externally failed case, wrap raises the first resume error result (the rejection String), not the previously retained body error. Sources: shared BIOS `coroutine.lua:8,13,21-25,29-38`; error primitive paired disposition **AGREE**: TS CPU `:4370-4380`; C++ CPU `:2225-2227`.
- Replacing public coroutine.close does not replace wrap's private close_thread. After a failed wrapped thread was cleaned up, an explicitly obtained thread handle would close true, not re-return the original failure (because its status is now Dead and stored error was cleared).

## Language errors, hardware boundaries and protected public calls

- CPU error path first offers an error to protected calls in the active thread. With no consuming protected call, a thread with a resumer becomes Failed, retains the original error value and returns false/error to its resumer. It does not immediately discard retained frames; explicit close or wrap's failure cleanup does that. It refuses this coroutine-language-error return if any retained frame is exception or completion-latch frame. Paired disposition **AGREE**: TS CPU `:3809-3817`; C++ CPU `:1850-1858`.
- Run-loop errors classify out-of-memory, explicitly thrown guest value, and LuaExecutionError; if not consumed, CPU enters the Lua fault exception rather than inventing a successful coroutine result. Paired disposition **AGREE**: TS CPU `:1942-1966`; C++ CPU `:2643-2658`. Explicit error values preserve their representation, including Table identity (error primitive and thread error storage above).
- Invalid argument is Lua fault reason 10, with message `Invalid argument.`. Paired disposition **AGREE**: TS `spec/blua32/cop0.ts:26-36`, CPU `:505`; C++ `spec/blua32/cop0.h:32-42`, CPU `:380`.
- Protected error handling does not unwind across exception or completion-latch frames to reach an older continuation. Paired disposition **AGREE**: TS CPU `:4094-4114`; C++ CPU `:2050-2068`.
- **Public-wrapper route matters.** pcall(coroutine.yield, ...) and pcall(coroutine.resume, ...) receive Closure targets, not raw BuiltinFunction targets. Protected invocation pushes ordinary closure frames: paired disposition **AGREE**, TS CPU `:3918-3930`; C++ CPU `:1925-1930`. Their later ordinary CALL invokes transfer microcode: TS CPU `:2918-2937,3841-3849`; C++ `cpu_dispatch.inl:490-503`, CPU `:1876-1886`.
- In contrast, a directly protected raw __bmsx_coroutine_resume/yield primitive goes through generic builtin dispatch, whose corresponding cases raise Invalid argument. This is not the installed public route. Paired disposition **AGREE**: TS CPU `:3931-3943,3716-3718`; C++ CPU `:1932-1946,1759-1761`.
- An ordinary protected public resume can return its own success prefix plus the coroutine resume prefix/result tuple. A target language failure returned as false/error by resume is not itself an error thrown in the resumer. The sources above distinguish these mechanisms; no stock Lua behavior is presumed.

## Compiler result-count facts relevant to examples

- CALL argument/result counts are emitted by generic compileCallExpression; trailing multi-result arguments use open argument count. TS owner `toolchain/ts/lua/compiler.ts:5647-5653,5677-5690`; installed firmware compiler `machine/bios/compiler/compiler.lua:648-683`. There is no coroutine-name special arity branch in these inspected call emitters.
- CPU CALL distinguishes guest Closure and BuiltinFunction, other tags fault call-non-function. Paired disposition **AGREE**: TS CPU `:2918-2940`; C++ `cpu_dispatch.inl:490-503`.
- Open result count (0 in internal CALL continuation) forwards exact source tuple count; fixed requested count truncates or pads nil. Paired disposition **AGREE**: TS CPU `:3406-3418,3421-3438`; C++ CPU `:3127-3139`; resume's success prefix uses same count rule at TS `:3747-3759`, C++ `:1791-1803`.
- **Empty explicit `return` is one nil, not an assumed stock-Lua zero-result tuple.** Owning TS compiler `toolchain/ts/lua/compiler.ts:4372-4377`; installed firmware compiler `machine/bios/compiler/compiler.lua:1133-1146` both emit nil then RET count 1. Disposition **AGREE for explicit empty return**. Final expanding call results use open RET: TS compiler `:4392-4394,4403-4405`; firmware compiler `:1154-1160`. Do not generalize beyond these inspected branches to every implicit fallthrough or arbitrary hand-authored opcode sequence.

## Established cycle charge, not total API cost

- All seven primitives have base 4, perArg 0, perRet 0. Paired disposition **AGREE**: TS `machine/ts/machine/cpu/value.ts:109-111,128-134`; C++ `machine/cpp/machine/cpu/value.h:63-84` indexed by paired IDs 14-20 above; C++ CPU loads costs at `:384-390`.
- Ordinary builtin invocation charges the base before any coroutine transfer/error. Paired disposition **AGREE**: TS CPU `:3841-3849` and `:1990-1992`; C++ CPU `:1876-1886`. Public BIOS calls also execute ordinary wrapper instructions; wrap adds closure creation/resume/status/conditional-close/error work. **Do not advertise four cycles as total public API cost.** No per-operation total or bound was measured for this sheet.

## Explicit gaps / limits

- No new runtime tests were run by this extraction agent. Parent owns independent paired execution evidence; this file does not relabel source inspection as runtime proof.
- No exhaustive heap, GC reachability, weak-table, save-state codec, debugger lifetime, closure enumeration, hardware timing, interrupt scheduling, or HALT behavior audit. Only close's direct retained-state/upvalue/frame-scope effects were inspected.
- No total cycle analysis for BIOS wrapper bytecode, resuming arbitrary user code, heap reservation/collection, errors or close-frame walks.
- No universal stock Lua compatibility claim, implicit fallthrough return-count claim, or behavior claim for corrupt hand-built runtime state. Exact supported observations above follow installed wrappers and mirrored guest representations.
- No inspected public coroutine-behavior mirror mismatch requiring an affected-fact STOP. Representation-specific stack/continuation cleanup is reported as such, not flattened into identical storage implementations.

## Root follow-through: ordinary function fallthrough

CF01. Root filled the specific implicit-fallthrough gap after extraction.
Ordinary function-expression compilation appends a default nil then RET1 in
TS producer toolchain/ts/lua/compiler.ts:1496–1502,5767–5770. Installed firmware
compiler appends KNIL then RET1 when body empty or its last statement is not a
return, machine/bios/compiler/compiler.lua:1738–1744. Thus normal fallthrough
of these ordinary source functions returns one nil, as does explicit bare
return already extracted. This is compiler-source agreement, not execution
of a new tuple-count fixture, not all arbitrary raw opcode functions, and not
an optimization correctness claim. A pcall/resume accepting all such function
results consequently receives true,nil. The raw VM zero-result source case
remains separately meaningful; do not conflate it with ordinary empty functions.


## Nonauthor correction: externally failed wrapped thread

The original extraction overgeneralized rejected-resume cleanup. Source
`machine/bios/coroutine.lua:29–33` checks status==Failed on every false resume
result, not just a newly executed body failure. A retained handle can be resumed
externally into Failed; a later wrapped call rejects resume, closes that Failed
thread and raises the new rejection String. This is an extraction/prose fix,
not a TS/C++ disagreement or runtime repair.
