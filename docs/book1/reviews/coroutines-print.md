# Coroutines print review

## Volume-title revalidation — 2026-10-18

Current canonical publication artifact `build/manual/coroutines.pdf`:
12 pages, SHA-256 `86ab392b3a621b161ec717893b019bce03c03121d5c5158a8f0f376cabd028a2`.
Page 1 was independently viewed; body pages 2–12 match the reviewed preview exactly.
All header bands match the fully reviewed new preview; clean chapter footers,
folios and absence of DRAFT were independently verified. Current-PDF rasters
and retained-pixel accounting passed. Evidence:
`/tmp/bmsx-volume-publication-delta-review.md`. This renews layout evidence only;
source/coverage decisions and whole-volume acceptance are unchanged.

Current `build/manual/coroutines.preview.pdf`: 12 pages, SHA-256
`9a301df0ac7df2a44b1be1a2868159b8b21a6ae6c31de6f120a5fe11b5def219`.
A nonauthor independently opened every full PDFium1.4× page1–12 at original
size. The document title and every running header now identify **Book II —
BLua32 and BIOS Reference**. Headers, chapter/DRAFT footers, folios, complete
tables, code and any figures fit without clipping or collisions. No body/style
change was needed. Receipts retain Chromium153.0.8010.12, Nodev22.23.1/Linuxx64
and no layout errors. Evidence: `/tmp/bmsx-volume-software-print-review.md`.
This renews bounded draft-layout acceptance, not factual/coverage decisions or
whole-series publication approval. Earlier artifact evidence follows.

- Reviewed PDF: `/home/boaz/BMSX/build/manual/coroutines.preview.pdf`
- SHA256: `5e930021e24380f73f65c3a47e59114e87352eaae08fc9c4fe238668ad62320a`
- Page count: **12** (independently verified with Ghostscript `pdfpagecount`).
- Evidence: `/tmp/bmsx-coroutines-pages/page-01.png` through `page-12.png`, rendered with PDFium at 1.4x; **every page viewed individually using `view_image` with `detail: original`**. No contact sheet or text extraction substituted for visual inspection.
- Scope: This generated coroutine chapter PDF only; this is not approval of the whole manual.

## Concrete visual failures

1. **Pages 5–6: one-line widow in the Wrapped coroutines introductory paragraph.** Page 5 ends partway through the introductory explanation of successful wrapped-call results; page 6 starts with its isolated final line “final tuple unchanged, including nil positions and result count.” Keep this short introductory paragraph together.
2. **Pages 7–8: figure lead separated from its figure.** The `ARGUMENT AND RESULT TRANSFER` heading and its three-line introduction appear at the bottom of page 7; the sequence figure starts page 8. This leaves the explicit figure introduction detached from the figure. The figure itself is clear and complete.

White space resulting from kept tables, code blocks, and the figure is otherwise acceptable. No code/table clipping, unreadable text, malformed figure arrows, overlapping labels, or other concrete visual failures observed.

## Individual page inspection

| Page | Result | Visual observation |
| --- | --- | --- |
| 1 | PASS | Title, prose, signature table, and section headings readable; no clipping. |
| 2 | PASS | Result table and protected-call prose readable; headings retained with body text. |
| 3 | PASS | Failure table and prose readable; COROUTINES heading has substantive following text. |
| 4 | PASS | Status table, signatures, and dense transfer prose readable and within margins. |
| 5 | FAILURE | Wrapped coroutines introductory paragraph leaves its final line alone on page 6. |
| 6 | FAILURE | Isolated one-line continuation of page 5 intro at top; remaining headings and prose pass. |
| 7 | FAILURE | Argument-and-result-transfer figure lead is detached from figure on page 8. |
| 8 | PASS | All sequence arrows, arrowheads, lifelines, values, and labels readable; result-storage code fits. Figure-lead separation recorded against page 7. |
| 9 | PASS | Protected-results code readable; long lines stay inside code-block border. |
| 10 | PASS | Yield/resume code readable and within border; kept-block white space acceptable. |
| 11 | PASS | Both example introductions and code blocks readable; no clipping or isolated lead. |
| 12 | PASS | Retained-values table and diagnostic-output block readable and complete. |

## Layout-correction recheck — accepted preview

- PDF SHA256: `22578d00fe26be328ffa5fb8864332b628bc47a6ae1766935f99c9113b76b202`.
- Page count: **12**, independently reverified with Ghostscript.
- Individually re-inspected revised pages **5, 6, 7, and 8** at original detail using `view_image`.
- Exact-byte image comparison against `/tmp/bmsx-coroutines-pages-before-layout` independently confirmed that only pages 5–8 changed; pages 1–4 and 9–12 retain the previous individual visual review.

| Revised page | Result | Visual observation |
| --- | --- | --- |
| 5 | PASS | Failure-and-closing text ends normally; no stranded Wrapped coroutines heading/lead. White space below kept content is acceptable. |
| 6 | PASS | Wrapped coroutines heading and complete introductory paragraph now begin together. Prior one-line widow is closed. Remaining prose and headings fit. |
| 7 | PASS | Language-fault table and reset/startup prose intact. Figure heading/lead moved together to page 8; remaining white space is acceptable for the kept figure block. |
| 8 | PASS | Figure heading, lead, and entire sequence figure now share the page. All arrows, labels, lifelines, and values remain readable. Complete-program intro and result-storage code fit without clipping. Prior detached-lead failure is closed. |

**Both reported failures are closed. No remaining visual failures observed in this 12-page preview PDF.** This acceptance applies only to the SHA256 above and is not a whole-manual approval or publication-mode approval.

## Final publication-mode review — accepted

- Reviewed PDF: `/home/boaz/BMSX/build/manual/coroutines.pdf`.
- SHA256: `3a52009df0004d7464bdae1ee1e837bc9cfa7f699cd30a0aa94b162aae798f0b`, independently verified before and after this review.
- Page count: **12**, independently verified with Ghostscript `pdfpagecount`.
- Evidence: `/tmp/bmsx-coroutines-published-pages/page-01.png` through `page-12.png`, actual PDFium rasters at 1.4x.
- **All 12 publication-mode pages were independently viewed individually using `view_image` at original detail.** Preview-mode acceptance or unchanged-text assumptions did not substitute for viewing any publication page.
- Draft banner and draft footer text are absent. Both prior layout fixes remain effective.

| Publication page | Result | Visual observation |
| --- | --- | --- |
| 1 | PASS | Banner-free title, signature table, protected-call prose, and section headings fit and are readable. |
| 2 | PASS | Result table readable; both headings retain following body text. No clipping. |
| 3 | PASS | Failure table readable; cycle-charge section and COROUTINES heading retain substantive body text. |
| 4 | PASS | Status table, signatures, and transfer prose readable and within margins. |
| 5 | PASS | Querying-yieldability and failure/closing sections fit; no stranded wrapper heading or lead. |
| 6 | PASS | Wrapped-coroutines heading and complete introduction retained together; all remaining headings/prose readable. |
| 7 | PASS | Fault-reason table and startup section readable and complete. White space preceding the kept figure page is acceptable. |
| 8 | PASS | Figure heading, introduction, and complete figure retained together. Every arrow, arrowhead, lifeline, label, and value readable. Following result-storage code fits. |
| 9 | PASS | Protected-results example and lead readable; longest code lines remain inside the code-block border. |
| 10 | PASS | Yield/resume code readable and within border; lead retained with code. White space acceptable for kept code block. |
| 11 | PASS | Failure/close and wrapped-call headings, leads, and code blocks readable and complete; no clipping. |
| 12 | PASS | Retained-values table and diagnostic-output block readable and complete; headings and leads properly retained. |

**No visual failures observed in this 12-page publication-mode coroutine PDF.** The prior preview failures are closed. Acceptance applies only to the publication PDF with the exact SHA256 above; it does not imply completion or approval of the whole manual.
