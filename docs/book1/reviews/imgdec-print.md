# IMGDEC print acceptance

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
