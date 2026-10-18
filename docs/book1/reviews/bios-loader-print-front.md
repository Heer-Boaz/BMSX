# BIOS runtime compilation — actual-PDF visual review, front-page tranche

## Frozen artifact and method

- PDF: `/tmp/bmsx-bios-loader-print-evidence/initial/bios-loader.preview.pdf`
- PDF SHA-256: `6ae19e24e42b8faae2fea8bdbb25c04f68e237c2e6a69a35198443b902c43cb1`
- Receipt: `/tmp/bmsx-bios-loader-print-evidence/initial/bios-loader.preview.json`
- Receipt SHA-256: `c818f1b995f0d74e4eb7ed730a4ea7147635e6fb8fbc39467f39cf2325eeb79e`
- Frozen source SHA-256: `b59cf2dbdc1b3ef6bd21d7f20c6fd05a5585df7fffeb85cdc5d8e6594b11e5d3` (not used as visual evidence).
- Receipt engine: Chromium `153.0.8010.12`; Node `v22.23.1`; Linux x64.
- Independent rasterizer: GPL Ghostscript `10.06.0`, `png16m`, 120 dpi.
- Exact raster command: `gs -q -dSAFER -dBATCH -dNOPAUSE -sDEVICE=png16m -r120 -sOutputFile=/tmp/bmsx-bios-loader-print-evidence/initial/pages-120dpi/page-%03d.png /tmp/bmsx-bios-loader-print-evidence/initial/bios-loader.preview.pdf`.
- Output: 23 actual PDF-page images, each 992 × 1403 pixels; retained at `/tmp/bmsx-bios-loader-print-evidence/initial/pages-120dpi/page-001.png` through `page-023.png`.

## Actual pages viewed

Every full page **1–12 inclusive** was opened individually with `view_image` at readable full-page resolution. Pages **13–14** were also opened individually before the review was divided with the tail reviewer, but no tail coverage is claimed by this tranche. Page 2 was reopened, then its top and bottom margins were enlarged and viewed separately; those retained crops are `page-002-top.png` and `page-002-bottom.png` in the same raster directory.

## Observed finite layout findings

1. **Pages 5 → 6: detached operator-precedence table lead.** The sentence “Binary precedence is listed from highest to lowest; each level is left-associative.” is the final body line on page 5. Its `Precedence | Operators` table begins at the top of page 6. The lead and its table are separated by the page turn.
2. **Pages 7 → 8: split “Calls and results” heading/intro/table group.** The heading and the paragraph beginning “An ordinary call evaluates its callee before evaluating its arguments” are near the bottom of page 7; the corresponding `Context | Result handling` table begins at the top of page 8, without the heading. The table itself is intact.

## Other bounded observations

- On the viewed front-page tranche, no observed clipped/overlapping table cells or long signatures, split table rows, cut-off code borders, blank pages, empty headings, or missing diagnostic text.
- The recursive-local BLua code on page 7 and the multiline `numeric_for_statement` signature on page 12 retain visible indentation and remain inside their boxes.
- The inline diagnostics on pages 2 and 9 wrap within the body margins and remain readable.
- Page numbering is consecutive on the viewed pages. The actual page-2 enlarged margins explicitly show `BMSX`, `BOOK II · BLUA32 AND BIOS REFERENCE`, `BIOS RUNTIME COMPILATION — DRAFT/NOT FOR PUBLICATION`, and page number `2`. An initial small-scale impression that running matter was missing was disproved by these actual-pixel crops and is **withdrawn**, not a publisher finding.

## Bound

This is actual-PDF layout evidence, not technical approval or a whole-publisher/navigation audit. Tail-page findings (13–23), including the resource formulas and remaining full diagnostics, belong to the parallel tail reviewer. No repository/source/style edits were made. No corrected artifact was provided during this finite pass, so unchanged-page pixel reuse has not been claimed.

# Corrected PDF — front-page re-review

## Corrected identity and evidence reuse

- PDF: `/tmp/bmsx-bios-loader-print-evidence/corrected/bios-loader.preview.pdf`
- Corrected PDF SHA-256: `24887e3832facad7adc5e0396c17b942309b86047852c43b56ba8040e53d37ef`.
- Corrected receipt SHA-256: `c818f1b995f0d74e4eb7ed730a4ea7147635e6fb8fbc39467f39cf2325eeb79e`.
- Corrected source SHA-256 supplied with this artifact: `6711b017e0044aeb037897fa69cdaed6c555a66b0804fa76585a9ed75fdff5d7` (not visual evidence).
- Receipt engine remains Chromium `153.0.8010.12`, Node `v22.23.1`, Linux x64. Supplied actual-page rasters use the same GPL Ghostscript `10.06.0`, `png16m`, 120 dpi.
- Retained corrected actual-page images: `/tmp/bmsx-bios-loader-print-evidence/corrected/pages/page-01.png` through `page-24.png`.
- Root's complete decoded-pixel identity map: `/tmp/bmsx-bios-loader-print-evidence/corrected/pixel-identity.json` identifies corrected pages 1–4 as identical to initial pages 1–4 and every page 5–24 as changed/new.
- Independently decoded and compared the **entire RGBA pixel buffers** of corrected pages 1–4 against the initial pages actually viewed by this reviewer. Each is exactly 5,567,104 bytes and byte-for-byte identical. This independent evidence is retained in `/tmp/bmsx-bios-loader-print-evidence/corrected/front-unchanged-page-identity.json`. Thus actual visual evidence is reused only for unchanged pages **1–4**.

## Exact corrected coverage

Opened corrected actual pages **5, 6, 7, 8, 9, 10, 11, and 12**, individually, using `view_image` with `detail: original` and forwarding original image detail. Corrected pages 13–24 remain the tail reviewer's responsibility.

## Fix verification and new finite findings

- **Initial finding 1 fixed:** on corrected page **6**, the binary-precedence lead and its complete `Precedence | Operators` table are on the same page. No lead is left behind on page 5.
- **Initial finding 2 fixed:** on corrected page **8**, the `Calls and results` heading, its introductory paragraph, and the complete `Context | Result handling` table are together. No heading/intro is left behind on page 7.
- **New split, corrected pages 9 → 10:** page **9** ends with the boxed `lua_compiler.compile_syntax(chunk, chunk_name, environment, external_scope)` signature; its `Argument | Meaning` table begins at the top of page **10**. Neither the signature nor the table is internally clipped or split, but their association now crosses the page turn.
- **New detached code lead, corrected page 12 → following page:** the `Loops and returns` heading and “The numeric-loop signature is shown separately to keep its argument positions visible:” sit at the bottom of page **12**, without the numeric-loop signature code block. Confirmation of the following page's code block belongs to the tail reviewer.
- No observed clipping, overlapping cells, split table rows, damaged code indentation, empty headings, or lost diagnostic text on corrected pages 5–12. The recursive-local code on page 7 remains intact; source diagnostics on page 9 remain readable inside margins. Page numbering is consecutive.

This corrected tranche remains a bounded actual-PDF layout review, not technical approval, and does not approve the as-yet-unreviewed tail pages. No repository/source/style edits were made.

# Final corrected-2 PDF — scoped front PASS

## Final identity and reuse

- Final PDF: `/tmp/bmsx-bios-loader-print-evidence/corrected-2/bios-loader.preview.pdf`.
- Final PDF SHA-256: `0b55f4e5025aa3f50d3e262516b3419cd748cd67ce7732d6d2a26ffe98d6ee42`.
- Final receipt SHA-256: `c818f1b995f0d74e4eb7ed730a4ea7147635e6fb8fbc39467f39cf2325eeb79e`.
- Final source SHA-256 supplied with the artifact: `ad76bd0f8428176999810405524926eeebb86809297c6ed0e2795e84dbdeafac` (not visual evidence).
- Rendering/raster engines remain Chromium `153.0.8010.12` / GPL Ghostscript `10.06.0`, `png16m`, 120 dpi.
- Retained final rasters: `/tmp/bmsx-bios-loader-print-evidence/corrected-2/pages/page-01.png` through `page-24.png`.
- Root's full decoded-RGBA identity map, `/tmp/bmsx-bios-loader-print-evidence/corrected-2/pixel-identity.json`, records pages **1–8, 14–16, 19, and 22–24** as identical to already individually viewed prior pages; only **9–13, 17–18, and 20–21** changed.
- Independently compared entire decoded RGBA buffers for final pages **1–8** against corrected pages 1–8; all match exactly, each 5,567,104 bytes. Evidence: `/tmp/bmsx-bios-loader-print-evidence/corrected-2/front-unchanged-page-identity.json`. Reuse is based on full-page pixel equality, not source/text similarity.

## Final actual coverage and observations

Opened each changed final front page **9, 10, 11, 12, and 13** individually with original-detail `view_image` and original-detail image forwarding. Combined with exact-pixel reuse of previously actually viewed pages **1–8**, this tranche covers final pages **1–13**.

- **Source-compilation group fixed:** final page **10** contains the lead, the complete boxed `lua_compiler.compile_syntax(chunk, chunk_name, environment, external_scope)` signature, and its complete `Argument | Meaning` table together. None is stranded on page 9.
- **Numeric-loop group fixed:** final page **13** contains the `Loops and returns` heading, its signature lead, and the complete indented `numeric_for_statement(...)` code block together. None is stranded on page 12.
- Final pages **9–13** show no further observed detached heading/lead/table/code groups, clipped signatures or diagnostics, overlapping/split table rows, damaged indentation, empty headings, or blank pages. The long constructor signatures wrap inside their table cells, the nested code signature stays inside its box, and page numbers are consecutive.

**Scoped result: PASS for actual-PDF layout on final pages 1–13.** This is not technical approval or approval of the tail reviewer's pages; final changed tail pages 17, 18, 20, and 21 remain independently assigned to that reviewer. No repository/source/style edits were made by this reviewer.
