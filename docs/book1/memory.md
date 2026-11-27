# Memory and bus access {#sec-memory}

The CPU addresses system ROM, main RAM, the cartridges and the device
registers through one 32-bit byte address space. GPU video memory (VRAM) and
APU sample RAM are not in this address space: the GPU and the APU reach them
through their own commands and transfer ports.

This chapter gives the memory map, the areas of main RAM reserved for the
system, the rules for reading and writing memory and registers, and the
bus-fault registers. Book II describes how a program image is loaded into
memory and started.

## Addresses and data sizes {#sec-memory-addresses-and-data-sizes}

Addresses are 32-bit byte addresses, `00000000H` to `FFFFFFFFH`. A word is
four bytes. Halfwords and words are stored little-endian: the least
significant byte is at the lowest address.

1 KiB is 1024 bytes and 1 MiB is 1,048,576 bytes. A range written
`[start, end)` includes `start` and ends at `end − 1`.

## Memory map {#sec-memory-installed-memory-and-address-windows}

| Area | Start | End (exclusive) | Size |
|---|---|---|---|
| System ROM | `00000000H` | `01000000H` | 16 MiB area |
| — | `01000000H` | `08000000H` | Unused |
| Main RAM | `08000000H` | `10000000H` | 128 MiB area, 4 MiB fitted |
| Cartridge ROM | `10000000H` | `30000000H` | 512 MiB area |
| Cartridge RAM | `30000000H` | `30F00000H` | 15 MiB area |
| Cartridge I/O | `30F00000H` | `31000000H` | 1 MiB area |
| — | `31000000H` | `100000000H` | Unused |

The sizes are those of the address areas. The fitted memory is smaller: the
console has 4 MiB of main RAM at `08000000H`–`083FFFFFH`, and the amount of ROM
and RAM on a cartridge depends on the cartridge. Addresses `08400000H` to
`0FFFFFFFH` contain no memory.

Separate from the address space:

| Memory | Size | Access |
|---|---|---|
| VRAM | 2 MiB | GPU commands; see the [GPU chapter](gpu.md#sec-gpu) |
| APU sample RAM | 512 KiB | APU transfer port; see [sample RAM transfer](apu.md#sec-apu-sample-ram-transfer) |

## Main RAM {#sec-memory-reserved-and-cartridge-storage-in-main-ram}

Main RAM is divided as follows:

| Use | Start | End (exclusive) | Size |
|---|---|---|---|
| I/O area | `08000000H` | `08040000H` | 256 KiB |
| System DATA and BSS | `08040000H` | End of system BSS | Set by the BIOS |
| Program DATA and BSS | Chosen by the program | End of program BSS | Set by the program |
| Private storage | `RAM_END` | `083FC000H` | Not mapped on the system bus |
| System work area | `083FC000H` | `08400000H` | 16 KiB; not mapped on the system bus |

The device registers occupy the first 66,632 bytes of the I/O area, up to
`08010447H`. The rest of the I/O area is reserved: do not use it for program
data.

DATA holds variables with initial values, copied from ROM at startup. BSS
holds variables that start as zero. The BIOS's own DATA and BSS begin at
`08040000H`; their length depends on the BIOS version. A program normally
places its DATA directly after the end of the system BSS, and its BSS directly
after its DATA. The program image records the addresses used; see
[[Program images and startup](program-images.md#sec-memory-blua32-executable-image)]{.content-visible when-format="html"}[Book II, §11.5]{.content-visible when-format="pdf"}.

### Main RAM on the system bus {#sec-memory-language-heap}

Main RAM is installed up to `08400000H`, but only the range from `08040000H`
up to `RAM_END` is available as ordinary RAM on the system bus. The I/O
reservation below that range is separate. The firmware can change the end
in 4 KiB units up to `083FC000H` using
[[CP0 RAM_END](cpu.md#sec-cpu-ram-end)]{.content-visible when-format="html"}[Book II, §12.13.1]{.content-visible when-format="pdf"}.
The last 16 KiB of installed RAM are always outside the ordinary range. The
BIOS uses private RAM for language values and other work.

At power-on `RAM_END` is `08040000H`; a system reset leaves it unchanged.
Moving the boundary changes access to the bytes, not their contents. Ordinary
fetch, load, store and DMA addresses from `RAM_END` up to `08400000H`
are unmapped (UNMAPPED).
Place program sections and device buffers within the mapped range.

### Reset bank {#sec-memory-reset-bank}

The fixed reset bank uses the following ranges in the system work area.

| Use | Start | End (exclusive) | Capacity |
|---|---:|---:|---|
| Frame backing | `083FC880H` | `083FCDC0H` | 24 frames, 56 bytes each |
| Value backing | `083FD000H` | `083FD780H` | 384 slots, 5 bytes each |
| Context record | `083FD880H` | `083FD8D0H` | 80 bytes |

While supervisor code executes in the reset bank, CPU data loads and stores
can also access private RAM from `RAM_END` to `08400000H`. Instruction fetch
and DMA do not gain this access. Leaving the reset bank through
[[CP0 CONTEXT](cpu.md#sec-cpu-context)]{.content-visible when-format="html"}[Book II, §12.13.1]{.content-visible when-format="pdf"}
ends this access.

## VRAM used by the BIOS {#sec-memory-firmware-reservation-in-vram}

VRAM is arranged as 1024 rows of 1024 16-bit words (2048 bytes per row). The
BIOS keeps its terminal screen and its character set in one rectangle of
VRAM. Do not draw in this rectangle or place images there.

### Duration of the reservation {#sec-memory-handoff-is-not-release}

The rectangle stays reserved while the program runs, even when the terminal
is not displayed. The BIOS monitor draws there when it is entered. Leaving the
monitor does not restore VRAM contents the program has overwritten; see
[device boundaries during supervisor service](system.md#sec-system-device-boundaries-during-supervisor-service).

### Reading the rectangle {#sec-memory-query-the-firmware-reservation}

The BIOS function `gpu/system_vram_region` returns the rectangle as two
words. The first holds x in bits 15–0 and y in bits 31–16; the second holds
the width in bits 15–0 and the height in bits 31–16. X and width are counted in
16-bit words, y and height in rows.

```lua
local system_vram_region<const> = require('gpu/system_vram_region')
local system_origin<const>, system_size<const> = system_vram_region()
local x<const> = system_origin & 0x0000ffff
local y<const> = system_origin >> 16
local width<const> = system_size & 0x0000ffff
local height<const> = system_size >> 16
```

The position of the rectangle can differ between BIOS versions. Always use
the value returned by the BIOS. The function can also be located through the
[[BIOS call-target lookup](program-images.md#sec-blua-programs-locating-bios-call-targets)]{.content-visible when-format="html"}[Book II, §11.6]{.content-visible when-format="pdf"}.

### Example {#sec-memory-current-firmware-example}

With a 320 × 240 terminal at (704, 720) and a 216 × 12 character set at
(768, 960), the function returns x = 704, y = 720, width = 320 and
height = 252: origin word `02D002C0H`, size word `00FC0140H`.

## Program storage for device buffers {#sec-memory-addressed-buffers-and-program-storage}

The DMA controller, GEO and the other devices take their data from addresses
in RAM or ROM. Put device buffers in the program's DATA or BSS, with the
layout and alignment the device requires. Language values such as tables and
strings have no bus address and cannot be used as device buffers.

How to declare buffers and address them from BLua is described in the
[[BLua storage reference](blua-programs.md#sec-blua-programs-typed-storage-layouts-and-address-views)]{.content-visible when-format="html"}[Book II, §2.2]{.content-visible when-format="pdf"},
with an example in
[[worked record copy](blua-programs.md#sec-memory-worked-example-prepare-and-copy-two-records)]{.content-visible when-format="html"}[Book II, §2.3.1]{.content-visible when-format="pdf"}.
Startup is described in
[[Program images and startup](program-images.md#sec-program-images)]{.content-visible when-format="html"}[Book II, Chapter 11]{.content-visible when-format="pdf"}.

## I/O register map {#sec-memory-io-register-bank-directory}

The device registers are 32-bit words at `08000000H`–`08010447H`.

### Lower registers {#sec-memory-lower-register-banks-and-reserved-slots}

| Start | End (exclusive) | Words | Registers |
|---|---|---|---|
| `08000000H` | `0800000CH` | 3 | [IRQ](irq.md#sec-irq-register-reference) |
| `0800000CH` | `08000024H` | 6 | [DMA](dma.md#sec-dma-register-reference) channel 0 |
| `08000024H` | `08000064H` | 16 | [GEO](geo.md#sec-geo-register-reference) |
| `08000064H` | `08000120H` | 47 | [Input](input.md#sec-input-register-map) |
| `08000120H` | `08000204H` | 57 | [APU](apu.md#sec-apu-register-reference) |
| `08000204H` | `080101F4H` | 16380 | Reserved |
| `080101F4H` | `08010200H` | 3 | [ROM sizes](#sec-memory-fitted-rom-byte-counts) |
| `08010200H` | `08010208H` | 2 | Reserved |

### Upper registers {#sec-memory-upper-register-banks}

| Start | End (exclusive) | Words | Registers |
|---|---|---|---|
| `08010208H` | `08010218H` | 4 | [Bus fault](#sec-memory-bus-fault-status-and-cpu-exceptions) |
| `08010218H` | `08010224H` | 3 | [APU](apu.md#sec-apu-register-reference) fault |
| `08010224H` | `08010228H` | 1 | [GEO](geo.md#sec-geo-register-reference) fault acknowledge |
| `08010228H` | `08010230H` | 2 | [System timer](system.md#sec-system-system-time-and-frame-timing) |
| `08010230H` | `08010238H` | 2 | [Diagnostic output](system.md#sec-system-diagnostic-text-output) |
| `08010238H` | `0801023CH` | 1 | [Cycles per frame](system.md#sec-system-system-time-and-frame-timing) |
| `0801023CH` | `08010244H` | 2 | [GPU](gpu.md#sec-gpu-gp0-gpuread-gp1-and-gpustat) GP0/GPUREAD, GP1/GPUSTAT |
| `08010244H` | `080102C4H` | 32 | [GTE](gte.md#sec-gte-register-reference) data registers |
| `080102C4H` | `08010344H` | 32 | [GTE](gte.md#sec-gte-register-reference) control registers |
| `08010344H` | `0801034CH` | 2 | [GTE](gte.md#sec-gte-normal-command-and-cycles) COMMAND, CYCLES |
| `0801034CH` | `08010354H` | 2 | [System](system.md#sec-system) CONTROL, STATUS |
| `08010354H` | `08010384H` | 12 | [PCRTC](pcrtc.md#sec-pcrtc) display |
| `08010384H` | `080103ACH` | 10 | [GTE PLUS](gte.md#sec-gte-register-reference) |
| `080103ACH` | `080103E4H` | 14 | [PCRTC](pcrtc.md#sec-pcrtc) timing and events |
| `080103E4H` | `080103FCH` | 6 | [DMA](dma.md#sec-dma-register-reference) channel 1 |
| `080103FCH` | `08010420H` | 9 | [Image decoder](imgdec.md#sec-imgdec-register-reference) |
| `08010420H` | `08010428H` | 2 | [[Cartridge controller](../book3/cartridge.md#sec-cartridge-cartridge-controller)]{.content-visible when-format="html"}[Book III, §1.3]{.content-visible when-format="pdf"} slot select and status |
| `08010428H` | `08010440H` | 6 | [System fault report](system.md#sec-system-supervisor-fault-registers) |
| `08010440H` | `08010448H` | 2 | [[Cartridge controller](../book3/cartridge.md#sec-cartridge-cartridge-controller)]{.content-visible when-format="html"}[Book III, §1.3]{.content-visible when-format="pdf"} cartridge memory sizes |

### ROM sizes {#sec-memory-fitted-rom-byte-counts}

| Address | Register | Contents |
|---|---|---|
| `080101F4H` | SYS_ROM_BYTE_COUNT | Size of the system ROM in bytes |
| `080101F8H` | CART0_ROM_BYTE_COUNT | Size of the ROM in cartridge slot 0 in bytes |
| `080101FCH` | CART1_ROM_BYTE_COUNT | Size of the ROM in cartridge slot 1 in bytes |

The registers are read-only. A value of 0 means that no ROM is fitted; the
cartridge controller's status tells whether a slot is empty or holds a
cartridge without ROM. Before reading data from ROM at offset O with length L,
check that O + L does not exceed the size. Reading these registers does not
change the selected cartridge.

### Reserved words {#sec-memory-reserved-retained-words-and-decoder-boundary}

The reserved words in the register map read back the value last written and
are 0 after reset. They have no function. Do not use them as program storage.

## Reading and writing memory {#sec-memory-scalar-memory-accesses}

### Access widths {#sec-memory-width-and-alignment}

| Access | Kind | Width | Alignment |
|---|---:|---:|---:|
| Word | 0 | 4 bytes | 4 |
| U8 | 1 | 1 byte | 1 |
| U16 | 2 | 2 bytes | 2 |
| U32 | 3 | 4 bytes | 4 |
| F32 | 4 | 4 bytes | 4 |
| F64 | 5 | 8 bytes | 4 |

A load or store at a misaligned address causes an address-error exception
(load or store) and does not access memory.

### System ROM {#sec-memory-system-rom-data-accesses}

Reads beyond the end of the system ROM cause a bus fault (UNMAPPED). Writes to
the system ROM area also cause a bus fault (UNMAPPED) and leave the ROM
unchanged.

### Device registers {#sec-memory-io-widths-and-read-side-effects}

Access device registers with aligned 32-bit words.

| Access | Result |
|---|---|
| Word, U32 or F32 | One register read or write |
| U8 read at a register address | Reads the register and returns bits 7–0 |
| Any other U8 access, any U16 access | Bus fault (UNALIGNED_IO) |
| F64 | Two register accesses: the low word at A, then the high word at A + 4 |

An 8-bit read is a full register read. Where reading a register has an effect,
such as taking a word from a FIFO, the 8-bit read has the same effect.

A write to a register that is not ready to accept data, such as a full FIFO,
waits until the register accepts it.

### Eight-byte accesses {#sec-memory-eight-byte-accesses-and-partial-completion}

F64 is performed as two word accesses, low word first. If the first word
causes a bus fault, the second is not accessed. If the second word causes a
fault, the first word has already been written.

### Invalid addresses

A read from an address without memory or registers returns 0 and causes a bus
fault (UNMAPPED). A write to such an address has no effect and causes the same
fault. For a CPU load, the exception occurs before the destination register is
written.

## Bus faults {#sec-memory-bus-fault-status-and-cpu-exceptions}

When an access fails, the bus-fault registers record the code, the address
and the type of the access. They hold the first fault until the program
clears them; later faults do not overwrite it.

### Registers {#sec-memory-register-reference}

| Address | Register | Access | Contents |
|---|---|---|---|
| `08010208H` | `IO_SYS_BUS_FAULT_CODE` | R | Fault code |
| `0801020CH` | `IO_SYS_BUS_FAULT_ADDR` | R | Address of the access |
| `08010210H` | `IO_SYS_BUS_FAULT_ACCESS` | R | Type of the access |
| `08010214H` | `IO_SYS_BUS_FAULT_ACK` | W (reads 0) | Any value other than 0 clears the record |

: {tbl-colwidths="[16,32,16,36]"}

All four registers are 0 after reset. Writing to CODE, ADDR or ACCESS causes a
READ_ONLY fault.

### Fault codes {#sec-memory-code-values}

| Code | Name | Cause |
|---|---|---|
| `00000000H` | `BUS_FAULT_NONE` | No fault recorded |
| `00000001H` | `BUS_FAULT_UNMAPPED` | No memory or register at the address |
| `00000002H` | `BUS_FAULT_UNALIGNED_IO` | Wrong access width for a device register |
| `00000003H` | `BUS_FAULT_READ_ONLY` | Write to a read-only register |

### Access type {#sec-memory-access-flags}

ACCESS is the OR of one direction bit and one width bit.

| Bit | Value | Name |
|---:|---|---|
| 0 | `00000001H` | `BUS_FAULT_ACCESS_READ` |
| 1 | `00000002H` | `BUS_FAULT_ACCESS_WRITE` |
| 8 | `00000100H` | `BUS_FAULT_ACCESS_U8` |
| 9 | `00000200H` | `BUS_FAULT_ACCESS_U16` |
| 10 | `00000400H` | `BUS_FAULT_ACCESS_U32` |
| 11 | `00000800H` | `BUS_FAULT_ACCESS_WORD` |
| 12 | `00001000H` | `BUS_FAULT_ACCESS_F32` |
| 13 | `00002000H` | `BUS_FAULT_ACCESS_F64` |

For example, a failed U32 write gives ACCESS = `00000402H`.

### Clearing the record {#sec-memory-capture-subsequent-faults-and-acknowledgment}

Read CODE, ADDR and ACCESS, then write a value other than 0 to ACK. This sets
all three registers to 0. Writing 0 to ACK has no effect.

### CPU exception {#sec-memory-synchronous-cpu-exception-entry}

A bus fault during a CPU load or store causes a DataBusError exception, also
when an older fault is still recorded. A bus fault during a DMA or device
access is only recorded; it causes no exception.

| Condition | Exception code | Cause register bits 6–2 |
|---|---:|---|
| Misaligned load | 4 | `00000010H` |
| Misaligned store | 5 | `00000014H` |
| Bus fault | 7 | `0000001CH` |

## Examining a fault {#sec-memory-inspecting-a-memory-fault}

When a program stops on a bus fault, the BIOS monitor shows the recorded
fault and the instruction that caused it. See
[[BIOS diagnostics](bios-monitor.md#sec-memory-installed-response-to-a-memory-exception)]{.content-visible when-format="html"}[Book II, §10.2]{.content-visible when-format="pdf"}.

## DMA buffers {#sec-memory-dma-buffer-lifetime}

DMA reads its source while it transfers. Keep the source unchanged until
DONE, and use the destination only after DONE. When a COPY destination
overlaps the source at a higher address, the copy repeats the first words: see
[using the source and the result](dma.md#sec-dma-source-reuse-and-result-use).

### Checking a transfer for bus faults {#sec-memory-attribute-a-bus-fault-before-start}

The bus-fault record does not say which device or channel caused the fault.
To check one transfer:

1. Save any fault that is already recorded, then write 1 to ACK.
2. Start the transfer and wait for DONE.
3. Read CODE. If it is not 0, the fault occurred during the transfer, provided
   no other part of the program accessed memory in the meantime.

## Device buffers {#sec-memory-device-specific-buffer-lifetimes}

Most devices read their input from memory while they work. Keep the input
unchanged until the device reports that the operation is complete.

| Device | Input | Complete when | Reference |
|---|---|---|---|
| DMA | Source buffer | DONE | [DMA](dma.md#sec-dma-source-reuse-and-result-use) |
| GEO | Descriptors, records | DONE (check ERROR) | [GEO](geo.md#sec-geo-launching-and-observing-a-job) |
| GTE PLUS | Operand registers | Taken at COMMAND | [GTE](gte.md#sec-gte-vmad3-timed-vector-multiply-add-through-plus) |
| Image decoder | Compressed data | Input DMA DONE | [Image decoder](imgdec.md#sec-imgdec) |
| APU | Sample data in sample RAM or ROM | Every voice using it has ended | [APU](apu.md#sec-apu-voice-sources-and-their-lifetime) |
| GPU | Command lists, VRAM images | GPU marker or idle | [GPU](gpu.md#sec-memory-shared-gpu-storage-and-display-publication) |

### GEO {#sec-memory-geo-addressed-buffer-lifetime}

GEO reads its records during the job. Leave them unchanged, and read the
results only when DONE is set and ERROR is clear.

### GTE PLUS {#sec-memory-gte-plus-operand-register-lifetime}

GTE PLUS takes its operands from its registers when the command is written.
The operand registers may be loaded for the next command at once.

### Image decoder {#sec-memory-imgdec-input-and-output-have-separate-lifetimes}

The decoder copies its input into a FIFO. The input buffer may be reused when
the DMA transfer that supplies it is DONE.

### APU {#sec-memory-apu-sample-storage-and-lifetime}

Voices play from sample RAM or from ROM, not from main RAM. A main-RAM buffer
used to upload samples may be reused when the upload DMA is DONE; wait for
TRANSFER_BUSY in APU STATUS to clear before playing the uploaded samples.
Sample data in sample RAM may be replaced only when every voice and queued
PLAY command using it has ended.

## VRAM and the display {#sec-memory-graphics-storage-and-display}

Drawing surfaces, textures, palettes and the displayed picture all lie in
VRAM. An area of VRAM may be reused only when no drawing command uses it and
it is not being displayed. The [GPU chapter](gpu.md#sec-memory-shared-gpu-storage-and-display-publication)
describes the order of drawing and display, and the [PCRTC chapter](pcrtc.md#sec-pcrtc)
describes when a new display picture takes effect.
