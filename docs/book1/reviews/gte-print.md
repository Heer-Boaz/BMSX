# GTE print review

Approved for the expanded chapter with the two actual output plates. Facts,
arithmetic and figure semantics are recorded separately in [gte-source.md](gte-source.md).
Page count is inspection scope, not evidence of instructional completeness.

Engine: Chromium153.0.8010.12, Nodev22.23.1, Linuxx64. PDF inspection used the
existing PDFium environment. The current output-plate review below supersedes
the original page and figure counts; the earlier evidence remains a baseline.

## Original expanded chapter inspection (before output plates)

At this baseline, the shared stylesheet, fonts and publisher were unchanged.

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

## Actual output plates and final print review — 2026-10-17

The current publication-mode proof has 123 pages, six figures (four SVGs and
two unmodified 256×192 captures), 13 register groups and no reported layout
errors. It was rendered through the ordinary shared publisher to
`/tmp/bmsx-gte-output-proof/gte.pdf`. The previous canonical 120-page artifact
was not substituted for this proof. PNG support changes only binary image
loading/output and image sizing; the typefaces and SVG presentation are unchanged.

Three independent reviewers individually viewed all 121 pages of the initial
plate proof at original raster detail, one page per image call: 1–40, 41–80 and
81–121. Page 42 shows both complete NCCT frames, readable settings and results,
and the GTE/GPU boundary. Page 43 explicitly starts the later finite register
continuation rather than asking the reader to continue the infinite cartridge.

The actual inspections found short table/equation introductions stranded by
reflow. Existing authored `keep-together` groups now retain those introductions
with their objects, not entire command sections. A missing blank after some
closing group tags also exposed literal Markdown and one pipe-delimited table;
correcting the manuscript whitespace restored ordinary parsing. The parsed
151 tables, 743 rows and all code blocks remain identical to the pre-grouping
inventory. No smaller fonts, parser repair, grouping helper or extra gate was
introduced.

The reviewers inspected the affected intermediate pages after each correction.
Compared with the last individually reviewed grouped proof, the final correction
changed 29 rasters. All 29 were individually reinspected in the final 123-page
output, divided between the same three reviewers:

- 73, 77–83, 85, 87;
- 88, 90–91, 93, 96, 98–102;
- 103–104, 109–110, 119–123.

All three final scoped decisions are PASS. The other 94 final rasters are exactly
identical to already individually inspected pages. Thus every final page has
actual visual coverage or exact unchanged-raster carry-forward; the last edit
was not followed by a claim that all 123 filenames were reopened. Reviewer
reports are `/tmp/bmsx-gte-plate-print-001-040.md`,
`/tmp/bmsx-gte-plate-print-041-080.md` and
`/tmp/bmsx-gte-plate-print-081-121.md`. Final inspected rasters are in
`/tmp/bmsx-gte-output-review-final/`.

No clipping, literal Markdown, lost table, unreadable field, detached short
object introduction, overlap or body/footer collision remains in the reviewed
output. The new final appendix page 123 was individually inspected in full.
This is print/layout approval, not a substitute for the independent source,
image and reader reviews, nor closure of the broader illustrations backlog.

The shared publisher's seven unchanged chapters were also republished through
their normal gates. All 203 canonical page rasters match their approved final
proofs exactly. Their individual print reports record this bounded revalidation.

After normal `manual:check` and `manual:publish -- gte`, all 123 canonical
`build/manual/gte.pdf` page rasters were independently rendered at the same
1.4× scale and compared pixel-for-pixel with the final inspected set: all match
exactly. The published artifact therefore has the reviewed content and layout.

## Reproduction

```sh
npm run manual:preview -- gte
npm run manual:check -- gte
npm run manual:publish -- gte
npm run test:manual
```

Mechanical checks report 6 figures, 13 register groups and no overflow, oversized
indivisible blocks or clipped SVG labels. All 17 shared manual tests pass; they
do not substitute for the visual/source/reader evidence. The canonical artifact
is `build/manual/gte.pdf`; the separately generated preview retains its DRAFT
banner/footer. The chapter continues to use the ordinary shared pipeline.
