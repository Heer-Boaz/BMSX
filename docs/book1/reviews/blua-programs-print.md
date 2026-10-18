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
