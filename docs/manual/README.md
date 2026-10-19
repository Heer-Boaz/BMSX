# BMSX manual authoring

The technical manuals specify the physical BMSX console. They must let an
experienced programmer new to BMSX write games, libraries and tools without
access to this repository. They are manufacturer documentation, not an account
of the emulator.

## Scope and authority

- **Book I — System and Hardware Reference:** the installed machine, memory and
  hardware units.
- **Book II — BLua32 and BIOS Reference:** processor architecture, instruction
  set, BLua extensions and installed firmware interfaces.
- **Book III — Cartridge and Expansion Reference:** cartridge connections and
  mapped card devices.

The standard `docs/_quarto-book-*.yml` profiles own volume titles and chapter
order. `docs/_quarto-html.yml` combines them into the searchable HTML reference.
Source-directory names do not determine book membership or product ownership.

`docs/architecture.md` describes internal software ownership only. It is not a
hardware or BIOS source. Verify product facts against mirrored numeric leaves,
actual TS/C++ owners, BIOS consumers and, for language/linkage, the BLua frontend.
Tests check reached behavior and numerical examples. Report conflicting evidence
rather than automatically choosing architecture prose or one implementation.
Do not document suspected bugs as permanent hardware guarantees.

`cartlib`, packers, asset converters and project builders are independent game
studio software, not console hardware, BIOS or a manufacturer SDK. Their APIs,
formats and workflows do not belong in the books. Document actual consumed
hardware/BIOS representations so that independent producers can implement them.
Repository workflows belong in the separate [development companion](../programming/getting-started.md).

## Writing and reviewing

Write English for an experienced programmer who is new to BMSX. Build the
concepts needed to understand the interface: what result the programmer wants,
which operation produces it, and how its operands and settings are represented.
Explain the meaning and units of a quantity before introducing its packed words
or bit fields. Carry a small example through the explanation, figure, calculation
and register sequence using the same names and values.

Choose the exposition for the reading task rather than imposing one chapter
template. A system overview gives a map of the units, memories and connections.
Geometry explanation starts with spatial relationships and follows their
calculation into programmable parameters. An operating procedure explains a
concrete situation and the guarantee required before showing where the command
belongs. A register or command entry is independently usable: identify its
inputs, operation, results, affected state and timing, with a reference to the
conceptual explanation instead of repeating the lesson. A specific card device
can proceed directly from its purpose and essential conditions to its controls.
BIOS entries use signatures, arguments, units, results and errors.

Give each figure a definite explanatory job: a memory relationship, coordinate
change, selection decision or timing boundary. Text, diagrams and formulas
should explain the same operation, not require the reader to reconstruct their
relationship. Functional reasons for an interface belong in this explanation;
the history of its implementation does not.

Give register addresses, access, bit ranges, reset, encodings, write effects and
visibility edges. Include capacities, timing, transfer-route differences,
synchronization, faults and interrupts where defined. Do not invent electrical
ratings or latency. Explain relevant hazards without repeated defensive
negations, implementation comparisons or design rationale.

Treat a cartridge as a physical card. Distinguish its ROM byte contents, program
formats and optional writable devices. Do not call a program a “linked
cartridge”, describe bytes as installed storage or teach elementary
compiled-versus-interpreted distinctions. No source paths, emulator internals,
tests, development history or tool-specific requirements in public chapters.

Use compact real BLua register sequences, binary records and worked calculations
with necessary assumptions and expected results. Code explains the interface;
complete test programs and verification harnesses do not belong in the books.
Prioritize BMSX-specific language extensions and relevant BIOS, not general Lua
lessons. Use diagrams and actual output images when they clarify data paths,
transforms, memory layout or synchronization; not as decoration or test proof.

Complete known chapter work before its detailed review. Check factual accuracy,
authenticity, independence, explanation, relevance, product boundaries and
technical completeness. Recheck findings and affected interfaces, not every
unchanged chapter after a local correction. A successful render is not a source
review or a declaration that a manual is complete.

Historical manufacturer manuals inform exposition, never BMSX facts. SEGA's
[Saturn Overview](https://antime.kapsi.fi/sega/files/ST-103-R1-040194.pdf)
builds system orientation; Sony's
[Fall 1996 GTE seminar](https://psx.arthus.net/sdk/Psy-Q/DOCS/TRAINING/FALL96/gte.pdf)
connects spatial relationships to calculations; the
[MSX Technical Data Book](https://download.file-hunter.com/Manuals/msx_technical_data_book.pdf)
introduces the slot concept before specifying its interface. Use their different
explanation methods for the appropriate task, not their addresses or a common
chapter template.
`docs/book1_text.pdf` is a style example only, not an authoring source or attachment.

## Native document structure

Use ordinary Markdown with Quarto/Pandoc semantics:

- Headings have globally unique `{#sec-device-topic}` labels. Link to source
  chapters and those labels; use `@sec-device-topic` for numbered references.
- Tables are native pipe or grid tables, not raw HTML or space-aligned diagrams.
  Escape literal pipes even inside code. Use native `tbl-colwidths` when needed.
  Multiword bit layouts can use explicit Word/Bits/Field rows.
- Figures use normal SVG/PNG image syntax, meaningful alternative text and
  unique `{#fig-device-topic}` labels. Preserve numerical and visual accuracy.
- Code uses fenced `lua` or `text` blocks. Break overlong prose code spans at
  meaningful boundaries; do not shrink the entire book to fit one line.
- Do not add HTML print wrappers, raw anchors, custom filters or renderer hooks.
  Quarto and LuaLaTeX supply pagination, table continuation, contents, numbering,
  PDF bookmarks and link destinations.

Within a volume, native chapter/heading links work in HTML and PDF. Between
volumes, print references name the book, chapter and section; the combined HTML
can link directly. Use Quarto's standard conditional spans when both are needed:

```markdown
[[CPU programming model](../book1/cpu.md#sec-cpu-programming-model)]{.content-visible when-format="html"}[Book II, “CPU and BLua32 instruction reference”, under “Programming model”]{.content-visible when-format="pdf"}
```

Do not build a cross-PDF resolver or rewrite PDF objects afterward. The native
book index covers the chapters included in that volume.

## Publishing and retention

Install Quarto and its supported TinyTeX distribution; Linux also needs
`librsvg2-bin`, `fonts-liberation` and `fonts-dejavu-core`. Commands and output locations are in the
[root README](../../README.md#publishing-the-manuals). Run `quarto check` for the
installed toolchain. `npm run manual:build` renders all three PDFs into their
native working directories, copies the finished volumes to tracked `docs/pdf/`,
then renders HTML with those PDF downloads as native resources. The complete
publication is copied to untracked `dist/manual/`; commit the PDFs with their
source changes. `manual:html` and previews remain independent for fast HTML
authoring. Use normal render diagnostics and inspect affected output
for content loss, unreadable tables or illustrations, and bad page breaks.
There is no custom publication test suite or approval catalog. Hardware/BIOS
regression tests remain with their actual owners.

Content comes before final print polish. Keep extraction notes and migration
helpers temporary. Keep internal documents only for current, unique engineering
or operational value; delete completed plans, reports, handovers, frozen fact
sheets and duplicate specifications. Git and substantive commits retain history.
Do not replace removed bureaucracy with an archive or another Markdown tree.
