# SYSTEM actual-page acceptance

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
