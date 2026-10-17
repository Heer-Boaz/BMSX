# IRQ manuscript: paragraph assignments

Editorial work list, not a chapter-local contents page or a publishing manifest.
The unit is the three-word installed interrupt controller and its CPU-delivery
boundary. Cartridge-source bits may be named; socket/device programming is Book II.
The fact sheet freezes source facts before authorship. Actual BIOS examples supply
the BLua storage, MMIO and waiting patterns; they are not invented cartridge APIs.

| Paragraph | Reader task and source scope | Status |
|---|---|---|
| P01 | Separate pending latches, enable mask, ACK and output line; predict masked retention, coalescence and selective clearing. ICF01–09. | Integrated; independent source/numeric, whole-reader and final print checks pass. |
| P02 | Understand CPU acceptance, full `irq(flags)` delivery, STATUS/CAUSE/EPC, return and predicate-based HALT waiting. CPU-I01–12/I16–21; BIOS B02/B05/B06/B09/A08/I07. | Integrated; independent source/numeric, whole-reader and final print checks pass. |
| R01 | Use complete address/access/reset/bit references; distinguish retained unnamed bits, read-zero ACK, write-one clear and accepted-write visibility. ICF01–10, IRQ-S04. | Integrated; independent source/bit/access replay and final print checks pass. |
| P03 | Distinguish producer-local acknowledgement from controller ACK; order service to respect re-arming and one-bit coalescence; do not mistake a dispatcher policy for hardware priority. GPU G01–05, BIOS B03–06/D01–04, controller ICF04/07/08 and CPU-I12–15. | Integrated; independent source/reader/rearming/race and final print checks pass. |
| W01 | Execute a real BIOS-style cartridge: retain disabled VBlank, coalesce two GPU markers, enable one source, preserve masked flags and re-arm a second service. BIOS/CPU/controller sheets and IRQ-S01–02. | Integrated exact executable modules; ordinary guest phase assertions, independent reader/source review and final print checks pass. |
| T01 | Recognize resources and system-cycle timebase; separate instruction base cost from full request/vector/handler costs and undefined electrical guarantees. ICF01–09, CPU-I19–21, IRQ-S03. | Integrated resource/timebase/base-cost and qualified actual-ROM9/6 entry budget; independent review and final print pass. |
| F01 | Distinguish bad access from source requests, and reset from selectively clearing state. ICF02–05/11, IRQ-S04 and existing common mapped-access contract. | Integrated; independent source and TS/C++ mapped fault/reset replay pass. |

## Acceptance evidence

Independent source/numeric and whole-reader reviews, actual TS/C++ mapped replay,
ordinary compiled-cartridge execution and every final PDF page are accepted in
`reviews/irq-source.md` and `reviews/irq-print.md`. No new chapter assembler,
publisher branch or runtime helper was added. All ten W01 printed blocks reproduce
the two executable modules. The cycle table is deliberately example-specific;
page count is not the completeness test. Book I as a whole is not complete.
