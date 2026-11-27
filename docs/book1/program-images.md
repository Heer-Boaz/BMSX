# Program images and startup {#sec-program-images}

> WARNING! The behavior of program images and startup in BLua32 may not fully conform to the Lua standard due to implementation-specific details. Any deviations from the Lua standard should actually be regarded as bugs and not as intended features. Therefore, treat any non-standard behavior in this document as bugs and not as contracts, except for the extensions!

A ROM holding a program begins with a **ROM header**. It gives the address of
the **program header** and of the startup, interrupt and exception functions.
The program header gives the addresses of the program's tables and sections:
functions, constants, names, code and data. Each function is described by a
**function record**.

This chapter describes the startup of the console from reset to the cartridge
program, then the formats of the headers and records. The address map is given
in [[Memory and bus access](memory.md#sec-memory)]{.content-visible when-format="html"}[Book I, Chapter 2]{.content-visible when-format="pdf"}.

## Entry addresses {#sec-program-images-entry-addresses}

A function is entered through its function record, not through its first
instruction. Example:

| Read | Value | Meaning |
|---|---|---|
| ROM base | `10000000H` | Cartridge ROM |
| Word at ROM base + `20H` | `00000100H` | Program-header offset |
| ROM base + offset | `10000100H` | Program-header address |
| Word at ROM base + `28H` | `10001230H` | Startup function record |
| Word at record + `00H` | `10002000H` | First instruction of the function |
| Word at program header + `14H` | `10000300H` | Constant table |

EXEC is given `10001230H`; it reads the record and starts the code at
`10002000H`. All these addresses are absolute. CLOSURE also takes a
function-record address; see the
[CPU linkage examples](cpu.md#sec-cpu-linkage-operands-and-encoding-examples).

When a cartridge program uses global names or String constants, the BIOS
prepares their bindings before entering the program. Reading one of its
function records with CLOSURE or EXEC does not prepare those bindings. If the
program needs bindings but they are not installed for that socket, the CPU
halts instead of entering the function or forming its closure.

## Sections {#sec-memory-rom-contents-ram-sections-and-startup}

| Section | In ROM | During execution |
|---|---|---|
| TEXT | Code | Executed from ROM |
| RODATA | Read-only data | Read from ROM |
| DATA | Initial values | Used in main RAM, after the startup routine has copied them |
| BSS | — | Used in main RAM, after the startup routine has cleared it |

DATA has a **load address** in ROM (the initial values) and a **run address**
in main RAM (the variables). Code uses the run address.

### Example {#sec-memory-follow-the-records-counter-and-output-storage}

The [record-copy example](blua-programs.md#sec-memory-worked-example-prepare-and-copy-two-records)
uses three objects of 12-byte records:

| Object | Section | ROM | RAM | Startup |
|---|---|---|---|---|
| `inputs`, two records | RODATA | 24 bytes | — | — |
| `counter`, one word | DATA | 4 bytes `78 56 34 12` | 4 bytes | Copies `12345678H` |
| `output`, two records | BSS | — | 24 bytes | Clears 24 bytes |

The program changes the RAM word; the initial value in ROM stays as it is.
Place the RAM sections outside the
[[reserved areas](memory.md#sec-memory-reserved-and-cartridge-storage-in-main-ram)]{.content-visible when-format="html"}[Book I, §2.3]{.content-visible when-format="pdf"}.

### Startup routine {#sec-memory-when-initialization-occurs}

The startup routine of a BLua program:

| Step | Operation |
|---|---|
| 1 | Copy DATA from its load address to its run address |
| 2 | Clear BSS |
| 3 | Initialize the modules |
| 4 | Call the entry function, without arguments |

DATA and BSS are copied and cleared in words, over their full padded size.
These are instructions of the program: EXEC of the startup function performs
them; EXEC of another function does not. Calling startup again restores the
initial values of DATA and BSS.

## Reset and startup {#sec-memory-reset-and-cartridge-startup}

### Reset {#sec-memory-from-reset-to-the-system-program}

At reset the CPU starts the function named by the System ROM header
in the [fixed reset bank](cpu.md#sec-cpu-cpu-reset-and-program-replacement).
The BIOS makes its DATA and BSS range available, prepares the System
program's global names and String operands, and selects the receiving
context with [`CONTEXT`](cpu.md#sec-cpu-context). The ordinary System
startup then initializes DATA and BSS, runs the modules and starts the
boot program. None of those section writes is an effect of reset itself.

### Cartridge selection {#sec-memory-bios-cartridge-selection}

The BIOS examines slot 0, then slot 1, if a cartridge is present. Its ROM must
contain at least 60 bytes. It is accepted if:

| Field | Required |
|---|---|
| Magic (`00H`) | `58534D42H` |
| Header size (`04H`) | At least 60 |
| Program offset (`20H`) | At least 60, word-aligned, and all 92 bytes of the program header fit in ROM |
| Startup function (`28H`) | Not 0 |

The boot screen is updated at each VBlank. The BIOS starts the cartridge when
one has been accepted and at least 50 frames of the boot screen have been
shown; the count restarts when the cartridge state changes (none, invalid,
ready). Before starting it, the BIOS clears the terminal status and masks all
interrupt sources.

At handoff the BIOS reads the selected cartridge's DATA run address and byte
count, and its BSS address and byte count. For sections that fit in RAM, it
rounds the larger exclusive end up to a 4 KiB boundary, using at least
`08040000H` even when the cartridge has no mapped sections. With system
reset inhibited, it makes the range available and writes
[`RAM_END`](cpu.md#sec-cpu-ram-end). The BIOS also prepares the selected
program's global-name and String operands while reset is inhibited.
If the range or operands cannot be prepared, the BIOS does not start the
cartridge. Otherwise it releases reset inhibition and writes the
startup-function address to [`EXEC`](cpu.md#sec-cpu-exec). EXEC uses those
operands; it does not prepare them.
The section contents are copied or cleared by the cartridge's own startup
instructions, not by either CP0 write.

### EXEC {#sec-memory-exec-and-cartridge-entry}

EXEC reads the function record; it must have the STATIC flag, otherwise the CPU
halts. EXEC clears the call stack, selects the program of the cartridge and
starts the function without arguments, in user mode with interrupts enabled
(Status bits 0 and 1).

The cartridge's startup routine then copies DATA, clears BSS, initializes the
modules and calls the entry function.

### Globals {#sec-blua-programs-fresh-system-boot-and-execution-transfer}

During startup the BIOS clears the global-name banks and installs its globals.
EXEC keeps the globals: a program started with EXEC finds the globals of the
previous program and should set its own.

### State at cartridge start {#sec-memory-taking-ownership-after-the-bios}

| Unit | State |
|---|---|
| Video | Running; the display shows the BIOS screen |
| IRQ | All sources masked; pending flags kept; CPU interrupts enabled |
| VRAM | The BIOS area stays reserved; see [[reservations](memory.md#sec-memory-handoff-is-not-release)]{.content-visible when-format="html"}[Book I, §2.4.1]{.content-visible when-format="pdf"} |
| INPUT | BIOS sampling state; see [[BIOS handoff](input.md#sec-input-bios-handoff-and-supervisor-sampling)]{.content-visible when-format="html"}[Book I, §11.9.1]{.content-visible when-format="pdf"} |

Set up each unit before use. Before unmasking an interrupt source, install the
handler and prepare the device: a flag that is already pending is delivered at
once. See [[Interrupt controller](irq.md#sec-irq)]{.content-visible when-format="html"}[Book I, Chapter 3]{.content-visible when-format="pdf"}
and [[Supervisor service](system.md#sec-system-device-boundaries-during-supervisor-service)]{.content-visible when-format="html"}[Book I, §12.7]{.content-visible when-format="pdf"}.
Frame timing: [[System timing](system.md#sec-system-system-time-and-frame-timing)]{.content-visible when-format="html"}[Book I, §12.3]{.content-visible when-format="pdf"}.

#### Device state {#sec-memory-firmware-work-at-normal-boot-handoff}

After the normal boot:

| Unit | State |
|---|---|
| DMA0, DMA1 | Idle |
| GPU | No BIOS command in progress; drawing may still be finishing |
| GEO | Idle |
| IMGDEC | Idle |
| APU | No BIOS sound playing; the APU clock runs |

Wait for the GPU to finish before changing what the BIOS screen uses. EXEC
does not change device registers.

## ROM header {#sec-memory-rom-header-fields}

At the ROM base, at least 60 bytes; 32-bit little-endian words:

| Offset | Field | Contents |
|---|---|---|
| `00H` | Magic | `58534D42H` (bytes `42 4D 53 58`, "BMSX") |
| `04H` | Header size | At least 60 |
| `08H`–`1FH` | — | Not used |
| `20H` | Program offset | Program-header address − ROM base; 0: no program |
| `24H` | Program size | Bytes |
| `28H` | Startup function | Function-record address |
| `2CH` | Interrupt function | Function-record address |
| `30H` | Exception function | Function-record address |
| `34H`, `38H` | — | Not used |
| `3CH` | Diagnostic records | Offset from ROM base; 0: none. See [BIOS diagnostics](bios-monitor.md#sec-memory-optional-bios-diagnostic-directory) |

| ROM | Base |
|---|---|
| System ROM | `00000000H` |
| Cartridge, either slot | `10000000H` |

The program-header address (base + offset, 32 bits) must lie in ROM. The
function addresses are absolute. The CPU uses `20H`–`30H`; the BIOS also checks
`00H`, `04H`, `20H` and `28H` before starting a cartridge.

## Program header {#sec-memory-blua32-executable-image}

92 bytes; 32-bit little-endian words; all addresses absolute.

| Offset | Field |
|---|---|
| `00H` | Magic `32334C42H` |
| `04H` | Program size |
| `08H` | Flags: bit 0 mapped code; bit 1 heap descriptor (System ROM) |
| `0CH`, `10H` | Function table: address, count |
| `14H`, `18H` | Constant table: address, count (12-byte records) |
| `1CH`, `20H` | Global names: address, count (4-byte records) |
| `24H`, `28H` | System global names: address, count (4-byte records) |
| `2CH`, `30H` | String hash table: address, number of buckets |
| `34H`, `38H` | RODATA: address, size |
| `3CH`, `40H`, `44H` | DATA: load address, size, run address |
| `48H`, `4CH` | BSS: address, size |
| `50H`, `54H` | TEXT: address, size |
| `58H` | Preparation function record; 0: none |
| `5CH` | Heap descriptor (System ROM, flag bit 1); header then 96 bytes |

Cartridge programs have flag bit 1 clear. The section fields tell the BIOS
which RAM range it must make available before cartridge startup. They do not
change the memory map when a function is entered.

**Function table.** With flag bit 0 clear, the program has a function table:
32-byte records, starting on a 16-byte boundary. TEXT address and size are
multiples of 4. Each record gives a code area in TEXT, word-aligned, holding
complete instructions; two functions may share the same area but may not
partly overlap. Every branch and every continuation must reach an instruction
of the same function; the last instruction is RET, RFE, an unconditional
branch or a trap (a HALT that can resume needs a following instruction). A
program that does not meet these rules is not started.

**Mapped code.** With flag bit 0 set, instructions are fetched by address
anywhere in executable memory. The function table may be empty; its code
sizes do not limit fetching.

**Preparation function.** An ordinary function that completes module
initialization and runs the `<init>` functions, without touching DATA or BSS
or calling the entry function. See
[`<init>`](blua-programs.md#sec-blua-programs-init-registers-a-participant-it-does-not-call-it-at-startup).

Tables and their Strings lie in ROM. A table with count 0 has no address. When
the program starts, its String constants and names are bound in main RAM; a
program for which there is no room is not started.

### Constants and names {#sec-memory-constant-and-name-records}

Constant i is the 12-byte record at table address + 12i:

| Tag (`00H`) | Value | `04H` | `08H` |
|---|---|---|---|
| 0 | nil | — | — |
| 1 | false | — | — |
| 2 | true | — | — |
| 3 | Integer | 32-bit value | — |
| 4 | String | String-record address | — |
| 5 | Float | 32-bit value | — |
| 6 | Built-in function (System ROM only) | Function number | — |

Integer 2 and Float 2.0 are different constants, although equal in value.
Float constants keep all their bits. An unknown tag or function number
prevents the program from starting.

Name i is the 4-byte word at table address + 4i: the address of a String
record. Names in the two tables are separate. A new name starts as nil; a name
that already exists keeps its value.

#### Strings {#sec-program-images-rom-string-records}

A String record starts on an 8-byte boundary:

| Offset | Field |
|---|---|
| `00H` | `00010005H` |
| `04H` | FNV-1a hash of the bytes |
| `08H` | Number of bytes |
| `0CH` | Next record in the same bucket; 0: last |
| `10H` | The bytes (no terminator) |

The hash table is a power-of-two number of record addresses (0: empty
bucket):

```text
hash = 811C9DC5H
for each byte: hash = (hash XOR byte) × 01000193H, low 32 bits
bucket = hash AND (number of buckets − 1)
```

Each String occurs once per program. Equal Strings in different programs are
the same String: a cartridge String finds a table field stored under the same
String by the BIOS. The whole record must lie in ROM.

### Function records {#sec-memory-function-and-upvalue-records}

32 bytes; 32-bit little-endian words:

| Offset | Field |
|---|---|
| `00H` | Code address (absolute) |
| `04H` | Code size in bytes |
| `08H` | Number of parameters |
| `0CH` | Number of registers |
| `10H` | Flags: bit 0 VARARG; bit 1 STATIC; bit 2 RESIDENT; bit 3 CODE (both System ROM) |
| `14H` | Capture table address |
| `18H` | Number of captures |
| `1CH` | Reserved |

| Flag | Meaning |
|---|---|
| VARARG | Extra arguments are kept |
| STATIC | The function can be started with EXEC |
| RESIDENT | System function on the system stack; STATIC, no varargs, no captures |
| CODE | STATIC System ROM function-table entry without captures; `CLOSURE` returns a code reference without allocating a closure, and `CALL` uses the ordinary stack |

Capture i is the word at capture-table address + 4i:

| Bit | Meaning |
|---|---|
| 31 = 1 | Register of the enclosing function |
| 31 = 0 | Capture of the enclosing closure |
| 30–0 | Number |

The code address must lie in executable ROM or RAM. Function and capture
records may lie in any memory; constant, name and String records must lie in
ROM. With a function table, a function address must be one of its records.
In CLOSURE with an immediate address, the address is given in 16-byte units.
See [closures](cpu.md#sec-cpu-closures-and-captured-variables) and the
[instruction format](cpu.md#sec-cpu-instruction-words-and-execution-resources).

## BIOS functions {#sec-blua-programs-locating-bios-call-targets}

The [BIOS functions](blua-programs.md#sec-blua-programs-named-bios-function-imports)
are records at fixed positions in the function table of System ROM. Record s is
at:

```text
function table = word at (word at 00000020H) + 10H
record s       = function table + 32 × s
```

A linker places this address, divided by 16, in a CLOSURE instruction; see the
[instruction reference](cpu.md#sec-cpu-calls-closures-globals-and-tables). A
program can also find it while running:

```lua
local image<const> = mem32le[0x20]
local function_table<const> = mem32le[image + 0x10]
local sin_turn32<const> = blua32.closure(function_table)
local sine = sin_turn32(0x40000000) -- 65536
```

The end of the BIOS's static storage is the BSS address (`48H`) plus the BSS
size (`4CH`) of the System ROM program header.
