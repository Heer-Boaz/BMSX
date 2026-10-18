# Developer-manual chapter standard

This is the editorial and publication standard for the BMSX developer references.
[The PCRTC chapter](../book1/pcrtc.md) is the first reviewed chapter and **style
baseline**, not a compulsory outline for every unit.

The current working layout places the installed machine in Book I and
cartridge/socket/card material in Book II. Work on one unit at a time.
Chapter order may follow the reference manual's progression from hardware
operation to programming and registers; do not copy its devices, addresses,
diagrams, or behavior. **The current volume numbers,
volume titles and running labels are provisional.** The 2026-10-18 booklet
organization task below must establish where technical specifications, hardware
programming, BLua/BIOS and cartridge/expansion reference belong; software chapters
must not receive a final hardware-reference label merely from the current catalog.
The [reference-booklet review and working proposal](booklet-structure.md)
distinguish document genres and map the current chapters; its proposed numbers
have not been applied to the catalog or printed artifacts.
`docs/book1_text.pdf` is only a style/order reference. Do not attach it to
chapter-writing prompts. Do not use `docs/architecture.md` as chapter input.

## Reader acceptance target

The complete manual must let an experienced programmer who is **new to BMSX**
program the whole console without reverse-engineering its source or examples.
The series must cover the installed machine, software/programming interfaces
and cartridge/socket/card hardware. Familiarity with another console is not
familiarity with this one; provisional volume numbers do not change this scope.

The reader must be able to establish startup and memory ownership, find usable
and reserved addresses, prepare each unit's actual data representation, program
every documented operation, connect adjacent units, synchronize work, inspect
the result and handle the defined faults. Supply real BLua/BIOS usage and
end-to-end examples, not just register inventories. Visual operations also need
explanatory actual output images where they make the operation understandable.
If a necessary step, address, reservation, encoding, timing condition or recovery
rule still requires inspecting the implementation, record a documentation gap;
do not call the chapter or book complete because it builds or reaches a page
count. Explicitly undefined physical guarantees remain separate specification
decisions, not invented numbers.

## Author's brief

1. Write English for the cartridge programmer, who sees only the console.
2. Describe the installed unit, its boundaries, and what the programmer controls.
3. Explain data flow and a usable programming route before the register inventory.
4. Separate programmed words, latches, live state, and externally visible output.
5. Name the sourced edge or condition that makes each write effective.
6. Use register words and hardware units, not implementation types.
7. Give addresses, access, bit positions, encodings, and reset words explicitly.
8. Distinguish unnamed retained bits from reserved or must-zero bits.
9. Give capacities, numerical formats, clocks, bus costs, latency and throughput
   guarantees a recognizable specification overview; distinguish undefined rates.
10. Teach representative operations with assumptions, ordered writes, results and
    the connection to the adjacent units needed for the intended use.
11. Derive every example value and claim from the fact sheet.
12. Draw circuits, connections, dimensions, and edges, not decorative boxes.
13. Warn only about sourced hardware hazards; distinguish races from guarantees.
14. Keep tools, host details, source paths, history, and design rationale out.
15. Stop on a missing fact; record the gap in editorial material, not invented prose.

## Flexible chapter shape

The hardware brief above applies to device/programming references. A language
or BIOS chapter instead needs actual source forms/call signatures, arguments,
values, returned results/counts, errors, work and binding/lifetime boundaries.
Do not manufacture a register bank or per-function reset words for an API.
The same fact extraction, independent review and real programming-route
requirements apply; this is not another publication format or gate.

Use an outline/function explanation, an appropriate programming sequence, and a
local register reference. Adapt their length, order, and subsections to the unit.
A FIFO unit may need a command protocol; a timer may need an edge diagram; a
controller port may need a transaction sequence. Do not invent a display-like
datapath, timing equation, or example merely to imitate PCRTC's headings. Do not
add a chapter-local table of contents, migration note, or implementation survey.

The register reference must be usable without hunting through narrative paragraphs:

- Address, exact register name, access, reset word, and bit positions.
- Legal/representable encodings and their sourced effects, including unused bits.
- The visibility edge and any immediate side effect such as beam restart.
- Clear-on-read/write-one-to-clear/strobe rules where actually defined.

Examples state the starting state, retained assumptions, actual address/word
writes in order, and the observable result. Distinguish a device-level sequence
from CPU/global-interrupt setup. Show a genuine state change, not a sequence of
reset-value writes presented as initialization. A limited example cannot close
an incomplete register or datapath contract.

## Source and review workflow

Divide substantial chapters into named sections and assign independent writers
nonoverlapping sections, including their finished prose and source evidence. Merge
their text into the existing chapter, then cross-review facts and the complete
programming route. Give each writer the section-relevant facts and source ranges,
not the whole book's context. Writers do not need a PDF build or publication
approval to work in parallel. This is an editorial division of work, not another publishing layer.

1. **Extract facts.** Read the unit's mirrored spec leaf and live owners. Record
   the exact scope, including any necessary owning callsite or constants leaf.
   Give every fact a source path and line range in `facts/<unit>.md`. Include
   addresses, access, resets, encodings, write visibility, timing, IRQs/faults,
   and retained save-state words. Keep non-programmer state editorial. If the
   spec or mirrors disagree, stop and name both locations. Do not infer a fix.
2. **Author from the sheet only.** Supply the brief and sheet, not the owners,
   architecture document, or reference PDF. Missing facts go back to extraction.
3. **Audit claims.** Compare every factual sentence, table cell, example result,
   equation, and figure label/connection against the actual source lines. Report
   failures as the quoted claim plus the conflicting line, or explicitly no
   supporting line. Do not rewrite the chapter during this pass. Fix findings,
   then review the changed claims again.
4. **Audit completeness separately.** A chapter can contain no false statements
   yet still omit the operation of a register. Record each required topic below
   as a sourced resolution, with any remaining questions in its `open` list.
   A real cross-reference to an existing, complete owner chapter can resolve a
   shared contract. A promised future chapter cannot. Absence from the current
   source scope does not prove "not applicable" or "no faults".
5. **Audit figures semantically.** Trace every producer, consumer, arrow, merge,
   control input, dimension endpoint, and timing landmark. Two independent inputs
   must not acquire a shared bus from drawing convenience. A schematic timeline
   must say when it is not to scale; a landmark chart is not an electrical waveform.
6. **Audit the generated PDF visually.** Inspect every page at readable size:
   labels, arrowheads, dimensions, aligned bit columns, tables, page boundaries,
   stranded headings, whitespace, and headers/footers. Inspect the PDF, not only
   the SVG source, browser DOM, or overflow-check result.

Extraction, authorship, and review are separate passes. They need not use
different model brands, but the authoring pass must not silently expand its
input sources, and a successful build must never approve its own prose.

### Completeness record

Copy [review-template.json](review-template.json) into the book's `reviews/`
directory. Its required topics are:

| Topic | Required resolution |
|---|---|
| `boundary` | Function, connections, and ownership relative to adjacent units |
| `registers` | Complete address/access/reset/bit/encoding operation reference |
| `datapath` | Selection, representation, units, arithmetic, and output behavior |
| `visibility` | Immediate state, latched state, effective edges, multiword hazards |
| `timing` | Clocks, event ordering, completion conditions, stopped/disabled modes |
| `interrupts` | Producers, pending state, masks, acknowledgement, races, delivery |
| `faults` | Error conditions and access policy, or a sourced external contract |
| `reset` | Reset/strobe/flush scope and effects on in-flight work |
| `programming` | Sourced, usable ordered examples and hardware cautions |

Each topic has a `resolution` and an `open` array. An empty resolution or any open
question blocks publication. Explain a genuinely inapplicable topic in its
resolution, with evidence; do not silently delete checklist topics. The PCRTC
record documents the closed contracts and the explicit software-authority
decision; its separately corrected backend discrepancy has a recorded follow-up.

The `facts`, `figures`, and `print` reviews each have a `passed` flag and a
repository-relative `report` path. Leave `passed` false until that review's
findings are resolved. One report can cover several passes. Record the scope,
findings, and resolutions; a print report also names the engine and pages inspected.
The publisher checks these recorded decisions, not the truth of hardware claims.

When making changes, reopen only the affected reviews in the same edit:

- Hardware claims, examples, or their source contracts: `facts`; also `figures`
  when their meaning changes.
- SVG connections, dimensions, or labels: `figures` and `print`; also `facts`
  when a hardware claim changes.
- Stylesheet, fonts, publisher, or browser: `print`, not `facts`.

Reopen `print` whenever the chapter's content or layout changes. Review freshness
is an editorial responsibility: there are no file hashes or approval signatures
to copy, and no automatic claim that an unchanged flag proves a review is current.

## Shared print design and source markup

[print.css](print.css) owns the common monochrome A4 layout: 19 mm top, 18 mm
other margins, 10 pt body text, ruled headings/tables, compact bit-field tables,
and monospace equations. Book/chapter labels and page numbers are generated in page margins.
All previews say **DRAFT — NOT FOR PUBLICATION**, including in every page footer.

Author figures as local, standalone SVG with a `viewBox`, unique IDs, and meaningful
`title`/`desc`. Reference them using normal Markdown images. The publisher embeds
SVG and the [bundled fonts](fonts/README.md), so the HTML has no external asset or
system-font dependency for the authored glyphs. It applies the shared sans face
to SVG text and the mono face to groups marked `font-family="monospace"`.
Keep connections and coordinates in the authored SVG, not in publisher code.

Use local PNG for actual output captures, referenced by the same Markdown image
syntax. Keep the captured bytes unmodified in the chapter's figures directory;
do not wrap them in SVG or replace them with a synthesized illustration. Record
the executable source, settings, capture condition and what the result does and
does not prove in the fact/review material. Caption the visible result in the
chapter. The existing publisher embeds PNG as normal tagged HTML images with
authored alternative text and pixel-sharp scaling; two related frames may share
a table. Inspect the actual printed image and caption at a readable size.

Use ordinary Markdown for prose and tables. Escape literal pipe characters in
table cells, including inside inline code; backticks alone do not protect a
pipe from becoming a column boundary. Check the complete cell in the PDF.
For a register entry that fits on
one page, explicitly group its Markdown rather than relying on a section number:

```html
<section class="register-entry">

### Register name — purpose

Register table, bit layout, encodings, effects, and cautions.

</section>
```

Blank lines around both HTML boundary tags let Markdown parse normally. Use
`class="keep-together"` for another short indivisible group. If a group or table
exceeds one printable page, split it editorially; do not shrink the whole chapter
or hide overflow. Prose and longer sections otherwise paginate normally.
Keep a table's short setup/lead paragraph with that table, and a calculation
step's lead with its equation. Group these authored objects, not an entire long
command section; this prevents reflow from stranding the programming inputs.

Use real tables for register bit fields, not columns aligned with spaces. A
`bit-fields` table pairs each bit range with its field; use separate tables when
the low and high words have different divisions:

```html
<table class="bit-fields">
<thead><tr><th>LOW</th><th>31:1</th><th>0</th></tr></thead>
<tbody><tr><th>Field</th><td>R</td><td>Enable</td></tr></tbody>
</table>
```

These are field-group tables, not drawings to a physical bit-width scale.

## Scheduled follow-up work

Requested 2026-10-17. Keep the current unit-by-unit writing plan; carry out this
broader completeness pass after the active chapter rather than silently treating
a source-accurate register reference as a complete technical specification.

- [x] **DMA rates by route.** Audit RAM, system-ROM, cartridge-ROM and GPU/VRAM
  transfer routes separately. The DMA chapter already lists region cycle costs;
  check that usable word/byte rates, setup and block-size effects, request waits,
  arbitration/contention and destination completion are actually explained.
  Trace VRAM through its real owning ports/datapath rather than assuming a
  direct DMA aperture or equating DMA DONE with a completed VRAM operation.
  The T02 supplement supplies conditional word/byte rates, block/tail and
  request-gap examples, and distinct GPU upload/readback transport budgets.
  Paired controller replays and independent source/reader review are recorded
  in [the DMA review](../book1/reviews/dma-source.md). This is not a rated
  end-to-end VRAM bandwidth or closure of the broader audit below.
- [ ] **Every installed unit, including earlier chapters.** Inventory capacities,
  organization, transfer widths, numerical formats, clocks/dividers, latency,
  throughput, route-dependent timing, sharing and visibility limits. Check for
  missing technical details beyond the DMA example, not just incorrect existing
  claims. Assign concrete missing paragraphs and examples to the owning chapter.
- [ ] **Evidence and limits.** Extract each number from the paired spec/owners,
  state the operating assumptions and replay representative cycle/rate examples.
  Distinguish scheduled budgets from end-to-end rates and electrical ratings.
  Record genuinely unspecified hardware parameters as separate specification
  decisions; do not fabricate them or import reference-console specifications.

- [ ] **Booklet organization, volume titles and running labels (2026-10-18).**
  Compare real MSX/MSX2, NES, SNES, N64 and PlayStation documentation before
  fixing the book divisions. Inspect the user's local examples:
  `docs/examples/V9938-programmers-guide.pdf`,
  `docs/examples/z80cpu_um.pdf`, `docs/examples/HB-75 computer.pdf`,
  `docs/examples/s3527datasheetenglish.pdf`, and `docs/examples/z8400.pdf`.
  Use actual front matter, contents, chapter divisions and running labels,
  with identifiable booklet/page references; use official/scanned originals
  for the other consoles, not an invented retro-manual template. Decide how
  technical specifications, hardware operation/programming, BLua/BIOS software
  reference and cartridge/expansion material should be divided. A separate
  specifications volume might move hardware reference to Book II and software
  to Book III, but those numbers/titles are proposals, not settled policy.
  Produce a concise chapter-to-volume mapping, then update titles/running labels
  consistently. In particular, the present `BOOK I · HARDWARE REFERENCE` label
  is not a final classification for **Protected calls and coroutines** or the
  BIOS-library chapters. Do not force the present Book I/II catalog membership
  into the answer, rename everything prematurely, or add another publishing
  framework. These booklets supply organization/presentation evidence only;
  none supplies a BMSX address, format, timing or behavior. Do not attach them
  to facts-only chapter-authoring prompts.
  The [bounded evidence review and working series map](booklet-structure.md)
  now cover the supplied MSX-related documents and original SNES/N64/PSX
  examples. NES manufacturer developer-manual structure is still unverified.
  Applying final section assignments, volume data and inspected new running
  labels remains work; this checklist item is not closed by the proposal.

- [ ] **Actual graphics-output illustrations.** Add real BMSX result images to
  the GTE and other graphics chapters, alongside the explanatory schematics.
  Connect the programmed inputs and register settings to the visible output;
  use before/after or contrasting cases where they teach the operation. Capture
  actual cartridge output without Studio/debugger chrome. Keep the producing
  program, settings and capture provenance in editorial evidence. Schematics or
  generated “expected” pictures must not stand in for observed result images.
  The bounded GEO docking scene now has five accepted actual plates and a
  complete executable teaching route; other contrasts remain on the inventory.

This is pending editorial work, not a new publisher, schema or approval gate.
Previously passed scoped reviews do not close this broader audit in advance.
The [bounded technical inventory](technical-follow-up.md) assigns concrete
follow-up paragraphs, actual graphics-capture leads and remaining owner chapters.

## Repository commands

After `npm ci`:

```sh
npm run manual:preview -- pcrtc
npm run manual:check -- pcrtc
npm run manual:publish -- pcrtc
npm run test:manual
```

The preview/publish/test scripts provision the lockfile's Chromium with the
existing Playwright installer. Preview writes `build/manual/pcrtc.preview.html`,
`.pdf`, and `.json`; publication writes `build/manual/pcrtc.html`, `.pdf`, and
`.json`. Build products are ignored. The HTML is self-contained. The JSON receipt
records Chromium/Node/platform and mechanical layout results.

`manual:check` exits nonzero for unresolved coverage or pending reviews.
`manual:publish` applies the same gate **before rendering**. Preview may succeed
while reporting those publication blockers; that is not release approval.
Missing chapter/asset files or a passed review's report are build errors. A
failed build does not make an older PDF current; use the successful command and receipt.

The publisher reads the chapter, its review record, and its print assets. It
does not traverse the fact sheet's source links or load device owners. Those
belong to the factual review, not the PDF build.

Build checks detect missing input files, horizontal overflow, oversized
indivisible blocks, and figure labels outside their viewport. They
do not prove signal topology, register semantics, or good pagination. Rendering
is reproducible from repository inputs and the installed locked browser; it is
not claimed to be byte-identical across platforms or PDF creation timestamps.
Record the engine in visual-review evidence and repeat that review on an engine
or platform change.

To add a chapter, create its chapter/sheet/figure/review files and add one entry to
[catalog.json](catalog.json). Record its provisional volume membership explicitly;
the scheduled structure review owns the final divisions and titles. Do not
pre-fill facts, reviews, or publication status to make a new entry pass.

### Publishing implementation references

The pipeline keeps source, shared presentation, and publication metadata separate,
as in [MAME's documentation configuration](https://github.com/mamedev/mame/blob/master/docs/source/conf.py).
Chromium printing, accessible PDF tagging, and outlines follow
[Playwright's PDF tests](https://github.com/microsoft/playwright/blob/main/tests/library/pdf.spec.ts)
and [PDF API](https://playwright.dev/docs/api/class-page#page-pdf).
Running labels/page counters use
[Chromium's CSS page-margin support](https://developer.chrome.com/blog/print-margins).
These are tooling references, **not sources of BMSX hardware behavior**.
Binary-image ownership and normal HTML image output were also checked against
[Sphinx's HTML image translator](https://github.com/sphinx-doc/sphinx/blob/master/sphinx/writers/html5.py)
and [builder image selection](https://github.com/sphinx-doc/sphinx/blob/master/sphinx/builders/__init__.py).
PNG uses the same figure/print review path; no extra asset manifest, approval
signature or capture framework was added.
