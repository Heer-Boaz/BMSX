# Installed firmware protected-call facts

Baseline: `0620b06d2`. Read-only extraction; no runtime, compiler, tools, or repository files changed. Neither `docs/architecture.md`, historical PDFs, nor manuscript prose was read. All locations below are baseline/live-owner locations. `MATCH` means the stated behavior agrees in the two inspected implementations; `SOURCE ONLY` means firmware/compiler source owns that particular fact rather than mirrored runtime code. This is a bounded fact sheet, not chapter prose or runtime proof.

## Public names and source-facing signatures

| Fact | Exact owner location | Paired location / disposition |
|---|---|---|
| Firmware captures boot primitives as `vm_error`, `vm_pcall`, `vm_xpcall`. | `machine/bios/base.lua:9-11` | SOURCE ONLY: single firmware source. |
| Public globals are direct aliases `error = vm_error`, `pcall = vm_pcall`, `xpcall = vm_xpcall`; these three public operations have no Lua wrapper here. | `machine/bios/base.lua:214-216` | SOURCE ONLY: single firmware source. |
| Installed primitive IDs are Error=9, PCall=10, XPCall=11. | `machine/ts/spec/blua32/builtin.ts:11-13` | `machine/cpp/spec/blua32/builtin.h:20-22` — MATCH. |
| Their boot names are `__bmsx_error`, `__bmsx_pcall`, `__bmsx_xpcall`. | `machine/ts/spec/blua32/builtin.ts:50-52` | `machine/cpp/spec/blua32/builtin.h:59-61` — MATCH. |
| Source descriptor for error is `error(message [, level])`, parameters `message`, `level?`. This is source-facing signature data, not proof of runtime level processing. | `toolchain/ts/lua/builtin_descriptors.ts:31-31` | SOURCE ONLY. |
| Source descriptor for pcall is `pcall(f, ...)`, parameters `func`, `arg...`. | `toolchain/ts/lua/builtin_descriptors.ts:40-40` | SOURCE ONLY. |
| Source descriptor for xpcall is `xpcall(f, msgh, ...)`, parameters `func`, `msgh`, `arg...`. | `toolchain/ts/lua/builtin_descriptors.ts:50-50` | SOURCE ONLY. |
| Source minimum-argument calculation excludes parameters ending in `?` or `...`; applied to the preceding descriptors, minima are error=1, pcall=1, xpcall=2. This does not establish enforcement or runtime acceptance limits. | `toolchain/ts/lua/semantic/call_signature.ts:35-57` | SOURCE ONLY. |

## `error`: runtime arguments, value, and non-return

| Fact | TypeScript exact location | C++ exact location / disposition |
|---|---|---|
| Runtime `error` throws argument 0 unchanged, without checking its guest kind, converting it to string, or consulting level/extra arguments. It has no normal return in this implementation. | `machine/ts/machine/cpu/cpu.ts:4370-4380` | `machine/cpp/machine/cpu/cpu.cpp:2225-2227` — MATCH. |
| Missing runtime argument 0 makes `error()` throw nil. This differs from the source descriptor minimum and is not a promise that every compiler source-call form admits zero arguments. | `machine/ts/machine/cpu/cpu.ts:4370-4373` | `machine/cpp/machine/cpu/value.h:338-343` and `machine/cpp/machine/cpu/cpu.cpp:2225-2227` — MATCH via C++ argument-view ownership. |
| Public guest value kinds available to that unchanged payload are nil, boolean, number, string, table, function (closure or builtin), and thread. The error path imposes no narrower payload kind. | `machine/ts/machine/cpu/value.ts:149-167` | `machine/cpp/machine/cpu/value.h:481-494` — MATCH on public kinds, not tag-number representation. |
| Explicit thrown values carry the original encoded value components in TS / raw Value in C++, rather than an error-message DTO. | `machine/ts/machine/cpu/errors.ts:6-11` | `machine/cpp/machine/cpu/errors.h:11-14` — MATCH in guest value preservation. |

## `pcall` and `xpcall`: arguments and ordinary results

| Fact | TypeScript exact location | C++ exact location / disposition |
|---|---|---|
| Protected target receives arguments after f for pcall, after f and msgh for xpcall; forwarded count is incoming count minus 1/2, clamped at zero. No public maximum is established by these owners. | `machine/ts/machine/cpu/cpu.ts:3894-3902` | `machine/cpp/machine/cpu/cpu.cpp:1916-1922` — MATCH. |
| A protected target must be a guest closure or builtin function; another target kind raises CALL_NON_FUNCTION. Missing f is represented as nil at the target boundary. | `machine/ts/machine/cpu/cpu.ts:3913-3952` | `machine/cpp/machine/cpu/cpu.cpp:1917-1949` — MATCH. |
| The continuation is installed before target invocation. Thus non-function/missing pcall f is inside its new protected boundary (the handling path is specified below), not rejected before that boundary. | `machine/ts/machine/cpu/cpu.ts:3883-3902` | `machine/cpp/machine/cpu/cpu.cpp:1905-1922` — MATCH. |
| xpcall validates msgh before creating its continuation: handler must already be closure or builtin; absent/non-function msgh raises XPCALL_HANDLER_NOT_FUNCTION. It is not caught by that not-yet-created xpcall boundary; an existing outer boundary can receive it. | `machine/ts/machine/cpu/cpu.ts:3874-3885` | `machine/cpp/machine/cpu/cpu.cpp:1897-1907` — MATCH. |
| Open-result success returns `true` followed by every target result; zero target results means one result (`true`). Values, interior nil slots, and their count are copied without string conversion. | `machine/ts/machine/cpu/cpu.ts:4031-4050` | `machine/cpp/machine/cpu/cpu.cpp:1993-2012` — MATCH for builtin result source. |
| The same success layout applies to closure register results; overlapping register ranges use move semantics. | `machine/ts/machine/cpu/cpu.ts:4053-4078` | `machine/cpp/machine/cpu/cpu.cpp:2015-2034` — MATCH. |
| Open-result failure returns exactly `false, errorValue` (two slots, including when payload is nil). A fixed requested result count truncates or nil-pads instead. | `machine/ts/machine/cpu/cpu.ts:4003-4028` | `machine/cpp/machine/cpu/cpu.cpp:1975-1990` — MATCH. |
| Nested builtin pcall/xpcall targets use another protected continuation and feed its results into the protected parent. | `machine/ts/machine/cpu/cpu.ts:3931-3936` | `machine/cpp/machine/cpu/cpu.cpp:1932-1937` — MATCH; parent completion at TS `4081-4091`, C++ `2037-2047`. |

## Catch domain and handler behavior

| Fact | TypeScript exact location | C++ exact location / disposition |
|---|---|---|
| CPU run-loop catch classification is guest out-of-memory signal, explicit guest-thrown value, and LuaExecutionError reason. Explicit values remain their guest payload; execution errors become the installed reason string; OOM becomes the installed OOM string. This is not an arbitrary host exception catch. | `machine/ts/machine/cpu/cpu.ts:1942-1969` | `machine/cpp/machine/cpu/cpu.cpp:2643-2659` — MATCH. |
| Protected handling uses the active thread's innermost continuation. No continuation means not handled here. | `machine/ts/machine/cpu/cpu.ts:4094-4105` | `machine/cpp/machine/cpu/cpu.cpp:2050-2056` — MATCH. |
| Before ordinary protected handling, frames above the protected caller are unwound to caller depth. | `machine/ts/machine/cpu/cpu.ts:4106-4114` | `machine/cpp/machine/cpu/cpu.cpp:2057-2068` — MATCH subject to boundary exclusions below. |
| Unwinding closes upvalues of removed frames and releases their stack/frame storage. | `machine/ts/machine/cpu/cpu.ts:1972-1987` | `machine/cpp/machine/cpu/cpu.cpp:2705-2728` — MATCH. No claim of transaction/rollback semantics is derived. |
| pcall failure delivers the incoming guest error unchanged to its failure result. | `machine/ts/machine/cpu/cpu.ts:4115-4131` | `machine/cpp/machine/cpu/cpu.cpp:2069-2074` — MATCH. |
| xpcall body failure transitions its continuation to handler mode, writes the incoming error as one handler argument, and invokes the saved handler after body unwinding. | `machine/ts/machine/cpu/cpu.ts:4134-4153` | `machine/cpp/machine/cpu/cpu.cpp:2077-2084` — MATCH. |
| A normally returning handler supplies only its first result as the false-result payload; remaining handler results are discarded. No handler result supplies nil. | `machine/ts/machine/cpu/cpu.ts:3955-3974` | `machine/cpp/machine/cpu/cpu.cpp:1952-1957` — MATCH for builtin handler result source. |
| The first-result-only/no-result-nil rule also applies to a closure handler. | `machine/ts/machine/cpu/cpu.ts:3979-3997` | `machine/cpp/machine/cpu/cpu.cpp:1962-1969` — MATCH. |
| A guest error reaching a continuation already in handler mode becomes the installed `error in error handling` payload rather than the handler's newly thrown payload. | `machine/ts/machine/cpu/cpu.ts:4115-4122` | `machine/cpp/machine/cpu/cpu.cpp:2069-2073` — MATCH. |
| The exact handler-error payload string is `error in error handling` (no final period). | `machine/ts/machine/cpu/cpu.ts:495-495` | `machine/cpp/machine/cpu/cpu.cpp:369-369` — MATCH. |
| Inline handler invocation catches only LuaThrownValueError and LuaExecutionError locally and loops through handler-mode handling. Other thrown conditions are not normalized by this local catch. | `machine/ts/machine/cpu/cpu.ts:4155-4168` | `machine/cpp/machine/cpu/cpu.cpp:2082-2089` — MATCH. **Important bound:** inline builtin-handler OOM is not caught by this local handler catch; do not generalize the handler-error rule to all host/OOM paths. |

## Error identities and exact reason strings relevant to ordinary programs

| Fact | TypeScript exact location | C++ exact location / disposition |
|---|---|---|
| CALL_NON_FUNCTION=1; INDEX_NIL=4; XPCALL_HANDLER_NOT_FUNCTION=7; EXPLICIT_ERROR=8; OUT_OF_MEMORY=9; INVALID_ARGUMENT=10. | `machine/ts/spec/blua32/cop0.ts:26-36` | `machine/cpp/spec/blua32/cop0.h:32-42` — MATCH. |
| CALL_NON_FUNCTION string is `Attempted to call a non-function value.`; invalid handler string is `xpcall error handler must be a function.`. | `machine/ts/machine/cpu/cpu.ts:496-505` | `machine/cpp/machine/cpu/cpu.cpp:371-380` — MATCH. |
| INDEX_NIL string is exactly `Table index is nil.`; INVALID_ARGUMENT string is exactly `Invalid argument.`; OOM string is exactly `Out of memory.`. | `machine/ts/machine/cpu/cpu.ts:500-505` | `machine/cpp/machine/cpu/cpu.cpp:375-380` — MATCH. |
| rawget on a table forwards its key to the table owner, including a nil key. | `machine/ts/machine/cpu/cpu.ts:4230-4247` | `machine/cpp/machine/cpu/cpu.cpp:2133-2139` — MATCH. |
| Reading a nil key raises INDEX_NIL. Together with the preceding reason-string/catch facts, this establishes `pcall(rawget, {}, nil)` yielding `false, 'Table index is nil.'` in open-result context. | `machine/ts/machine/cpu/table.ts:149-158` | `machine/cpp/machine/cpu/table.cpp:393-395` — MATCH. |

## Hardware and coroutine boundary facts only

| Fact | TypeScript exact location | C++ exact location / disposition |
|---|---|---|
| Protected continuations/depth belong to each thread, not one global protected-call stack. | `machine/ts/machine/cpu/thread.ts:16-24` | `machine/cpp/machine/cpu/thread.h:17-26` — MATCH. |
| A protected error cannot unwind across an exception frame or completion-latch root that lies above its caller: the protected handler returns unhandled before unwinding. This does not prohibit a newer protected call inside that root. | `machine/ts/machine/cpu/cpu.ts:4106-4114` | `machine/cpp/machine/cpu/cpu.cpp:2061-2068` — MATCH. |
| IRQ and NMI entry use CPU exception entry; NMI additionally marks its frame non-maskable. | `machine/ts/machine/cpu/cpu.ts:1695-1727` | `machine/cpp/machine/cpu/cpu.cpp:2257-2285` — MATCH. |
| Exception entry marks the newly pushed frame as an exception frame. Thus the preceding protected barrier includes entered IRQ/NMI frames. | `machine/ts/machine/cpu/cpu.ts:1764-1778` | `machine/cpp/machine/cpu/cpu.cpp:2312-2333` — MATCH. |
| Synchronous hardware exception entry goes directly to enterException, not through protected guest-error handling. No general promise to catch bus/address/coprocessor faults with pcall follows. | `machine/ts/machine/cpu/cpu.ts:1732-1745` | `machine/cpp/machine/cpu/cpu.cpp:2290-2303` — MATCH. |
| Unhandled classified guest errors go through Lua fault exception entry: record reason, enter TRAP, place error payload in new exception frame register 0. | `machine/ts/machine/cpu/cpu.ts:1748-1761` | `machine/cpp/machine/cpu/cpu.cpp:2306-2309` — MATCH; trap cause constant TS cop0.ts:24, C++ cop0.h:30. |
| Active-thread protected handling is attempted before a coroutine is marked failed and error is returned to its resumer. Coroutine failure transfer is refused across exception/completion roots. | `machine/ts/machine/cpu/cpu.ts:3809-3817` | `machine/cpp/machine/cpu/cpu.cpp:1850-1858` — MATCH. |
| coroutineYieldable rejects root thread, any exception/completion root, and an active XPCallHandler continuation. It does not reject a thread merely for being in PCall or XPCallBody mode. | `machine/ts/machine/cpu/cpu.ts:3738-3744` | `machine/cpp/machine/cpu/cpu.cpp:1782-1788` — MATCH. This is the CPU yieldability rule, not a claim about every direct builtin target. |
| The coroutine transfer path checks that yieldability rule before suspending and returning to the resumer. | `machine/ts/machine/cpu/cpu.ts:3765-3773` | `machine/cpp/machine/cpu/cpu.cpp:1809-1817` — MATCH. |
| Direct primitive CoroutineResume/CoroutineYield dispatch through callBuiltinFunction raises INVALID_ARGUMENT; ordinary runBuiltinFunction has a separate transfer path. Do not infer direct `pcall(__bmsx_coroutine_yield, ...)` validity from public wrapper behavior. | `machine/ts/machine/cpu/cpu.ts:3716-3718` | `machine/cpp/machine/cpu/cpu.cpp:1759-1761` — MATCH; separate transfer routing TS cpu.ts:3847-3849, C++ cpu.cpp:1884-1886. |

## Primitive cycle charges (not total call timings)

| Fact | TypeScript exact location | C++ exact location / disposition |
|---|---|---|
| Primitive builtin base costs: error=2, pcall=4, xpcall=4; all three per-argument and per-return cost fields are zero. | `machine/ts/machine/cpu/value.ts:109-125` | `machine/cpp/machine/cpu/value.h:63-75` — MATCH by builtin IDs 9/10/11. |
| Ordinary builtin entry charges its base before protected dispatch. | `machine/ts/machine/cpu/cpu.ts:3841-3845` | `machine/cpp/machine/cpu/cpu.cpp:1876-1880` — MATCH. |
| A protected builtin target/handler also charges its own base. These are incremental primitive charges, not a constant total for pcall/xpcall bodies, handlers, or CALL/RET instruction execution. | `machine/ts/machine/cpu/cpu.ts:3931-3936` | `machine/cpp/machine/cpu/cpu.cpp:1932-1937` — MATCH. |

## Explicit gaps / non-claims

- No TS/C++ disagreement was found in the bounded protected-call rules above. No runtime behavior was changed or repaired.
- Source descriptors were inspected separately from runtime acceptance. Their advertised optional error level is not consumed by either inspected runtime. Do not import stock Lua level/traceback/string-decoration semantics.
- No overall maximum source argument count, maximum return count, compiler diagnostic/enforcement policy, or register-limit promise was established. Runtime return shaping above is the installed continuation behavior.
- No firmware coroutine public-wrapper extraction was performed here. The CPU rules above must not be substituted for an audit of `coroutine` public wrappers, close/wrap contracts, or public result conventions.
- No complete heap/OOM/reentrancy audit was performed. In particular, builtin-handler OOM escaping the local handler catch must remain distinct from classified guest errors in an executing closure handler. Do not state that every possible handler failure becomes `error in error handling`.
- No total cycles for a protected call are stated: body/handler instructions, surrounding CALL/RET, allocation/GC, interrupt work, and other operation costs are not totaled here.
- Hardware fault/IRQ/completion behavior is limited to the inspected entry/barrier code. No claim that pcall is a machine-fault sandbox or that it catches outside its thread/root is licensed.
- No standalone execution/test commands were run by this extraction agent. Root-owned program results, if used, are separate runtime evidence rather than evidence from this sheet.
