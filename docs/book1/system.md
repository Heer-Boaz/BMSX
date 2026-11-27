# System control and timing {#sec-system}

> WARNING! The behavior of the system controller and its timing in BLua32 may not fully conform to the Lua standard due to implementation-specific details. Any deviations from the Lua standard should actually be regarded as bugs and not as intended features. Therefore, treat any non-standard behavior in this document as bugs and not as contracts, except for the extensions!

The system controller provides the console's millisecond timer and frame
timing, a diagnostic text output, the reset request and the switch between
the running program and the BIOS monitor.

## Specifications {#sec-system-system-specifications}

| Item | Specification |
|---|---|
| System clock | 33,868,800 Hz |
| Timer | 32-bit millisecond counter |
| Frame timing | Frame period in milliseconds (16.16 fixed point) and in cycles |
| Diagnostic output | 8192-byte line buffer, UTF-8 |
| Supervisor fault report | 6 words |

## Timer {#sec-system-measure-elapsed-console-time}

TIME_MS counts milliseconds since the console was switched on. To measure
an interval, read TIME_MS at the start and at the end and subtract. The
counter wraps from `FFFFFFFFH` to 0; the subtraction gives the right result
across the wrap as long as the interval is shorter than 2^32^ ms (about 49
days). Compare intervals with `math.ult`, which treats both values as unsigned.

The following example waits at least 100 ms:

```lua
local time_ms<const>: *word = 0x08010228
local start<const> = *time_ms
while math.ult(*time_ms - start, 100) do
end
local elapsed<const> = *time_ms - start
```

TIME_MS does not cause an interrupt. To wait with HALT, enable an interrupt
such as VBlank and test the time after each wake-up. The BIOS time and date
functions are described in
[[Book II, BIOS time and calendar services](bios-os.md#sec-bios-os)]{.content-visible when-format="html"}[Book II, Chapter 8]{.content-visible when-format="pdf"}.

## Timing registers {#sec-system-system-time-and-frame-timing}

| Address | Register | Access | Contents | Value after reset |
|---|---|---|---|---|
| `08010228H` | `TIME_MS` | R | Milliseconds, modulo 2^32^ | `00000000H` |
| `0801022CH` | `FRAME_MS_Q16` | R | Frame period in ms; bits 31–16 whole, bits 15–0 fraction | `00141893H` (20.096 ms) |
| `08010238H` | `CYCLES_PER_FRAME` | R | Frame period in system cycles | `000A62B4H` (680,628) |

FRAME_MS_Q16 and CYCLES_PER_FRAME follow the display timing programmed in
the [PCRTC](pcrtc.md#sec-pcrtc). They are 0 while the display timing is stopped;
TIME_MS keeps counting. Where the frame period is not a whole number of
cycles, CYCLES_PER_FRAME can differ by one from frame to frame.

To convert FRAME_MS_Q16 to milliseconds:
`(v >> 16) + (v & 0xffff) / 65536.0`.

The registers are read-only.

### Software timing {#sec-system-software-timing}

`os.difftime` subtracts without wrapping. Use it for BIOS time values, not for
TIME_MS.

## Diagnostic text output {#sec-system-diagnostic-text-output}

The diagnostic output sends lines of text to the development system. Write
the characters of a line, one Unicode code point per word, to PRINT_CHAR, then
write any value to PRINT_FLUSH to end the line. The BIOS console is a
separate facility, described in
[[Book II, BIOS base services — Console history and display](bios-base.md#sec-system-bios-console-integration)]{.content-visible when-format="html"}[Book II, §4.5.6]{.content-visible when-format="pdf"}.

| Address | Register | Access | Function |
|---|---|---|---|
| `08010230H` | `PRINT_CHAR` | R/W | Append one code point to the line |
| `08010234H` | `PRINT_FLUSH` | R/W | End the line |

Both registers read back the value last written and are 0 after reset.

Each code point is stored as UTF-8 (one to four bytes). An invalid code point
(`D800H`–`DFFFH` or above `10FFFFH`) is stored as `?`. PRINT_FLUSH appends a
line feed.

| PRINT_CHAR | Character | Bytes |
|---|---|---|
| `00000053H` | S | `53H` |
| `000000E9H` | é | `C3H A9H` |
| `0001F600H` | 😀 | `F0H 9FH 98H 80H` |
| `FFFFFFFFH` | (invalid) | `3FH` |

The line buffer holds 8192 bytes, including lines not yet collected by the
development system. If a character does not fit, the line being written is
discarded up to the next PRINT_FLUSH. Keep lines well below this size. A BLua
example is given in
[[Book II, BIOS diagnostics — Diagnostic text and the BIOS console](bios-monitor.md#sec-system-send-a-diagnostic-line)]{.content-visible when-format="html"}[Book II, §10.1]{.content-visible when-format="pdf"}.

## Supervisor mode and the monitor {#sec-system-privilege-and-supervisor-entry}

The BIOS monitor runs while the cartridge program is suspended. The system
controller keeps the program's device state (interrupt registers, DMA
channels, GPU registers and display settings) aside while the monitor uses
the devices, and restores it when the monitor returns. Main RAM, VRAM and APU
sample RAM are not saved; the monitor uses only its own reserved areas.

Cartridge programs run in user mode. Interrupt and exception handlers run in
supervisor mode. The CONTROL commands ENTER, FAULT, FAULT_PUBLISH and LEAVE
work only in supervisor mode; in user mode they are ignored.

The monitor is entered in two ways:

- **Monitor request.** The supervisor-request line from the input unit is
  tested at every VBlank. When it goes from 0 to 1 while the program runs,
  the system controller lets the devices finish their current work, then
  raises an NMI. The BIOS writes ENTER to switch to its own device state. When
  the line goes from 0 to 1 again while the monitor is active, the system
  controller sets EXIT_REQUESTED.
- **Fault.** When the program stops on an exception, the BIOS writes FAULT.
  The system controller records the fault and switches to the BIOS device
  state.

To return, the BIOS writes LEAVE, which restores the program's device state,
and then executes RFE, which returns the CPU to the program.

## Control registers {#sec-system-control-register-reference}

| Register | Address | Access | Value after reset |
|---|---|---|---|
| `CONTROL` | `0801034CH` | W (reads 0) | `00000000H` |
| `STATUS` | `08010350H` | R | `00000000H` |

### CONTROL {#sec-system-control}

| Bit | Value | Command | Function |
|---|---|---|---|
| 0 | `00000001H` | `RESET` | Request a system reset |
| 1 | `00000002H` | `SUPERVISOR_ENTER` | Switch to the BIOS device state after a monitor request |
| 2 | `00000004H` | `SUPERVISOR_LEAVE` | Restore the program's device state (only when RESUMABLE is 1) |
| 3 | `00000008H` | `SUPERVISOR_FAULT` | Record the CPU fault registers and switch to the BIOS device state |
| 4 | `00000010H` | `SUPERVISOR_FAULT_PUBLISH` | Increment SUPERVISOR_FAULT_SEQUENCE |
| 31–5 | — | — | Ignored |

: {tbl-colwidths="[6,14,29,51]"}

When several bits are written together, they are executed in the order RESET,
ENTER, FAULT, FAULT_PUBLISH, LEAVE.

### STATUS {#sec-system-status}

| Bit | Value | Flag | Meaning |
|---|---|---|---|
| 0 | `00000001H` | `SUPERVISOR_ACTIVE` | The monitor is being entered, is active or is being left |
| 1 | `00000002H` | `EXIT_REQUESTED` | The monitor request line has asked the monitor to return |
| 2 | `00000004H` | `RESUMABLE` | The program can be resumed with LEAVE |
| 31–3 | — | — | 0 |

## Device state during the monitor {#sec-system-device-boundaries-during-supervisor-service}

Before the switch, the system controller waits until GEO has finished its job,
the current DMA burst is complete and the GPU has executed all commands it has
received. A DMA transfer longer than one burst is continued after the monitor
returns.

| Device | During the monitor | After LEAVE |
|---|---|---|
| IRQ | FLAGS and MASK start at 0 | Program's FLAGS and MASK restored |
| DMA | Channels start idle | Program's channels restored and continued |
| GPU | Empty command and readback buffers | Program's registers, buffers and partial commands restored |
| PCRTC | Shows the program's picture until the BIOS changes it | Program's display settings restored |
| GEO | No new job starts | Ready for a new job |
| Image decoder | Paused | Continues |
| APU | Voices paused | Voices continue |
| Input | Shared with the monitor | Read new input before using it |

Pixels the monitor draws in VRAM are not restored. The monitor draws only in
the reserved [BIOS VRAM area](memory.md#sec-memory-firmware-reservation-in-vram).
See also [input after the monitor](input.md#sec-input-bios-handoff-and-supervisor-sampling).

## Supervisor fault registers {#sec-system-supervisor-fault-registers}

FAULT copies the CPU's exception registers into these registers for the
monitor. FAULT_PUBLISH increments SEQUENCE, so that a debugger can tell that
a new report is available.

| Address | Register | Contents |
|---|---|---|
| `08010428H` | `SUPERVISOR_FAULT_SEQUENCE` | Report number |
| `0801042CH` | `SUPERVISOR_FAULT_CAUSE` | CPU Cause register |
| `08010430H` | `SUPERVISOR_FAULT_EPC` | CPU EPC register |
| `08010434H` | `SUPERVISOR_FAULT_BAD_ADDRESS` | CPU BadAddress register |
| `08010438H` | `SUPERVISOR_FAULT_LUA_REASON` | CPU LuaReason register |
| `0801043CH` | `SUPERVISOR_FAULT_DOMAIN` | Program that was running: cartridge 0 or 1, or `FFFFFFFFH` for the system ROM |

The registers are read-only and 0 after reset.

EPC holds the address of the faulting instruction, or of the interrupted
instruction for an NMI. BadAddress is valid only for an address error, and
LuaReason only for a trap; otherwise they hold older values.

| Cause | Exception |
|---|---|
| `00000400H` | Interrupt (IRQ) |
| `00010000H` | Non-maskable interrupt (NMI) |
| `00000010H` | Address error, load |
| `00000014H` | Address error, store |
| `00000018H` | Bus error, instruction fetch |
| `0000001CH` | Bus error, data |
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
| 11 | INVALID_NEXT_KEY |
| 12 | INDEX_NAN |

How the BIOS reports faults is described in
[[Book II, BIOS diagnostics — Memory faults and the monitor](bios-monitor.md#sec-memory-installed-response-to-a-memory-exception)]{.content-visible when-format="html"}[Book II, §10.2]{.content-visible when-format="pdf"}.

## Faults and interrupts {#sec-system-faults-interrupts-and-continuation}

The NMI cannot be masked: it is accepted whatever the state of `STATUS.IEc`
and the interrupt mask, and it takes priority over the maskable interrupt.

A Lua error that is caught by `pcall` or by a coroutine does not reach the
monitor. An uncaught Lua error causes a trap exception with its LuaReason.
Address errors, bus errors and privilege errors cannot be caught by `pcall`.

The registers in this chapter follow the [register access rules](memory.md#sec-memory-io-widths-and-read-side-effects).
Writing a read-only register causes a READ_ONLY bus fault. How the monitor
shows a fault and resumes the program is described in
[[Book II, BIOS diagnostics](bios-monitor.md#sec-bios-monitor)]{.content-visible when-format="html"}[Book II, Chapter 10]{.content-visible when-format="pdf"}.

## Reset {#sec-system-reset-requests}

A write of RESET latches one request in either CPU mode. Further RESET writes
coalesce until the request is serviced. CONTROL reads zero; STATUS does not
report whether reset is pending. Other admitted bits in the same write are
still processed in the defined order.

While [CP0 Status bit 8](cpu.md#sec-cpu-cp0-fields) is set, the request remains
pending; the bit does not itself suspend execution. Once the bit is cleared,
the CPU accepts the request at the next execution boundary, after completing
the current instruction and before starting another. There is no fixed
request-to-reset time.

Servicing the request clears the I/O and bus-fault state, resets the CPU and
devices, and starts System ROM in the fixed reset bank. RAM, `RAM_END` and the
device buffers keep their contents. See
[[CPU reset](cpu.md#sec-cpu-cpu-reset-and-program-replacement)]{.content-visible when-format="html"}[Book II, §12.12]{.content-visible when-format="pdf"}.
