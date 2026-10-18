# BIOS table draft preview — independent print review

## Volume-title revalidation — 2026-10-18

Current `build/manual/bios-table.preview.pdf`: 11 pages, SHA-256
`7bb9faa3112b4db46517e390ada0217bd9e0f3f501a7984e6eed6d976680dab7`.
A nonauthor independently opened every full PDFium1.4× page1–11 at original
size. The document title and every running header now identify **Book II —
BLua32 and BIOS Reference**. Headers, chapter/DRAFT footers, folios, complete
tables, code and any figures fit without clipping or collisions. No body/style
change was needed. Receipts retain Chromium153.0.8010.12, Nodev22.23.1/Linuxx64
and no layout errors. Evidence: `/tmp/bmsx-volume-software-print-review.md`.
This renews bounded draft-layout acceptance, not factual/coverage decisions or
whole-series publication approval. Earlier artifact evidence follows.

## Decision and bounded scope

**PASS for print layout/readability of this exact draft preview artifact. No remaining concrete visual defects found.** This is not publication approval and does not establish correctness of the unresolved Table-length contract. The chapter remains **DRAFT / NOT FOR PUBLICATION**. No claim is made about other manual chapters or a future render.

## Reviewed artifact and evidence

- PDF: `/home/boaz/BMSX/build/manual/bios-table.preview.pdf`
- PDF SHA-256: `f5a5f6e95f449c38461161b1952ca78a9b684155ed9cb6c60d584544285103e1`
- PDF modification time: `2026-10-18 01:25:54.907899083 +0200`; size: `247037` bytes.
- Pages: **11**, independently opened/count-checked with `pypdfium2`; each page is approximately 594.96 × 841.92 PDF points.
- Receipt: `/home/boaz/BMSX/build/manual/bios-table.preview.json`, `chapter: bios-table`, `mode: preview`, Chromium `153.0.8010.12`, Node `v22.23.1`, Linux x64, layout errors `[]`.
- Raster job: `/tmp/bmsx-bios-table-raster.py`; its PDFium render scale is 1.4. Output/log: `/tmp/bmsx-bios-table-pages/` and `/tmp/bmsx-bios-table-raster.log`.
- Every **individual** `page-01.png` through `page-11.png` was inspected anew with `view_image(detail: original)` at original 833 × 1179 detail **after** the final-candidate render. No contact sheet or text-only substitute was used.
- All 11 raster mtimes (`2026-10-18 01:25:55.016502603`–`01:25:55.252502555 +0200`) follow the final PDF mtime. The PDF hash and mtime were checked again after the last image inspection and were unchanged.
- The PDF was itself opened with `pypdfium2`; the rendered pages above are the visual evidence. Receipt/log/text inspection was supplementary only.

## Concrete defect disposition

The initial artifact (SHA-256 `4dff266727f166e91e730aca6e73c6302a9ee7d1d92fedcf3b4e13a1998285ce`) had one real visual defect: the page 11 retained-observations `packed_text_match` cell visibly lost the pipe-bearing suffix and showed an unmatched opening backtick. The final artifact above now visibly shows the full **`1: 10||30|`** value with no literal backtick or truncation. This was confirmed in the actual page 11 image, not inferred from source.

No other concrete defect was found. The earlier initial-artifact report is preserved at `/tmp/bmsx-bios-table-print-review-initial.md`.

## Individual final-candidate page results

| Page | Result |
| --- | --- |
| 1 | **Pass.** Draft warning and chapter title clear; overview table readable; long signatures wrap inside their cells; body and lower section heading stay inside margins. |
| 2 | **Pass.** New opening String-target paragraph readable. Pack heading/signature, example, range heading and prose fit. Range-normalization table remains complete with its lead; its last row is above the footer with no clipping. |
| 3 | **Pass.** Range-example lead remains with its table. Unpack and concat signatures/code/prose readable; concat heading retains its explanatory paragraph before the page break. |
| 4 | **Pass.** Revised finite-midpoint/position prose wraps normally. Concat continuation/example, insert table and numbered procedure are readable. Final example lead remains with its intact code box, whose lower border stays above the footer. |
| 5 | **Pass.** Opening insert example/lead intact. Remove table and numbered procedure readable; wrapped cells and final notes fit the margins without collision. |
| 6 | **Pass.** Sort heading and complete table stay together. Ordering section and both comparator code blocks are readable and uncut. |
| 7 | **Pass.** Sort continuation, Work performed, and Errors/resource limits sections have clear hierarchy. Error-text table is intact; monospaced error strings fit; final prose stays above footer. |
| 8 | **Pass.** Complete-program heading and explanatory prose readable. Result-storage declaration is one intact block. Entry part 1 heading keeps its explanatory paragraphs; following source listing starts on page 9. |
| 9 | **Pass.** Entry part 1 and Entry part 2 listings are intact and readable. Entry part 3 heading at the bottom retains its first full prose paragraph; it is not a detached heading. No horizontal code overflow. |
| 10 | **Pass.** Entry part 3 continuation and complete source listing fit without clipping. Lower white space follows the intact listing and does not leave a detached caption or lead. |
| 11 | **Pass.** Corrected `packed_text_match` cell visibly contains full `1: 10||30|`. All retained-observation rows are readable. Diagnostic-output heading/lead remain with the intact output block; borders, margins and final lines fit. |

## Review boundaries

This pass checked actual wrapping, table/cell readability, code readability, margins, heading hierarchy/attachment, example/table leads, page breaks and visible widows. No detached heading, broken table row, clipped code, margin overflow or unacceptable orphan/widow was observed in this final artifact. There are no figures or figure captions in this chapter preview.

No repository, renderer, stylesheet, publisher, harness or source edits were made by the reviewer. A content/layout change or different PDF hash invalidates this artifact-specific acceptance and requires a new inspection of the changed/reflowed pages.
