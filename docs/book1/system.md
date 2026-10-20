# System control and timing {#sec-system}

The system controller maintains console-time readouts, accepts reset requests
and coordinates BIOS supervisor service. Its fault-report words retain CPU
diagnostics for the monitor. A separate pair of ports provides line-oriented
diagnostic text output.

Cartridge programs normally use TIME_MS to measure elapsed time and the two
frame-timing words to inspect the programmed video period. VBlank interrupts
provide frame synchronization; these readouts provide measurements. Diagnostic
output appends codepoints through PRINT_CHAR and submits a complete line
through PRINT_FLUSH.

Supervisor service lets the BIOS use the interrupt controller, DMA and graphics
hardware while retaining the cartridge's device context. The context preserves
registers and pending work; main RAM and VRAM remain shared storage. This
distinction matters when a cartridge resumes: restoring a drawing configuration
does not restore pixels overwritten while the BIOS was using the GPU.

## SYSTEM specifications {#sec-system-system-specifications}

| Resource | Specification |
|---|---|
| Register interface | Thirteen 32-bit word ports at the noncontiguous addresses listed in this chapter; four-byte words |
| Addressed register bytes | 52 bytes in total, not one contiguous reservation or payload RAM |
| Supervisor fault report | Six raw words, 24 bytes including its publication sequence |
| Diagnostic output queue | 8192 bytes, shared by completed unread text and the current partial line |

## Measure elapsed console time {#sec-system-measure-elapsed-console-time}

To measure an interval, read TIME_MS at its beginning and again at its end.
Each count represents one whole millisecond of console time. The difference
measures the interval, including time during which other work was performed;
it is not a count of instructions executed by the calling routine. The counter
wraps after `FFFFFFFFH`, so calculate the difference modulo `2^32` rather than
comparing the two raw counter values as an ever-increasing clock.

TIME_MS advances with system cycles, so this polling example needs no interrupt
source or changes to the display configuration. The measured interval must be
shorter than one complete 2^32-millisecond wrap.

```lua
local time_ms<const>: *word = 0x08010228
local start<const> = *time_ms
while ((*time_ms - start) % 0x100000000) < 100 do
end
local finish<const> = *time_ms
local elapsed<const> = (finish - start) % 0x100000000
```

`elapsed` is at least 100 milliseconds, not necessarily exactly 100.
For `start = FFFFFFF0H` and `finish = 00000054H`, the wrapping distance is
100 milliseconds. A HALT-based wait additionally needs an enabled interrupt
route and must recheck its time predicate after each wake-up; advancing
TIME_MS alone cannot wake HALT. BIOS time functions and their units are described
in [[Book II, BIOS time and calendar services](bios-os.md#sec-bios-os)]{.content-visible when-format="html"}[Book II, Chapter 9]{.content-visible when-format="pdf"}.

## System time and frame timing {#sec-system-system-time-and-frame-timing}

The installed system-cycle frequency is 33,868,800 Hz. `TIME_MS` reports elapsed system-cycle time in whole milliseconds: fractional milliseconds are discarded, and the result wraps modulo 2^32. Consecutive reads can therefore return the same word. This is console time, not a civil date or a wall clock.

| Address | Register | Access | Word interpretation | Reset/state value |
|---|---|---|---|---|
| `08010228H` | `TIME_MS` | R | Bits 31–0: unsigned whole milliseconds, modulo 2^32 | `00000000H` after hardware time reset |
| `0801022CH` | `FRAME_MS_Q16` | R | Bits 31–0: unsigned Q16 milliseconds; bits 15–0 are fractional | `00141893H` at installed hardware reset; zero while stopped |
| `08010238H` | `CYCLES_PER_FRAME` | R | Bits 31–0: unsigned system-cycle count for a VBlank period | `000A62B4H` at installed hardware reset; zero while stopped |

These reset-state readouts apply before firmware advances execution. They are
not constants guaranteed at cartridge entry. The two frame words are derived
from the programmed beam and its fractional phase, not separate constant
registers.

Use aligned word reads for these registers. Writes are read-only-access faults. The reads are independent samples, not an atomic snapshot of all three quantities.

`FRAME_MS_Q16` describes the currently programmed beam period. Divide its unsigned word by `00010000H` to express the reported value in milliseconds. The refresh value used to form this report is first truncated to whole millionths of a hertz; the Q16 period is then truncated and reduced to its low 32 bits. A sufficiently long period can therefore wrap the reported word without shortening the programmed beam period.

`CYCLES_PER_FRAME` is a whole-period cycle count, not the number of cycles remaining until the next VBlank. Fractional beam timing can make successive counts differ by one cycle. Reprogramming a beam-timing word with different bits immediately changes operational timing and restarts the beam; writing identical bits does not. These SYSTEM words describe programmed timing, not confirmation that a new image has been presented. When beam timing is stopped, both frame-timing words are zero; `TIME_MS` is not stopped with them.

### Software timing {#sec-system-software-timing}

For two raw `TIME_MS` samples, compute elapsed milliseconds modulo 2^32.
In BLua, use `(current - start) % 0x100000000` for the nonnegative wrapping
distance. A bitwise `& 0xffffffff` instead returns a signed 32-bit result and
cannot represent distances from `80000000H` through `FFFFFFFFH` as nonnegative
Numbers. The modulo result measures the interval only
when the actual elapsed time is shorter than one complete 2^32-millisecond
period. A zero result is valid when both samples fall in the same millisecond.
`os.difftime` is ordinary subtraction, not wrapping hardware-time arithmetic.

## Diagnostic text output {#sec-system-diagnostic-text-output}

The diagnostic channel publishes lines assembled from codepoints. Write each
codepoint to PRINT_CHAR, then write PRINT_FLUSH to end and submit the line.
Appending text and publishing it are separate operations. This channel carries
diagnostic text, independently of GPU drawing. BIOS console output is described
in [[Book II, BIOS base services — Console history and display](bios-base.md#sec-system-bios-console-integration)]{.content-visible when-format="html"}[Book II, §5.4.6, “Console history and display”]{.content-visible when-format="pdf"}.

| Address | Register | Access | Word interpretation | Reset |
|---|---|---|---|---|
| `08010230H` | `PRINT_CHAR` | R/W | Bits 31–0: Unicode codepoint to append; reads return the full last written word | `00000000H` |
| `08010234H` | `PRINT_FLUSH` | R/W | All written values request line publication; reads return the full last written word | `00000000H` |

Use aligned word writes, supplying one Unicode codepoint per PRINT_CHAR word.
The channel encodes that codepoint as UTF-8: values
`00000000H`–`0000007FH` use one byte, `00000080H`–`000007FFH` use two,
`00000800H`–`0000FFFFH` use three except for surrogates, and
`00010000H`–`0010FFFFH` use four. Surrogate words
`0000D800H`–`0000DFFFH` and words above `0010FFFFH` append the single byte
`3FH` (`?`). Readback retains the original word, including an invalid codepoint.

PRINT_CHAR extends the current partial line, including when its codepoint is
line feed. Every PRINT_FLUSH write appends an ASCII line-feed byte and submits
the partial line when space permits; zero and nonzero write values have the
same action. Submitted text is available on the diagnostic channel.

For example, write the following codepoints in order, then write zero to
PRINT_FLUSH:

| PRINT_CHAR word | Character | Encoded bytes |
|---|---|---|
| `00000053H` | S | `53H` |
| `000000E9H` | é | `C3H A9H` |
| `0001F600H` | 😀 | `F0H 9FH 98H 80H` |
| `FFFFFFFFH` | Replacement `?` | `3FH` |

The flush appends byte `0AH` and submits the nine-byte line. CHAR still reads
`FFFFFFFFH` and FLUSH reads zero: readback retains the written words, not
transmission status. A BLua sequence comparing this channel with BIOS console
output appears in [[Book II, BIOS diagnostics — Diagnostic text and the BIOS console](bios-monitor.md#sec-system-send-a-diagnostic-line)]{.content-visible when-format="html"}[Book II, §7.1]{.content-visible when-format="pdf"}.

Completed unread lines and the current partial line share one 8192-byte queue. Each character needs space for its complete one- to four-byte UTF-8 encoding. If a character cannot fit, the current partial line is discarded, completed unread lines are preserved, and further character writes are ignored until the next flush. That flush publishes nothing and clears the overflow condition. If the flush itself first encounters insufficient space for its added line-feed byte, it likewise discards the partial line, publishes nothing, and leaves overflow cleared. In particular, 8192 unflushed ASCII characters leave no room for the flush's line feed, so that entire partial line is lost. No readiness, free-space, or accepted-line counter is available through these ports. Reset empties the queue and clears both register words.

## Privilege and supervisor entry {#sec-system-privilege-and-supervisor-entry}

Supervisor service preserves selected cartridge device state while BIOS uses
its own IRQ, DMA and GPU context. It is coordinated with CPU exception entry,
but device-context restoration and CPU exception return remain separate steps:
LEAVE restores the devices, while RFE returns the CPU. Firmware follows both
protocols before cartridge execution resumes.

USER, ENTRY_VECTOR and ACTIVE name stages in this description, not additional
register fields. STATUS exposes only the flags listed below.

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

## Control register reference {#sec-system-control-register-reference}

Use aligned 32-bit accesses to the registers below. `CONTROL` is a command port, not a retained command mask. Each accepted write is processed and its readable word returns to zero, including writes containing ignored bits. `STATUS` reports the current supervisor-context flags.

| Register | Address | Access | Reset value |
|---|---|---|---|
| `CONTROL` | `0801034CH` | Command write; reads return `0` | `00000000H` |
| `STATUS` | `08010350H` | Read-only | `00000000H` |

### CONTROL {#sec-system-control}

Each set command bit is considered independently. One write is processed in the order **RESET, ENTER, FAULT, FAULT_PUBLISH, LEAVE**; this is not a choice of one winning command. Later operations see state changes made by earlier operations in the same write. RESET is considered in either CPU mode. The other four operations are considered only when the CPU's **current** user-mode bit is clear; in user mode those bits are ignored, not converted into a supervisor request. Bits 5–31 have no effect.

| Bits | Mask | Operation | Effect |
|---|---|---|---|
| 0 | `00000001H` | `RESET` | Latch a system-reset request for service at a CPU execution boundary. The write itself does not perform the reboot. |
| 1 | `00000002H` | `SUPERVISOR_ENTER` (`ENTER`) | Activate the supervisor device context **only at ENTRY_VECTOR**. It has no effect in any other stage and does not initiate entry from USER. |
| 3 | `00000008H` | `SUPERVISOR_FAULT` (`FAULT`) | Capture the CPU fault words. In ACTIVE, make no further transition. Otherwise select the fault transition, clear resumability, cancel any pending NMI request and request transition processing at a CPU execution boundary; only USER starts a new entry-quiescence sequence. |
| 4 | `00000010H` | `SUPERVISOR_FAULT_PUBLISH` (`FAULT_PUBLISH`) | Increment the retained fault sequence modulo `2^32`. Leave the payload and supervisor flags unchanged; no exception is entered. |
| 2 | `00000004H` | `SUPERVISOR_LEAVE` (`LEAVE`) | Begin return to the user device context only in ACTIVE with `RESUMABLE` set. Clear `EXIT_REQUESTED` and suspend CPU execution for the transition. Otherwise do nothing. |
| `31:5` | `FFFFFFE0H` | Unused | Ignored. |

: {tbl-colwidths="[6,14,29,51]"}

For example, `FAULT | FAULT_PUBLISH` captures the payload before advancing its publication sequence. `ENTER | FAULT` first attempts activation; if that succeeds, FAULT takes its ACTIVE behavior. Reading zero from `CONTROL` says neither that a requested reboot has completed nor that a supervisor transition has finished.

### STATUS {#sec-system-status}

| Bits | Mask | Flag | Meaning when set |
|---|---|---|---|
| 0 | `00000001H` | `SUPERVISOR_ACTIVE` | SYSTEM is not in USER. This includes entry quiescence, ENTRY_VECTOR, ACTIVE and exit quiescence. |
| 1 | `00000002H` | `EXIT_REQUESTED` | A supervisor-request edge has requested exit from an ACTIVE, resumable context. The flag does not itself execute LEAVE. |
| 2 | `00000004H` | `RESUMABLE` | The supervisor-context resumability latch is set. LEAVE also requires the ACTIVE stage. |
| `31:3` | `FFFFFFF8H` | Unused | Always zero. |

These flags are independent. Entry can set `SUPERVISOR_ACTIVE` before `RESUMABLE`; an admitted LEAVE keeps both set while restoration is in progress, then clears them when USER is restored. `SUPERVISOR_ACTIVE` does not identify CPU privilege, and `RESUMABLE` does not certify that an exception has been repaired or that CPU exception return has already occurred.

## Device boundaries during supervisor service {#sec-system-device-boundaries-during-supervisor-service}

Entry waits for accepted producer work, then the admitted DMA block, then the
GPU boundary. This ordering lets data already in flight reach its proper
stopping point before the register contexts are exchanged. Transition time
depends on that work. Main RAM, VRAM and APU sample RAM remain shared storage.

| Entry boundary | Condition before proceeding | Cartridge consequence |
|---|---|---|
| Producer boundary | GEO is no longer BUSY; IMGDEC decoding is paused | GEO may complete normally or report its normal error. IMGDEC need not finish the stream or empty its FIFOs. |
| DMA boundary | No block remains in progress | An already admitted block completes; a longer BUSY transfer can retain a nonzero remaining count. No next block is admitted during this stage. |
| GPU boundary | Ingress has stopped, no command completion is pending, readback is idle or its unread result is complete, and no commands remain queued for rendering | The completed unread result and words waiting behind it can be retained. An unfinished readback must complete before this boundary; the fence does not consume pixels. |

At entry's first stage, new GEO CMD, DMA TRIGGER and GPU GP1 writes are held.
IMGDEC lowers both DMA requests and pauses after decoding already in progress.
Shared RAM and other device words remain accessible under their normal rules.
The ordinary request path allows CPU execution during producer quiescence;
software observing SUPERVISOR_ACTIVE can therefore still be running before NMI.

After these boundaries, the ordinary request path can take the NMI and complete
ENTER. IRQ state is banked before the supervisor GPU context is initialized.
The following preservation rules apply to that activated context:

| Unit | Retained or held state | Limit |
|---|---|---|
| IRQ | Cartridge FLAGS and MASK are retained; supervisor FLAGS and MASK start at zero. Leave restores the retained cartridge words. | Supervisor pending bits are not merged into the restored cartridge word. A request explicitly directed to the retained cartridge bank can accumulate there. |
| DMA | Channel register words and the next-channel arbitration position are retained. Supervisor channels start clear. Leave restores the cartridge channels and resumes arbitration. | Payload RAM is not copied. Quiescing one admitted block is not completion of the entire transfer. |
| GPU | Cartridge drawing/display registers, both ingress FIFOs, partial packet/image-load/polyline assembly, unread readback pixels and read position, and the GPUREAD latch are retained and restored. Supervisor starts with empty ingress and readback state. | Retained cartridge readback does not drive the supervisor DMA request. VRAM remains shared; restoring the cartridge bank does not undo supervisor writes to framebuffer or texture bytes. |
| PCRTC | Programmed and presented composition words are retained separately. | Beam timing words and beam phase are not part of this composition bank. |
| GEO | The current job reaches a terminal phase; new CMD admission remains held until leave. | There is no separate supervisor GEO job/register bank. Its ordinary result and fault words remain meaningful. |
| IMGDEC | Decoding pauses with stream state retained and can resume on leave. | Quiescence is not stream DONE, and there is no separate supervisor decoder bank. |
| APU | Playback pauses at supervisor entry, retaining the voice positions. | Voice state is not reset or separately banked. Sample-transfer work already in progress can still complete. |
| INPUT | One shared register file, pending ARM request and sample sequence remain in use, including the BIOS monitor's captures. | There is no cartridge INPUT bank to restore on leave. Obtain a new sample on resumption; see [BIOS handoff and supervisor sampling](input.md#sec-input-bios-handoff-and-supervisor-sampling). |

While APU playback is paused, voice positions remain unchanged. Leave resumes
playback from those positions. The separate sample-transfer engine can finish
accepted FIFO/RAM batches during the pause.

Supervisor PCRTC composition initially routes the cartridge's **presented**
circuit-1 source and display words into circuit 2, copies its presented background
color, and maps its circuit-1 enable into circuit-2 enable. This reuses source
addresses; it does not copy framebuffer pixels. The firmware can then prepare
its own display. Respect the firmware surface and system-texture reservation
explained under **Memory and bus access**; a retained cartridge GPU context
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

## Supervisor fault registers {#sec-system-supervisor-fault-registers}

The supervisor fault bank contains six raw 32-bit words. All are read-only to cartridge MMIO writes and reset to zero.
The register names in the next table have the prefix `SUPERVISOR_FAULT_`;
all 32 bits of each word are retained.

| Register | Address | Access | Reset value | Recorded value |
|---|---|---|---|---|
| `SEQUENCE` | `08010428H` | Read-only | `00000000H` | Publication sequence, incremented by FAULT_PUBLISH modulo `2^32`. |
| `CAUSE` | `0801042CH` | Read-only | `00000000H` | CPU Cause word at FAULT capture. |
| `EPC` | `08010430H` | Read-only | `00000000H` | CPU EPC word at FAULT capture. |
| `BAD_ADDRESS` | `08010434H` | Read-only | `00000000H` | Retained CPU BadAddress word at FAULT capture. |
| `LUA_REASON` | `08010438H` | Read-only | `00000000H` | Retained CPU LuaReason word at FAULT capture; not the Lua error value. |
| `DOMAIN` | `0801043CH` | Read-only | `00000000H` | Interrupted execution-image domain: cartridge `0` or `1`, or system `FFFFFFFFH`. This is not CPU privilege or SYSTEM stage. |

FAULT copies the five CPU payload words. FAULT_PUBLISH advances SEQUENCE
modulo 2^32 and leaves that payload unchanged. Software can capture first and
publish later; a new sequence identifies publication rather than the instant
of CPU exception entry. Zero is a valid sequence after reset and after wrap.

An NMI entry alone does not refresh this bank: the words change through FAULT
capture, not by following the CPU diagnostic registers continuously. BIOS fault
publication is described in [[Book II, BIOS diagnostics — Memory faults and the monitor](bios-monitor.md#sec-memory-installed-response-to-a-memory-exception)]{.content-visible when-format="html"}[Book II, §7.2]{.content-visible when-format="pdf"}.

Interpret the payload using Cause. Synchronous entry records the faulting
instruction's EPC; asynchronous entry records the interrupted PC. A subsequent
firmware EPC write is included in a later FAULT capture. Address exceptions
update BadAddress, while data-bus errors leave its previous value. Lua traps
update LuaReason; unrelated exceptions retain that word. These retained fields
must be read with the recorded cause.

The raw Cause word uses the following values. The exception-code mask is
`0000007CH`; IRQ and NMI indications are listed separately.

| Value | Meaning |
|---|---|
| `00000400H` | Maskable IRQ indication |
| `00010000H` | NMI indication |
| `00000010H` | Address-error load |
| `00000014H` | Address-error store |
| `00000018H` | Instruction-bus error |
| `0000001CH` | Data-bus error |
| `00000028H` | Reserved instruction |
| `0000002CH` | Coprocessor unusable |
| `00000034H` | Trap |

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

## Faults, interrupts and continuation {#sec-system-faults-interrupts-and-continuation}

The SYSTEM NMI is distinct from a maskable IRQ. A pending NMI takes precedence and is not gated by CPU interrupt-enable or the IRQ mask; it enters the system exception function. Maskable interrupt acceptance and source acknowledgement follow the **IRQ** chapter. Neither the request edge nor these priority rules establishes a fixed request-to-vector latency.

The shared access and fault rules are described in
[Memory and bus access](memory.md#sec-memory). An ordinary typed load or store
checks its scalar alignment first:
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

Device-context restoration and CPU exception return are separate operations.
Neither advances a synchronous-fault EPC or repairs its cause. The monitor's
inspection and continuation procedure is described in
[[Book II, BIOS diagnostics](bios-monitor.md#sec-bios-monitor)]{.content-visible when-format="html"}[Book II, Chapter 7]{.content-visible when-format="pdf"}.

## Reset requests {#sec-system-reset-requests}

RESET is available in either CPU mode. It latches one pending request for service
at a CPU execution boundary; repeated RESET writes coalesce until the request
is consumed. CONTROL reads zero, and STATUS has no reset-pending flag. Reading
either word neither consumes the request nor proves that reboot has occurred.
Other admitted command bits in the same write are still processed in the
defined order.

A pending request is serviced at a CPU execution boundary. Servicing it performs a system reboot: it clears I/O and bus faults, resets hardware and CPU execution state, and starts firmware again. There is no fixed request-to-reboot cycle latency. This is not a local device reset or a bus-fault acknowledgement, and it is not a promise that all RAM or every device buffer is zeroed.

At SYSTEM reset, CONTROL, STATUS and all six fault words are zero; no supervisor transition, exit request or resumable context remains. These are the reset values of this unit, not a substitute for the reset and acknowledgement rules of other devices. Automatic zero readback after a CONTROL write is command-port behavior, not an acknowledgement of a bus fault or completion of a machine reboot.
