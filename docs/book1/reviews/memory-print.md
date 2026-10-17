# Memory and program storage: DRAFT print inspection

2026-10-17. **Current DRAFT is visually reviewed; public print approval remains
open.** This is not a published/complete chapter. Coverage gaps and the reader
route remain tracked in memory.json and memory-source.md. No publisher, CSS,
font, figure renderer or approval framework was changed.

## Actual output and scope

Ordinary command: `npm run manual:preview -- memory`.
Actual PDF: `build/manual/memory.preview.pdf`, 17 pages, zero image figures.
Chromium 153.0.8010.12, Node v22.23.1, Linux/x64. Existing layout check reports no
errors. It is build evidence, not the visual inspection itself.

Each actual PDF page was rendered separately with PDFium at scale1.4
(833×1179) and viewed at original detail, not through contact sheets or HTML:

- Root individually inspected pages1–8: map/reservations, DATA/BSS placement,
  startup, typed declaration/size/alignment tables, firmware fragments, pointer
  indexing, address-of, sizeof/offsetof and explicit byte-address maps.
- A separate reviewer individually inspected pages9–17: execution/domains,
  scalar access, complete fault/register/ACCESS/cause tables, both full BLua
  modules, worked layout/address/result tables. Hex words and code indentation
  are readable, tables/code are unclipped and margin page numbers remain clear.

## Finding and final recheck

The initial page9 ended with the execution-domain heading and its lead while
the whole table began on10. Grouped that short lead and table using the existing
authored keep-together class. No words, cells, diagram logic or publisher code
changed. After this first layout correction the PDF still has17 pages; exact full-page raster comparison
shows only9and10 changed. The reviewer individually viewed those final two
pages: heading/lead/table/explanation now stay together on10, page9 ends after
a complete byte-order explanation, and the scalar heading retains its intro.
Previously inspected pages1–8and11–17 are pixel-identical to their final pages.
No unresolved current-draft clipping/stranding finding remains.

An initial reviewer impression of missing running headers/left draft footers
was withdrawn, not worked around. Actual final top65-pixel bands are identical
on all17 pages, with nonwhite header bounds(71,34,763,41); the left footer bands
are also identical to the visibly present page1. These checks corroborate the
actual images rather than treating a thumbnail impression as a publisher bug.

Evidence: `/tmp/bmsx-memory-draft-print-review.md`, initial inspected rasters
`/tmp/bmsx-memory-integrated-pages/` and final rasters
`/tmp/bmsx-memory-final-pages/`. A final non-DRAFT/publication-style review must
follow when the incomplete programming contracts and chapter coverage are
resolved. Do not promote this draft readability check to that approval.

## Reader-correction final reflow

The four separately source/reader-reviewed clarifications were then applied;
both production code blocks remain unchanged. The current ordinary DRAFT still
has17 pages. Full-raster comparison against the prior accepted draft shows
only4,5,6,14and16 changed. Root individually viewed final4–6 at original detail:
status-setting text, the complete two-line section continuation before the
next heading, and Word/initializer clarification are readable and unclipped.
Root and the separate reviewer individually viewed final14and16 at original
detail. The new type-scope and linked-RODATA explanations are complete and
legible; code and tables remain unclipped, with no new stranded heading.
All changed pages pass bounded DRAFT readability review; unchanged pages
retain their exact prior visual evidence. This does not close the public
print review or the remaining programming contracts. Current rasters:
`/tmp/bmsx-memory-reader-corrected-pages/`.
