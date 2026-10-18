# Current time/calendar DRAFT print acceptance

**Bounded PASS for the17-page actual DRAFT PDF**,
`e82eb422220c9998106009c099ad5e6eee08eb00339ae0234d5bbd5b04483bca`,
source `9c703e92027e4d4fe7502e7a1b6cea7e557bc50f7b8080064e99e2690facec41`.
The final recheck below supersedes earlier candidate findings, not their
chronological evidence. The exact inherited Table-length publication dependency
stays OPEN: this is print-surface acceptance, not permission to publish.

# BIOS OS actual-PDF print review

## Scope and identity

- Review result: **HOLD: five finite observed pagination findings below.** All actual pages were viewed before this conclusion.
- Only the actual `build/manual/bios-os.preview.pdf` and its producer receipt `build/manual/bios-os.preview.json` were opened as review inputs. No chapter/source/facts/review/history/architecture/code-owner inputs were opened.
- PDF SHA-256: `b758265392cb1d07e9c40b51581ce36681efe394238cc930231b1f6395eb7a7a`.
- Actual page count: **16** (Ghostscript processed pages 1 through 16).
- Producer receipt: chapter `bios-os`, mode `preview`, figures 0, registerEntries 0, layout errors `[]`.
- Producer engine receipt: Chromium `153.0.8010.12`; Node `v22.23.1`; Linux x64.
- Independent rasterizer: GPL Ghostscript `10.06.0`, PNG16M, 120 dpi.
- Evidence directory: `/tmp/bmsx-bios-os-print-evidence/`.
- Retained actual reviewed PDF: `reviewed.pdf`; producer receipt: `producer-receipt.json`; individual full-page rasters: `page-001.png` through `page-016.png`; retained SHA-256 manifest: `sha256.txt`.
- Every page was rasterized and opened individually with `view_image`; no contact sheet, extracted-text review, or source-derived layout inference was used.

## Exact individually viewed page coverage

| Actual page | Full-page raster viewed | Visual observations |
|---|---|---|
| 1 | page-001.png | Book II software header (`BLUA32 AND BIOS REFERENCE`), chapter title, conspicuous draft banner, service table, complete clock example and footer/page number readable; no clipping. |
| 2 | page-002.png | Civil timestamp table and example readable. Bottom input-fields heading and lead separate from its table on p3: F1. |
| 3 | page-003.png | Input-fields bounds table, normalization example and long bounds text readable. Bottom in-place-update paragraph continues with only its last line on p4: F2. |
| 4 | page-004.png | Single top carryover line: F2. Weekday formula, error-message lists, work paragraph readable; no clipping. |
| 5 | page-005.png | Difference example and retained-dependency discussion readable. Forward civil-day formula label stranded at foot before block on p6: F3. |
| 6 | page-006.png | Full forward/inverse/month-normalization formula blocks readable and uncut. Selecting-result heading and lead separate from table on p7: F4. |
| 7 | page-007.png | Selection table, ordered operations and explicit timestamp checks/error boxes readable; no clipping. |
| 8 | page-008.png | Calendar field table, documentary decomposition formula and grammar/modifier table readable and intact. |
| 9 | page-009.png | Calendar/time conversion tables readable with intact rows and no clipped expressions. |
| 10 | page-010.png | Names, literals, week/composite conversion and fixed-name tables readable; dense lower table complete and within margins. |
| 11 | page-011.png | Week formula blocks, invalid-conversion table and padding discussion readable. Last numeric-text lead is detached from list on p12: F5. |
| 12 | page-012.png | Numeric-text list, dependency/work discussion and complete-program introduction readable; no clipping or single-line carryover. |
| 13 | page-013.png | Complete results module and entry parts 1 and 2 fit in their respective intact code boxes; all lines readable. |
| 14 | page-014.png | Complete entry parts 3 and 4 fit in intact code boxes; long lines do not overflow. |
| 15 | page-015.png | Complete entry part 5, ordinary-observations lead, sampled-output box and complete fixed-input output box readable and uncut. |
| 16 | page-016.png | Closing two explanatory paragraphs and footer/page number readable; intentional remaining white space not classified as a defect. |

All 16 physical page numbers were visible and sequential (1–16). The existing `DRAFT / NOT FOR PUBLICATION` footer remained visible on every page; p1 also contains the large draft banner. Software Book II running title was visible on the running-header pages. No missing glyph, overflow, clipping, cropped table row, cropped formula, split BLua listing, or cropped observed-output line was observed.

## Finite observed findings

1. **F1 — p2→p3, detached heading/lead before table.** `Input fields, defaults, and bounds` plus the two-line paragraph beginning `Fields are read and checked in this exact order` end p2; the related bounds table starts p3. Keep this existing heading/lead/table group together.
2. **F2 — p3→p4, paragraph widow.** Under `In-place Table update`, p3 carries the first two lines of the opening paragraph, ending `It then writes these fields in this order:`. The single final line `year, month, day, hour, min, sec, wday, yday, isdst.` is alone at the top of p4. Keep that existing opening paragraph together (and its heading with it).
3. **F3 — p5→p6, detached formula label.** `Forward civil-day calculation: D(year, month, day)` sits alone as the last content on p5; its formula box begins p6. Keep this existing label and formula block together.
4. **F4 — p6→p7, detached heading/lead before table.** `Selecting the result` and `Only nil selects a default. An omitted parameter is nil in an ordinary call.` end p6; the selection table starts p7. Keep this existing heading/lead/table group together.
5. **F5 — p11→p12, detached list lead.** The single sentence `With the supplied tostring, numbers use the shared numeric-text conversion:` ends p11; its bullet list starts p12. Keep the existing lead with the list (at least the first list item).

No other defects were observed within this actual-PDF print-layout scope. This is not technical/source correctness approval or publication approval; existing draft marks must remain.

## Corrected PDF delta review rule

A future corrected PDF may reuse this retained review only for full pages whose rendered pixel content is identical to an actually viewed retained page above. Use the same Ghostscript command/settings and full-page pixel comparison, not extracted text or source hashes. Every non-identical/new corrected page must itself be viewed individually, including both sides of each repaired split, before a bounded PASS can be issued.

# Corrected actual-PDF delta review 1

## Identity and exact coverage

- Corrected PDF SHA-256: `f6dd506181220bb50425e8d7f158848efb0c6bee25d5bb821a2d562c31128e14`.
- Actual page count: **17** (all 17 pages rasterized by the same GPL Ghostscript 10.06.0, PNG16M, 120 dpi command).
- Producer receipt unchanged in fields: chapter `bios-os`, preview, 0 figures/register entries, layout errors `[]`; Chromium `153.0.8010.12`, Node `v22.23.1`, Linux x64.
- Retained corrected PDF/receipt/rasters/hash manifest: `/tmp/bmsx-bios-os-print-evidence/corrected/`.
- Full-page pixel comparison: each PNG decoded through ImageMagick to full RGBA bytes and SHA-256 compared to every actually viewed retained prior full page. Evidence: `corrected/pixel-identity.json`.
- **Corrected p1** is pixel-identical to previously actually viewed p1 and reuses that bounded visual evidence. **Corrected p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17** each differ from every prior retained full page and were each opened/viewed individually in full. Thus exact coverage is **1–17 inclusive**, with 16 newly individually viewed pages plus one full-page pixel-identity reuse.

## Original five findings

- **F1 fixed:** corrected p2 ends the civil-convention discussion; corrected p3 now holds the input-fields heading, lead and complete bounds table together.
- **F2 fixed:** corrected p3 ends before in-place update; corrected p4 holds its heading, opening paragraph and field-order line together. No single-line paragraph carryover remains there.
- **F3 fixed:** corrected p5 no longer ends with the formula label; corrected p6 holds the forward-calculation label and complete formula box together.
- **F4 fixed:** corrected p6 ends before selecting result; corrected p7 holds the heading, nil-default lead and selection table together.
- **F5 fixed:** corrected p12 holds the numeric-text conversion lead and its complete bullet list together.

## New finite reflow findings

Result: **HOLD: three new observed detached lead/heading groups.**

1. **D1 — corrected p7→p8, detached error-box lead.** The two-line paragraph beginning `Only after that check does it require the integer to lie within the inclusive range` ends p7 with `A value outside that range invokes error with exactly:`; the related boxed `time is out-of-bound` starts p8. Keep the existing lead paragraph with that existing message box.
2. **D2 — corrected p8→p9, detached modifier-table lead.** Under `Format grammar`, the paragraph beginning `There are no format flags, field-width syntax` ends p8 with `The letters in the modifier table are the complete permitted sets:`; its modifier table starts p9. Keep that existing lead paragraph and table together.
3. **D3 — corrected p13→p14, detached results-module heading/lead before BLua listing.** `Results module` and its two-line introductory paragraph are near the bottom of p13, while the entire corresponding `struct bios_os_manual_result` listing starts p14. Keep the existing heading, lead and complete listing together.

No additional defects were observed on the other newly viewed corrected pages. Corrected p4→p5 splits the work paragraph into three lines before and two lines after the break; this is not a single-line widow/orphan. Complete BLua listings remain intact and readable on p14–16; observed output remains intact/readable on p16. Formula blocks and tables remain uncut and readable. Corrected actual page numbering is sequential **1–17**, existing DRAFT footers remain visible, and Book II software running-title/header treatment remains present. No clipping or overflow was observed.

This is a finite actual-PDF print-layout finding set only. It does not certify technical correctness or source publication readiness. The separate source/publication Table-length question remains **OPEN** regardless of this print review. No source or repository edits were made by the reviewer.

# Corrected actual-PDF delta review 2 — final finite visual outcome

## Identity, rasterization and coverage

- Final reviewed actual PDF SHA-256: `e82eb422220c9998106009c099ad5e6eee08eb00339ae0234d5bbd5b04483bca`.
- Actual page count: **17**, all 17 rerasterized with the same GPL Ghostscript **10.06.0**, PNG16M, **120 dpi** settings.
- Producer receipt: chapter `bios-os`, mode `preview`, figures 0, registerEntries 0, layout errors `[]`; Chromium **153.0.8010.12**, Node **v22.23.1**, Linux x64.
- Final retained PDF, producer receipt, individual full-page PNGs and SHA-256 manifest: `/tmp/bmsx-bios-os-print-evidence/corrected-2/`.
- Full decoded RGBA pixel hashes compared against all actually viewed retained full pages from both earlier reviews. Exact evidence: `corrected-2/pixel-identity.json`.
- **Individually newly viewed final actual pages:** **7, 8, 9, 13, 14**. Each differs from every retained previously viewed full page; each was opened individually in full with `view_image`.
- **Reused full-page pixel-identical prior actual-page coverage:** final **p1** equals initial viewed p1 (and first-corrected p1); final **p2–6, p10–12, p15–17** each equal the same-numbered individually viewed page of the first-corrected review.
- Exact final actual page coverage: **1–17 inclusive**. Five individually viewed changed pages plus twelve full-page pixel-identical evidence reuses. No unviewed changed or new page remains.

## All eight observed findings resolved

| Finding | Final visual evidence |
|---|---|
| F1 input-fields heading/lead/table | Final p2–3 pixel-identical to the reviewed first correction: grouped on p3. |
| F2 in-place paragraph widow | Final p3–4 pixel-identical to reviewed first correction: heading, paragraph and field-order line together on p4. |
| F3 forward-formula label | Final p5–6 pixel-identical to reviewed first correction: label and complete formula on p6. |
| F4 selecting-result heading/lead/table | Final p6 unchanged; newly viewed p7 holds heading, lead and complete selection table together. |
| F5 numeric-text list lead | Final p11–12 pixel-identical to reviewed first correction: lead and complete list together on p12. |
| D1 bounds-check error-box lead | Newly viewed final p7 ends after the first complete error box; newly viewed p8 holds the bounds-check paragraph and `time is out-of-bound` box together. |
| D2 modifier-table lead | Newly viewed final p8 holds a complete format-grammar opening paragraph; newly viewed p9 holds the complete permitted-sets lead and modifier table together. |
| D3 results-module heading/lead/listing | Newly viewed final p13 ends after the complete-program introduction; newly viewed p14 holds the results-module heading, lead and complete listing together, followed by intact entry parts 1 and 2. |

## Bounded outcome

**PASS — actual-PDF print layout, for this exact SHA-256 and page set only.** All eight finite observed pagination findings are resolved, and no new clipping, overflow, detached table/code lead, detached code heading, single-line paragraph widow/orphan, unreadable table/formula/listing/output, split BLua listing, or cropped observed-output line was observed in the covered final pages.

Sequential physical page numbering **1–17**, the Book II software running-title/header treatment, p1's draft banner and existing DRAFT / NOT FOR PUBLICATION footers are preserved in the final covered page set. Complete program listings on p14–16 and captured/fixed observed output on p16 remain readable and intact.

This bounded visual PASS is **not** technical/source correctness approval, publication approval, or evidence that the producer's source/content freeze claim was independently audited. The reviewer opened only actual PDFs and producer receipts, retained raster evidence and comparison outputs. The separate source/publication **Table-length question remains OPEN** irrespective of this visual PASS. No repository/source edits were made by the reviewer.
