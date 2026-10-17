# DMA print acceptance

Print/layout review accepted for the final chapter. Source and programming
acceptance is recorded separately in [dma-source.md](dma-source.md); this is not
an acceptance of unfinished Book I as a whole.

## Actual PDF review

The existing publisher rendered a private publication-mode proof with the same
chapter loader, stylesheet, bundled fonts and Chromium PDF path as publication.
All 15 actual PDF pages were rasterized at scale1.4 (834×1179 pixels) and viewed
at original raster detail, not accepted from Markdown, HTML or a contact sheet.
Changed pagination was rerendered and every changed page was viewed again;
unchanged pages retained pixel-identical raster evidence. All fifteen published page rasters are pixel-identical to this inspected
proof after publication.

| Pages | Inspected surface |
|---|---|
| 1 | Installed-resource table, separate captured-configuration/live-payload paths, arrowheads, service/writeback caption |
| 2–4 | Launch procedure, CONTROL equation and raw words, all12 addresses, full CONTROL fields, request encodings, STATUS/TRIGGER |
| 5–6 | Config/payload lifetime, sequential overlap table/trace, BUSY rewrites |
| 7–8 | Exact request predicates, CPU/DMA readiness, faults/reset, completion IRQ table |
| 9–11 | Cycle unit, installed region costs/setup, readable word equations, numeric examples and full two-channel schedule |
| 11–12 | Complete-program assumptions, two-module assembly, three phases and retained BSS record |
| 13–15 | Complete entry listing, typed ports/ROM operands, IRQ/HALT protocol, both memory copies and distinct GPU waits, interpreted results |

Request-encoding and device-predicate headings/introductions remain with their
tables. The span-equation introduction remains with its equation, and the
region-cost introduction remains with its table. These are ordinary authored
`keep-together` groups using the existing stylesheet, not new publisher logic.
The completion paragraph was shortened to remove a one-line page continuation.
No stylesheet, font, figure framework or publishing gate was added or changed.

The existing layout receipt reports one SVG, no horizontal overflow, no
unbreakable block exceeding a page and no figure text outside its viewBox.
These automated checks supplement, not replace, the visual inspection. The
six printed BLua blocks reproduce the actual two-module cartridge after
whitespace normalization; all blocks fit without clipping or font reduction.
The figure has configuration control flowing down to service and source data
flowing read→write; no false single-bank writeback arrow remains.

No ASCII-space bit columns or diagrams are used. No source provenance, tooling
commands or runtime implementation narrative appears in the public manuscript.
Page count is recorded only to identify the inspected artifact, not to prove
instructional completeness.
