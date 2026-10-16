# PCRTC draft print inspection

This is preview evidence, **not a publication approval**. The print fingerprint
remains unsigned in `pcrtc.json`; the hardware coverage and release reviews remain
open. No hardware facts were added during the publishing-tool work.

Command: `npm run manual:preview -- pcrtc`

Artifacts: `build/manual/pcrtc.preview.pdf`, `.html`, and `.json`.

Input fingerprint: `fee79f8447fbcc295a4dcb5898dcba709030faa8330dc31dd430ca1b292eb92d`

Engine: Chromium `153.0.8010.12`, Node `v22.23.1`, Linux x64.

## Inspection

- Rendered and visually inspected all 13 PDF pages, including the three SVGs on
  pages 1, 2, and 11, register tables, bit columns, and page boundaries.
- Figures retain their authored connections and dimension endpoints under inline
  rendering. This checks presentation, not the unresolved hardware semantics.
- The IMR bit layout initially exceeded the text area with the bundled mono font.
  Its repeated "mask" suffixes were removed from the diagram labels; the entry
  and mask table still identify those fields as masks. No bit position changed.
- Mechanical layout checks now report no horizontal overflow, oversized
  indivisible blocks, or SVG labels outside their viewport.
- Browser font inspection confirms bundled custom fonts for the sampled prose,
  register text, and SVG text. The build does not substitute system font paths.
- Whole-register grouping leaves substantial whitespace on page 10 before the
  full-page vertical-timing entry. Some introductory prose continues into its
  diagram/table on the next page. Revisit these editorial page breaks before
  release; the mechanical checks do not approve pagination.

The eight source-scope gaps remain listed in `pcrtc.json` and in the fact sheet.
Closing them requires source work, not removing the draft label or signing this
preview report.
