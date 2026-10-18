# BIOS String draft preview — independent print review

## Volume-title revalidation — 2026-10-18

Current `build/manual/bios-string.preview.pdf`: 12 pages, SHA-256
`bfef61ff36bb464b0adb939d0b8190368ebdcb3a781f27af243c5e0d50e428cd`.
A nonauthor independently opened every full PDFium1.4× page1–12 at original
size. The document title and every running header now identify **Book II —
BLua32 and BIOS Reference**. Headers, chapter/DRAFT footers, folios, complete
tables, code and any figures fit without clipping or collisions. No body/style
change was needed. Receipts retain Chromium153.0.8010.12, Nodev22.23.1/Linuxx64
and no layout errors. Evidence: `/tmp/bmsx-volume-software-print-review.md`.
This renews bounded draft-layout acceptance, not factual/coverage decisions or
whole-series publication approval. Earlier artifact evidence follows.

## Decision and evidence

**PASS for visual rendering of this exact draft artifact. No remaining concrete visual defect found.** This is not publication approval: the common Table-length dependency remains open. The current Book I / hardware-reference classification is provisional; the separately requested booklet-structure/title review is outside this rendering decision.

- Source: `docs/book1/bios-string.md`, SHA-256 `b5e1dd12a60dc47a8693ab95a0b92f8e0c21341720f2564e00f89f811dd97363`.
- PDF: `build/manual/bios-string.preview.pdf`, SHA-256 `75e2d3e8d8625c94bc242c26b971312639d7befa08c25137adc8bc9b4f1401a7`; 246010 bytes; modification time `2026-10-18 02:22:14.769062536 +0200`.
- Independently opened with PDFium: **12 pages**, each approximately 594.96 × 841.92 points; metadata title `BMSX Book I — BIOS STRING — DRAFT`, creator Chromium, producer Skia/PDF m153.
- Receipt: `build/manual/bios-string.preview.json`; preview mode, zero figures/register entries, layout errors `[]`; Chromium `153.0.8010.12`, Node `v22.23.1`, Linux x64.
- Every individual `/tmp/bmsx-bios-string-pages/page-01.png` through `page-12.png` was inspected with `view_image(detail: original)`, at 833 × 1179 pixels. PDFium raster scale: 1.4. No contact sheet or text-only substitute was used.
- Source and PDF hashes were unchanged after inspection.

## Individual page decisions

| Page | Decision |
| --- | --- |
| 1 | **Pass.** Draft banner, title, representation table and final section heading are readable, attached and inside margins. |
| 2 | **Pass.** Interface signatures wrap within cells; byte examples and char heading/prose remain readable without clipping. |
| 3 | **Pass.** Char result table, error prose and len/from_utf8 sections fit; long error text wraps inside margins. |
| 4 | **Pass.** Decoder read-table lead stays with its complete table; five-operation overview and all long signatures fit. |
| 5 | **Pass.** Case example, both slice tables and source block are intact; no row or code clipping. |
| 6 | **Pass.** Reversal and repetition examples, complete branch table and pipe-bearing repetition prose are visible and untruncated. |
| 7 | **Pass.** Work-performed section and complete-program introduction retain their explanatory prose; lower whitespace leaves no detached lead. |
| 8 | **Pass.** Result-storage declaration is intact; entry-part heading stays with explanatory paragraphs. |
| 9 | **Pass.** Both source blocks are intact and readable; entry-part-3 heading retains its opening paragraph. |
| 10 | **Pass.** Scalar/error source block and mapped-decoding explanation fit; no clipped line or stranded heading. |
| 11 | **Pass.** Complete mapped-decoding/chunk-boundary source block fits, including source reuse and final halt loop. |
| 12 | **Pass.** Retained-observations heading, lead and table stay together; all nine diagnostic lines fit in their intact box. |

## Review boundary

The initial suspicion that some running headers were missing was withdrawn after reopening the original page images. Supplementary bounded PDF text and identical header-band ink counts confirmed that both running headers are present on all 12 pages. This was not an artifact defect and required no source or publisher change. Footers, page numbers, margins, table rows, code blocks and page boundaries are readable throughout.

No chapter source, runtime, publisher or stylesheet was edited by this reviewer. This artifact-specific visual acceptance does not establish semantic correctness, whole-manual completeness, publication readiness or the suitability of the provisional book classification. A different artifact hash requires a new review of affected/reflowed pages.
