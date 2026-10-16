# GTE draft print review

Engine: Chromium `153.0.8010.12`, Node `v22.23.1`, Linux x64.
PDF inspection: PDFium `156.0.8076.0`, rendered at 90 dpi.
Source/figure semantics: [gte-source.md](gte-source.md).

## Current artifact and scope

`npm run manual:preview -- gte` renders the current **37-page draft** to
`build/manual/gte.preview.pdf`. All pages were inspected as actual readable PDFium
images, split across three reviewers (1–12, 13–24, 25–37). The integrating editor
also checked the specifications, new projection diagram, rendering sequence and
final arithmetic/example pages.

The chapter uses the existing stylesheet, fonts and publisher. The only new figure
is an authored SVG of the worked triangle and its dimensions. There is no
chapter-specific rendering code, smaller type, automatic section assembler or
new publication schema.

## Findings and resolutions

- The specifications and programming tables are readable at ordinary table size;
  field labels are paired with ranges in actual cells.
- The new geometry diagram has readable vertex/origin/offset labels, visible axis
  arrowheads and dimension endpoints. Its coordinate area is not represented as
  a hardware clipping window.
- The triangle setup, result snapshots, GP0 packets, PCRTC setup, and translated
  projection retain complete tables in usable order. The NCCS/DPCS examples and
  all individual command entries remain readable across page boundaries.
- Three real pagination findings were corrected using existing author grouping:
  NCLIP's lead-in stays with its formula; the screen-coordinate heading/lead-in
  stays with its ordered formula; PLUS's publication lead-in stays with its result
  table. No publisher exception was introduced.
- All thirteen register groups fit their pages. Whitespace before an indivisible
  entry is accepted rather than splitting it or shrinking its type. The seed ROM
  title, legend, all257 bytes and final index100 remain together.

After final wording/specification/grouping changes, a pixel comparison identified
changed pages2–5,11,14,34–37. Those pages were reinspected; all other final pages
were pixel-identical to the initially inspected draft. No clipping, overlap,
stranded-heading or unusable table/formula break remains in the final draft.

## Validation and publication status

The shared layout checks report three figures, thirteen register groups and no
layout errors. All sixteen manual tests pass; the actual GTE integration test
renders a draft without requiring editorial publication approval. All121 focused
GTE/GPU tests pass. These mechanical/runtime results do not substitute for the
source, reader or PDF reviews.

Every draft page retains its DRAFT footer. This review approves the inspected
layout, **not final publication**: the physical-clock/bus specification question in
[gte.json](gte.json) remains open. The earlier eighteen-page release artifact is
not the current draft and has not been silently replaced with an approved release.
