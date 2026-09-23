# Physical completion-call boundaries

Prerequisite found while auditing Studio execution results, 2026-09-23.
A completion root has its own return destination. It must not unwind into a
protected call belonging to the interrupted execution or yield/fail that
interrupted coroutine to its resumer. An unhandled completion error follows the
ordinary physical Lua-fault exception path, retaining the root for inspection.
Protected calls and child coroutines created **inside** the root still work.

## Representation and callsite gate (before implementation)

| Meaning | TypeScript owner | C++ owner | Representation |
| --- | --- | --- | --- |
| Completion return destination | `CallFrame.returnToCompletionLatch` | `CallFrame::returnToCompletionLatch` | Existing frame bit, already serialized |
| Exception boundary | `CallFrame.isExceptionFrame` | `CallFrame::isExceptionFrame` | Existing frame bit |
| Retained stack | `Thread.frames` | `Thread::frames` | Actual thread's ordered frames |
| Protected continuation | `Thread.protectedCallContinuations` | Same member | Caller/target frames and protected-call kind |
| Coroutine parent | `Thread.resumer`, `Thread.status` | Same members | Thread reference and machine enum |
| Unhandled Lua error | `handleRunLoopError` -> `enterLuaFaultException` | `runUntilDepthEntry` catch -> `enterLuaFaultException` | Existing trap/error words; no IDE result in the CPU |

Affected callsites, in both `machine/ts/machine/cpu/cpu.ts` and
`machine/cpp/machine/cpu/cpu.cpp`:

- `handleProtectedCallError`: existing exceptional unwind scan must stop at a
  completion root above the selected protected caller, just as at an exception.
- `handleThreadError`: existing coroutine-failure scan must not cross that root.
- `coroutineYieldable`: existing scan for `coroutine.isyieldable` and `yield`
  must recognize that the root has no coroutine-resume continuation.

No opcode dispatch, ordinary return, scheduler, source mapping, ABI encoding or
save-state layout changes. Each existing boundary scan gains one bit test; no
additional scan/allocation, cached state, source revision or Hot Resume branch.

## Production reference

Lua 5.4.8's [`luaD_callnoyield`](https://github.com/lua/lua/blob/v5.4.8/ldo.c#L661-L663)
and [`luaD_pcall`](https://github.com/lua/lua/blob/v5.4.8/ldo.c#L957-L972)
distinguish the embedding call boundary from Lua's surrounding resumable stack.
BMSX uses its existing physical completion-root bit, not Lua's C-stack counters
or longjmp implementation. This is a generic call-boundary repair, not an IDE
exception or a ban on ordinary guest coroutine yields/protected calls.

## Evidence

- All eight new O0/O3 TypeScript probes failed before the boundary repair and
  pass afterwards: interrupted protected caller, interrupted coroutine, illegal
  cross-root yield, and valid nested protected calls/child-coroutine yields.
- `npm run test:coroutines`: **28 TS/C++ vectors passed**, including those eight
  boundary probes. Each compares full decoded runtime snapshots across cores
  and exercises save-state encode/decode/restore, not just return values.
- `npm run audit:core-parity` passes. The physical representation and serialized
  state layout are unchanged. No performance-speedup claim is made; the only
  execution cost change is one bit test in the existing three boundary scans.
