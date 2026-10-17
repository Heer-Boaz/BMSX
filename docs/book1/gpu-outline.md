# GPU manuscript: paragraph assignments

Editorial work list, not a chapter-local contents page or a publication manifest.
The GPU chapter is not complete. A completed GTE/PCRTC chapter is a usable adjacent
unit reference, not evidence that GPU command admission or pixel behavior is covered.
No new chapter assembler or publishing layer is required.

Hardware facts come only from the scoped mirrored spec leaves and live owners.
Authors receive their paragraph's fact-sheet slice, not the architecture document
or a hardware-reference PDF. An unsourced bit/timing/behavior is a gap, not license
to copy another console. Every assignment includes finished English prose and its
separate derivation/source evidence; another writer later audits its claims.

## Pixel programming paragraphs

| Paragraph | Reader task | Fact-sheet scope | State |
|---|---|---|---|
| P01 | Distinguish raw local-memory words, GP0 words and display samples; place a small image without confusing linear access and PCRTC layouts. | M01–M06 | Draft integrated; independent source/numeric/storage-reader check passes; whole-reader/print pending. |
| P02 | Choose rectangle, line, triangle or quad for its actual coverage/attribute capability. | P01–P04, C01–C04 | Draft integrated; independent source/numeric check passes; command handoff/whole-reader pending. |
| P03 | Predict signed-eleven-bit coordinates, offset and primitive-specific wrap/rejection; program an inclusive drawing area. | X01–X07 | Draft integrated; independent source/numeric checks pass; packet/control handoff pending. |
| P04 | Predict shared-edge, quad diagonal and polyline-joint writes instead of assuming overdraw never occurs. | C01–C04, B02–B03 | Draft and figure integrated; independent source/raster/numeric checks pass; whole-reader/print pending. |
| P05 | Work a nonconstant RGB/UV plane through the actual finite-precision calculation; distinguish affine interpolation from perspective correction. | I01–I04 | Draft integrated; independent source/plane/native-helper/raster checks pass; whole-reader pending. |
| P06 | Predict a steep/vertical colored line's samples, endpoints and clipped color progression. | L01–L03 | Draft integrated; independent source/arithmetic/live-line checks pass; whole-reader pending. |
| P07 | Locate packed/direct textures and palettes in raw words; apply page/window/CLUT wrapping. | T01–T05/T07, M02–M03, GP0F29 | Integrated; independent lookup/source/raster check passes; uploaded-palette example and whole-reader pending. |
| P08 | Clip and flip a textured rectangle without changing its original UV mapping. | T06, X07 | Integrated; independent all-flips/clipping/parity source/raster check passes; whole-reader pending. |
| P09 | Choose raw versus modulated texture color and primitive-specific dither with useful nonidentity values. | Q01–Q04, T07 | Integrated; independent source/numeric/helper check passes; full-reader/print pending. |
| P10 | Predict transparency, semitransparency, destination protection and stored bit15 separately. | T07, B01–B04 | Integrated; independent four-mode/zero/bit15/mask raster check passes; whole-reader pending. |
| P11 | Choose fill, drawing rectangle, raw upload or overlapping copy for their actual size/mask/access-order effects. | V01–V06 | Integrated; independent width/mask/parity/overlap source/raster check passes; whole-reader pending. |
| P12 | Connect sample/overdraw work to sourced command completion costs without inventing a physical raster clock or sustained fill rate. | Pixel timing boundary plus GP0/control timing facts | Integrated; independent math plus actual TS/C++ timing replay57 bounded cases and raster/scheduler contrasts pass; CPU W02 pending. |

## Command-side paragraph assignments

The GP0/GP1 sheets are extracted. Each surface below requires finished prose and
independent checking, not merely a short command catalog. Split every command
family into its own reference paragraph with complete fields/options/results.


| Paragraph | Required surface | State |
|---|---|---|
| S01 | Recognizable technical resource/clock/transfer/completion specifications, without invented physical rates. | Draft integrated; independent resource/access/deadline checks pass; whole-reader pending. |
| S02 | GP0/GPUREAD and GP1/GPUSTAT port maps, accesses/reset and full status fields. | Integrated; independent complete-bit/reset/access/readback check passes; whole-reader pending. |
| S03 | GP1 complete control-command reference00–09, all masks and state effects. | Integrated; independent command/mask/reset/visibility check passes; whole-reader pending. |
| S04 | GP1 info-query aliases/index map and GPUREAD-latch/stream interaction. | Integrated; independent alias/selector/READY/latch review passes; whole-reader pending. |
| S05 | CPU versus DMA readiness, ownership, ingress and fault/access side effects. | Integrated focused DMA staging/BLOCK_END supplement; paired-source review passes; no full DMA workload claim. |
| S06 | Machine reset versus GP1RESET/FIFO-clear, partial upload and readback abort boundaries. | Covered in S02/S03 reset/clear/readback-phase sections; independent control reader-task audit passes. |
| S07 | IRQ marker/controller latches, suppression, acknowledgements and queue ordering. | Covered in S03/P12/W01; idle-alone non-IRQ fact added; final whole-reader pending. |
| S08 | GPU display-compatibility state versus actual PCRTC publication. | Covered in function/S02/S03/S04/W01 programmed-versus-presented boundaries; reader-task audit passes. |
| C01 | Complete GP0 framing/opcode map, ignored/NOP/unmatched command semantics. | Integrated; independent all256-opcode/parser/phase check passes; whole-reader pending. |
| C02 | Flat untextured triangle/quad packets. | Integrated; independent eight-alias/mask/coverage/raster/timing check passes; whole-reader pending. |
| C03 | Gouraud untextured triangle/quad packets. | Integrated; independent packet/plane/interior-sample/timing check passes; whole-reader pending. |
| C04 | Flat textured triangle/quad packets and persistent T1 page update. | Facts extracted; author pending. |
| C05 | Gouraud textured triangle/quad packets. | Facts extracted; author pending. |
| C06 | Finite flat/Gouraud line packets. | Facts extracted; author pending. |
| C07 | Flat/Gouraud polyline framing, vertex-phase termination and state lifetime. | Facts extracted; author pending. |
| C08 | Fixed/variable flat and textured rectangle packets, zero extents and flips. | Facts extracted; author pending. |
| C09 | Fill packet and its different alignment/extent/mask effects. | Facts extracted; author pending. |
| C10 | Raw upload packet, counted payload, odd tail and partial completion. | Facts extracted; author pending. |
| C11 | Raw readback header, pending/submitted/ready, ownership, odd tail and release. | Facts extracted; author pending. |
| C12 | Raw copy packet, size normalization and overlapping traversal. | Facts extracted; author pending. |
| C13 | E1 draw-mode fields and interaction with polygon T1. | Facts extracted; author pending. |
| C14 | E2 window/E3–E4 area/E5 offset/E6 mask words and snapshot edge. | Facts extracted; author pending. |
| W01 | Actual BIOS-style BLua cartridge: authored operands, commands, pixels, readback and display hand-off. | Integrated exact cartridge; independent code/prose review, actual guest odd readback/witness plus14 raw probes and capture pass; whole-reader pending. |
| W02 | Complete CPU issue/queued completion/readout work intervals, not only per-command tick formulas. | Facts extracted; executable schedule outstanding. |


## Completion evidence

A usable chapter must have its complete command/register operation reference,
programming route and technical specifications, not merely no false statements.
Independent source/numerical checks, actual cartridge execution, whole-reader
review and actual PDF inspection remain separate acceptance evidence. Review flags
must remain pending until that evidence exists; page count is not a completion test.
