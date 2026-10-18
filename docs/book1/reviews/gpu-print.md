# GPU print review

## Dither and coverage lessons: print review pending — 2026-10-19

The new polygon OFF/ON, rectangle-control and shared-edge/joint output lessons
have DRAFT previews only. Their source, executable cartridges and actual output
checks are recorded separately in gpu-source.md. The existing canonical PDF
does not contain these additions.
The earlier accepted page sets below do not approve the new chapter layout;
the current print flag remains false. PDF navigation/viewer work is deferred
while manual content takes priority.

## Volume-title revalidation — 2026-10-18

Current canonical publication artifact `build/manual/gpu.pdf`:
74 pages, SHA-256 `0aaaf2be73f705a63cf537943d87344360c1ad9eefaad1801e6eeae877a6673b`.
Pages 1 and 61–64 were independently viewed; all other body pages match the accepted publication proof.
All header bands match the fully reviewed new preview; clean chapter footers,
folios and absence of DRAFT were independently verified. Current-PDF rasters
and retained-pixel accounting passed. Evidence:
`/tmp/bmsx-volume-publication-delta-review.md`. This renews layout evidence only;
source/coverage decisions and whole-volume acceptance are unchanged.

Current `build/manual/gpu.preview.pdf`: 74 pages, SHA-256
`87649fde32a574fae51cebdb52c9e88e35ea738325c2b25e224fb19553e2f64d`.
A nonauthor individually viewed every full PDFium1.4× page1–74 at original
readable size. The Book I System and Hardware Reference title fits on every
page, with intact BMSX/chapter/DRAFT identification and folios. No remaining
clipped table/code/figure, collision or stranded lead-in was found.
The inspection found a stranded Issue lead-in on61. Only existing authored
keep-together tags were added around that lead and its three-row table; every
word/value is unchanged. All final61–64 were individually re-viewed, and the
other70 full-page rasters match the individually inspected candidate exactly.
Evidence: `/tmp/bmsx-volume-gpu-print-review.md`. Chromium153.0.8010.12,
Nodev22.23.1/Linuxx64, no receipt layout errors. This renews bounded print-layout
evidence, not technical coverage or whole-series publication approval.
Historical publication/artifact evidence follows.

**Original chapter acceptance.** The complete chapter uses the ordinary shared renderer, stylesheet and
bundled fonts. No GPU-specific publisher, font, layout rule, assembler or
freshness/validation layer was added.

## Original actual-page inspection (before the output plate)

The existing renderer produced private publication-layout proofs before the
canonical publication gate was approved. PDFium rasterized every actual page at
readable original size; HTML, text extraction, contact sheets and build receipts
were not substitutes for viewing the pages. The final proof has 72 pages; that
count is an inspection inventory, not instructional-completeness evidence.

The full page inventory is covered by these individual-page reviews:

- 1–12: specifications, real BLua listings/results and ports/status/controls.
- 13–24: controls/queries/ingress, storage, placement, coverage and finite planes.
- 25–48: lookup/window/gain/dither/blend tables, packet fields and polygon/line
  references, with all numerical fields/equations and continuations inspected.
- 49–72: polyline/rectangle/transfer/environment references and complete scalar
  instruction/timeline/budget tables, every page individually inspected.

After author-side page-break fixes, the changed final-layout pages were reopened:
10–19 and 25–29 in proof2, then 12–15 and 28–30 in proof3. Unchanged page bodies
were compared directly as pixels against their already inspected actual-page
renders. The final publication is checked against that exact reviewed layout.
All tables/code/fields remain inside their cells and page area, with readable
columns, complete glyphs and no confirmed overlap, crop or damaging page break.
Running headers/footers and sequential page numbers remain separated from body.

## Findings resolved without publisher changes

1. The reset heading/table lead-ins were stranded before their primary tables.
   Existing author-side keep-together groups now retain those headings and tables.
2. A following GP1 acknowledgement heading/encoding was separated from its meaning.
   Short GP1 entry prefixes now group heading, encoding and initial meaning/field
   table with the same existing class. Independent final-page review confirms the
   acknowledgement and following control entries no longer inherit the split.
3. The modulation introduction ended a page before its boxed equations. Grouping
   that introduction with the equations resolves it; following tables/headings
   were rechecked and remain intact.

An apparent missing repeated header/footer in a multi-image presentation was
withdrawn after individual-page and actual-PNG band checks. It was not a PDF
or publisher defect. No stylesheet, font or rendering-tool change was justified.
An earlier Markdown break which turned “reading circuit 1” into an ordered list
was also corrected in the authored sentence.

## Figure and representations

The unchanged shared-edge SVG retains the independently source/raster-checked
12 samples, first/second ownership 9+3, vertex labels and one on-diagonal owner.
It was individually viewed in the final-style PDF: colors, open boundaries,
legend, arrow and circled sample are readable and semantically consistent.
Register fields and numerical layouts are real tables, not space-aligned text.
The eight BLua fragments concatenate to the actual cartridge apart from whitespace.

Source/whole-reader acceptance and actual guest execution remain separate records.
This print pass does not establish physical/native/backend parity or completion
of Book I; it accepts the actual layout of the sourced, complete GPU chapter.

## Shared PNG publisher revalidation — 2026-10-17

Print was reopened for the central PNG extension. Fresh publication-mode proofs
before and after the final publisher change have all 72 page rasters
pixel-identical at scale 1.4; this SVG-only chapter has no changed printed
content. Chromium 153.0.8010.12, the bundled fonts and existing SVG styling
are unchanged. The actual-page acceptance above therefore remains applicable;
this comparison is not a new factual review or an output-image claim.

## Actual output plate and current print review — 2026-10-17

**PASS for the final 74-page output.**

The current publication-layout proof has 74 pages, two figures (one SVG and one
unmodified 256×192 PNG) and no reported layout errors. Page count records
inspection scope, not whole-book completeness. Source/image acceptance remains
separate in [gpu-source.md](gpu-source.md).

The full native frame appears on page 8, with readable introduction, caption,
texture/blend/mask explanations and intact margins. Page 9 contains all nine
legend regions in two tables, with packet coordinates and selected VRAM words
kept distinct from displayed colour components. The image was neither cropped
nor relabelled; the tiny witness/source-image marks remain visible.

Actual full-page rasters were inspected individually at original detail, one
image per tool call. Root inspected 8–10, 12, 15, 20–21, 23, 25–26, 36–40 and
45–48. An independent reviewer inspected 8–9, 51, 54, 56, 58, 60, 63, 65–66,
68–71 and 73–74. These cover all 33 final changed/unmatched page bodies. The other
41 page bodies, including their running headers, match the approved baseline
exactly at their mapped positions. All same-numbered footer bands on 1–72 also
match exactly; the new final-numbered footers were actually viewed. The prior
complete-page acceptance therefore carries forward only where pixels match,
not by assuming that unchanged source prevents reflow.

The actual inspections found four short leads separated from their objects:
the polyline framing packet, flat-polygon word order, texture-cost thresholds
and the final complete-function timeline. Existing authored keep-together groups
now retain each lead with its table, including the timeline heading. These
groups change no technical text, table or code. The final two fixes changed
only 70–71/73–74 and briefly added page 75; all five were individually inspected.
Moving the unchanged fence/readback scope caution into available space before
the timeline then removed that nearly empty last page. Only page 73 changed;
it received a final individual reinspection, with the approved page 74 unchanged.
No smaller font, special renderer, layout helper or gate was added.

An initial missing-header impression was withdrawn after exact top-band checks:
all reviewed header bands contain the same BMSX/Book I pixels. It was not a PDF
defect or an odd-page convention, and no stylesheet change was justified.

No clipping, overlap, malformed columns/rows, literal Markdown, unreadable code
or words, detached short object lead or body/furniture collision remains in the
reviewed scope. Ordinary longer narrative continuations remain breakable.
Detailed actual-output evidence is in
`/tmp/bmsx-gpu-output-root-print-review.md` and
`/tmp/bmsx-gpu-output-plate-print-review.md`. Final inspected rasters are in
`/tmp/bmsx-gpu-output-release-pages/`; the ordinary shared renderer produced
`/tmp/bmsx-gpu-output-proof/gpu.pdf` in publication mode before approval.

This accepts this sourced plate addition and its actual layout, not all visual
teaching, physical/native/backend parity or completion of Book I. Chromium
153.0.8010.12, Node v22.23.1, Linux x64, bundled fonts and shared stylesheet
remain unchanged for this slice. All 17 manual tests pass.

After the final approvals, ordinary `manual:check -- gpu` and
`manual:publish -- gpu` succeed. Every one of the 74 canonical
`build/manual/gpu.pdf` page rasters matches the final inspected release set
pixel-for-pixel at scale 1.4, including running matter. The published artifact
is therefore the reviewed output, not the older 72-page baseline. All 17
manual tests pass again after publication; the PNG still matches the fresh
capture byte-for-byte and `git diff --check` is clean.

## Raw-image DMA program: final actual print — 2026-10-18

**PASS for the final 80-page publication-layout proof.** The ordinary existing
renderer produced `/tmp/bmsx-gpu-dma-proof/gpu.pdf`; SHA256
`aa87bb17b052217db4a3760d0c0389d764811b8f725028ef9612e54a87a72ffd`.
It retains the two accepted figures and reports no layout errors. Page count
records inspection scope, not technical or whole-book completeness.

Full decoded RGBA bytes and dimensions of pages1–74 match the accepted canonical
74-page baseline exactly, including running matter. Baseline PDF SHA256 is
`0aaaf2be73f705a63cf537943d87344360c1ad9eefaad1801e6eeae877a6673b`.
No alpha-only difference bounding box or unchanged-source assumption was used.
The final six new pages75–80 were individually viewed as actual page rasters at
scale1.4/original detail, one page per tool call. The final hardware-voice
qualification changed only page80; that page was individually re-viewed, with
all other79 decoded pages exactly equal to their accepted counterparts.
Identity records: `/tmp/bmsx-gpu-dma-print-3/{identity,print2-identity}.json`.

Initial actual inspection found the storage heading/lead separated from its
code, the concatenation instruction separated from the entry code, and the
47/44-cycle table separated from its limiting qualification. Three ordinary
authored keep-together groups close those observed splits. No font reduction,
CSS/publisher/helper change or new layout gate was needed. The complete code
blocks intentionally remain intact; shorter pages do not justify code overflow.
All raw words, table columns, code, headings and furniture are readable without
clipping, overlaps, literal Markdown or body/footer collision in the accepted
new pages. The original74 pages remain pixel-identical.

Source/guest/reader acceptance remains separate in gpu-dma-source.md. This print
pass does not establish displayed output, native parity or completion of Book I.

Ordinary `manual:check -- gpu` and `manual:publish -- gpu` then pass. Every one
of the canonical80 page rasters is exactly equal in full decoded RGBA bytes and
dimensions to the accepted proof. Published SHA256:
`cc788b2dd20ead9e16d55257b7d4ad0fcf4ff033f8123cec8aa3016a5a4d23fd`.
Proof: `/tmp/bmsx-gpu-dma-published-identity.json`. Final source SHA256:
`7df226ce58166ba1bf799dc0e883b9531a854040f22597b0121a86c1f84ddfad`.
All19 existing manual-tool tests pass again after publication. `git diff --check`
is clean. This is the accepted canonical output, not the older preview PDF.


## Compact startup and firmware-reservation supplement — 2026-10-18

Final publish-mode proof: `/tmp/bmsx-gpu-startup-proof/gpu.pdf`,80pages,
SHA256 `e982d48f8368c072921bb70f4a4386747d77e32b202fb8bdbedd86277a54da49`.
Source SHA256: `e4ffa3bcd6f29b46814093169cf72699324ae96b1b0d4b40d8f38f9039d56117`.
This accepts the bounded paragraph layout, not all hardware/SDK completeness.

All78 pages1–12 and15–80 equal the previously individually accepted canonical
baselinecc788b2d… in **complete decoded RGBA bytes and dimensions**, including
running matter. Root individually viewed original final13/14: reset table and
new paragraph, printed Memory title/section, GP1 opcode/reset/stream-clear
references, tables, prose, borders and full running matter fit and remain
readable. Identity record: `/tmp/bmsx-gpu-startup-print/identity.json`.
Independent final-page decision is recorded in `/tmp/bmsx-gpu-startup-print-review.md`.

Tentative longer prose and table keep-groups were discarded, not published.
The facts-only author's compact single paragraph retains all required facts
without repeating BIOS context; all later pages retain their accepted layout.
No final font, CSS, publisher, framework, gate, figure or keep-group change.
Source and public-reader checks are separate in gpu-source.md; actual fresh
cartridge capture remains byte-identical to the existing public output plate.

Independent final print acceptance explicitly approves original13/14 and carries
all78 others by exact baseline identity; all discarded-proof findings are
superseded. The19 existing manual tests, ordinary GPU check and publication pass.
All80 canonical pages equal the accepted proof in full RGBA and dimensions,
record `/tmp/bmsx-gpu-startup-published-identity.json`. Canonical SHA256:
`d45d7702e32fcf87af526026ec56bc6775ccaeafdfa85e17527f7a80b637cd17`.
The publishing fixture also rewrites PCRTC; all37 complete rasters equal its
accepted baseline, record `/tmp/bmsx-gpu-startup-pcrtc-identity.json`.
Current PCRTC SHA256:
`58c78f6a1d5324ba403478fa6f483a6cabd80b72590bd6c336eceab6c85815b9`.
APU/GTE/cartridge canonical outputs remain unchanged. Whole-book, SDK and
portable PDF navigation remain open. `git diff --check` passes.
