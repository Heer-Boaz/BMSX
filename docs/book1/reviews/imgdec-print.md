# IMGDEC print acceptance

## Current hardware-only edition — 2026-10-19

**Print PASS:** all 27 actual publication-mode pages were independently viewed
at original readable detail, PDFium 1.4× (833×1179). Proof:
`/tmp/bmsx-manual-final-hardware/imgdec.pdf`, SHA-256
`0c6d2892f13cda19c7f855fad6c672bb29282dff6320e26b3814f5a68f9ab39d`.
Source SHA-256: `b23918e7e484e81d767310e4b1608ff23d5959ffdc0d5e21edfb091f43c4bad4`.

The hardware opening, complete port/stream/timing/fault tables, datapath figure,
all program parts and actual indexed-patch image with its caption are legible
and bounded. No clipped field/code, broken drawing, separated image/caption or
unusable page break was found; no layout edit or repeat screenshot round was
needed. Rasters: `/tmp/bmsx-imgdec-final-print-pages/001.png` through `027.png`.

Chromium 153.0.8010.12, Node v22.23.1/Linux x64; PDFium 156.0.8076.0 via
pypdfium2 5.14.0. The two-figure layout receipt has no mechanical errors.
This supersedes earlier current-artifact counts and the pending print decision,
not source/figure/execution evidence or whole-series release acceptance.

Normal chapter check/publication and all 27 manual tests pass. All 27 canonical
pages equal the accepted proof in complete decoded RGBA bytes and dimensions;
canonical SHA-256: `879babef22ecdf96116cde1c64a5ab919f340d6eb87a20b0098eab7c0a9f0b01`.
Evidence: `/tmp/bmsx-manual-final-hardware/canonical-identity.json`.

## Volume-title revalidation — 2026-10-18

Current canonical publication artifact `build/manual/imgdec.pdf`:
25 pages, SHA-256 `e4a60c4d7f4527885f2f28ca646e47ae85a1b56a9f746a076a17c561b95f7837`.
Page 1 was independently viewed; every body page matches the accepted publication proof.
All header bands match the fully reviewed new preview; clean chapter footers,
folios and absence of DRAFT were independently verified. Current-PDF rasters
and retained-pixel accounting passed. Evidence:
`/tmp/bmsx-volume-publication-delta-review.md`. This renews layout evidence only;
source/coverage decisions and whole-volume acceptance are unchanged.

Current DRAFT: `build/manual/imgdec.preview.pdf`,25 pages, SHA-256
`980443fbe843146d05f6e918ec74a50d6e9d382c4a7aeaf07cea315282a509b2`.
Root individually viewed every full PDFium1.4× page1–25 at original detail.
The new Book I System and Hardware Reference header fits on every page;
BMSX, chapter/DRAFT identification and folios remain legible and separate.
The datapath figure, complete register/stream/result tables, timing and all
program parts remain readable without clipped words, borders or labels.
No body/style correction was needed. Existing Chromium153.0.8010.12,
Nodev22.23.1/Linuxx64; one figure and no receipt layout errors.
This renews the changed draft's print-layout evidence, not source/coverage or
whole-manual acceptance. The historical publication-mode evidence follows.

Accepted for print/layout after independent inspection of the actual
publication-mode proof. Source, arithmetic, semantic-figure and whole-reader
acceptance are separate in [imgdec-source.md](imgdec-source.md).

## Artifact and visual scope

The existing loader and publisher produced a private publication-mode proof
with Chromium 153.0.8010.12, Node v22.23.1, Linux x64, the bundled fonts and
shared stylesheet. All 25 actual pages were rasterized at scale 1.4
(833×1179) and individually viewed at original detail by a nonauthor reviewer,
one image per call. Markdown, HTML, receipts and contact sheets did not
substitute for looking at the pages.

The original register introduction ended page 2 while its table began page 3.
The existing authored keep-together group now keeps the heading, introduction
and all nine rows on page 3. Reader corrections also clarified five short
passages without changing the code. Exactly pages 2, 3, 4, 5, 6, 7, 16, 17,
20 and 25 changed. The reviewer individually reopened all ten final pages;
the remaining fifteen rasters were identical to those already inspected.
No remaining blocking visual finding was identified.

| Pages | Inspected content |
|---|---|
| 1–2 | Resource overview, word-flow/header/history diagram, caption and starting route |
| 3–7 | Complete nine-word register reference, CONTROL/STATUS tables, DATA/DREQ/completion, IRQ/reset/pause and hardware cautions |
| 8–9 | Charged work, batch visibility, installed rate and all eleven controlled transport/decode edges |
| 10–17 | Stream/token/history layouts, generated packets, two complete worked streams, malformed-input ordering and compact examples |
| 18–25 | Complete two-module BLua listing, retained results and explicitly optional GPU storage check |

The reviewer found no clipped table cell, misaligned field, unreadable code,
horizontal overflow, lost continuation, accidental blank page or heading-only
orphan. Page 2's whitespace preserves the complete register group, rather
than shrinking type or splitting its rows. The diagram and caption stay
together; solid word paths, dashed stage selection and arrowheads are clear.

A preliminary apparent missing-header/footer concern was a presentation
reading error, not a PDF defect: all 25 top-header and bottom-left-footer
pixel regions are identical to visibly correct page 1. Page numbers are
present. No publisher, font or stylesheet change was made for that concern.

The layout receipt records one SVG and no mechanical overflow, overheight
group or out-of-viewBox label. These checks supplement actual inspection.
Page count identifies the artifact inspected; it does not establish chapter
completeness or finish the handbook.

The canonical published PDF was then rasterized with the same engine and
compared page by page: all 25 page rasters are pixel-identical to the inspected
final proof.

## Shared PNG publisher revalidation — 2026-10-17

Print was reopened for the central PNG extension. Fresh publication-mode proofs
before and after the final publisher change have all 25 page rasters
pixel-identical at scale 1.4; this SVG-only chapter has no changed printed
content. Chromium 153.0.8010.12, the bundled fonts and existing SVG styling
are unchanged. The actual-page acceptance above therefore remains applicable;
this comparison is not a new factual review or an output-image claim.
