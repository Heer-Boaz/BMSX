# BIOS base preview: actual-PDF visual review

## Volume-title revalidation — 2026-10-18

Current canonical publication artifact `build/manual/bios-base.pdf`:
13 pages, SHA-256 `fb0672844aa0470194f48bbbf398d057e9d6f3780f8138888294402f46ae0e06`.
Every publication page 1–13 was independently viewed; removing the draft banner changes the preview’s pagination.
All header bands match the fully reviewed new preview; clean chapter footers,
folios and absence of DRAFT were independently verified. Current-PDF rasters
and retained-pixel accounting passed. Evidence:
`/tmp/bmsx-volume-publication-delta-review.md`. This renews layout evidence only;
source/coverage decisions and whole-volume acceptance are unchanged.

Current `build/manual/bios-base.preview.pdf`: 14 pages, SHA-256
`1ad428f112e1d19b79f31d111d0efc024837d18f79a05215d21165e3095bc385`.
A nonauthor independently opened every full PDFium1.4× page1–14 at original
size. The document title and every running header now identify **Book II —
BLua32 and BIOS Reference**. Headers, chapter/DRAFT footers, folios, complete
tables, code and any figures fit without clipping or collisions. No body/style
change was needed. Receipts retain Chromium153.0.8010.12, Nodev22.23.1/Linuxx64
and no layout errors. Evidence: `/tmp/bmsx-volume-software-print-review.md`.
This renews bounded draft-layout acceptance, not factual/coverage decisions or
whole-series publication approval. Earlier artifact evidence follows.

## Artifact and method

- PDF: `/home/boaz/BMSX/build/manual/bios-base.preview.pdf`
- Independently verified SHA-256: `acee6438bcf100ddc68977d51fcd1be3f9c193ab741bae1a986aa9434f3e83fd`
- Independently verified page count: **14**, by opening the PDF with PDFium (`pypdfium2` in `/tmp/bmsx-manual-inspection-venv`).
- Inspected each actual PDFium 1.4x raster individually with `view_image(detail="original")`: `/tmp/bmsx-bios-base-pages/page-01.png` through `page-14.png`. No contact sheet or text-only substitute.
- Scope: visible print layout only. No source, semantic, completeness, architecture, or reference-PDF assessment.

## Verdict

**Changes required: two detached table leads.**

1. **Page 1, final body line / page 2, opening table:** “On failure, the presence of a tail argument determines the error value:” is left alone at the bottom of page 1, while the table it introduces starts page 2. Keep the lead with that table.
2. **Page 2, `type(value)` section at the bottom / page 3, opening table:** the function heading and introductory paragraph end with “The complete set of returned labels is:” on page 2, but the labels table starts page 3. Keep the heading and introductory paragraph with their table; page 2 already has a large blank area below this detached introduction.

No other required visual failures found. In particular, the inspected code and tables are not clipped; columns remain distinct; no footer/content collisions or broken visible symbols were found. Program-phase headings, prose, and code remain together. Publication-mode PDF still requires a fresh all-pages review after the draft banner is removed.

## Individual page record

| Page | Individually inspected raster | Visual result |
|---|---|---|
| 1 | `page-01.png` | Required fix 1: final assert-table lead is detached. Title, section headings, preceding code, margins, and footer otherwise clear. |
| 2 | `page-02.png` | Required fixes 1 and 2 across boundaries: assert table starts without its lead; `type(value)` introduction is detached from labels table. Table columns and footer clear. |
| 3 | `page-03.png` | Confirms labels table is separated from page-2 introduction. No additional clipping, column, or footer defect. |
| 4 | `page-04.png` | Pass. Headings and prose readable; conversion table clear; margins and footer clear. |
| 5 | `page-05.png` | Pass. Three-column table, explicit-base heading, check-order list, and arithmetic section readable; no overlap or clipping. |
| 6 | `page-06.png` | Pass. Section/function headings retain body text; all text and footer clear. |
| 7 | `page-07.png` | Pass. `select` explanatory text and table stay together; signs, `#`, caret power notation, and table columns readable. |
| 8 | `page-08.png` | Pass. Function sections and faults heading retain body text; no clipping or footer collision. |
| 9 | `page-09.png` | Pass. Program heading and introduction remain together. Large lower whitespace does not clip or strand a phase heading. |
| 10 | `page-10.png` | Pass. Result-storage heading, lead, and complete code box together; code, borders, margins, and footer clear. |
| 11 | `page-11.png` | Pass. Entry-1 heading, lead, and code together; long code lines remain within box. |
| 12 | `page-12.png` | Pass. Entry-2 heading, leads, and code together; long code lines remain within box. |
| 13 | `page-13.png` | Pass. Both entry phases retain headings, explanatory text, and code; no border or footer collision. |
| 14 | `page-14.png` | Pass. Retained-results table columns and wrapped cells clear; output heading/lead/code together; bottom code border safely above footer. |

## Revised-preview closure

- Revised preview SHA-256 independently verified: `9c909b0a0465ab0a8b0ee922628bd1ec95f4f8f5344c81b69d2b9d7c49e3d72e`.
- PDFium independently reports **14 pages**.
- Independently compared every PNG byte-for-byte with `/tmp/bmsx-bios-base-pages-before-tables/`: only pages **1, 2, and 3** changed.
- Re-inspected revised `page-01.png`, `page-02.png`, and `page-03.png` individually with `view_image(detail="original")`.
- **Fix 1 closed:** page 1 no longer ends with the detached assert-failure lead; the lead and table appear together at the top of page 2.
- **Fix 2 closed:** `type(value)` heading, lead, and labels table now appear together on page 3.
- No new visual failures in those three pages. Page 3 remains within its content/footer separation despite the added block.
- **Revised preview visual verdict: PASS.** Previous individual-page review remains applicable to byte-identical pages 4–14. This is not yet publication-mode acceptance; review all publication-mode pages after banner removal.

## Publication-mode all-pages review

### Exact artifact and method

- PDF: `/home/boaz/BMSX/build/manual/bios-base.pdf`
- Independently verified SHA-256: `1e0818a4f40faaca923f7c4fd1643e7ad9a13c751122bab1e9dd39cfe6ec9020`.
- Independently verified PDFium page count: **13**.
- Inspected **every** actual PDFium 1.4x publication raster individually with `view_image(detail="original")`: `/tmp/bmsx-bios-base-published-pages/page-01.png` through `page-13.png`.
- This review is independent of the earlier 14-page draft-preview inspection. The draft-banner removal changed pagination.
- Scope remains visible layout only, not source, semantics, chapter completeness, or whole-manual completion.

### Publication-mode verdict

**Changes required: one new one-line widow.**

1. **Page 5 bottom / page 6 first body line, `next(table [, key])`:** the first explanatory paragraph begins with three lines at the bottom of page 5, but its final single line, “without a conversion by this function. Arguments after the second are unused.”, is isolated at the top of page 6. Keep at least two paragraph lines on each side of the break, or keep that heading and first paragraph together.

The two preview table-lead issues remain resolved in the publication layout: assert's failure lead and table are together on page 1; `type(value)` heading, lead, and labels table are together on page 2. No other required visual failures found. All inspected tables/code remain within borders, columns are distinct, margins/footer clearance is intact, and visible symbols/power notation are readable.

### Every publication page inspected

| Page | Individually inspected raster | Visual outcome |
|---|---|---|
| 1 | `page-01.png` | Pass. No draft banner; title/sections/code clear; assert failure lead and table together; bottom table clear of footer. |
| 2 | `page-02.png` | Pass. Equality table and labels table clear; `type(value)` heading/lead/table together; paragraph ending and footer clear. |
| 3 | `page-03.png` | Pass. Both conversion tables clear; character/token heading retains a full introductory paragraph; no footer collision. |
| 4 | `page-04.png` | Pass. Default/explicit form headings retain prose; three-column summary table clear. |
| 5 | `page-05.png` | Required fix 1 starts here: `next` introductory paragraph breaks after three lines, leaving one final line on page 6. Check-order list and other headings/body clear. |
| 6 | `page-06.png` | Required fix 1: isolated one-line tail of the preceding paragraph at top. Remaining next/pairs/ipairs text, headings, margins and footer clear. |
| 7 | `page-07.png` | Pass. Selector table and explanatory prose clear; signs, `#`, and caret power notation readable; global-function section clear. |
| 8 | `page-08.png` | Pass. Print/faults/program headings retain body text; no clipped content or footer collision. |
| 9 | `page-09.png` | Pass. Result-storage heading, prose and complete code box together; code/borders/margins clear. |
| 10 | `page-10.png` | Pass. Entry 1 heading, prose and code together; long lines fit within code box. |
| 11 | `page-11.png` | Pass. Entry 2 heading, prose and code together; long lines fit within code box. |
| 12 | `page-12.png` | Pass. Both entry phases retain headings/prose/code; all box borders clear; no footer collision. |
| 13 | `page-13.png` | Pass. Retained-results table cells/columns clear; output heading/lead/code together; output box safely above footer. |

## Preview acceptance after next-paragraph grouping

- Exact preview artifact: `/home/boaz/BMSX/build/manual/bios-base.preview.pdf`.
- Independently verified SHA-256: `e4765357842193401662682a6e1c95ef65ab4dfc66b5d9ab22d39a1fc569bedb`.
- Independently verified PDFium page count: **14**.
- Independently checked the complete raster filename sets (14 each) and every PNG byte against `/tmp/bmsx-bios-base-pages-before-next/`: **all 14 current preview rasters are byte-identical** to the accepted-preview baseline.
- No new image inspection is claimed in this step. Prior individual-page visual inspection applies unchanged because every raster is byte-identical.
- **Exact revised preview accepted: PASS.** This does not close the publication-only widow; revised publication output must still be rebuilt and checked.

## Final revised publication closure and acceptance

### Exact final artifact

- PDF: `/home/boaz/BMSX/build/manual/bios-base.pdf`.
- Independently verified SHA-256: `4781fbb79676d4623a1c3085bd385677fff2f79eb4f995e1c565d14626f91644`.
- Independently verified PDFium page count: **13**.
- Independently compared complete filename sets and PNG bytes against `/tmp/bmsx-bios-base-published-pages-before-next/`: **only pages 5, 6, and 7 changed**; the other ten publication rasters are byte-identical to those individually inspected in the full publication review above.
- Individually re-inspected all three changed actual publication rasters with `view_image(detail="original")`.

### Changed-page outcomes

| Page | Individually re-inspected raster | Visual outcome |
|---|---|---|
| 5 | `page-05.png` | Pass. `next` heading/introduction no longer begins at the bottom; traversal section introduction ends cleanly above the lower margin. No stranded heading or single line. |
| 6 | `page-06.png` | Pass. `next` heading and its complete first paragraph are together at the top, closing the one-line widow. Remaining next/pairs/ipairs blocks have clear headings and complete body paragraphs; no footer collision. |
| 7 | `page-07.png` | Pass. Begins with a complete three-line ipairs paragraph, not a widow. Selector table/lead and global-function heading/text remain clear; signs/power notation readable; final paragraph stays above footer without collision. |

**Publication-only widow: CLOSED. No remaining required visual failures. Exact final 13-page publication artifact: PASS.**

This acceptance combines the earlier individual inspection of every publication page with individual inspection of every changed page and verified byte-identical unchanged pages. It is only a visual print-layout acceptance of this BIOS base chapter artifact; it makes no source/semantic/completeness claim and does not imply that the whole manual is complete. Earlier artifact verdicts and failures above are retained as historical records.
