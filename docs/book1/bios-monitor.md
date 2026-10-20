# BIOS diagnostics {#sec-bios-monitor}

The BIOS monitor retains a stopped program's fault state so that its registers,
memory and source context can be inspected before continuation. Clearing a
report, repairing the cause and resuming execution are separate operations.

The following example follows a mapped-memory fault from inspection to retry.
The optional ROM diagnostic directory supplies the source locations and named
frame scopes used during that inspection. Its binary reference follows the
programming example; ordinary instruction execution does not require it.

## Memory faults and the monitor {#sec-memory-installed-response-to-a-memory-exception}

A synchronous memory exception enters the **system exception entry**, even when the faulting instruction belongs to a cartridge. This differs from a maskable IRQ, whose entry is selected according to the interrupted mode. Declaring a cartridge `exception` function does not install it as the handler for this memory-fault route.

The system exception entry calls the BIOS exception function, which enters the BIOS monitor. Acknowledging the Memory fault record is not exception return: it clears the retained report but does not repair an address or advance the faulting instruction. Likewise, returning from an exception does not itself acknowledge that record.

### Inspect an actual unmapped load {#sec-memory-inspect-an-actual-unmapped-load}

This cartridge fragment deliberately accesses unmapped storage. Its Word view addresses `0x01000000`, the first byte of the unmapped gap after the system-ROM window. Startup initially clears `reached_after_load`; the attempted load faults before its result can be assigned there.

```lua
module<entry>

bss reached_after_load: word
local unmapped<const>: *word = 0x01000000

-- This unmapped load enters the BIOS monitor before the assignment completes.
*reached_after_load = *unmapped

while true do
	halt_until_irq
end
```

This load produces a data bus error, displayed as **DBE**. The CPU cause field is `0x0000001c` (code 7); the Memory fault CODE is instead `0x00000001` (unmapped). These are different reports, not two encodings to write to the same register. DBE does not establish a new CP0 bad-address value. Inspect the Memory ADDR word for this bus fault's address.

At the BIOS monitor prompt, type the following command and press Enter. Its address is hexadecimal, and the count selects three consecutive 32-bit words:

```text
MEM 08010208 3
```

The displayed result is:

```text
08010208: 00000001 01000000 00000801
```

| Displayed word | Meaning for this load |
|---|---|
| `00000001` | Memory CODE: unmapped access |
| `01000000` | Memory ADDR: the invalid byte address |
| `00000801` | Memory ACCESS: read direction and Word access kind |

![BIOS monitor after the unmapped Word load and the three-word MEM command](figures/memory-bus-fault.png){#fig-memory-bus-fault}

**Unmapped-load output.** The BIOS reports DBE, the faulting source statement and its EPC; the `MEM` line shows the three Memory report words. EPC is the instruction's address in this program, not a constant to copy into another cartridge.

### Clearing a report is not repairing the program {#sec-memory-clearing-a-report-is-not-repairing-the-program}

The monitor's `FAULT` command displays its saved fault report when one is retained. `FAULT CLEAR` discards that saved BIOS report; it does not write `IO_SYS_BUS_FAULT_ACK`, clear the Memory CODE/ADDR/ACCESS words, or resume the cartridge.

`CONT` returns using the saved EPC without advancing it. In the program above, the invalid address is unchanged, so `CONT` retries the load and enters the monitor again with another DBE. The first Memory fault remains latched. Clearing either report does not turn an unmapped address into usable storage.

CP0 reads and writes require non-user mode; attempting them from ordinary cartridge user mode causes the coprocessor-unusable exception. Do not attempt to repair this example by reading or replacing CP0 fields in ordinary cartridge code. The example demonstrates inspection and an unchanged-instruction retry, not a cartridge recovery handler or a successful recovery.

### Repair a word load and retry {#sec-memory-repair-a-word-load-and-retry}

The preceding constant-address probe remains faulty after its report is cleared. This example instead makes the address a mutable local pointer, so you can repair the operand of the stopped read. Include the [BIOS diagnostic directory](#sec-memory-optional-bios-diagnostic-directory) for source and frame-scope lookup. Frame evaluation needs the correct source scope and an available, mutable live binding; it cannot recover arbitrary optimized-out locals.

```lua
module<entry>

struct memory_recovery_result
	first: word
	second: word
	fault_before_ack: word
	fault_after_ack: word
	completed: word
end

data source_address: word = 0x01000000
data safe_words: word[2] = { 0x12345678, 0x9abcdef0 }
bss result: memory_recovery_result

local source: *word = *source_address
local fault_code<const>: *word = 0x08010208
local fault_ack<const>: *word = 0x08010214

result.first = *source
source = source + sizeof(word)
result.second = *source
result.fault_before_ack = *fault_code
*fault_ack = 1
result.fault_after_ack = *fault_code
result.completed = 1
print('RECOVERED')
print(string.format('WORDS %08X %08X', result.first, result.second))
print(string.format('FAULT %08X -> %08X', result.fault_before_ack, result.fault_after_ack))

while true do
	halt_until_irq
end
```

`source` first receives the invalid address stored in `source_address`. The first read faults before assigning `result.first`. `safe_words`, by contrast, names the address of two DATA words in main RAM. Repair the existing `source` binding to that address: changing the `source_address` word alone would leave the stopped read’s already loaded pointer unchanged. Do not change EPC; the same read must be retried with the repaired operand.

At the monitor, inspect `FRAMES`. Each physical frame row gives its index,
function-record address and PC. Following `DEPTH` rows list the installed
source-scope names active at that frame's suspension PC, including inlined
functions. Choose the physical index from the preceding frame row and the
depth from the matching source-scope row. Missing diagnostic information is
reported instead of supplying a guessed scope. A binding must also be live and
mutable at that PC to be assigned.

In the supplied sample, the source frame is physical index `00000001`, depth
`00000000`, and its PC matches the fault EPC. Both selectors are displayed as
eight hexadecimal digits without a prefix; bare command selectors are decimal,
so use `0x` when copying them. Other programs or builds need not use this pair.
For the supplied sample, the sequence is:

```text
FRAMES
LUA --FRAME 0x00000001 0x00000000 source = safe_words
CONT
```

The single `LUA` assignment changes the selected frame's live pointer; it does not redeclare a typed local or change the `safe_words` address binding. It returns to the prompt without resuming execution or acknowledging Memory's report. A success banner is not required.

![Monitor after inspecting frames and assigning the repaired pointer, before continuing.](figures/memory-fault-repair.png){#fig-memory-fault-repair}

**Repair before retry.** The monitor after `FRAMES` and `source = safe_words`, still at the prompt before `CONT`; this is not a completed-recovery screen.

`CONT` retries the saved instruction. The first read now succeeds; the program advances `source` by `sizeof(word)` (four bytes) and reads the second word. The old Memory CODE can remain `1` throughout both successful reads: a pending report does not make a valid address invalid. Only afterward does the program save that old code, write `1` to ACK, and read the cleared code.

The successful run produces these diagnostic lines, not newly drawn text in the monitor image:

```text
RECOVERED
WORDS 12345678 9ABCDEF0
FAULT 00000001 -> 00000000
```

`REBOOT` is a restart request, not this repair or a saved-EPC continuation. With the cartridge unchanged, its bad initial pointer is encountered again. See [[System control and timing — Reset requests](system.md#sec-system-reset-requests)]{.content-visible when-format="html"}[Book I, “System control and timing”, under “Reset requests”]{.content-visible when-format="pdf"}.

For a programming example of privileged CP0 reads inside an ordinary cartridge IRQ callback, see [CPU — Read CP0 in a cartridge IRQ](cpu.md#sec-cpu-read-cp0-in-a-cartridge-irq). The callback returns normally, allowing the standard IRQ entry to perform RFE and resume the interrupted cartridge code.


## Optional BIOS diagnostic directory {#sec-memory-optional-bios-diagnostic-directory}

The ROM word at byte offset `0x3c` supplies a **ROM-relative byte offset** to
an optional diagnostic directory. Zero means absent. This word extends beyond
the CPU's 60-byte boot prefix: it is consumed by BIOS source reporting and
selected-frame evaluation, not by instruction execution or image activation.
Without the directory, executable code and ordinary boot remain usable, but
those BIOS services cannot recover its source locations or named frame scopes.

All directory words are unsigned 32-bit little-endian. The header occupies
**76 bytes**. Table offsets below are relative to the directory base; a
count is a number of records, not a byte count.

| Header byte offset | Field |
| --- | --- |
| `0x00`, `0x04` | Source-range count; range-table offset |
| `0x08`, `0x0c` | File count; file-table offset |
| `0x10`, `0x14` | Line-offset count; line-offset-table offset |
| `0x18`, `0x1c` | Path-byte-table offset; path byte count |
| `0x20`, `0x24` | Scope-function count; function-table offset |
| `0x28`, `0x2c` | Scope-frame count; frame-table offset |
| `0x30`, `0x34` | Binding count; binding-table offset |
| `0x38`, `0x3c` | Interval count; interval-table offset |
| `0x40`, `0x44` | Scope-name byte count; name-byte-table offset |
| `0x48` | Static-global binding count; these occupy the first binding records |

### Source locations {#sec-memory-source-locations}

| Record | Bytes | Four-byte fields, in increasing byte-offset order |
| --- | ---: | --- |
| Range | 12 | Absolute PC start; packed line/file; column |
| File | 20 | Directory-relative display-path offset; path byte count; ROM-relative source offset; source byte count; first line-offset index |
| Line offset | 4 | UTF-8 byte offset from the file's source start |

Range records are sorted by PC. Lookup selects the last record whose start is
not greater than the PC. The packed location holds the one-based line in bits
31:16 and the zero-based file index in bits 15:0; `FFFFFFFFH` marks no source.
Column is one-based. Include a no-source record at PC zero and another at the
text end so addresses outside mapped source do not inherit its final location.

Each file's line-offset sequence starts at zero and includes an end-of-source
sentinel. For line *L*, BIOS reads offsets at `first + L - 1` and `first + L`;
it strips terminal CR/LF bytes from the displayed line. Paths and source spans
use explicit byte counts, not NUL termination. Source bytes may occupy their
ordinary ROM location; they need not be duplicated inside the directory.

### Named frame scopes {#sec-memory-named-frame-scopes}

Scope functions are sorted by their absolute function-record address. BIOS
matches that address, computes instruction-word position
`(PC - codeAddress) >> 2`, and selects a frame at the requested inline depth
whose active interval contains that word. These are source scopes for BIOS
evaluation, not additional CPU call frames or instruction-fetch bounds.

| Record | Bytes | Four-byte fields, in increasing byte-offset order |
| --- | ---: | --- |
| Scope function | 16 | Absolute function-record address; absolute code address; first frame index; frame count |
| Scope frame | 28 | Inline depth; directory-relative name offset; name byte count; first active-interval index; active-interval count; first binding index; binding count |
| Binding | 32 | Directory-relative name offset; name byte count; flags; location; first visible-interval index; visible-interval count; first live-interval index; live-interval count |
| Interval | 8 | First instruction-word position; exclusive end position |

Interval lists are sorted nonoverlapping half-open ranges in instruction-word
positions relative to the function's code address. Names use UTF-8 byte spans.
A frame's visible bindings overlay the initial static-global bindings; later
same-named bindings shadow earlier ones even when their value is unavailable.
Visibility and availability are separate: the visible interval selects the
name, while the live interval determines whether its stored value is available.

Binding flags are bit 0 UPVALUE, bit 1 CONST, bit 2 ADDRESS and bit 3 TYPE.
Without ADDRESS or TYPE, location identifies a register or, with UPVALUE, an
upvalue slot. ADDRESS selects a raw static-storage address and remains available
without a live interval. TYPE describes a type rather than a readable value.
`FFFFFFFFH` is the no-location word. CONST marks a binding that evaluation must
not reassign; it does not freeze a Table's fields.

The BIOS locates this directory directly through the ROM-header word described
above.
