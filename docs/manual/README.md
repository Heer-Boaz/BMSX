# BMSX developer-manual standard

The technical manuals are the authoritative product specification of the
physical BMSX console. They must let an experienced programmer new to BMSX
write games, libraries and development tools without access to this repository.
They are manufacturer documentation, not an edited account of the emulator.

## Products and volumes

- **Book I — System and Hardware Reference:** the installed machine, memory,
  hardware units and their programming interfaces.
- **Book II — BLua32 and BIOS Reference:** processor architecture, instruction
  set, BLua language extensions and installed firmware interfaces.
- **Book III — Cartridge and Expansion Reference:** cartridge connections,
  mapped card devices and expansion interfaces.

[volumes.json](volumes.json) owns the titles and [catalog.json](catalog.json)
owns chapter membership. Existing `docs/book1/` paths are source locations, not
book classification. See the [series organization](booklet-structure.md).
A draft's presence or length does not establish completeness or publication.

`docs/architecture.md` describes internal software architecture only. It must
not contain a second hardware/BIOS specification. Use its old contents only to
locate migration candidates; independently verify each fact before including
it in a book. Internal documents link to the appropriate public chapter.

`cartlib`, ROM packers, asset converters and project build tools have the
position of a game studio's independent software. They are neither BMSX
hardware nor BIOS nor a prescribed manufacturer SDK. Keep their APIs, schemas,
asset conventions and packaging recipes out of all three books. Document the
actual machine/BIOS-consumed formats instead, sufficiently to permit independent
producers. Repository/tooling instructions belong in the separate
[development companion](../programming/getting-started.md), not the books.

## Manufacturer voice

Write English for a professional cartridge programmer. Treat BMSX as the
installed physical machine. Explain the unit and its use before its detailed
reference. Use hardware terms, register words and physical/programming units.
Do not mention emulator implementations, source paths, tests, repository
history, proposed refactors or rejected designs in public prose.

A device chapter normally teaches:

1. What the unit does, its resources and connections to other units.
2. The data path, processing stages and visibility/completion edges.
3. How to prepare data, submit work, synchronize and use the result.
4. Complete registers, fields, commands, formats, capacities and timing.
5. Relevant hardware hazards, faults and interrupt handling.

Adapt this structure to the subject. A BIOS reference needs signatures,
arguments, units, results, errors and necessary usage, not artificial registers.
Distinguish explanation, programming instructions and lookup material. Avoid
chapter-local contents lists, repetitive limitation disclaimers and defensive
comparisons with implementations that the reader cannot see.

A register reference states address, name, access, bit ranges and reset, then
explains encodings, write effects and effective edges. Distinguish reserved bits
from retained unused bits. State clock/rate/latency and transfer-route differences
where defined; do not invent electrical ratings or fixed latency where none is
specified. Fault descriptions must tell the programmer what causes the fault,
what state/results survive and what action is available.

## Examples and illustrations

Code explains the hardware or BIOS; it is not a demonstration of the test suite.
Prefer short real BLua sequences, concrete register words, binary records and
worked calculations. State their starting assumptions and expected result.
Keep only initialization essential to the mechanism. Do not reproduce complete
result-buffer cartridges, harnesses, build files or assertion transcripts.
A longer functional example is appropriate when the interface genuinely needs it.
Existing useful general Lua reference may remain, but new coverage prioritizes
BMSX hardware, BLua extensions and relevant BIOS. Refer to Lua documentation
rather than expanding a general-language tutorial.

Use diagrams for real relationships: producer/consumer data paths, FIFO and
DMA flow, transform stages, memory layouts and synchronization edges. Do not
invent shared buses or add a figure for every register. Use actual output
images when they clarify graphics behavior; label input, settings and visible
result without presenting captures as exhaustive proof. Preserve meaningful
numerical inputs, intermediate results and output examples.

Historical manuals inform exposition, not BMSX facts. The
[organization review](booklet-structure.md) distinguishes original manufacturer
material, later editions and consumer manuals. Sony's
[Fall 1996 GTE seminar](https://psx.arthus.net/sdk/Psy-Q/DOCS/TRAINING/FALL96/gte.pdf)
provides a period example of purpose, coordinate/data-flow explanation and
worked mathematical stages preceding low-level use. Do not copy its addresses,
instructions or limits. `docs/book1_text.pdf` is a style/order example only;
do not attach it to chapter-authoring prompts.

## Source discipline and substantial chapter work

Read the relevant mirrored numeric leaves, actual device/CPU owners, BIOS
consumers and the BLua frontend for language/linkage interfaces. Tests help
check reached behavior and numerical examples. A packer's
writer alone does not establish a machine format. `architecture.md` is neither
fact sheet nor evidence. Record conflicts between spec, implementations and
manuals rather than automatically selecting any one as correct. Suspected bugs
and unresolved product decisions stay in engineering material, not as invented
hardware restrictions or permanent guarantees of defective behavior.

Use the existing fact/review records when evidence needs a durable location.
Do not create a new Markdown report for each paragraph. Substantial chapters
can be split into named sections with independent writers; each assignment
owns finished prose and its supporting facts. Merge into the existing chapter.
Complete the chapter's known content work before commissioning its detailed
review. Check changed claims and affected interfaces precisely, then recheck
findings rather than repeatedly reviewing unchanged material.

Assess the completed chapter on all of these dimensions:

| Criterion | Required result |
|---|---|
| Authenticity | Reads as an original manufacturer reference, not implementation commentary |
| Independence | Requires no repository, supplied library or specific toolchain |
| Explanation | Teaches the hardware principles and inter-unit data flow |
| Relevance | Code, calculations, cautions and figures clarify actual programming |
| Product boundary | Describes only the console, BLua32, BIOS or the relevant official interface |
| Completeness | Supplies every necessary representation, operation, synchronization and result contract |

Factual accuracy is necessary but does not imply any of these by itself.
Existing coverage topics and review flags remain in
[review-template.json](review-template.json). Reopen affected reviews when text
changes; do not mark a rewritten draft approved because its predecessor passed.
The publisher is not a source checker and a successful render is not acceptance.

## Print and navigation

Content comes first. Diagrams, output plates and normal markup may be authored
with the text; final pagination and PDF inspection follow completed content.
After a local print correction inspect affected pages and reflow, not every
unchanged page or another complete guest execution.

Use ordinary Markdown links to chapter sources and heading fragments. The
renderer maps them to sibling HTML/PDF documents and named destinations.
Retain useful heading anchors when shortening examples; update actual
cross-references when a heading changes. Distributed chapters and companion
files must remain together. Extract archives before following relative links.

Use ordinary Markdown tables; escape literal pipes even inside inline code.
Use real field tables rather than space-aligned bit diagrams. Existing
`bit-fields` tables support different low/high-word divisions. Use
`class="register-entry"` or `class="keep-together"` for a short indivisible
object, with blank lines around HTML boundary tags. Split oversized objects
editorially instead of shrinking or hiding them.

SVG diagrams and unmodified PNG output captures use normal Markdown image
syntax and authored alternative text. Keep labels readable and verify every
arrow, merge, dimension and timing landmark. A schematic timeline must not
pretend to be an electrical waveform. Store source/capture provenance in the
existing editorial records, not the public caption.

## Existing repository commands

After `npm ci`:

```sh
npm run manual:preview -- pcrtc
npm run manual:check -- pcrtc
npm run manual:publish -- pcrtc
npm run test:manual
```

Preview/publish use the existing Playwright/Chromium pipeline and write ignored
HTML, PDF and receipt files in `build/manual`. Publication checks coverage and
review decisions before rendering; preview may render an unapproved draft.
Mechanical overflow/asset checks do not establish good exposition, correct
hardware behavior or semantic diagram accuracy. Do not add another publisher,
approval framework, status-file layer or chapter-specific build pipeline.

The separate development companion is HTML. After chapter previews exist,
`node scripts/manual/build.mjs preview contents` generates the current draft
series entry point without rebuilding chapters. It does not publish a complete
series. Add new chapters through the existing catalog, with the appropriate
volume and existing fact/review representation.
