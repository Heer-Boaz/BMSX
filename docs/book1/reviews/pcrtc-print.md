# PCRTC print review

Approved for the reviewed chapter and shared print assets. Source/figure semantics
are reviewed separately in [pcrtc-source.md](pcrtc-source.md).

Engine: Chromium153.0.8010.12, Nodev22.23.1, Linuxx64. Actual PDF pages were
rendered with the existing PDFium environment at1.5× and visually inspected.
The shared publisher, fonts, stylesheet and three figures are unchanged.

## Current release proof

Rendered the existing publisher's publish mode to
`/tmp/bmsx-pcrtc-release-proof/pcrtc.pdf` before approving the print flag.
All22 pages were individually inspected at readable resolution: one reader
covered1–12 and a second covered13–22. Root additionally inspected1–4.
The old21-page canonical artifact was not used as current proof.

- New Section1.1 resource and reset-deadline tables retain every column, row and
  wrapped field. Code/formula values are legible and contained. The CPU-transfer
  paragraph continues with multiple lines, not a single-line widow.
- Existing overview/window/reset diagrams, latch and interrupt flows retain
  distinct connections, complete dimensions and readable labels.
- Local-memory formulas, format/composition/access/fault tables, numerical
  examples and every register/bit-field group remain complete and within bounds.
  No heading is stranded, table clipped or figure label lost.
- Inspection found the GX16 heading/lead-in separated from its formula at5→6.
  The existing bounded author grouping now keeps all three together; rebuilt
  affected pages received another visual check. No shared renderer change or
  smaller-type workaround was needed.
- Whole register groups retain deliberate whitespace rather than splitting
  fields or shrinking their type. Running book/chapter labels and page numbers
  remain present. The lengthy beam explanation stays outside the SYNCV group.

The canonical artifact is `build/manual/pcrtc.pdf`, regenerated after recorded
reviews pass. It must match the inspected release proof. The separate preview
retains its DRAFT banner/footer.

## Native bit-field tables and regression

All26 LOW/HIGH field maps remain authored tables, not space-aligned text. Their
range/field mappings are unchanged by the specification supplement. The actual
register pages were visually inspected, including DISPLAY1/2, SMODE1 and CSR.
Mechanical checks report3 figures,13 register groups and no horizontal overflow,
oversized indivisible groups or clipped SVG labels.

```sh
npm run manual:preview -- pcrtc
npm run manual:check -- pcrtc
npm run manual:publish -- pcrtc
npm run test:manual
```

All16 shared manual tests pass. These are publishing/portability/layout contract
checks, not substitutes for the visual or source evidence above. No new chapter
framework, manifest, publisher branch, font or style rule was added.

## Shared PNG publisher revalidation — 2026-10-17

Print was reopened for the central PNG extension. Fresh publication-mode proofs
before and after the final publisher change have all 22 page rasters
pixel-identical at scale 1.4; this SVG-only chapter has no changed printed
content. Chromium 153.0.8010.12, the bundled fonts and existing SVG styling
are unchanged. The actual-page acceptance above therefore remains applicable;
this comparison is not a new factual review or an output-image claim.
