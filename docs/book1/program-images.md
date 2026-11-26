# Program images and startup {#sec-program-images}

> WARNING! The behavior of program images and startup in BLua32 may not fully conform to the Lua standard due to implementation-specific details. Any deviations from the Lua standard should actually be regarded as bugs and not as intended features. Therefore, treat any non-standard behavior in this document as bugs and not as contracts, except for the extensions!

The ROM boot header identifies the console's entry functions and the BLua32
program header. The program header locates the constants, names and sections
used by the program. Each function has a separate record describing its code,
parameters, frame capacity and captured variables.

Startup establishes writable static contents before calling the application.
An ordinary function call, an EXEC transfer and a fresh startup therefore have
different effects. This chapter follows those effects from reset to cartridge
entry, then specifies the ROM records and BIOS call-target lookup.
[[Memory and bus access](memory.md#sec-memory)]{.content-visible when-format="html"}[Book I, Chapter 2]{.content-visible when-format="pdf"} supplies the physical
address map and the storage reservations that every placement must respect.

## Addresses used to enter a program {#sec-program-images-entry-addresses}

The boot header connects three kinds of information. The **program header**
describes the image shared by its functions. A **function record** describes
one callable function. That record's **code address** selects the instruction
bytes at which the function begins. Selecting the image establishes its
constant and name tables; entering a function establishes a frame and begins
fetching its instructions.

For example, consider these address fields in a cartridge's ROM. The chosen
record and code locations are illustrative; the field offsets are those
specified in the reference below.

| Read or calculation | Example value | Meaning |
|---|---|---|
| ROM base | `10000000H` | Start of the selected socket's ROM window |
| Word at ROM base + `20H` | `00000100H` | Program-header offset relative to ROM base |
| ROM base + program-header offset | `10000100H` | Absolute program-header address |
| Word at ROM base + `28H` | `10001230H` | Absolute startup-function-record address |
| Word at function record + `00H` | `10002000H` | Absolute initial instruction address |
| Word at program header + `14H` | `10000300H` | Absolute constant-table address |

For a startup record with STATIC set, EXEC receives `10001230H`, reads the
record and starts its code at `10002000H`. It does not add the program-header
address to either value. The constant table belongs to the selected image and
is located independently of the function's code. Its entries are selected by
constant indices in the instructions.

The same distinction applies to ordinary calls. CLOSURE constructs a callable
value from a function-record address, and CALL invokes that value with
arguments. EXEC instead replaces the active call chain. The
[CPU linkage examples](cpu.md#sec-cpu-linkage-operands-and-encoding-examples)
use the same `10001230H` record address to show the instruction encoding.

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
outside the reserved and firmware-owned spans specified in
[[reserved and firmware-owned spans](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)]{.content-visible when-format="html"}[Book I, §2.3]{.content-visible when-format="pdf"}, and describe the
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
| 4 | Call the program's entry function with no arguments. |

The DATA copy and BSS clear use four-byte word accesses over their complete
padded byte counts. System startup initializes the firmware sections; cartridge
startup initializes the cartridge program's sections.

EXEC starts the addressed function. DATA initialization and BSS clearing occur
only when the instructions performing them execute. Therefore the ROM startup
address must select the initialization routine when that initialization is
required. Entering another function leaves the sections as they stand.
Re-entering startup repeats the copy and clear, replacing the program's
writable static contents with their initial values.

## Reset and cartridge startup {#sec-memory-reset-and-cartridge-startup}

### From reset to the system program {#sec-memory-from-reset-to-the-system-program}

At reset the CPU selects system ROM, sets the language-heap floor from the
system image's static storage and enters the startup function specified in
its ROM header. The call stack and transient execution state are cleared,
there are no supplied arguments, and Status starts at `00000001H`: supervisor
mode with current interrupt enable set.

The firmware startup routine initializes system DATA and BSS, runs module
initializers, then enters the BIOS boot program. That program selects an
executable cartridge and performs the handoff described below.

### BIOS cartridge selection {#sec-memory-bios-cartridge-selection}

The BIOS scans cartridge slot 0 before slot 1, considering slots whose presence bits are set in the sampled cartridge-status word. For each candidate it selects that slot and checks:

- ROM magic is `58534D42H`;
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

Successful EXEC replaces the active call chain, selects the target image and
execution domain, and starts the selected static function with no arguments.
For a cartridge image, CPU Status has interrupt enable and user mode set
(bits 0 and 1) from that function's first instruction. This privilege change
occurs before the later application-entry call. The BIOS's zero IRQ-mask write
masks source delivery without clearing CPU interrupt enable. The full
[EXEC reference](cpu.md#sec-cpu-exec) specifies execution-state changes.

Before the startup function's first instruction, EXEC raises the language-heap
floor to the end of the cartridge's static storage. The BIOS has allocated its
own language data from the top of the heap, so the cartridge's DATA and BSS
are free of it. If a target's static storage would still cover heap storage in
use after a full collection, EXEC hard-halts before writing any of it; see the
[EXEC reference](cpu.md#sec-cpu-exec).

The selected cartridge startup routine performs the DATA copy, BSS clear,
module initialization and entry call described under
[When initialization occurs](#sec-memory-when-initialization-occurs). Those
instructions establish the cartridge's writable sections. Selecting another
static function enters that function directly, leaving DATA and BSS as they
stand; selecting startup again repeats initialization.

### Fresh system boot and execution transfer {#sec-blua-programs-fresh-system-boot-and-execution-transfer}

Fresh system boot clears both global-name banks, then installs the BIOS
environment before normal program entry. `EXEC` keeps the existing banks
and BIOS bindings while replacing execution. Initialize program-owned globals
explicitly when transferring between programs. See [CPU execution
control](cpu.md#sec-cpu-exec) for the complete transfer behavior.

### State at cartridge entry {#sec-memory-taking-ownership-after-the-bios}

At normal BIOS handoff, video timing is running and the display contains BIOS
drawing. Cartridge code may retain that display or establish its own drawing
and display configuration. Program each unit before use; its reset-value table
applies to reset, while its inherited boot state follows the rules here.
[[System timing](system.md#sec-system-system-time-and-frame-timing)]{.content-visible when-format="html"}[Book I, §12.3]{.content-visible when-format="pdf"} describes the live
readouts, and [CPU control](cpu.md#sec-cpu-cp0-and-execution-control) describes entry
privilege and interrupt enable.

The BIOS masks central IRQ delivery before handoff. Pending flags remain, and
CPU interrupt enable is set at cartridge entry. Before enabling a source,
install its handler and prepare the device: a previously pending source can
become deliverable immediately. Service the device's local condition and the
controller's pending bit separately. The complete dispatch and acknowledgement
sequence is given in
[[Book I, Interrupt controller](irq.md#sec-irq)]{.content-visible when-format="html"}[Book I, Chapter 3]{.content-visible when-format="pdf"}.

The firmware's VRAM region remains reserved after cartridge entry; see [[Reservation lifetime](memory.md#sec-memory-handoff-is-not-release)]{.content-visible when-format="html"}[Book I, §2.4.1]{.content-visible when-format="pdf"}. Later supervisor service preserves selected device context; overwritten VRAM pixels remain overwritten. Its boundaries are described in [[System control and timing — Device boundaries during supervisor service](system.md#sec-system-device-boundaries-during-supervisor-service)]{.content-visible when-format="html"}[Book I, §12.7]{.content-visible when-format="pdf"}.

INPUT likewise retains its BIOS sampling state at cartridge entry. Follow
[[BIOS handoff and supervisor sampling](input.md#sec-input-bios-handoff-and-supervisor-sampling)]{.content-visible when-format="html"}[Book I, §11.9.1]{.content-visible when-format="pdf"}
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
through offset `3BH`, for CPU program selection. All offsets in the following
table are byte offsets from that base. Header words are unsigned 32-bit
little-endian. The CPU uses the program and vector fields; BIOS also checks the
identification and startup fields when selecting a cartridge.

| Byte offset | Field | CPU program selection | BIOS cartridge selection |
| --- | --- | --- | --- |
| `00H` | Magic | Not read. | Requires `58534D42H`; bytes `42 4D 53 58` spell `BMSX`. |
| `04H` | Header size | Not read. | Requires at least 60 bytes. |
| `08H`–`1FH` | Other prefix words | Not read. | Not read. |
| `20H` | BLua32 image offset | Byte offset relative to the ROM base; zero means no executable image. | Requires a nonzero word. |
| `24H` | Declared image byte count | Not read. | Not read. |
| `28H` | Startup function | Absolute function-record address. | Requires a nonzero word; supplies the EXEC target unchanged. |
| `2CH` | IRQ function | Absolute function-record address. | Not read. |
| `30H` | Exception function | Absolute function-record address. | Not read. |
| `34H`, `38H` | Unused by the boot interface | Not read. | Not read. |

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

The boot interface assigns no interpretation to the unused prefix words.
Their contents do not select a program, change startup initialization or
establish a memory reservation.

The next ROM-header word, at byte offset `3CH`, is a ROM-relative offset to
optional BIOS diagnostic records; zero means absent. It is outside the CPU's
60-byte selection prefix. [BIOS diagnostics](bios-monitor.md#sec-memory-optional-bios-diagnostic-directory)
defines its source-location and frame-scope tables separately from executable
selection and instruction operation.

## BLua32 executable image {#sec-memory-blua32-executable-image}

The base BLua32 program header occupies **92 bytes** in ROM. Its offsets are
relative to the program-header address obtained above. The CPU uses these six unsigned
32-bit little-endian fields to establish the program's constants and name banks:

| Image byte offset | Field | Unit and interpretation |
| --- | --- | --- |
| `14H` | Constant-table address | Absolute machine byte address in installed ROM. |
| `18H` | Constant count | Number of 12-byte constant records. |
| `1CH` | Global-name-table address | Absolute machine byte address in installed ROM. |
| `20H` | Global-name count | Number of 4-byte name records. |
| `24H` | System-global-name-table address | Absolute machine byte address in installed ROM. |
| `28H` | System-global-name count | Number of 4-byte name records. |

The remaining header slots identify the program's format, sections and linkage:

| Image byte offset | Field |
| --- | --- |
| `00H` | Magic; declared constant `32334C42H`. |
| `04H`, `08H` | Image byte count; flags. |
| `0CH`, `10H` | Function-table address; function count. |
| `2CH`, `30H` | ROM String bucket-table address; bucket count. |
| `34H`, `38H` | RODATA address; RODATA byte count. |
| `3CH`, `40H`, `44H` | DATA load address; DATA byte count; DATA run address. |
| `48H`, `4CH` | BSS address; BSS byte count. |
| `50H`, `54H` | TEXT address; TEXT byte count. |
| `58H` | Preparation-sequence function-record address; zero when no sequence is present. |
| `5CH` | System ROM only, when flag bit 1 is set: absolute address of the private heap-service descriptor in RODATA. |

Provide the complete 92-byte header. A system image with flag bit 1 set
has a 96-byte header. Cartridge images leave bit 1 clear. The version 9
descriptor consists of 20 little-endian words: version, required Value-slot
count, required frame count, and seventeen absolute function-record addresses.
The descriptor is not part of the cartridge BIOS call table and does not
publish additional BIOS calls.

Reset and EXEC also read
the DATA byte count and run address (`40H`, `44H`) and the BSS address and
byte count (`48H`, `4CH`): the larger of the two section ends sets the
language-heap floor; see
[[Memory — Language heap](memory.md#sec-memory-language-heap)]{.content-visible when-format="html"}[Book I, §2.3.1]{.content-visible when-format="pdf"}.
DATA and BSS are initialized by the startup instructions.

With flag bit 0 clear, the image publishes a nonempty function directory.
The directory begins on a 16-byte boundary and its records are
32 bytes each. Both the directory and TEXT must fit in the installed ROM
of the same execution image. The TEXT address and size must be multiples
of four. Every record names a nonempty, word-aligned extent inside TEXT.
Different bodies cannot overlap; more than one record can name the same
complete body.

A body must contain complete instructions. In the function directory, a
WIDE prefix is part of its following instruction and the second word is
not a possible branch target. Each branch, sequential continuation and
comparison skip must reach an instruction in that body. A final RET,
RFE, unconditional branch or reserved-instruction trap does not require
a sequential continuation. A HALT that can resume upon an interrupt
does. The console rejects an image that violates these requirements
before entering it.

Set flag bit 0 for **mapped code**, when instruction flow is defined by
addresses in the executable bus regions rather than by function bodies.
A mapped-code image may omit its directory; a zero function count then
leaves the table address unused. If a directory is supplied it must fit
in ROM and its extents must fit in TEXT, but the extents do not limit
mapped instruction fetches.


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

The decoded constant bank and the combined name map must each fit in main
RAM. An image with a count that cannot fit either bank is rejected before
the banks are installed. The available language-allocation budget still
applies to valid sizes.

### Constant and name records {#sec-memory-constant-and-name-records}

Constant record `i` begins at `constantTableAddress + 12i`, with zero-based `i`. The tag is a four-byte unsigned little-endian word at record offset `00H`:

| Tag | Value | Payload consumed |
| --- | --- | --- |
| 0 | Nil | None. |
| 1 | False | None. |
| 2 | True | None. |
| 3 | Integer Number | Four-byte two's-complement integer, little-endian, at `04H`–`07H`. |
| 4 | String | Absolute ROM String record address at `04H`; `08H` is reserved. |
| 5 | Floating Number | Four-byte IEEE-754 binary32, little-endian, at `04H`–`07H`. |

Each constant record occupies 12 bytes. An Integer record preserves its signed
32-bit value. A Floating record preserves all 32 bits, including signed zero,
infinity and any NaN payload or sign. Loading either kind preserves its Number
subtype. For example, Integer `2` and Floating `2.0`
compare equal but have different subtypes.

Constant indices select records in table order. Tags 0–2 encode their value
without a payload. The word at `08H` is unused in Integer and Floating
records. String records use all three words. A record with another tag is
invalid and prevents program activation. An activated image's constant values
and kinds do not change while that image is resident. A replacement image
establishes its own constants. Arithmetic and the comparison of the
two Number subtypes are defined by the
[[CPU reference](cpu.md#sec-cpu-values-and-numeric-instructions)]{.content-visible when-format="html"}[CPU reference, Book II, Chapter 1]{.content-visible when-format="pdf"}.

Both name tables use the same layout. Name record `i` begins at
`tableAddress + 4i` and contains one absolute ROM String record address.
A constant and a name can both refer to the same record.

#### ROM String records {#sec-program-images-rom-string-records}

Each record begins at an eight-byte-aligned ROM address. Its bytes follow
the four little-endian words shown below.

| Record byte offset | Field |
| --- | --- |
| `00H` | Kind and ROM flag: `00010005H`. |
| `04H` | 32-bit FNV-1a hash of the payload bytes. |
| `08H` | Payload byte count, excluding the header and any following padding. |
| `0CH` | Absolute address of the next record in the same bucket, or zero. |
| `10H` | First payload byte. No terminator is required. |

String constants carry their bytes unchanged, including NUL and sequences that
are not valid UTF-8. Source text and spelled names normally use UTF-8. An empty
String still has a record: its payload byte count is zero.

The bucket table contains a power-of-two number of 32-bit record addresses.
An empty bucket contains zero. To compute a hash, start at `811C9DC5H`. For
each unsigned payload byte, XOR it into the hash and multiply by
`01000193H`, keeping the low 32 bits. The bucket index is the hash AND
the bucket count minus one. The chain contains each distinct byte sequence
in that bucket once.

A String value refers to one canonical record for its bytes. When constructing
a String or resolving a String constant or name during activation, the CPU
first looks for the same bytes in RAM, then in the system ROM index, then in
the indices of activated cartridge images in activation order. It allocates a
RAM record only if none matches. Consequently a cartridge can use one of its
own String constants to read a Table field originally stored under a String
with the same bytes in the system program.

The record reference retains the source socket. A record in cartridge
socket 1 uses bit 31 of the reference to identify that socket; the addresses
written in a cartridge image itself do not set this bit. The entire header
and the declared payload must be present in ROM before the CPU can resolve a
record to a String value. An incomplete record is invalid; absent bytes do
not extend the String. String record access uses ROM or language RAM directly,
not I/O or cartridge RAM.

The two name tables establish separate ordinary-global and system-global
namespaces. Within each namespace an existing name retains its value and a new
name begins nil. Activation installs the name-to-slot mapping in language RAM.
A name-table index selects that name's slot; initial values are established by
executed instructions.

### Function and upvalue records {#sec-memory-function-and-upvalue-records}

A function address identifies a **32-byte function record**, not its first instruction. Record fields consumed below are unsigned 32-bit little-endian words:

| Record byte offset | Field | Interpretation |
| --- | --- | --- |
| `00H` | Code address | Absolute machine byte address of the initial instruction. |
| `04H` | Code byte count | Extent of this function in TEXT for a published function directory. |
| `08H` | Parameter count | Number of fixed parameter slots. |
| `0CH` | Maximum stack | Number of register-value slots, not bytes or a RAM address. |
| `10H` | Flags | Bit 0 VARARG; bit 1 STATIC. |
| `14H` | Upvalue-table address | Absolute machine byte address. |
| `18H` | Upvalue count | Number of four-byte descriptors. |
| `1CH` | Reserved | Not read. |

VARARG retains arguments beyond the fixed parameters. STATIC permits direct entry through EXEC; the closure-construction rules are described in [CPU — Closures and captured variables](cpu.md#sec-cpu-closures-and-captured-variables). The immediate-address form of `CLOSURE` encodes a function-record address in **16-byte units**; its register-address form supplies the full address. Function-record reads themselves do not impose a 16-byte alignment check. In a mapped-code image the declared byte count is descriptive, not an instruction-fetch limit.

In an image with a published function directory, a ROM function address must
name a record in that directory. The addressed record's entry, frame layout and
upvalue information are fixed for the installed image. To change them, publish
the replacement image before continuing execution. A separately constructed
mapped function record can enter mapped code outside the ROM windows.

The code address names an instruction in an executable ROM or RAM window.
Instruction fetch does not access system I/O or cartridge MMIO; the CPU
[fetch rules](cpu.md#sec-memory-instruction-alignment-and-read-faults) define
the fault and its timing. This restriction does not apply to the mapped-bus
reads used to construct a closure from its function record.

The record is a prototype shared by closures of that function in the same
execution context. Each closure binds its own captures. A record must remain
stable while a closure uses it; give a coexisting definition a separate
record. Instructions remain in addressed memory and are fetched there when
the closure executes.

Upvalue descriptor `i` is a four-byte unsigned little-endian word at
`upvalueTableAddress + 4i`. Bit 31 set captures a parent-frame register; bit 31
clear captures a parent-closure upvalue. Bits 0–30 contain the zero-based index.
Function and upvalue records use ordinary mapped-bus reads and may therefore
occupy mapped memory. Constant and name-table records and their text require ROM.

Function-record and [instruction words are little-endian](cpu.md#sec-cpu-instruction-words-and-execution-resources). Neither a function-record address nor a record's code address is relative to the image header.

## Locating BIOS call targets {#sec-blua-programs-locating-bios-call-targets}

The [published BIOS import names](blua-programs.md#sec-blua-programs-named-bios-function-imports)
bind to fixed, zero-based slots in the system
executable's function table. The ROM header at system address zero supplies
the executable's offset at `20H`. Its executable header supplies the absolute
function-table address at offset `10H`. Each function record occupies
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
For static RAM placement, the system executable's BSS address at `4CH`
plus its padded byte count at `50H` gives the first byte after firmware
static storage. The [executable-image reference](#sec-memory-blua32-executable-image) above
defines these section and record fields.
