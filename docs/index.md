# About these manuals {.unnumbered}

The BMSX Developer Reference describes the console, its programming architecture
and the interfaces available to cartridge software. The three books separate
installed hardware, processor and firmware programming, and cartridge devices.

**Book I — System and Hardware Reference** introduces the machine and its
memory system, drawing and display units, audio, direct memory access,
interrupts and peripheral control. Start with the system overview, then consult
the individual unit chapters for programming sequences and reference details.

**Book II — BLua32 and BIOS Reference** describes the processor, instruction set,
BLua language extensions and resident BIOS services. It supplies the program
and data representations needed to implement cartridge software.

**Book III — Cartridge and Expansion Reference** describes cartridge sockets
and mapped card devices, including their memory and interrupt interfaces.

Addresses are byte addresses unless stated otherwise. Register descriptions
give bit positions within the named word; binary layouts give byte offsets
within the described structure. Capacities, units and synchronization conditions
are specified with the interface to which they apply.
