# Memory and program storage

The CPU addresses system ROM, main RAM, cartridge storage and device registers
through one byte-addressed map. That common address notation does not make
them interchangeable: RAM holds program data and transfer buffers, ROM stores
read-only bytes, and a register access can issue a command or consume a result.
Use the selected region's access and ownership rules, not RAM rules everywhere.

GPU local memory and APU sample RAM are separate from CPU main RAM. Reach them
through the units' image/readback and sample-transfer ports, not an assumed
ordinary RAM pointer. Within main RAM, I/O reservations, GEO scratch and
firmware static storage also have owners; an installed byte is not necessarily
a byte the cartridge may allocate.

## Addresses and data sizes

BMSX uses 32-bit unsigned byte addresses. Each address identifies one byte; the address space runs from `0x00000000` through `0xffffffff`, inclusive. A 32-bit word occupies four consecutive bytes. For 16-bit and 32-bit values in main RAM, byte order is little-endian: the least significant byte is at the lowest address.

All capacities in this section are byte counts: 1 KiB is 1024 bytes and 1 MiB is 1048576 bytes. A range written `[start, end)` includes `start` but excludes `end`; its last byte is at `end - 1`. The tables use inclusive starts and exclusive ends. `0x100000000` denotes the exclusive end of the address space, not an address that a program can supply.

## Installed memory and address windows

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

The cartridge bus begins at `0x10000000` and ends just before `0x31000000`; the system's main-RAM window ends at that cartridge-bus start. Within the main-RAM window, `[0x08400000, 0x10000000)` has no installed main-RAM backing. It is not an extension or mirror of the installed 4 MiB.

The I/O-slot aperture contains 16656 four-byte slots: 66624 bytes in
`[0x08000000, 0x08010440)`. The reservation and allocation boundaries below
remain separate from that decoded aperture.

GPU VRAM is a separate **2 MiB** capacity and is not included in the 4 MiB main-RAM total.

## I/O register-bank directory

The following directory covers the complete I/O aperture in address order. Each word position occupies four bytes; its address is the first byte of that word. The end column is exclusive. Counts include status, snapshot and result words as well as control words: they are **addressed word positions**, not counts of independently writable registers. Access permissions, read side effects, command admission and reset values belong to the individual register descriptions linked in the last column, not to a whole directory range.

### Lower register banks and reserved slots

| First word address | Exclusive end | 32-bit word positions | Unit and subbank |
|---|---|---|---|
| `0x08000000` | `0x0800000c` | 3 | [IRQ](irq.md#register-reference) — pending flags, acknowledgement and mask |
| `0x0800000c` | `0x08000024` | 6 | [DMA](dma.md#register-reference) — channel 0 |
| `0x08000024` | `0x08000064` | 16 | [GEO](geo.md#register-reference) — operands, command, control, progress and fault |
| `0x08000064` | `0x08000120` | 47 | [Input](input.md#register-map) — sampling, keyboard, pointer, four pads and output port |
| `0x08000120` | `0x08000174` | 21 | [APU](apu.md#register-reference) — command-staging parameters |
| `0x08000174` | `0x0800017c` | 2 | [APU](apu.md#register-reference) — CMD and STATUS |
| `0x0800017c` | `0x0800018c` | 4 | [APU](apu.md#register-reference) — retained end-event words |
| `0x0800018c` | `0x08000194` | 2 | [APU](apu.md#register-reference) — selected source and active-slot mask |
| `0x08000194` | `0x080001e8` | 21 | [APU](apu.md#register-reference) — live selected-slot parameter window |
| `0x080001e8` | `0x080001f4` | 3 | [APU](apu.md#register-reference) — sample-transfer address, data and control |
| `0x080001f4` | `0x08000200` | 3 | [APU](apu.md#register-reference) — command-queue occupancy, free space and capacity |
| `0x08000200` | `0x08000204` | 1 | [APU](apu.md#register-reference) — sample sequence |
| `0x08000204` | `0x08000208` | 1 | Reserved retained word |
| `0x08000208` | `0x08010208` | 16384 | Reserved retained-slot range |

### Upper register banks

| First word address | Exclusive end | 32-bit word positions | Unit and subbank |
|---|---|---|---|
| `0x08010208` | `0x08010218` | 4 | [Memory bus fault](#bus-fault-status-and-cpu-exceptions) — code, address, access and acknowledgement |
| `0x08010218` | `0x08010224` | 3 | [APU](apu.md#register-reference) — fault code, detail and acknowledgement |
| `0x08010224` | `0x08010228` | 1 | [GEO](geo.md#register-reference) — fault acknowledgement |
| `0x08010228` | `0x08010230` | 2 | [SYSTEM](system.md#system-time-and-frame-timing) — elapsed milliseconds and frame interval |
| `0x08010230` | `0x08010238` | 2 | [SYSTEM](system.md#diagnostic-text-output) — diagnostic character and line flush |
| `0x08010238` | `0x0801023c` | 1 | [SYSTEM](system.md#system-time-and-frame-timing) — cycles per frame |
| `0x0801023c` | `0x08010244` | 2 | [GPU](gpu.md#gp0-gpuread-gp1-and-gpustat) — GP0/GPUREAD and GP1/GPUSTAT |
| `0x08010244` | `0x080102c4` | 32 | [GTE](gte.md#register-reference) — data words D[0]–D[31] |
| `0x080102c4` | `0x08010344` | 32 | [GTE](gte.md#register-reference) — control words C[0]–C[31] |
| `0x08010344` | `0x0801034c` | 2 | [GTE](gte.md#normal-command-and-cycles) — normal COMMAND and CYCLES |
| `0x0801034c` | `0x08010354` | 2 | [SYSTEM](system.md) — CONTROL and STATUS |
| `0x08010354` | `0x08010384` | 12 | [PCRTC](pcrtc.md) — composition words, PMODE through BGCOLOR |
| `0x08010384` | `0x080103ac` | 10 | [GTE PLUS](gte.md#register-reference) — operands, results, flags, command and cycles |
| `0x080103ac` | `0x080103e4` | 14 | [PCRTC](pcrtc.md) — beam timing, CSR events and IMR masks |
| `0x080103e4` | `0x080103fc` | 6 | [DMA](dma.md#register-reference) — channel 1 |
| `0x080103fc` | `0x08010420` | 9 | [IMGDEC](imgdec.md#register-reference) — configuration, status, data and progress |
| `0x08010420` | `0x08010428` | 2 | [Cartridge controller](../book3/cartridge.md#cartridge-controller) — socket selection and status |
| `0x08010428` | `0x08010440` | 6 | [SYSTEM](system.md#supervisor-fault-registers) — retained supervisor fault report |

These ranges partition all 16656 word positions without gaps or overlaps. A unit need not occupy one contiguous bank: DMA channel 1 is separate from channel 0; GEO and APU have separate upper fault-acknowledgement banks; GTE PLUS separates PCRTC's composition and timing banks; and SYSTEM has timing, diagnostic, control and fault-report banks. The reserved retained slots are part of the decoded aperture, not an additional device or a payload-transfer protocol.

### Reserved retained words and decoder boundary

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
crossing that end uses main-RAM backing for its complete width; it is not split
between a final register and RAM. These examples describe mapped-bus transfers,
not permission to bypass ordinary CPU instruction alignment:

| Mapped transfer | Selected path |
|---|---|
| U32 at `0x0801043c` | Last complete I/O slot: supervisor fault DOMAIN |
| U32 at `0x0801043e` | Four main-RAM bytes spanning the decoder boundary |
| U16 at `0x0801043f` | Two main-RAM bytes spanning the decoder boundary |
| U32 at `0x08010440` | Main-RAM backing within the reservation |

Ordinary CPU U16 and U32 instructions reject the two unaligned examples before
reaching the mapped bus. The [scalar-access rules](#scalar-memory-accesses)
separate that CPU alignment check from I/O decoding. F64 instead consists of
two word transfers: an aligned F64 access at `0x0801043c` reaches the last I/O
slot first and RAM at `0x08010440` second, subject to the ordered fault rules.

## Reserved and cartridge storage in main RAM

The installed main RAM occupies `0x08000000` through `0x083fffff`, a total of 4 MiB. This is a physical storage extent, not a cartridge allocation range. It includes the I/O reservation, GEO scratch storage, and the system's static storage as well as the cartridge's linked static storage.

The following ranges use an exclusive end: the end address is the first byte outside the range.

| Use | Start | Exclusive end | Size |
|---|---|---|---|
| Declared I/O reservation | `0x08000000` | `0x08040000` | 256 KiB |
| GEO scratch reservation | `0x08040000` | `0x080c0000` | 512 KiB |
| System static storage | `0x080c0000` | Actual end of system BSS | Depends on the linked system image |
| Cartridge static storage, compact layout below | Actual end of system BSS | Actual end of cartridge BSS | Depends on the linked cartridge image |

The implemented I/O register aperture ends at `0x08010440`, before the end of the declared I/O reservation. This smaller aperture does not make the remainder of the reservation available for cartridge variables or buffers. Likewise, the GEO scratch reservation is not cartridge static storage.

`0x080c0000` is the start of **system DATA**, not a universal cartridge RAM base.
The installed firmware's BSS follows its DATA. Account for their actual occupied
extent in the matching BIOS image, rather than assuming a fixed cartridge base.
The image's declared BSS address and byte count identify that span; their sum
is its exclusive end. These are linking information, not a request to allocate
or clear memory when the image is selected.

The following compact layout places cartridge DATA at the system BSS end and
cartridge BSS immediately after that DATA. This adjacency is a layout choice,
**not a hardware requirement**. Another cartridge placement can use different
unreserved RAM addresses; its records, code and startup initialization must all
use that chosen placement without overwriting firmware storage.

| Section in the compact layout, in address order | Run address |
|---|---|
| System DATA | `0x080c0000` |
| System BSS | End of system DATA |
| Cartridge DATA | Exported actual end of system BSS |
| Cartridge BSS | End of cartridge DATA |

Each end in this table is exclusive and includes the section's alignment padding. The compiler aligns static objects to their type alignment and rounds section sizes to multiples of four bytes.

Choosing a static layout is not a hardware allocation service. Neither the
installed RAM extent nor the end of cartridge BSS defines a free arena, stack
reservation, or byte-addressed heap. Use the actual installed system image
when calculating firmware occupancy.

<a id="firmware-reservation-in-vram"></a>

## Firmware reservation in VRAM

The 2 MiB VRAM is shared GPU storage, arranged as 1024 rows of 1024 **16-bit words**. Each row spans 2048 bytes. A drawing destination, texture source or display source selects storage within that same memory; it does not create a separate CPU byte-address allocation.

The firmware uses VRAM both for the full terminal drawing surface and for its system texture atlas, which supplies terminal glyphs. Preserve the **bounding rectangle covering both**, rather than reserve only the currently visible text or the atlas alone. This VRAM reservation is separate from the I/O, GEO scratch and linked static-storage reservations in main RAM.

<a id="handoff-is-not-release"></a>

### Handoff is not release

Clearing terminal text or status, or selecting a smaller active terminal viewport, does not shrink the queried full-layout reservation. Cartridge handoff does not release it either. The BIOS monitor later uses the same terminal coordinates and uploads the system atlas again before drawing its output.

Keep the complete queried region out of cartridge allocations. The query does not install hardware write protection or grant permission to overwrite that region, and it does not establish that every coordinate outside it is free.

For the limits of later device-context restoration, see [System control and timing — Device boundaries during supervisor service](system.md#device-boundaries-during-supervisor-service). Restoring device context does not restore overwritten VRAM pixels.

### Query the linked firmware

The named BIOS function `gpu/system_vram_region` takes no arguments and returns two packed words. Its result describes the linked firmware's reservation, not a fixed hardware address.

The first return word contains x in its low half and y in its high half. The second contains width and height, not right and bottom coordinates. The returned rectangle is `[x, x + width) × [y, y + height)`.

Here x and width count **16-bit VRAM words** across a row; y and height count **rows**. These are not CPU byte addresses, main-RAM offsets or counts of 32-bit transfer words. The query describes the linked terminal layout and actual atlas extent: it neither uploads pixels nor waits for a transfer, allocates storage or checks live VRAM contents.

Call it through `require`; do not substitute a numerical function address or treat its name as an asset identifier.

```lua
local system_vram_region<const> = require('gpu/system_vram_region')
local system_origin<const>, system_size<const> = system_vram_region()
local x<const> = system_origin & 0x0000ffff
local y<const> = system_origin >> 16
local width<const> = system_size & 0x0000ffff
local height<const> = system_size >> 16
```

### Current-firmware example

For the current firmware image's terminal layout and packed atlas, the rectangles are:

| Use | x range, in 16-bit words | y range, in rows |
|---|---|---|
| Full terminal, 320 × 240 | `[704, 1024)` | `[720, 960)` |
| Actual system atlas, 216 × 12 | `[768, 984)` | `[960, 972)` |
| Returned bounding rectangle, 320 × 252 | `[704, 1024)` | `[720, 972)` |

For those dimensions, the returned origin word is `0x02d002c0` and the size word is `0x00fc0140`. These numbers are a **current-firmware example**, not universal constants for cartridge code. The atlas's configured maximum is 256 × 64, but its actual packed extent need not fill that maximum; consume the query result instead.

The 320 × 252 bounding rectangle covers 80640 16-bit words, or 161280 bytes of storage footprint. Its row stride is nevertheless **1024 words**, or 2048 bytes: it is a rectangle within VRAM, not a contiguous CPU byte-address allocation. The bounding rectangle also includes space outside the exact terminal-plus-atlas union; the query does not identify internal holes for reuse.

## ROM contents, RAM sections, and startup

<div class="keep-together">

A linked executable image contains executable code, read-only data, and the initial bytes for initialized writable data. Writable static storage has addresses in main RAM. Keep the image location of an initializer separate from the RAM location used by the program.

| Section | Contents in the ROM image | Address used during execution |
|---|---|---|
| TEXT | Executable code | Linked code address in the image |
| RODATA | Read-only data bytes | Linked RODATA address in the image |
| DATA | Initializer bytes | DATA run address in main RAM, after startup copies the initializers |
| BSS | No section byte payload | BSS address in main RAM, after startup clears the section |

</div>

DATA consequently has two distinct addresses:

- Its **load address** identifies the initializer bytes in the ROM image.
- Its **run address** identifies the writable storage in main RAM.

These addresses are not interchangeable. A reference to the DATA object's working storage uses its run address; the startup copy reads from its load address. The linker resolves object addresses from the appropriate section base and the object's byte offset within that section.

RODATA remains part of the image; it does not acquire a separate DATA-style RAM copy. BSS has a RAM address and a byte count, but contributes no BSS byte payload to the image. Its initial zero contents are established by startup code, not supplied by a special zero-filled memory region.

### When initialization occurs

<div class="keep-together">

The generated startup function performs the following sequence for its own linked image:

| Order | Operation |
|---|---|
| 1 | Copy the complete DATA section from its ROM load address to its RAM run address. |
| 2 | Write zero throughout the BSS section in RAM. |
| 3 | Run static module initialization. |
| 4 | Call the program's entry function. |

</div>

The DATA copy and BSS clear cover the padded section byte counts and operate one four-byte word at a time. System startup also clears its boot primitives after module initialization and before entry.

The program's entry function therefore runs after its DATA initializer bytes have been copied and its BSS has been cleared. System startup initializes the system's sections; cartridge startup initializes the cartridge's sections.

**Selecting or activating an image is not this initialization step.** EXEC does not itself copy DATA or clear BSS. If it selects the generated startup function, executing that function subsequently performs initialization. Selecting another function does not implicitly run startup first.

Running startup again repeats its DATA copy and BSS clear, overwriting those sections with their initial contents. These rules concern the selected image's DATA and BSS only; they do not specify the contents of unrelated RAM at cartridge entry.

## Reset and cartridge startup

### From reset to the system program

CPU reset selects the system executable image, clears the active call stack and transient CPU execution state, and pushes the system startup function with no arguments. CPU reset sets CPU status to IE (bit 0) before starting the system startup function.

The generated system startup initializes its own static storage before running static module initialization and the system entry function. Reset and startup are separate steps: selecting an executable image does not itself copy DATA or clear BSS.

<a id="rom-header-fields"></a>

### ROM header fields

The machine boot reader requires a **60-byte ROM-backed prefix**, occupying offsets `0x00` through `0x3b`. The table gives hexadecimal **byte offsets from the ROM base**, not word indices or offsets from the executable image. Interpreted words are unsigned 32-bit little-endian values. CPU boot resolution and BIOS cartridge selection consume different parts of this prefix:

| Byte offset | Field | CPU boot resolution | BIOS cartridge selection |
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

For system domain −1, the ROM base is `0x00000000`. For cartridge domains 0 and 1, it is `0x10000000`, with the domain selecting the cartridge socket. The executable-image address is the low 32 bits of that ROM base plus the image-offset word. The resulting address must bind to installed ROM storage. The three function-record addresses are already absolute: do **not** add the ROM base or image address to them, and do not use the image offset as an instruction PC.

Boot resolution first binds all 60 bytes to installed ROM storage. An unbacked prefix or a zero image offset means no executable image; failure to resolve the system image is an error. This binding does not inspect the magic or header-size word, require the optional diagnostic-directory word, or validate the declared image byte count. The BIOS adds the cartridge checks below. The exception-address field alone does not specify cartridge fault routing.

### BLua32 executable image

The image has a separate **96-byte ROM-backed header**. Its offsets below are relative to the **image address**, unlike the boot-prefix offsets above. Activation reads these six unsigned 32-bit little-endian fields:

| Image byte offset | Field | Unit and interpretation |
| --- | --- | --- |
| `0x18` | Constant-table address | Absolute machine byte address in installed ROM. |
| `0x1c` | Constant count | Number of 16-byte constant records. |
| `0x20` | Global-name-table address | Absolute machine byte address in installed ROM. |
| `0x24` | Global-name count | Number of 8-byte name records. |
| `0x28` | System-global-name-table address | Absolute machine byte address in installed ROM. |
| `0x2c` | System-global-name count | Number of 8-byte name records. |

The remaining declared header slots are listed for layout identification, **not as activation requirements**. Each listed offset identifies a four-byte slot:

| Image byte offset | Declared field, not interpreted by activation |
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
| `0x5c` | Reserved. |

All 96 header bytes must be ROM-backed, including the uninterpreted slots. Activation does not check the declared magic/version, enumerate the function table, derive table locations from a section order, or use declared section extents to bound execution. It neither copies DATA nor clears BSS. Those operations require executed startup instructions, as described above.

The three table-address fields use **absolute machine addresses**, not header-relative or ROM-relative offsets. Table and string reads use the image's execution domain to select a cartridge socket; system-ROM addresses still select system ROM. The referenced spans must be backed by installed ROM, but activation does not constrain them to the declared image byte count. A table count of zero skips that table read, so its address is unused. No particular ordering or contiguity of the tables and referenced text is required by these reads.

#### Constant and name records

Constant record `i` begins at `constantTableAddress + 16i`, with zero-based `i`. The tag is a four-byte unsigned little-endian word at record offset `0x00`:

| Tag | Value | Payload consumed |
| --- | --- | --- |
| 0 | Nil | None. |
| 1 | False | None. |
| 2 | True | None. |
| 3 | Number | Eight-byte IEEE-754 binary64, little-endian, at `0x04`–`0x0b`. |
| 4 | String | Absolute ROM text byte address at `0x04`; text byte count at `0x08`, both u32 little-endian. |

Record bytes `0x0c`–`0x0f` are not read. Other tags cause activation to fail; tags 0–2 do not read a payload. Constant indices select records in table order.

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

The ordinary-global and system-global tables register names in separate namespaces. Each table index maps to the corresponding runtime global slot. An already registered name reuses its slot and value; a newly registered name begins nil. The name record contains no initial value.

#### Function and upvalue records

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

VARARG retains arguments beyond the fixed parameters. STATIC permits direct entry through EXEC; the closure-construction rules are described in [CPU — Closures and captured variables](cpu.md#closures-and-captured-variables). The immediate-address form of `CLOSURE` encodes a function-record address in **16-byte units**; its register-address form supplies the full address. Function-record reads themselves do not impose a 16-byte alignment check. The declared code byte count does not bound instruction fetches.

Upvalue descriptor `i` is read as a four-byte unsigned little-endian word at `upvalueTableAddress + 4i`. Bit 31 set captures a register slot in the parent frame; bit 31 clear captures an upvalue of the parent closure. Bits 0–30 give the zero-based slot or upvalue index. Function and upvalue records are read through the mapped bus, rather than through the ROM-only table/string binding used during image activation.

Function-record words are little-endian; [instruction words are big-endian](cpu.md#instruction-words-and-execution-resources). Neither a function-record address nor a record's code address is relative to the image header.

### Optional BIOS diagnostic directory

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

#### Source locations

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

#### Named frame scopes

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

This directory is distinct from private development symbols or a cartridge
resource directory. Neither is required to locate this BIOS-consumed format:
its address comes directly from the ROM header word.

### BIOS cartridge selection

The BIOS scans cartridge slot 0 before slot 1, considering slots whose presence bits are set in the sampled cartridge-status word. For each candidate it selects that slot and checks:

- ROM magic is `0x58534d42`;
- the header-size word is at least 60;
- the executable-image-offset word is nonzero;
- the startup-function word is nonzero.

The first candidate that passes these checks supplies the startup function address. These checks describe BIOS selection; they are not a complete cartridge-header validation specification.

The boot loop waits for vertical blank before each boot-screen update. Handoff requires a ready cartridge and a retained boot-frame counter of at least 50. This is not an exact elapsed-time or consecutive-frame delay after cartridge insertion. At handoff, the BIOS clears and flushes terminal status, writes zero to the IRQ mask, then writes the selected startup function address to COP0 EXEC.

### EXEC and cartridge entry

A startup function address identifies a **function record**, not the address of its first instruction. EXEC reads the target record and requires its STATIC flag. An unreadable record or one without that flag causes a hard halt.

Successful EXEC clears the active call stack, selects the target executable image and execution domain, establishes its entry status, clears CPU halt, wait, blocked-write and yield state, and pushes the selected static function with no arguments. A successful `EXEC` of a cartridge image sets CPU status to IE and user mode (bits 0 and 1) before starting the selected static function—not at a later entry-function call. The BIOS's zero IRQ-mask write must not be confused with clearing the CPU interrupt-enable bit.

EXEC is not a hardware reset and does not itself initialize DATA or BSS. Entering the generated cartridge startup causes those operations to run:

1. Copy the cartridge image's DATA initializer bytes from their load address to their RAM run address.
2. Zero the cartridge image's BSS.
3. Run static module initialization.
4. Call the cartridge entry function with no arguments.

Calling another static function through EXEC does not implicitly run this startup sequence. Re-entering generated startup repeats initialization of that image's DATA and BSS.

These operations do not establish an all-zero-RAM cartridge-entry state or promise that unrelated RAM contents persist across a reset or handoff.

<a id="taking-ownership-after-the-bios"></a>

### Taking ownership after the BIOS

Ordinary BIOS boot hands over a running machine, not an untouched hardware-reset state. The BIOS has already used graphics and the display before `EXEC`. Register reset values therefore do not describe a complete cartridge-entry state. Preserve the existing display deliberately, or program the units you will use according to their chapters. For timing readouts, see [System control and timing — System time and frame timing](system.md#system-time-and-frame-timing); for CPU control fields, see [CPU — CP0 and execution control](cpu.md#cp0-and-execution-control).

The BIOS writes zero to the central interrupt mask before handoff. This masks delivery; it does not clear pending flags or clear CPU interrupt enable, which is set at cartridge entry. Enabling a pending source can make it deliverable without another event. Choose one dispatch owner, install the first source's handler and prepare that source before enabling its delivery. Acknowledge local source state and central pending state as required by the unit; they are separate responsibilities. See [Interrupt controller — Choose one cartridge dispatch route](irq.md#choose-one-cartridge-dispatch-route) and [Acknowledge the source and the controller separately](irq.md#acknowledge-the-source-and-the-controller-separately). The GPU marker example's [Starting conditions](irq.md#starting-conditions) show this ordering for its chosen configuration, not a universal device-reset recipe.

Execution handoff also does not release the [Firmware reservation in VRAM](#firmware-reservation-in-vram); see [Handoff is not release](#handoff-is-not-release). Later supervisor service preserves selected device context, not overwritten VRAM pixels. Its boundaries are described in [System control and timing — Device boundaries during supervisor service](system.md#device-boundaries-during-supervisor-service).

INPUT likewise carries BIOS sampling state into cartridge entry rather than
starting from its reset words. Follow
[BIOS handoff and supervisor sampling](input.md#bios-handoff-and-supervisor-sampling)
to establish a fresh cartridge sample, including after supervisor return.

<a id="normal-boot-live-work"></a>

#### Firmware work at normal boot handoff

After an ordinary, uninterrupted BIOS boot started by system reset, the cartridge begins with the firmware work listed below complete or absent. The BIOS has finished supplying its final command batch and has reached that batch's GPU completion marker. Its DMA and vertical-blank callbacks do not start further drawing or device jobs. These guarantees describe this normal boot path, not arbitrary entry through `EXEC`.

| Surface | Firmware work at cartridge entry |
| --- | --- |
| DMA0 and DMA1 | No outstanding firmware transfer or admitted transfer block. DMA0's final transfer has finished; this boot path never starts DMA1. |
| GP0 input and readback | No active firmware writer, unfinished firmware packet, or outstanding firmware VRAM-to-CPU readback. |
| GEO | No outstanding firmware geometry job. |
| IMGDEC | No outstanding firmware decode, input, or output job. |
| APU | No queued firmware command, active playback slot, or outstanding sample-transfer batch. This does not imply that the APU clock or output activity has stopped. |

**Queued drawing is separate from an active producer.** The BIOS marker establishes command ordering; it does not guarantee that the GPU queue is empty, that every submitted drawing operation has finished, or that the final boot image has been displayed. Already submitted BIOS drawing can remain pending even though no firmware writer remains. These statements do not specify a universal register image: `EXEC` itself neither resets devices nor drains their work, so entry through another path does not inherit these normal-boot guarantees.

## Typed byte storage and address views

BLua has typed static storage for data that must have a byte address and a defined layout. A static storage name denotes that storage's address. A typed local view describes how to access bytes at an existing address; it does not allocate another buffer.

### Declaring static storage

The declaration keywords are `bss`, `data` and `rodata`, without a leading dot. In the syntax below, `name`, `type` and `expression` stand for the program's binding name, storage type and initializer.

| Declaration | Initial contents | Use |
|---|---|---|
| `bss name: type` | Zeroed by generated startup | Writable storage without an authored initializer |
| `data name: type = expression` | Authored initializer, copied into its run address by generated startup | Writable initialized storage |
| `rodata name: type = expression` | Authored constant storage | Storage whose directly named writes the compiler rejects |

A BSS declaration takes no initializer. DATA and RODATA declarations require one.

Each declaration receives a linked section address, aligned for its type. It is not a function-local temporary buffer. Section placement can also add padding: after each binding, the section extent is rounded up to four bytes. This placement padding is separate from the size of the declared type.

#### An address is not its stored scalar

Existing firmware declares its random-generator state as:

```lua
data rng_state: word = 0x12345678
```

Here `rng_state` denotes the address of the state word. The expression `*rng_state` reads the stored word; the same dereference can be an assignment target. The initializer is program state, not a fixed memory-map address.

A whole array or struct is likewise not loaded or copied merely by using its storage name. Select a scalar element or field to access a value, or take an address when another operation needs the storage location.

### Primitive sizes and access representations

<div class="keep-together">

Sizes and alignments below are in bytes. `LE` means little-endian.

| Storage type | Size | Alignment | Scalar access representation |
|---|---:|---:|---|
| `u8`, `i8` | 1 | 1 | U8: unsigned 8-bit |
| `u16`, `i16` | 2 | 2 | U16LE: unsigned 16-bit, little-endian |
| `u32`, `i32`, `addr` | 4 | 4 | U32LE: unsigned 32-bit, little-endian |
| `word` | 4 | 4 | Word |
| `f32` | 4 | 4 | F32LE |
| `f64` | 8 | 4 | F64LE |
| `string` | 4 | 4 | Constant reference; see below |

</div>

For a raw 32-bit word in backed main RAM, `Word` and `U32LE` read and write the same four little-endian bytes, and a load returns the same unsigned 32-bit value. They remain distinct access kinds with distinct fault `ACCESS` flags.

In particular, `f64` has four-byte alignment, not eight-byte alignment.

The `i8`, `i16` and `i32` names select the same unsigned memory-access kinds as their `u` counterparts. Do not assume signed-load or sign-extension rules from those names.

#### Initialized numeric storage

Static integer-storage initializers must be compile-time integers. Integer fields retain the low 8 bits for `U8`, 16 bits for `U16LE`, and 32 bits for `U32LE` and `Word`.

Static `f32` and `f64` initializers in DATA and RODATA accept compile-time numbers, including array elements and struct fields. They encode IEEE 754 binary32 or binary64 in little-endian order. F32 rounds the computed value to binary32; F64 retains its binary64 value. Both preserve negative zero. The size and alignment rules in the table above still apply; F64 does not require eight-byte alignment.

#### A stored string is a reference

A static `string` initializer must be a compile-time string and is allowed only in RODATA. Its four-byte storage field holds a constant reference, not the string's characters. Reading the field resolves that reference to the string value.

Do not pass the address of such a field as though it addressed inline text, texture, PCM or geometry bytes. This layout does not establish a raw character-byte address or a terminator convention.

### Arrays and structs

#### Arrays

Array dimensions follow the type name in brackets. A resolved array occupies its element size multiplied by every dimension; its alignment is the element type's alignment.

Explicit dimensions must be positive compile-time integers. DATA and RODATA may infer only the outer dimension, written with empty brackets. The initializer must then be a nonempty table, and its field count determines that outer length. BSS does not support inferred length.

DATA and RODATA array initializers are positional tables with exactly the declared number of outer entries. Nested arrays follow the same rule recursively. The entries are encoded into consecutive element positions beginning at element zero. This declaration creates static bytes, not an ordinary runtime table.

#### Structs

A struct declaration starts with `struct name`, contains named `field: type` entries, and ends with `end`. Optional commas or semicolons may follow the fields.

| Layout rule | Result |
|---|---|
| Fields retain declaration order | Reordering fields can change offsets and total size |
| Each field starts at its next correctly aligned offset | Padding can appear between fields |
| Struct alignment is the largest field alignment | Arrays of the struct retain that alignment |
| Final size is rounded up to struct alignment | Padding can follow the final field |

Structs are not automatically packed. Duplicate field names and recursive struct layouts are rejected.

A DATA or RODATA struct initializer is a named-field table containing every declared field exactly once. Unknown fields, repeated names, non-identifier keys and omitted fields are rejected. Each field is encoded at its resolved offset. Unoccupied bytes in the emitted initializer, including padding, are zero. That fact concerns the initializer bytes; it is not a general promise that all RAM is initially zero.

### Typed local address views

A local pointer annotation has the form `: *type`, after the local name and any local attribute. Its initializer supplies the address. The annotation determines the layout used for dereference, indexing and field selection; it reserves no pointee storage.

For example, firmware reserves a word array named `terminal_command_words`, with its own compile-time capacity, then binds this view to the array's address:

```lua
local command_words<const>: *word = terminal_command_words
```

The storage declaration supplies the bytes. The local view supplies a typed way to access their existing address. `<const>` prevents reassignment of `command_words`; it does **not** prevent writes through that view.

Unary `*` dereferences a typed storage name or view. Scalar reads and writes use the selected type's memory-access representation. Whole arrays and structs are not scalar load or assignment targets: select their scalar members or use their addresses instead. An untyped dereference that cannot resolve a storage view is rejected.

#### Typed indexing is zero-based and element-scaled

A typed subscript selects an element at:

**base byte address + index × selected element size**

There is no subtraction of one. Index zero selects the first element. For an array, indexing removes its outer dimension; the selected element may itself be an array. For a scalar or struct pointer, indexing advances by one pointee-sized element per index.

This address calculation does not insert an array-length bounds comparison. Keep indices within the storage allocated for the operation.

Do not confuse typed indexing with ordinary BLua table construction: positional fields in an ordinary table begin at key one, not element zero.

#### Fields and address-of

Selecting a typed field adds its declared byte offset and retains that field's type. Unary `&` on a typed storage, element or field expression returns its address without loading or copying the stored value.

The firmware monitor's `command_registry` is a RODATA array of `monitor_command` records. During its zero-based traversal, `command` is the record index. Its address-of-element view is written:

```lua
local entry<const>: *monitor_command = &command_registry[command]
```

Here `entry` receives the selected record's address, not a copied record. This typed-storage use of `&` does not establish that arbitrary language locals or value slots have exposed physical byte addresses.

### Element counts, byte sizes and field offsets

| Operation | Result |
|---|---|
| `#array_name` for a resolved named static array | Its first dimension: an element count |
| `sizeof(type)` | The complete type size in bytes, including all dimensions and struct padding |
| `offsetof(Struct.field)` | The field's byte offset within the struct |

For a multidimensional array, `#` is neither the product of all dimensions nor the byte extent. `sizeof` is the byte-size query.

`offsetof` also accepts a path through nested struct fields, written with dots. It adds the offsets along that path. The path is not array-index syntax. Neither `sizeof` nor `offsetof` obtains an address for a local variable or stack slot.

### Raw byte addresses are not element indices

Ordinary `+` and `-` operate on their operand values. Adding one to an address does not multiply that increment by its pointee size. Element scaling belongs to typed indexing, not general address arithmetic.

<div class="keep-together">

The reserved memory-map names also take **byte addresses**, not element indices:

| Access spelling | Selected access |
|---|---|
| `mem[address]` | Word |
| `mem8[address]` | U8 |
| `mem16le[address]` | U16LE |
| `mem32le[address]` | U32LE |
| `memf32le[address]` | F32LE |
| `memf64le[address]` | F64LE |

</div>

The name selects how to access the bytes at `address`; it does not scale that address. Scalar accesses must satisfy their access-kind alignment and still pass through mapped memory. An address view does not bypass memory-map behavior, and the existence of an access spelling does not mean every I/O port accepts that width.

#### RODATA protection is a direct-write restriction

The compiler rejects assignments through directly resolved RODATA names and their directly selected fields or indices. This is not a read-only-pointer capability: local typed views do not carry that protection as an alias permission. It also does not define what mapped memory does with a write to ROM.

### What a storage declaration does not provide

Use declared storage for its linked allocation and defined byte layout. Do not treat a typed view as another allocation or assume that an arbitrary address names free RAM.

A static string field is not inline character storage. Addressability alone also says nothing about when a device has finished consuming or producing bytes: completion and buffer-reuse rules belong to the particular operation.

## Language execution storage and byte RAM

Function calls use language value slots. A frame's register area follows its variable-argument area in the active thread's slot stack. The function record's maximum-stack value is a **slot count**, not a RAM address or byte count. These slots have no cartridge-addressable byte-RAM base; do not place an assumed stack at the top of main RAM.

Language allocations are charged against a logical allocation budget, including charges for growth of slot-stack capacity. Although that accounting uses byte amounts, it does not describe a mapped byte-RAM heap or report free RAM bytes. In particular, its capacity calculation does not subtract the actual linked DATA and BSS extents. Keep mapped-memory byte addresses, call-slot counts and logical allocation charges distinct; an accounting amount does not define a buffer's physical layout or address.

### Values are not byte buffers

Keep ordinary BLua values separate from the bytes a cartridge places in memory. A local can hold nil, a boolean, a number, text, a table, a function or a thread. Declaring that local does not reserve a cartridge-addressable byte buffer. Nor does a value's presence in a table give it a byte layout suitable for a device.

Nil, false, true and numeric zero are distinct values. Only nil and false are false in a condition; zero is true. In particular, a boolean is not an implicit numeric field containing zero or one. When a register or memory format requires such a field, supply its explicit numeric value.

An ordinary table constructor creates a table of values. Its entries need not all have the same kind: numbers, strings, booleans, tables and functions can coexist. Positional constructor fields receive keys 1, 2 and so on; named fields use their string keys. Key zero can also be written explicitly. It is an ordinary numeric table key, not a byte address or an automatically supplied first positional entry.

Assignment copies a value, not the contents of a referenced table. If two locals contain the same table, a table store through either local changes that shared table. Reassigning one local changes only the value held by that local. Putting the table in another table entry also preserves this sharing. Function arguments follow the same rule: passing a table preserves its identity rather than copying its entries into memory. Missing parameters receive nil.

Function values likewise remain function values when copied, passed or stored in a table. They are not interchangeable with numeric code addresses. An ordinary function call requires a function value; storing a number does not turn it into one.

Use typed byte storage when the task is to supply an exact memory layout. A typed pointer is a view of its numeric byte address. It neither allocates the pointed-to bytes nor turns a table into a buffer. Its index zero selects the first element; subsequent indices advance by the element size. This differs from a table constructor's positional keys. Typed fields and elements select byte offsets and scalar access kinds, rather than dynamic table entries. Do not infer an address for an arbitrary local, table or string from these storage operations.

Scalar memory loads produce numbers. Integer access kinds read unsigned values of their specified width; floating access kinds interpret floating-point encodings. None reconstructs nil, a boolean, a table, a function or text from a generic word.

Stores are numeric operations too. Integer stores discard the fractional part and write the low bits of the selected width. Floating stores encode the source number in the selected floating-point format. Reading those bytes with an integer access kind reads the integer bit pattern, not the floating-point value. Backed main RAM stores these multibyte scalars little-endian; device registers retain their own access rules and word meanings.

A word store is therefore not a way to save any BLua value. Supply numeric addresses, words and field values explicitly. Neither assignment nor scalar memory access is an automatic table serializer, string-content copy or function serializer.

### Function arguments, results and BIOS calls

Function parameters are source names, not declarations of byte storage. Write the parameter identifiers in order, followed by `...` if the function accepts additional arguments. A parameter list does not accept the typed-local address-view syntax: do not put a `: *word` annotation on a parameter or assume that a caller's local view supplies a typed function signature. Function arguments and results are language values; the call does not place them in a cartridge-addressable byte-RAM stack.

Each named parameter receives a copy of the corresponding argument value. Replacing that parameter's value does not replace the caller's local binding. Table and closure arguments retain the same references; they are not deep-copied. Passing a numeric address passes that address value, not an implicit address of the caller's variable. A missing named argument supplies `nil`. Extra arguments are discarded by a function without `...`; a vararg function retains the arguments beyond its named parameters, in order. The `...` expression reads those retained values. A call does not fail merely because its argument count differs from the named parameter count, although the called function or BIOS service can impose its own requirements.

To access an address argument as word storage, establish a local view inside the body: `local destination<const>: *word = address`. This binds the existing numeric address and supplies access-type information. It neither allocates destination bytes nor converts a table into byte storage.

A method call adds one argument. With colon-call syntax, the named method is looked up on the receiver, and that receiver is passed as the first argument; explicitly written arguments follow it. A colon-defined function receives that argument as implicit `self`, before its authored parameters. This is a calling convention for language values, not a byte-memory layout for objects.

**Result adjustment.** In cartridge source compilation, an ordinary function call or `...` can supply several values. Whether those values expand depends on the expression's position, not on a separate result buffer that the cartridge must allocate.

| Position | Values used |
|---|---|
| An argument before the final argument | One value |
| A final argument that is a call or `...` | All its results become arguments |
| An assignment expression before the final expression | One value |
| A final assignment call or `...` | Enough results for the remaining targets |
| A return expression before the final expression | One value |
| A final returned call or `...` | All its results become return values |
| A standalone call statement | No result is bound to a source name |

Assignment keeps only as many values as it has targets and supplies `nil` for targets without a value. The same adjustment applies to local initialization. Thus a two-result call can initialize two names, while assigning it to one name retains only its first result. A one-value context also receives `nil` if the call supplies no value. A return list can combine individual leading values with the complete results of its final call or `...`; the receiving call context then determines how many of those returned values it uses. In cartridge source compilation, a bare `return`, or reaching the end of a function, returns **one `nil`**, not an empty result list.

In cartridge source compilation, parentheses around a call do not by themselves reduce its results to one. In source compiled on-console by `load`, a parenthesized call is adjusted to one result. To select one result in cartridge source, assign the call to a single local.

A local captured by an ordinary function remains available through that function after the enclosing function returns. The captured value is not an exposed, stable byte address of the departed call's local storage. Ordinary function values can be retained and passed as values; a numeric byte address or numeric identifier is not itself a callable function. Calling a nonfunction raises `CALL_NON_FUNCTION`, reason 1; it does not cast a number into a callable address.

**BIOS calls.** Named static BIOS imports use ordinary function-call argument and result adjustment. The configured direct imports are `math/sin`, `string/float/decode` and `gpu/system_vram_region`; this is not a list of every installed library function. A name bound to such a static import is a call target, not a first-class function value to place in a table, pass as an argument or return. This restriction does not apply to ordinary authored function values.

Installed library globals are a separate route. For example, the BIOS publishes the `string` library as an ordinary global library value; it is not the same mechanism as the named static imports above. Do not infer that every installed library function is a direct static import.

Calling a BIOS function is still a normal function call. It is not `EXEC`, does not constitute a privilege transition, and does not by itself grant permission to access devices or arbitrary BIOS memory.

### Text, codepoints and UTF-8 bytes

A string is text, not a numeric address of encoded bytes. Work with strings when selecting characters, measuring text or constructing text. Work with typed byte storage when preparing an exact device payload. These are different operations even when the payload happens to contain UTF-8.

Both `#s` and `string.len(s)` count codepoints. Neither reports the number of UTF-8 bytes needed to encode the text. A zero codepoint is an ordinary character: it contributes to the length and does not terminate the string. Keep a codepoint count separate from the byte count of any encoded memory span.

Despite its name, `string.byte(s[, i])` selects one codepoint and returns its numeric scalar value. Positions are 1-based. Omitting `i`, or passing nil for it, selects position 1. A supplied position must be numeric and is converted to a signed 32-bit integer. Positions below 1 or beyond the end return nil. A negative position does not count backwards from the end. The operation returns one codepoint, not a range of characters or a sequence of UTF-8 bytes; an additional range-end argument does not extend it.

`string.char(...)` constructs text from numeric Unicode scalar values. It is not restricted to values from 0 through 255. Each argument is converted to an unsigned 32-bit integer; values above 10FFFFH and values in the surrogate range D800H through DFFFH are rejected as invalid arguments. Zero is accepted as a character. With no arguments, the result is empty text. The numbers supplied to this operation describe characters, not separate bytes for a UTF-8 decoder.

The same distinction applies to character escapes in a literal. A hexadecimal escape consists of `\x` followed by exactly two hexadecimal digits and contributes that character value. A decimal escape consumes up to three digits and accepts values from 0 through 255. Adjacent escapes are adjacent characters; they are not a request to decode a UTF-8 byte sequence.

For UTF-8 already held in byte memory, the existing bridge is `string.from_utf8(address, byte_count)`. Supply the numeric address of a backed span containing complete, well-formed UTF-8 sequences, and its byte count. The count is not a codepoint count. A zero byte becomes the zero codepoint rather than ending the decode.

This decoder is not a safe validator for malformed or truncated input. Its byte count does not make an incomplete final sequence safe: continuation reads for a sequence already begun can extend beyond that count. Provide complete valid spans rather than relying on truncation, zero termination or validation by this operation. The call does not establish ownership of the source storage.

A static `string` field occupies four bytes containing a constant reference. Loading that field as a string obtains the text; the field's byte address locates the reference, not the characters. It is not a UTF-8 source pointer. Likewise, a dynamic string is not a device buffer. The numeric fields written by `string.pack` still form a string value, not a memory address or DMA source. Use explicit typed raw bytes for device payloads rather than treating text operations as byte storage.

The installed library is available through the shared `string` global. Treat both that global and its library table as shared resources: do not overwrite them while other code depends on them. Library availability does not mean a cartridge receives a private table to repurpose.

<a id="complete-blua-call-and-text-program"></a>

### Worked values, byte storage and text

After normal BIOS entry, typed storage supplies the destination bytes; passing
its address to a function does not allocate a new destination:

```lua
bss written: word[2]
local write_pair = function(address, first, second)
    local destination<const>: *word = address
    destination[0] = first
    destination[1] = second
    return first + second, 2
end
local sum, count = write_pair(written, 17, 25)
```

`sum` is 42, `count` is 2, and the two stored words are 17 and 25.
The function's address view and the declared array select the same storage.
Neither a Table nor a String can be substituted for its byte address.

Text uses a different route:

```lua
rodata utf8_bytes: u8[8] = { 0x41, 0xc3, 0xa9, 0, 0xf0, 0x9f, 0x99, 0x82 }
local text = string.from_utf8(utf8_bytes, #utf8_bytes)
local count = #text
local zero = string.byte(text, 3)
local face = string.byte(text, 4)
```

Eight bytes decode to four codepoints: `0041H`, `00E9H`, `0000H`, `1F642H`.
`count` is 4, `zero` is 0 and `face` is `1F642H`. Embedded zero does not
terminate the String; the supplementary codepoint counts as one. Conversely,
`'\xc3\xa9'` contains two codepoints rather than decoding two UTF-8 bytes.
Use [BIOS String operations](bios-string.md) for explicit text/byte conversion,
and [CPU calls](cpu.md#calls-closures-globals-and-tables) for argument/result
counts, captures and language-value identity.

## Execution addresses and instruction reads

### Function records and instruction addresses

A function address points to a **function record**, not to the first
instruction. The record's `CODE_ADDRESS` word supplies the instruction
address. These two addresses are not interchangeable.

The record and the instructions also use different byte orders:

| Item | Representation |
| --- | --- |
| Function record's `CODE_ADDRESS` word | 32-bit little-endian |
| Instruction word | Four bytes, big-endian |

Reading a function record therefore does not use the byte order used to
decode its instructions.

### Execution domains and cartridge sockets

<div class="keep-together">

BMSX has three execution domains:

| Domain ID | Execution image |
| --- | --- |
| −1 | System |
| 0 | Cartridge socket 0 |
| 1 | Cartridge socket 1 |

</div>

For cartridge execution, the active image binds instruction reads to its
cartridge socket. Domain identifiers are not RAM addresses and do not
allocate isolated RAM.

### Instruction alignment and read faults

Before instruction decoding, the PC is checked for four-byte alignment. An
unaligned PC raises an address-error-load exception at that instruction
address.

An ordinary instruction occupies one four-byte word. A `WIDE`-prefixed
instruction occupies two words: the prefix at PC and its body at PC + 4.
Instruction reads use the memory map and the big-endian instruction
representation described above.

A fault during an instruction read raises an instruction-bus-error
exception. For a `WIDE` instruction, a fault while reading either word is
attributed to the original instruction PC—the prefix address—not the body
address.

### Selected instruction base charges

The CPU/system timebase is **33,868,800 cycles per second**. The following
are selected instruction base charges, not a complete timing table:

| Instruction | Base charge |
| --- | --- |
| Scalar `LOAD_MEM` and `STORE_MEM` | 2 cycles |
| Scalar displaced forms `LOAD_MEM_D` and `STORE_MEM_D` | 2 cycles |
| `ADD`, `SUB`, `MUL` | 1 cycle |
| `WIDE` prefix | 0 cycles |

A `WIDE` instruction uses its body's base charge; the prefix does not add
another base charge. These charges do not specify the cost of a source
expression, total program execution time, or sustained memory bandwidth.

Use [CPU — Cycle accounting and execution boundaries](cpu.md#cycle-accounting-and-execution-boundaries) for admission, retries and additional instruction work, and its [Memory instruction reference](cpu.md#memory-instruction-reference) for the complete transfer-instruction table. [DMA — Transfer timing and sharing the bus](dma.md#transfer-timing-and-sharing-the-bus) supplies endpoint rates, block and tail budgets, contention and GPU transport examples; CPU instruction charges are not DMA transfer rates.

## Scalar memory accesses

The rules in this section apply to ordinary scalar `LOAD_MEM` and `STORE_MEM` instructions with the access kinds listed below. Addresses are unsigned 32-bit byte addresses. I/O registers occupy four-byte slots.

### Width and alignment

| Access kind | Kind ID | Width | Required address alignment |
|---|---:|---:|---:|
| Word | 0 | 4 bytes | 4 bytes |
| U8 | 1 | 1 byte | 1 byte |
| U16LE | 2 | 2 bytes | 2 bytes |
| U32LE | 3 | 4 bytes | 4 bytes |
| F32LE | 4 | 4 bytes | 4 bytes |
| F64LE | 5 | 8 bytes | **4 bytes**, not 8 |

The CPU checks alignment before making the mapped access. A misaligned ordinary load enters a synchronous address-error-load exception; a misaligned ordinary store enters a synchronous address-error-store exception. For stores, this check also precedes the write-readiness check. Thus an ordinary misaligned U32 access raises an address error before it can reach any I/O width or slot-alignment check.

### System-ROM data accesses

The declared system-ROM window is `0x00000000` through `0x00ffffff` (16 MiB). When the full width of a mapped scalar read fits this window, bytes beyond the installed ROM image are returned as zero. A U16 or U32 read that straddles the installed image's end is zero-filled only for its missing bytes.

Scalar writes to the system-ROM window do not modify ROM. They report `BUS_FAULT_UNMAPPED`, **not** `BUS_FAULT_READ_ONLY`. The CPU alignment check still comes first. These are system-ROM data-access rules, not cartridge-ROM or instruction-fetch rules.

### I/O widths and read side effects

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

### Eight-byte accesses and partial completion

An F64 access first accesses the low word at the starting address, then the high word at that address plus four. A new fault on the first word stops the access before the second word is attempted. A fault on the second word reports that second byte address, unless an older pending fault already occupies the fault latch.

These two accesses are not an atomic eight-byte transaction. If an F64 store successfully writes the low word and then faults on the high word, the low-word write is not undone. An F64 read returns zero at the mapped-access level if either word faults; the ordinary CPU load does not commit that zero to its destination register.

An aligned store also checks whether the mapped write is ready. If it is not ready, the store waits and performs no write on that pass. This is distinct from reporting a bus fault.

An unmapped scalar access reports `BUS_FAULT_UNMAPPED`. The unmapped U8, U16 and U32 read paths return zero, while the unmapped write paths perform no target write. Rejected I/O U8 and U16 reads likewise return zero. These returned zeros are not successful results of faulting ordinary CPU loads: the CPU exception check described below occurs before the destination register is assigned.

## Bus-fault status and CPU exceptions

The bus-fault latch records the first pending fault. Its retained status and the CPU's response to a new fault are separate mechanisms: a later fault can cause a synchronous CPU exception without replacing the older recorded fault.

### Register reference

These four registers use byte addresses. The access labels describe aligned Word/U32 accesses; they do not grant byte or halfword writes.

| Byte address | Register | Word access and contents | Construction/clear word |
|---|---|---|---|
| `0x08010208` | `IO_SYS_BUS_FAULT_CODE` | Read-only. Numerical code of the first pending fault. | `0x00000000` (`BUS_FAULT_NONE`) |
| `0x0801020c` | `IO_SYS_BUS_FAULT_ADDR` | Read-only. Byte address supplied by the first pending fault. | `0x00000000` |
| `0x08010210` | `IO_SYS_BUS_FAULT_ACCESS` | Read-only. Access flags supplied by the first pending fault. | `0x00000000` |
| `0x08010214` | `IO_SYS_BUS_FAULT_ACK` | Reads as zero. A zero word write does not acknowledge; **any nonzero word write** clears the latch. | `0x00000000` |

“Construction/clear word” identifies the words established on construction or explicit latch clear; it is not a specification of every machine-reset sequence. CODE, ADDR and ACCESS retain full 32-bit words. CODE is a numerical code, not a bitmask; ADDR is a byte address; ACCESS is a flags word.

Reading the status registers does not acknowledge a fault. An aligned Word/U32 write to CODE, ADDR or ACCESS reports `BUS_FAULT_READ_ONLY` before writing the destination slot. If no fault is already pending, that rejected write becomes the pending fault, recording its destination address and write access flags. Otherwise, the older recorded fault remains.

### CODE values

| Name | Word value | Meaning |
|---|---|---|
| `BUS_FAULT_NONE` | `0x00000000` | No pending fault. |
| `BUS_FAULT_UNMAPPED` | `0x00000001` | Unmapped access. |
| `BUS_FAULT_UNALIGNED_IO` | `0x00000002` | Rejected I/O width or slot alignment, as specified above. |
| `BUS_FAULT_READ_ONLY` | `0x00000003` | Rejected write to a read-only register. |

### ACCESS flags

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

Word and U32 have different ACCESS flags even though both access four bytes. These flags are also distinct from the kind IDs in the scalar-access table.

### Capture, subsequent faults and acknowledgment

With no fault pending, a reported fault immediately publishes CODE, ADDR and ACCESS and leaves ACK zero. Publication is part of reporting the fault, not deferred to a frame boundary.

While CODE is not `BUS_FAULT_NONE`, later faults do not replace those three retained words. Every reported fault nevertheless advances a separate 32-bit fault sequence, wrapping modulo 2^32. This sequence is not an additional mapped register. It lets the CPU distinguish a new fault from an older pending record.

An aligned nonzero word write to ACK synchronously clears CODE to `BUS_FAULT_NONE`, clears ADDR and ACCESS to zero, and leaves ACK zero. Any nonzero word works; bit 0 alone is not the acknowledgment test. A zero word write leaves the pending fields unchanged. Acknowledgment neither resets nor advances the fault sequence.

### Synchronous CPU exception entry

For an ordinary aligned scalar load, the CPU compares the fault sequence before and after the mapped read. A change causes synchronous data-bus-error entry **before the read value is assigned to the destination register**. For an ordinary aligned scalar store that is ready to proceed, the CPU compares the sequence around the write and enters the same exception if it changes. Exception entry does not imply rollback of an already completed part of an F64 store.

Consequently, a new fault still causes this exception when an older fault remains latched. Conversely, an older pending CODE alone does not force a successful later access to fault: an access with no new sequence change can complete normally.

The latch, clear and acknowledgment operations do not themselves request an IRQ or enter a CPU exception. The synchronous ordinary-access checks above provide the exception-entry edge described here.

The CPU cause-code field occupies bits 6:2, selected by `CPU_CAUSE_CODE_MASK = 0x0000007c`.

| Ordinary-access condition | CPU cause code | Encoded cause-field value |
|---|---:|---|
| Misaligned load | 4 | `0x00000010` |
| Misaligned store | 5 | `0x00000014` |
| New bus fault during the mapped access | 7 | `0x0000001c` |

These CPU cause codes are not the values 1–3 in `IO_SYS_BUS_FAULT_CODE`. They are not IRQ bits either: IRQ and NMI are independently represented by bits 10 and 16. Acknowledging the fault record and entering a CPU exception are distinct operations.

## Installed response to a memory exception

A synchronous memory exception enters the **system exception entry**, even when the faulting instruction belongs to a cartridge. This differs from a maskable IRQ, whose entry is selected according to the interrupted mode. Declaring a cartridge `exception` function does not install it as the handler for this memory-fault route.

The system exception entry calls the BIOS exception function, which enters the BIOS monitor. Acknowledging the Memory fault record is not exception return: it clears the retained report but does not repair an address or advance the faulting instruction. Likewise, returning from an exception does not itself acknowledge that record.

### Inspect an actual unmapped load

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

<div class="keep-together">

![BIOS monitor after the unmapped Word load and the three-word MEM command](figures/memory-bus-fault.png)

**Unmapped-load output.** The BIOS reports DBE, the faulting source statement and its EPC; the `MEM` line shows the three Memory report words. EPC is the instruction's address in this linked program, not a constant to copy into another cartridge.

</div>

### Clearing a report is not repairing the program

The monitor's `FAULT` command displays its saved fault report when one is retained. `FAULT CLEAR` discards that saved BIOS report; it does not write `IO_SYS_BUS_FAULT_ACK`, clear the Memory CODE/ADDR/ACCESS words, or resume the cartridge.

`CONT` returns using the saved EPC without advancing it. In the program above, the invalid address is unchanged, so `CONT` retries the load and enters the monitor again with another DBE. The first Memory fault remains latched. Clearing either report does not turn an unmapped address into usable storage.

CP0 reads and writes require non-user mode; attempting them from ordinary cartridge user mode causes the coprocessor-unusable exception. Do not attempt to repair this example by reading or replacing CP0 fields in ordinary cartridge code. The example demonstrates inspection and an unchanged-instruction retry, not a cartridge recovery handler or a successful recovery.

<a id="repair-a-word-load-and-retry"></a>

### Repair a word load and retry

The preceding constant-address probe remains faulty after its report is cleared. This example instead makes the address a mutable local pointer, so you can repair the operand of the stopped read. Include the [BIOS diagnostic directory](#optional-bios-diagnostic-directory) for source and frame-scope lookup. Frame evaluation needs the correct source scope and an available, mutable live binding; it cannot recover arbitrary optimized-out locals.

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

`source` first receives the invalid address stored in `source_address`. The first read faults before assigning `result.first`. `safe_words`, by contrast, names the linked address of two backed DATA words. Repair the existing `source` binding to that address: changing the `source_address` word alone would leave the stopped read’s already loaded pointer unchanged. Do not change EPC; the same read must be retried with the repaired operand.

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

<div class="keep-together">

![Monitor after inspecting frames and assigning the repaired pointer, before continuing.](figures/memory-fault-repair.png)

**Repair before retry.** The monitor after `FRAMES` and `source = safe_words`, still at the prompt before `CONT`; this is not a completed-recovery screen.

</div>

`CONT` retries the saved instruction. The first read now succeeds; the program advances `source` by `sizeof(word)` (four bytes) and reads the second word. The old Memory CODE can remain `1` throughout both successful reads: a pending report does not make a valid address invalid. Only afterward does the program save that old code, write `1` to ACK, and read the cleared code.

The successful run produces these diagnostic lines, not newly drawn text in the monitor image:

```text
RECOVERED
WORDS 12345678 9ABCDEF0
FAULT 00000001 -> 00000000
```

`REBOOT` is a restart request, not this repair or a saved-EPC continuation. With the cartridge unchanged, its bad initial pointer is encountered again. See [System control and timing — Reset requests](system.md#reset-requests).

For a programming example of privileged CP0 reads inside an ordinary cartridge IRQ callback, see [CPU — Read CP0 in a cartridge IRQ](cpu.md#cp0-in-cartridge-irq). The callback returns normally, allowing its generated IRQ vector to perform RFE and resume the interrupted cartridge code.

## Worked example: prepare and copy two records

This sequence prepares bytes without submitting a device job. Start after
normal cartridge DATA/BSS initialization. The declared objects supply linked
addresses; no guessed free RAM address is needed.

```lua
module<entry>
struct memory_sample
    tag: u8
    value: word
    samples: u16[2]
end
rodata inputs: memory_sample[2] = {
    { tag = 0x11, value = 0x12345678, samples = { 0x1122, 0x3344 } },
    { tag = 0x22, value = 0x9abcdef0, samples = { 0x5566, 0x7788 } },
}
data counter: word = 0x12345678
bss output: memory_sample[2]
local source<const>: *memory_sample = inputs
local destination<const>: *memory_sample = output

for index = 0, #inputs - 1 do
    destination[index].tag = source[index].tag
    destination[index].value = source[index].value
    destination[index].samples[0] = source[index].samples[0]
    destination[index].samples[1] = source[index].samples[1]
end
*counter = *counter + #inputs
```

### Record indexing is not byte arithmetic

| Part of `memory_sample` | Byte offset | Bytes |
| --- | ---: | ---: |
| `tag` | 0 | 1 |
| Padding | 1 | 3 |
| `value` | 4 | 4 |
| `samples` | 8 | 4 |

Record alignment is 4 and record size is 12 bytes. Each two-record array
occupies 24 bytes. Typed indices start at zero: `&source[1]` is 12 bytes after
`inputs`, `&source[0].value` is 4 bytes after it, and
`&source[1].samples[1]` is 22 bytes after it. Advancing a byte view by one
would instead select the next byte, here padding, not the next record.

### Resulting bytes

BSS supplies initial zero output bytes. The copy writes scalar fields rather
than assigning whole records, so their three padding bytes remain zero.

| Output byte offset | Word | Contents |
| ---: | --- | --- |
| 0 | `00000011H` | First tag and three zero padding bytes |
| 4 | `12345678H` | First value |
| 8 | `33441122H` | First record's two samples |
| 12 | `00000022H` | Second tag and three zero padding bytes |
| 16 | `9ABCDEF0H` | Second value |
| 20 | `77885566H` | Second record's two samples |

The final counter is `1234567AH`: `#inputs` counts **two records**, not bytes.
No interrupt, rendering or buffer-release event follows this CPU copy. A
hardware-facing use must still satisfy the receiving unit's address, layout,
count, completion and lifetime rules.

## DMA buffer lifetime

DMA uses byte addresses but counts transfers in **32-bit words**. Starting a transfer does not copy its source into a private payload buffer. Source storage, destination storage and the channel's programmed words therefore have different lifetimes. The rules below describe aligned, backed main-RAM copies and the stated DMA-to-GPU example, not every hardware buffer.

### Attribute a bus fault before START

The shared record contains CODE (`0x08010208`), ADDR (`0x0801020c`) and ACCESS (`0x08010210`); ACCESS identifies direction and access kind, not a channel or bus master. Read them with aligned Word/U32 MMIO accesses from ordinary cartridge code, not privileged CP0 accesses; reads do not acknowledge them.

Attribution requires an interval from saving the old report through final reads in which only the assessed operation produces bus faults and nobody else acknowledges them. Other channels, CPU accesses, interrupt handlers, BIOS work or devices must not introduce another fault. This is an assumption the program must establish, not automatic isolation.

**Before START**, read CODE and preserve any older nonzero report's CODE/ADDR/ACCESS in owned storage. Write aligned Word/U32 `1` to ACK (`0x08010214`), then read CODE to establish a zero baseline. Start the prepared operation and wait for its real completion predicate. Read CODE again; if nonzero, preserve CODE/ADDR/ACCESS before another ACK. Under the stated assumption, this is the first reported fault since clearing and belongs to the assessed operation.

If the old report must remain physically latched, do not clear it: saving its words preserves information, not the latch. An unchanged pending triple cannot reveal additional faults; concurrent producers or acknowledgers also prevent attribution. Use actual result observations without claiming attribution. Zero CODE is not transfer success: an unready port can discard a word without a bus fault. These registers expose no new-fault counter.

### Prepare, start, wait, check, reuse

1. **Prepare the storage.** Use the linked addresses of storage owned by the program. Fill the source before starting, reserve enough destination space for the word count, and use nonoverlapping source and destination ranges for an ordinary copy. A count of 20 means 20 words, or 80 bytes; it does not mean 20 bytes. Keep the source unchanged until DMA has finished reading it, and do not consume the destination as a completed copy before the final writes.

2. **Program an idle channel completely.** Set its read address, write address, count, increment choices, request selectors and block length before START. An increment advances its address by four bytes per word; a fixed address advances by zero. The programmed block-length field specifies 1 through 16 words, and the last block uses only the remaining count. Both selected requests must be asserted before a block is admitted. `FORCE` is always asserted; `DISABLED` is never asserted. For a device port, choose its real request selectors rather than use FORCE to send words while the port is not ready.

3. **Start once and preserve the live inputs.** An accepted START with a nonzero count sets BUSY; START while BUSY is ignored, not queued as a second transfer. A zero count finishes immediately, before testing requests. Admission retains one block's addresses, remaining count, control and length, but not its source words. At block service, each source word is read and immediately written to the destination before proceeding to the next word. Bytes changed after START can therefore affect later reads; START is not a source-buffer snapshot.

   Leave the channel's programmed address/count/control words alone through completion. Writes to those words are not automatically rejected while BUSY: an already admitted block uses its captured configuration, and its later address/count writeback can overwrite changes made meanwhile. Reprogramming a busy channel is not a way to revise that admitted block safely.

4. **Wait for completion, then check the outcome.** Finish follows the final mapped transfer accesses, replaces channel status with DONE (`2`), and clears BUSY by that replacement. It also raises the channel's DMA interrupt. Wait for channel status or service its completion IRQ rather than assuming a transfer delay.

   **DONE is not a success certificate.** An unmapped read can report a bus fault and supply zero to the transfer; an unmapped or read-only destination write can report a fault without writing its target. DMA nevertheless advances its addresses and count rather than aborting on those faults. A write to an I/O port that is not ready can be discarded without retrying that word. Use the before-START attribution procedure above when assessing the bus-fault record, and use the correct request selectors; completion alone does not prove that all intended destination bytes were written.

5. **Reuse according to the completed operation.** Once DMA has finished its source reads, that transfer no longer needs the source bytes; once its final RAM writes have completed, the RAM destination can be inspected as the completed transfer's output. A receiving device may still have work to do. DMA transport completion does not establish GPU-job completion or permission to reuse a live display surface.

### Overlap is not a buffered move

For backed RAM, reads observe the current four little-endian bytes and writes immediately update their destination bytes. There is no block-sized source snapshot or special overlap-copy behavior. For example, start with RAM words `[1, 2, 3, 4, 5]` and copy a four-word block from *base* to *base + 4*, with both addresses incrementing. The access order produces `[1, 1, 1, 1, 1]`: each write changes the next source word before it is read.

### DMA programming example

The [DMA chapter's BLua sequence](dma.md#worked-blua-program) prepares 20 source words and performs two nonoverlapping RAM copies using linked storage addresses. It programs both channels before either START and uses 16-word and four-word blocks. The two completed destination copies retain the words to inspect.

The following GP0 sequence sends a five-word ROM stream, waits for DMA DONE,
then separately waits for a GPU marker and GPU idle. These are distinct
completion conditions; the order of software reads does not establish a
universal ordering of DMA and device completion.

## Device-specific buffer lifetimes

### GEO addressed-buffer lifetime

GEO captures a job's configuration, not its source data. Prepare the buffers before launch, keep them stable during work, and check the terminal state before consuming output or reusing storage. Follow the [GEO launch procedure](geo.md#launching-and-observing-a-job) for operation-specific programming and observation.

1. **Prepare before admission.** Read `STATUS` and program a nonbusy unit. Populate the operation's descriptors and source data, and prepare separate output buffers. Use actual linked buffers; this does not grant extra mapped RAM or GEO scratch storage. XFORM2 destination vertices and AABB outputs require RAM ranges. Set the operation's `SRC0`, `SRC1`, `SRC2`, `DST0`, `DST1`, `COUNT`, `PARAM0`, `PARAM1`, `STRIDE0`, `STRIDE1`, and `STRIDE2` before writing `CMD`.

2. **Know what launch captures.** An accepted, supported nonzero command captures those register words, without reading source bytes. With nonzero `COUNT`, GEO becomes `BUSY` and schedules service. `OVERLAP2D_PASS` writes its summary at launch, before the count test; even a zero-count launch is not necessarily free of buffer writes. Never submit `CMD` while `BUSY`: it neither waits nor queues. It discards the running job, rejects the new command, resets `PROCESSED` to zero, publishes `REJECTED` with `REJECT_BUSY`, and raises the ERROR interrupt.

3. **Preserve live inputs.** `XFORM2_BATCH` reads each record during processing. A valid empty record with `flags = 0` and `vertexCount = 0` succeeds without reading a matrix or vertices. For a nonempty record that passes its checks, GEO reads the selected matrix during that record and each local vertex immediately before its corresponding output x/y writes. `SAT2_BATCH` reads pair, descriptor, and vertex words during processing; `OVERLAP2D_PASS` likewise reads candidate, instance, shape, and vertex data during processing. Changing these bytes after `CMD` can change pending work. Leave inputs and outputs unmodified until work stops; separate outputs do not establish arbitrary in-place or aliasing safety.

4. **Check the actual terminal state.** `PROCESSED` advances after successful records. Successful completion latches `DONE` without a fault and raises the DONE interrupt. An execution fault stops the job, retains the completed-record count, latches `DONE|ERROR` and `FAULT`, and raises ERROR. `DONE` alone does not prove whole-batch success: inspect `ERROR`, `FAULT`, and `PROCESSED`.

5. **Classify output before reuse.** Faults do not roll back issued writes. Completed-record counts do not describe every retained partial write or launch-time summary. `ERROR` or `REJECTED` suppresses later commands until local fault acknowledgement. Any nonzero `FAULT_ACK` clears `ERROR`, `REJECTED`, and `FAULT`, preserving `DONE`, `BUSY`, and `PROCESSED`; it does not resume discarded work. This local acknowledgement is distinct from interrupt acknowledgement. Use the [completion/fault procedure](geo.md#completion-faults-and-recovery) before consuming results or reusing buffers.

### GTE PLUS operand-register lifetime

GTE PLUS uses an operand/result register bank, not a main-RAM source-address and length interface. Its five writable operand words are `ADD_XY`, `ADD_Z`, `MUL_XY`, `MUL_Z`, and `SCALAR`. This differs from an addressed RAM payload whose contents may be read as work progresses.

An accepted, supported `VMAD3` command computes pending XY, Z, and flag results from the current operand words. Later writes to those five operand registers replace their register contents, but do not change that pending result. They can prepare operands for subsequent work; they do not submit another command. Until completion, result reads still see the previously published values. The pending XY, Z, and flag results publish together at completion, when `BUSY` clears.

Submit `COMMAND` through the CPU. CPU command submission is interlocked while a command remains pending, rather than starting overlapping work. DMA cannot issue PLUS `COMMAND`. Follow [GTE timed VMAD3](gte.md#vmad3--timed-vector-multiply-add-through-plus) for the command sequence and completion procedure; do not substitute a guessed delay for completion observation.

### IMGDEC input and output have separate lifetimes

IMGDEC accepts supplied stream words through DATA, not a cartridge source-buffer pointer. An admitted CPU DATA write copies that word into its input storage; the decoder does not retain the original CPU-visible storage location. Texture and CLUT destination words become output command headers, not addresses that IMGDEC itself dereferences.

DMA programming and block admission capture addresses, not the source contents. Keep the source words unchanged until their last DMA read, including repeated reads from a fixed source address. For a whole buffer with no other reader, input DMA completion ends that source transfer's need for the buffer: reuse need not wait for decoder completion or output drainage. This does not certify successful decoding; misprogrammed input writes can be counted without entering the FIFO.

Output is another word stream. An output DMA count must include the **three-word texture header** and, when CLUT data is present, its **three-word CLUT header**, as well as both payloads. Input words received count submissions, not consumption; decoded words count payload, not headers. Neither progress count is completion. Require normal IMGDEC DONE, not merely an IRQ: faults also raise that interrupt. When output DMA captures into RAM, also require that DMA transfer's completion before treating the destination as completed output; the final source DATA read precedes its destination write. Neither completion establishes downstream GPU execution or visible display completion.

Do not poll DATA for freshness. An empty read returns the retained DATA latch, which input writes also change. A CPU read while DMA owns the DATA read port likewise returns that latch without popping output. OUTPUT_REQUEST describes a block threshold, not permission for an arbitrary number of reads. Extra DATA reads after successful termination are not harmless polling: they can raise the completion interrupt again.

A format fault stops processing but can leave queued partial output and words already delivered. CONTROL has no ABORT operation. A new START or IMGDEC reset discards queued internal output; it does not cancel a separately admitted DMA transfer or retract prior output. Restarting IMGDEC is therefore not an all-or-nothing recovery of an arbitrary partial output stream.

Use the [IMGDEC chapter](imgdec.md) and its [BLua programming sequence](imgdec.md#programming-imgdec-in-blua) for stream layout and transfer programming.

### APU sample storage and lifetime

Sampled voices read installed ROM or the APU's 512 KiB private sample RAM, not CPU main RAM. Main RAM can hold upload staging or a download destination, but it is not a direct voice source. The private source address `0x40000000` names APU storage; it is not a CPU pointer. The transfer address instead names an offset within that private RAM.

For a supported nonzero command, an accepted CMD write captures the staging parameters into the command queue, not the sample bytes. Later staging writes do not change that queued entry. PLAY binds its source when the command executes; cartridge selection is taken at that binding, not when CMD is queued. The voice retains a source view and reads backing bytes during playback rather than taking a complete payload snapshot. Preserve those bytes for every remaining playback, loop, seek, or queued use. Do not expect live-byte changes to be immediately reread. Selected-slot source-window writes are individually live: each can rebind an active voice using its current full description, not an atomic staged replacement. A failed rebind can stop that voice and fault without releasing other source references.

Keep upload completion separate from playback lifetime. A DMA upload first delivers words to the transfer FIFO; private-RAM writes can remain pending after DMA DONE. After the intended DMA upload completes, with no competing transfer writer, read APU STATUS and wait for TRANSFER_BUSY, bit 10 (`0x400`), to clear before starting a voice over the uploaded bytes. Keep the operation's DMA and fault checks: a clear bit alone does not prove correct data. CPU DATA writes in MANUAL_WRITE commit immediately. Do not change the transfer address while an upload commit is pending. A download may continue prefetching after its DMA completes; select transfer STOP to cancel that work and clear its FIFO before reprogramming. This does not undo committed writes or stop voices.

A paused voice retains a nonexclusive source reference. A looping voice continues reading; a voice STOP command is queued, not completed by its CMD write. A pending STOP fade does not immediately release the source. While fading, the normal post-frame source-boundary check is suppressed: keep the fade within the remaining nonlooping source data or provide a valid loop. An executed no-fade STOP clears that slot's resident voice without emitting SLOT_ENDED. SLOT_ENDED describes one ended slot, not every use of its bytes. Other voices, queued PLAY commands, and staged or planned uses can still require the same source. Account for all of them before overwriting shared samples; neither DMA DONE nor one SLOT_ENDED grants blanket reuse.

Fault acknowledgment clears the fault report, not the voices or command and transfer queues. Reset is destructive: it clears playback, queues, and private sample RAM rather than completing or preserving their contents. See the [APU chapter](apu.md) for source binding and playback, and its [complete raw-port download](apu.md#apu-download-budget) for transfer completion and surplus-prefetch control.

## Shared GPU storage and display publication

Treat RAM staging, GP0 command words, shared GPU local memory, and the PCRTC display selection as different lifetimes. Uploading a picture does not allocate a texture, and selecting a framebuffer does not copy its pixels. Textures, palettes, drawing destinations, copy sources, and display sources can address the same storage. The cartridge must choose regions and order their uses; neither GP0 port readiness nor a VBlank event locks or releases those regions.

| Data or role | What is retained or accessed | Relevant boundary |
|---|---|---|
| RAM staging source | DMA reads RAM words as the transfer progresses; GP0 receives copied words. | Completion of the RAM reads ends that source use, not later GPU or display uses. |
| Upload payload | The upload retains payload words consumed by image assembly. | The upload uses those words, not a later reread of the original RAM source. |
| Texture, CLUT, copy source | Commands read shared VRAM when their ordered memory operation executes. | Queueing a command does not preserve a private copy of these pixels. |
| Drawing destination | Writes update shared VRAM; masking and blending can read its current contents. | Destination addresses do not establish exclusive ownership. |
| PCRTC source | Retained display configuration selects addresses in shared VRAM. | Configuration publication is not a selected-surface pixel snapshot. |
| Readback result | READY readback holds copied result pixels. | GP0 reads drain that result; the final read returns the readback port to IDLE. |

### Command order is not resource allocation

A queued drawing command retains its packet and drawing-context words, not texture or CLUT bytes. A VRAM-to-VRAM copy likewise reads its source from shared memory when executed. Preserve the contents required by earlier uses in the ordered command stream. A later, correctly ordered upload can change the contents for later uses; queue-time capture does not give earlier commands their own texture image. This ordering is not a promise that arbitrary source/destination aliasing or texture feedback is safe.

DMA completion, a GP0 interrupt marker, GPU IDLE, and readback readiness answer different questions. DMA DONE follows the channel's mapped accesses; it does not itself establish successful GPU delivery, completed drawing, or display publication. The GP0 interrupt marker raises its retained request when reached in command order, but is not a display fence. GPU IDLE requires empty input, no incomplete command or upload, no pending command timing, and an idle readback port. It does not certify a particular frame's pixels or display publication.

Readback becomes active at its ordered command boundary and blocks further GP0 parsing until drained. READY means its pixels have been copied into readback storage, not that a DMA destination in RAM has already been filled. Draining GP0 and finishing any downstream DMA RAM writes are separate steps. See [GPU](gpu.md) and [DMA](dma.md) for their command and transfer interfaces.

### A display switch selects storage; it does not save it

PCRTC has programmed and retained presentation configuration, not two private pixel banks. Ordinary display configuration writes stage new words. At VBlank begin, presentation configuration is latched and the frame's command boundary is selected before the system VBlank interrupt is raised. The separate PCRTC VSINT interrupt is not this publication acknowledgement. Beam-timing writes can restart live timing immediately; do not treat them as ordinary deferred display-source switches.

Before composing the selected source, commands through the published boundary are processed. Normally that boundary is the executed-command count; an active readback instead supplies its fence boundary. This is not an exact historical pixel version: later commands already applied to shared memory are not undone. Neither the boundary nor VBlank supplies an all-VRAM release, an atomic framebuffer snapshot, or a physical pixel-fetch deadline.

With a fixed format, pitch, geometry, and source offsets, switching to a disjoint region changes the selected addresses. It does not prove that every other reader has stopped using the old region. If the old region is later selected again, it supplies its then-current contents, not pixels saved by the earlier switch. See [PCRTC](pcrtc.md) for source-address selection.

A fresh-after-write observation needs more than an already-pending VBlank flag. Under a sole cartridge IRQ/counter owner, no earlier in-flight callback, and no other configuration, mask, or counter writer: set IRQ MASK to 0 before the final display write; after that write, write ACK = 4 and capture the VBlank callback counter while still masked; set MASK to 4 and wait for the counter to change. The accepted event then follows the final write. This does not make multiple register writes atomic or free any resource. Reset and context operations are additional configuration-publication boundaries, not ordinary VBlank switches.

### Prepare, publish and reuse two surfaces

This programming sequence prepares two fixed surfaces, selects A, selects B, rebuilds A while B is selected, and selects A again. It uses ordinary fresh BIOS cartridge entry with CPU interrupts enabled. It is the sole GP0 producer and owns the VBlank handler, IRQ mask and callback counter; there is no earlier in-flight callback, supervisor/context takeover, or competing writer. Only circuit 1 is enabled, and no other texture, CLUT, copy or readback operation uses either region. These are the conditions of this example, not an allocation or general surface-release service.

The callable BIOS function `gpu/system_vram_region` reports the installed system reservation. For the reservation example above it returns origin `02D002C0H`, or `(704,720)`, and size `00FC0140H`, or `(320,252)`: the bounding region `[704,1024) × [720,972)`. Both chosen surfaces exclude that reservation and each other. These are the current installed BIOS values, not immutable hardware dimensions or proof that every other address is free.

| Surface | GX16 source region | DISPFB1.low | Word base |
|---|---|---|---|
| A | `[0,256) × [0,192)` | `000FA000H` | `00000H` |
| B | `[0,256) × [256,448)` | `000FA040H` | `40000H` |

`DISPFB1.high` stays zero. Both low words select GX16, PSM 31, and FBW 16: a row stride of 1024 sixteen-bit words, or 2048 bytes. Each surface contains 49,152 source words, or 98,304 bytes of pixels, across those rows; it is not one contiguous CPU allocation. Changing FBP from `00H` to `40H` changes the word base from zero to `40000H`, equivalent to `(0,256)` in this layout.

The program resets PCRTC with CSR `00000200H`; that is not a VRAM clear. It holds PMODE at zero during preparation. `DISPLAY1.low = 01800000H` supplies zero signal origin and magnification 4 horizontally, 1 vertically; `DISPLAY1.high = 000BF3FFH` supplies a 1024 × 192 signal extent. With the reset horizontal signal step of 4 and progressive mode, the source footprint is exactly 256 × 192 at zero phase. PMODE `0000FF21H` then enables only circuit 1. Pitch, format, source offsets and geometry remain unchanged throughout the switches.

#### Prepare the storage and display route

The following fragments form one ordered sequence under the ownership
assumptions above. A final write to a display register is not a drawing fence.
First define the VBlank callback and disable delivery during preparation:

```lua
bss vblank_sequence: word
function irq(flags)
    if (flags & 4) ~= 0 then
        *vblank_sequence = *vblank_sequence + 1
    end
    mem[0x08000004] = flags & 4
end
mem[0x08000008] = 0
mem[0x080103d4] = 0x00000200  -- PCRTC reset; not a VRAM clear
mem[0x08010354] = 0           -- PMODE: no read circuit
mem[0x0801035c] = 0x000fa000  -- DISPFB1 low: surface A
mem[0x08010360] = 0           -- DISPFB1 high: zero source offsets
mem[0x08010364] = 0x01800000  -- DISPLAY1 low
mem[0x08010368] = 0x000bf3ff  -- DISPLAY1 high
mem[0x08010240] = 0x09000000  -- Close the VRAM Y-address extension gate
```

Send the following **four three-word GP0 fill commands**, in row order, to the
fixed port `0801023CH`. Each cell is one raw word:

| Fill | Command/color | Position | Extent |
| --- | --- | --- | --- |
| Red A | `020000FFH` | `00000000H` | `00C00100H` |
| White marker on A | `02FFFFFFH` | `00400010H` | `00200020H` |
| Blue B | `02FF0000H` | `01000000H` | `00C00100H` |
| White marker on B | `02FFFFFFH` | `014000D0H` | `00200020H` |

For example, the first command is exactly:

```lua
mem[0x0801023c] = 0x020000ff
mem[0x0801023c] = 0x00000000
mem[0x0801023c] = 0x00c00100
```

After all four fills, issue a one-pixel readback from each surface origin:
GP0 words `C0000000H`, position (`00000000H` for A, `01000000H` for B),
`00010001H`. For each request, wait until GPUSTAT at `08010240H` has
`08000000H` set, then read one word from GPUREAD at `0801023CH`. The words
are `0000001FH` and `00007C00H`. Drain each result before the next request;
then wait separately for GPUSTAT IDLE, bit `04000000H`.

#### Publish A, then B

Enable circuit 1, discard stale VBlank pending **after** the final display
write, and wait for a newly serviced callback:

```lua
mem[0x08010354] = 0x0000ff21
mem[0x08000004] = 4
local before = *vblank_sequence
mem[0x08000008] = 4
while *vblank_sequence == before do
    halt_until_irq
end
```

A is now selected at the new publication edge. To publish B, use the same
mask/write/ACK/sample/enable/wait order:

```lua
mem[0x08000008] = 0
mem[0x0801035c] = 0x000fa040
mem[0x08000004] = 4
local before = *vblank_sequence
mem[0x08000008] = 4
while *vblank_sequence == before do
    halt_until_irq
end
```

With B selected, rebuild only A using GP0 triples
`0200FF00H, 00000000H, 00C00100H` and
`02FFFFFFH, 00500070H, 00200020H`. Read back both origins again and drain
the results before waiting for GPU IDLE. Repeat the publication sequence with
`DISPFB1.low = 000FA000H` to select A's new contents.

#### What each phase establishes

GP0 readback follows the fills in command order. A one-pixel request consumes
one whole GPUREAD word: the pixel is in the low half and the unused high half
is zero. Waiting for IDLE after draining the readbacks is separate from
waiting for VBlank publication. There is no DMA transfer in this sequence.

Masking delivery before the display write and acknowledging afterward prevents
an old pending VBlank from satisfying the callback-counter wait. Under the
stated sole-owner conditions, the changed counter observes a fresh post-write
VBlank. It does not measure exact pixel-fetch timing or a fixed latency.

| Origin sampled | Initial preparation | After rebuilding A |
| --- | --- | --- |
| A `(0,0)` | `0000001FH` (red) | `000003E0H` (green) |
| B `(0,256)` | `00007C00H` (blue) | `00007C00H` (unchanged blue) |

The framebuffer words select A/B/A: `000FA000H`, `000FA040H`,
`000FA000H`. The final selection reads A's **current green contents**, not a
saved copy of its earlier red image. It does not release other users of that
storage or grant permission to overwrite the BIOS reservation.

#### Ordinary playback pictures

| A prepared and selected | B selected | A rebuilt and selected again |
|---|---|---|
| ![Red A with a white square at display coordinates 16,64](figures/memory-display-a-red.png) | ![Blue B with a white square at display coordinates 208,64](figures/memory-display-b-blue.png) | ![Green A with a white square at display coordinates 112,80](figures/memory-display-a-green.png) |
| Red background; white marker `[16,48) × [64,96)`. | Blue background; white marker `[208,240) × [64,96)`. | Green background; white marker `[112,144) × [80,112)`. |

The resulting 256 × 192 pictures are shown above. Each contains 1024 white marker pixels and 48,128 background pixels. They demonstrate this controlled selection and reuse, not physical pixel-fetch timing, arbitrary alias safety, or ownership of other regions.
