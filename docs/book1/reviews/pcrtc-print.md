# PCRTC print review

Approved for the reviewed chapter and shared print assets. Source/figure semantics
are reviewed separately in [pcrtc-source.md](pcrtc-source.md).

Engine: Chromium `153.0.8010.12`, Node `v22.23.1`, Linux x64.
PDF inspection: PDFium `156.0.8076.0`, rendered at 90 dpi.

## Release proof

Rendered the existing publisher's `publish` mode to
`build/manual/inspection/final-proof/pcrtc.pdf` before approving the print flag.
Visually inspected all **20 pages**, not just the HTML or layout-check output.

- The three SVGs on pages 1, 2 and 7 have readable labels, distinct circuit
  connections, correctly terminated dimensions and visible timing landmarks.
- Register tables, numerical examples, bit columns and equations remain legible
  and within the text area. No table, register group or figure is clipped.
- Short formula, timing-figure, bus-table and example lead-ins use bounded author
  grouping. No heading stands alone at a page bottom. Register entries stay whole.
- The lengthy beam explanation is outside the SYNCV register group. Whitespace
  before whole register entries is accepted to retain a usable local reference;
  it is not hidden by shrinking type or overflowing the page.
- Page numbers and book/chapter margin labels are present on all pages.
- Mechanical layout checks report three figures, thirteen register groups and
  no horizontal overflow, oversized indivisible groups or clipped SVG labels.

The canonical artifact is `build/manual/pcrtc.pdf`, generated with
`npm run manual:publish -- pcrtc` after the recorded reviews pass. Its HTML and
all 20 rendered pages match the inspected release proof. The separate 20-page
preview retains its DRAFT banner and DRAFT footer on every page.

## Regression evidence

`npm run test:manual` passes all 15 tests covering publication gates, portable tagged/outlined PDFs,
layout failures, the real PCRTC chapter and CLI use from another working
directory. Browser font inspection confirms bundled custom fonts for sampled
prose, register text and SVG text. Tests do not substitute for the visual or
source reviews above. No publisher code, stylesheet or font changes were needed.
