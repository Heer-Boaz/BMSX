# GTE print review

Engine: Chromium `153.0.8010.12`, Node `v22.23.1`, Linux x64.
PDF inspection: PDFium `156.0.8076.0`, rendered at 90 dpi.
Source/figure semantics: [gte-source.md](gte-source.md).

## Release proof

The existing publisher rendered `publish` mode to
`build/manual/inspection/gte-final-proof/gte.pdf` before print approval.
The final release proof has **18 pages**. Inspection uses the actual PDF pages,
not just HTML, SVG source, or the mechanical layout result.

- Both diagrams on pages 1–2 have readable labels and arrowheads. Normal and
  PLUS datapaths remain distinct; the VMAD3 chart's intervals and publication
  boundary are visible and its not-to-scale qualification is retained.
- Real bit-field tables pair ranges and labels in cells. Short type captions
  keep the narrow word-label column legible; no space-aligned bit grids remain.
- The 76-word inventory is grouped into thirteen complete register entries.
  No entry, table, equation or SVG is clipped or taller than the print area.
- The matrix, reciprocal and programming lead-ins stay with their primary
  equations/tables. The two raw-word recipes are readable on pages 16–17.
- The function-selection heading, notation and first six command rows stay
  together on page 13; all 22 command rows fit without clipping.
- The reciprocal ROM uses sixteen byte values per row at the ordinary table
  size. Its title, index legend, all 257 values and final index100 now share
  page 18. The initially detached appendix heading was fixed with existing
  author grouping, not a publisher special case or smaller type.
- Whitespace before indivisible register entries is accepted to retain a useful
  local reference. Mathematical prose flows normally across pages; no heading
  stands alone at a page bottom. Running labels and page numbers are present.
- Mechanical checks report two figures, thirteen register groups, and no layout
  errors. These checks did not substitute for visual/source review.

All eighteen final PDF pages were visually inspected, including an independent
full-page review and reinspection of the changed pages 12–18. No print findings
remain.

Canonical output: `build/manual/gte.pdf`, produced by
`npm run manual:publish -- gte` after the recorded reviews pass. Its HTML and
all eighteen rendered pages match the inspected release proof exactly. The
separate eighteen-page preview retains its DRAFT banner and per-page DRAFT
footer; the release contains no DRAFT marking.

## Regression scope

The chapter uses the shared catalog, stylesheet, fonts and publisher without
GTE-specific rendering code. The manual suite covers publication gates, layout
failures, embedded fonts and portable tagged/outlined PDFs, plus the actual
PCRTC and GTE chapters. All sixteen manual tests pass, as do the GTE preview,
check and publish commands. The focused GTE tests and live mapped-owner examples
are source/behavior evidence, not a replacement for this print inspection.
