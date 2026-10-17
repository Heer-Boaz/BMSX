# GTE print review

Approved for the reviewed expanded chapter. Facts, arithmetic and figure
semantics are recorded separately in [gte-source.md](gte-source.md).
Page count is inspection scope, not evidence of instructional completeness.

Engine: Chromium153.0.8010.12, Nodev22.23.1, Linuxx64. PDF inspection used the
existing PDFium environment, with readable individual renders and contact sheets.
The shared stylesheet, fonts and publisher are unchanged.

## Actual PDF inspection

The final draft and publish-mode release proof each contain120 pages. The release
proof was rendered by the existing shared `renderChapter` to
`/tmp/bmsx-gte-depth/release-proof/gte.pdf` before print approval. The old
18-page `build/manual/gte.pdf` was not used as current evidence.

- Preview pages1–44 were individually rendered and viewed at1.5×, including the
  dataflow/coordinate/projection figures, numerical tables and every consecutive
  cartridge listing fragment. Root inspected45–80 in actual PDF contact sheets,
  including full projection, NCLIP, selector, flag and lighting tables.
- Preview pages81–119 were individually inspected at1.5×. After adding the worked
  conversion/sign-count reference, the affected107–120 were inspected again.
- Removing the draft banner changes release body pagination only on1–3 within
  the first73 pages. Exact rendered-body comparisons establish that4–73 match
  the visually inspected draft; root viewed the three changed release pages.
- The final release proof's74–120 received a separate inspection/comparison after
  the NCCT/CC setups and VMAD3 link correction. Changed74–81/99 were individually
  viewed. Unchanged82–98/100–120 match the corrected, already visually inspected
  body renders exactly;82–83/95–96/120 were also viewed again.

No clipping, overlap, lost/misaligned fields, unusable code/type or reader-blocking
break remains. All four figures,76-word register inventory, command tables,
complete-work budgets and257-byte reciprocal appendix are within their borders.
Running labels/page numbers and PDF navigation remain present. Whitespace before
whole register groups is accepted rather than shrinking type or splitting fields.

## Resolved assembly findings

- The complete cartridge listing was too large as one indivisible block. Eight
  consecutive semantic fragments preserve every source line apart from print
  indentation; no publisher special case or smaller-type workaround was added.
- The extreme direct-screen NCLIP table was too wide. Separate input/result tables
  retain every operand, full determinant, raw/signed result and flag. The ordinary
  winding table remains a separate unchanged calculation.
- A repeated-PLUS section was accidentally included in the reciprocal appendix's
  keep-together wrapper. The wrapper now bounds only the appendix.
- A CDP single-word orphan and GPL single-line widow were resolved with shorter
  equivalent prose; rebuilt actual pages confirm both fixes.
- Internal paragraph labels were replaced by explicit command inputs or a named
  link. The resulting page-break changes received the release inspection above.

## Reproduction

```sh
npm run manual:preview -- gte
npm run manual:check -- gte
npm run manual:publish -- gte
npm run test:manual
```

Mechanical checks report4 figures,13 register groups and no overflow, oversized
indivisible blocks or clipped SVG labels. All16 shared manual tests pass; they
do not substitute for the visual/source/reader evidence. The canonical artifact
is `build/manual/gte.pdf`; the separately generated preview retains its DRAFT
banner/footer. The chapter continues to use the ordinary shared pipeline.
