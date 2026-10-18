# BLua extensions printed-layout tail audit

PDF: `build/manual/blua-programs.preview.pdf`

SHA-256: `833fdb4b62faf81902acd72c8e216749195279486e0d7a28bb4d09a9717279ca`

Final pages individually viewed in full, with `view_image` detail `original` and `image(..., 'original')`: **32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44**.

Actual PDFium rasters: `/tmp/bmsx-blua-extensions-print-5/page-32.png` through `page-44.png`.

## Result

**Scoped PASS: no actual layout defects found on pages 32–44.**

- Tables and code remain inside their borders and page text area; no clipped or overlapping content observed.
- Heading/lead/table or listing groups stay together where required. The result-storage listing at page 41 and iterator-storage listing at page 43 are with their headings.
- Page 38's lower whitespace accommodates the complete entry listing on page 39; no isolated heading is left behind.
- DRAFT footer and sequential page numbers are intact throughout the viewed range.
- Book II running-header text and placement are consistent on pages where the viewer displayed the small text. The earlier apparent missing-header suspicion was resolved by the parent's exact actual-PNG header-band identity check; it is not a PDF defect.

Scope: printed layout only, not source/factual accuracy/owners or whole-pipeline validation. Earlier draft pages were superseded; the final result above is based on fresh full-page views of all thirteen assigned final pages.
