# System overview — merged source-review record

Current public chapter SHA-256:
`70e80c237a661aeb0c6e8d18d28064cf9886881e43437a027b2447fa6039b984`.
Bounded prose and SVG source checks pass after the corrections below. Print
and reader evidence are separately accepted, not substitutes for source review.

## Authorship and independent checks

Three independent facts-only authors supplied the memory/DMA, control, and
video/audio sections. They received their finite fact sheets, not an architecture
document, reference PDF or other chapters. Root merged these sections, added
editorial scope/navigation, the independently checked firmware reservation,
the two sourced rate statements and the selected-route figures. No new runtime,
BIOS/compiler behavior, publisher, helper, validation or harness was introduced.

| Scope | Actual independent evidence |
| --- | --- |
| Address windows, installed RAM, reservations/statics, mapped access and DMA | [Memory source review](console-memory-source.md). The bounded audited draft supplies the memory prose; root navigation/wording refinements add no new fact. The substantive public-reader concurrency correction is independently covered below. |
| CPU timebase, IRQ, SYSTEM, INPUT and IMGDEC | [Control source review](console-control-source.md). All three initial prose findings were corrected. The later removal of an internal capture timestamp is recorded, not presented as a cartridge-visible value. |
| Firmware terminal/system-texture VRAM reservation | [Reservation source review](console-reservation-source.md), checked directly against BIOS/export/terminal/cartlib owners. Final public paragraph differs only in link/quotation markup. |
| Graphics/audio prose and root opening/rate/control/input/DMA deltas | [Final video/audio source review](console-video-audio-source.md), recording the current complete chapter hash and exact inspected ranges. Includes actual paired GEO work-budget/PCRTC reference-rate and channel-versus-block checks. |
| Selected-route SVG titles, descriptions, labels and arrows | [Independent figure source review](console-figures-source.md), with both actual SVG hashes and paired datapath/spec ranges. No electrical or PDF-layout certification. |
| Complete public-reader orientation | [Source-blind reader](console-reader.md): both initial visibility/concurrency findings closed, no remaining bounded orientation failure. No source/runtime truth claim. |
| Actual PDF layout | [Print review](console-print.md): every page inspected; independent added figure-page check. Not source/runtime proof. |

## Corrections, not hidden behavior changes

- DMA classified spans, not merely a common Cartridge region kind, bound the
  single-span examples. ROM/RAM/MMIO boundaries reapply setup.
- CPU consumes the shared IRQ line; it is not a named IRQ-producing source.
- Accepted INPUT capture consumes its request latch, not the retained ARM word.
  Its internal recorded cycle is not offered as a public observation.
- IMGDEC DATA reads have CPU/DMA-port-ownership and empty-FIFO exceptions.
- Both DMA channels may have outstanding transfers; only one block is admitted.
- Indexed texture coordinates select packed texels, not one raw word per texel.
- The stereo biquad stage is optional, not unconditionally enabled.

Affected fact-sheet oversimplifications were corrected at the producer evidence,
not papered over by a runtime workaround. No live owner/spec disagreement arose
in the admitted finite facts. Passing these prose checks does not certify every
backend, arbitrary metadata, physical electrical properties or full runtime
parity. Current paired software owners/specs remain the authority.

## Remaining acceptance boundary

This chapter is an opening resource/routing reference, not a replacement ISA,
register/API catalog, executable tutorial or complete developer guide. Owning
chapter links carry those contracts. Physical pin/rating/bus-clock/CPU-wait-state
numbers are not invented from another console or from scheduled DMA charges.
The common Table-length STOP, CPU7, BZ01, remaining language/environment/BIOS,
cartridge/expansion, SDK/debugging, book-level navigation and whole-console
newcomer acceptance remain open in the existing manual inventory.
