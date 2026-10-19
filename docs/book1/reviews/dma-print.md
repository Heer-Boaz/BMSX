# DMA print acceptance

## Reader-first opening — 2026-10-19

The new hardware overview precedes the retained specification table. The current
publication-layout acceptance is recorded at the end of this file.
Content/source/reader checks remain separate from final print.
PDF navigation/viewer work is deferred while content takes priority.

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


## Cartridge-selector onramp correction — 2026-10-18

Final publish-mode proof: `/tmp/bmsx-dma-selector-proof/dma.pdf`,17pages,
SHA256 `d1b0e196c61765e95a6b7327e1d64fa03502de1aaab2bc1b4658f8d83a876319`.
Source SHA256: `eca43deb48ee79ad6fabb991f54a3d02189b3a5088ffb806117532575d20a093`.
Pages1–3 and7–17 match the previously individually accepted17-page baseline
9348b608… in complete decoded RGBA bytes and dimensions, including running
matter. Root individually viewed original final4/5/6: selector/control tables,
corrected printed Book III title/subsection, paragraphs/continuations, overlap
example, headings, borders and full running matter fit without clipping,
collision or isolated table lead. Normal two-line prose continuation5→6 remains
readable. Record `/tmp/bmsx-dma-selector-print/identity.json`.
No source/print framework, helper, font, CSS or publisher changed. Source and
fresh public-reader acceptance are separate in dma-source.md; no new whole-
program or hardware-rate guarantee is inferred from layout acceptance.

Ordinary DMA check/publication pass. All17 canonical pages equal the accepted
proof in full decoded RGBA and dimensions, record
`/tmp/bmsx-dma-selector-published-identity.json`. Canonical SHA256:
`1b0091883999293fa247b97e2168e320bb1428ee41b6640909af0bd39284d46d`.
Logs `/tmp/bmsx-dma-selector-manual-{check,publish}.log`; existing manual19test
regression log `/tmp/bmsx-gpu-startup-manual-tests.log`. No whole-book/SDK or
portable-navigation approval is implied. `git diff --check` passes.

## Independent-hardware publication — 2026-10-19

Accepted final publication-layout proof `/tmp/bmsx-manual-final-print/dma.pdf`:
17 pages, SHA256 `b774d28f025251d31d207ab3455f4e0a09307101dd5bac0b3bce1fa290d6cae7`.
Page 1 was individually viewed at original detail. Pages 2–9 are covered by exact
nonoverlapping RGBA regions: body from the individually inspected current
preview, top band from an inspected preview/publication, bottom from the
accepted publication. Pages 10–17 match the accepted publication completely.
PDFium 156.0.8076.0, scale 1.4; Chromium 153.0.8010.12, Linux x64.
The hardware opening, table, complete page boundaries and running matter are
clean. No source or portable-navigation acceptance is inferred from print.

All canonical publication pages match this accepted proof in complete decoded
RGBA and dimensions at scale 1.4; ordinary publication passes.
