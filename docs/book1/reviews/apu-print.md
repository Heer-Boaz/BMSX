# APU print review

## Volume-title revalidation — 2026-10-18

Current canonical publication artifact `build/manual/apu.pdf`:
28 pages, SHA-256 `c914b74cfbd486af205bac25d38afd4ba39aa2582071193b8c2d04cbd0ce382d`.
Page 1 was independently viewed; every body page matches the accepted publication proof.
All header bands match the fully reviewed new preview; clean chapter footers,
folios and absence of DRAFT were independently verified. Current-PDF rasters
and retained-pixel accounting passed. Evidence:
`/tmp/bmsx-volume-publication-delta-review.md`. This renews layout evidence only;
source/coverage decisions and whole-volume acceptance are unchanged.

Current `build/manual/apu.preview.pdf`: 28 pages, SHA-256
`c48db28966d08cec8014b50a536f8d3bce7a2826e1119f68c2710c695d2d0c92`.
A nonauthor individually inspected every full PDFium1.4× page1–28 at readable
size. The Book I System and Hardware Reference header fits; BMSX, chapter/DRAFT
footer, folios, complete tables, diagrams and program parts remain readable
without clipping, overlap or lost labels. Evidence:
`/tmp/bmsx-volume-small-hardware-print-review.md`. Existing Chromium153.0.8010.12,
Nodev22.23.1/Linuxx64, no receipt layout errors. This renews print-layout evidence,
not technical coverage or whole-series publication approval. Historical
publication/draft evidence follows.

The publication-mode proof contains 28 A4 pages and two semantic SVG figures.
It uses the existing shared stylesheet and bundled fonts; no publisher, layout
framework or stylesheet was changed for this chapter.

## Engine and actual inspection

- Chromium 153.0.8010.12, Node v22.23.1, Linux x64, as recorded by the render receipt.
- Final proof: `/tmp/bmsx-apu-proof2/apu.pdf`, rendered in publication mode without
  the DRAFT overlay. Mechanical layout result: 2 figures, no layout errors.
- All 28 actual PDF page rasters were inspected at readable 834×1179 resolution
  using pypdfium2 at 1.4 scale and the image viewer. Pages 1, 2, 6, 7 are pixel-identical
  to the already inspected initial proof; final pages 3–5 and 8–28 were viewed
  after the final layout edits. This was not merely SVG or browser-DOM inspection.

## Findings and corrections

The first proof left the final words “that fault” alone at the start of the
register page. The access paragraph was shortened without changing its
read-only/accepted-write distinction. Source and playback register tables now
have explicit headings and remain complete and legible on one reference page.

The initial 89-entry BADP table used three index/step pairs over 30 rows. It was
mechanically rearranged to four pairs over 23 rows, with no value or font-size
change. Its heading, introduction and complete table now fit together. The
independent source reviewer rechecked all 89 unique indices and values after
this presentation change. Short seek-table/rate/square equation groups use the
existing keep-together markup; no new renderer logic was needed.

## Final page coverage

| Pages | Visual checks |
|---|---|
|1–3| Installed-resource table, command/control datapath arrow origins, labels, command table and complete reference introduction |
|4–6| Both parameter/reset tables, nonadjacent fault addresses, access/reset ports and full STATUS table; no clipped register names |
|7–9| Source units and warnings, PCM byte-layout/interpolation, BADP source/table/block offsets and high-nibble order |
|10–12| All 89 step values with headings, recurrence/index table, byte example, rate/loop and square equations |
|13–16| Duty/gain/filter fields and numerical examples, fade/live effects, installed timing; tables and equations remain readable |
|17–20| Exact 808-cycle trace, three separate transfer-mode paths with correct arrows, address/readback and completion/request tables |
|21–22| Distinct IRQ/fault/reset sections, program ownership/resource naming, four source routes and masked-pending behavior |
|23–27| Complete typed-BSS module and every continued entry-module code block; no clipped code or missing lines |
|28| Complete retained-observation table and final explanatory paragraph |

Neither figure creates an accidental shared bus or a CPU sample-RAM aperture.
Both have visible arrowheads and labels. Fonts, borders, code indentation,
headers and footers are consistent; there are no missing glyphs, overlapping
labels, horizontal overflow, oversized indivisible blocks or lone heading-only
pages. Normal table/code continuation is not hidden or replaced with tiny text.
All printed BLua also has separate exact-source and real execution evidence in
[apu-source.md](apu-source.md).

After final independent reader acceptance, `manual:check` and `manual:publish`
both pass. The canonical `build/manual/apu.pdf` contains 28 pages; every page
was rasterized again and matches the inspected final proof pixel for pixel.
The receipt records the same engine and two figures with no layout errors.
This does not close the pending broader technical-specification audit or actual
graphics-output illustration work in the manual work list, or complete Book I.

## Shared PNG publisher revalidation — 2026-10-17

Print was reopened for the central PNG extension. Fresh publication-mode proofs
before and after the final publisher change have all 28 page rasters
pixel-identical at scale 1.4; this SVG-only chapter has no changed printed
content. Chromium 153.0.8010.12, the bundled fonts and existing SVG styling
are unchanged. The actual-page acceptance above therefore remains applicable;
this comparison is not a new factual review or an output-image claim.

## Download timing companion and complete cartridge — 2026-10-18

**PASS for the finite 32-page publication-layout proof**:
`/tmp/bmsx-apu-download-proof/apu.pdf`, SHA256
`053d2dd186a97cab0ddd63e2c372f7403f047d39efc9dcca615ecc267074dd3c`.
Unchanged shared renderer: two figures, zero register-group blocks and no layout
errors; Chromium153.0.8010.12, Nodev22.23.1/Linuxx64. Page count is inspection
scope, not completion of the manual or console reference.

Final1–28 match the accepted28-page canonical baseline in **full decoded RGBA
bytes and dimensions**, not a contact sheet/bounding-box/text shortcut. Baseline
SHA256 `c914b74cfbd486af205bac25d38afd4ba39aa2582071193b8c2d04cbd0ce382d`.
Record `/tmp/bmsx-apu-download-print/identity.json`, raster scale1.4.

Root individually viewed final29 and30 at ORIGINAL detail: the full new heading,
units/assumptions/cycle0 definition, both complete timelines, STOP discussion,
complete results module and manifest all fit with readable tables/code and
running matter. Initial inspection found the cycle0 definition split across
28/29. Extending the existing bounded intro keep-group closes that defect and
restores exact baseline28; no CSS, font shrinking, publisher or helper change.
Normal prose continuation29→30 remains readable with adequate lines on both.

An independent print-only reviewer individually viewed original31/32: every
entry-code line/border, final observations and full table pass, as do headers,
folios and footer (the latter independently crop-verified). Final31/32 exactly
match those reviewed states in **full RGBA and dimensions**; actual record
`/tmp/bmsx-apu-download-opening-delta/identity.json`. The reviewer read that
record and explicitly carries only31/32 to the final proof; no source/semantic
or other-page claim follows. Bounded report:
`/tmp/bmsx-apu-download-print-review.md`.

Source, exact-owner timing, ordinary guest and fresh public-only reconstruction
are separately recorded in [apu-download-source.md](apu-download-source.md).
No new figure-count fixture or approval gate was required; existing two diagrams
are unchanged. Whole-book, native/physical and SDK acceptance remain open.

### Canonical publication verification

All 19 existing manual-tool tests, ordinary `manual:check -- apu` and
`manual:publish -- apu` pass after completed source, public-reader and actual
print acceptance. Every canonical 32-page raster equals the accepted final
proof in full decoded RGBA bytes and dimensions. Canonical SHA256:
`09abdfe9daa1cf3ba56b5043ec129048758492a8d39c96c65f66468c8edf54c2`.
Final public-source SHA256:
`445f6067108caf7a2f41844326ddbd931abd6f3e88568d7a2f4e36aaece13e4a`.
Record `/tmp/bmsx-apu-download-published-identity.json`; logs
`/tmp/bmsx-apu-download-manual-{tests,check,publish}.log`.
The older draft preview is not this canonical publication.

The existing PCRTC publishing fixture also rewrites its canonical PDF. Every
one of its37 pages remains exact full-RGBA/dimensions equal to its independently
accepted composition proof. Current canonical SHA256:
`d3bfc8af100b85ed6bb3daa832a95d72ce0edea22fcc35d99cf8b74779fe8c16`.
Unchanged accepted GTE canonical SHA256 remains
`cd99150c94a8ff86e08f604d780784cfc6d7575458c1172e719e52401e45ca0e`.
`git diff --check` passes. No whole-book/SDK or native/physical approval follows.


## Actual source extents and selection lifetime — 2026-10-18

The new admitted-source table and selection/lifetime paragraph use the existing
shared publisher. The final unpublished publish-mode proof is32 pages:
`/tmp/bmsx-apu-source-proof/apu.pdf`, SHA256
`fe64ef5eeaf6beaf8a3e6b8339fd713f5c9a508ac3b99d5432b372434206747b`.
Final source SHA256:
`9b4da3fa8ec603d2444e4b1fbf644ecd7f80e36ae3c64a627c393d2afe8cf49a`.
This is the print companion to [the bounded source review](apu-source-binding.md),
not another whole-unit source approval.

Against the previously accepted32-page canonical baseline09abdfe9…, pages1–6
and16–32 match **complete decoded RGBA bytes and dimensions**, including running
matter. Root individually viewed the actual original final7–9 and15; the
independent print reviewer viewed10/11 in the first proof and12–14 in the next
proof, then explicitly carried their final identity and individually viewed the
new final15. Thus every changed page7–15 has actual-page acceptance, while the
remaining23 pages carry their prior individual acceptance by exact identity.
The source-region table, descriptor names, numerical/formula tables, code boxes,
headings, full-page prose and headers/footers fit and remain readable.

Two real defects were fixed, without font/CSS/publisher changes: a one-word
payload-lifetime continuation at8, and an isolated fact-free table announcer at
the bottom of15. Shorter cross-reference wording plus the existing bounded
keep-group fixes the former; deleting the redundant announcer fixes the latter.
No hardware assertion was removed. Final7–14 exactly match their individually
accepted preceding states; only15 changed in the final pass. Records:
`/tmp/bmsx-apu-source-print/{identity,first-proof-identity,final-proof-identity}.json`
and `/tmp/bmsx-apu-source-print-review.md`. No thumbnail, bbox, text extraction,
contact sheet or figure-count receipt substitutes for these page views.

### Canonical verification

All19 existing manual-tool tests, ordinary APU check and publication pass.
Every canonical32-page raster equals the accepted proof in full decoded RGBA
and dimensions; canonical SHA256:
`8fb96bf643239238c26e999a02d5fccb7d311bbddb9b2c05a658c24c81f479e1`.
Record `/tmp/bmsx-apu-source-published-identity.json`; logs
`/tmp/bmsx-apu-source-manual-{tests,check,publish}.log`.
The publishing fixture also regenerates PCRTC: all37 complete rasters equal
its accepted baseline, record `/tmp/bmsx-apu-source-pcrtc-identity.json`.
Current PCRTC SHA256:
`226794ec705b5cc4345941e72014bc79d84f97f8952322e03229b34e85abc2cf`.
GTE and cartridge canonical PDFs remain unchanged. Whole-series/SDK and portable
PDF navigation acceptance remain open. `git diff --check` passes.

## Independent-hardware edition — 2026-10-19

Accepted final publication-layout proof `/tmp/bmsx-manual-final-print/apu.pdf`:
28 pages, SHA256 `08ba02fc548867c2d140a76a9891bedee2130a0ddc9ca272065d9b05471eb7bc`.
An independent reader individually inspected all 28 pages of the preceding
`4b238162182a865ffecb1be18a3fe3372bce732307faccf263d9f7a7eb445b08` proof at
original 833×1179 detail. Two staging-table heading/instruction splits were
corrected using existing authored grouping. Root individually viewed the four
changed final pages 3–4 and 6–7; all other final pages match the inspected proof
in complete decoded RGBA and dimensions. The self-contained BADP nibble-order
paragraph remains on page 12 with its illustrative table on page 13; this is
ordinary cross-page reference flow, not a stranded heading or instruction.
Tables, both figures, code and running matter remain readable and unclipped.
Chromium 153.0.8010.12; PDFium 156.0.8076.0, scale 1.4; Linux x64.
This approves print, not unresolved APU engineering policy or PDF navigation.

All 28 canonical publication pages match the accepted proof in complete
decoded RGBA and dimensions at scale 1.4. Ordinary publication/check and
the existing 24 manual tests pass.
