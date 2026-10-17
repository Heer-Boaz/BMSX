# DMA manuscript: paragraph assignments

Editorial work list, not a public contents page or a publishing manifest.
The installed two-channel DMA unit is this chapter's scope. Cartridge request
selectors may be named; socket/card-device programming remains Book II.

Facts come from the scoped mirrored leaves and live owners. Authors receive a
frozen fact-sheet slice, not the architecture document or historical reference
PDF. Real BIOS BLua supplies the source-language pattern; private firmware
requires are not invented cartridge exports. No new publishing layer is needed.

| Paragraph | Reader task | Required source scope | State |
|---|---|---|---|
| P01 | Identify installed resources, word transfers, the shared transfer path and what DMA does not complete for another unit. | DMR/DMT public unit facts; reviewed GPU/IRQ boundary facts. | Integrated; independent source/reader and final print checks pass. |
| P02 | Program incrementing memory versus a fixed device port; choose requests and block size, then issue START with correct ownership. | DMR control/request/count/trigger; DMP actual request wiring; DMB actual firmware operands. | Integrated; independent source/reader and final print checks pass. |
| P03 | Distinguish programmed words from one admitted block; predict visibility, remaining count and writes made while BUSY. | DMR backing-word readback; DMT admission/service snapshots and register updates. | Integrated; independent source/reader and final print checks pass. |
| P04 | Schedule both channels without mistaking block arbitration for simultaneous buses or source priority. | DMT arbitration, selection, deadlines and independently derived trace. | Integrated; independent source/reader and final print checks pass. |
| P05 | Distinguish DREQ, port reservation, admitted data movement and CPU port readiness; use finite streams without inventing safety checks. | DMP request/CPU/GPU/APU/IMGDEC boundary facts. | Integrated; independent source/reader and final print checks pass. |
| P06 | Observe DMA completion, deliver/acknowledge its IRQ, and separately fence the destination's work. | DMR/DMT DONE and IRQ; published IRQ/GPU; DMB firmware wait sequence. | Integrated; independent source/reader and final print checks pass. |
| R01 | Use all twelve address/access/reset/bit references, including retained fields, selector values and trigger/read-only behavior. | Complete DMR sheet, scoped DMP mapped access. | Integrated; independent source/reader and final print checks pass. |
| T01 | Budget installed per-region transfers, setup, block tails, crossings and channel sharing in system cycles. | DMT installed model and complete cost equations; no invented electrical ratings. | Integrated; independent TS/C++ numerical replay, source/reader and final print checks pass. |
| T02 | Convert route charges into word/byte rates; account for block size, request gaps and competing blocks; distinguish GPU-port transport from VRAM data readiness. | Fresh paired DMA/model/classifier and GPU ingress/upload/readback facts; explicit rate assumptions and independent arithmetic/replay. | Integrated; independent source/math/whole-reader review, paired controller replays and complete final PDF review pass. |
| F01 | Diagnose bus faults without treating DONE as error-free success; distinguish reset, disabled requests and in-flight work. | DMR reset/status; DMP mapped faults; DMT progress and snapshot lifetime. | Integrated; independent source/reader and final print checks pass. |
| W01 | Execute BIOS-style ROM/RAM and two-channel copies with real typed operands, retained observations and completion predicates. | Frozen DMR/DMT/DMP/DMB facts; ordinary guest-testing contract. | Implemented and executed through ordinary cartridge startup; final source/reader and print checks pass. |
| W02 | Submit a real ROM command stream to fixed GP0; observe DMA completion separately from GPU marker/idle and actual pixel data. | Frozen DMA facts plus already-reviewed GPU packet/request/IRQ facts. | Implemented and executed through ordinary cartridge startup; final source/reader and print checks pass. |

## Acceptance work

Finished prose and separate evidence are required for each assignment. Merge
without adding unsourced bits or timing. Run independent source/numeric and
whole-reader checks, actual ordinary guest execution, scoped TS/C++ replay and
visual inspection of every final PDF page. Keep publication reviews open until
their actual checks close. Page count and a green builder are not completeness.

Earlier completed chapters are PCRTC, GTE, GPU and IRQ. The handbook as a whole
remains unfinished; this work list does not redefine completion around DMA alone.

The initial DMA assignments passed acceptance. T02 is the requested technical
completeness follow-up and is not covered by those earlier approvals. The
installed handbook as a whole remains in progress; no additional publication
framework was added.
