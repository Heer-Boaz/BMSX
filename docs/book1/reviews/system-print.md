# SYSTEM actual-page acceptance

## Volume-title revalidation — 2026-10-18

Current canonical publication artifact `build/manual/system.pdf`:
13 pages, SHA-256 `e9d40db33fcf0389ade842cce10cbc68931b6cb0613fbac56d228e139467f57e`.
Page 1 was independently viewed; every body page matches the accepted publication proof.
All header bands match the fully reviewed new preview; clean chapter footers,
folios and absence of DRAFT were independently verified. Current-PDF rasters
and retained-pixel accounting passed. Evidence:
`/tmp/bmsx-volume-publication-delta-review.md`. This renews layout evidence only;
source/coverage decisions and whole-volume acceptance are unchanged.

Current `build/manual/system.preview.pdf`: 13 pages, SHA-256
`7f1ae42bc78fe272003857bc985b3e98fd45c8b2f25ff337d6ee278913972985`.
A nonauthor individually inspected every full PDFium1.4× page1–13 at readable
size. The Book I System and Hardware Reference header fits; BMSX, chapter/DRAFT
footer, folios, complete tables, diagrams and program parts remain readable
without clipping, overlap or lost labels. Evidence:
`/tmp/bmsx-volume-small-hardware-print-review.md`. Existing Chromium153.0.8010.12,
Nodev22.23.1/Linuxx64, no receipt layout errors. This renews print-layout evidence,
not technical coverage or whole-series publication approval. Historical
publication/draft evidence follows.

Reviewed through the unchanged shared publisher, stylesheet and bundled fonts:
Chromium 153.0.8010.12, Node v22.23.1, Linux/x64. Both the final preview and the
separate release-layout proof have 13 pages, one original PNG and three short
register-entry groups. Receipts report no horizontal overflow or oversized
unbreakable block. Page count records inspection scope, not completeness.

## Individual-page inspection and corrections

Root individually opened all 13 first-preview PDFium rasters at scale 1.4 and
checked the affected later pages again. A separate visual reviewer individually
opened all 13 second-candidate originals, then every reflowed candidate3 page5–13
and final candidate4 pages 10–11. Unchanged pages were compared as raster bytes;
this is not contact-sheet-only, HTML-only or build-success acceptance.

The review found actual short-lead splits: the Cause-table lead was on the
preceding page; grouping it exposed a later IRQ-listing lead split. Both are
fixed with the existing authored keep-together markup. CONTROL/STATUS and the
fault-register heading/table, retention-table lead and first code-block leads
also use existing short groups. No publisher/CSS helper, validation framework,
shrunk type, page-count spacer or forced whole-section pagination was added.

The final draft proof is `/tmp/bmsx-system-proof/system.pdf`; pages 10–11 were
reopened after the last grouping edit. No outstanding draft visual finding.

## Separate release-layout proof

The existing renderer produced an unapproved temporary release-layout proof at
`/tmp/bmsx-system-release-proof/system.pdf`, not the canonical publication.
The separate reviewer verified its 13-page count with the existing PDFium
interpreter and opened **every release page 1–13 individually** at original
raster detail. Title/running matter, all register/bit tables, table leads, complete
31-line/73-line listings, IRQ lead/listing and final actual-image/caption are
readable and intact. No actual release-layout visual failure remains.
Independent report: `/tmp/bmsx-system-actual-pdf-review.md`.

**Bounded visual PASS.** Source correctness, public-only programming completeness
and whole-book acceptance are separate decisions. Any changed text, image,
style, renderer or final pagination requires the affected actual pages to be
reviewed again. The canonical PDF must match this accepted release-layout proof
page-for-page before the print decision is used for it.

## Canonical publication check

After source and public-reader acceptance, the existing publication gate passed
and generated `build/manual/system.pdf`. PDFium confirms 13 pages; all 13 canonical
page rasters are pixel-identical to the accepted temporary release-layout proof.
No changed page or new publication-layout finding remains. The shared 17 manual
tests pass again after this publication; `git diff --check` remains clean.
