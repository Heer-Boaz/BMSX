# INPUT and memory schematic candidate

This separate project extends the R127 memory candidate by moving the INPUT
interface from U7 to U2. The existing cartridge, keyboard and pad connector
pinouts remain unchanged. Snapshot selection remains on U2.102. The original
U2.174–U7.62 display-context connection becomes internal to U2. U7 continues
to serve firmware ROM on the shared system bus.

The included PCB is a separate copy derived from the R127 memory candidate.
Its pad-net assignments match this schematic; it has no routed tracks and
its inherited zones remain unfilled. The U2 INPUT/graphics arbitration, context
transfer and CORE VBlank receiver require separate implementation. Neither the
schematic nor PCB proves completed ASIC logic, electrical timing, assembly fit
or manufacturability.

To regenerate its PCB from the unchanged R127 memory candidate and this
candidate's XML netlist, run `python3 hardware/tools/sync_input_candidate.py`
with KiCad's `pcbnew` Python. The script writes a staged result under
`hardware/build/` and does not modify either source project.
The baseline and R127 projects are retained unchanged.
