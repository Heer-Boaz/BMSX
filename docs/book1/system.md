# System control and timing

SYSTEM supplies five hardware facilities: reset requests, staged supervisor device-context transitions, a retained fault report, timing readouts, and diagnostic text output. The fault report separates capturing CPU diagnostics from publishing a new sequence value; it is not a continuously updated view of CPU exception registers.

For cartridge programs, timing means measuring elapsed console time and inspecting the programmed video period. `TIME_MS` supplies whole milliseconds derived from system cycles. `FRAME_MS_Q16` reports the programmed beam period in fractional milliseconds, while `CYCLES_PER_FRAME` reports a full VBlank-period cycle budget, not a countdown. These readouts do not provide a timer alarm or generate their own interrupt request. Interrupt delivery remains a separate facility.

Output means a line-oriented diagnostic channel, not drawing on the screen. `PRINT_CHAR` appends a Unicode codepoint to the current line; `PRINT_FLUSH` completes and publishes that line when queue space permits. These accesses neither request an interrupt nor enter supervisor service.

A supervisor device context is not a CPU privilege mode. SYSTEM can be entering or leaving that context while CPU exception handling is in progress. In particular, `LEAVE` begins device-context restoration; it does not perform CPU exception return. Conversely, CPU exception return does not restore the device context.

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

The control gate follows CPU current mode, not the cartridge or firmware origin of the executing function. Ordinary cartridge startup enters user mode. User-mode CP0 reads and writes take a coprocessor-unusable exception, but a cartridge-owned interrupt handler runs after exception entry clears the current user-mode bit. It is therefore incorrect to treat every instruction belonging to a cartridge as unprivileged. Conversely, importing or calling an ordinary library function does not grant supervisor privilege.

Normal supervisor entry begins with a separate request wire, not a CONTROL bit or a particular guest key. The input unit observes the wire at every VBlank edge and forwards low-to-high transitions, independently of whether input sampling is armed. SYSTEM accepts such an edge in USER and begins entry staging. An edge in ACTIVE with `RESUMABLE` set instead sets `EXIT_REQUESTED`; in other stages it has no effect. Keeping the wire high does not generate another rising edge.

During normal entry, `SUPERVISOR_ACTIVE` is visible while device quiescence is still in progress. When that preparation finishes, SYSTEM reaches ENTRY_VECTOR and requests a CPU NMI. This is a pending interrupt request, not immediate execution of the exception function. The firmware's NMI path writes ENTER to complete device-context activation. ENTER is therefore a completion command for an entry already in progress, not a software call for entry. No ordinary-cartridge supervisor-request callable is supplied by the public BIOS imports.

A synchronous fault takes a different route. The CPU enters the system exception function, and the firmware writes FAULT to capture its diagnostics. If this starts from USER, SYSTEM quiesces the devices and then activates the supervisor context directly, without issuing another NMI. A FAULT received during another non-ACTIVE stage redirects the target without restarting that stage; in ACTIVE it only captures the report. Activation sets `RESUMABLE` even on the fault route. The detailed device banks and quiescence rules are separate from these CPU-entry and command edges.

## Device boundaries during supervisor service

Supervisor service retains selected cartridge device context; it does not create
another copy of all console memory. Entry proceeds through producer, DMA and GPU
boundaries in that order. These are completion conditions, not a fixed number of
system cycles.

| Entry boundary | Condition before proceeding | Cartridge consequence |
|---|---|---|
| Producer boundary | GEO is no longer BUSY; IMGDEC has no scheduled decode batch | GEO may complete normally or report its normal error. IMGDEC need not finish the stream or empty its FIFOs. |
| DMA boundary | No admitted block and no DMA service in progress | An already admitted block completes; a longer BUSY transfer can retain a nonzero remaining count. No next block is admitted during this stage. |
| GPU boundary | Ingress has stopped, both ingress FIFOs are empty, no command completion is pending, readback is idle and no commands remain queued | A partial packet can still exist in assembly storage. The boundary is not a requirement that all packet-assembly words be zero. |

At the start of entry, new GEO CMD and DMA TRIGGER writes are held at their
admission gates, as are GPU GP1 control writes. IMGDEC suppresses its input and
output DMA request lines and admits no next decode batch after its scheduled
batch completes. These gates are not blanket protection of every device word or
of shared RAM. The ordinary supervisor-request path does not hold the CPU
throughout producer quiescence; the cartridge must not interpret the transition
as an immediate freeze of all its instructions or hardware.

<section class="keep-together">

After these boundaries, the ordinary request path can take the NMI and complete
ENTER. IRQ state is banked before the supervisor GPU context is initialized.
The following preservation rules apply to that activated context:

| Unit | Retained or held state | Limit |
|---|---|---|
| IRQ | Cartridge FLAGS and MASK are retained; supervisor FLAGS and MASK start at zero. Leave restores the retained cartridge words. | Supervisor pending bits are not merged into the restored cartridge word. A request explicitly directed to the retained cartridge bank can accumulate there. |
| DMA | Channel register words and the next-channel arbitration position are retained. Supervisor channels start clear. Leave restores the cartridge channels and resumes arbitration. | Payload RAM is not copied. Quiescing one admitted block is not completion of the entire transfer. |
| GPU | Cartridge drawing/display registers and partial packet, image-load and polyline assembly state are retained and restored. | VRAM remains shared. Restoring registers does not undo supervisor writes to framebuffer or texture bytes. |
| PCRTC | Programmed and presented composition words are retained separately. | Beam timing words and beam phase are not part of this composition bank. |
| GEO | The current job reaches a terminal phase; new CMD admission remains held until leave. | There is no separate supervisor GEO job/register bank. Its ordinary result and fault words remain meaningful. |
| IMGDEC | Stream state remains in place at a scheduled-batch boundary and can resume on leave. | Quiescence is not stream DONE, and there is no separate supervisor decoder bank. |
| APU | The voice clock is held after synchronization to the entry cycle; queued output samples are discarded. | Voice state is not reset or separately banked. Already scheduled sample-transfer work can still complete. |

</section>

While the APU voice clock is held, elapsed cycles do not accrue a deferred voice
catch-up workload. Leave releases the hold and schedules voice service again.
This is not a promise that every APU transfer, register or DMA operation is
frozen.

Supervisor PCRTC composition initially routes the cartridge's **presented**
circuit-1 source and display words into circuit 2, copies its presented background
color, and maps its circuit-1 enable into circuit-2 enable. This reuses source
addresses; it does not copy framebuffer pixels. The firmware can then prepare
its own display. Respect the firmware surface and system-texture reservation
explained under **Memory and program storage**; a retained cartridge GPU context
does not grant ownership of those VRAM bytes.

LEAVE crosses the DMA and GPU boundaries for the supervisor's work before
restoring the cartridge contexts. It releases GEO/IMGDEC admission and the APU
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

FAULT captures the five CPU payload words without advancing the sequence. FAULT_PUBLISH advances only the sequence and does not recapture those words. Consequently, the sequence is a **publication edge**, not a live-exception counter or an atomic-snapshot guarantee. It can advance without a new capture, and the payload can change before publication. Zero is both the reset sequence and a value reached on wrap; it is not a reserved invalid value.

The firmware's synchronous-fault path publishes after preparing the monitor display and waiting another VBlank. Publication is therefore later than CPU fault admission. An NMI entry alone does not refresh this bank: the words change through FAULT capture, not by following the CPU diagnostic registers continuously.

Interpret each payload word in context. A synchronous exception normally supplies the faulting instruction's EPC, whereas asynchronous interrupt entry supplies the interrupted frame's current PC; firmware may write EPC before a subsequent capture. Address exceptions update BadAddress, but a mapped-MMIO data-bus exception does not necessarily do so. Lua-fault entry updates LuaReason, while unrelated exception entry leaves its previous value intact. A new fault sequence therefore does not guarantee a newly produced BadAddress or LuaReason.

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

A pending request is consumed at an execution-update or instruction-step boundary before scheduled execution, or after a CPU execution slice in the ordinary update path. Consumption performs a system reboot: it clears I/O and bus faults, resets hardware and CPU execution state, and starts firmware again. There is no fixed request-to-reboot cycle latency. This is not a local device reset or a bus-fault acknowledgement, and it is not a promise that all RAM or every device buffer is zeroed.

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

For elapsed intervals, the existing `cartlib/clock` library provides `milliseconds()` and `elapsed_milliseconds(start, current)`. The former returns the raw `TIME_MS` word; the latter computes unsigned wrapping sample distance. That distance is meaningful only when the actual interval is shorter than one complete 2^32-millisecond period. A zero result is valid when both samples fall in the same millisecond. `os.difftime` is ordinary integer subtraction, not wrapping hardware-time arithmetic.

`FRAME_MS_Q16` describes the currently programmed beam period. Divide its unsigned word by `0x00010000` to express the reported value in milliseconds. The refresh value used to form this report is first truncated to whole millionths of a hertz; the Q16 period is then truncated and reduced to its low 32 bits. The full period is maintained separately, rather than recovered from this register. A sufficiently long period can therefore wrap the reported word without shortening the complete period. The existing clock library already performs the Q16 conversion when configuring tick intervals; its retained gameplay and frame deltas are schedule quanta, not live elapsed clocks.

`CYCLES_PER_FRAME` is a whole-period budget, not the number of cycles remaining until the next VBlank. Fractional beam timing can make successive budgets differ by one cycle. Reprogramming a beam-timing word with different bits immediately changes operational timing and restarts the beam; writing identical bits does not. These SYSTEM words describe programmed timing, not confirmation that a new image has been presented. When beam timing is stopped, both frame-timing words are zero; `TIME_MS` is not stopped with them.

The BIOS `os.clock()` returns `TIME_MS / 1000`, in seconds with millisecond resolution. The no-argument `os.time()` returns `TIME_MS // 1000`, in whole seconds. Both inherit the hardware word's wrap and neither measures time spent exclusively executing cartridge instructions. `os.time(date_table)` instead calculates a civil timestamp from the supplied fields; it does not set the console clock. These functions do not establish a wall-clock or real-time-clock service.

## Diagnostic text output

| Address | Register | Access | Word interpretation | Reset |
|---|---|---|---|---|
| `0x08010230` | `PRINT_CHAR` | R/W | Bits 31–0: Unicode codepoint to append; reads return the full last written word | `0x00000000` |
| `0x08010234` | `PRINT_FLUSH` | R/W | All written values request line publication; reads return the full last written word | `0x00000000` |

Use aligned word writes. `PRINT_CHAR` accepts a Unicode codepoint, not a memory address, string reference, packed group of characters, or UTF-8 byte. Values `0x00000000`–`0x0000007f` encode as one UTF-8 byte, `0x00000080`–`0x000007ff` as two, `0x00000800`–`0x0000ffff` as three except for surrogates, and `0x00010000`–`0x0010ffff` as four. Surrogate words `0x0000d800`–`0x0000dfff` and words above `0x0010ffff` append the single byte `0x3f` (`?`). Readback still returns the original word, including an invalid codepoint word.

Character writes only extend the current partial line. Even a `PRINT_CHAR` write of `0x0000000a` does not publish it. Every `PRINT_FLUSH` write—including a write of zero—attempts to append one ASCII line-feed byte and publish the entire partial line. The written value is not a length, threshold, or enable mask. A successful flush publishes diagnostic text; it is not a screen-display command, interrupt, or acknowledgement that the receiver has drained the text.

Completed unread lines and the current partial line share one 8192-byte queue. Each character needs space for its complete one- to four-byte UTF-8 encoding. If a character cannot fit, the current partial line is discarded, completed unread lines are preserved, and further character writes are ignored until the next flush. That flush publishes nothing and clears the overflow condition. If the flush itself first encounters insufficient space for its added line-feed byte, it likewise discards the partial line, publishes nothing, and leaves overflow cleared. In particular, 8192 unflushed ASCII characters leave no room for the flush's line feed, so that entire partial line is lost. No readiness, free-space, or accepted-line counter is available through these ports. Reset empties the queue and clears both register words.

BIOS `print(...)` converts each argument with `tostring`, separates arguments with tabs, writes to the BIOS console, and ends the line. Console writes send the full codepoints to `PRINT_CHAR` and also append to a separate 8192-byte BIOS history; codepoints above `0xff` become `?` in that history. Ending the line appends a history line feed and writes `PRINT_FLUSH = 1`. Thus `print` sends text to both diagnostic output and BIOS history, but does not itself flush the console display.

Direct writes to `PRINT_CHAR` and `PRINT_FLUSH` do not add BIOS-history entries or draw glyphs. The BIOS console display is updated separately from its retained history. Diagnostic publication, retained console text, and visible console drawing are distinct events.

## A complete timer and diagnostic program

This program collects four timed observations, compares the ordinary BIOS clock calls with raw SYSTEM reads, and sends a short Unicode diagnostic line. It retains its observations in typed cartridge storage rather than relying on the appearance of text on the screen. The result module and entry program are printed in full below; the entry program is divided into consecutive parts.

Run it as a fresh, ordinary BIOS cartridge startup, with the main program in current user mode. It owns the VBlank handler and interrupt mask, enables no other interrupt source, and assumes no other diagnostic writer. Keep the inherited beam running: the program deliberately leaves PCRTC alone. These are starting conditions for this example, not promises about an arbitrary interrupted or resumed cartridge. In particular, fresh cartridge entry does not mean that the machine millisecond counter starts at zero.

The separate chapter companion supplies the cartridge materials, build
instructions and the ordinary-run procedure for observing diagnostic output
and entering the monitor.

<section class="keep-together">

### Reserve the observations

The result module declares one six-word sample and the complete retained result:

```lua
module<const>

struct system_manual_sample
	before_ms: word
	after_ms: word
	elapsed_ms: word
	frame_ms_q16: word
	cycles_per_frame: word
	status: word
end

struct system_manual_result
	completed_samples: word
	vblanks: word
	ignored_control: word
	ignored_status: word
	faults: word[6]
	clock_before_ms: word
	clock_after_ms: word
	clock_seconds: f64
	time_before_ms: word
	time_after_ms: word
	time_seconds: word
	char_readback: word
	flush_readback: word
	samples: system_manual_sample[4]
end

bss result: system_manual_result

return { result = result }
```

</section>

Each sample occupies 24 bytes. The complete BSS object occupies **172 bytes**, including its four samples, six initial fault words, clock-call brackets, diagnostic readbacks, and progress fields. The eight-byte `f64` member has four-byte alignment in this layout. BSS supplies the initial zero values; the program uses the named typed object, not a guessed RAM address.

<section class="keep-together">

### Bind the ports and arrange the wake-up source

The entry program begins with the two module references and explicit word-port bindings:

```lua
module<entry>

local state<const> = require('results')
local clock<const> = require('cartlib/clock')
local result<const>: *system_manual_result = state.result
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local time_ms<const>: *word = 0x08010228
local frame_ms_q16<const>: *word = 0x0801022c
local print_char<const>: *word = 0x08010230
local print_flush<const>: *word = 0x08010234
local cycles_per_frame<const>: *word = 0x08010238
local control<const>: *word = 0x0801034c
local status<const>: *word = 0x08010350
local fault_words<const>: *word = 0x08010428
```

</section>

Dereferencing a port pointer performs that port access. The result pointer instead names the BSS object. `os.clock`, `os.time`, and `print`, used below, are ordinary globals supplied by the BIOS; they need no additional module import.

<section class="keep-together">

The next part provides the cartridge's interrupt routine and enables only VBlank:

```lua

function irq(flags)
	if (flags & 0x00000004) ~= 0 then
		*irq_ack = 0x00000004
		result.vblanks = result.vblanks + 1
	end
end

-- Fresh BIOS entry, current user mode, exclusive VBlank handler and mask.
-- Keep the inherited running beam; do not reprogram PCRTC in this example.
*irq_mask = 0
*irq_ack = 0x00000004
*irq_mask = 0x00000004

-- All four supervisor commands are ignored in current user mode. No RESET.
*control = 0x0000001e
result.ignored_control = *control
result.ignored_status = *status
for index = 0, 5 do
	result.faults[index] = fault_words[index]
end
```

</section>

The routine acknowledges and counts VBlank only when bit `0x00000004` is present. The main program first masks all interrupt sources, acknowledges VBlank, and then enables that source. With the running beam and normal startup interrupt admission, this gives the later `halt_until_irq` instructions a wake-up route. Advancing `TIME_MS` alone is not a wake-up event.

The `CONTROL` write selects all four supervisor command bits but excludes `RESET`. It occurs in the main program's current user mode, so those commands are ignored. For these starting conditions, `ignored_control`, `ignored_status`, and all six saved fault words are zero. The six words are retained in address order: sequence, cause, EPC, bad address, Lua reason, and domain.

This is an observation of the user-mode command gate, **not a monitor-entry API**. Privilege follows the CPU's current mode, not the cartridge containing an instruction; an interrupt routine runs in exception context. Moving the same control write into that routine would not demonstrate the same gate.

<section class="keep-together">

### Compare BIOS seconds with raw milliseconds

The next consecutive part brackets each BIOS clock call with two raw reads:

```lua

-- BIOS functions are ordinary globals. These are separate clock reads.
result.clock_before_ms = *time_ms
result.clock_seconds = os.clock()
result.clock_after_ms = *time_ms
result.time_before_ms = *time_ms
result.time_seconds = os.time()
result.time_after_ms = *time_ms
print('SYSTEM timer experiment')
```

</section>

`TIME_MS` is an unsigned 32-bit millisecond word. Fractional milliseconds are discarded, and the word wraps after `2^32` milliseconds. The no-argument `os.clock()` returns this machine time divided by 1000 as floating-point seconds; `os.time()` returns its integer quotient by 1000. Neither is a nonwrapping calendar clock, and `os.clock()` does not count only the instructions executed by this program.

Each BIOS call makes its own time read. The words before and after it bracket that call; they are not a single shared reading. Likewise, a rollover between readings is a rollover of the word, not evidence that time ran backward. The brackets let the reader interpret the BIOS values without requiring all three reads to happen in the same millisecond.

<section class="keep-together">

### Wait for a predicate, then retain the raw timing words

The four observations follow immediately:

```lua

for index = 0, 3 do
	local sample<const>: *system_manual_sample = &result.samples[index]
	sample.before_ms = *time_ms
	while clock.elapsed_milliseconds(sample.before_ms, *time_ms) < 100 do
		halt_until_irq
	end
	sample.after_ms = *time_ms
	sample.elapsed_ms = clock.elapsed_milliseconds(sample.before_ms, sample.after_ms)
	sample.frame_ms_q16 = *frame_ms_q16
	sample.cycles_per_frame = *cycles_per_frame
	sample.status = *status
	result.completed_samples = index + 1
end
```

</section>

`&result.samples[index]` takes the address of the selected typed sample. The program records a start word and repeatedly asks whether the unsigned elapsed distance is still less than 100 milliseconds. The existing clock library owns the wrapping calculation; no local encoder or subtraction convention is needed. Its elapsed-distance contract requires the actual interval to be shorter than one full `TIME_MS` period.

After each interrupt wake-up, the program checks the predicate again. The resulting `elapsed_ms` is **at least 100**, not necessarily exactly 100. VBlank delivery and the instructions between the reads can make it larger; this is not an exact 100-millisecond cadence or an instruction-active-only measurement. The start for each observation is taken anew.

`after_ms`, `frame_ms_q16`, `cycles_per_frame`, and `status` are separate accesses, not an atomic multiword snapshot. The frame word remains raw Q16 milliseconds; `0x00010000` represents one millisecond. The cycles word is the current next-VBlank cycle budget, not the number of cycles spent in the wait. Their values belong to the running timing configuration; no fixed frame duration is assumed here.

`completed_samples` advances only after all fields of that sample have been written. On completion it is 4, each saved elapsed distance is the wrapping distance from its two saved time words and is at least 100, and each saved status is zero under the stated conditions. The VBlank count is at least 4 and continues to grow during the final idle loop.

<section class="keep-together">

### Send codepoints, then complete the line

The final consecutive part sends four raw codepoints, records port readback, prints the completion message, and idles:

```lua

-- Raw codepoints, not UTF-8 bytes: S, é, a supplementary character, invalid.
*print_char = 0x00000053
*print_char = 0x000000e9
*print_char = 0x0001f600
*print_char = 0xffffffff
result.char_readback = *print_char
*print_flush = 0
result.flush_readback = *print_flush
print('SYSTEM samples complete')

while true do
	halt_until_irq
end
```

</section>

`CHAR` accepts one Unicode codepoint per write, not a UTF-8 byte, string address, or packed group of characters. These writes request `S`, `é`, U+1F600, and an out-of-range word. The last is encoded as `?`, but the saved raw `CHAR` readback is still `0xffffffff`.

A `CHAR` write does not publish the partial line. **Any `FLUSH` write, including zero**, appends a line feed and publishes the line when there is room. Its value is not a length or enable bit. With room for this line and no interleaved writer, the raw bytes are:

```text
53 C3 A9 F0 9F 98 80 3F 0A
```

The diagnostic text, including the two BIOS print calls, is therefore:

```text
SYSTEM timer experiment
Sé😀?
SYSTEM samples complete
```

The saved `flush_readback` is zero. Both readbacks are recorded before the final BIOS `print`, which performs further diagnostic-port writes of its own. They record the words written, not receiver readiness or confirmation that the line has been drained.

The two output routes have different console consequences. BIOS `print` sends diagnostic output **and** retains text in BIOS console history, but does not itself flush that history to the display. Direct `CHAR` and `FLUSH` writes send only diagnostic output: they neither add console-history entries nor draw glyphs. Thus the two BIOS print lines can appear in the later monitor display, while the raw `Sé😀?` line is not in that history. The final idle loop leaves the VBlank handler enabled; completion does not mean the machine's time or beam has stopped.


![BIOS console after the timer experiment](figures/system-console.png)

The monitor displays the two BIOS print lines from retained console history.
The raw diagnostic line does not appear in that history.
