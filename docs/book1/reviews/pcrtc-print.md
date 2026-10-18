# PCRTC print review

## Volume-title revalidation — 2026-10-18

Current canonical publication artifact `build/manual/pcrtc.pdf`:
22 pages, SHA-256 `209830f285e5935a23d41d412d12ddb221eda76e2d4038478fe021dd98f377f6`.
Page 1 was independently viewed; every body page matches the accepted publication proof.
All header bands match the fully reviewed new preview; clean chapter footers,
folios and absence of DRAFT were independently verified. Current-PDF rasters
and retained-pixel accounting passed. Evidence:
`/tmp/bmsx-volume-publication-delta-review.md`. This renews layout evidence only;
source/coverage decisions and whole-volume acceptance are unchanged.

The current publication-mode proof is
`/tmp/bmsx-volume-pcrtc-proof/pcrtc.pdf`, SHA-256
`9923f281af6d6fe5582f8ae017fa02d239104343bda03ce4dba72f786a5df155`.
Root individually inspected all22 full pages at1.4× using PDFium. The new
`BOOK I · SYSTEM AND HARDWARE REFERENCE` running title fits inside the existing
margin, remains legible and does not collide with BMSX or body text. The PDF
document title also identifies this volume. Chapter identification, folios,
diagrams, numerical tables and every LOW/HIGH bit-field table remain contained;
no clipping, lost labels or stranded heading was found. No body or style change
was needed. The receipt reports3 figures,13 register groups and no layout errors;
engine Chromium153.0.8010.12, Nodev22.23.1, Linuxx64.

This renews print acceptance for the changed volume title only. Existing factual,
figure-semantic and chapter-coverage decisions remain separate. It does not
approve the completeness of the whole hardware volume or the developer series.

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

## Partial-upload precision and example link — 2026-10-17

The current publication-mode proof remains 22 pages, with three SVG figures,
13 register groups and no receipt layout errors. Full PDFium raster comparison
at scale 1.4 against the accepted release finds only pages 9 and 12 changed.
Root and a separate reviewer individually inspected both current originals:
the corrected partial-upload lead, tables and formula are readable on 9; the
complete-example link, geometry table and HSINT procedure fit cleanly on 12.
No clipped text, stranded heading or running-header/footer collision remains.
Evidence: `/tmp/bmsx-pcrtc-prefix-current-print-review.md` and
`/tmp/bmsx-pcrtc-prefix-current-proof/pcrtc.pdf`. Other pages retain their
pixel-identical accepted evidence. The canonical publication must match this
proof after the normal source/print gates pass.

## Three actual output plates and complete program — 2026-10-18

**PASS for the final29-page publication-layout proof.** Ordinary existing shared
renderer: `/tmp/bmsx-pcrtc-window-proof/pcrtc.pdf`, SHA256
`70b605c4d233b42e89929363c5184774d992d6d0365425d0233e021680f21301`.
The receipt reports6 figures,13 register groups and no layout errors. Page
count describes inspection scope, not whole-book completeness.

Final full decoded RGBA bytes/dimensions of pages1–21 exactly match the accepted
22-page canonical baseline (SHA256
`db87a3777791072e11a3541c1e126e8a96b7da008bd6d3c652c4a05d22f408d2`).
The eight changed/new pages22–29 were individually viewed as actual PDF rasters
at scale1.4/original detail, one image per tool call: root22–25 and independent
tail reviewer26–29. Root re-viewed final24–25 after the concatenation lead and
raw-probe interpretation changed; all other27 final pages are full-pixel-equal
to their accepted counterparts. Identity chains are in
`/tmp/bmsx-pcrtc-window-print-4/{identity,print2-identity,print3-identity}.json`.
No alpha-only bounding-box comparison or source-unchanged assumption is used.

Observed initial raw-table lead, const-module heading/lead and concatenation
instructions were separated from their objects. Existing authored keep groups
close those splits; image/caption pairs are also kept intact. No font shrinking,
CSS/renderer repair or new layout gate was added. The final raw tables, retained
probe table, complete typed code, three full native pictures/captions and all
running matter are readable and within margins. Code remains deliberately
whole rather than overflowing/splitting a hardware programming sequence.

An initial independent claim of missing headers on27/28 was withdrawn after
exact RGB-band comparison: all22–29 top bands contain identical header pixels,
including the pages where the reviewer saw the header clearly. It was an image-
viewer presentation artifact, not a publisher defect or accepted inconsistency.
No source or publisher edit was made for that false finding. The corrected
finite tail report follows; its inspected26–29 pages remain exactly equal in
the final proof.

# PCRTC tail: finite actual-PDF print inspection

## Artifact and scope

- PDF: `/tmp/bmsx-pcrtc-window-proof/pcrtc.pdf`
- Verified SHA-256: `37c59e6f437e828426665c1d96f5043dce351a0271e2c8ea24ed3275e10b60d8`
- Exact inspected raster files:
  - `/tmp/bmsx-pcrtc-window-print-2/page-026.png`
  - `/tmp/bmsx-pcrtc-window-print-2/page-027.png`
  - `/tmp/bmsx-pcrtc-window-print-2/page-028.png`
  - `/tmp/bmsx-pcrtc-window-print-2/page-029.png`
- Each page was individually opened with `view_image(detail="original")` and forwarded at original detail, one image per tool call. No contact sheet, HTML, or text-only substitute was used.
- Scope is visual print layout on pages 26–29 only. No source, guest-runtime, semantic, or earlier-page acceptance is claimed. No repository, CSS, or publisher changes were made.

## Findings by page

### Page 26

- “Draw once and finish the source image” heading and its complete boxed code listing are readable and remain together on the page.
- No clipping, overlap, broken code lines, or bottom-of-page continuation was observed.
- Running top header and PCRTC/page-number footer are visible and separated from the content.

### Page 27

- The A/B publishing code block and C window-moving code block are each complete and readable, with their headings retained on the same page.
- “Observe each stage after VBlank” and its explanatory paragraph fit above the footer; no clipping or overlap was observed.
- The PCRTC/page-number footer is present. The running top header is present in the actual raster, confirmed by the pixel-identity check below; the initial viewer-based missing-header impression was false and is withdrawn.

### Page 28

- The introductory paragraph is readable. Both actual rendered plates, Figure A and Figure B, are fully visible and unclipped.
- Each figure retains its entire caption immediately beneath it on the same page; no figure-caption split or overlap was observed.
- Running top header and PCRTC/page-number footer are present; the top header is confirmed by the pixel-identity check below.

### Page 29

- The actual rendered Figure C plate is fully visible and unclipped; its complete caption stays on the same page directly below it.
- The following explanation is readable, complete, and separate from the caption and footer.
- Running top header and PCRTC/page-number footer are visible. No overlap or clipping was observed.

## Header finding correction and independent pixel check

The initial image-viewer impression that pages 27 and 28 lacked running headers is false and withdrawn. An independent PIL check of each actual PNG converted to RGB and cropped to the full-width top band y=[0,60) establishes:

- Pages 22–29 all have byte-identical 833 x 60 RGB header bands.
- Each band's SHA-256 is `19a96c6b47e5ef91697c37ae1e683b1abd13fd9c1024eb318211f90e2e7e0cd0`.
- Each band contains 1121 pixels different from RGB (255,255,255).
- The bands on pages 27 and 28 are exactly identical to those on pages 26 and 29, where the header was visibly legible in the viewer. This confirms that the reported missing headers were a viewer-presentation artifact, not an author or publisher defect.

No publisher or source change was requested or made for this false finding.

## Finite result

PASS for the inspected print-layout scope, pages 26–29 of the exact PDF above: all three actual plates (A and B on page 28; C on page 29), captions, and code listings are visually intact. No tables occur on these four pages. No actual clipping, overlap, code/figure-caption break, or header/footer defect remains in this scope. This is not a whole-document, source, or semantic acceptance claim.


The print pass is separate from live-owner, actual guest, full RGB and independent
image/reader acceptance in pcrtc-window-source.md. It accepts the bounded lesson's
actual layout, not physical/native/backend parity or completion of Book I.

Ordinary `manual:check -- pcrtc` and `manual:publish -- pcrtc` pass, and all19
shared manual-tool tests pass after the completed reviews and expected6-image
reference fixture are recorded. Every canonical29-page PDF raster equals the
accepted final proof in full decoded RGBA bytes and dimensions. Canonical SHA256:
`1b167e80d198508aef0f5f4acdfb29672fe239538cb3ab2c64465bec2b2a6eca`.
Final chapter-source SHA256:
`65ceb707a557697a8cdb1d288a2b291a47ce87f605060e4db5dff81ff3f32412`.
Verification: `/tmp/bmsx-pcrtc-window-published-identity.json`; the old draft
preview is not this accepted canonical PDF. `git diff --check` is clean.

## Unequal horizontal sampling and complete example — 2026-10-18

**PASS for the finite 32-page publication-layout proof**, produced by the
unchanged shared renderer: `/tmp/bmsx-pcrtc-sampling-proof/pcrtc.pdf`, SHA256
`3c0e49a7764abd116c04d8424cc5b904634e9448265d0b7bb1d899e84c7ae541`.
Receipt: 7 figures, 13 register groups, no layout errors; Chromium153.0.8010.12,
Nodev22.23.1, Linuxx64. Page count records inspection scope, not completeness.

All pages1–28 have exact full decoded RGBA bytes and dimensions equal to the
accepted29-page canonical baseline, SHA256
`1b167e80d198508aef0f5f4acdfb29672fe239538cb3ab2c64465bec2b2a6eca`.
Root individually viewed final29–30 at scale1.4/original detail. A separate
reviewer individually viewed31–32; final32 was re-viewed after the manifest
pathname was added. Final31–32 are exact full-RGBA/dimensions matches to that
accepted proof, SHA256
`308ad463b383b986281d03409ae55efb2c409c7365b108ac61b34af7b87da0b3`.
Identity records: `/tmp/bmsx-pcrtc-sampling-print/{identity,clarity-identity}.json`.
No acceptance is based on page count, extracted text or a clean receipt alone.

The two native tables keep every field and row; the actual8×1 output strip is
readable with sharp pixel boundaries and its full caption. All91 literal BLua
lines, headings/leads and the complete manifest fit without clipping or overlap.
Running matter and folios remain present. Initial inspection caught literal
unsupported heading-anchor syntax, fixed to the already-used HTML anchor;
the affected page was re-viewed. No shared CSS, publisher, font change, type
shrinking, new layout helper or gate was needed. The existing reference fixture
now expects the actual7 figures rather than6; no count validation was added.

Source, output semantics, ordinary guest and public reconstruction evidence are
separate in [pcrtc-sampling-source.md](pcrtc-sampling-source.md). Whole-volume,
native/accelerated-backend and physical-hardware acceptance are not claimed.

### Independent finite tail inspection

# PCRTC sampling tail — print-only review

PDF: `/tmp/bmsx-pcrtc-sampling-proof/pcrtc.pdf`
SHA-256: `308ad463b383b986281d03409ae55efb2c409c7365b108ac61b34af7b87da0b3`

Reviewed only PDF pages 31 and 32 via the individually rasterized `page-031.png` and `page-032.png`, each viewed separately with ORIGINAL detail. Final page 32 was individually re-viewed at ORIGINAL detail after the manifest-path lead changed. Page 31 review carries by identity: its final PNG SHA-256 remains `066224f8cd9ff7a546af45a7532fb99b02a8af0f4381c692e40c2552fc940f32`, identical to the individually reviewed prior raster (root also confirmed exact RGBA and dimensions). Final page 32 PNG SHA-256 is `7ee3ac699b1d67cb358a507569f02ced9dd4954e6dbec45f30c72003fca32000`. No source, semantic, runtime, other-page, or full-book acceptance is claimed.

## Observations

- Page 31: both headings and leads, the complete `results.lua` block, and the first `cart.lua` block are legible. No clipped code lines, overlapping text, broken box boundaries, or stranded heading/lead were observed. The first entry-module block ends inside its code box before the page footer.
- Page 32: the upload/recovery block, final publication/wait block, manifest-path lead (`Create res/manifest/manifest.rommanifest with the following contents:`), and complete three-line manifest are legible and contained within their respective boundaries. No clipped code lines, overlap, or overflow was observed. The manifest is wholly above the footer; no content reaches beyond its box or page boundary.
- Running matter: the top running band and bottom-left `PCRTC` band are present on both pages. Actual RGBA bands were compared to resolve a display artifact: the complete top band (x=0..832,y=20..59) is byte-identical between pages, SHA-256 `0db235556e1a06378a57a4fe09717f7fac86ce3fb423fb22dd937fd99e6c34b4`; bottom-left band (x=60..179,y=1120..1159) is also byte-identical, SHA-256 `8f066e9c8fbed7bc5794a307aac2a0bc6a7d851fa9539ab6345f289f627a733d`. Page numbers 31 and 32 are present.

Observed print issues: **none** within these two pages.

### Canonical publication verification

Ordinary `manual:check -- pcrtc` and `manual:publish -- pcrtc` pass, along with
all19 existing manual-tool tests. Every canonical PDF page matches the accepted
final proof in full decoded RGBA bytes and dimensions. Canonical SHA256:
`aaf13ae0863070a534b1cb6e28ac23b8c1fd0ce4fa4c14c08b11d17211d4f5b0`.
Final public-source SHA256:
`aeda58e18fdcf737ef9e47f509eaf13248deab8f8f0f4a3441b369a8e047028f`.
Identity record: `/tmp/bmsx-pcrtc-sampling-published-identity.json`. This renews
`build/manual/pcrtc.pdf`, not the older draft preview. `git diff --check` passes.

## Composition coefficients and source/output alpha — 2026-10-18

**PASS for the bounded current publication-layout proof**:
`/tmp/bmsx-pcrtc-mix-proof/pcrtc.pdf`, SHA256
`bbe768a0cc71b8473b5ce83f835e1ac37fba7a0bd859c305ffa4dc4b8bcaeecc`.
The unchanged shared renderer reports10 figures,13 register groups, no layout
errors; Chromium153.0.8010.12, Nodev22.23.1, Linuxx64. The37-page count describes
inspection scope, not chapter/console completeness.

All final pages1–32 match the accepted prior32-page canonical baseline in exact
full decoded RGBA bytes **and dimensions**, not a bounding box or contact sheet.
Baseline SHA256 `d4c16317c24acc9b150a49c93f04671a8578786817575ddc469bf7ca9e0b051e`.
Identity record `/tmp/bmsx-pcrtc-mix-print/identity.json`, scale1.4.

Root individually viewed all new final page states at ORIGINAL detail:
33 (both tables/formula/teaching),34 (three output plates/captions),35 (complete
results/manifest and declarations),36 (mode words/handler and shared setup),
37 (source drawing/readback and final publication loop). No clipped lines,
overlap, split table/box, detached caption/lead or missing folio remains.
The constant plate/caption stay together; the B/C table preserves image aspect
and sharp boundaries. Every literal BLua line and full manifest fits.

The initial proof left only the three-line manifest on page38. Moving its
unchanged lead/fence into the setup on35 removes that near-blank last page;
no font shrinking, CSS/publisher change or layout helper was needed. Root
individually re-viewed final35. All other final pages match the preceding proof
in exact full RGBA/dimensions, including36–37; record
`/tmp/bmsx-pcrtc-mix-manifest-delta/identity.json`. Earlier page33 was also
re-viewed after removing one redundant paragraph.

Root directly resolves a repeated-image display artifact reported in the
independent tail inspection: final36/37 **do** contain the identical BMSX/book
running header and PCRTC footer. Full top band(x0..833,y20..60) SHA256
`0db235556e1a06378a57a4fe09717f7fac86ce3fb423fb22dd937fd99e6c34b4`,
full bottom-left band(x60..180,y1120..1160) SHA256
`8f066e9c8fbed7bc5794a307aac2a0bc6a7d851fa9539ab6345f289f627a733d`
on both final pages. Root separately viewed both original full-page rasters.
This is actual raster evidence, not a renderer/CSS inference.

Source/actual-output/ordinary guest and fresh public-only reader acceptance are
separate in [pcrtc-mix-source.md](pcrtc-mix-source.md). The existing reference
fixture simply now expects the actual10 figures instead of7; no count gate,
framework, schema or new validation layer was added.

### Canonical publication verification

All19 existing manual-tool tests, ordinary `manual:check -- pcrtc` and
`manual:publish -- pcrtc` pass after completed source/image/reader and actual
print acceptance. Every one of the37 canonical PDF pages equals the accepted
final proof in **full decoded RGBA bytes and dimensions**. Canonical SHA256:
`c2fa0caea5de7a899a9c3904e5e8e496f4ab6973f6f955731e784dc481cd512f`.
Final public-source SHA256:
`2a1dd127384e62231f03a54b644f17ab993f1c8b9897f9cf4aea681ba783acd8`.
Record `/tmp/bmsx-pcrtc-mix-published-identity.json`; logs
`/tmp/bmsx-pcrtc-mix-manual-{tests,check,publish}.log`. The canonical
`build/manual/pcrtc.pdf` is current; the old preview is not this publication.
Unchanged accepted GTE canonical SHA256 remains
`cd99150c94a8ff86e08f604d780784cfc6d7575458c1172e719e52401e45ca0e`.
`git diff --check` passes. Whole-book/SDK acceptance remains open.

### Independent finite tail check

A separate print-only reviewer individually viewed original36/37 (and removed38),
then read the final full-RGBA identity record carrying36/37. Both final pages
pass text/code/box/heading/folio inspection without clipping or overlap. The
reviewer withdrew its initial display-only running-matter impression and
explicitly leaves that resolved byte/visual proof to root above. No source,
semantics or other-page approval is inferred. Bounded report:
`/tmp/bmsx-pcrtc-mix-print-review.md`.
