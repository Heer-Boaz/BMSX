# BIOS String draft preview — independent print review

## Actual PDF print review — original current snapshot

### Artifact and method

Reviewed the actual `build/manual/bios-string.preview.pdf`, not a reference PDF or stylesheet. SHA-256 before and after review: `9c72bdc30dbd12ec8638827014db3ee51667456db76a9868c1efd8819ad4a0e0`; 392644 bytes; **19 pages**, each approximately 594.96 × 841.92 PDF points. The public source hashes/counts were unchanged between 2026-10-18 02:08:10 UTC and 02:09:37 UTC and are recorded in the companion reader review.

Used the existing `/tmp/bmsx-manual-inspection-venv` with pypdfium2 to render **every page** at scale 2 (144 dpi), producing nineteen individual 1190 × 1684 images in `/tmp/bmsx-format-current-pages/`. Viewed every image, page 01 through page 19, with `view_image(detail='original')`, one image per tool call. This was a full-page visual inspection, not a contact sheet or a receipt-only scan. Supplemental per-page actual-PDF text checks and raster comparisons confirmed the repeated margin text; repeated-margin suppression in an image display must not be mistaken for missing PDF headers.

The top header is **BMSX / BOOK II · BLUA32 AND BIOS REFERENCE** and the footer is **BIOS STRING — DRAFT / NOT FOR PUBLICATION**, with sequential page numbers 1–19. All nineteen rendered header strips are byte-identical, as are all nineteen left footer strips (excluding page numbers). The opening boxed **DRAFT — NOT FOR PUBLICATION** label is present. This is a DRAFT preview, not a final-publication approval.

### Verdict

**Legible draft, with two local lead/body pagination defects to correct.** No clipped code, missing visible table row, colliding table column, cut formula, or corrupted displayed escape was observed within these nineteen pages. This does not verify runtime behavior, source-versus-implementation accuracy, the entire manual, print-device color/trim, or final publication readiness.

### Individual-page scope and verdict

All rows include full-page margins, the complete Book II header, DRAFT footer, page number, visible body bounds and heading/lead grouping.

| Page | Inspected body scope | Verdict / exact defect |
| ---: | --- | --- |
| 1 | Opening DRAFT box/title; text/byte distinction; four-row encoding table; next section heading and lead | Pass: columns, hex bytes and ranges legible; heading retains lead. |
| 2 | Four-interface table; `string.byte` contract and seven call rows; `string.char` heading/lead | Pass: all rows fit; no split row or collision. |
| 3 | Nine `string.char` call rows; argument/cycle prose; `len` and `from_utf8` lead | Pass: full rows and long error text legible. |
| 4 | Four-row decoder read-shape table; UTF-8 escape prose; five-operation table | Pass: lead and read-shape table grouped; encoded escapes readable. |
| 5 | ASCII case code; slicing prose, three endpoint rows, four result rows and four-line code | Pass: code/table columns uncut. |
| 6 | Reversal code/prose; repetition code and five branch rows | Pass: all five branches visible; trailing paragraph continues normally. |
| 7 | Repetition continuation; captured calls; complete-program heading and introductory prose | Pass for grouping/legibility; substantial lower white space, not clipped/missing content. |
| 8 | Complete result-storage code; part-1 heading and two explanatory paragraphs | Pass: code closes visibly; heading and lead stay together. |
| 9 | Entry part-1 code; part-2 heading/prose/code; part-3 heading and first lead paragraph | Pass: code and long comparison lines fit; part-3 heading has lead. |
| 10 | Part-3 continuation/code; part-4 heading and explanatory prose | Pass: no clipped code; lower white space precedes intact code on next page. |
| 11 | Full mapped-byte decoding/chunk code ending in halt loop | Pass: code ends inside its box; large remaining white space is not a clipping defect. |
| 12 | Retained-observations heading/lead and all seventeen data rows; diagnostic heading/lead and all nine lines | Pass: complete two-column table and transcript, no row loss. |
| 13 | `string.format` heading/signature/intro/boundary; conversion syntax; five component rows; argument order | Pass: all conversion letters and syntax punctuation legible; no clipped cells. |
| 14 | Star handling; padding/sign prose; five conversion-group rows; `%s`/`%c`; `%q` introductory lead | **Local grouping defect:** bottom `%q` lead ends “escapes its codepoints as follows:” but its escape table begins on page 15. Keep that lead with the table. |
| 15 | All six `%q` escape rows; quoted-text remainder; integer conversion; floating intro and fixed-construction lead | **Local grouping defect:** fixed-construction lead ends “then calculate:” at page bottom but its three-line formula begins on page 16. Keep that lead with the formula. Escape rows themselves are complete and `\n`, `\r`, `\t`, `\\`, `\"` remain distinguishable. |
| 16 | Three-line fixed formula; floating construction/default-text prose; error heading/message/prose | Pass for legibility: `//`, `%`, `+ 0.5` and exponent bounds readable. Starts with the formula separated from its p15 lead (defect above). |
| 17 | Limits/captured-call continuation; complete-format-program heading/lead; result-storage heading/lead and complete 27-line module | Pass: module closes; no heading orphan or code clipping. |
| 18 | Formatting entry parts 1 and 2, each heading/lead/code; part-3 heading and lead | Pass: sign/prefix/format strings and padding assertions readable; part-3 heading remains with both lead paragraphs. |
| 19 | Complete part-3 code; formatting observations with all nine table data rows; lead and all eight diagnostic lines | Pass: escaped quote/backslash/tab strings and both zero codepoints visible; long unsupported-format line remains inside the box; footer separate. |

### Bounded observations

The added formatting pages retain the two-zero-codepoint `%c` discussion, `%q` escape table, integer/floating distinctions, formula, resource/error caveats, standalone two-module listing and all output lines. Visual completeness of those elements is not proof of their executable truth. The companion public route is outside this PDF and was reviewed separately as reading guidance, not executed.

### First grouped candidate delta — 2026-10-18 02:21:44 UTC

Independently re-rendered the actual current PDF, SHA-256 `783d23e3f6ef0f2d3a3ac9760c1ef33713178f1136fe85508f36c8be5d9eb10a`, 392842 bytes, still 19 pages, at the same scale 2. Own images and exact comparison: `/tmp/bmsx-format-review-final-pages/`, `comparison-independent.json`.

Compared **every full page's actual RGB pixels** against the original nineteen images. Exactly pages 14–17 changed; pages 1–13 and 18–19 are pixel-identical. The changed-page pixel counts / bounding boxes (left, top, right-exclusive, bottom-exclusive) are:

| Page | Changed RGB pixels | Bounding box |
| ---: | ---: | --- |
| 14 | 9638 | `[101, 1343, 1069, 1391]` |
| 15 | 476523 | `[101, 108, 1089, 1540]` |
| 16 | 527919 | `[101, 108, 1089, 1555]` |
| 17 | 377040 | `[101, 113, 1089, 1496]` |

Viewed each of those four independently rendered full pages individually with `view_image(detail='original')`. All header/footer pixels remain outside the delta and unchanged. The `%q` lead is now together with its complete six-row escape table on p15. The fixed-construction lead is now together with its complete three-line formula on p16. No code/table/formula clipping was introduced; p17's result-storage module remains complete.

**Remaining local defect in this candidate:** page 17 starts with the single short line **“is specified here.”**, the final line of the error paragraph beginning on page 16. This new widow prevents an unqualified grouping-clear delta verdict. It is not missing text or a runtime defect. The initial two defects are closed; this one new paragraph-pagination defect remains for author review.

### Final bounded print closure — 2026-10-18 02:23:21–02:23:50 UTC

Final actual PDF SHA-256: **`783836ee1397eadddf9d2ea37048620ba8b90ee250d45209c706f5d1c0ac29f3`**, 392847 bytes, **19 pages**. Final chapter SHA-256: `32db34535a77fda7a4e4efa53ecdfba866e581f1e340356fcb2680e38a144666`, 960 lines / 50726 bytes. PDF and all three reviewed public sources were hash-stable before/after this final delta review.

Independently rendered the final actual PDF again at scale 2 into `/tmp/bmsx-format-review-final2-pages/` and compared every full page both with the original and first grouped candidates. Own accounting is in `comparison-independent.json` there:

- Relative to the first grouped candidate, only **pages 16–17** differ: p16 24314 changed RGB pixels, box `[101, 1482, 1086, 1555]`; p17 376622, box `[101, 113, 1089, 1576]`.
- Relative to the original 19-page snapshot, exactly **pages 14–17** differ: p14 9638 pixels, box `[101, 1343, 1069, 1391]`; p15 476523, box `[101, 108, 1089, 1540]`; p16 504002, box `[101, 108, 1089, 1508]`; p17 371044, box `[101, 113, 1089, 1576]`.
- The other **fifteen full-page rasters are pixel-identical** to the original visually reviewed pages. Every header/footer remains outside all deltas and unchanged. This accounts for the final full nineteen-page artifact, rather than claiming a fresh visual pass over unchanged pages.

Viewed final pages 16 and 17 individually, full page, with `view_image(detail='original')`:

| Final page | Scope and verdict |
| ---: | --- |
| 16 | **Pass.** Fixed-construction lead remains grouped with all three formula lines; floating prose, error heading/lead, incomplete-error box and unsupported-error prose fit. The error paragraph that previously caused a widow now starts intact on p17. No clipped formula or text. |
| 17 | **Pass.** The full error paragraph appears together at the top, including “is specified here.”; no isolated final line remains. Captured-call/limits prose, complete-program heading/lead, result-storage heading/lead and the complete 27-line module remain intact. The code box closes above the DRAFT footer with a visible gap. No new orphan heading, column collision or clipping observed. |

**Final bounded print verdict: clear for the enumerated draft legibility/grouping checks.** Both original lead splits and the first candidate's new widow are closed. This remains the actual **DRAFT / NOT FOR PUBLICATION** preview, not approval of final publication, runtime/source accuracy, the whole manual, native parity, or every formatter path.

### Final public-guide-only update — 2026-10-18 02:25:49 UTC

The companion/README subsequently clarified the timeline's zero-based presentation offset (with the README spacing correction). Final guide SHA-256 values are `4b3bd85016426d32ac65967cc6a4d62f8439aceea56f989052dcd52fbf848a88` and `aa38ca28afb7112efdc1ca6571812cb851060be7a54bdcc4cdfda348e6c96398`, respectively. The actual accepted PDF and chapter remain at the final2 hashes above; no PDF rerender or new visual delta occurred. The final bounded print closure is unchanged.

---

## Earlier base-operation evidence

The following source/artifact review is retained at its earlier bounded scope;
it is not an approval of the later formatting extension or a current hash.

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
