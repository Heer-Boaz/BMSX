# Memory expansion schematic candidate

This is a separate copy of the existing mainboard project. The schematic adds
U150/U151 private DRAM, U152/U153 snapshot SRAM, their supply bypass capacitors
and a snapshot-select pull-up. U1.50 and U1.101 drive the private RAS and OE;
U2.102 drives the snapshot select. The existing U2.174–U7.62 display-context
link and U7 INPUT remain unchanged.

The separate candidate PCB now contains the four memory devices, twelve
bypass capacitors and select pull-up from this schematic. Their pads and the
three modified ASIC pads carry the corresponding schematic nets. The grouped
placement moves U30 and C500–C502 by 4.5 mm; the remaining baseline footprints
and board outline are retained. There are no tracks, and the 19 inherited zones
are unfilled. This is an unrouted placement, not a DRC, power, signal-timing,
three-dimensional fit or manufacturing qualification. INPUT remains on U7.

To regenerate the candidate PCB from the untouched baseline and the current
candidate XML netlist, run `python3 hardware/tools/sync_memory_candidate.py`
with KiCad's `pcbnew` Python. Its output is written under `hardware/build/`;
no original board is modified. Copy the staged result into this project only
after reviewing it.

The baseline project under `../mainboard/` is preserved. Candidate schematic
PDF and KiCad XML netlist are distributed separately in the exports directory.
