# Developer-manual chapter standard

This is the editorial and publication standard for the BMSX developer references.
[The PCRTC chapter](../book1/pcrtc.md) is the first reviewed chapter and **style
baseline**, not a compulsory outline for every unit.

The working series, adopted after the [reference-booklet review](booklet-structure.md),
is **Book I — System and Hardware Reference**, **Book II — BLua32 and BIOS
Reference**, and **Book III — Cartridge and Expansion Reference**. A sourced
[system overview](../book1/console.md) now opens the hardware volume with
installed resources, address reservations, data routes and qualified timing;
an empty separate specifications book is not published.
The current catalog assigns the source-program chapter and the seven BIOS and
protected-call/coroutine chapters to II, and the overview plus twelve
machine/installed-unit chapters to I.
III now begins with [Cartridge sockets and mapped card devices](../book3/cartridge.md):
controller selection, optional ROM/RAM/mailbox, IRQ rearming and independent
DMA endpoints. The current device owners implement no additional expansion
protocol. Undefined physical ratings remain separate specification decisions,
not an assignment to invent another device chapter.
These assignments do not claim any volume is complete.

Work on one unit or bounded software interface at a time. Chapter order may
follow a reference manual's progression from operation to programming and
reference entries; do not copy its devices, addresses, diagrams, or behavior.
The shared [volume titles](volumes.json) own document and running identification;
the [catalog](catalog.json) owns chapter membership. Existing `docs/book1/` source
paths and chapter identities remain stable; a directory name is not book
membership. Evidence written before this adoption may use the old provisional
Book II designation for cartridge/expansion material; that scope is now III.
`docs/book1_text.pdf` is only a style/order reference. Do not attach it to
chapter-writing prompts. Do not use `docs/architecture.md` as chapter input.

## Reader acceptance target

The complete manual must let an experienced programmer who is **new to BMSX**
program the whole console without reverse-engineering its source or examples.
The series must cover the installed machine, software/programming interfaces
and cartridge/socket/card hardware. Familiarity with another console is not
familiarity with this one; volume numbering does not change this scope.

The references specify the machine, BLua32 and installed BIOS only. `cartlib`
is an independent cartridge-software product, not BIOS or bundled firmware.
Do not include its APIs, types, recipes, packaging conventions or dependent
examples in any volume. Retained library material belongs outside this series,
with its own internal-development identity rather than BMSX book numbering or
the hardware-reference house style. Specify binary interfaces from the actual
CPU, device and BIOS consumers so a developer can write an independent linker,
ROM packer and cartridge program; the current build tools are not the standard.

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
Open hardware chapters with a readable account of the hardware the console
provides: what units or channels exist, what they do, how they share work, and
which adjacent units matter. Explain important route/performance distinctions
in that account before the detailed specification table. A generic
"Installed resources" heading and table are not a substitute for this orientation;
do not merely rename the heading or turn each table row into a sentence.
A FIFO unit may need a command protocol; a timer may need an edge diagram; a
controller port may need a transaction sequence. Do not invent a display-like
datapath, timing equation, or example merely to imitate PCRTC's headings. Do not
add a chapter-local table of contents, migration note, or implementation survey.

Use source chapter paths and heading fragments for cross-references. The renderer
generates document-local GitHub-style heading IDs, including duplicate suffixes.
An explicit standalone `<a id="…"></a>` immediately before a heading supplies an
alias for that heading; existing native local destinations are retained.

HTML links target sibling chapter HTML files. PDF links use explicit relative
paths (`./…`) to sibling PDFs and exported named destinations, without workstation
paths; the separate development companion is self-contained HTML rather than a
fictitious hardware chapter.
Preview links stay in the `.preview` set. Keep the chapter files and companion
together when distributing them. Render the companion with the existing command:

```sh
node scripts/manual/build.mjs preview getting-started
```

Once all chapter previews and the companion HTML exist, generate the shared
draft entry point without rebuilding the chapters:

```sh
node scripts/manual/build.mjs preview contents
```

`build/manual/contents.preview.html` and `contents.preview.pdf` group the current
catalog by book and list the development companion separately. Keep them beside
the referenced preview files. This command checks that those files exist;
it does not approve the drafts or publish a completed series. Contents currently
supports preview mode only.

When distributing the preview set as an archive, extract all files before
opening the contents. Opening a single PDF directly from an archive does not
make its relative chapter and companion targets available beside it.

Chromium owns print layout; the PDF-format pass adds destinations and portable
URI actions without reflowing pages. Actual annotation/destination and delivered
file checks remain distinct from print acceptance. Whole-volume assembly and
remaining delivery work are tracked as [NAV01](technical-follow-up.md#nav01-pdf-navigation-is-not-yet-delivered-series-navigation).

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
Prefer short register sequences and worked calculations. Supply a complete
program only where it teaches a necessary end-to-end programming route; do not
build another cartridge for every register, option or timing detail. Retain
existing useful examples without expanding general Lua instruction.

## Source and review workflow

Finish the chapter's known content work before commissioning its detailed
review. Source checking is part of writing, not a reason to repeat a whole
chapter review after each paragraph. Keep layout and final PDF inspection until
the content is ready; diagrams, captures and ordinary markup may be added while
writing, but repeated pagination and screenshot rounds must not delay coverage.

Divide substantial chapters into named sections and assign independent writers
nonoverlapping sections, including their finished prose and source evidence. Merge
their text into the existing chapter, then cross-review facts and the complete
programming route. Give each writer the section-relevant facts and source ranges,
not the whole book's context. Writers do not need a PDF build or publication
approval to work in parallel. This is an editorial division of work, not another publishing layer.

1. **Extract facts.** Read the unit's mirrored spec leaf and live owners. Record
   the exact scope, including any necessary owning callsite or constants leaf.
   Keep source paths and line ranges in the existing `facts/<unit>.md`; do not
   create a separate fact or review file for each small revision. Include
   addresses, access, resets, encodings, write visibility, timing, IRQs/faults,
   and retained save-state words. Keep non-programmer state editorial. If the
   spec or mirrors disagree, stop and name both locations. Do not infer a fix.
2. **Author from the sheet only.** Supply the brief and sheet, not the owners,
   architecture document, or reference PDF. Missing facts go back to extraction.
3. **Review the content-complete chapter.** Split a large change into precise
   section assignments against the same finished text. Check changed claims and
   affected contracts in detail; do not re-audit unchanged, reviewed sections
   without a concrete reason. Compare sentences, table cells, example results,
   equations and figure labels/connections against the actual source lines. Report
   failures as the quoted claim plus the conflicting line, or explicitly no
   supporting line. Do not rewrite the chapter during this pass. Fix findings,
   then recheck the findings and affected contracts, not the whole chapter again.
4. **Audit completeness separately.** A chapter can contain no false statements
   yet still omit the operation of a register. Record each required topic below
   as a sourced resolution, with any remaining questions in its `open` list.
   A real cross-reference to an existing, complete owner chapter can resolve a
   shared contract. A promised future chapter cannot. Absence from the current
   source scope does not prove "not applicable" or "no faults".
   An accurate account of an existing software-library branch is not approval
   of its API. Keep suspected defects and unresolved public/private interface
   decisions in engineering follow-up, rather than making observed outputs
   permanent guarantees.
5. **Audit figures semantically.** Trace every producer, consumer, arrow, merge,
   control input, dimension endpoint, and timing landmark. Two independent inputs
   must not acquire a shared bus from drawing convenience. A schematic timeline
   must say when it is not to scale; a landmark chart is not an electrical waveform.
6. **Review final presentation after content.** Inspect the final PDF at readable size:
   labels, arrowheads, dimensions, aligned bit columns, tables, page boundaries,
   stranded headings, whitespace, and headers/footers. Inspect the PDF, not only
   the SVG source, browser DOM, or overflow-check result. After a local correction,
   inspect the affected pages and reflow rather than restarting the entire visual
   review. Do not repeat accepted guest executions when no program or hardware
   contract changed.

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

A navigation-only PDF metadata change can carry existing print acceptance when
every complete decoded page and its dimensions exactly match the accepted
artifact. This is not approval from a hash alone or a reason to repeat unchanged
page screenshots. Test link actions and destinations separately.

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

## Remaining work

Use the existing [technical follow-up](technical-follow-up.md) for open work.
Keep progress history in commits, not duplicated in this authoring guide.

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
[catalog.json](catalog.json). Assign its book from [volumes.json](volumes.json)
according to the [adopted scope map](booklet-structure.md). Do not
pre-fill facts, reviews, or publication status to make a new entry pass.

### Publishing implementation references

The pipeline keeps source, shared presentation, and publication metadata separate,
as in [MAME's documentation configuration](https://github.com/mamedev/mame/blob/master/docs/source/conf.py).
Chromium printing, accessible PDF tagging, and outlines follow
[Playwright's PDF tests](https://github.com/microsoft/playwright/blob/main/tests/library/pdf.spec.ts)
and [PDF API](https://playwright.dev/docs/api/class-page#page-pdf).
Running labels/page counters use
[Chromium's CSS page-margin support](https://developer.chrome.com/blog/print-margins).
PDF destination/action updates use [pdf-lib’s document model](https://github.com/Hopding/pdf-lib/blob/v1.17.1/src/api/PDFDocument.ts);
cross-document fragments follow the [PDF Association’s named-destination syntax](https://pdfa.org/pdf-fragment-identifiers/).
These are tooling references, **not sources of BMSX hardware behavior**.
Binary-image ownership and normal HTML image output were also checked against
[Sphinx's HTML image translator](https://github.com/sphinx-doc/sphinx/blob/master/sphinx/writers/html5.py)
and [builder image selection](https://github.com/sphinx-doc/sphinx/blob/master/sphinx/builders/__init__.py).
PNG uses the same figure/print review path; no extra asset manifest, approval
signature or capture framework was added.
