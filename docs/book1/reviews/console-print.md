# System overview — print review

2026-10-18, chapter SHA-256
`70e80c237a661aeb0c6e8d18d28064cf9886881e43437a027b2447fa6039b984`.
Root assembled the prose and authored the two diagrams; this is an actual-page
layout inspection, not an independent factual or reader approval. Those are
recorded separately in the source and reader reports.

## Publication-layout proof

Private proof `/tmp/bmsx-console-release-proof/console.pdf`: 7 pages,
143987 bytes, SHA-256
`4f0d67dd017b8ce795b196e9e06bebb613cd17dec9f3050d9383fc7320cad229`.
It was rendered through the existing publisher in publication layout before
public gate approval, then every PDFium 1.5x page was opened individually and
visually inspected. No CSS, fonts, publisher or runtime implementation changed.

- Page 1: actual Book I System and Hardware Reference running title, chapter
  title, resource/role table and IRQ/reset paragraphs are complete and readable.
- Page 2: timing/input and IMGDEC prose, memory heading and interval introduction
  are intact. The complete address table continues on page 3 rather than being
  clipped or split. The heading retains its introductory paragraphs.
- Page 3: every interval endpoint, exclusive-end parenthesis, indented reservation,
  installed-versus-window distinction and static-layout bullet is legible.
  Wrapped intervals remain inside their cells; no endpoint is lost.
- Page 4: both DMA charge tables, setup/span conditions, concurrency explanation
  and service paragraph are complete; formulas remain inside their cells.
- Page 5: shared-memory and capability table, packed-texel distinction, firmware
  reservation and GTE/GEO resource/job prose remain readable.
- Page 6: GEO service-rate qualification, PCRTC timing/storage text and complete
  selected drawing-to-display route are visible. Arrowheads connect the intended
  boxes; the local-memory/PCRTC path does not cross its labels. The APU heading
  retains its lead paragraph.
- Page 7: complete APU capacity/rate table and source/transfer paragraphs, then
  complete ROM/private-RAM/transfer schematic. No main-RAM-to-voice arrow is
  drawn; live-source and upload paths have separate labels and arrowheads.
- All seven: correct book/chapter labels and folios, clean CONSOLE footer, no
  DRAFT marking, clipped text, horizontal overflow, table-rule collision, lost
  figure label or stranded heading found. Normal end-of-section/table space is
  not filled with artificial prose or forced page-count material.

Engine: Chromium 153.0.8010.12, Node v22.23.1, Linux x64. Receipt: two figures,
zero register-entry blocks, no mechanical layout errors. The mechanical checks
supplement actual visual inspection, not replace it.

## Draft proof

Current `build/manual/console.preview.pdf`: 7 pages, 145075 bytes, SHA-256
`f58a9ba2dafe20357936835bafa2be8c4ddd267d0a850e444ead0907485659af`.
Every page is covered by actual inspection: changed pages 2, 5 and 6 were opened
individually after the final wording fixes; pages 1, 3, 4 and 7 are exact 1.5x
whole-page raster matches to the preceding proof whose every page was already
individually opened. Its DRAFT labels remain explicit.

The diagrams are explanatory schematics, not captured console output, electrical
waveforms, complete bus wiring or performance measurements. This review neither
approves every device contract nor closes whole-volume/newcomer acceptance.
Canonical public-artifact pixel comparison will be recorded after gate approval.

## Independent figure-page visual check

A nonauthor independently opened the complete current publication-proof page 6
and page 7 rasters at original detail. Both diagrams, adjacent prose/tables and
page furniture passed: labels fit, arrows terminate at boxes, the PCRTC path is
unobscured and APU live-source/upload paths remain distinct. It did not inspect
the other five pages, independently verify the supplied PDF hash or audit
hardware correctness. Actual report: `/tmp/bmsx-overview-figure-print-review.md`.
Root's full seven-page inspection above supplies the remaining page coverage.

## Canonical publication confirmation

`manual:check console` and `manual:publish console` passed after all scoped
source/figure/reader/print decisions. Current `build/manual/console.pdf`: 7 pages,
143987 bytes, SHA-256 `2a132a7e69f63e386a2a6af8e42d291312e5bcd855f6e77d290048713db6d3f9`.
All seven complete PDFium 1.5x page rasters are pixel-identical to the private
publication-layout proof whose every page was individually viewed above;
no DRAFT marking remains. The published artifact is therefore covered by that
actual-page acceptance, not merely inferred from an older draft or build exit.
