# BIOS loader print review — tail pages

## Evidence and coverage

- PDF SHA-256 supplied by the root reviewer: `6ae19e24e42b8faae2fea8bdbb25c04f68e237c2e6a69a35198443b902c43cb1`.
- Source SHA-256 supplied by the root reviewer: `b59cf2dbdc1b3ef6bd21d7f20c6fd05a5585df7fffeb85cdc5d8e6594b11e5d3`.
- Root-produced rasterization: GPL Ghostscript 10.06.0, PNG16M, 120 dpi.
- Individually viewed full-page images with `view_image`: actual pages **13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23** at `/tmp/bmsx-bios-loader-print-evidence/initial/pages/page-N.png` (11 pages). Page 14 was additionally viewed with original detail.
- Scope: visual print layout only. No technical/content audit, source edits, PDF regeneration, or review of pages 1–12.

## Observed layout findings

1. **Pages 14–15 — “Exported node constants”: detached section introduction.** Page 14 ends with the section heading and its two-line explanatory paragraph (“All constants below…”), while the first `Node constant | Value` table begins at the top of page 15. None of the introduced table accompanies that bottom-of-page introduction.
2. **Pages 16–17 — “Errors and compiler-owned fields”: stranded table lead.** Page 16 ends its text with “The following conditions explicitly raise during binding:”; the associated `Condition | Rule` table begins at the top of page 17. The colon-ending lead is separated from every table row by the page break.

## Bounded remainder

- No visible clipping, border/text collisions, broken table rows, or unreadable long diagnostics were observed in these 11 full-page views.
- Page 18's resource arithmetic displays multiplication and paired ceiling marks rather than missing-glyph boxes; the formula stays within the text width.
- Results/entry code on pages 20–22 has visible indentation and continuation lines, intact boxes, and comfortable right margins. Page 22's complete observed-results block, including the long final syntax diagnostic, fits in its box.
- Page 23 holds a complete final explanatory paragraph with considerable remaining white space; no clipped continuation or missing ending is apparent.
- Small running margin text is not treated as absent merely because a particular full-page viewer rendering does not make it legible. The root review's independent margin-title confirmation remains authoritative.

---

# Corrected PDF follow-up review

## Evidence and exact coverage

- Corrected PDF: `/tmp/bmsx-bios-loader-print-evidence/corrected/bios-loader.preview.pdf`, 24 pages.
- Corrected PDF SHA-256 supplied by root: `24887e3832facad7adc5e0396c17b942309b86047852c43b56ba8040e53d37ef`.
- Corrected source SHA-256 supplied by root: `6711b017e0044aeb037897fa69cdaed6c555a66b0804fa76585a9ed75fdff5d7`.
- Root-produced rasterization: GPL Ghostscript 10.06.0, PNG16M, 120 dpi.
- Individually viewed each corrected full-page image **13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24** (12 pages) at `/tmp/bmsx-bios-loader-print-evidence/corrected/pages/page-N.png`.
- Every view used `view_image` with `detail: original`, and the image was forwarded with original detail. No reuse of initial-page images for this corrected coverage.

## Earlier tail findings resolved

- “Exported node constants” now has its heading, explanatory paragraph, and first two table blocks together on corrected page 15.
- “The following conditions explicitly raise during binding:” now accompanies both `Condition | Rule` table blocks on corrected page 17.

## New actual pagination findings

1. **Corrected pages 17–18 — compiler-owned-field table lead stranded.** The last line on page 17 is “Supply constructor inputs rather than precomputed compilation annotations. Compiler-owned fields include:”. The associated `Area | Fields written by compilation` table starts at the top of page 18, leaving the colon-ending introduction without a table row on page 17.
2. **Corrected pages 20–21 — Results module introduction detached from listing.** Page 20 ends with the “Results module” heading and the two-line paragraph beginning “The ordinary module exports…”. The entire results-module code listing begins at the top of page 21. No part of the introduced listing accompanies its heading/paragraph on page 20.

## Bounded remainder

- No other actual layout failure was observed in corrected pages 13–24.
- The new “System startup and compiled-code storage” subsection is visually intact and readable on page 20, with no clipped lines or broken paragraph continuation.
- Resource arithmetic on page 19 retains visible multiplication and paired ceiling marks, with no missing-glyph boxes or overrun.
- BLua listings on pages 21–23 retain readable indentation, continuations, intact boxes, and right margins. Page 23's long observed diagnostic lines fit within their box.
- Page 24's final paragraph is complete and readable. Small margin titles are not claimed missing based on viewer display.

---

# Final corrected-2 PDF disposition

## Final evidence and coverage

- Final PDF: `/tmp/bmsx-bios-loader-print-evidence/corrected-2/bios-loader.preview.pdf`, 24 pages.
- Final PDF SHA-256 supplied by root: `0b55f4e5025aa3f50d3e262516b3419cd748cd67ce7732d6d2a26ffe98d6ee42`.
- Final source SHA-256 supplied by root: `ad76bd0f8428176999810405524926eeebb86809297c6ed0e2795e84dbdeafac`.
- Root-produced rasterization: GPL Ghostscript 10.06.0, PNG16M, 120 dpi.
- Individually viewed final changed full pages **17, 18, 20, 21** using `view_image` with original detail and original-detail image forwarding, from `/tmp/bmsx-bios-loader-print-evidence/corrected-2/pages/page-NN.png`.
- Reused the prior individually viewed full-page evidence for final pages **14, 15, 16, 19, 22, 23, 24** based on root's exact full-RGBA pixel-identity comparison recorded in `corrected-2/pixel-identity.json` against the same-number corrected pages. This is evidence reuse, not a claim of newly viewing those seven final PNGs.
- Final tail disposition therefore covers **actual pages 14–24 inclusive**: four newly viewed final pages plus seven exact-pixel-identity reuses. Root assigned final pages 9–13 to the front reviewer.

## Disposition: scoped visual PASS

- Final page 18 now keeps the compiler-owned-fields introduction and the entire `Area | Fields written by compilation` table together. Final page 17 ends with a complete preceding paragraph rather than the table lead.
- Final page 21 now keeps the “Results module” heading, its explanatory paragraph, and the entire results-module code listing together. The entry-module part 1 heading and complete listing also fit on page 21.
- No new stranded lead, broken table/code block, clipping, border/text collision, or margin overrun was observed in the four newly viewed final pages.
- Prior remainder findings and visible formula/code/diagnostic evidence carry forward only for the exact-pixel-identical pages listed above. No remaining actual visual layout failure is recorded within this final tail scope.
