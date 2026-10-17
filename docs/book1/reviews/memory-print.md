# Memory and program storage: DRAFT print inspection

2026-10-17. **Current DRAFT readability passes; public print approval remains
open.** This does not establish complete chapter coverage or the whole-book
reader target. No publisher, CSS, font, figure renderer or review framework
changed.

## Previously accepted 22-page baseline

Command: `npm run manual:preview -- memory`.
At that review: `build/manual/memory.preview.pdf`, **22 pages, one image**.
The current device-buffer continuation is recorded below.
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


## Device-buffer continuation: current actual output

Current command: `npm run manual:preview -- memory`.
Current `build/manual/memory.preview.pdf`: **24 pages, one unchanged image**.
Chromium 153.0.8010.12, Node v22.23.1, Linux/x64; receipt `layout.errors: []`.
No publisher, stylesheet, font, figure or grouping change was made.

Root independently rendered every final page with PDFium at scale 1.4 and
compared full-page pixels against the previously individually inspected
22-page baseline. Pages 1–21 are identical; pages 22–24 are changed or new.
Root individually viewed final 22, 23 and 24 at original detail. The DMA/GEO
transition, ordered continuation, GTE/IMGDEC/APU sections, register names and
last result-procedure link are readable and unclipped, without stranded
headings or footer collisions. Current rasters:
`/tmp/bmsx-memory-buffers-final-pages/page-001.png` through `page-024.png`.

The first 25-page render stranded only the one-line closing cross-reference
on page 25. Both root and the independent reviewer found it in actual rasters.
Joining that sentence to the preceding paragraph, without changing any words,
puts it on the already short final line of page 24. Root re-viewed every
changed final page; stale page-25 raster was removed. No speculative spacing,
new helper or publishing rule was introduced to hide the problem.

Current bounded readability does not close the remaining coverage questions or
public publication-style approval; `reviews.print.passed` remains false.

The independent reviewer also individually re-opened corrected final 22–24
at original detail, checked the full 24-page/raster count and identical 1–21
baseline, and accepted the resolved bridge placement. **Bounded current DRAFT
print PASS, no outstanding local readability finding.** Evidence:
`/tmp/bmsx-memory-buffers-print-review.md`. Whole-reader/publication approval
remains a separate, still-open decision.
