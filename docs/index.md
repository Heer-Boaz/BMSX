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

The BMSX is programmed in BLua, which its processor executes directly. System
ROM holds the BIOS: startup, the standard library, the compiler for text and
the monitor. This volume describes the language, the BIOS functions, the
program format and the instruction set.

Begin with Chapter 1 for the system and Chapter 2 for the language. The BIOS
chapters follow; the last chapters give the program format and the
instructions, for machine code and program tools.

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

**Book II — BLua32 and BIOS Reference** describes BLua, the language of the
console, and the BIOS in System ROM: the standard library, the compiler for
text and the monitor. It begins with the BLua system and the language; the
program format and the instruction set, for machine code and program tools,
come last.

**Book III — Cartridge and Expansion Reference** describes cartridge sockets
and mapped card devices, including their memory and interrupt interfaces.

Addresses are byte addresses. Register tables give bit positions within the
word; record layouts give byte offsets within the record.

Hexadecimal quantities use uppercase digits and the suffix `H`. Program
fragments retain the notation of their language, including BLua hexadecimal
literals beginning with `0x`.

:::
