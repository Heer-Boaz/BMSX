# IRQ source, programming and figure review

Accepted for the current chapter. Public manuscript: `docs/book1/irq.md`;
frozen source evidence: `docs/book1/facts/irq.md`. Print acceptance is recorded
separately in [irq-print.md](irq-print.md). Book I as a whole is not complete.

## Scope and independent work

Three independent extractions cover controller registers/state, CPU delivery and
actual firmware/source-language patterns. Their scoped mirrored owners agree;
the shared compiler/BIOS producers are explicitly single-source, not described
as independently mirrored implementations. Neither the architecture document nor
reference PDF was input to extraction or authorship.

P01 and P02 were separate prose assignments from frozen fact slices. A separate
implementation assignment supplied the executable cartridge and ordinary guest
suite. Root merged those with the register, producer-rearming and timing sections.
A nonauthor checked every public claim, numeric cell, code listing and diagram
against scoped live owners; another reader checked the complete programming route.
No unresolved factual or instructional failure remains in the reviewed scope.

The production-reference comparison used MAME's
[interrupt-controller source](https://github.com/mamedev/mame/blob/master/src/devices/machine/am9519.cpp)
for separation of request, retained mask and service responsibilities only. No
foreign mask polarity, priority, addresses, bits or timing became BMSX facts.
No publishing layer, stylesheet, font, runtime, firmware or library change was needed.

## Runnable cartridge and actual guest execution

Runnable source is [irq_manual](../../../carts/irq_manual/README.md), with
[entry code](../../../carts/irq_manual/cart.lua), [typed retained storage](../../../carts/irq_manual/results.lua)
and the [integration suite](../../../tests/carts/irq_manual/irq_manual_assert.lua).
The public manuscript explicitly maps the two modules to `results.lua` and
`cart.lua`. The ten W01 printed Lua blocks reproduce both actual modules after
indentation/blank-line normalization. The additional generic wait fragments
are explicitly not a complete source-specific handler.

The example follows the actual BIOS patterns recorded in B01–B10: typed word
ports, named fixed records, explicit BSS shared with the IRQ handler and
predicate-based `halt_until_irq`. Its const result module owns 180 BSS bytes
and exports an address, not another runtime register facade. Standard boot
masks before executing the cartridge and leaves the beam timing running.
The example is not a rendering demonstration and needs no screenshot.

Executed through the normal ROM/BIOS/cartridge path:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- irq_manual --debug
npm run headless:test -- irq_manual tests/carts/irq_manual/irq_manual_assert.lua
```

The integration case passes. It checks all 40 phase fields plus both handler
words, service count, zero-ACK preservation and final register/latch states:

| Observation | Actual result |
|---|---|
| Pending by phase | `04,44,44,44,44,04,04,04` |
| MASK by phase | `00,00,00,00,40,40,40,00` |
| GPU-local24 by phase | `0,1,0,1,1,0,0,0` |
| Software service count by phase | `0,0,0,0,0,1,2,2` |
| Complete handler arguments | `44,44`, not just the enabled subset40 |
| Every retained ACK read | Zero |
| Pending after explicit ACK0 | `44` |
| Final state | Pending04; MASK0; GPU-local request clear |

Phase4 records the delivered argument inside the first handler before service;
it is not a main-code observation racing the unmask write. These are controlled
software observations, not a hardware event count, electrical measurement,
fixed interrupt latency or sustained interrupt-rate guarantee.

## Independent mirrored mapped-boundary replay

Real Memory and IRQ-controller owners passed 10,972 assertions in TypeScript
and another 10,972 in C++. The native scratch executable compiled the current
controller.cpp and memory.cpp directly, using existing static libraries only
for dependencies. No new build infrastructure or runtime patch was introduced.

The independently replayed cases cover:

- Full32-bit raise-OR, ACK-AND-NOT and MASK replacement equations; all32 one-hot
  bits including bit31 and unnamed bits; 2,048 deterministic mixed operations.
- Repeated-raise coalescence, masked retention/unmask assertion, selective clear,
  ACK0, ACK read-zero, reset and non-clearing FLAGS reads.
- FLAGS write READ_ONLY3; aligned byte low8 reads; non-word-offset byte reads,
  byte stores, halfword accesses and unaligned mapped words faulting before
  controller effects.
- F32 bit transfers; F64 adjacent low/high operations and first-word fault
  stopping before ACK; admitted DMA operations through the actual mapped paths.

This is controller/mapped-boundary parity evidence, not full native guest
execution or a source-to-handler latency benchmark.

## Qualified cycle-budget finding

The source review caught two proposed overgeneralizations before publication:
logical instructions are not stored words when WIDE prefixes are present, and
the less-optimized entry's10/7-cycle paths do not describe the actual example.
The independent compile/link audit checked optimization levels0–3. O0–2 retain
an extra K0; O3 compares against zero as a constant operand.

Root then decoded the actual `irq_manual.debug.rom` through the existing
ROM/image/disassembler owners; the nonauthor independently reran that inspection.
Its IRQ entry is LOADK, LOAD_MEM, EQ, JMP, GETGL, MOV, CALL, RFE. Nonzero FLAGS
skips JMP: seven logical operations, nine ISA base cycles. Zero FLAGS executes
five logical operations, six base cycles. TS and C++ ISA charge tables agree.

The public table is limited to this particular example entry, excludes callback
execution and its RET, and is not a universal entry cost, request latency or
closed-mask/disabled-IEc wait bound. No stored-word count is published. The
rejected generalizations were audit findings, not runtime bugs.

## Reader and figure findings resolved

The independent reader requested explicit two-module assembly and the startup-
zeroed BSS initial state. Both statements are present and rechecked. The public
chapter keeps host commands/tests/source provenance out; the runnable-artifact
links belong in this editorial report. P02 closes the CPU acceptance, post-entry
full-FLAGS read, STATUS/EPC/CAUSE, privilege, return, no-automatic-ACK and
predicate/HALT explanation. The03→0c→03 example and one-bit accepted-event
latch agree with the frozen facts. No invented critical-section or nesting API
is introduced.

The figure keeps source arrival and selective clear independent of MASK.
FLAGS branches from full pending before the AND/nonzero delivery gate. Root
changed the ACK box from a formula with a missing drawn P input to a clear-
selection control input; the independent reader accepted the final topology.
CPU IE is explicitly outside the figure. Final PDF legibility is separately
accepted in the print report.

Six focused existing CPU tests pass: closed-mask acceptance, HALT's accepted-
event latch, compiled cartridge dispatch/ACK, captured-local behavior,
unacknowledged re-entry, and enabling an already-pending request. Their names
are not used to promise an unfused source-instruction boundary or fixed latency.
All16 shared manual tests pass; these prove publisher contracts, not source truth.

## Software-authoritative limits

The installed system timebase, instruction-base charges, register visibility and
acceptance conditions are documented. Independent IRQ oscillator/pin timing,
physical bus arbitration and sustained interrupt-rate ratings are separate
future hardware-specification decisions, not invented numbers or open editorial
claims. This follows the explicit software-authority decision recorded in the
fact sheet. Cartridge-source names do not import Book II device programming.

No publication decision is based on page count or merely on a successful build.
