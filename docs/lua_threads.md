# Retained Lua threads

The BIOS `coroutine` module implements create/resume/yield/status/running/close/
isyieldable/wrap using generic CPU primitives. These are captured during system
module initialization and cleared with the other boot primitives. No test or
input API belongs to the CPU.

## Representation and audited callsites

The owner audit preceded the mirrored implementation on 2026-09-22.

| State | TypeScript | C++ |
| --- | --- | --- |
| Guest identity | `ValueTag.Thread`, `Thread` reference | NaN-boxed `ValueTag::Thread`, `GCObject::Thread` |
| Language continuation | Thread frames, register arena, protected calls | Thread frame vector, value arena, protected calls |
| Open upvalue | Owning frame and its thread | Owning frame and its thread |
| Internal status primitive | Raw `ThreadStatus` ordinal 0..5 | Same ordinal; BIOS alone maps to Lua status names |
| Resume handoff | Resumer, destination register and result count | Same |
| External completion | Owning thread plus CPU completion latch | Same |
| Physical execution | CPU COP0/IRQ/HALT/bus state; HALT latches owning Thread and frame depth | Same; not copied on coroutine switches |
| Checkpoint | Ordinal thread objects and per-thread records | Same snapshot tags and words |

The final review audited the status builtin in both cores and BIOS `coroutine.status`/
`wrap`: only Failed closes after a rejected resume. Admission errors must not
close New, Suspended, Running, Normal or already-completed threads.

The final review additionally audited `Table.next` dead-key traversal (TS
`findNodeIndexForNext`, C++ `Table::findNodeIndexForNext`) and the coroutine
resume transfer gate (TS `runCoroutineTransfer`, C++ `CPU::runCoroutineTransfer`).
Both consume the existing Thread tag and exception-frame representation above;
HALT admission additionally compares its owning thread, not another thread at the same depth.
The single physical latch is cleared by reset, hard halt, exception admission and
explicit wake. Its thread is a GC root and snapshot reference. Audited callsites:
normal/instrumented dispatch, `isHaltedUntilIrq`, HALT, reset/EXEC, exception entry,
heap tracing, CPU capture/restore and both save-state codecs.

Audited hot paths: normal/instrumented dispatch; CALL, RET, VARARG and RFE;
builtin dispatch and protected-call entry/return/error; frame allocation,
register growth, upvalue closing, reset, completion calls, IRQ/NMI admission,
heap tracing, capture and restore. Runtime suspended calls and scheduler slices
carry their issuing thread, not just a numerical frame depth. Suspended calls
also accept a cycle grant; exhaustion returns `Yielded` with the continuation
intact. Internal coroutine handoffs continue inside that same grant.

A thread keeps its own stack across yields. Uncaught coroutine errors return
`false, error` to the resumer and retain the failed frames until close or
collection. Protected calls are thread-local. Error handlers cannot directly yield. An active hardware-exception frame
forbids coroutine resume as well as yield: the physical exception continuation
cannot be parked on a resumer while privileged execution moves to another
thread. Failed resume admission returns false without changing either thread. Physical interrupts still enter the currently
executing continuation and RFE returns there.

Guest heap accounting includes a 64-byte virtual thread header and eight bytes
per retained arena slot in both cores. An arena starts at eight slots and grows
geometrically. Frames initially reserve their actual register requirement, not
an individually rounded arena. Dynamic varargs/results grow at their owner
boundary. Returning a variable-sized result retains the source frame until the
caller has grown and received the values; no temporary result allocation is
needed for native RET.

## Persistence

After representation and bounded-resumption tests passed in both cores, the
owning runtime save-state envelope advanced to schema 2. It stores root, active
completion and HALT-owner identities, per-thread status/entry/resumer/frames/protected
calls/error/arena capacity, and each open upvalue's owning thread and frame.
Older envelopes are rejected; there is no legacy-stack compatibility layout.
Restore allocates identities before edges and all frames before open upvalues.

## Evidence

- `tests/lua/coroutine.test.ts`: O0/O3 vectors, 17-cycle grants, capture/restore
  after every grant; nested suspension, wide varargs, protected failures,
  retained error frames, weak collection/open upvalues, close, and NMI/RFE.
- `npm run test:coroutines`: the same compiled ROMs on TS and C++; runtime
  codec round trips and decoded full-machine state equality between cores.
- Existing CPU/interrupt/heap/save-state suites and native CTest remain the
  regression surface. Real-cart replay uses `npm run test:runtime-replay`.

These tests prove the language foundation, not completion of the guest testing
framework migration described in `testing_framework_design.md`.

Reference: [Lua 5.4 coroutine implementation](https://github.com/lua/lua/blob/v5.4.8/lcorolib.c).
