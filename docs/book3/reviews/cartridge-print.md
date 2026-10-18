# Cartridge print review: root pages1–6

Unpublished final-mode proof SHA256
`0bff0d73d87a2d0de5499b4fdcbef9cba7365bbfbe747f3c2284721c6bf7a044`.
Public source SHA256
`9a9a10aa03da799e7b9c221088acf078bf8374f12b6cf60536d38c6664412030`.
PDF12pages. Every assigned833×1179 pixel full page was individually viewed via
view_image ORIGINAL, not a contact sheet, text extraction or bbox-only check.

- Page1: title/rule, composition table all rows, boot/selection paragraphs,
  full Book III running title and CARTRIDGE/folio fit and read clearly.
- Page2: controller reset-value and bitfield tables, each raw SELECT/STATUS
  sentence, all paragraph endings and running matter inspected. Previously
  stranded paragraph tail now stays with the whole paragraph. No clipping.
- Page3: controller reset, three aperture rows and every width/tail/reset row
  inspected. Little-endian text, capacities, borders and complete cells clear.
- Page4: MMIO lane paragraphs, all four absolute mailbox addresses/reset words,
  register actions and all four CONTROL bitfield rows clear, no collision.
- Page5: control/pending/reset text and full IRQ figure inspected. Trigger
  path,0→1-only label, independent ACK arrows/labels and central bit9/10 fit;
  labels do not obscure connections. The following paragraph is complete.
- Page6: seven-row two-latch sequence with lead, DMA selector table and all
  admission/request paragraphs inspected. No stranded table/example lead.
  Large final keep-group gap is intentional, not missing or clipped material.

Bounded print PASS for pages1–6. Pages7–12 belong to separate review. This is
not source/fact/physical-hardware/newcomer completeness acceptance. Receipt
and successful build are not substituted for these actual page views.

## Supplemental pages7–12 and final proof

Root also individually viewed complete ORIGINAL pages7,8,9,10,11,12. Page7's
control decode, timing table and CPU admission text, page8 faults/ownership/
manifest, page9 second manifest/full typed result, pages10–11 every literal
entry line, and page12 all retained-result rows/qualifications are legible.
Observed retained-observation heading/lead split was corrected by existing
keep-together markup: final page11 ends the complete code and page12 begins
with its heading, lead and both tables; no new page or stylesheet was needed.

Final unpublished proof SHA256
`80bd33091725618c5fd52290f2c76f6a29573a45af03b08a5b79361d17fabad2`,12pages;
source `95d027012ba873ab15c3f5b00c849a8267106d33fa9f3713c1b48c3088837e27`.
Exact full decoded RGBA+dimensions to baseline0bff: pages2–7,9–10; changed1,8,
11–12 individually viewed at ORIGINAL. Pages1/8 were viewed on the immediately
preceding8d0258f9 proof and are separately checked exact to this final proof.
No clipping, text/arrow collision, cut code/table or stranded table lead remains.
Final bounded print PASS for all12pages. A separate7–12 review may add evidence;
this root acceptance does not fabricate its completion or inherit unviewedpages.

## Independent print result

The separate [pages7–12 inspection](cartridge-print-independent.md) actually
viewed every baseline page and isolated repeated running-title/footer/folio
strips. It independently identified the retained-observation heading/lead split;
the root final11/12 views above close that observed defect. It verified final
full decoded RGBA+dimension identity for its unchanged pages7/9/10. Changed
final8/11/12 are not falsely inherited from its baseline approval; root's
actual supplemental views cover them. No publication acceptance depends only
on a receipt, text extraction, bbox check or contact sheet.

## Canonical publication identity

Published `build/manual/cartridge.pdf` SHA256
`fdfd07c4f0781362b5501496df059d68c50e3b44e42e505736effaace92c447f`.
All12published pages have identical dimensions and exact full decoded RGBA
bytes to the accepted final proof80bd3309 above (PDFium scale1.4). No chapter
word, glyph, row, figure or page is accepted only from metadata/hash similarity.
Current source SHA256 remains95d02701 above. `manual:check` and canonical
`manual:publish` pass. Final source `git diff --check` passes separately.

The existing publishing suite reprints PCRTC as a fixture. Its current37pages
were separately checked exact fullRGBA+dimensions against the already accepted
composition proof; GTE/APU canonical hashes remain unchanged. That is acceptance
carry, not a new device/source/backend review.
