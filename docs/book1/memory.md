# Memory and program storage

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

## Reserved and cartridge storage in main RAM

The installed main RAM occupies `0x08000000` through `0x083fffff`, a total of 4 MiB. This is a physical storage extent, not a cartridge allocation range. It includes the I/O reservation, GEO scratch storage, and the system's static storage as well as the cartridge's linked static storage.

The following ranges use an exclusive end: the end address is the first byte outside the range.

| Use | Start | Exclusive end | Size |
|---|---|---|---|
| Declared I/O reservation | `0x08000000` | `0x08040000` | 256 KiB |
| GEO scratch reservation | `0x08040000` | `0x080c0000` | 512 KiB |
| System static storage | `0x080c0000` | Actual end of system BSS | Depends on the linked system image |
| Cartridge static storage | Actual end of system BSS | Actual end of cartridge BSS | Depends on the linked cartridge image |

The implemented I/O register aperture ends at `0x08010440`, before the end of the declared I/O reservation. This smaller aperture does not make the remainder of the reservation available for cartridge variables or buffers. Likewise, the GEO scratch reservation is not cartridge static storage.

`0x080c0000` is the start of **system DATA**, not a universal cartridge RAM base. System BSS follows system DATA. The system image exports the actual end of its BSS, and the cartridge link uses that exported address for the beginning of cartridge DATA. Cartridge BSS follows cartridge DATA. A cartridge must therefore use the placement established for the system image against which it is linked, rather than assume a fixed numerical cartridge base.

| Section in main RAM, in address order | Run address |
|---|---|
| System DATA | `0x080c0000` |
| System BSS | End of system DATA |
| Cartridge DATA | Exported actual end of system BSS |
| Cartridge BSS | End of cartridge DATA |

Each end in this table is exclusive and includes the section's alignment padding. The compiler aligns static objects to their type alignment and rounds section sizes to multiples of four bytes.

The linker checks that the linked static storage fits within the RAM byte count supplied for the build. This is a static-storage fit check, not an allocation service. Neither the installed RAM extent nor the end of cartridge BSS defines a free arena, stack reservation, or byte-addressed heap.

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

#### Initialized numeric storage has a narrower contract

Static numeric initializers must be compile-time integers. Integer fields retain the low 8 bits for `U8`, 16 bits for `U16LE`, and 32 bits for `U32LE` and `Word`.

Although `f32` and `f64` have defined layouts and scalar access kinds, static initialization does not accept initialized floating storage. Their appearance in the type table is not permission to use a floating DATA or RODATA initializer. This restriction concerns static initialization, not later F32LE or F64LE memory accesses.

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

These operations answer different questions:

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

The declared system-ROM window is `0x00000000` through `0x00ffffff` (16 MiB). When the full width of a mapped scalar read fits this window, bytes beyond the installed ROM image are returned as zero. A U16 or U32 read that straddles the installed image's end is zero-filled for its missing bytes rather than faulting for those bytes.

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

## Worked example: prepare and copy two records

This complete, memory-only program starts with two initialized input records,
copies their scalar fields into an output array, and records what it observed
before the copy. It prepares bytes; it does not draw an image or submit a device
job.

Build the two modules below together. Name the constant module `storage`, so that
`require('storage')` resolves to it, and use the `module<entry>` module as the
program entry. Generated DATA/BSS startup runs before the entry code. No numeric
RAM base is needed: the storage declarations supply linked addresses.

In this program, the top-level struct names `memory_sample` and `memory_status` declared in `storage` are available to the entry module’s unqualified typed views and `sizeof`. They do not need to appear in the address/count table returned by `storage`.

### The storage module

The one source constant, `input_count`, sets both array dimensions and supplies
the exported record count. Here it is **2 records**, not 2 bytes. The returned
exports provide that count and the addresses of the declared storage.

```lua
module<const>

local input_count<const> = 2

struct memory_sample
	tag: u8
	value: word
	samples: u16[2]
end

struct memory_status
	initial_counter: word
	initial_output_or: word
	completed: word
end

rodata inputs: memory_sample[input_count] = {
	{ tag = 0x11, value = 0x12345678, samples = { 0x1122, 0x3344 } },
	{ tag = 0x22, value = 0x9abcdef0, samples = { 0x5566, 0x7788 } },
}

data counter: word = 0x12345678
bss output: memory_sample[input_count]
bss status: memory_status

return {
	inputs = inputs,
	input_count = input_count,
	counter = counter,
	output = output,
	status = status,
}
```

<div class="keep-together">

The input and output arrays have the same record layout:

| Part of `memory_sample` | Byte offset | Size in bytes |
| --- | ---: | ---: |
| `tag` | 0 | 1 |
| Alignment padding | 1–3 | 3 |
| `value` | 4 | 4 |
| `samples[0]` | 8 | 2 |
| `samples[1]` | 10 | 2 |

</div>

A record has alignment **4** and size **12 bytes**. Two records occupy **24
bytes**, or six words. The padding is part of the record's storage, but is not a
field to copy.

| Declaration | Storage | Size | Contents before the entry code writes them |
| --- | --- | ---: | --- |
| `inputs` | RODATA | 24 bytes | The two initialized records above, with zero padding |
| `counter` | DATA | 4 bytes | `12345678H` |
| `output` | BSS | 24 bytes | All zero |
| `status` | BSS | 12 bytes | All zero |

The three `memory_status` fields are words at byte offsets 0, 4, and 8,
respectively. The entry code preserves the initial counter value and combines
all six initial output words with bitwise OR before writing any output field.
For this program, the observed initial counter was `12345678H` and that OR was
`00000000H`.

### The entry module

The typed address views connect the exported addresses to their layouts:
`inputs` and `output` address records, `counter` addresses a word, and `status`
addresses the status record. `output_words` is a word view of the same output
bytes, used only for the startup observation.

```lua
module<entry>

local storage<const> = require('storage')
local inputs<const>: *memory_sample = storage.inputs
local output<const>: *memory_sample = storage.output
local counter<const>: *word = storage.counter
local status<const>: *memory_status = storage.status
local output_words<const>: *word = storage.output

-- Observe startup contents before writing the output records.
status.initial_counter = *counter
local initial_output_or = 0
for index = 0, storage.input_count * sizeof(memory_sample) // sizeof(word) - 1 do
	initial_output_or = initial_output_or | output_words[index]
end
status.initial_output_or = initial_output_or

-- Typed arrays start at zero. Copy scalar fields, not whole records.
for index = 0, storage.input_count - 1 do
	output[index].tag = inputs[index].tag
	output[index].value = inputs[index].value
	output[index].samples[0] = inputs[index].samples[0]
	output[index].samples[1] = inputs[index].samples[1]
end
*counter = *counter + storage.input_count
status.completed = 1

while true do
	halt_until_irq
end
```

The copy performs four scalar assignments per record: one `u8`, one word, and
two `u16` fields. It is not a whole-record assignment. The output's three
padding bytes per record remain zero from BSS startup.

### Record indexing is not byte arithmetic

Typed array indices start at zero. `inputs[0]` is the first record and
`inputs[1]` is the second; the second begins **12 bytes** after the first.
Likewise, `output_words[index]` advances by **4 bytes** per index, so the startup
loop visits words 0 through 5.

The offsets in the worked table are relative to `storage.inputs`, the storage address of the linked RODATA array `inputs`. That base is assigned in the linked image; it is not a universal hardcoded address.

| Address operation | Byte address relative to base | What it selects |
| --- | ---: | --- |
| `&inputs[1]` | +12 | Second record |
| `&inputs[0].value` | +4 | First record's word field |
| `&inputs[0].samples[0]` | +8 | First record's first sample |
| `&inputs[1].samples[1]` | +22 | Second record's second sample |
| Add 1 to a byte pointer at base | +1 | A padding byte, not the second record |

The corresponding output fields have the same offsets relative to
`storage.output`. Choose a typed record index when selecting a record; adding
a byte offset selects a byte position instead.

### Results to inspect

<div class="keep-together">

After the copy, the output contains these six words in increasing address
order. They equal the input's six words.

| Output byte offset | Word | Contents |
| ---: | --- | --- |
| 0 | `00000011H` | First tag and three zero padding bytes |
| 4 | `12345678H` | First value |
| 8 | `33441122H` | First record's two samples |
| 12 | `00000022H` | Second tag and three zero padding bytes |
| 16 | `9ABCDEF0H` | Second value |
| 20 | `77885566H` | Second record's two samples |

</div>

| Final item | Value |
| --- | --- |
| `*counter` | `1234567AH` |
| `status.initial_counter` | `12345678H` |
| `status.initial_output_or` | `00000000H` |
| `status.completed` | `00000001H` |

The counter has advanced by the record count, **2**. After setting `completed`,
the program remains in the `halt_until_irq` loop. That loop does not create a
completion interrupt, and the program configures no interrupt source.

These results establish the byte-storage preparation in this example, not a
rendering or asynchronous device-buffer contract. A device-facing use still
needs that device's address and layout requirements, count units, admission
rules, and completion/lifetime contract.
