# Actual-PDF layout audit — middle scope

- PDF: `build/manual/blua-programs.preview.pdf` (44-page draft at audit time)
- Exact SHA-256: `833fdb4b62faf81902acd72c8e216749195279486e0d7a28bb4d09a9717279ca`
- Actual PDFium rasters: `/tmp/bmsx-blua-extensions-print-5/page-20.png` through `page-31.png`.
- Full pages individually viewed at original detail: **20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31**. No contact-sheet substitution.
- Scope: rendered layout only; no semantic, source, ownership, or PDF-pipeline audit.

## Actual defect

- **Pages 22–23:** page 22 ends with the isolated introductory sentence “A colon declaration adds an implicit first parameter named self:”; its associated code example begins on page 23. The introductory lead and code are separated by the page break.

## Finite good checks

- No clipped or horizontally overflowing table cells or code listings observed on pages 20–31.
- No code listing or table row split across pages observed in this scope.
- Other headings retain following content; folios are readable and sequential, 20–31.
- Book II running title and draft footer wording inspected; no confirmed defect.
- Remaining whitespace and pagination in this scope showed no further actual defect.

## Final

Scoped audit complete. One layout defect in the exact audited artifact, pages 22–23, as recorded above. Any later artifact or resolution is outside this report's artifact scope.
