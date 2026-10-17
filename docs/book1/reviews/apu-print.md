# APU print review

The publication-mode proof contains 28 A4 pages and two semantic SVG figures.
It uses the existing shared stylesheet and bundled fonts; no publisher, layout
framework or stylesheet was changed for this chapter.

## Engine and actual inspection

- Chromium 153.0.8010.12, Node v22.23.1, Linux x64, as recorded by the render receipt.
- Final proof: `/tmp/bmsx-apu-proof2/apu.pdf`, rendered in publication mode without
  the DRAFT overlay. Mechanical layout result: 2 figures, no layout errors.
- All 28 actual PDF page rasters were inspected at readable 834×1179 resolution
  using pypdfium2 at 1.4 scale and the image viewer. Pages 1, 2, 6, 7 are pixel-identical
  to the already inspected initial proof; final pages 3–5 and 8–28 were viewed
  after the final layout edits. This was not merely SVG or browser-DOM inspection.

## Findings and corrections

The first proof left the final words “that fault” alone at the start of the
register page. The access paragraph was shortened without changing its
read-only/accepted-write distinction. Source and playback register tables now
have explicit headings and remain complete and legible on one reference page.

The initial 89-entry BADP table used three index/step pairs over 30 rows. It was
mechanically rearranged to four pairs over 23 rows, with no value or font-size
change. Its heading, introduction and complete table now fit together. The
independent source reviewer rechecked all 89 unique indices and values after
this presentation change. Short seek-table/rate/square equation groups use the
existing keep-together markup; no new renderer logic was needed.

## Final page coverage

| Pages | Visual checks |
|---|---|
|1–3| Installed-resource table, command/control datapath arrow origins, labels, command table and complete reference introduction |
|4–6| Both parameter/reset tables, nonadjacent fault addresses, access/reset ports and full STATUS table; no clipped register names |
|7–9| Source units and warnings, PCM byte-layout/interpolation, BADP source/table/block offsets and high-nibble order |
|10–12| All 89 step values with headings, recurrence/index table, byte example, rate/loop and square equations |
|13–16| Duty/gain/filter fields and numerical examples, fade/live effects, installed timing; tables and equations remain readable |
|17–20| Exact 808-cycle trace, three separate transfer-mode paths with correct arrows, address/readback and completion/request tables |
|21–22| Distinct IRQ/fault/reset sections, program ownership/resource naming, four source routes and masked-pending behavior |
|23–27| Complete typed-BSS module and every continued entry-module code block; no clipped code or missing lines |
|28| Complete retained-observation table and final explanatory paragraph |

Neither figure creates an accidental shared bus or a CPU sample-RAM aperture.
Both have visible arrowheads and labels. Fonts, borders, code indentation,
headers and footers are consistent; there are no missing glyphs, overlapping
labels, horizontal overflow, oversized indivisible blocks or lone heading-only
pages. Normal table/code continuation is not hidden or replaced with tiny text.
All printed BLua also has separate exact-source and real execution evidence in
[apu-source.md](apu-source.md).

After final independent reader acceptance, `manual:check` and `manual:publish`
both pass. The canonical `build/manual/apu.pdf` contains 28 pages; every page
was rasterized again and matches the inspected final proof pixel for pixel.
The receipt records the same engine and two figures with no layout errors.
This does not close the pending broader technical-specification audit or actual
graphics-output illustration work in the manual work list, or complete Book I.
