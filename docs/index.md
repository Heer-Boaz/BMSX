# About these manuals {.unnumbered}

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

**Book III — Cartridge and Expansion Reference** describes cartridge sockets
and mapped card devices, including their memory and interrupt interfaces.

Addresses are byte addresses unless stated otherwise. Register descriptions
give bit positions within the named word; binary layouts give byte offsets
within the described structure. Capacities, units and synchronization conditions
are specified with the interface to which they apply.
