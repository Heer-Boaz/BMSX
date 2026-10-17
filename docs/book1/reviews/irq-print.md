# IRQ print review

Accepted for the current chapter and its unchanged shared print assets. Source,
programming and figure semantics are separately accepted in [irq-source.md](irq-source.md).

Engine: Chromium153.0.8010.12, Nodev22.23.1, Linuxx64. The actual publication-layout
PDF was rendered with PDFium at1.4× and viewed at original/readable detail. No
stylesheet, font, publisher or browser-specific chapter branch was introduced.

## Final publication-layout proof

Used the existing publisher's publish renderer to create the private proof
`/tmp/bmsx-irq-release-proof-final/irq.pdf` before approving the public print gate.
All13 pages are covered by actual visual inspection:

- Root individually inspected pages1–6 of the preceding12-page proof. Final
  pages1–4 are exact whole-page raster matches to those already-inspected pages.
- After adding the qualified actual-example timing table, root individually
  inspected changed final pages5–8.
- The independent reader individually opened final pages9–13, superseding its
  earlier7–12 review. The earlier proof was not treated as final acceptance for
  changed body layouts.

## Inspection results

- Overview/resource table and the pending/ACK/MASK circuit retain readable text,
  all arrowheads, distinct control/data paths and a complete full-pending branch.
- Pending equations, operation trace, CPU acceptance/STATUS formulas,03→0c→03,
  caution boxes and the generic BLua predicate-wait fragments are contained and
  readable. Headings retain their lead text.
- Both cycle tables on page5 retain every operation, column and total. The
  callback/RET exclusion and non-latency qualification remain next to the table.
- GPU-local/controller acknowledgement and arrival/clear-order tables retain
  their complete rows. No circuit or timing meaning is inferred from pagination.
- Register map, all eleven named-source rows, unnamed-bit explanation and mapped
  access/fault table are intact. Continued text is not lost at page transitions.
- The two-module experiment preserves every code line, indent, predicate and
  terminal `end`. No code box is clipped or split into an invalid continuation.
- On final page12, Reading-the-result retains its complete introduction; the
  intact six-column/eight-row matrix begins on13. This is not a stranded heading
  or broken table. Final limitations remain visible above the natural end space.
- Running book/chapter labels and page numbers are present throughout. No clipped
  cells, broken rules, text collisions, orphan heading or horizontal overflow was
  found.

The shared renderer reports one figure and no layout errors. These mechanical
checks supplement, not replace, the source/semantic/actual-page inspections.
Canonical publication `build/manual/irq.pdf` was regenerated after the gates
passed; all13 whole-page rasters exactly match the accepted private final proof. The ordinary preview retains DRAFT
marking and does not substitute for publication.
