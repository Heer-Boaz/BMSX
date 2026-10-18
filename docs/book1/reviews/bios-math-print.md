# Current Math publication print acceptance

**Bounded PASS for the22-page canonical non-DRAFT PDF**,
`e8d40b6248edffc63a2410c6fe012c078f6dc13708fc053e1b3a3dd4ed55a569`,
source `55f4f3d4b16b7af1278f76d6c216e3744ec94af97cdca90bcdecb7231982e890`.
The canonical review at the end freshly inspects all22 actual publication
pages and supersedes earlier candidate findings, not their chronological
evidence. This is finite print-surface acceptance, not whole-manual completion.

# BIOS math preview: independent actual-PDF print review

## Artifact and method

- Artifact: `/home/boaz/BMSX/build/manual/bios-math.preview.pdf`
- Exact SHA-256: `decdaf811aa69249a1114a0f8e36ac72d0651f640b121be12bb615395275b7d0`
- Pages: **21**, each approximately 594.96 × 841.92 PDF points.
- PDF-producing engine, from the actual `build/manual/bios-math.preview.json` receipt: **Chromium 153.0.8010.12**, Node v22.23.1, Linux x64.
- Independent rasterizer: **pypdfium2 5.14.0 / PDFium 156.0.8076.0**.
- Every page rendered at **1.5×**, producing separate **893 × 1263** full-page PNGs. Every one of pages **1–21 was actually opened and visually inspected individually with `view_image`**. Calls batched three separate full images for transport; no contact sheet or extracted-text substitute was used. Page 12 was opened again individually to confirm its last line.
- Initial rasters are retained unchanged in `/tmp/bmsx-bios-math-print-initial-decdaf811aa6/`, named `page-01.png` through `page-21.png`. `rasters.sha256` records their hashes for exact-pixel changed-page comparisons.
- Read `AGENTS.md` and the renderer receipt only besides the PDF/raster artifacts. Did not open the manuscript, owners/facts, architecture, historical PDFs, or previous reviews. No repository changes.

## Checkpoint result: five concrete pagination findings

These are detached introductions, not complaints about ordinary whitespace.

1. **Page 8 → 9, sine lookup:** The final two-line paragraph begins **“The lookup uses a fixed quarter-wave table L with 257 word entries”** and ends **“applies the sign:”**. The introduced `quadrant = (a >> 30) & 3` / `phase = a & 0x3fffffff` block starts alone at the top of page 9. Keep this short colon-ended introduction with that block.
2. **Page 10 → 11, exponential constants:** The one-line **“The retained constants are:”** is stranded at the bottom of page 10. Its `ln2 = ...` / `inv_ln2 = ...` block starts page 11. Keep the lead with the constants.
3. **Page 11 → 12, logarithm calculation:** The one-line **“Then calculate:”** is stranded at the bottom of page 11. The `z = (mantissa - 1) / (mantissa + 1)` block starts page 12. Keep the lead with that calculation.
4. **Page 12 → 13, random branch 2:** A single final line begins **“2. Otherwise, if upper is nil, truncate lower toward zero to obtain upper_int”** and ends **“raise exactly:”**. The introduced `random upper bound must be positive.` error-text block begins page 13. Keep this short numbered branch introduction with its first block.
5. **Page 19 → 20, observations:** **“Ordinary observations”** and its two-line introduction **“After normal startup, compare these twenty-four lines.”** sit on page 19, while the first observed-output block starts page 20. Keep this short heading/lead unit with the output it introduces. The issue is the separation, not page 19's unused area.

## Complete page coverage

| Page | Individually viewed content / visible result |
| --- | --- |
| 1 | Title, draft banner, availability, formulas lead: readable; no clipping. |
| 2 | Constants table and `math.abs`: borders, cells and text fit. |
| 3 | Floor, ceil, round, fmod formula: code/formula boxes fit. |
| 4 | Fmod continuation, modf, min: readable; no broken table/code box. |
| 5 | Max, tointeger numbered conditions, type: readable; no clipping. |
| 6 | Type continuation, ult/sign, execution-boundaries formula: readable. |
| 7 | Work continuation, transcendental interface table: cells and labels fit. |
| 8 | Angular conversion, sine/cosine/tangent formulas and nonnumeric row: readable; finding 1. |
| 9 | Lookup blocks and inverse-angle tables: readable, all rows/cells fit. |
| 10 | Inverse continuation, square-root blocks, exponential condition table: readable; finding 2. |
| 11 | Exponential blocks, logarithm conditions/constants/loops: readable; finding 3. |
| 12 | Logarithm table and random branches: readable; finding 4. |
| 13 | Random branch blocks and randomseed formulas: readable; no clipping. |
| 14 | Seed continuation, generator and complete-program introduction: readable. Ordinary remaining whitespace is not a defect. |
| 15 | Full result-storage listing and following instruction: readable, listing intact. |
| 16 | Entry 1 code: readable, line ends and border fit. |
| 17 | Entry 2 code: readable, long conditions/string lines remain inside border. |
| 18 | Entry 3 code: readable, line ends and border fit. |
| 19 | Entry 4 and 5 code fit; observations heading/lead: finding 5. |
| 20 | Observed-output listings, argument/error table and first summary rows: readable; no clipped columns. |
| 21 | Continued summary table with repeated header, final random-state table and concluding paragraph: readable. |

## Bounded passes and limits

- **Running header confirmed on all 21 pages:** `BOOK II · BLUA32 AND BIOS REFERENCE`; left label `BMSX`.
- **Draft footer confirmed on all 21 pages:** `BIOS MATH — DRAFT / NOT FOR PUBLICATION`, with page numbers 1–21. The first page also carries the boxed draft banner.
- No additional visible clipping, overprinted/missing glyphs, breached margins, unreadable formulas/code, broken table cells, stranded bare headings, or isolated single-line paragraph continuations were identified in this finite review.
- The table continuation from page 20 to 21 repeats the column header and preserves complete rows.
- This is actual-PDF visual print review only: no semantic/API accuracy audit, source/owner comparison, automated acceptance claim, physical-printer proof, or exhaustive typography/style redesign. Ordinary whitespace and intentional long-listing page starts are not defects.

## Fixed-candidate delta review — SHA 62e24d830394

### Identity, finite coverage and retained comparison evidence

- Candidate artifact: the same PDF path, exact SHA-256 **`62e24d83039495c49aec7263a3b1acc86400db0f4dbadea4543395c0b7dd767e`**.
- Actual candidate page count: **21**, independently obtained from PDFium, not assumed from the initial artifact.
- Actual producer receipt remains **Chromium 153.0.8010.12** / Node v22.23.1 / Linux x64.
- Independently rasterized **all 21 current pages** with **pypdfium2 5.14.0 / PDFium 156.0.8076.0 at 1.5×**. Each is 893 × 1263 pixels.
- Candidate rasters and exact comparison manifest: `/tmp/bmsx-bios-math-print-candidate-62e24d830394/`, specifically `comparison.json` and `rasters.sha256`.
- **Exact full-page pixel equality** (same mode, dimensions and all decoded pixel bytes) against retained initial same-number pages: **1, 2, 3, 4, 5, 6, 15, 16, 17, 18, 21**. These 11 already visually inspected pages need no repeated visual inference: their entire pixels are unchanged. The initial raster hash manifest was also checked successfully; the 21 successful checks are retained in `initial-rasters-verification.txt` in the candidate directory.
- **Every changed page was actually viewed as a separate full page:** **7, 8, 9, 10, 11, 12, 13, 14, 19, 20**. Batches transported separate images, not contact sheets. No extracted text was used as a visual substitute.
- No manuscript/source/owner inspection or repository edit was performed for this delta review.

### Original five findings: all visually closed

| Initial finding | Candidate actual-PDF closure |
| --- | --- |
| Initial p8 lookup introduction separated from p9 block | Candidate **p9** begins with the short lookup introduction immediately followed by the quadrant/phase block. |
| Initial p10 “The retained constants are:” separated from p11 constants | Candidate **p11** places this lead directly above the `ln2` / `inv_ln2` block. |
| Initial p11 “Then calculate:” separated from p12 calculation | Candidate **p12** keeps the lead immediately above the `z` / `z2` / `term` / `sum` block. |
| Initial p12 random branch 2 separated from p13 error text | Candidate **p13** keeps the branch-selection lead and all three numbered branches with their error/formula blocks on one page; nothing is clipped or oversized. |
| Initial p19 Ordinary observations separated from p20 output | Candidate **p20** starts with the heading, its introduction, and the first observed-output block together. |

### Two new, concrete detached-introduction findings

1. **Candidate p9 → p10, atan branch table:** Page 9 ends with the short two-line paragraph **“math.atan(y, x) selects its result using the following order.”**, continuing **“The x < 0 rows are considered before either remaining y-axis row.”** Its condition/result table starts alone on page 10. Keep that short introduction with the table. This is the detached introduction, not the ordinary blank space below it.
2. **Candidate p11 → p12, logarithm initial tests:** Page 11 ends with the **“Logarithms”** heading and the two-line introduction beginning **“Use math.log(value, nil) for the natural logarithm, or supply a base.”**, ending **“N(v) first tests, in order:”**. Its initial condition/result table starts alone on page 12. Keep this short heading/lead unit with its table.

### Finite outcome

**The original five issues are closed; candidate is not yet a bounded visual PASS because of the two new detached-introduction findings above.** Across the ten changed pages and eleven exact-unchanged full-page rasters, no other new split, clipping, overflow, oversized group, unreadable code/formula, odd numbering, or isolated single-line paragraph continuation was identified. Running Book II · BLUA32 AND BIOS REFERENCE headers, draft footers and continuous page numbering 1–21 remain intact. Existing long-listing whitespace is not counted as a defect. This remains a visual print audit, not semantic or physical-printer proof.

## Second fixed-candidate delta — SHA dbdbc3c6aef5

### Actual artifact and exact coverage

- Exact PDF SHA-256: **`dbdbc3c6aef514b7746305a3a1707eabfbc854a5282e471f70ed7e26070205bb`**.
- Actual page count independently read from PDFium: **22** (previous candidate: 21). Page numbering is continuous 1–22, with no duplicate or skipped number.
- Producer receipt: **Chromium 153.0.8010.12**, Node v22.23.1, Linux x64. Independent rasterizer unchanged: **pypdfium2 5.14.0 / PDFium 156.0.8076.0**, 1.5×, 893 × 1263 per full page.
- Rasterized **all 22 pages** and compared each against the prior candidate's retained same-number page. **Exact full-page pixel matches: 1–8**. **Every changed/new page was individually visually inspected in full: 9–22**, including the new final page 22. No contact sheet/text substitute.
- Evidence retained at `/tmp/bmsx-bios-math-print-final-dbdbc3c6aef5/`: all 22 full-page PNGs, `comparison.json`, `rasters.sha256`, and successful prior-raster hash checks in `prior-rasters-verification.txt`. Earlier rasters remain unchanged.

### Atan/log lead fixes: both closed

- **Page 10:** `math.atan(y, x) selects its result using the following order...` now directly precedes its complete condition/result table on that page.
- **Page 12:** `Logarithms`, its short introduction ending `N(v) first tests, in order:`, and its initial-tests table now appear together.
- All five initial detached-lead fixes remain closed in this artifact: lookup on p9; exponential constants on p11; `Then calculate:` on p12; intact random-branch procedure on p13; Ordinary observations with first output on p21.

### One new single-line paragraph widow

**Page 10 → 11, final square-root paragraph:** Page 10 ends with the paragraph beginning **“and return estimate * scale.”** Its final sentence is split after **“no all-input relative-”**; **page 11 begins with the single isolated continuation line “error, ULP or total-cycle bound is specified here.”** before the Natural exponential heading. This is an actual single-line paragraph widow, not an ordinary whitespace complaint.

### Finite outcome

**The two targeted lead/table findings are closed, but this artifact is not yet a bounded visual PASS due to the one new square-root paragraph widow.** Across all 22 pages accounted for by eight exact retained-pixel matches plus fourteen full-page visual inspections, no additional detached leads, clipped/oversized blocks, broken tables, unreadable code/formulas, or numbering/header/footer problems were found. All headers and draft footers are intact. The shift to 22 pages and the long-listing whitespace are not themselves defects. No semantic re-audit or repository edit was performed.

## Final widow-fix delta — SHA 198b51593b51 — bounded PASS

- Exact reviewed PDF SHA-256: **`198b51593b51ce82ec4fc25ca8f25cc0f8ba8555bd68bed5afd801a256fc5f22`**.
- Actual page count independently obtained from PDFium: **22**.
- Actual producing-engine receipt: **Chromium 153.0.8010.12**, Node v22.23.1, Linux x64. Independent renderer: **pypdfium2 5.14.0 / PDFium 156.0.8076.0**, all pages at 1.5×, 893 × 1263 pixels.
- **All 22 current pages were independently rasterized** and compared with the retained previous 22-page artifact. **Twenty complete pages have exact pixel equality: 1–9 and 12–22.** Both changed full pages, **10 and 11**, were actually opened individually with `view_image` and visually inspected. No contact-sheet or text-extraction substitute.
- **The square-root widow is closed:** the entire paragraph beginning **“and return estimate * scale.”** is now together as four lines at the top of page 11, ending **“error, ULP or total-cycle bound is specified here.”** Page 10 ends cleanly after the preceding complete refinement formula box.
- Both changed pages remain readable, with intact table/formula borders, margins, headers and draft footers. No new detached lead, heading, paragraph widow, clipping, overflow, oversized group, or odd numbering was found. Previously closed findings remain closed by unchanged pixels or direct p10/p11 inspection. Continuous page numbering remains 1–22.
- **Finite visual result: PASS for the inspected actual-PDF print surface.** All previously reported concrete layout findings are closed; no outstanding visual defects were identified. Ordinary whitespace is not counted as a defect.
- Exact retained evidence: `/tmp/bmsx-bios-math-print-final-198b51593b51/`, including all 22 full-page PNGs, `comparison.json`, `rasters.sha256`, and successful verification of all 22 previous raster hashes in `prior-rasters-verification.txt`. All earlier raster sets remain preserved.
- Limits unchanged: visual actual-PDF print audit only, not a semantic/API audit, source/owner validation, physical-printer proof, or typography/style rewrite. No repository edits were performed by this reviewer.

## Canonical non-DRAFT publication artifact — SHA e8d40b6248ed — bounded PASS

### Actual artifact and complete fresh inspection

- Canonical artifact: **`/home/boaz/BMSX/build/manual/bios-math.pdf`**, exact SHA-256 **`e8d40b6248edffc63a2410c6fe012c078f6dc13708fc053e1b3a3dd4ed55a569`**.
- Actual page count independently obtained from PDFium: **22**. All pages approximately 594.96 × 841.92 PDF points.
- Actual receipt **`build/manual/bios-math.json`** identifies **mode `publish`**, **Chromium 153.0.8010.12**, Node v22.23.1, Linux x64.
- Independently rasterized **every canonical page** with **pypdfium2 5.14.0 / PDFium 156.0.8076.0**, at **1.5×**, producing separate **893 × 1263** full-page images.
- **Actually opened and visually inspected every canonical full page individually: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22.** Separate full images were batched only for transport. No retained-pixel shortcut, contact sheet, extracted text, preview-pass assumption or renderer-receipt-only acceptance was used.
- Retained canonical evidence: **`/tmp/bmsx-bios-math-print-canonical-e8d40b6248ed/`**, containing `page-01.png` through `page-22.png`, `render-manifest.json`, and `rasters.sha256`. Earlier evidence sets remain preserved.

### Canonical running matter and publication status

- **No DRAFT banner remains on page 1.** The chapter begins directly with **“BIOS math library”**.
- **No DRAFT / NOT FOR PUBLICATION footer remains on any of the 22 pages.** Each footer now reads **“BIOS MATH”**, plus the correct page number.
- All 22 running headers visibly retain **`BMSX`** at left and **`BOOK II · BLUA32 AND BIOS REFERENCE`** at right.
- Page numbers are continuous and correct **1–22**, without a missing, repeated or oddly placed number.

### All previously reported layout findings remain closed in the canonical PDF

| Prior finding | Canonical direct visual confirmation |
| --- | --- |
| Quarter-wave lookup lead/block | **p9:** lead paragraph immediately followed by quadrant/phase box. |
| Exponential constants lead/block | **p11:** “The retained constants are:” directly above `ln2` / `inv_ln2`. |
| Logarithm “Then calculate:” lead/block | **p12:** lead directly above the `z` / `z2` / `term` / `sum` box. |
| Random branch 2 lead/error block | **p13:** branch-selection lead and all three numbered branches remain intact together, including both error strings and result formulas. |
| Ordinary observations heading/output | **p21:** heading, short introductory paragraph and first output block remain together. |
| Atan ordered-case introduction/table | **p10:** short `math.atan(y, x)` introduction immediately precedes the full table. |
| Logarithms heading/initial-test table | **p12:** heading and short introductory paragraph immediately precede the initial condition/result table. |
| Square-root warning paragraph widow | **p11:** complete four-line paragraph beginning “and return estimate * scale.” remains intact at the top; no isolated one-line continuation. |

### Canonical finite result

**PASS — bounded actual-PDF print inspection of this exact non-DRAFT canonical artifact.** All 22 pages were freshly viewed in full. Removing the first-page draft banner introduced no new stranded lead/heading, paragraph widow, clipping, overflow, overprinted glyphs, broken table row/cell, oversized group, unreadable formula/code, margin breach, or running-matter defect. Constants and interface tables, inverse-angle and log tables, full program listings, observed output, error-argument table and continued summary tables remain readable and intact. Ordinary whitespace is not a defect.

Limits: visual print-surface acceptance only; not semantic/API correctness, source/owner validation, physical-printer proof, or a style rewrite. No source, owner, publisher, CSS, helper, or other repository edits were performed by this reviewer. The canonical PDF hash was rechecked after this inspection.
