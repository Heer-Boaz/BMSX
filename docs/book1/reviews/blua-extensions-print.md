# BLua extensions — actual final-PDF layout acceptance

**PASS for the bounded final 44-page DRAFT.** Not publication or whole-manual approval.

- Final PDF: `build/manual/blua-programs.preview.pdf`.
- SHA-256: `a6f0b07f4800578f3332646fe5acd3c62246f2853d9c4267d32e1e9e07b4030f`.
- Final source: `412a344a966d7a9a0687c1d4a8b7dcb03a8f0421d3c03295438a4783f178a8fb`.
- Chromium153.0.8010.12, Node22.23.1, Linuxx64; existing publisher/CSS/fonts unchanged.
- PDFium full-page rasters at scale1.5,893x1263, original-detail individual viewing.
  Final rasters `/tmp/bmsx-blua-extensions-print-7/`; intermediate reviewed
  sets `print-3`, `print-5`, `print-6` under the same prefix.

## Every-page evidence

1. Root individually viewed every full page1-19 at initial/corrected stages.
   Final pages1-9 are full decoded RGBA-identical to individually viewed print-3;
   pages10-19 were individually re-viewed in print-5/print-6 as changed.
2. Independent [middle audit](blua-extensions-print-middle.md) individually viewed
   all print-5 pages20-31. It found the colon-declaration lead/listing split22/23;
   root closed it with existing markup and individually re-viewed changed20,22-25
   in print-6. Pages21,26-31 retain exact full-raster identity.
3. Independent [tail audit](blua-extensions-print-tail.md) individually viewed
   all print-5 pages32-44 with no defect. These retain full decoded RGBA identity
   through final. Tiny-header absence suspicion was resolved by original-detail
   re-view and actual RGB header-band identity, not labelled a publisher defect.
4. The final print-6 to print-7 delta changes only13,14, individually viewed by
   root after the final trace-fragment keep group. All other42 full pages have
   equal dimensions and exactly equal decoded RGBA bytes, including margins and
   folios. The saved identity proof is print-7/identity.json. The previous
   print-5 to print-6 proof lists all11 changed pages and33 identical pages;
   all11 changed pages were individually viewed. No contact sheet, text dump,
   clean build or alpha-only difference bbox substitutes for a page check.

Union: every final page1-44 has direct original-detail viewing or an exact
full-page decoded-pixel identity chain to an individually viewed page.

## Observed splits closed

Fourteen existing keep groups close actual observed detached leads/tables/code:
primitive type table, initializer example, sample code/layout table, augmented
operator table, init declaration, mapped-memory value paragraph, mapped-access
heading/table, both complete-program file leads/listings, completed-word result,
old-reference keyword lead/list, escape lead/table, colon-method lead/example,
and the trace sink fragment lead/example after the final reader bridge reflow.

No new CSS, schema, publisher helper, gate or framework was added. Technical
claims and all complete-program source listings are unchanged by these groups.
Tables/code fit their rules; headers identify BookII and footers remain DRAFT.
No remaining clipping, overlap or detached example/table lead was found in the
finite final review. Ordinary paragraph continuation and whitespace needed to
keep a complete listing together are not extra technical content.

LS01 remains a source publication stop. BE01 trace-selection tooling work and
whole-book/SDK/console acceptance remain separate; this is a DRAFT layout pass.
