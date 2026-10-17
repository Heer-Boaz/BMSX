# GEO print acceptance

Current chapter accepted for print/layout after independent inspection of the
actual publication-mode PDF. This is not source/owner-fact approval; those
checks are separate in [geo-source.md](geo-source.md).

## Artifact and actual visual inspection

The existing publisher rendered a private publication-mode proof with the
normal loader, bundled fonts, stylesheet and Chromium 153.0.8010.12. All 26 actual
pages were rasterized at scale 1.4 (833×1179) and individually viewed at original
detail by an independent reviewer. Markdown, HTML, layout receipts and contact
sheets did not substitute for looking at the pages.

Two actual failures were found: the transformation-record caption ended page 7
while its table began 8; the polygon-descriptor caption ended 10 while its table
began 11. Each caption/table pair now uses the existing authored keep-together
group. The resulting proof changed exactly pages 7, 8, 10, 11. The reviewer reopened
all four individually, verified both complete groups together on 8/11 and found
no fresh orphan, clipping or unreadable content. All 22 other pages remained
pixel-identical to the already inspected proof.

The initial reviewer also alleged intermittent missing running headers/footers.
Root reopened actual pages 2/3 and found them present. All 26 header/footer raster
regions were pixel-identical to visibly correct page 1, and the reviewer then
independently reopened 2/3/26 one image per call and withdrew the finding as a
review/presentation-reading error. No stylesheet or publisher change was made
for a nonexistent defect.

| Pages | Inspected content |
|---|---|
| 1–2 | Installed resources, coordinate/operation distinctions and one-job/live-operand diagram with readable arrowheads and caption |
| 2–6 | Launch/capture, all 17 address/access/reset references, raw/retained bits, record-credit timing and complete fault/IRQ/reset discussion |
| 7–9 | XFORM record/run/matrix/bounds layouts, exact arithmetic, memory ranges, fault order and worked transformation |
| 10–12 | SAT pair/descriptor/result layouts, axis/rounding/tie behavior, touching/degeneracy, faults and worked outputs |
| 12–18 | OVERLAP modes, all input/shape/output/summary layouts, filters/order/contact/clipping, capacity/partial progress/faults and examples |
| 18–26 | Complete-program assumptions and phases, all three const-module and eight entry-module parts, and decoded actual retained results |

All eleven code blocks and tables remain legible and unclipped at the shared
font sizes. Caption corrections did not shrink type or add manual-specific
rendering code. The diagram's configuration, live data, output and job-end IRQ
paths are visually distinct; no foreign-console figure was imported.

The layout receipt reports one SVG, no horizontal overflow, no unbreakable
block exceeding a page and no label outside its viewBox. These checks only
supplement actual inspection. The canonical publication's 26 rasters were
compared with the inspected final proof and are pixel-identical. Page count
identifies the inspected artifact, not completeness of GEO or Book I.
