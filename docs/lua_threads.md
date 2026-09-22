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
| Resume handoff | Resumer, destination register and result count | Same |
| External completion | Owning thread plus CPU completion latch | Same |
| Physical execution | CPU COP0/IRQ/HALT/bus state | Same; not copied on coroutine switches |
| Checkpoint | Ordinal thread objects and per-thread records | Same snapshot tags and words |

Audited hot paths: normal/instrumented dispatch; CALL, RET, VARARG and RFE;
builtin dispatch and protected-call entry/return/error; frame allocation,
register growth, upvalue closing, reset, completion calls, IRQ/NMI admission,
heap tracing, capture and restore. Runtime suspended calls and scheduler slices
carry their issuing thread, not just a numerical frame depth. Suspended calls
also accept a cycle grant; exhaustion returns `Yielded` with the continuation
intact. Internal coroutine handoffs continue inside that same grant.

A thread keeps its own stack across yields. Uncaught coroutine errors return
`false, error` to the resumer and retain the failed frames until close or
collection. Protected calls are thread-local. Error handlers and interrupt
frames cannot directly yield. Physical interrupts still enter the currently
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
and completion identities, per-thread status/entry/resumer/frames/protected
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
