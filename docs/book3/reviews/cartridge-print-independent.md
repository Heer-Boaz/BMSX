# Cartridge unpublished proof: assigned print review

## Scope and actual views

Print-only review of pages 7–12. No source/spec acceptance, runtime validation, canonical-publication acceptance, repository edits, or new inspection framework.

The PDF originally inspected at `/tmp/bmsx-cartridge-manual-proof/cartridge.pdf` is retained as `/tmp/bmsx-cartridge-manual-before-ram-range.pdf`.

- Baseline PDF SHA-256: `0bff0d73d87a2d0de5499b4fdcbef9cba7365bbfbe747f3c2284721c6bf7a044` (verified).
- Actually viewed individually through `view_image` at **original** detail: `/tmp/bmsx-cartridge-manual-proof/pages/page-007.png`, `page-008.png`, `page-009.png`, `page-010.png`, `page-011.png`, `page-012.png`.
- All six original image dimensions independently verified: **833 × 1179 px**.
- Because the visual tool suppressed identical strips in successive full-page views, every assigned page's running-title and footer/folio were additionally cropped and viewed separately, then enlarged for unambiguous repeated-strip visibility. These are inspection derivatives only, under `/tmp/bmsx-cartridge-final-review-strips/`.

## Baseline findings

| Page | Visual finding |
|---|---|
| 7 | Bounded PASS. The CONTROL contribution table, timing table, inline code, body paragraphs, ACCESS FAULTS heading/lead, full running title, CARTRIDGE footer and folio 7 are legible. No clipped rows, glyphs, lines, or misleading code/table cut observed. |
| 8 | Bounded PASS. Access-fault continuation, two-card example heading and paragraphs, card-definition lead and complete socket-0 YAML block are legible and unclipped. Socket-1 definition continues clearly on page 9, not mid-row or mid-code-line. Full running title, footer and folio 8 are intact. |
| 9 | Bounded PASS. Socket-1 YAML, Result module heading/lead and entire results.lua listing are legible, including underscores, brackets, angle brackets and final return. No clipped or stranded listing line. Full running title, footer and folio 9 are intact. |
| 10 | Bounded PASS. Entry module lead and both consecutive code boxes are legible, including declarations, addresses, operators, comments and final end. Entry continuation is explicitly signposted; no line/token is cut at the page boundary. Full running title, footer and folio 10 are intact. |
| 11 | **Pagination failure in baseline:** Retained observations heading and introductory paragraph appear below the complete entry listing, while all associated table rows begin on page 12, leaving substantial blank space after the lead. The heading/lead is stranded from its table. The code itself, full running title, footer and folio 11 are legible and unclipped. |
| 12 | Both retained-observation tables and all row labels, values, hexadecimal glyphs and closing paragraphs are legible and unclipped. Full running title, footer and folio 12 are intact. Shares the page-11/12 heading-to-table separation finding above. |

The complete running title actually seen on every assigned page is `BOOK III - CARTRIDGE AND EXPANSION REFERENCE`, with the right edge intact.

## Frozen final-proof carry

- Frozen final PDF: `/tmp/bmsx-cartridge-manual-proof/cartridge.pdf`.
- Final SHA-256 independently verified: `80bd33091725618c5fd52290f2c76f6a29573a45af03b08a5b79361d17fabad2`.
- Read `/tmp/bmsx-cartridge-manual-final-pages/identity.json`; independently compared baseline and final PNG **dimensions plus every decoded RGBA byte** for assigned pages **7, 9 and 10**. Each is 833 × 1179 and exactly identical. The bounded visual PASS for only these three pages carries to the frozen final proof.
- Assigned pages **8, 11 and 12 changed**. This reviewer does not carry baseline visual acceptance to those final pages and has not individually viewed their final replacements. Root reports separate original-image supplemental review of changed pages 8, 11 and 12, including correction of the retained-observations grouping. That supplemental evidence belongs to root's report, not this reviewer's actual-view claim.

Conclusion: baseline pages 7–12 were all actually viewed; the baseline has the specific heading/lead pagination failure above. Final pages 7/9/10 receive bounded print-only PASS through independently verified pixel identity. No global or publication acceptance is asserted.
