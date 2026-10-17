# Memory and program storage: DRAFT print inspection

2026-10-17. **Current DRAFT readability passes; public print approval remains
open.** This does not establish complete chapter coverage or the whole-book
reader target. No publisher, CSS, font, figure renderer or review framework
changed.

## Actual final output

Command: `npm run manual:preview -- memory`.
PDF: `build/manual/memory.preview.pdf`, **22 pages, one image**.
Chromium 153.0.8010.12, Node v22.23.1, Linux/x64. The existing layout receipt
reports `errors: []`; that build result is not the visual inspection.

Each actual PDF page was separately rendered with PDFium at scale 1.4
(833 × 1179) and viewed at original detail, not through HTML or contact sheets:

- Root inspected pages 1–11: map, reservations, firmware VRAM query, sections,
  startup and typed storage. Tables, packed words, complete snippets and
  coordinate units are readable and unclipped.
- A separate reviewer inspected pages 12–22: scalar access, complete fault
  tables, installed-monitor route, actual image, complete production listings,
  result/layout tables and ordered DMA lifetime route. Code indentation and
  hex words remain legible, with no clipped table rows or footer collisions.

Final rasters: `/tmp/bmsx-memory-reader-final-pages/page-001.png` through
`page-022.png`. Independent report:
`/tmp/bmsx-memory-continuation-print-review.md`.

## Found and corrected

The initial 21-page continuation put the real BIOS image on page 16 and its
caption on page 17. Root confirmed both actual pages, then grouped only the
image and caption with the existing authored `keep-together` class. No words,
image bytes or publisher behavior changed.

The final render has 22 pages. Pages 1–15 are pixel-identical to their already
individually inspected originals. The separate reviewer individually viewed
every changed final page, 16–22: the entire image and caption now stay together
on page 17; the full short program/transcript remain readable on 16; both
storage listings, result tables and the two closing DMA paragraphs are
complete and unclipped. No outstanding DRAFT readability finding remains.

Running headers, DRAFT footers and page numbers are present. Read-only raster
comparison corroborates their consistent pixels; an initial thumbnail
impression of missing running labels was withdrawn, not worked around. The
genuine black display area in the unmodified BIOS image is not missing print
content.

## Approval boundary

This supersedes the previous 17-page, zero-image baseline print report.
Current actual-page readability is accepted only as a **DRAFT**. The remaining
programming/ownership contracts and public publication-style review keep
`reviews.print.passed` false; a longer PDF or clean layout receipt does not
close them. Reinspect changed actual pages after further manuscript edits.

## Reader-directed final reflow

The final fault-launch cross-reference and isolated DMA fault-attribution
procedure leave the PDF at 22 pages. Exact full-page raster comparison against
the above accepted draft shows only pages 16, 21 and 22 changed; all other pages
retain their individually inspected, pixel-identical evidence. Root viewed
those three final originals separately: the complete fault program/transcript/
table and guide reference remain legible on 16; the before-START procedure and
steps 1–3 fit 21; steps 4–5, full overlap explanation, both closing paragraphs
and result-guide reference fit 22. No clipped content, stranded heading or
footer collision was found.

The separate reviewer independently compared all 22 final rasters, confirmed
the same three-page delta, and individually viewed final 16/21/22 at original
detail. **Bounded final DRAFT readability PASS; no outstanding finding.**
Evidence: `/tmp/bmsx-memory-continuation-print-review.md`, reader-correction
addendum. This leaves public print approval and remaining coverage open.
