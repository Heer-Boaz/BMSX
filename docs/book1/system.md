# System control and timing

The system controller maintains console-time readouts, accepts reset requests
and coordinates BIOS supervisor service. Its fault-report words retain CPU
diagnostics for the monitor. A separate pair of ports provides line-oriented
diagnostic text output.

Cartridge programs normally use TIME_MS to measure elapsed time and the two
frame-timing words to inspect the programmed video period. VBlank interrupts
provide frame synchronization; these readouts provide measurements. Diagnostic
output appends codepoints through PRINT_CHAR and submits a complete line
through PRINT_FLUSH.

Supervisor service preserves selected cartridge device state while BIOS uses
its own IRQ, DMA and GPU context. It is coordinated with CPU exception entry,
but device-context restoration and CPU exception return remain separate steps:
LEAVE restores the devices, while RFE returns the CPU. Firmware follows both
protocols before cartridge execution resumes.

USER, ENTRY_VECTOR and ACTIVE name stages in this description, not additional
register fields. STATUS exposes only the flags listed below.

Use aligned 32-bit accesses to the registers below. `CONTROL` is a command port, not a retained command mask. Each accepted write is processed and its readable word returns to zero, including writes containing ignored bits. `STATUS` reports the current supervisor-context flags.

### SYSTEM specifications

| Resource | Specification |
|---|---|
| Register interface | Thirteen 32-bit word ports at the noncontiguous addresses listed in this chapter; four-byte words |
| Addressed register bytes | 52 bytes in total, not one contiguous reservation or payload RAM |
| Supervisor fault report | Six raw words, 24 bytes including its publication sequence |
| Diagnostic output queue | 8192 bytes, shared by completed unread text and the current partial line |

## Measure elapsed console time

This polling example needs no interrupt source: TIME_MS advances with system
cycles, not with timer interrupts. It leaves the inherited display and
interrupt configuration unchanged. The interval must be shorter than one
complete 2^32-millisecond wrap.

```lua
local time_ms<const>: *word = 0x08010228
local start<const> = *time_ms
while ((*time_ms - start) % 0x100000000) < 100 do
end
local finish<const> = *time_ms
local elapsed<const> = (finish - start) % 0x100000000
```

`elapsed` is at least 100 milliseconds, not necessarily exactly 100.
For `start = fffffff0H` and `finish = 00000054H`, the wrapping distance is
100 milliseconds. BIOS `os.clock()` instead expresses a fresh TIME_MS read
in seconds; `os.time()` without arguments returns whole seconds. Neither
supplies a civil clock. A HALT-based wait additionally needs an owned interrupt
route and must recheck its time predicate after each wake-up; advancing
TIME_MS alone cannot wake HALT.

## Control register reference

| Register | Address | Access | Reset value |
|---|---|---|---|
| `CONTROL` | `0x0801034c` | Command write; reads return `0` | `0x00000000` |
| `STATUS` | `0x08010350` | Read-only | `0x00000000` |

<section class="register-entry">

### CONTROL

Each set command bit is considered independently. One write is processed in the order **RESET, ENTER, FAULT, FAULT_PUBLISH, LEAVE**; this is not a choice of one winning command. Later operations see state changes made by earlier operations in the same write. RESET is considered in either CPU mode. The other four operations are considered only when the CPU's **current** user-mode bit is clear; in user mode those bits are ignored, not converted into a supervisor request. Bits 5–31 have no effect.

| Bits | Mask | Operation | Effect |
|---|---|---|---|
| 0 | `0x00000001` | `RESET` | Latch a system-reset request and request a CPU yield. The write itself does not perform the reboot. |
| 1 | `0x00000002` | `SUPERVISOR_ENTER` (`ENTER`) | Activate the supervisor device context **only at ENTRY_VECTOR**. It has no effect in any other stage and does not initiate entry from USER. |
| 3 | `0x00000008` | `SUPERVISOR_FAULT` (`FAULT`) | Capture the CPU fault words. In ACTIVE, make no further transition. Otherwise select the fault transition, clear resumability, cancel any pending NMI request and request a yield; only USER starts a new entry-quiescence sequence. |
| 4 | `0x00000010` | `SUPERVISOR_FAULT_PUBLISH` (`FAULT_PUBLISH`) | Increment the retained fault sequence modulo `2^32`. Do not capture or clear the payload, change supervisor flags or enter an exception. |
| 2 | `0x00000004` | `SUPERVISOR_LEAVE` (`LEAVE`) | Begin return to the user device context only in ACTIVE with `RESUMABLE` set. Clear `EXIT_REQUESTED` and request a yield. Otherwise do nothing. |
| `31:5` | `0xffffffe0` | Unused | Ignored. |

</section>

For example, `FAULT | FAULT_PUBLISH` captures the payload before advancing its publication sequence. `ENTER | FAULT` first attempts activation; if that succeeds, FAULT takes its ACTIVE behavior. Reading zero from `CONTROL` says neither that a requested reboot has completed nor that a supervisor transition has finished.

<section class="register-entry">

### STATUS

| Bits | Mask | Flag | Meaning when set |
|---|---|---|---|
| 0 | `0x00000001` | `SUPERVISOR_ACTIVE` | SYSTEM is not in USER. This includes entry quiescence, ENTRY_VECTOR, ACTIVE and exit quiescence. |
| 1 | `0x00000002` | `EXIT_REQUESTED` | A supervisor-request edge has requested exit from an ACTIVE, resumable context. The flag does not itself execute LEAVE. |
| 2 | `0x00000004` | `RESUMABLE` | The supervisor-context resumability latch is set. LEAVE also requires the ACTIVE stage. |
| `31:3` | `0xfffffff8` | Unused | Always zero. |

</section>

These flags are independent. Entry can set `SUPERVISOR_ACTIVE` before `RESUMABLE`; an admitted LEAVE keeps both set while restoration is in progress, then clears them when USER is restored. `SUPERVISOR_ACTIVE` does not identify CPU privilege, and `RESUMABLE` does not certify that an exception has been repaired or that CPU exception return has already occurred.

## Privilege and supervisor entry

SYSTEM supervisor commands require current CPU supervisor mode. Normal
cartridge entry runs in user mode; exception entry clears the current user-mode
bit before its handler executes. Thus a cartridge IRQ handler can perform
privileged operations even though the interrupted cartridge code could not.
CP0 access in user mode raises coprocessor-unusable. Ordinary function calls
retain the caller's CPU mode.

Normal monitor entry begins with a rising edge on the supervisor-request wire.
INPUT samples that wire at every VBlank, independently of its ARM capture
request. In USER, an edge starts the entry sequence. In ACTIVE with RESUMABLE
set, an edge sets EXIT_REQUESTED so firmware can leave the monitor. Other stages
ignore the edge. The wire must return low before a later rising edge can be
recognized.

SUPERVISOR_ACTIVE becomes visible during entry quiescence. Once the device
boundary is reached, SYSTEM enters ENTRY_VECTOR and requests NMI. The CPU
accepts NMI through its normal interrupt boundary and enters the system
exception function. Firmware then writes ENTER to activate the supervisor
device context. ENTER is accepted only at ENTRY_VECTOR; initiating entry uses
the request wire. The public cartridge BIOS imports provide no callable request
for this wire.

A synchronous fault takes a different route. The CPU enters the system exception function, and the firmware writes FAULT to capture its diagnostics. If this starts from USER, SYSTEM quiesces the devices and then activates the supervisor context directly, without issuing another NMI. A FAULT received during another non-ACTIVE stage redirects the target without restarting that stage; in ACTIVE it only captures the report. Activation sets `RESUMABLE` even on the fault route. The detailed device banks and quiescence rules are separate from these CPU-entry and command edges.

## Device boundaries during supervisor service

Entry waits for accepted producer work, then the admitted DMA block, then the
GPU boundary. This ordering lets data already in flight reach its proper
stopping point before the register contexts are exchanged. Transition time
depends on that work. Main RAM, VRAM and APU sample RAM remain shared storage.

| Entry boundary | Condition before proceeding | Cartridge consequence |
|---|---|---|
| Producer boundary | GEO is no longer BUSY; IMGDEC has no scheduled decode batch | GEO may complete normally or report its normal error. IMGDEC need not finish the stream or empty its FIFOs. |
| DMA boundary | No admitted block and no DMA service in progress | An already admitted block completes; a longer BUSY transfer can retain a nonzero remaining count. No next block is admitted during this stage. |
| GPU boundary | Ingress has stopped, no command completion is pending, readback is idle or its unread result is complete, and no commands remain queued for rendering | The completed unread result and words waiting behind it can be retained. An unfinished readback must complete before this boundary; the fence does not consume pixels. |

At entry's first stage, new GEO CMD, DMA TRIGGER and GPU GP1 writes are held.
IMGDEC lowers both DMA requests and stops after its scheduled decode batch.
Shared RAM and other device words remain accessible under their normal rules.
The ordinary request path allows CPU execution during producer quiescence;
software observing SUPERVISOR_ACTIVE can therefore still be running before NMI.

<section class="keep-together">

After these boundaries, the ordinary request path can take the NMI and complete
ENTER. IRQ state is banked before the supervisor GPU context is initialized.
The following preservation rules apply to that activated context:

| Unit | Retained or held state | Limit |
|---|---|---|
| IRQ | Cartridge FLAGS and MASK are retained; supervisor FLAGS and MASK start at zero. Leave restores the retained cartridge words. | Supervisor pending bits are not merged into the restored cartridge word. A request explicitly directed to the retained cartridge bank can accumulate there. |
| DMA | Channel register words and the next-channel arbitration position are retained. Supervisor channels start clear. Leave restores the cartridge channels and resumes arbitration. | Payload RAM is not copied. Quiescing one admitted block is not completion of the entire transfer. |
| GPU | Cartridge drawing/display registers, both ingress FIFOs, partial packet/image-load/polyline assembly, and unread readback bytes, descriptor, cursor and GPUREAD latch are retained and restored. Supervisor starts with empty ingress and readback state. | Parked cartridge readback does not drive the supervisor DMA request. VRAM remains shared; restoring the cartridge bank does not undo supervisor writes to framebuffer or texture bytes. |
| PCRTC | Programmed and presented composition words are retained separately. | Beam timing words and beam phase are not part of this composition bank. |
| GEO | The current job reaches a terminal phase; new CMD admission remains held until leave. | There is no separate supervisor GEO job/register bank. Its ordinary result and fault words remain meaningful. |
| IMGDEC | Stream state remains in place at a scheduled-batch boundary and can resume on leave. | Quiescence is not stream DONE, and there is no separate supervisor decoder bank. |
| APU | The voice clock is held after synchronization to the entry cycle; queued output samples are discarded. | Voice state is not reset or separately banked. Already scheduled sample-transfer work can still complete. |
| INPUT | One shared register file, pending ARM request and sample sequence remain in use, including the BIOS monitor's captures. | There is no cartridge INPUT bank to restore on leave. Obtain a new sample on resumption; see [BIOS handoff and supervisor sampling](input.md#bios-handoff-and-supervisor-sampling). |

</section>

While the APU voice clock is held, voice playback position stays at the synchronized
entry point. Leave reanchors voice timing and resumes playback from that
position. The separate sample-transfer engine can finish accepted FIFO/RAM
batches during the hold.

Supervisor PCRTC composition initially routes the cartridge's **presented**
circuit-1 source and display words into circuit 2, copies its presented background
color, and maps its circuit-1 enable into circuit-2 enable. This reuses source
addresses; it does not copy framebuffer pixels. The firmware can then prepare
its own display. Respect the firmware surface and system-texture reservation
explained under **Memory and program storage**; a retained cartridge GPU context
does not grant ownership of those VRAM bytes.

LEAVE crosses the DMA and GPU boundaries for the supervisor's work before
restoring the cartridge contexts. Supervisor ingress and its own completed unread
readback are transient scratch discarded by this explicit context teardown;
cartridge readback resumes at its retained cursor, with its DMA request derived
from the restored direction and readiness. This is not an implicit read or
cancellation of the cartridge transfer. LEAVE releases GEO/IMGDEC admission and the APU
voice hold, and restores the cartridge IRQ bank. That device restoration is
separate from the CPU's exception return. Neither LEAVE nor a restored register
bank repairs the faulting cartridge instruction or grants safe reuse of shared
memory by another owner.

<section class="register-entry">

## Supervisor fault registers

The supervisor fault bank contains six raw 32-bit words. All are read-only to cartridge MMIO writes and reset to zero.
The register names in the next table have the prefix `SUPERVISOR_FAULT_`;
all 32 bits of each word are retained.

| Register | Address | Access | Reset value | Recorded value |
|---|---|---|---|---|
| `SEQUENCE` | `0x08010428` | Read-only | `0x00000000` | Publication sequence, incremented by FAULT_PUBLISH modulo `2^32`. |
| `CAUSE` | `0x0801042c` | Read-only | `0x00000000` | CPU Cause word at FAULT capture. |
| `EPC` | `0x08010430` | Read-only | `0x00000000` | CPU EPC word at FAULT capture. |
| `BAD_ADDRESS` | `0x08010434` | Read-only | `0x00000000` | Retained CPU BadAddress word at FAULT capture. |
| `LUA_REASON` | `0x08010438` | Read-only | `0x00000000` | Retained CPU LuaReason word at FAULT capture; not the Lua error value. |
| `DOMAIN` | `0x0801043c` | Read-only | `0x00000000` | Interrupted execution-image domain: cartridge `0` or `1`, or system `0xffffffff`. This is not CPU privilege or SYSTEM stage. |

</section>

FAULT copies the five CPU payload words. FAULT_PUBLISH advances SEQUENCE
modulo 2^32 and leaves that payload unchanged. Software can capture first and
publish later; a new sequence identifies publication rather than the instant
of CPU exception entry. Zero is a valid sequence after reset and after wrap.

The firmware's synchronous-fault path publishes after preparing the monitor display and waiting another VBlank. Publication is therefore later than CPU fault admission. An NMI entry alone does not refresh this bank: the words change through FAULT capture, not by following the CPU diagnostic registers continuously.

Interpret the payload using Cause. Synchronous entry records the faulting
instruction's EPC; asynchronous entry records the interrupted PC. A subsequent
firmware EPC write is included in a later FAULT capture. Address exceptions
update BadAddress, while data-bus errors leave its previous value. Lua traps
update LuaReason; unrelated exceptions retain that word. These retained fields
must be read with the recorded cause.

<section class="keep-together">

The raw Cause word uses the following values. The exception-code mask is
`0x0000007c`; IRQ and NMI indications are listed separately.

| Value | Meaning |
|---|---|
| `0x00000400` | Maskable IRQ indication |
| `0x00010000` | NMI indication |
| `0x00000010` | Address-error load |
| `0x00000014` | Address-error store |
| `0x00000018` | Instruction-bus error |
| `0x0000001c` | Data-bus error |
| `0x00000028` | Reserved instruction |
| `0x0000002c` | Coprocessor unusable |
| `0x00000034` | Trap |

</section>

| LuaReason | Meaning |
|---|---|
| 0 | UNKNOWN |
| 1 | CALL_NON_FUNCTION |
| 2 | INDEX_NON_TABLE |
| 3 | ASSIGN_NON_TABLE |
| 4 | INDEX_NIL |
| 5 | METATABLE_LOOP |
| 6 | ITERATE_NON_TABLE |
| 7 | XPCALL_HANDLER_NOT_FUNCTION |
| 8 | EXPLICIT_ERROR |
| 9 | OUT_OF_MEMORY |
| 10 | INVALID_ARGUMENT |

Interpret LuaReason with Cause rather than treating every retained reason as a
new Lua failure.

## Faults, interrupts and continuation

The SYSTEM NMI is distinct from a maskable IRQ. A pending NMI takes precedence and is not gated by CPU interrupt-enable or the IRQ mask; it enters the system exception function. Maskable interrupt acceptance and source acknowledgement follow the **IRQ** chapter. Neither the request edge nor these priority rules establishes a fixed request-to-vector latency.

The shared access and fault contract is described in **Memory and program
storage**. An ordinary typed load or store checks its scalar alignment first:
a misaligned word or halfword takes the CPU address-error path before MMIO is
accessed. For the aligned SYSTEM ports here, a word write to STATUS or any
supervisor-fault word raises `READ_ONLY` (`3`) without changing the word.
Halfword reads and byte or halfword writes that reach these ports raise
`UNALIGNED_IO` (`2`). A byte read at a word-aligned port address instead performs
the normal read and returns its low eight bits; a byte read at another byte of
that port raises `UNALIGNED_IO`. A newly raised mapped bus fault takes the CPU
data-bus-error path, not a successful load of a zero result. Consult the memory
fault record rather than assuming supervisor BadAddress holds that MMIO address.

Lua failures that are handled by protected-call or coroutine error handling do not necessarily reach the system exception path. An unhandled Lua failure enters a trap exception and supplies its Lua reason. This does not imply that protected Lua calls catch hardware address, MMIO or privilege exceptions.

Continuing the monitor is a retry, not a repair. For an invocation that owns the supervisor context, the firmware restores its saved EPC and CPU status and issues LEAVE before returning. CPU exception return is separate from device-context restoration and does not automatically advance a synchronous-fault EPC. The `CONT` command can therefore retry the same failing instruction and fault again; `RESUMABLE` does not promise successful program recovery.

## Reset requests

RESET is available in either CPU mode. It latches one pending request and asks the CPU to yield; repeated RESET writes coalesce until the request is consumed. CONTROL still reads zero, and STATUS has no reset-pending flag. Reading either word neither consumes the request nor proves that reboot has occurred. Other admitted command bits in the same write are still processed in the defined order.

A pending request is serviced at a CPU execution boundary. Servicing it performs a system reboot: it clears I/O and bus faults, resets hardware and CPU execution state, and starts firmware again. There is no fixed request-to-reboot cycle latency. This is not a local device reset or a bus-fault acknowledgement, and it is not a promise that all RAM or every device buffer is zeroed.

At SYSTEM reset, CONTROL, STATUS and all six fault words are zero; no supervisor transition, exit request or resumable context remains. These are the reset values of this unit, not a substitute for the reset and acknowledgement rules of other devices. Automatic zero readback after a CONTROL write is command-port behavior, not an acknowledgement of a bus fault or completion of a machine reboot.

## System time and frame timing

The installed system-cycle frequency is 33,868,800 Hz. `TIME_MS` reports elapsed system-cycle time in whole milliseconds: fractional milliseconds are discarded, and the result wraps modulo 2^32. Consecutive reads can therefore return the same word. This is console time, not a civil date or a wall clock.

| Address | Register | Access | Word interpretation | Reset/state value |
|---|---|---|---|---|
| `0x08010228` | `TIME_MS` | R | Bits 31–0: unsigned whole milliseconds, modulo 2^32 | `0x00000000` after hardware time reset |
| `0x0801022c` | `FRAME_MS_Q16` | R | Bits 31–0: unsigned Q16 milliseconds; bits 15–0 are fractional | `0x00141893` at installed hardware reset; zero while stopped |
| `0x08010238` | `CYCLES_PER_FRAME` | R | Bits 31–0: unsigned system-cycle budget for a VBlank period | `0x000a62b4` at installed hardware reset; zero while stopped |

These reset-state readouts apply before firmware advances execution. They are
not fixed future budgets or values promised at cartridge entry. The two frame
words are derived from the programmed beam and its fractional phase, not separate
constant registers.

Use aligned word reads for these registers. Writes are read-only-access faults. The reads are independent samples, not an atomic snapshot of all three quantities.

`FRAME_MS_Q16` describes the currently programmed beam period. Divide its unsigned word by `0x00010000` to express the reported value in milliseconds. The refresh value used to form this report is first truncated to whole millionths of a hertz; the Q16 period is then truncated and reduced to its low 32 bits. The full period is maintained separately, rather than recovered from this register. A sufficiently long period can therefore wrap the reported word without shortening the complete period.

`CYCLES_PER_FRAME` is a whole-period budget, not the number of cycles remaining until the next VBlank. Fractional beam timing can make successive budgets differ by one cycle. Reprogramming a beam-timing word with different bits immediately changes operational timing and restarts the beam; writing identical bits does not. These SYSTEM words describe programmed timing, not confirmation that a new image has been presented. When beam timing is stopped, both frame-timing words are zero; `TIME_MS` is not stopped with them.

### Software timing

For two raw `TIME_MS` samples, compute elapsed milliseconds modulo 2^32.
In BLua, use `(current - start) % 0x100000000` for the nonnegative wrapping
distance. A bitwise `& 0xffffffff` instead returns a signed 32-bit result and
cannot represent distances from `80000000H` through `ffffffffH` as nonnegative
Numbers. The modulo result measures the interval only
when the actual elapsed time is shorter than one complete 2^32-millisecond
period. A zero result is valid when both samples fall in the same millisecond.
`os.difftime` is ordinary subtraction, not wrapping hardware-time arithmetic.

The BIOS `os.clock()` returns `TIME_MS / 1000`, in seconds with millisecond resolution. The no-argument `os.time()` returns `TIME_MS // 1000`, in whole seconds. Both inherit the hardware word's wrap and neither measures time spent exclusively executing cartridge instructions. `os.time(date_table)` instead calculates a civil timestamp from the supplied fields; it does not set the console clock. These functions do not establish a wall-clock or real-time-clock service.

## Diagnostic text output

| Address | Register | Access | Word interpretation | Reset |
|---|---|---|---|---|
| `0x08010230` | `PRINT_CHAR` | R/W | Bits 31–0: Unicode codepoint to append; reads return the full last written word | `0x00000000` |
| `0x08010234` | `PRINT_FLUSH` | R/W | All written values request line publication; reads return the full last written word | `0x00000000` |

Use aligned word writes. `PRINT_CHAR` accepts a Unicode codepoint, not a memory address, string reference, packed group of characters, or UTF-8 byte. Values `0x00000000`–`0x0000007f` encode as one UTF-8 byte, `0x00000080`–`0x000007ff` as two, `0x00000800`–`0x0000ffff` as three except for surrogates, and `0x00010000`–`0x0010ffff` as four. Surrogate words `0x0000d800`–`0x0000dfff` and words above `0x0010ffff` append the single byte `0x3f` (`?`). Readback still returns the original word, including an invalid codepoint word.

PRINT_CHAR extends the current partial line, including when its codepoint is
line feed. Every PRINT_FLUSH write appends an ASCII line-feed byte and submits
the partial line when space permits; zero and nonzero write values have the
same action. Submitted text is available on the diagnostic channel. Screen text
uses the separate BIOS console drawing path described below.

Completed unread lines and the current partial line share one 8192-byte queue. Each character needs space for its complete one- to four-byte UTF-8 encoding. If a character cannot fit, the current partial line is discarded, completed unread lines are preserved, and further character writes are ignored until the next flush. That flush publishes nothing and clears the overflow condition. If the flush itself first encounters insufficient space for its added line-feed byte, it likewise discards the partial line, publishes nothing, and leaves overflow cleared. In particular, 8192 unflushed ASCII characters leave no room for the flush's line feed, so that entire partial line is lost. No readiness, free-space, or accepted-line counter is available through these ports. Reset empties the queue and clears both register words.

### BIOS console integration

BIOS `print(...)` converts each argument with `tostring`, separates arguments with tabs, writes to the BIOS console, and ends the line. Console writes send the full codepoints to `PRINT_CHAR` and also append to a separate 8192-byte BIOS history; codepoints above `0xff` become `?` in that history. Ending the line appends a history line feed and writes `PRINT_FLUSH = 1`. Thus `print` sends text to both diagnostic output and BIOS history, but does not itself flush the console display.

Direct writes to `PRINT_CHAR` and `PRINT_FLUSH` do not add BIOS-history entries or draw glyphs. The BIOS console display is updated separately from its retained history. Diagnostic publication, retained console text, and visible console drawing are distinct events.

## Send a diagnostic line

Assume no other diagnostic writer and enough queue space for the line. These
writes send four codepoints, then publish the line. A zero FLUSH word is still
a flush command.

```lua
local print_char<const>: *word = 0x08010230
local print_flush<const>: *word = 0x08010234

print('SYSTEM timer experiment')
*print_char = 0x00000053
*print_char = 0x000000e9
*print_char = 0x0001f600
*print_char = 0xffffffff
local char_readback<const> = *print_char
*print_flush = 0
local flush_readback<const> = *print_flush
print('SYSTEM samples complete')
```

CHAR readback is `ffffffffH`, even though the invalid codepoint emits `?`.
FLUSH readback is zero. Both are last-written words, not receiver-ready or
completion flags. The raw middle line is encoded as:

```text
53 C3 A9 F0 9F 98 80 3F 0A
```

The diagnostic text is:

```text
SYSTEM timer experiment
Sé😀?
SYSTEM samples complete
```

Only the two BIOS `print` calls also add text to the BIOS console history.
The direct codepoint line neither enters that history nor draws glyphs.

![BIOS console after the timer experiment](figures/system-console.png)

The monitor displays the two BIOS print lines from retained console history.
The raw diagnostic line does not appear in that history.
