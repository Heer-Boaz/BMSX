# Developer-manual series organization

The books describe the product presented to independent BMSX developers.
Historical manufacturer publications inform organization and exposition only;
they do not supply BMSX facts or dictate another console's chapter order.

## Adopted working series and current chapter map

| Volume | Scope |
|---|---|
| **Book I — System and Hardware Reference** | Console overview, installed resources, memory/address ownership and programmable hardware units. Explain data flow and operating procedures before the full device references. |
| **Book II — BLua32 and BIOS Reference** | Processor architecture and instruction set, BLua extensions and installed BIOS interfaces. Keep signatures, representations, units, results and errors beside the operations they define. |
| **Book III — Cartridge and Expansion Reference** | Cartridge connections, mapped devices and expansion protocols. Link shared address/startup definitions instead of copying them. |
| **Repository development companion** | Optional supplied builders, converters, examples and checkout-specific workflows. Outside the manufacturer reference books and not a prescribed SDK. |

[volumes.json](volumes.json) owns titles; [catalog.json](catalog.json) owns
membership. CPU/BLua32 architecture belongs in II. Memory remains in I and is
cross-referenced where source storage or image construction needs it. The
`docs/book1/` source directory does not classify its contents as Book I.

`cartlib` and project packers/converters are independent studio software.
Their APIs and formats are not part of the official console or BIOS reference.
A programmer should be able to implement competing tools from the actual public
instruction, image, device and firmware specifications.

## Explanation, programming and reference

A system overview establishes the machine and its resources. A device chapter
explains what a unit does, shows its datapath and relationships, teaches the
necessary programming/synchronization sequence, then supplies complete lookup
material. Registers alone do not teach a unit; a long diagnostic program does
not replace a programming explanation.

A language/BIOS reference has a different shape: source form or signature,
arguments and units, returned values, effects, errors and a useful example.
General Lua instruction is not the priority. Cover BLua-specific forms explicitly
and link canonical numeric, memory and call definitions rather than duplicating
them. Useful hardware examples stay with the hardware chapter even though they
are written in BLua.

## Historical manufacturer references

Use originals with known provenance, and distinguish later editions and
consumer operation manuals from developer references. Do not attach a large
foreign hardware PDF to chapter-writing prompts. Supply a short style brief and
verified BMSX facts instead.

| Reference | Editorial lesson |
|---|---|
| Sony [GTE & Advanced Graphics, Fall 1996](https://psx.arthus.net/sdk/Psy-Q/DOCS/TRAINING/FALL96/gte.pdf), opening hardware and mathematics sections | Explain the unit's purpose, coordinate spaces, processing stages and worked transformation before low-level programming. This is period developer training, not a BMSX specification. |
| Nintendo [SNES Book I](https://archive.org/download/SNESDevManual/book1.pdf) and [Book II](https://archive.org/download/SNESDevManual/book2.pdf) | Separate system topics and expansion material, with operation diagrams, procedures and reference detail. Historical book numbering is not a universal taxonomy. |
| Sony [PlayStation Hardware, August 1998](https://psx.arthus.net/sdk/Psy-Q/DOCS/Devrefs/Hardware.pdf) and [Run-Time Library Reference, January 1999](https://psx.arthus.net/sdk/Psy-Q/DOCS/Devrefs/Libref.pdf) | Hardware overview and software API reference are distinct publications. Later editions are useful comparison material but must not be described as 1994–1996 originals. |
| Supplied `V9938-programmers-guide.pdf` and `z80cpu_um.pdf` | Device access procedures and systematic instruction/register entries complement conceptual explanation. The supplied V9938 edition was reworked in 2010/2011; do not mistake its typography for an untouched original. |
| Supplied `s3527datasheetenglish.pdf`, `z8400.pdf` and `HB-75 computer.pdf` | Component data sheets and consumer instructions serve different readers. Neither justifies inventing BMSX electrical ratings or treating user operation as a developer API reference. |

The supplied files are under `docs/examples`. The historical comparison supports
editorial choices; it is not proof of BMSX technical accuracy, completeness or
print quality. No verified original NES developer manual is assumed.

## Canonical cross-unit definitions

- [CPU and BLua32](../book1/cpu.md): instructions, values, calls, arithmetic,
  execution control and processor faults.
- [Memory and program storage](../book1/memory.md): addresses, reservations,
  storage layouts, executable images and startup placement.
- [BLua source](../book1/blua-programs.md): language extensions and source use.
- Device/BIOS chapters: their own commands, data formats, synchronization,
  results and errors, linking the shared foundations where necessary.

Avoid duplicated partial definitions, repository-based assumptions and examples
that require reverse-engineering an external library. Preserve useful diagrams,
short sequences, numerical calculations and actual output plates.

## Publication

Complete content before detailed chapter review and print polishing. Apply the
six reader-quality criteria in the [authoring guide](README.md), in addition to
source checking. A correct catalog entry, a successful render or a page count
is not publication approval. Retain the existing publisher and review records;
no per-chapter pipeline, extra status-document hierarchy or new approval schema
is needed. Source and final print acceptance remain separate.
