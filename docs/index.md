# Reader's guide {.unnumbered}

::: {.content-visible when-profile="book-i"}

The BMSX console combines a programmable processor with dedicated units for
geometry, drawing, display, sound and data transfer. This volume describes
their operation and the registers and data formats used to control them.
It is intended for programmers developing cartridge software.

Begin with the system overview and memory map. The interrupt and DMA chapters
describe the shared service mechanisms; each unit chapter then explains its
operation, programming sequences and complete register reference.

For the BLua32 instruction set and resident BIOS services, use Book II.
Cartridge socket selection and mapped card devices are covered in Book III.

:::

::: {.content-visible when-profile="book-ii"}

BLua32 provides the processor instructions and language facilities used by
BMSX cartridge programs. The resident BIOS supplies callable services for
program loading, diagnostics and common operations. This volume specifies
those interfaces and the program-image formats they use.

For BLua programming, begin with Chapter 2. For instruction encoding, begin
with Chapter 1 and the program-image reference in Chapter 3. Each BIOS entry
specifies its call, arguments, results and effects.

Physical memory mapping and hardware control are covered in Book I.
Cartridge sockets and mapped card devices are covered in Book III.

:::

::: {.content-visible when-profile="book-iii"}

A BMSX cartridge may contain ROM, writable memory, mapped devices or a combination
of these resources. This volume specifies how software selects a socket and accesses
the card's address windows and mailbox interface.

The cartridge chapter introduces socket selection before describing the
address map, bus access, registers and interrupt service.
Use Book I for the console memory map and DMA controller, and Book II for
program-image records and startup.

:::

::: {.content-visible when-profile="book-iv"}

This volume describes the proposed BMSX console construction, its external
connections, internal organisation and service access. Begin with the system
organisation and construction, then use the connection and service chapters
for the relevant interface or assembly.

The reference construction is not an assembled or qualified product. Books
I–III specify the current programming and cartridge interfaces.

:::

::: {.content-visible when-profile="html"}

The BMSX Developer Reference describes the console, its programming architecture
and the interfaces available to cartridge software. The three books separate
installed hardware, processor and firmware programming, and cartridge devices.

**Book I — System and Hardware Reference** introduces the machine and its
memory system, drawing and display units, audio, direct memory access,
interrupts and peripheral control. Start with the system overview and memory
map. The interrupt and DMA chapters explain the shared service and transfer
mechanisms used by the individual units. Each unit chapter then gives its
operating explanation, programming sequences and complete technical reference.

**Book II — BLua32 and BIOS Reference** describes the processor, instruction set,
BLua language extensions and resident BIOS services. It supplies the program
and data representations needed to implement cartridge software. The BLua
chapter explains the source-language extensions; the CPU chapter is the
instruction reference. Program images and startup have their own chapter,
separate from physical memory mapping. BIOS diagnostics describes console
output, source and frame inspection, and the optional records that support them.

For BLua source programming, begin with the language-extensions chapter and
use the CPU chapter for the underlying operations and timing. For instruction
encoding or independent code generation, begin with the CPU and program-image
references. The startup chapter explains the state established before
application entry; the BIOS chapters specify callable services available to
that application.

**Book III — Cartridge and Expansion Reference** describes cartridge sockets
and mapped card devices, including their memory and interrupt interfaces.

Addresses are byte addresses unless stated otherwise. Register descriptions
give bit positions within the named word; binary layouts give byte offsets
within the described structure. Capacities, units and synchronization conditions
are specified with the interface to which they apply.

Hexadecimal quantities use uppercase digits and the suffix `H`. Program
fragments retain the notation of their language, including BLua hexadecimal
literals beginning with `0x`.

:::
