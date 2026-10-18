# DMA print acceptance

## Volume-title revalidation — 2026-10-18

Current canonical publication artifact `build/manual/dma.pdf`:
17 pages, SHA-256 `9348b608be7582384bbe24046e3dde2a02b0b26b2aa55bcc747bf1a11376fac8`.
Pages 1, 4 and 7 were independently viewed; all other body pages match the accepted publication proof.
All header bands match the fully reviewed new preview; clean chapter footers,
folios and absence of DRAFT were independently verified. Current-PDF rasters
and retained-pixel accounting passed. Evidence:
`/tmp/bmsx-volume-publication-delta-review.md`. This renews layout evidence only;
source/coverage decisions and whole-volume acceptance are unchanged.

Current `build/manual/dma.preview.pdf`: 17 pages, SHA-256
`c44494bc907a9d6bb000ca4afc546074bfbac1ded13299585ea3daf17f8ea5b8`.
A nonauthor individually inspected every full PDFium1.4× page1–17 at readable
size. The Book I System and Hardware Reference header fits; BMSX, chapter/DRAFT
footer, folios, complete tables, diagrams and program parts remain readable
without clipping, overlap or lost labels. The corrected cartridge-reference pages4/7 were independently reopened; every
other page raster matches the already inspected candidate. Evidence:
`/tmp/bmsx-volume-small-hardware-print-review.md`. Existing Chromium153.0.8010.12,
Nodev22.23.1/Linuxx64, no receipt layout errors. This renews print-layout evidence,
not technical coverage or whole-series publication approval. Historical
publication/draft evidence follows.

Print/layout review accepted for the current chapter, including T02. Source
and programming acceptance is separate in [dma-source.md](dma-source.md); this
is not an acceptance of unfinished Book I as a whole.

## Actual PDF review

The existing publisher rendered a private publication-mode proof with the same
chapter loader, stylesheet, bundled fonts and Chromium PDF path as publication.
All17 actual PDF pages were rasterized at scale1.4 (833×1179 pixels) and viewed
at original raster detail, not accepted from Markdown, HTML or a contact sheet.
The header-count reader correction changed pages12–13; both were rerendered and
viewed again. A paragraph break then kept upload and readback explanations
separate across that page boundary; both changed pages were viewed again.
Every other page remained pixel-identical to the already inspected proof.

| Pages | Inspected surface |
|---|---|
| 1 | Installed resources, captured-configuration versus live-payload paths, arrowheads and service/writeback caption |
| 2–4 | Launch, CONTROL equation and raw words, all12 addresses/access/reset, full bit fields, request encodings, STATUS/TRIGGER |
| 5–6 | Configuration/payload lifetime, sequential overlap trace and BUSY rewrites |
| 7–8 | Request predicates, CPU/DMA readiness, faults/reset and completion IRQs |
| 9–10 | Cycle basis, region setup/word costs, span equations and single-channel examples |
| 11 | Full16-word route-rate table and units, all-I/O minimum/caution, block-size rates and finite tail |
| 12 | Explicit request-gap denominator, complete two-channel schedule, separate GPU-local versus mapped-port route and upload packing |
| 13 | Readback READY/count, upload/download transport budgets and limits, complete-program assumptions and start of phase descriptions |
| 14–17 | Remaining phases, complete BSS module and five entry parts, ROM operands, IRQ/HALT predicates, copies, separate GPU waits and interpreted results |

Tables, equations and all six BLua code blocks fit without clipping or font
reduction. The route table has separate cycles, Mword/s and decimal MB/s
columns. The all-I/O number and its minimum-charge limitation are on the same
page. The image table distinguishes35 command-plus-image words from32 returned
payload words, and keeps all three DMA budgets together. No heading is stranded
from its introductory text. Ordinary paragraph flow, not new publisher logic,
keeps upload/readback explanations readable at the page break.

The layout receipt reports one SVG, no horizontal overflow, no unbreakable
block exceeding a page and no figure text outside its viewBox. The existing
figure is unchanged; its two channel inputs, captured configuration and live
read→write route remain legible. Automated checks supplement, not replace,
actual page inspection. No ASCII-space bit columns, provenance/tool commands,
or runtime implementation narrative appears in the public manuscript.

The canonical publication's17 page rasters were compared with this inspected
proof and are pixel-identical. Page count identifies the reviewed artifact,
not instructional completeness. The wider technical audit and actual graphics
output illustrations remain separate scheduled work. No publisher, stylesheet,
font, figure framework or publication gate was added or changed.

## Shared PNG publisher revalidation — 2026-10-17

Print was reopened for the central PNG extension. Fresh publication-mode proofs
before and after the final publisher change have all 17 page rasters
pixel-identical at scale 1.4; this SVG-only chapter has no changed printed
content. Chromium 153.0.8010.12, the bundled fonts and existing SVG styling
are unchanged. The actual-page acceptance above therefore remains applicable;
this comparison is not a new factual review or an output-image claim.
