# Current extension-first PDF acceptance

**PASS for the current44page DRAFT**, PDF `a6f0b07f…` and source `412a344a…`.
The [complete current print record](blua-extensions-print.md) supersedes the
28-page artifact below. Every final page is individually viewed or fully
pixel-identical to retained individually viewed evidence. Fourteen observed
lead/table/listing splits were closed using existing markup only.
LS01 stays open; a DRAFT layout pass is not publication or whole-manual approval.

## Earlier scoped evidence

# Current BLua source-program PDF layout acceptance

**PASS for the current 28-page DRAFT**, PDF `d99b0523…` and source `e4cc1350…`.
The appended known-call delta review supersedes the earlier 27-page artifact
below. The independent full-page and changed-page evidence identifies the
exact artifact. LS01 and whole-book
coverage remain open; layout approval is not publication acceptance.

# Independent actual-PDF print-layout review

## Artifact and scope

- Artifact: `/home/boaz/BMSX/build/manual/blua-programs.preview.pdf`
- Final PDF SHA256: `f3dee3942895008b7e793916ffebd87badf79a4e1acb071775a6d1579a908f9b`
- Page count: 27.
- Final supplied source SHA256: `6823cbd1ecc504b03f2d5c17908617c9688a634b8410bbae65b263effd2e741e` (provided by parent; source was not opened for this review).
- Read `AGENTS.md`. Inspected only this PDF and its actual page rasters; no owner files, semantic evidence, architecture documents, reference PDFs, or other reviews were consulted.
- Rendered every page with `/tmp/bmsx-manual-inspection-venv/bin/python`, `pypdfium2.PdfDocument`, and `page.render(scale=1.5).to_pil()`. All 27 full pages are retained individually at 893 x 1263 in `/tmp/bmsx-language-control-print-review-80de01a3/page-01.png` through `page-27.png`.
- Actually viewed each of those 27 full-page images individually with `tools.view_image`; multiple independent full-page image calls were batched only for transport. No contact sheet or text extraction substituted for visual page inspection.

## Finite verdict

**PASS for the finite actual-PDF print-layout scope below. No outstanding print-layout repairs.**

The initial artifact (`80de01a3dee5c1531fbef59a5842d091f98844bb1062c56e5157643aa98d0a7b`) had one lead/listing pagination issue: page 21 ended with **“Entry module: entry.lua”** and two explanatory paragraphs while its entire listing began alone on page 22. The parent applied only the existing keep-together markup around this heading, both paragraphs and its listing; no new renderer/CSS/helper was introduced by the reviewer.

For the final PDF, independently rendered all 27 full pages at scale 1.5 into `/tmp/bmsx-language-control-print-review-f3dee394/`. Compared every full RGB raster against its preserved original with `PIL.ImageChops.difference(...).getbbox()`. Exactly pages **1, 21 and 22 changed**; the other **24 pages are pixel-identical** to the individually viewed original pages. Changed bounds (893 x 1263 coordinates) were p1 `(76,369,817,1179)`, p21 `(76,872,817,1021)`, and p22 `(76,81,817,1040)`.

**Actually viewed all three changed full pages individually with `tools.view_image`.** Page 1's revised opening remains readable with no rule/table/code/footer collision. Page 21 now finishes after the complete nil-export listing; its ordinary bottom whitespace is not a defect. Page 22 now contains the Entry module heading, both lead paragraphs and the full unbroken entry listing together, with safe footer clearance. The original pagination issue is closed and no new print-layout defect was found. The unchanged 24 full rasters retain the complete initial visual coverage.

No clipping, overlap, unreadable table/rule/code, paragraph widow, stranded short lead, or footer collision was found in the final artifact. Ordinary whitespace was not counted as a defect. Numeric-loop entry parts 1, 2, and 3 are explicitly named consecutive parts and are not arbitrary broken listings.

## Running identification and draft status

The running top identification is correctly **“BOOK II · BLUA32 AND BIOS REFERENCE”**, with BMSX at upper left. The DRAFT / NOT FOR PUBLICATION footer is present throughout, and page 1 also carries the boxed DRAFT notice.

A preliminary apparent missing-header observation in batched image output was retracted after isolated verification: page 2 was independently re-rendered to `/tmp/bmsx-language-control-print-review-80de01a3/page-02-isolated.png` and viewed alone, showing the correct header. Original and isolated page-02 PNG SHA256 are both `9a6a984fa3ce718e62d24ebe30684fff63e07926b8578685b86629aa8d0080df`. The actual top 65 raster rows are pixel-identical on all 27 pages (SHA256 of raw cropped pixels: `4bde9f6e7be0d53a5d9e421e1bcd7cce2568b1cda779dafa46ed6e389f9c3afe`); a page-03 header crop was additionally viewed. There is **no missing-header artifact defect**.

## Per-page actual visual coverage

All rows below refer to full-page rasters actually viewed, not text-derived checks. Pages 1, 21 and 22 were independently re-viewed after regeneration; all other final pages are pixel-identical to the originals viewed in full. Header and DRAFT-footer identification above apply to every page.

| PDF page | Full-page visual result |
| --- | --- |
| 1 | Original full page viewed, then final changed full page independently viewed: revised opening, boxed draft notice, chapter title, rules, identifier table and both keyword/name boxes readable; no collision or clipping. |
| 2 | Comments and statement-boundary code boxes readable; literal-expression and number-spelling headings retained with their material; number table intact. |
| 3 | Short-String example, complete escape table and final short example readable; bottom paragraph clears footer. |
| 4 | Long-String example and declarations/local-binding examples intact; no stranded lead or rule overlap. |
| 5 | Recursion bullets, assignment heading/example and augmented-assignment table readable; full paragraphs retained. |
| 6 | Function/method/anonymous-function listings readable; startup heading has substantive prose; bottom prose clears footer. |
| 7 | Call table and vararg prose readable; both Return-statement leads remain with their respective short listings. |
| 8 | Both return-rule examples remain with their explanatory leads; access table and constructor listing intact. |
| 9 | Operator table readable; control-flow/conditional headings and conditional listing remain together; bottom prose clears footer. |
| 10 | While/repeat/numeric-for listings and selector table intact; paragraphs and footer separated. |
| 11 | Generic-for heading, form, iterator-call box and bullets readable; final complete one-line paragraph not clipped. |
| 12 | Blocks/break and goto examples readable; label/goto lead remains with listing; prose and footer separated. |
| 13 | Interrupt box, module-header table, entry-header box and path table intact; no collision. |
| 14 | Import and initialization sections readable; all four short code boxes stay with their leads; footer clear. |
| 15 | Ordinary-export code and result table intact; exported-object example remains with its lead. |
| 16 | Const-module examples and declaration-comparison table readable; no stranded headings or bottom collision. |
| 17 | Static-function import example, named-BIOS table and import listing readable, including long lines. |
| 18 | Installed-environment sections, getglobal/setglobal table and installed-name bullets readable and well separated. |
| 19 | Installed-library table, captured-dependency bullets and fresh-boot paragraphs readable; footer clear. |
| 20 | Runtime-compilation and complete-program introductions readable; results.lua heading retained with full result-storage listing. |
| 21 | Original full page viewed, then final changed full page independently viewed: four module headings/listings readable; page now ends after complete nil-export listing. Ordinary bottom whitespace is not a defect. |
| 22 | Original full page viewed, then final changed full page independently viewed: Entry module heading, both lead paragraphs and entire unbroken listing now together; no clipping or footer collision. Original issue closed. |
| 23 | Observation output box and explanatory table intact; numeric-loop program introduction readable. Ordinary bottom whitespace is not a defect. |
| 24 | Result-storage listing intact; three-part assembly instruction readable; named Entry part 1 is complete and unbroken. |
| 25 | Named Entry parts 2 and 3 each complete with their own headings; no arbitrary split or clipping. |
| 26 | Numeric-loop output/table readable; generic-iteration introduction and full result-storage listing intact, clear of footer. |
| 27 | Iterator-entry listing, observations heading/output and final table readable; bottom table clears draft footer and page number. |

## Approval boundary

This is only an actual-PDF print-layout review of the identified artifact. It is not source/semantic approval, newcomer usability approval, or approval of the whole publication. The final 27-page PDF identified above has passed this finite visual check. Any later regenerated artifact requires its own delta check. Original full-page rasters and the original review are retained for comparison.

---

## Earlier 22-page baseline evidence

# Current BLua source-program PDF layout acceptance

**PASS for the current DRAFT**, SHA-256
`eb7657707a6a9e2c0c228cd7168bda32a2b9a8f4355d15630fdb1009b938a310`;
public source `e8f25c7b05be1f97da18694c9a73c4c8017af41cba6b3bc41a6c8c902066c289`.
A nonauthor viewed all22 pages of the initial artifact, then viewed all four
changed pages10–13 after repair. Eighteen other full rasters match exactly.
Both initial splits are resolved; complete per-page evidence and the initial
findings are retained below as history. This does not close factual coverage,
source-legality gaps or whole-book publication.

---

# BLua source programs: independent PDF print-layout review

## Artifact and scope

- Reviewed artifact: `/home/boaz/BMSX/build/manual/blua-programs.preview.pdf`.
- PDF SHA-256: `9431e68b0615a3accc353f7ce0ec4aab99636fc882ec5c7d7ade0e691f2f4cb8` (verified before and after inspection).
- Associated public Markdown SHA-256 supplied by root: `6c752cb5e6591224f3afa0ab7351c25d00ede7ef004d43da22a154c6aa934502`; pathname verification pending.
- Finite chapter only: **22 of 22 PDF pages actually viewed**. This is not whole-book approval, source-fact acceptance, or newcomer acceptance.
- Method: existing `/tmp/bmsx-manual-inspection-venv/bin/python` and `pypdfium2`; every page rasterized at scale 1.6 (952 x 1348 pixels) into `/tmp/bmsx-language-programs-pages/page-NN.png`, then every resulting full-page image actually inspected with `view_image`. Page 2 also viewed separately at original image detail. Renderer completion was not treated as layout evidence.

## Verdict for this exact artifact

**Two minor but real pagination defects require existing-markup grouping.** No other print-layout blocker found in the chapter.

### A — pages 10 to 11: block-example lead separated

Page 10 ends with the heading **“Blocks and break”** and the short lead **“do ... end creates a nested lexical scope:”**. The corresponding bordered listing begins at the top of page 11 with `local position = 0` and the `do` block.

Minimal correction: use the existing `keep-together` grouping for this heading, short lead, and first small listing. No new CSS or renderer behavior is needed.

### B — pages 11 to 12: module-header table lead separated

Page 11 ends **“A module attribute, when present, belongs at the beginning of the file before its statements. The available headers are:”**. The table headed **“Header | Meaning”**, with rows **“No header”**, `module<entry>`, and `module<const>`, begins page 12.

Minimal correction: use the existing `keep-together` grouping for that lead and table. The broader section need not become indivisible.

## General print observations

- Running title visible as **“BOOK II · BLUA32 AND BIOS REFERENCE”**; no other-book title observed. Header-band raster content is byte-identical across all 22 pages; PDF top-band extraction independently confirms the same title on each page.
- Footer/page numbering 1 through 22 is orderly, with no observed body collision. The chapter/draft footer is consistent.
- Body text, headings, monospaced examples and table cells are readable at the inspected size. Borders are complete; indentation is preserved; no clipping, overlapping text, or horizontal table overflow observed.
- The p3 String escape table prints the intended visible backslashes and quotation characters. The p9 operator table prints a visible bitwise `|` in one Operators cell without splitting the table column.
- Professional whitespace is accepted, especially p8 before the kept precedence table, p17 before the installed-libraries table, and the final page. The p20 entry discussion followed by the complete p21 listing is accepted under the explicit indivisible-listing requirement; it is not a stranded one-line example lead.

## Exact visual page coverage

| PDF page | Visible content | Layout observation |
|---:|---|---|
| 1 | Title, source text, identifiers | Readable; identifier table and reserved-name blocks intact. |
| 2 | Comments; number spellings | Readable comments/listings and intact number table; no table lead split. |
| 3 | Short Strings | Escape table readable; literal backslashes, quotes, and digit notation visible; no damaged columns. |
| 4 | Long Strings; local bindings | Readable delimiter examples, indentation and complete code borders. |
| 5 | Assignment targets | Augmented-assignment table and its lead remain together. |
| 6 | Functions and calls | Function forms, code indentation and borders intact. |
| 7 | Call spelling; return statements | Call table fits; short return-example intros remain with their listings. |
| 8 | Expressions and constructors | Readable table and constructor; lower whitespace accepted to keep next operator table intact. |
| 9 | Operator precedence; conditional branches | Three-column precedence table intact, including a visible bitwise pipe in the Operators column; conditional example complete. |
| 10 | Loops; Blocks and break opening | DEFECT A: short block-example intro and heading stranded from listing on p11. |
| 11 | Blocks; labels; interrupt; module names opening | DEFECT B: module-header table lead stranded from table on p12. |
| 12 | Module headers/path tables; imports | Tables and import examples readable; imports intro remains with listing. |
| 13 | Initialization; publishing ordinary module value | Examples readable; no short colon lead stranded at foot. |
| 14 | Export outcomes; ordinary objects; compile-time modules opening | Outcome table intact. Compile-time section has its explanatory paragraph before page break; not an orphaned heading. |
| 15 | Compile-time namespace and function imports | Example intros/listings and declaration-comparison table intact. |
| 16 | Static-body contract; BIOS imports; environment | Named-import table and listing intact; ordinary-globals heading has explanatory body. |
| 17 | Global access and installed names | Global-access table readable; names list intact. Lower whitespace accepted for next self-introduced table. |
| 18 | Installed library tables; public bindings; fresh boot | Table widths/wrapping readable; no clipping or awkward short lead split. |
| 19 | Runtime compilation; complete program; results module | Result-storage listing complete and bordered; heading and listing together. |
| 20 | Four program modules; entry intro | All four short listings readable. Entry intro before the indivisible next-page 54-line listing is intentional and acceptable. |
| 21 | Complete entry listing | Entire intentionally indivisible 54-line listing fits inside one complete border with indentation preserved; no footer collision. |
| 22 | Observations | Output block and explanatory table readable and intact; end-of-chapter whitespace acceptable. |

## Inspected raster SHA-256 manifest

```text
357f638a7b4d437f884f848265324f98019eddf9883e24a98f6f01a97dfbd00f  page-01.png
e9ec94bdd632116ba644844a8184fac2ef546f88af9b315c474d672eeab66909  page-02.png
e22c8cc014b6e4c8914465be33707f18c6ca542795b57bdd67ea5844269e8a78  page-03.png
e27efc61d486a6380cb2df95ce2806948596becdbcc90bf705fec67b870b8b12  page-04.png
049059f4ab11ad456703f015ebcdc2fafdd4ed3b97b092fa3d0430d857112ed8  page-05.png
d96fbd42c94b7875f75e274bc5e434bbd2dd3a33c7c6ee31a8347215b33da0a0  page-06.png
1c8e3063afedec2e243fa38e66fc6e91d84d9ccaaad3340a15da35f9df06a94e  page-07.png
44f9897d02e174e63a6324b6583fdfe548d3c6d37d2dc6e6b69f0282bf0d51b0  page-08.png
ce46bb0b2e34f154b97f29754c6ffd86e5a12a2e0dc477a6d7831e839c437355  page-09.png
c8bd6892a568f56eec75f6d49f7c1f36640a3f57f938f73103ebfbc6aa8e990b  page-10.png
843236d72c8a1e63268af1c6c3142bf538ad902209c89973ced16413f0c35863  page-11.png
eaa0f85ce189ce2b46a1c57fb82aa7a25b86cbcd6118cdbb684e0cd992a92b4b  page-12.png
d68179b6e92b7b24568911c23c8a663c2fa0faab4a564aa8e2950aba6b0efff3  page-13.png
6d0caeec4be4544602c9792da47ab9b781753a26a15435c575e41cc0a4297fc6  page-14.png
6baa0f7af57563bb276c2587df76ddffabcf592b2dcfc4ad209a12b950d94d4a  page-15.png
e939a49f955061275c35a1f781ccb9a358aa274b4f00edebe4fd855db9125c6f  page-16.png
7c3c44759d0bfe04f25f7550ceb35e110b7d8f83c3699245c90733952d17c5df  page-17.png
91a74b6272e7918fb4ef57c278fd5a7fc4b829b85150757ad0580a30db635805  page-18.png
6a4ca0f5526fafa0184db1f01e858709557f503d73c5c1aef254eecf0c3153e3  page-19.png
8a41f1cf8ac94ba5416718d9a26fa8bdba0ddacb5b682c9e92f8da10064749ca  page-20.png
66b4e7ba3c135105b630e0004b68f61453c594849d3d835bcb12fcac6b209d87  page-21.png
6f0fd0f0b3b88d0ae034862693441e81d5041a7b7c30fb8386776dd1c7ddd4c6  page-22.png
```

## Bounded follow-up: corrected actual artifact

**PASS for chapter print layout** on the following exact artifact; this supersedes the two-defect verdict above, not its evidence history.

- Actual PDF SHA-256 verified immediately before rasterization and after visual inspection: `eb7657707a6a9e2c0c228cd7168bda32a2b9a8f4355d15630fdb1009b938a310`.
- Actual public source `docs/book1/blua-programs.md` SHA-256: `e8f25c7b05be1f97da18694c9a73c4c8017af41cba6b3bc41a6c8c902066c289`.
- These actual hashes differ from the intermediate hashes supplied in the follow-up request; that intermediate artifact was not reviewed or implicitly accepted.
- Rerasterized all **22 pages** with the same renderer/scale into `/tmp/bmsx-language-programs-pages-final` and compared each resulting PNG byte-for-byte with the already visually inspected PNG for the same page.
- **18 unchanged pages: 1–9 and 14–22.** Their exact PNG bytes and SHA-256 hashes match the first-pass manifest. Their prior actual visual inspection therefore carries forward without an inference about renderer success.
- **4 changed pages: 10, 11, 12 and 13.** All four were actually viewed again as complete, readable full-page images using `view_image`.
- Coverage for this artifact is consequently **22/22 pages**: 18 exactly retained inspected raster pages plus 4 newly viewed changed raster pages. There are no uncovered pages.

### Changed-page observations

| PDF page | Visual follow-up |
|---:|---|
| 10 | Loops finish cleanly; the previous stranded Blocks heading/lead are no longer at the foot. Whitespace is professional and acceptable. |
| 11 | “Blocks and break”, its “do ... end creates a nested lexical scope:” lead and first bordered listing are now together at the top. Source-files section opens with a full introductory paragraph at the foot, not an orphan heading. |
| 12 | The “The available headers are:” lead now shares the page with the intact Header/Meaning table. Path table, imports examples and bottom explanatory paragraph remain readable, complete and clear of footer. |
| 13 | Reflowed import prose, initialization examples and publishing section remain intact. No newly stranded short example lead, clipping or collision introduced. |

The two initial pagination defects are resolved in the visible artifact. No further real print-layout defect was found. This remains a bounded finite-chapter print-layout decision only, not whole-book, source-fact or newcomer approval.

### Exact final raster coverage manifest

`retained` means exact byte equality with the previously viewed page; `viewed-again` means changed page explicitly viewed in this pass.

```text
357f638a7b4d437f884f848265324f98019eddf9883e24a98f6f01a97dfbd00f  page-01.png  retained
e9ec94bdd632116ba644844a8184fac2ef546f88af9b315c474d672eeab66909  page-02.png  retained
e22c8cc014b6e4c8914465be33707f18c6ca542795b57bdd67ea5844269e8a78  page-03.png  retained
e27efc61d486a6380cb2df95ce2806948596becdbcc90bf705fec67b870b8b12  page-04.png  retained
049059f4ab11ad456703f015ebcdc2fafdd4ed3b97b092fa3d0430d857112ed8  page-05.png  retained
d96fbd42c94b7875f75e274bc5e434bbd2dd3a33c7c6ee31a8347215b33da0a0  page-06.png  retained
1c8e3063afedec2e243fa38e66fc6e91d84d9ccaaad3340a15da35f9df06a94e  page-07.png  retained
44f9897d02e174e63a6324b6583fdfe548d3c6d37d2dc6e6b69f0282bf0d51b0  page-08.png  retained
ce46bb0b2e34f154b97f29754c6ffd86e5a12a2e0dc477a6d7831e839c437355  page-09.png  retained
1a15d32a03ff7d8baa7c64ebc3bddd1872dad241441043b21af4551233d40a5d  page-10.png  viewed-again
cbe800d1a229f6074998999de06d0811520c01d252874919584760f62efb4219  page-11.png  viewed-again
c6d2e3ae93863e40a0cf00f4e653acf57b7337c9d330d9d902df490a3e8771e1  page-12.png  viewed-again
6afc89afcc394f87da11744ec85094e93bddd4b0c8d41681e343d3464eeedd12  page-13.png  viewed-again
6d0caeec4be4544602c9792da47ab9b781753a26a15435c575e41cc0a4297fc6  page-14.png  retained
6baa0f7af57563bb276c2587df76ddffabcf592b2dcfc4ad209a12b950d94d4a  page-15.png  retained
e939a49f955061275c35a1f781ccb9a358aa274b4f00edebe4fd855db9125c6f  page-16.png  retained
7c3c44759d0bfe04f25f7550ceb35e110b7d8f83c3699245c90733952d17c5df  page-17.png  retained
91a74b6272e7918fb4ef57c278fd5a7fc4b829b85150757ad0580a30db635805  page-18.png  retained
6a4ca0f5526fafa0184db1f01e858709557f503d73c5c1aef254eecf0c3153e3  page-19.png  retained
8a41f1cf8ac94ba5416718d9a26fa8bdba0ddacb5b682c9e92f8da10064749ca  page-20.png  retained
66b4e7ba3c135105b630e0004b68f61453c594849d3d835bcb12fcac6b209d87  page-21.png  retained
6f0fd0f0b3b88d0ae034862693441e81d5041a7b7c30fb8386776dd1c7ddd4c6  page-22.png  retained
```


# Actual-PDF delta recheck: known-call argument diagnostics

**Print-layout delta: PASS for the exact candidate below.**

Current PDF: `build/manual/blua-programs.preview.pdf`.
SHA-256: `d99b05233585d3f360b71e86af1eefbf4c18a5a6fb7f51d0707cf6a9f8a44fd0`.
Page count: **28**, unchanged.
Parent-supplied public-source SHA-256: `e4cc1350a40b7a4d5c491efd84cb4bf6c64702f37557ad91b45d1b0ab3b65d69`.
Comparison PDF: `84d8c8654551beb17a5f8c647468d9b90930e8a97f0a7cb0a84a20392367c0f7`, 28 pages.

## Finite evidence

- Independently rendered all 28 current pages with PDFium at scale 1.5 into `/tmp/bmsx-language-arity-fixed-pages-d99b0523` (893 × 1263 each).
- Compared every full-page raster with retained `/tmp/bmsx-language-arity-fixed-pages-84d8c865`.
- Pages **1–10, 13–16, 22–28 are pixel-identical** and retain the previous individual-review evidence.
- Actually viewed every changed full page individually: **11, 12, 17, 18, 19, 20, 21**. No contact-sheet or text substitution.
- Checked paragraph breaks, table/code bounds and section leads on those seven pages. No new actual layout failure found. The revised page-19 row and inline example fit within their bounds without clipping or overlap.
- All 28 running-header bands and DRAFT-footer left bands remain pixel-identical to retained evidence. The earlier independent enlarged header check confirms `BOOK II - BLUA32 AND BIOS REFERENCE`.

## All eight earlier issues closed

| Earlier detached group | Current closure |
| --- | --- |
| Return statements heading + intro + first listing | Together on page 8; pixel-identical retained page |
| Numeric selector-table lead + two-row table | Together on page 11; individually re-viewed |
| Initialization fragment lead + listing | Together on page 15; pixel-identical retained page |
| Const-local comparison heading + intro + table | Together on page 17; individually re-viewed |
| Named-BIOS call-example lead + listing | Together on page 18; individually re-viewed |
| Iterator-call lead + one-line listing | Together on page 12; individually re-viewed |
| Named-BIOS imports heading + intro + table | Together on page 18; individually re-viewed |
| Global-access heading + intro + table | Together on page 19; individually re-viewed |

No further layout remedy is requested. This is finite actual-PDF print-layout evidence only: no repository edits, source audit, semantic/public-reader approval or whole-publication approval.
