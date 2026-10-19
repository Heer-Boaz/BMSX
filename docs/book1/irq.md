# Interrupt controller

The interrupt controller records pending interrupt bits and combines them with an enable mask to produce one maskable interrupt indication. Its pending word is a set of latched bits, not an event counter or a queue. Masking a bit prevents that bit from asserting the output; it does not prevent the bit from becoming pending and does not acknowledge it.

The controller receives requests from the two DMA channels, PCRTC, the geometry unit, the APU, the GPU command processor, the image decoder and the two cartridge slots. VBlank has its own source bit. Their assigned bits are listed in the register reference. Each producer defines its request conditions and any local acknowledgement or re-arming; the controller does not replace those source-specific rules.

The controller's output feeds CPU interrupt acceptance. Acceptance also requires `STATUS.IEc` to be set and takes a shared IRQ exception entry rather than a separate entry for each source. Source selection and service remain software work. [CPU delivery and waiting](#cpu-delivery-and-waiting) describes that boundary in detail.

### IRQ specifications

| Resource | Specification |
|---|---|
| Register interface | Three 32-bit word ports, four-byte spacing; 12 bytes of address space |
| Pending storage | One 32-bit pending word, not an event queue |
| Delivery selection | One 32-bit enable word, reset to zero |
| Named source bits | Eleven, bits 0–10; the remaining word bits are not removed by controller operations |

These register-address bytes are not a payload RAM capacity. The full
address/access/reset and named-source tables appear in the register reference.

![Pending latches and delivery mask](figures/irq-pending.svg)

FLAGS reads the full pending word. The diagram ends at the controller output;
the CPU interrupt-enable gate is separate.

### Latching, masking and acknowledgement

Let **P** be the pending word, **M** the mask, **R** a raised-bit word and **A** an accepted ACK word. All bitwise operations below are 32-bit operations:

```text
Raise R:       P ← P OR R         M is unchanged
Write MASK W:  M ← W              P is unchanged
Write ACK A:   P ← P AND NOT A    M is unchanged

Interrupt indication asserted ⇔ (P AND M) ≠ 0
```

Raising a bit latches it regardless of MASK. Raising it again while it remains pending leaves the same bit set; the controller does not record how many times it was raised. This is coalescing, not a backlog of events.

MASK selects which pending bits can assert the output. Each MASK write replaces the previous mask rather than adding to it. Consequently, enabling an already-pending bit can assert the output without another raise, while disabling it leaves its pending state intact.

ACK clears exactly the pending bits selected by its written ones. Written zeros preserve the corresponding pending bits, so writing `00000000H` changes nothing. Reading FLAGS also changes nothing. An ACK need not clear every pending bit: the output remains asserted whenever another bit remains set in both P and M. The same equation applies to unnamed bits retained in those words.

An accepted ACK or MASK write changes the controller state before that write completes. This is the register-write visibility edge; it does not specify CPU interrupt delivery, a priority order, or a fixed interrupt-entry delay.

### Worked operation trace

The following sequence uses `IRQ_GPU` (`00000040H`) and `IRQ_VBLANK` (`00000004H`) only as bit names. “Raise” means that the indicated word is presented to the controller; no device trigger is implied. Each row shows state after the operation.

| Operation | P | M | Indication |
| --- | --- | --- | --- |
| Reset | `00000000H` | `00000000H` | Clear |
| Raise `00000040H` | `00000040H` | `00000000H` | Clear |
| Raise `00000040H` again | `00000040H` | `00000000H` | Clear |
| Write MASK `00000044H` | `00000040H` | `00000044H` | Asserted |
| Raise `00000004H` | `00000044H` | `00000044H` | Asserted |
| Write ACK `00000040H` | `00000004H` | `00000044H` | Asserted |
| Write MASK `00000040H` | `00000004H` | `00000040H` | Clear |
| Write ACK `00000000H` | `00000004H` | `00000040H` | Clear |
| Write MASK `00000004H` | `00000004H` | `00000004H` | Asserted |
| Write ACK `00000004H` | `00000000H` | `00000004H` | Clear |

The repeated GPU raise coalesces into one pending bit. The first ACK clears GPU but leaves VBlank pending and enabled. Replacing MASK with `00000040H` hides VBlank without clearing it; enabling VBlank again exposes that same pending bit. Only the final ACK clears it.

## CPU delivery and waiting

### From pending requests to `irq(flags)`

A maskable interrupt is accepted only when both conditions hold:

- At least one bit is set in `IO_IRQ_FLAGS & IO_IRQ_MASK`.
- The CPU's current interrupt-enable bit, `STATUS.IEc`, is set.

Masking a source does not discard its pending request. Source requests accumulate in `IO_IRQ_FLAGS` independently of `IO_IRQ_MASK`; repeated requests for an already-pending source retain one bit, not a count.

The CPU does not choose the highest-priority source or take one vector per pending bit. An accepted maskable interrupt takes the shared IRQ entry for the current execution context: the active program's entry in user mode, or the system entry in non-user mode. Software determines which pending sources to service.

The cartridge IRQ entry reads the **complete `IO_IRQ_FLAGS` word after exception entry** and, if that word is nonzero, calls `irq(flags)` with it. This is a fresh register read, not a snapshot captured when the CPU accepted the interrupt. The argument is not filtered through `IO_IRQ_MASK`: it can include masked pending sources alongside the source that enabled delivery. Returning normally from `irq(flags)` returns control to the IRQ entry, which executes `RFE`.

Neither exception entry nor ordinary interrupt return acknowledges a source. Software must write the appropriate bits to `IO_IRQ_ACK`. Writing one clears the corresponding pending bit; writing zero leaves it unchanged. A source left pending and enabled can request delivery again once `IEc` is restored.

> **Caution — delivery is not source selection.** Do not assume that every bit supplied to `irq(flags)` was enabled, or that the CPU has already acknowledged any of them.

### CPU state on entry and return

The relevant CP0 registers are `STATUS` (register 12), `CAUSE` (13), and `EPC` (14). In `STATUS`, bit 0 is current interrupt enable and bit 1 selects current user mode. Cartridge entry begins with `STATUS = 00000003H`: user mode, interrupts enabled. System entry uses `00000001H`: non-user mode, interrupts enabled.

On accepted IRQ entry, the CPU records the interrupted PC in `EPC`, writes `00000400H` to `CAUSE`, and shifts the six low mode-stack bits left by two:

```text
STATUS := (STATUS & ~0000003fH) | ((STATUS << 2) & 0000003fH)
```

Both current bits become zero. The handler therefore executes in non-user mode with maskable interrupts disabled; entry does not establish automatic priority-based nesting.

For a cartridge beginning at `00000003H`, the complete worked sequence is:

```text
Before IRQ:       STATUS = 00000003H  user mode; IEc = 1
After IRQ entry:  STATUS = 0000000cH  non-user mode; IEc = 0
After RFE:        STATUS = 00000003H  user mode; IEc = 1
```

`RFE` returns to the address in `EPC` and restores the low four status bits as follows:

```text
STATUS := (STATUS & ~0000000fH) | ((STATUS >> 2) & 0000000fH)
```

`RFE` is an exception-return instruction, not a general procedure return. It requires non-user mode and an exception to return from. User-mode execution takes the coprocessor-unusable exception; execution without an exception to return from hard-halts.

Privilege also matters for CP0 access. In user mode, `MFC0` and `MTC0` take the coprocessor-unusable exception. In non-user mode, `MFC0` can read these three registers; `MTC0` replaces `STATUS` or `EPC`, but does not change `CAUSE`. Writing `STATUS` replaces the whole word, not just `IEc`.

### Wait for service, not merely for a wake-up

`halt_until_irq` is a statement that executes the CPU's `HALT` instruction. It is not a function call. HALT and controller acknowledgement are separate operations.

An accepted interrupt can leave a one-bit accepted-event indication when the CPU was not already waiting. If this indication is present, the next HALT consumes it and continues without establishing a wait. Otherwise HALT waits for interrupt acceptance. This closes the ordinary interval between checking software state and executing HALT, but it does **not** make HALT an event counter: several accepted interrupts can collapse into the same retained indication.

Use an explicit software predicate. For example, reserve a mutable service sequence in BSS, whose initial value is zero:

```lua
bss service_count: word
```

In the selected service path of `irq(flags)`, complete that source's work and required acknowledgement, then advance the sequence:

```lua
*service_count = *service_count + 1
```

The caller snapshots the sequence **before** starting the operation that will request this service, then waits for it to change:

```lua
local before<const> = *service_count
-- Start the operation that will request the selected service here.
while *service_count == before do
    halt_until_irq
end
```

These are fragments of a source-specific protocol, not a replacement IRQ handler. Only the selected completed service advances this counter. Other interrupts may wake the caller without satisfying its predicate, and the selected handler may already have completed before HALT executes. The loop handles both cases. The software counter records completed services; it cannot reconstruct source requests that already coalesced in a controller pending bit.

> **Caution — a pending bit alone need not wake HALT.** Maskable acceptance still requires a matching mask bit and `IEc = 1`. Do not wait for a source while disabling its delivery and expect its raw pending bit to suffice.

Device timers continue to progress during HALT; parked CPU instructions do not execute. No fixed request-to-handler latency or guaranteed acceptance boundary after every source instruction is specified here.

## Timing and service cost

The installed system-cycle timebase is 33.8688 MHz: 33,868,800 cycles per second.
One system cycle is approximately 29.525699 ns. This states the cycle unit, not a
maximum interrupt rate or an electrical propagation delay.

ACK and MASK change controller state on their accepted word writes. A pending
enabled bit can therefore assert the line as a result of a MASK write, without
another source request. CPU acceptance also requires IEc; assertion of the
controller output and execution of a cartridge handler are not the same edge.

| Instruction | ISA base cost, system cycles |
|---|---|
| `HALT` | 1 |
| `MFC0` | 1 |
| `MTC0` | 1 |
| `RFE` | 1 |
| `LOAD_MEM`, including the IRQ entry's FLAGS read | 2 |

These are individual instruction base costs. A complete service additionally
includes the IRQ entry sequence, dispatch and handler work, acknowledgement and
return; the FLAGS load alone is not its cycle budget. Nor is one HALT cycle a
request-to-handler delay. During a HALT wait, device timing continues even though
the parked instructions do not execute. Source timing, masking and service work
must be considered separately when scheduling the cartridge.

### Entry-sequence budget for the cartridge example

The IRQ entry sequence used by the complete cartridge example compares FLAGS
directly with a zero constant. Its own instruction-base charge is as follows:

| Entry operation | Nonzero FLAGS path | Zero FLAGS path |
|---|---|---|
| Load FLAGS address | 1 | 1 |
| Read FLAGS word | 2 | 2 |
| Compare with zero | 1 | 1 |
| Branch past the call | Skipped | 1 |
| Load the `irq` function | 1 | — |
| Move FLAGS into its argument | 1 | — |
| Call `irq(flags)` | 2 | — |
| `RFE` | 1 | 1 |
| **Entry-sequence total, cycles** | **9** | **6** |

Callback execution, including the callback's own return instruction, is extra.
The table describes this particular entry program, not every possible entry
sequence or the delay from a source request to service. In particular, it does
not include time spent pending behind a closed MASK or disabled IEc.

## Acknowledge the source and the controller separately

Controller ACK removes a pending bit. It is not a command to the unit that
raised that bit. The GPU provides a concrete example of the distinction:

- GP0 word `1f000000H` is an in-order interrupt marker. When it executes with
  GPUSTAT24 clear, it sets that local bit and raises controller bit 6.
- GP1 word `02000000H` clears GPUSTAT24. It does not clear controller bit 6.
- Writing `00000040H` to IO_IRQ_ACK clears controller bit 6. It does not clear
  GPUSTAT24.

The marker's low 24 bits do not select an interrupt number. A marker while
GPUSTAT24 remains set does not raise another GPU request. Nor does GPU idle
alone raise an interrupt.

### Controller clear alone does not re-arm the GPU

Start with both GPU-local and controller pending bits clear. Keep delivery
masked while following this sequence:

| Ordered operation | GPUSTAT24 | FLAGS bit 6 | Meaning |
|---|---|---|---|
| Execute first GP0 marker | 1 | 1 | Both latches record the request |
| Write ACK=`00000040H` | 1 | 0 | Controller cleared; GPU still latched |
| Execute another GP0 marker | 1 | 0 | No new request while the GPU latch stays set |
| Write GP1=`02000000H` | 0 | 0 | GPU re-armed |
| Execute a further GP0 marker | 1 | 1 | A new independent request is recorded |

The opposite partial acknowledgement is different: clearing only GPUSTAT24
leaves controller bit 6 pending. A new marker can then raise bit 6 again, but
OR-ing it into an already-set pending bit still leaves just one pending bit.
The cartridge below demonstrates exactly that coalescence before enabling
delivery.

These are GPU rules, not a universal acknowledgement sequence for every source.
The [GPU command reference](gpu.md) specifies the marker's queue ordering and
its separate completion/idle conditions. Neither a marker nor controller ACK
is a display-publication acknowledgement; display latching remains a
[PCRTC](pcrtc.md) operation.

### A pending bit cannot count arrivals during service

For one selected source, let P be its pending bit. A raise sets P to 1; ACK
sets P to 0. The order matters:

| Operation order | Final P |
|---|---|
| Raise, then ACK | 0 |
| ACK, then raise | 1 |
| Raise, raise, then ACK | 0 |

Consequently a flags read followed later by an acknowledgement is not an
atomic read-and-consume transaction. A second request that arrives before
that clear can coalesce with the first and be removed by the same clear.
A request after the clear becomes pending again. No acknowledgement order can
turn this one-bit latch into a count of all source events.

Keep a software service count distinct from a source-event count. The example's
two callback increments mean two controlled services after selected re-arming;
they do not prove that arbitrary source traffic always has one callback per event.

### Choose one cartridge dispatch route

A direct cartridge defines `function irq(flags)` and owns its source selection,
local service and controller acknowledgement. Its argument is the full pending
word read by the IRQ entry sequence, not FLAGS AND MASK. If only GPU service is
owned, clearing `flags & 00000040H` preserves other pending sources; clearing the
entire argument does not.

The alternative `cartlib/irq` module installs that global IRQ function itself.
`register(source, handler)` records the callback and enables its MASK bit;
`unregister(source)` removes the callback and disables its MASK bit. Its
installed handler filters the delivered word with the current MASK, selects
one least-significant pending source at a time, acknowledges that controller
bit **before** calling `handler(source)`, and repeats for its local selection.
The callback still owns any source-local re-arming.

This traversal order is a software-dispatch policy, not controller source
priority. Because registration enables delivery, prepare the source's state
before registering it. Do not also install a different global `irq` handler
while using this module. The complete example below uses the direct route
and does not require that dispatcher.

## Register reference

Use four-byte-aligned, 32-bit word accesses. The three addresses name separate
operations: a pending-word read, a selective clear and an enable-word replacement.

| Address | Name | Access | Bits | Reset |
|---|---|---|---|---|
| `08000000H` | `IO_IRQ_FLAGS` | Read only | 31:0 pending requests | `00000000H` |
| `08000004H` | `IO_IRQ_ACK` | Read zero / write-one-to-clear | 31:0 pending-bit clear selection | `00000000H` |
| `08000008H` | `IO_IRQ_MASK` | Read/write | 31:0 delivery enables | `00000000H` |

### IO_IRQ_FLAGS — pending requests

Each set bit records a pending request. Reading the word leaves every bit
unchanged. A source request sets its pending bit even when the corresponding
MASK bit is zero. Another request while the bit is already set does not add a
second entry or increment a count.

FLAGS is not the enabled subset. For example, FLAGS=`00000044H` and
MASK=`00000040H` means that both bit 2 and bit 6 are pending, but only bit 6 enables
the controller output. Writing FLAGS does not acknowledge it; the write is
rejected with READ_ONLY bus fault 3.

### IO_IRQ_ACK — selective pending clear

A written one clears the corresponding pending bit; a written zero preserves
it. The operation is:

```text
pending := pending AND NOT written_word
```

The clear takes effect on the accepted register write. It does not replace
MASK, clear a source unit's local status, or record the word that was written.
ACK reads `00000000H` after reset and after each accepted write.

With FLAGS=`00000044H`, writing ACK=`00000040H` leaves FLAGS=`00000004H`.
Writing ACK=`00000000H` changes nothing. Writing ACK=`ffffffffH` clears every
pending bit, including disabled ones; it is not selective service of the source
that caused an interrupt.

### IO_IRQ_MASK — delivery enables

A set bit enables that pending bit to contribute to the output line. A clear
bit excludes it from the output line without erasing it. Reading MASK returns
the current enable word. An accepted write replaces all 32 bits immediately;
it is not a set-bits command.

For example, replacing MASK=`00000040H` with `00000004H` disables bit 6 and enables
bit 2. To keep both enabled the replacement word must be `00000044H`. MASK=0
closes delivery from this controller; it neither clears pending requests nor
acknowledges their producers. Enabling an already-pending bit can assert the
output without waiting for another source request.

### Named source bits

The same bit position is used in FLAGS, ACK and MASK. The names identify the
source; they do not make all source units use the same request or re-arm rule.

| Bit | Mask | Source name |
|---|---|---|
| 0 | `00000001H` | `IRQ_DMA0_DONE` |
| 1 | `00000002H` | `IRQ_GX_PCRTC` |
| 2 | `00000004H` | `IRQ_VBLANK` |
| 3 | `00000008H` | `IRQ_GEO_DONE` |
| 4 | `00000010H` | `IRQ_GEO_ERROR` |
| 5 | `00000020H` | `IRQ_APU` |
| 6 | `00000040H` | `IRQ_GPU` |
| 7 | `00000080H` | `IRQ_IMGDEC` |
| 8 | `00000100H` | `IRQ_DMA1_DONE` |
| 9 | `00000200H` | `IRQ_CARTRIDGE_SLOT0` |
| 10 | `00000400H` | `IRQ_CARTRIDGE_SLOT1` |

Bits 31:11 are unnamed, not hardwired-zero fields. MASK retains their written
values, and the controller's pending, clear and output equations operate on
the complete 32-bit words. This does not assign a cartridge-programmable request
source to an unnamed bit. Cartridge-source device programming belongs to Book III.

## Register access, faults and reset

The following rules concern the three controller words. A word access still
obeys the read-only rule for FLAGS.

| Mapped data access | Address condition | Result |
|---|---|---|
| Register-word or U32 read/write | Four-byte aligned | One complete register operation |
| U8 read | At a register's word address | Full register read, returning bits 7:0 |
| U8 read | Word offset 1,2 or 3 | UNALIGNED_IO bus fault 2; no register operation |
| U8 write | Any controller byte address | UNALIGNED_IO bus fault 2; no register operation |
| U16 read/write | Even controller address | UNALIGNED_IO bus fault 2; no register operation |
| Word write to FLAGS | At `08000000H` | READ_ONLY bus fault 3; pending unchanged |

CPU alignment rejection precedes these mapped-access rules. The common address
exception and system fault-latch contract is described under
[PCRTC](pcrtc.md), Sections 2.10 (bus access) and 2.11 (faults). Do not use IRQ_ACK to acknowledge that separate
system bus-fault latch.

F32 transfers one word's bits. F64 transfers the low word at A and the high word
at A+4, stopping if the first access faults. Thus an F64 store starting at FLAGS
faults before ACK is reached. Starting at ACK instead performs a pending clear
followed by a MASK replacement; it is not a combined controller operation.
Use separate word stores when those are the operations intended.

Reset clears pending and MASK and returns ACK readback to zero. Writing MASK=0
alone does not reproduce reset: pending requests remain. Writing ACK with all
ones alone does not reproduce reset either: the enable word remains unchanged.
Source-unit reset and re-arming remain that unit's separate operations.

## A complete cartridge experiment

This experiment leaves a disabled VBlank request pending while it raises GPU
requests. It demonstrates retention, selective acknowledgement, re-arming and
coalescence without drawing a picture. It does not measure an interrupt latency.

### Starting conditions

Start through the standard boot firmware and retain its running beam timing.
Do not stop or reprogram the beam during the experiment: the initial poll needs
a VBlank entry to raise bit 2. CPU interrupt enable remains at cartridge-entry
state; the program changes only the controller MASK, not CP0 STATUS.

The program owns GP0 exclusively. There is no unfinished packet, readback or
DMA transfer and no other active source producer apart from the retained
periodic VBlank request. Preparation masks controller delivery, waits for GPU
idle, clears its local request latch and clears controller bits other than
VBlank. It then polls FLAGS bit 2 rather than executing HALT while that bit is
masked.

### Retained observations

Build the first listing as the const module `results` (`results.lua`). Build
all the subsequent listings, in order, as one entry module (`cart.lua`); they
are consecutive parts of that program, not separate cartridge entries.

The module named `results` owns one explicit BSS record. A phase records the
full FLAGS word, the MASK word, GPUSTAT24 as a masked word, the software service
count and ACK readback. The record occupies 180 bytes: five header words and
eight five-word phase records. The const module exports the storage address;
the record is not a Lua table standing in for registers.

Startup zeroes the BSS words before entry. The initial service count is therefore
zero, and the first handler writes handler-word slot 0. The handler and main
program share that same retained record.

```lua
module<const>

struct irq_manual_phase
	flags: word
	mask: word
	gpu_local: word
	services: word
	ack: word
end

struct irq_manual_result
	completed_phase: word
	gpu_services: word
	handler_flags: word[2]
	ack_zero_flags: word
	phases: irq_manual_phase[8]
end

bss result: irq_manual_result

return { result = result }
```

### Ports and direct handler

The entry module imports that address and programs actual word ports. The
handler records its full argument before acknowledging only GPU. Phase 4 is
recorded **inside the first handler, before service**, not by main code racing
the newly enabled interrupt. No other code issues GP0 commands during service.

#### Ports

```lua
module<entry>

local state<const> = require('results')
local result<const>: *irq_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local gp0<const>: *word = 0x0801023c
local gp1<const>: *word = 0x08010240
```

#### IRQ service

```lua
function irq(flags)
	result.handler_flags[result.gpu_services] = flags
	if (flags & 0x00000040) ~= 0 then
		if result.gpu_services == 0 then
			-- The vector supplied the complete pending word, not FLAGS & MASK.
			result.phases[4].flags = flags
			result.phases[4].mask = *irq_mask
			result.phases[4].gpu_local = *gp1 & 0x01000000
			result.phases[4].services = result.gpu_services
			result.phases[4].ack = *irq_ack
		end
		*gp1 = 0x02000000
		*irq_ack = 0x00000040
		result.gpu_services = result.gpu_services + 1
	end
end
```

#### Prepare with delivery masked

```lua
-- Keep the standard BIOS's running beam; this is not a display-reset demo.
*irq_mask = 0
while (*gp1 & 0x04000000) == 0 do
end
*gp1 = 0x02000000
-- Preparation clears stale boot requests but deliberately preserves VBlank.
*irq_ack = 0xfffffffb
while (*irq_flags & 0x00000004) == 0 do
end
result.phases[0].flags = *irq_flags
result.phases[0].mask = *irq_mask
result.phases[0].gpu_local = *gp1 & 0x01000000
result.phases[0].services = result.gpu_services
result.phases[0].ack = *irq_ack
result.completed_phase = 0
```

#### First masked request

```lua
-- First masked GPU request: the controller retains both pending sources.
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
result.phases[1].flags = *irq_flags
result.phases[1].mask = *irq_mask
result.phases[1].gpu_local = *gp1 & 0x01000000
result.phases[1].services = result.gpu_services
result.phases[1].ack = *irq_ack
result.completed_phase = 1
```

#### Clear only the GPU-local latch

```lua
-- Clear only the source latch. The controller's pending bit is independent.
*gp1 = 0x02000000
while (*gp1 & 0x01000000) ~= 0 do
end
result.phases[2].flags = *irq_flags
result.phases[2].mask = *irq_mask
result.phases[2].gpu_local = *gp1 & 0x01000000
result.phases[2].services = result.gpu_services
result.phases[2].ack = *irq_ack
result.completed_phase = 2
*irq_ack = 0
result.ack_zero_flags = *irq_flags
```

#### Second masked request

```lua
-- A second independent request coalesces into the already-pending bit.
*gp0 = 0x1f000000
while (*gp1 & 0x01000000) == 0 do
end
result.phases[3].flags = *irq_flags
result.phases[3].mask = *irq_mask
result.phases[3].gpu_local = *gp1 & 0x01000000
result.phases[3].services = result.gpu_services
result.phases[3].ack = *irq_ack
result.completed_phase = 3
```

#### Enable delivery and observe first service

```lua
*irq_mask = 0x00000040
while result.gpu_services == 0 do
	halt_until_irq
end
result.phases[5].flags = *irq_flags
result.phases[5].mask = *irq_mask
result.phases[5].gpu_local = *gp1 & 0x01000000
result.phases[5].services = result.gpu_services
result.phases[5].ack = *irq_ack
result.completed_phase = 5
```

#### Re-arm and observe second service

```lua
-- Both GPU latches were acknowledged; a fresh marker can request service.
*gp0 = 0x1f000000
while result.gpu_services == 1 do
	halt_until_irq
end
result.phases[6].flags = *irq_flags
result.phases[6].mask = *irq_mask
result.phases[6].gpu_local = *gp1 & 0x01000000
result.phases[6].services = result.gpu_services
result.phases[6].ack = *irq_ack
result.completed_phase = 6
```

#### Leave delivery masked

```lua
*irq_mask = 0
result.phases[7].flags = *irq_flags
result.phases[7].mask = *irq_mask
result.phases[7].gpu_local = *gp1 & 0x01000000
result.phases[7].services = result.gpu_services
result.phases[7].ack = *irq_ack
result.completed_phase = 7
while true do
	halt_until_irq
end
```

### Reading the result

The phase numbers identify retained observations, not equal-duration time slots.
Words in the following table are hexadecimal; service counts are decimal.
GPU24 is shown as its complete masked word, not shifted to bit 0.
Phase 4's FLAGS column records the IRQ entry's delivered argument; the other
rows read FLAGS directly. These observations do not constitute an atomic
snapshot operation across the register ports.

| Phase | Observation | FLAGS | MASK | GPU24 | Services |
|---|---|---|---|---|---|
| 0 | Masked VBlank retained | `04` | `00` | `00000000` | 0 |
| 1 | First marker | `44` | `00` | `01000000` | 0 |
| 2 | GPU-local clear only | `44` | `00` | `00000000` | 0 |
| 3 | Second marker coalesced | `44` | `00` | `01000000` | 0 |
| 4 | First handler, before service | `44` | `40` | `01000000` | 0 |
| 5 | First service completed | `04` | `40` | `00000000` | 1 |
| 6 | Third marker and second service completed | `04` | `40` | `00000000` | 2 |
| 7 | Delivery masked again | `04` | `00` | `00000000` | 2 |

Every retained ACK read is zero. The explicit ACK=0 between phases 2 and 3 leaves
FLAGS=`44`. Both recorded handler arguments are `44`, although the enabled
subset is only `40`. Clearing GPU alone in each handler leaves disabled VBlank
pending. No handler is called merely to dispose of that disabled bit.

This is a controlled diagnostic sequence, not a general interrupt dispatcher.
The two handler-word slots match its two services. A cartridge with a different
producer schedule must design its retained observations and service protocol
for that schedule; these two slots are not hardware event storage.
