# CPU actual-PDF layout acceptance

Current verdict: **print-layout pass for the current draft**. The original
25-page individual inspection and the final revised-page closure are retained
below. This does not clear source-contract/reference coverage or publication.

# CPU actual-PDF print review

## Scope and evidence

- Artifact reviewed: `/home/boaz/BMSX/build/manual/cpu.preview.pdf`, 25 pages; PDF mtime 2026-10-17 23:23:14 +0200. SHA-256: `ea4d6699418d0c84fa5869bf4290d04795f913b74b199ff4f95a9d35f86afba4`.
- Every actual PDF page was inspected individually with `view_image` at original raster size, using the 1.4× PDF renders `/tmp/bmsx-cpu-final-pages/page-01.png` through `page-25.png` (833 × 1179 pixels). No HTML or contact sheet was used for visual approval.
- Exact pages inspected: **1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25**.
- Scope is printed layout only, not source-contract correctness, architecture, completeness, or publication clearance. DRAFT is intentional and must stay; the six independently identified source-contract differences remain separate publication blockers.

## Required layout correction

1. **Pages 18–19, “Memory transfers” opening paragraph — one-word widow.** The paragraph starts beneath the section heading at the foot of page 18 and ends with the lone word **“integer.”** at the top of page 19, above “Scalar formats.” Keep the opening paragraph together or reflow its wording so the final line is not isolated. The source owner is `docs/book1/cpu.md` immediately following `## Memory transfers` (currently line 750). The live source paragraph already differs from the reviewed PDF, so the next render must be checked rather than assuming this pagination persists or is fixed.

## Other inspected layout results

- **Pages 1–3:** Draft banner, chapter title, result-storage declarations, and both entry-module code panels are readable. No code line crosses a border or page edge; the long `print` lines on page 3 fit. Page 2's continuation lead stays complete before the next code panel. The lower-page whitespace on pages 2–3 is substantial but results from keeping the large code/results blocks intact, not lost or clipped content.
- **Page 4:** Retained-results table fits all three columns, including long field names, signed values, hexadecimal payloads, and the two-name rows. Diagnostic-output columns remain distinct and inside the code box.
- **Pages 5–7:** Resource table, word-bit fields, ABC/Bx/displacement widths, WIDE description, cycle-accounting lead, counted-store costs, and reset section have readable cells and safe margins. No table row is sliced across pages. The cycle-accounting continuation across pages 6–7 is a normal paragraph break, not a stranded heading or single-word continuation.
- **Pages 8–14:** Source-operator table and numeric, constant/copy, arithmetic, power-case, bitwise, text-conversion, and comparison tables fit. Opcode labels, nominal-cycle columns, mathematical signs/superscripts, and monospaced operands are visible. No clipped mnemonic or right-edge result text was found. Page 9's blank lower portion precedes a complete large instruction table on page 10.
- **Pages 15–18:** Register notation, call counts, capture descriptors, calls/globals/table instruction tables, and builtin-charge prose remain readable. Long expressions wrap within cells; headings retain introductory content. The page-18 lead widow is the only defect noted above.
- **Pages 19–21:** Scalar formats, C selector, alignment column (including bold four-byte F64LE alignment), address formula, counted-store formula, memory-instruction table, branch formula, and branch table fit their available widths. No formula reaches the page edge, and no low table row intersects a footer.
- **Pages 22–25:** CP0 field table, EXEC, exception return, HALT, BLua control syntax, control-instruction table, and final saved-PC prose are readable and uncropped. Page 23 is sparse because the next substantial kept block starts on page 24; no dangling heading or lost content was observed. The final page is naturally short.
- Header/footer positions and outer margins remain consistent. Header omission on some continuation pages is consistent across the document; no body/header or body/footer collision was found. The chapter has no figure to inspect; its genuine visual evidence is code, tables, and diagnostics.

## Disposition

**Print-layout correction required for the page-18/19 widow, followed by actual-PDF reinspection after the pending content changes.** Apart from that identified break, the reviewed 25-page PDF has no observed clipping, overflow, damaged table/code labels, stranded headings, or margin collisions. This finding does not authorize removal of DRAFT or publication.

## Revised-render closure

Revised actual-PDF pages **18, 19, and 20** were individually visually re-inspected at original raster size using `/tmp/bmsx-cpu-revised-pages/page-{18,19,20}.png`. The one-word widow is closed: the complete Memory transfers lead now fits on page 18. Page 19 starts cleanly with Scalar formats; its table, address formula, and Scalar access and IO heading plus complete lead fit. Downstream page 20 prose and counted-store formula remain readable without clipping or footer collisions. The other 22 raster pages are unchanged from the individually inspected baseline (root exact-byte comparison). **Print-layout pass: no outstanding observed layout defect.** This supersedes the earlier required correction/disposition and does not approve source completeness or removal of DRAFT.
