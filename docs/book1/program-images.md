# Program images and startup {#sec-program-images}

Program execution depends on both stored bytes and their addresses. A ROM
header identifies the program image and entry functions; the image describes
its instructions, constants, names and static storage. A function address
selects a function record, whose code address identifies the instructions.

Startup establishes writable static contents before calling the application.
An ordinary function call, an EXEC transfer and a fresh startup therefore have
different effects. This chapter follows those effects from reset to cartridge
entry, then specifies the ROM records and BIOS call-target lookup.
[[Memory and bus access](memory.md#sec-memory)]{.content-visible when-format="html"}[Book I, “Memory and bus access”]{.content-visible when-format="pdf"} in Book I supplies the physical
address map and the storage reservations that every placement must respect.

## ROM contents, RAM sections, and startup {#sec-memory-rom-contents-ram-sections-and-startup}

The ROM layout described here stores program instructions, read-only data
and the initial contents of writable data. Mutable static objects have
separately assigned run addresses in main RAM. The section names distinguish
their storage and initialization rules:

| Section | Contents in the ROM image | Address used during execution |
|---|---|---|
| TEXT | Executable code | Instruction byte address in ROM |
| RODATA | Read-only data bytes | Read-only byte address in ROM |
| DATA | Initializer bytes | DATA run address in main RAM, after startup copies the initializers |
| BSS | No section byte payload | BSS address in main RAM, after startup clears the section |

DATA consequently has two distinct addresses:

- Its **load address** identifies the initializer bytes in the ROM image.
- Its **run address** identifies the writable storage in main RAM.

Instructions access a DATA object's RAM run address. Startup reads the
initializer at its ROM load address and copies it to that run address.
RODATA is used in place in ROM. BSS reserves a RAM address range, whose initial
zero contents are written by startup; the ROM needs only its address and size.

### Follow the records, counter and output storage {#sec-memory-follow-the-records-counter-and-output-storage}

The [record-copy example](blua-programs.md#sec-memory-worked-example-prepare-and-copy-two-records)
uses three addressed objects: two read-only input records, an initialized
counter, and space for two output records. Each record occupies twelve bytes.
Their storage requirements are:

| Object | Bytes in ROM | Bytes in main RAM | Preparation |
|---|---|---|---|
| `inputs`: two read-only records | 24 record bytes | None | Use the ROM bytes in place |
| `counter`: one initialized word | 4 initializer bytes | 4 working bytes | Copy `12345678H` into the working word |
| `output`: two zero-initialized records | No BSS payload | 24 working bytes | Clear all 24 bytes |

The counter's initializer occupies bytes `78 56 34 12` in increasing ROM
addresses. Startup copies those bytes to the counter's RAM run address. The
program subsequently reads and changes the RAM word; its ROM initializer stays
unchanged. Likewise, filling `output` changes its RAM bytes, not `inputs`.

The object extents above do not choose their addresses. Place the RAM objects
outside the [[reserved and firmware-owned spans](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)]{.content-visible when-format="html"}[Book I, “Memory and bus access”, under “Reserved and cartridge storage in main RAM”]{.content-visible when-format="pdf"}, and describe the
chosen section addresses consistently in startup and the program image. A local
pointer view selects an existing object's bytes; it does not allocate another
copy of that object.

### When initialization occurs {#sec-memory-when-initialization-occurs}

A program's startup routine establishes its static storage before entering
application code. The standard BLua startup sequence is:

| Order | Operation |
|---|---|
| 1 | Copy the complete DATA section from its ROM load address to its RAM run address. |
| 2 | Write zero throughout the BSS section in RAM. |
| 3 | Run static module initialization. |
| 4 | Call the program's entry function. |

The DATA copy and BSS clear use four-byte word accesses over their complete
padded byte counts. System startup initializes the firmware sections; cartridge
startup initializes the cartridge program's sections. System startup also
removes the temporary boot-primitive bindings after module initialization.

EXEC starts the addressed function. DATA initialization and BSS clearing occur
only when the instructions performing them execute. Therefore the ROM startup
address must select the initialization routine when that initialization is
required. Entering another function leaves the sections as they stand.
Re-entering startup repeats the copy and clear, replacing the program's
writable static contents with their initial values.

## Reset and cartridge startup {#sec-memory-reset-and-cartridge-startup}

### From reset to the system program {#sec-memory-from-reset-to-the-system-program}

At reset the CPU selects system ROM and enters the startup function specified
in its ROM header. The call stack and transient execution state are cleared,
there are no supplied arguments, and Status starts at `00000001H`: supervisor
mode with current interrupt enable set.

The firmware startup routine initializes system DATA and BSS, runs module
initializers, then enters the BIOS boot program. That program selects an
executable cartridge and performs the handoff described below.

### BIOS cartridge selection {#sec-memory-bios-cartridge-selection}

The BIOS scans cartridge slot 0 before slot 1, considering slots whose presence bits are set in the sampled cartridge-status word. For each candidate it selects that slot and checks:

- ROM magic is `0x58534d42`;
- the header-size word is at least 60;
- the executable-image-offset word is nonzero;
- the startup-function word is nonzero.

The first candidate passing all four checks supplies the startup-function
address. The CPU then applies the function-record and program rules specified
in the record reference below.

The boot screen updates at VBlank. BIOS hands over when an executable cartridge
is ready and its boot-frame counter has reached at least 50. A change between
the missing, invalid and ready cartridge states resets that counter; changing
the selected card while its classification remains ready does not by itself
reset it. At handoff BIOS clears and flushes terminal status, masks central IRQ
delivery, and writes the selected startup-function address to CP0 EXEC.

### EXEC and cartridge entry {#sec-memory-exec-and-cartridge-entry}

A startup function address identifies a **function record**, not the address of its first instruction. EXEC reads the target record and requires its STATIC flag. An unreadable record or one without that flag causes a hard halt.

Successful EXEC clears the active call stack, selects the target executable image and execution domain, establishes its entry status, clears CPU halt, wait, blocked-write and yield state, and pushes the selected static function with no arguments. A successful `EXEC` of a cartridge image sets CPU status to IE and user mode (bits 0 and 1) before starting the selected static function—not at a later entry-function call. The BIOS's zero IRQ-mask write must not be confused with clearing the CPU interrupt-enable bit.

The standard cartridge startup routine then performs:

1. Copy the cartridge image's DATA initializer bytes from their load address to their RAM run address.
2. Zero the cartridge image's BSS.
3. Run static module initialization.
4. Call the cartridge entry function with no arguments.

EXEC enters exactly the selected static function. Choose the startup routine
when section initialization is required; entering another function skips that
sequence. Re-entering startup repeats the DATA copy and BSS clear. Initialize
all cartridge-owned storage whose contents the program requires.

### Fresh system boot and execution transfer {#sec-blua-programs-fresh-system-boot-and-execution-transfer}

Fresh system boot clears both global-name banks, then installs the BIOS
environment before normal program entry. `EXEC` keeps the existing banks
and BIOS bindings while replacing execution. Initialize program-owned globals
explicitly when transferring between programs. See [CPU execution
control](cpu.md#sec-cpu-exec) for the complete transfer behavior.

### Taking ownership after the BIOS {#sec-memory-taking-ownership-after-the-bios}

At normal BIOS handoff, video timing is running and the display contains BIOS
drawing. Cartridge code may retain that display or establish its own drawing
and display configuration. Program each unit before use; its reset-value table
applies to reset, while its inherited boot state follows the rules here.
[[System timing](system.md#sec-system-system-time-and-frame-timing)]{.content-visible when-format="html"}[Book I, “System control and timing”, under “System time and frame timing”]{.content-visible when-format="pdf"} describes the live
readouts, and [CPU control](cpu.md#sec-cpu-cp0-and-execution-control) describes entry
privilege and interrupt enable.

The BIOS writes zero to the central interrupt mask before handoff. This masks delivery; it does not clear pending flags or clear CPU interrupt enable, which is set at cartridge entry. Enabling a pending source can make it deliverable without another event. Choose one dispatch owner, install the first source's handler and prepare that source before enabling its delivery. Acknowledge local source state and central pending state as required by the unit; they are separate responsibilities. See [[Interrupt controller — Choose one cartridge dispatch route](irq.md#sec-irq-install-the-cartridge-handler)]{.content-visible when-format="html"}[Book I, “Interrupt controller”, under “Install the cartridge handler”]{.content-visible when-format="pdf"} and [[Acknowledge the source and the controller separately](irq.md#sec-irq-acknowledge-the-source-and-the-controller-separately)]{.content-visible when-format="html"}[Book I, “Interrupt controller”, under “Acknowledge the source and the controller separately”]{.content-visible when-format="pdf"}. The GPU marker example's [[Starting conditions](irq.md#sec-irq-starting-conditions)]{.content-visible when-format="html"}[Book I, “Interrupt controller”, under “Starting conditions”]{.content-visible when-format="pdf"} show this ordering for its chosen configuration, not a universal device-reset recipe.

Execution handoff also does not release the [[Firmware reservation in VRAM](memory.md#sec-memory-firmware-reservation-in-vram)]{.content-visible when-format="html"}[Book I, “Memory and bus access”, under “Firmware reservation in VRAM”]{.content-visible when-format="pdf"}; see [[Handoff is not release](memory.md#sec-memory-handoff-is-not-release)]{.content-visible when-format="html"}[Book I, “Memory and bus access”, under “Handoff is not release”]{.content-visible when-format="pdf"}. Later supervisor service preserves selected device context, not overwritten VRAM pixels. Its boundaries are described in [[System control and timing — Device boundaries during supervisor service](system.md#sec-system-device-boundaries-during-supervisor-service)]{.content-visible when-format="html"}[Book I, “System control and timing”, under “Device boundaries during supervisor service”]{.content-visible when-format="pdf"}.

INPUT likewise carries BIOS sampling state into cartridge entry rather than
starting from its reset words. Follow
[[BIOS handoff and supervisor sampling](input.md#sec-input-bios-handoff-and-supervisor-sampling)]{.content-visible when-format="html"}[Book I, “Input controller”, under “BIOS handoff and supervisor sampling”]{.content-visible when-format="pdf"}
to establish a fresh cartridge sample, including after supervisor return.

#### Firmware work at normal boot handoff {#sec-memory-firmware-work-at-normal-boot-handoff}

On the normal reset-to-cartridge boot path, BIOS has supplied its final GPU
command batch and reached that batch's completion marker. Firmware DMA and
VBlank handlers have stopped submitting work. The following unit state is then
available to the cartridge. Entry through another EXEC route must establish its
own device state.

| Surface | Firmware work at cartridge entry |
| --- | --- |
| DMA0 and DMA1 | No outstanding firmware transfer or admitted transfer block. DMA0's final transfer has finished; this boot path never starts DMA1. |
| GP0 input and readback | No active firmware writer, unfinished firmware packet, or outstanding firmware VRAM-to-CPU readback. |
| GEO | No outstanding firmware geometry job. |
| IMGDEC | No outstanding firmware decode, input, or output job. |
| APU | No queued firmware command, active playback slot, or outstanding sample-transfer batch. This does not imply that the APU clock or output activity has stopped. |

Submitted BIOS drawing may still be pending after its final marker, although
the firmware has stopped producing commands. Before changing resources used by
that work, use the GPU completion protocol. Display publication remains a
separate PCRTC event. EXEC leaves the device registers and submitted work in
place.

## ROM header fields {#sec-memory-rom-header-fields}

The ROM header begins at the ROM base. Provide at least its first **60 bytes**,
through offset `0x3b`, for CPU program selection. All offsets in the following
table are byte offsets from that base. Header words are unsigned 32-bit
little-endian. The CPU uses the program and vector fields; BIOS also checks the
identification and startup fields when selecting a cartridge.

| Byte offset | Field | CPU program selection | BIOS cartridge selection |
| --- | --- | --- | --- |
| `0x00` | Magic | Not read. | Requires `0x58534d42`; bytes `42 4d 53 58` spell `BMSX`. |
| `0x04` | Header size | Not read. | Requires at least 60 bytes. |
| `0x08`–`0x1f` | Other prefix words | Not read. | Not read. |
| `0x20` | BLua32 image offset | Byte offset relative to the ROM base; zero means no executable image. | Requires a nonzero word. |
| `0x24` | Declared image byte count | Not read. | Not read. |
| `0x28` | Startup function | Absolute function-record address. | Requires a nonzero word; supplies the EXEC target unchanged. |
| `0x2c` | IRQ function | Absolute function-record address. | Not read. |
| `0x30` | Exception function | Absolute function-record address. | Not read. |
| `0x34`, `0x38` | Declared static-layout token words | Not read. | Not read. |

System ROM begins at `00000000H` and has execution-domain ID −1. Either
cartridge socket uses ROM base `10000000H`, with domain ID 0 or 1 selecting the
socket. Add the program-offset word to this base and retain the low 32 bits to
obtain the BLua32 program-header address. The result must address installed ROM.
The startup and vector fields are already absolute function-record addresses.

All 60 prefix bytes must be present in ROM. A zero program offset marks a ROM
without a CPU program; an absent prefix likewise provides no program. System ROM
must supply the reset program. CPU selection uses the fields shown in its
column; identification checks belong to BIOS cartridge selection. The exception
address's use follows the exception-routing rules, including the system route
for synchronous cartridge faults.

The next ROM-header word, at byte offset `0x3c`, is a ROM-relative offset to
optional BIOS diagnostic records; zero means absent. It is outside the CPU's
60-byte selection prefix. [BIOS diagnostics](bios-monitor.md#sec-memory-optional-bios-diagnostic-directory)
defines its source-location and frame-scope tables separately from executable
selection and instruction operation.

## BLua32 executable image {#sec-memory-blua32-executable-image}

The BLua32 program header occupies **96 bytes** in ROM. Its offsets are relative
to the program-header address obtained above. The CPU uses these six unsigned
32-bit little-endian fields to establish the program's constants and name banks:

| Image byte offset | Field | Unit and interpretation |
| --- | --- | --- |
| `0x18` | Constant-table address | Absolute machine byte address in installed ROM. |
| `0x1c` | Constant count | Number of 16-byte constant records. |
| `0x20` | Global-name-table address | Absolute machine byte address in installed ROM. |
| `0x24` | Global-name count | Number of 8-byte name records. |
| `0x28` | System-global-name-table address | Absolute machine byte address in installed ROM. |
| `0x2c` | System-global-name count | Number of 8-byte name records. |

The other four-byte header slots describe the program's sections and linkage. They retain
the following format; CPU program selection does not use them to locate the
constant or name tables.

| Image byte offset | Descriptive field |
| --- | --- |
| `0x00` | Magic; declared constant `0x32334c42`. |
| `0x04` | Version; declared constant 1. |
| `0x08`, `0x0c` | Image byte count; flags. |
| `0x10`, `0x14` | Function-table address; function count. |
| `0x30`, `0x34` | String address; string byte count. |
| `0x38`, `0x3c` | RODATA address; RODATA byte count. |
| `0x40`, `0x44`, `0x48` | DATA load address; DATA byte count; DATA run address. |
| `0x4c`, `0x50` | BSS address; BSS byte count. |
| `0x54`, `0x58` | TEXT address; TEXT byte count. |
| `0x5c` | Preparation-sequence function-record address; zero when no sequence is present. |

Provide the complete 96-byte header, including its descriptive slots. The CPU
reads the explicit constant/name addresses and counts. Magic, version,
function-table enumeration, section order and declared section extents do not
alter those reads or bound instruction fetching. DATA and BSS are initialized
by the startup instructions.

The preparation address selects a separate ordinary function, not another
startup vector. Calling it completes pending module initialization and runs
the registered `<init>` participants without
recopying DATA, clearing BSS or restarting the entry function. See
[BLua participant sequences](blua-programs.md#sec-blua-programs-init-registers-a-participant-it-does-not-call-it-at-startup)
for declaration order and invocation.

Table addresses are **absolute machine byte addresses**. Tables and their text
must occupy installed ROM; their placement is independent of table order and
of the declared image extent. Cartridge ROM reads select the program's
execution socket, while system-ROM addresses select system ROM. A zero table
count leaves its address unused.

### Constant and name records {#sec-memory-constant-and-name-records}

Constant record `i` begins at `constantTableAddress + 16i`, with zero-based `i`. The tag is a four-byte unsigned little-endian word at record offset `0x00`:

| Tag | Value | Payload consumed |
| --- | --- | --- |
| 0 | Nil | None. |
| 1 | False | None. |
| 2 | True | None. |
| 3 | Number | Eight-byte IEEE-754 binary64, little-endian, at `0x04`–`0x0b`. |
| 4 | String | Absolute ROM text byte address at `0x04`; text byte count at `0x08`, both u32 little-endian. |

Constant indices select records in table order. Tags 0–2 encode their value
without a payload; bytes `0x0c`–`0x0f` are unused. A record with another tag is
invalid and prevents program activation.

Both name tables use the same layout. Name record `i` begins at `tableAddress + 8i`:

| Record byte offset | Field |
| --- | --- |
| `0x00` | Absolute ROM text byte address, u32 little-endian. |
| `0x04` | Text byte count, u32 little-endian. |

Text lengths count **bytes**, not codepoints. Reads consume the specified span, not a NUL-terminated sequence. A zero byte within the span is part of the text. A zero byte count produces empty text without reading the address.

Constant text and names use complete, shortest-form UTF-8 encodings of Unicode
scalar values. Invalid leading or continuation bytes, truncated sequences,
overlong encodings, surrogate values D800H–DFFFH and values above 10FFFFH make
image activation fail. An initial `EF BB BF` encodes the ordinary character
U+FEFF; it is retained rather than removed as a byte-order marker. A string
beginning with U+FEFF therefore differs from the string without that character.

The two name tables establish separate ordinary-global and system-global
namespaces. Within each namespace an existing name retains its value and a new
name begins nil. A name-table index selects that name's slot; initial values
are established by executed instructions.

### Function and upvalue records {#sec-memory-function-and-upvalue-records}

A function address identifies a **32-byte function record**, not its first instruction. Record fields consumed below are unsigned 32-bit little-endian words:

| Record byte offset | Field | Interpretation |
| --- | --- | --- |
| `0x00` | Code address | Absolute machine byte address of the initial instruction. |
| `0x04` | Declared code byte count | Not read. |
| `0x08` | Parameter count | Number of fixed parameter slots. |
| `0x0c` | Maximum stack | Number of register-value slots, not bytes or a RAM address. |
| `0x10` | Flags | Bit 0 VARARG; bit 1 STATIC. |
| `0x14` | Upvalue-table address | Absolute machine byte address. |
| `0x18` | Upvalue count | Number of four-byte descriptors. |
| `0x1c` | Reserved | Not read. |

VARARG retains arguments beyond the fixed parameters. STATIC permits direct entry through EXEC; the closure-construction rules are described in [CPU — Closures and captured variables](cpu.md#sec-cpu-closures-and-captured-variables). The immediate-address form of `CLOSURE` encodes a function-record address in **16-byte units**; its register-address form supplies the full address. Function-record reads themselves do not impose a 16-byte alignment check. The declared code byte count does not bound instruction fetches.

Upvalue descriptor `i` is a four-byte unsigned little-endian word at
`upvalueTableAddress + 4i`. Bit 31 set captures a parent-frame register; bit 31
clear captures a parent-closure upvalue. Bits 0–30 contain the zero-based index.
Function and upvalue records use ordinary mapped-bus reads and may therefore
occupy mapped memory. Constant and name-table records and their text require ROM.

Function-record words are little-endian; [instruction words are big-endian](cpu.md#sec-cpu-instruction-words-and-execution-resources). Neither a function-record address nor a record's code address is relative to the image header.

## Locating BIOS call targets {#sec-blua-programs-locating-bios-call-targets}

The [published BIOS import names](blua-programs.md#sec-blua-programs-named-bios-function-imports)
bind to fixed, zero-based slots in the system
executable's function table. The ROM header at system address zero supplies
the executable's offset at `0x20`. Its executable header supplies the absolute
function-table address at offset `0x10`. Each function record occupies
32 bytes, so slot `s` has function-record address `table_address + 32*s`.
These addresses select function records, not their instruction bytes.

An independent linker resolves the published names through these fields and
slots. It uses that function-record address for a CLOSURE operand, with the
address divided by sixteen as specified in the
[instruction reference](cpu.md#sec-cpu-calls-closures-globals-and-tables).
Only the three published slots bind these named imports. Startup, vector and
preparation entry points are identified separately by their header fields;
other table positions do not themselves define additional BIOS interfaces.

The same lookup is available to a running program. This sequence calls slot
zero without a named import:

```lua
local image<const> = mem32le[0x20]
local function_table<const> = mem32le[image + 0x10]
local sin_turn32<const> = blua32.closure(function_table)
local sine = sin_turn32(0x40000000) -- 65536
```

Use the installed system ROM's own fields, rather than assuming a fixed
instruction address or substituting a record from the cartridge image.
For static RAM placement, the system executable's BSS address at `0x4c`
plus its padded byte count at `0x50` gives the first byte after firmware
static storage. The [executable-image reference](#sec-memory-blua32-executable-image) above
defines these section and record fields.
