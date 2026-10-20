# Memory and bus access {#sec-memory}

The CPU uses one byte-addressed map for system ROM, main RAM, cartridge storage
and device registers. Main RAM holds writable program data and transfer
buffers. ROM supplies read-only bytes. Device registers provide word ports
whose reads and writes can consume results, change configuration or start work.

GPU local memory and APU sample RAM have separate access paths. Use GPU image
and readback commands for local memory, and APU transfer ports for sample RAM.
A program's storage layout must account for which bytes are installed, which
are reserved, and which operations still use a buffer. This chapter defines the
address map, reservations, mapped-access rules and bus-fault reporting. Book II
specifies program-image records, initialization and BIOS startup.

## Addresses and data sizes {#sec-memory-addresses-and-data-sizes}

BMSX uses 32-bit unsigned byte addresses. Each address identifies one byte; the address space runs from `0x00000000` through `0xffffffff`, inclusive. A 32-bit word occupies four consecutive bytes. For 16-bit and 32-bit values in main RAM, byte order is little-endian: the least significant byte is at the lowest address.

All capacities in this section are byte counts: 1 KiB is 1024 bytes and 1 MiB is 1048576 bytes. A range written `[start, end)` includes `start` but excludes `end`; its last byte is at `end - 1`. The tables use inclusive starts and exclusive ends. `0x100000000` denotes the exclusive end of the address space, not an address that a program can supply.

## Installed memory and address windows {#sec-memory-installed-memory-and-address-windows}

BMSX has **4 MiB of main RAM**, occupying `[0x08000000, 0x08400000)` before I/O mapping and reservation restrictions; its last byte is `0x083fffff`. The main-RAM address window is larger than the installed memory. Similarly, the system-ROM window is an address-space allocation, not the byte length of the installed firmware. Cartridge windows describe the cartridge bus, not how much ROM or RAM a cartridge contains.

| Address-space region | Start, inclusive | End, exclusive | Window size or status |
|---|---|---|---|
| System ROM | `0x00000000` | `0x01000000` | 16 MiB window; firmware image length is separate |
| Unmapped gap | `0x01000000` | `0x08000000` | No mapped storage |
| Main RAM | `0x08000000` | `0x10000000` | 128 MiB window; 4 MiB installed at its beginning |
| Cartridge ROM | `0x10000000` | `0x30000000` | 512 MiB window; installed media capacity is not specified by this window |
| Cartridge RAM | `0x30000000` | `0x30f00000` | 15 MiB window; does not imply 15 MiB is present |
| Cartridge MMIO | `0x30f00000` | `0x31000000` | 1 MiB window |
| Unmapped upper range | `0x31000000` | `0x100000000` | Outside the cartridge bus and other declared windows |

The cartridge bus begins at `0x10000000` and ends just before `0x31000000`; the system's main-RAM window ends at that cartridge-bus start. Within the main-RAM window, `[0x08400000, 0x10000000)` has no installed main RAM. It is not an extension or mirror of the installed 4 MiB.

GPU VRAM is a separate **2 MiB** capacity and is not included in the 4 MiB main-RAM total.

The APU's **512 KiB sample RAM** also has a separate access path. A main-RAM
buffer can supply an upload, but playback reads the resulting sample-RAM bytes
through the APU's private source address. The upload buffer and the playback
source therefore have different addresses and lifetimes. See
[APU — Voice sources and their lifetime](apu.md#sec-apu-voice-sources-and-their-lifetime)
and [Sample RAM transfer](apu.md#sec-apu-sample-ram-transfer).

## Reserved and cartridge storage in main RAM {#sec-memory-reserved-and-cartridge-storage-in-main-ram}

The installed main RAM occupies `0x08000000` through `0x083fffff`, a total of 4 MiB. This is a physical storage extent, not a cartridge allocation range. It includes the I/O reservation, GEO scratch storage, and the system's static storage as well as the cartridge program's static storage.

Static storage includes DATA, whose initial bytes are copied from ROM, and
BSS, which startup initializes to zero. Both use assigned main-RAM addresses.
The firmware and the cartridge each have their own occupied sections.

Subtracting the 256 KiB I/O reservation and 512 KiB GEO scratch reservation
leaves **3.25 MiB** in `[0x080c0000, 0x08400000)` before accounting for system
and cartridge static storage. The installed firmware occupies the beginning
of this span. Its actual DATA/BSS footprint, rather than 3.25 MiB alone,
determines where cartridge placement can begin.

The following ranges use an exclusive end: the end address is the first byte outside the range.

| Use | Start | Exclusive end | Size |
|---|---|---|---|
| Declared I/O reservation | `0x08000000` | `0x08040000` | 256 KiB |
| GEO scratch reservation | `0x08040000` | `0x080c0000` | 512 KiB |
| System static storage | `0x080c0000` | Actual end of system BSS | Specified by the system executable image |
| Cartridge static storage, compact layout below | Actual end of system BSS | Actual end of cartridge BSS | Specified by the cartridge executable image |

The decoded I/O register aperture ends at `0x08010440`, before the end of the declared I/O reservation. This smaller aperture does not make the remainder of the reservation available for cartridge variables or buffers. Likewise, the GEO scratch reservation is not cartridge static storage.

`0x080c0000` is the start of **system DATA**, not a universal cartridge RAM base.
The installed firmware's BSS follows its DATA. Account for their actual occupied
extent in the matching BIOS image, rather than assuming a fixed cartridge base.
The image's declared BSS address and byte count identify that span; their sum
is its exclusive end. These fields describe occupied storage; selecting an image does not itself
allocate or clear that storage.

The following compact layout places cartridge DATA at the system BSS end and
cartridge BSS immediately after that DATA. This adjacency is a layout choice,
**not a hardware requirement**. Another cartridge placement can use different
unreserved RAM addresses; its records, code and startup initialization must all
use that chosen placement without overwriting firmware storage.

| Section in the compact layout, in address order | Run address |
|---|---|
| System DATA | `0x080c0000` |
| System BSS | End of system DATA |
| Cartridge DATA | Actual end of system BSS |
| Cartridge BSS | End of cartridge DATA |

Each end in this table is exclusive and includes the section's alignment padding.

The cartridge's writable static objects belong to its DATA and BSS sections.
The program image records their actual RAM addresses and extents; see
[[Program images and startup](program-images.md#sec-memory-blua32-executable-image)]{.content-visible when-format="html"}[Book II, “Program images and startup”, under “BLua32 executable image”]{.content-visible when-format="pdf"}
in Book II. Those sections must fit the installed RAM without overlapping
reserved storage.

Choosing a static layout is not a hardware allocation service. Neither the
installed RAM extent nor the end of cartridge BSS defines a free arena, stack
reservation, or byte-addressed heap. Use the actual installed system image
when calculating firmware occupancy.

## Firmware reservation in VRAM {#sec-memory-firmware-reservation-in-vram}

The 2 MiB VRAM is shared GPU storage, arranged as 1024 rows of 1024 **16-bit words**. Each row spans 2048 bytes. A drawing destination, texture source or display source selects storage within that same memory; it does not create a separate CPU byte-address allocation.

The firmware uses VRAM both for the full terminal drawing surface and for its system texture atlas, which supplies terminal glyphs. Preserve the **bounding rectangle covering both**, rather than reserve only the currently visible text or the atlas alone. This VRAM reservation is separate from the I/O, GEO scratch and static-storage reservations in main RAM.

### Handoff is not release {#sec-memory-handoff-is-not-release}

Clearing terminal text or status, or selecting a smaller active terminal viewport, does not shrink the queried full-layout reservation. Cartridge handoff does not release it either. The BIOS monitor later uses the same terminal coordinates and uploads the system atlas again before drawing its output.

Keep the complete queried region out of cartridge allocations. The query does not install hardware write protection or grant permission to overwrite that region, and it does not establish that every coordinate outside it is free.

For the limits of later device-context restoration, see [System control and timing — Device boundaries during supervisor service](system.md#sec-system-device-boundaries-during-supervisor-service). Restoring device context does not restore overwritten VRAM pixels.

### Query the firmware reservation {#sec-memory-query-the-firmware-reservation}

The named BIOS function `gpu/system_vram_region` takes no arguments and returns
two packed words describing the installed firmware's VRAM rectangle.

The first return word contains x in its low half and y in its high half. The second contains width and height, not right and bottom coordinates. The returned rectangle is `[x, x + width) × [y, y + height)`.

Here x and width count **16-bit VRAM words** across a row; y and height count
**rows**. Reserve that rectangle in the cartridge's VRAM layout. The query
reports the terminal and atlas extent; uploading and synchronizing those bytes
remain separate operations.

Use the named import below, or resolve its function-record address through the
[[published BIOS call-target lookup](program-images.md#sec-blua-programs-locating-bios-call-targets)]{.content-visible when-format="html"}[Book II, “Program images and startup”, under “Locating BIOS call targets”]{.content-visible when-format="pdf"}
in Book II. Do not hard-code an address from another firmware image.

```lua
local system_vram_region<const> = require('gpu/system_vram_region')
local system_origin<const>, system_size<const> = system_vram_region()
local x<const> = system_origin & 0x0000ffff
local y<const> = system_origin >> 16
local width<const> = system_size & 0x0000ffff
local height<const> = system_size >> 16
```

### Firmware-layout example {#sec-memory-current-firmware-example}

For the installed BIOS terminal layout and system atlas, the rectangles are:

| Use | x range, in 16-bit words | y range, in rows |
|---|---|---|
| Full terminal, 320 × 240 | `[704, 1024)` | `[720, 960)` |
| Actual system atlas, 216 × 12 | `[768, 984)` | `[960, 972)` |
| Returned bounding rectangle, 320 × 252 | `[704, 1024)` | `[720, 972)` |

For those dimensions, the returned origin word is `0x02d002c0` and the size word is `0x00fc0140`. These numbers illustrate the query result, not universal constants for cartridge code. Use the rectangle returned by the installed BIOS.

The 320 × 252 bounding rectangle covers 80640 16-bit words, or 161280 bytes of storage footprint. Its row stride is nevertheless **1024 words**, or 2048 bytes: it is a rectangle within VRAM, not a contiguous CPU byte-address allocation. The bounding rectangle also includes space outside the exact terminal-plus-atlas union; the query does not identify internal holes for reuse.

## Addressed buffers and program storage {#sec-memory-addressed-buffers-and-program-storage}

A device buffer is an addressed range of bytes. A language Table, String or
function value is not such a range, and the CPU's function-local value slots
do not provide a cartridge-addressable byte stack. Use storage with the
layout and alignment required by the receiving unit.

Book II's [[BLua storage reference](blua-programs.md#sec-blua-programs-typed-storage-layouts-and-address-views)]{.content-visible when-format="html"}[Book II, “BLua source programs and extensions”, under “Typed storage, layouts, and address views”]{.content-visible when-format="pdf"}
defines declarations, typed views and record indexing. Its
[[worked record copy](blua-programs.md#sec-memory-worked-example-prepare-and-copy-two-records)]{.content-visible when-format="html"}[Book II, “BLua source programs and extensions”, under “Worked example: prepare and copy two records”]{.content-visible when-format="pdf"}
connects those declarations to the resulting bytes. The rules below govern the
accesses that reach the memory map.

Program initialization is a separate operation from storage placement. The
startup sequence copies DATA initializers from ROM and clears BSS before
entering application code. [[Program images and startup](program-images.md#sec-program-images)]{.content-visible when-format="html"}[Book II, “Program images and startup”]{.content-visible when-format="pdf"}
defines that sequence, the ROM records and the BIOS handoff. Reserve firmware
storage regardless of the cartridge's chosen initialization routine.

## I/O register-bank directory {#sec-memory-io-register-bank-directory}

The I/O-slot aperture contains 16656 four-byte slots: 66624 bytes in
`[0x08000000, 0x08010440)`. The reservation and allocation boundaries above
remain separate from that decoded aperture.

The following directory covers the complete I/O aperture in address order. Each word position occupies four bytes; its address is the first byte of that word. The end column is exclusive. Counts include status, snapshot and result words as well as control words: they are **addressed word positions**, not counts of independently writable registers. Access permissions, read side effects, command admission and reset values belong to the individual register descriptions linked in the last column, not to a whole directory range.

### Lower register banks and reserved slots {#sec-memory-lower-register-banks-and-reserved-slots}

| First word address | Exclusive end | 32-bit word positions | Unit and subbank |
|---|---|---|---|
| `0x08000000` | `0x0800000c` | 3 | [IRQ](irq.md#sec-irq-register-reference) — pending flags, acknowledgement and mask |
| `0x0800000c` | `0x08000024` | 6 | [DMA](dma.md#sec-dma-register-reference) — channel 0 |
| `0x08000024` | `0x08000064` | 16 | [GEO](geo.md#sec-geo-register-reference) — operands, command, control, progress and fault |
| `0x08000064` | `0x08000120` | 47 | [Input](input.md#sec-input-register-map) — sampling, keyboard, pointer, four pads and output port |
| `0x08000120` | `0x08000174` | 21 | [APU](apu.md#sec-apu-register-reference) — command-staging parameters |
| `0x08000174` | `0x0800017c` | 2 | [APU](apu.md#sec-apu-register-reference) — CMD and STATUS |
| `0x0800017c` | `0x0800018c` | 4 | [APU](apu.md#sec-apu-register-reference) — retained end-event words |
| `0x0800018c` | `0x08000194` | 2 | [APU](apu.md#sec-apu-register-reference) — selected source and active-slot mask |
| `0x08000194` | `0x080001e8` | 21 | [APU](apu.md#sec-apu-register-reference) — live selected-slot parameter window |
| `0x080001e8` | `0x080001f4` | 3 | [APU](apu.md#sec-apu-register-reference) — sample-transfer address, data and control |
| `0x080001f4` | `0x08000200` | 3 | [APU](apu.md#sec-apu-register-reference) — command-queue occupancy, free space and capacity |
| `0x08000200` | `0x08000204` | 1 | [APU](apu.md#sec-apu-register-reference) — sample sequence |
| `0x08000204` | `0x08000208` | 1 | Reserved retained word |
| `0x08000208` | `0x08010208` | 16384 | Reserved retained-slot range |

### Upper register banks {#sec-memory-upper-register-banks}

| First word address | Exclusive end | 32-bit word positions | Unit and subbank |
|---|---|---|---|
| `0x08010208` | `0x08010218` | 4 | [Memory bus fault](#sec-memory-bus-fault-status-and-cpu-exceptions) — code, address, access and acknowledgement |
| `0x08010218` | `0x08010224` | 3 | [APU](apu.md#sec-apu-register-reference) — fault code, detail and acknowledgement |
| `0x08010224` | `0x08010228` | 1 | [GEO](geo.md#sec-geo-register-reference) — fault acknowledgement |
| `0x08010228` | `0x08010230` | 2 | [SYSTEM](system.md#sec-system-system-time-and-frame-timing) — elapsed milliseconds and frame interval |
| `0x08010230` | `0x08010238` | 2 | [SYSTEM](system.md#sec-system-diagnostic-text-output) — diagnostic character and line flush |
| `0x08010238` | `0x0801023c` | 1 | [SYSTEM](system.md#sec-system-system-time-and-frame-timing) — cycles per frame |
| `0x0801023c` | `0x08010244` | 2 | [GPU](gpu.md#sec-gpu-gp0-gpuread-gp1-and-gpustat) — GP0/GPUREAD and GP1/GPUSTAT |
| `0x08010244` | `0x080102c4` | 32 | [GTE](gte.md#sec-gte-register-reference) — data words D[0]–D[31] |
| `0x080102c4` | `0x08010344` | 32 | [GTE](gte.md#sec-gte-register-reference) — control words C[0]–C[31] |
| `0x08010344` | `0x0801034c` | 2 | [GTE](gte.md#sec-gte-normal-command-and-cycles) — normal COMMAND and CYCLES |
| `0x0801034c` | `0x08010354` | 2 | [SYSTEM](system.md#sec-system) — CONTROL and STATUS |
| `0x08010354` | `0x08010384` | 12 | [PCRTC](pcrtc.md#sec-pcrtc) — composition words, PMODE through BGCOLOR |
| `0x08010384` | `0x080103ac` | 10 | [GTE PLUS](gte.md#sec-gte-register-reference) — operands, results, flags, command and cycles |
| `0x080103ac` | `0x080103e4` | 14 | [PCRTC](pcrtc.md#sec-pcrtc) — beam timing, CSR events and IMR masks |
| `0x080103e4` | `0x080103fc` | 6 | [DMA](dma.md#sec-dma-register-reference) — channel 1 |
| `0x080103fc` | `0x08010420` | 9 | [IMGDEC](imgdec.md#sec-imgdec-register-reference) — configuration, status, data and progress |
| `0x08010420` | `0x08010428` | 2 | [[Cartridge controller](../book3/cartridge.md#sec-cartridge-cartridge-controller)]{.content-visible when-format="html"}[Book III, “Cartridge sockets and mapped card devices”, under “Cartridge controller”]{.content-visible when-format="pdf"} — socket selection and status |
| `0x08010428` | `0x08010440` | 6 | [SYSTEM](system.md#sec-system-supervisor-fault-registers) — retained supervisor fault report |

These ranges partition all 16656 word positions without gaps or overlaps. A unit need not occupy one contiguous bank: DMA channel 1 is separate from channel 0; GEO and APU have separate upper fault-acknowledgement banks; GTE PLUS separates PCRTC's composition and timing banks; and SYSTEM has timing, diagnostic, control and fault-report banks. The reserved retained slots are part of the decoded aperture, not an additional device or a payload-transfer protocol.

### Reserved retained words and decoder boundary {#sec-memory-reserved-retained-words-and-decoder-boundary}

Of the 16656 positions, **16385 are reserved retained words** in
`[0x08000204, 0x08010208)`. An aligned word read returns the stored raw word;
an accepted aligned word write replaces it. These words reset to zero and have
no command, FIFO, automatic address increment or transfer-completion behavior.
They remain reserved: retention does not make them cartridge RAM or grant a
scratch-buffer allocation. Do not apply this read/write description to other
directory rows; their unit-specific permissions and side effects still apply.

I/O decoding and the I/O reservation have different limits. Addresses in
`[0x08010440, 0x08040000)` reach installed main-RAM bytes rather than register
slots, but remain within the reserved 256 KiB. They are not additional
registers or newly available cartridge storage.

For byte, halfword and word bus transfers, the **complete transfer** must fit
inside the decoded I/O aperture for its I/O width rules to apply. A transfer
crossing that end accesses main RAM for its complete width; it is not split
between a final register and RAM. These examples describe mapped-bus transfers,
not permission to bypass ordinary CPU instruction alignment:

| Mapped transfer | Selected path |
|---|---|
| U32 at `0x0801043c` | Last complete I/O slot: supervisor fault DOMAIN |
| U32 at `0x0801043e` | Four main-RAM bytes spanning the decoder boundary |
| U16 at `0x0801043f` | Two main-RAM bytes spanning the decoder boundary |
| U32 at `0x08010440` | Main RAM within the reservation |

Ordinary CPU U16 and U32 instructions reject the two unaligned examples before
reaching the mapped bus. The [scalar-access rules](#sec-memory-scalar-memory-accesses)
separate that CPU alignment check from I/O decoding. F64 instead consists of
two word transfers: an aligned F64 access at `0x0801043c` reaches the last I/O
slot first and RAM at `0x08010440` second, subject to the ordered fault rules.

## Scalar memory accesses {#sec-memory-scalar-memory-accesses}

The rules in this section apply to ordinary scalar `LOAD_MEM` and `STORE_MEM` instructions with the access kinds listed below. Addresses are unsigned 32-bit byte addresses. I/O registers occupy four-byte slots.

### Width and alignment {#sec-memory-width-and-alignment}

| Access kind | Kind ID | Width | Required address alignment |
|---|---:|---:|---:|
| Word | 0 | 4 bytes | 4 bytes |
| U8 | 1 | 1 byte | 1 byte |
| U16LE | 2 | 2 bytes | 2 bytes |
| U32LE | 3 | 4 bytes | 4 bytes |
| F32LE | 4 | 4 bytes | 4 bytes |
| F64LE | 5 | 8 bytes | **4 bytes**, not 8 |

The CPU checks alignment before making the mapped access. A misaligned ordinary load enters a synchronous address-error-load exception; a misaligned ordinary store enters a synchronous address-error-store exception. For stores, this check also precedes the write-readiness check. Thus an ordinary misaligned U32 access raises an address error before it can reach any I/O width or slot-alignment check.

### System-ROM data accesses {#sec-memory-system-rom-data-accesses}

The declared system-ROM window is `0x00000000` through `0x00ffffff` (16 MiB). When the full width of a mapped scalar read fits this window, bytes beyond the installed ROM image are returned as zero. A U16 or U32 read that straddles the installed image's end is zero-filled only for its missing bytes.

Scalar writes to the system-ROM window report `BUS_FAULT_UNMAPPED` and leave ROM unchanged. They do not report `BUS_FAULT_READ_ONLY`. The CPU alignment check precedes these mapped-access rules. These are system-ROM data-access rules, not cartridge-ROM or instruction-fetch rules.

### I/O widths and read side effects {#sec-memory-io-widths-and-read-side-effects}

The following I/O rules concern accesses whose entire byte range lies inside the I/O aperture, after the CPU alignment check has passed. They do not define accesses that cross the aperture's end.

| Access | I/O behavior |
|---|---|
| U8 read at a four-byte-aligned slot address | Reads the complete slot, then returns its low eight bits. |
| U8 read at another byte address | Reports `BUS_FAULT_UNALIGNED_IO`; the slot is not read. |
| U8 write, including at a slot-aligned address | Reports `BUS_FAULT_UNALIGNED_IO`; the slot is not written. |
| U16 read or write | Reports `BUS_FAULT_UNALIGNED_IO`; the slot is not accessed. |
| Aligned Word or U32 access | Uses the complete four-byte slot, subject to that register's access rules. |
| Aligned F32 access | Uses the U32 access path and reinterprets one word, with the F32 access flag. It is not a separate floating-point register protocol. |
| Aligned F64 access | Performs two ordered four-byte accesses as described below, with the F64 access flag on each. |

A byte read is therefore not necessarily a side-effect-free way to inspect part of a register. If reading a slot has side effects, an aligned U8 read performs the complete slot read and its side effects before selecting the low eight bits. Byte and halfword writes are not substitutes for word writes to I/O commands.

### Eight-byte accesses and partial completion {#sec-memory-eight-byte-accesses-and-partial-completion}

An F64 access first accesses the low word at the starting address, then the high word at that address plus four. A new fault on the first word stops the access before the second word is attempted. A fault on the second word reports that second byte address, unless an older pending fault already occupies the fault latch.

These two accesses are not an atomic eight-byte transaction. If an F64 store successfully writes the low word and then faults on the high word, the low-word write is not undone. An F64 read returns zero at the mapped-access level if either word faults; the ordinary CPU load does not commit that zero to its destination register.

An aligned store waits if its addressed port is not ready. No write occurs
until the port accepts it; waiting does not itself report a bus fault.

An unmapped scalar access reports `BUS_FAULT_UNMAPPED`. The unmapped U8, U16 and U32 read paths return zero, while the unmapped write paths perform no target write. Rejected I/O U8 and U16 reads likewise return zero. These returned zeros are not successful results of faulting ordinary CPU loads: the CPU exception check described below occurs before the destination register is assigned.

## Bus-fault status and CPU exceptions {#sec-memory-bus-fault-status-and-cpu-exceptions}

The bus-fault latch records the first pending fault. Its retained status and the CPU's response to a new fault are separate mechanisms: a later fault can cause a synchronous CPU exception without replacing the older recorded fault.

### Register reference {#sec-memory-register-reference}

These four registers use byte addresses. The access labels describe aligned Word/U32 accesses; they do not grant byte or halfword writes.

| Byte address | Register | Word access and contents | System reset / ACK value |
|---|---|---|---|
| `0x08010208` | `IO_SYS_BUS_FAULT_CODE` | Read-only. Numerical code of the first pending fault. | `0x00000000` (`BUS_FAULT_NONE`) |
| `0x0801020c` | `IO_SYS_BUS_FAULT_ADDR` | Read-only. Byte address supplied by the first pending fault. | `0x00000000` |
| `0x08010210` | `IO_SYS_BUS_FAULT_ACCESS` | Read-only. Access flags supplied by the first pending fault. | `0x00000000` |
| `0x08010214` | `IO_SYS_BUS_FAULT_ACK` | Reads as zero. A zero word write does not acknowledge; **any nonzero word write** clears the latch. | `0x00000000` |

: {tbl-colwidths="[16,28,34,22]"}

System reset and a nonzero ACK clear all three report words. CODE, ADDR and
ACCESS each retain a complete 32-bit word: CODE is an enumerated code, ADDR is a
byte address and ACCESS is a flags word.

Reading the status registers does not acknowledge a fault. An aligned Word/U32 write to CODE, ADDR or ACCESS reports `BUS_FAULT_READ_ONLY` before writing the destination slot. If no fault is already pending, that rejected write becomes the pending fault, recording its destination address and write access flags. Otherwise, the older recorded fault remains.

### CODE values {#sec-memory-code-values}

| Name | Word value | Meaning |
|---|---|---|
| `BUS_FAULT_NONE` | `0x00000000` | No pending fault. |
| `BUS_FAULT_UNMAPPED` | `0x00000001` | Unmapped access. |
| `BUS_FAULT_UNALIGNED_IO` | `0x00000002` | Rejected I/O width or slot alignment, as specified above. |
| `BUS_FAULT_READ_ONLY` | `0x00000003` | Rejected write to a read-only register. |

### ACCESS flags {#sec-memory-access-flags}

The ACCESS word combines a direction flag with an access-kind flag by bitwise OR.

| Direction flag | Bit | Mask |
|---|---:|---|
| `BUS_FAULT_ACCESS_READ` | 0 | `0x00000001` |
| `BUS_FAULT_ACCESS_WRITE` | 1 | `0x00000002` |

| Access-kind flag | Bit | Mask | Read ACCESS word | Write ACCESS word |
|---|---:|---|---|---|
| `BUS_FAULT_ACCESS_U8` | 8 | `0x00000100` | `0x00000101` | `0x00000102` |
| `BUS_FAULT_ACCESS_U16` | 9 | `0x00000200` | `0x00000201` | `0x00000202` |
| `BUS_FAULT_ACCESS_U32` | 10 | `0x00000400` | `0x00000401` | `0x00000402` |
| `BUS_FAULT_ACCESS_WORD` | 11 | `0x00000800` | `0x00000801` | `0x00000802` |
| `BUS_FAULT_ACCESS_F32` | 12 | `0x00001000` | `0x00001001` | `0x00001002` |
| `BUS_FAULT_ACCESS_F64` | 13 | `0x00002000` | `0x00002001` | `0x00002002` |

: {tbl-colwidths="[30,6,20,22,22]"}

Word and U32 have different ACCESS flags even though both access four bytes. These flags are also distinct from the kind IDs in the scalar-access table.

### Capture, subsequent faults and acknowledgment {#sec-memory-capture-subsequent-faults-and-acknowledgment}

The first fault immediately records CODE, ADDR and ACCESS. These words retain
that fault until acknowledgement, including when later accesses fault.

An aligned nonzero word write to ACK clears CODE to BUS_FAULT_NONE and clears
ADDR and ACCESS. ACK reads zero. Any nonzero value performs the clear; a zero
write leaves the report unchanged. Read and save a required report before
acknowledging it.

### Synchronous CPU exception entry {#sec-memory-synchronous-cpu-exception-entry}

A new fault during a CPU scalar load enters DataBusError before the destination
register is written. A new fault during a ready CPU scalar store enters the
same exception; any earlier effects of a multiword access remain.

Each new CPU bus fault enters this exception even when an older report still
occupies CODE/ADDR/ACCESS. A pending report by itself leaves successful accesses
unaffected. Device-master faults update the report without vectoring the CPU.
Clearing the report acknowledges those diagnostics; exception return is a
separate CPU operation.

The CPU cause-code field occupies bits 6:2, selected by `CPU_CAUSE_CODE_MASK = 0x0000007c`.

| Ordinary-access condition | CPU cause code | Encoded cause-field value |
|---|---:|---|
| Misaligned load | 4 | `0x00000010` |
| Misaligned store | 5 | `0x00000014` |
| New bus fault during the mapped access | 7 | `0x0000001c` |

These CPU cause codes are not the values 1–3 in `IO_SYS_BUS_FAULT_CODE`. They are not IRQ bits either: IRQ and NMI are independently represented by bits 10 and 16. Acknowledging the fault record and entering a CPU exception are distinct operations.

## Inspecting a memory fault {#sec-memory-inspecting-a-memory-fault}

Read CODE, ADDR and ACCESS before acknowledging a bus-fault report. These words
identify the failed mapped access. A CPU exception and the BIOS's saved fault
report are separate from this retained record.

The BIOS monitor can inspect these words and, when a suitable live binding is
available, repair an operand before retrying the stopped instruction. See
[[BIOS diagnostics](bios-monitor.md#sec-memory-installed-response-to-a-memory-exception)]{.content-visible when-format="html"}[Book II, “BIOS diagnostics”, under “Memory faults and the monitor”]{.content-visible when-format="pdf"}
in Book II for the complete inspection and repair sequence. Acknowledging the
bus-fault record alone neither changes the operand nor resumes the program.

## DMA buffer lifetime {#sec-memory-dma-buffer-lifetime}

DMA uses byte addresses but counts transfers in **32-bit words**. Starting a transfer does not copy its source into a private payload buffer. Source storage, destination storage and the channel's programmed words therefore have different lifetimes. The rules below describe aligned copies within installed main RAM and the stated DMA-to-GPU example, not every hardware buffer.

### Attribute a bus fault before START {#sec-memory-attribute-a-bus-fault-before-start}

The shared record contains CODE (`0x08010208`), ADDR (`0x0801020c`) and ACCESS (`0x08010210`); ACCESS identifies direction and access kind, not a channel or bus master. Read them with aligned Word/U32 MMIO accesses from ordinary cartridge code, not privileged CP0 accesses; reads do not acknowledge them.

To associate the report with one transfer, first arrange exclusive reporting
for that interval: other DMA work, CPU accesses, interrupt handlers and BIOS
service must neither introduce a bus fault nor acknowledge one. The report has
no channel or bus-master identifier.

**Before START**, read CODE and preserve any older nonzero report's CODE/ADDR/ACCESS in owned storage. Write aligned Word/U32 `1` to ACK (`0x08010214`), then read CODE to establish a zero baseline. Start the prepared operation and wait for its real completion predicate. Read CODE again; if nonzero, preserve CODE/ADDR/ACCESS before another ACK. Under the stated assumption, this is the first reported fault since clearing and belongs to the assessed operation.

If the old report must remain latched, preserve it in place and treat later
transfer faults as unattributed: the report cannot record another fault until
cleared. Also check the destination unit's status, since a device can refuse an
unready port write without raising a bus fault.

### Prepare, start, wait, check, reuse {#sec-memory-prepare-start-wait-check-reuse}

1. **Prepare the storage.** Fill the source and reserve sufficient destination
   bytes at known program-storage addresses. Use nonoverlapping ranges for an
   ordinary copy. A count of 20 transfers 20 words, or 80 bytes. Keep the source
   stable through its last DMA read and wait for the final destination write
   before consuming the completed buffer.

2. **Program an idle channel completely.** Set its read address, write address, count, increment choices, request selectors and block length before START. An increment advances its address by four bytes per word; a fixed address advances by zero. The programmed block-length field specifies 1 through 16 words, and the last block uses only the remaining count. Both selected requests must be asserted before a block is admitted. `FORCE` is always asserted; `DISABLED` is never asserted. For a device port, choose its real request selectors rather than use FORCE to send words while the port is not ready.

3. **Start once and preserve the live inputs.** An accepted START with a nonzero count sets BUSY; START while BUSY is ignored, not queued as a second transfer. A zero count finishes immediately, before testing requests. Admission retains one block's addresses, remaining count, control and length, but not its source words. Each source word is read and written to the destination before proceeding to the next word. Bytes changed after START can therefore affect later reads; START is not a source-buffer snapshot.

   Leave the channel's programmed address/count/control words alone through completion. Writes to those words are not automatically rejected while BUSY: an already admitted block uses its captured configuration, and its later address/count writeback can overwrite changes made meanwhile. Reprogramming a busy channel is not a way to revise that admitted block safely.

4. **Wait for completion, then check the outcome.** Finish follows the final mapped transfer accesses, replaces channel status with DONE (`2`), and clears BUSY by that replacement. It also raises the channel's DMA interrupt. Wait for channel status or service its completion IRQ rather than assuming a transfer delay.

   Check the fault report using the procedure above. DMA advances after a
   faulting access: an unmapped source can supply zero, and an unmapped or
   read-only destination can reject the write. An unready I/O write can also be
   discarded without retry. Use the correct device requests and verify the
   destination's applicable completion/status condition.

5. **Reuse according to the completed operation.** Once DMA has finished its source reads, that transfer no longer needs the source bytes; once its final RAM writes have completed, the RAM destination can be inspected as the completed transfer's output. A receiving device may still have work to do. DMA transport completion does not establish GPU-job completion or permission to reuse a live display surface.

### Overlap is not a buffered move {#sec-memory-overlap-is-not-a-buffered-move}

Within installed RAM, each DMA word is read before its destination is written, and that write precedes the next read. There is no block-sized source snapshot or special overlap-copy behavior. For example, start with RAM words `[1, 2, 3, 4, 5]` and copy a four-word block from *base* to *base + 4*, with both addresses incrementing. The access order produces `[1, 1, 1, 1, 1]`: each write changes the next source word before it is read.

### DMA programming example {#sec-memory-dma-programming-example}

The [DMA chapter's BLua sequence](dma.md#sec-dma-copy-words-in-blua) prepares 20 source words and performs two nonoverlapping RAM copies using declared storage addresses. It programs both channels before either START and uses 16-word and four-word blocks. The two completed destination copies retain the words to inspect.

The DMA chapter's [GP0 sequence](dma.md#sec-dma-send-a-command-stream-to-gp0)
sends a five-word ROM stream, waits for DMA DONE,
then separately waits for a GPU marker and GPU idle. These are distinct
completion conditions; the order of software reads does not establish a
universal ordering of DMA and device completion.

## Device-specific buffer lifetimes {#sec-memory-device-specific-buffer-lifetimes}

### GEO addressed-buffer lifetime {#sec-memory-geo-addressed-buffer-lifetime}

GEO captures a job's configuration, not its source data. Prepare the buffers before launch, keep them stable during work, and check the terminal state before consuming output or reusing storage. Follow the [GEO launch procedure](geo.md#sec-geo-launching-and-observing-a-job) for operation-specific programming and observation.

1. **Prepare the job.** Wait for a nonbusy unit, then populate the descriptors
   and source records and reserve separate output buffers. XFORM2 vertex and
   AABB destinations must occupy writable RAM outside reserved storage. Program
   SRC0, SRC1, SRC2, DST0, DST1, COUNT, PARAM0, PARAM1 and all three strides
   before writing CMD.

2. **Know what launch captures.** An accepted, supported nonzero command captures those register words, without reading source bytes. With nonzero `COUNT`, GEO becomes `BUSY` and begins the job. `OVERLAP2D_PASS` writes its summary at launch, before the count test; even a zero-count launch is not necessarily free of buffer writes. Never submit `CMD` while `BUSY`: it neither waits nor queues. It discards the running job, rejects the new command, resets `PROCESSED` to zero, publishes `REJECTED` with `REJECT_BUSY`, and raises the ERROR interrupt.

3. **Preserve live inputs.** GEO reads its addressed records and payloads during
   the job. Changing these bytes after `CMD` can change work still in progress.
   A valid empty `XFORM2_BATCH` record with `flags = 0` and `vertexCount = 0`
   succeeds without reading a matrix or vertices. Leave inputs and outputs
   unmodified until work stops; separate outputs do not establish arbitrary
   in-place or aliasing safety.

4. **Check the actual terminal state.** `PROCESSED` advances after successful records. Successful completion latches `DONE` without a fault and raises the DONE interrupt. An execution fault stops the job, retains the completed-record count, latches `DONE|ERROR` and `FAULT`, and raises ERROR. `DONE` alone does not prove whole-batch success: inspect `ERROR`, `FAULT`, and `PROCESSED`.

5. **Classify output before reuse.** Faults do not roll back issued writes. Completed-record counts do not describe every retained partial write or launch-time summary. `ERROR` or `REJECTED` suppresses later commands until local fault acknowledgement. Any nonzero `FAULT_ACK` clears `ERROR`, `REJECTED`, and `FAULT`, preserving `DONE`, `BUSY`, and `PROCESSED`; it does not resume discarded work. This local acknowledgement is distinct from interrupt acknowledgement. Use the [completion/fault procedure](geo.md#sec-geo-completion-faults-and-recovery) before consuming results or reusing buffers.

### GTE PLUS operand-register lifetime {#sec-memory-gte-plus-operand-register-lifetime}

GTE PLUS uses an operand/result register bank, not a main-RAM source-address and length interface. Its five writable operand words are `ADD_XY`, `ADD_Z`, `MUL_XY`, `MUL_Z`, and `SCALAR`. This differs from an addressed RAM payload whose contents may be read as work progresses.

An accepted, supported `VMAD3` command captures the current operand words.
Later writes to those five operand registers replace their register contents,
but do not change the operation in progress. They can prepare operands for
subsequent work; they do not submit another command. Until completion, result
reads still see the previously published values. XY, Z, and flag results publish
together at completion, when `BUSY` clears.

Submit `COMMAND` through the CPU. CPU command submission is interlocked while a command remains pending, rather than starting overlapping work. DMA cannot issue PLUS `COMMAND`. Follow [GTE timed VMAD3](gte.md#sec-gte-vmad3-timed-vector-multiply-add-through-plus) for the command sequence and completion procedure; do not substitute a guessed delay for completion observation.

### IMGDEC input and output have separate lifetimes {#sec-memory-imgdec-input-and-output-have-separate-lifetimes}

IMGDEC accepts supplied stream words through DATA, not a cartridge source-buffer pointer. An admitted CPU DATA write copies that word into its input storage; the decoder does not retain the original CPU-visible storage location. Texture and CLUT destination words become output command headers, not addresses that IMGDEC itself dereferences.

DMA programming and block admission capture addresses, not the source contents. Keep the source words unchanged until their last DMA read, including repeated reads from a fixed source address. For a whole buffer with no other reader, input DMA completion ends that source transfer's need for the buffer: reuse need not wait for decoder completion or output drainage. This does not certify successful decoding; misprogrammed input writes can be counted without entering the FIFO.

Output is another word stream. An output DMA count must include the **three-word texture header** and, when CLUT data is present, its **three-word CLUT header**, as well as both payloads. Input words received count submissions, not consumption; decoded words count payload, not headers. Neither progress count is completion. Require normal IMGDEC DONE, not merely an IRQ: faults also raise that interrupt. When output DMA captures into RAM, also require that DMA transfer's completion before treating the destination as completed output; the final source DATA read precedes its destination write. Neither completion establishes downstream GPU execution or visible display completion.

Do not poll DATA for freshness. An empty read returns the retained DATA latch, which input writes also change. A CPU read while DMA owns the DATA read port likewise returns that latch without popping output. OUTPUT_REQUEST describes a block threshold, not permission for an arbitrary number of reads. Extra DATA reads after successful termination are not harmless polling: they can raise the completion interrupt again.

A format fault stops processing but can leave queued partial output and words already delivered. CONTROL has no ABORT operation. A new START or IMGDEC reset discards queued internal output; it does not cancel a separately admitted DMA transfer or retract prior output. Restarting IMGDEC is therefore not an all-or-nothing recovery of an arbitrary partial output stream.

Use the [IMGDEC chapter](imgdec.md#sec-imgdec) and its [BLua programming sequence](imgdec.md#sec-imgdec-programming-imgdec-in-blua) for stream layout and transfer programming.

### APU sample storage and lifetime {#sec-memory-apu-sample-storage-and-lifetime}

Sampled voices read installed ROM or the APU's 512 KiB private sample RAM, not CPU main RAM. Main RAM can hold upload staging or a download destination, but it is not a direct voice source. The private source address `0x40000000` names APU storage; it is not a CPU pointer. The transfer address instead names an offset within that private RAM.

For a supported nonzero command, an accepted CMD write captures the staging
parameters into the command queue, not the sample bytes. Later staging writes
do not change that queued entry. PLAY selects its source when the command
executes, using the cartridge selection at that time rather than at CMD
submission. Playback continues to use bytes in the selected ROM or sample RAM;
preserve them for every remaining playback, loop, seek or queued use.
Selected-slot source-window writes are individually live: each can change an
active voice's source using its current full description, not an atomic staged
replacement. A failed source change can stop that voice and raise a fault;
other voices' source lifetimes are unchanged.

Keep upload completion separate from playback lifetime. A DMA upload first delivers words to the transfer FIFO; private-RAM writes can remain pending after DMA DONE. After the intended DMA upload completes, with no competing transfer writer, read APU STATUS and wait for TRANSFER_BUSY, bit 10 (`0x400`), to clear before starting a voice over the uploaded bytes. Keep the operation's DMA and fault checks: a clear bit alone does not prove correct data. CPU DATA writes in MANUAL_WRITE commit immediately. Do not change the transfer address while an upload commit is pending. A download may continue prefetching after its DMA completes; select transfer STOP to cancel that work and clear its FIFO before reprogramming. This does not undo committed writes or stop voices.

A paused voice retains its source, and a looping voice continues reading it.
STOP enters the command queue. A fading STOP keeps the source in use until
natural source end or fade completion, whichever comes first. An executed
no-fade STOP clears the resident voice without SLOT_ENDED.

Release sample bytes only after every voice and queued PLAY using them has
finished. SLOT_ENDED identifies one ended slot; another slot can still read the
same source. Upload DMA completion releases the upload buffer, while playback
has its separate source lifetime.

Fault acknowledgment clears the fault report, not the voices or command and transfer queues. Reset is destructive: it clears playback, queues, and private sample RAM rather than completing or preserving their contents. See the [APU chapter](apu.md#sec-apu) for source binding and playback, and its [complete raw-port download](apu.md#sec-apu-worked-download-requested-data-and-surplus-prefetch) for transfer completion and surplus-prefetch control.

## Graphics storage and display {#sec-memory-graphics-storage-and-display}

Drawing destinations, textures, palettes and display sources share GPU local
memory. Supplying command words by DMA, finishing a draw and selecting a
picture for display are different operations. Reusing a region must respect
all the operations still reading it.

The [GPU frame-programming sequence](gpu.md#sec-memory-shared-gpu-storage-and-display-publication)
explains those boundaries and follows two surfaces through preparation,
display selection and reuse. The [PCRTC reference](pcrtc.md#sec-pcrtc)
defines the selected display source and its VBlank latch.
