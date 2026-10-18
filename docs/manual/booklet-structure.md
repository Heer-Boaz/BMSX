# Developer-manual series: organization review

2026-10-18; BMSX baseline `e21e2d5d9`. Editorial reference review and a concrete
working proposal, **not an implemented volume assignment or publication
approval**. Reference books supply document organization and presentation only.
They supply no BMSX address, encoding, capacity, timing or behavior. No
architecture document was used. Do not supply these PDFs to chapter authors.

## Finding

The present pairing of `BOOK I · HARDWARE REFERENCE` with **Protected calls and
coroutines** is a classification error, not a missing ornamental heading.
Moving the chapter later in the same undifferentiated hardware volume would
not fix it. Its subject is a software interface. Its existing chapter title
can remain; the containing volume and running title must describe that subject.

The originals do not prescribe one universal sequence of numbered volumes.
They distinguish device programming, processor instruction reference, software
libraries, general development guidance and end-user operation in different
ways. A book number is not evidence of a document's purpose. In particular,
the supplied MSX files are not five examples of one hardware-manual genre.

## What the actual exemplars show

Page references are **one-based physical PDF pages**, unless a printed folio
is explicitly identified. A contents entry establishes organization, not that
the whole referenced chapter was read. Original scans and later reworked
editions are distinguished below.

| Exemplar and inspected evidence | Organization and presentation evidence |
| --- | --- |
| `docs/examples/V9938-programmers-guide.pdf`: cover 1, editor's note 3, preface 5, contents 7–8, section openers 13 and 63 | A device-scoped technical/programming guide: access procedures, register functions, display modes, commands, sprites and special functions form six sections. Procedures and reference tables coexist. **The supplied edition was reworked in 2010/2011**; its exact typography and page-count footer are not evidence of untouched 1985 typesetting. |
| `docs/examples/z80cpu_um.pdf`: cover 1, contents 3–4, objectives/organization 15–16, openers 19/45/59/93, instruction entry 273 | ZiLOG's CPU user manual explicitly has four chapters. Architecture, hardware/software examples and systematic instruction reference coexist in a processor-scoped manual. Separate instruction/figure/table lists and consistent entry fields support lookup as well as sequential reading. Running identification names the document and current subject. |
| `docs/examples/HB-75 computer.pdf`: cover 1, contents 2/26, operation example 37 | Sony's HB-55P/75P/75B **consumer instruction manual**, not service documentation or a complete developer reference. Language blocks contain startup, connections, saving/loading programs, keyboard use and a short specification section. Its user-operation instructions are not a precedent for classifying BIOS APIs as hardware. |
| `docs/examples/s3527datasheetenglish.pdf`: 1, 6, 10, 23, 30, with heading survey | Yamaha component data sheet: features/pins/functions, register material, integration circuits and electrical/mechanical information. Product identification and subject headings organize the pages; no multi-book hierarchy is established. Do not invent comparable BMSX electrical ratings merely to copy this genre. |
| `docs/examples/z8400.pdf`: 1–3 and 16, with heading survey | SGS component data sheet with register/instruction summaries, timing and electrical/order information. Later PDF pages are scanned spreads; PDF page number is not a printed leaf number. Repeated product identification and continuation headings are not volume titles. |
| Nintendo [SNES Book I](https://archive.org/download/SNESDevManual/book1.pdf): contents 1–4; form 11 and preface 12. [Book II](https://archive.org/download/SNESDevManual/book2.pdf): cover/copyright 1–2, contents 3–4 | A broad development-manual set, not a verified hardware-only subtitle. The first book groups submission procedure and graphics/sound/processor material; the second groups expansion systems and accessories. Hardware-facing programming appears under historically broader terminology. The Book I scan starts at contents and lacks its cover/edition declaration; Book II copyright lists 1993/1994/1995. No body running-heading claim is made from front matter. |
| Sony [PlayStation Hardware](https://psx.arthus.net/sdk/Psy-Q/DOCS/Devrefs/Hardware.pdf), August 1998: contents 3–4; scope/series 5, printed v | Hardware overview and subsystem chapters are one named member of a larger developer-reference series. The series distinguishes hardware, operating-system material, library orientation and an API reference. The visible footer identifies the actual document. This is not a claim that this overview alone teaches all programming. |
| Sony [Run-Time Library Reference](https://psx.arthus.net/sdk/Psy-Q/DOCS/Devrefs/Libref.pdf), January 1999/release 4.4: contents 3, scope 5, series 6, entry 17/printed 1-9 | A separate software-reference volume groups entries by library. The inspected entry has a callable signature with parameter descriptions, explanation, returned result and related calls; its running identification is the software document, not the hardware volume. The hardware and library exemplars are different releases, not one asserted edition. |
| Nintendo [N64 Programming Manual](https://ultra64.ca/files/documentation/nintendo/Nintendo_64_Programming_Manual_NU6-06-0030-001G_HQ.pdf), mirror filename identifies NU6-06-0030-001G: contents 1–2/printed i–ii and 4/printed iv; original [general index](https://ultra64.ca/files/documentation/online-manuals/man/index.htm) and [function-reference home](https://ultra64.ca/files/documentation/online-manuals/man/n64man/home.html) | A general programming title supports setup, system overview and operating-system parts. Hardware and runtime software have separate chapters within the overview; a part is not another physical book. The original online collection separately exposes function-reference categories. Neither arrangement implies that every software topic belongs beneath a hardware-only running title. |

**NES/Famicom source gap:** no attributable original manufacturer developer
manual with inspectable title, contents and representative headings was
verified in this bounded search. Community documentation and old discussions
are not substitutes, nor proof that an original scan is unavailable today.
Do not claim a verified NES precedent or mark the all-exemplar comparison
complete on that basis. This does not invalidate the other primary evidence.

## Consequences for BMSX — editorial conclusions, not borrowed specifications

1. **Separate purpose before assigning numbers.** A technical overview answers
   what is installed and its stated capacities/formats/timing. Hardware
   programming explains data flow, registers, ordered programming, visibility,
   synchronization and faults. A language/BIOS reference defines source forms,
   calls, values, results and errors. A development guide explains making and
   inspecting a program. None replaces the others.
2. **Do not create an empty specifications volume for the Roman numeral.** The
   current manuscripts have per-device specifications but no complete global
   specification/orientation chapter. Put that reader function first in the
   hardware material; make it a separate physical volume only if its actual
   sourced contents justify one. This is a proposed editorial choice, not a
   rule established by a historical manual.
3. **Use real navigation, not decorative retro styling.** State each volume's
   scope, prerequisites and companion references. Identify the actual volume,
   chapter/subject and page consistently. Provide book-level contents and
   appropriate register/command/instruction/API lookup. This does not require
   a chapter-local contents list or a new publishing framework.
4. **Keep the teaching and reference routes.** Ordered procedures, complete
   BLua examples and actual output belong beside the operations they teach;
   uniform entry tables provide lookup. Hardware examples may call a real BIOS
   helper without turning the chapter into a general library reference. A
   software API may discuss an exception boundary without becoming a device.
5. **Preserve one technical source of truth.** Summaries and companion books
   point to canonical definitions rather than copying partial tables until
   they disagree. Source/owner review still proves every BMSX claim. Reference
   typography, C prototypes, foreign registers and historical terminology do
   not become BMSX language or hardware rules.

## Proposed working series and current chapter map

This is the recommended **working proposal**, not the current catalog state.
It chooses a specifications opening part rather than an unfilled standalone
specifications book. If a distinct specifications volume is later justified,
renumber the complete series consistently; do not mix the two schemes.

| Proposed volume/companion | Reader purpose and material |
| --- | --- |
| **Book I — System and Hardware Reference** | Begin with console orientation and a sourced whole-machine specification summary. Follow with CPU execution/ISA/control, memory/address/ownership and installed-unit operation/reference. Keep the per-device specifications and genuine programming examples. |
| **Book II — BLua32 and BIOS Reference** | Source-language/program model, values/calls/captures/storage syntax, protected calls/coroutines, installed BIOS libraries, loading/environments and actual exported firmware interfaces. This is the containing title for the current coroutine and BIOS chapters. |
| **Book III — Cartridge and Expansion Reference** | Separately scoped sockets, cartridges, cards and expansion-device protocols. Existing cartridge address windows/startup are not a complete reference for these devices. This material is still unwritten; the old provisional Book II label must not silently erase it. |
| **Getting started / development companion** | Keep the [existing first-build route](../programming/getting-started.md) separate from the installed-machine reference, with exact source/manifest/build/observation instructions. Extend its real installation/debugging coverage; do not rename a chapter list into a complete SDK guide. |

The [current catalog](catalog.json) inventory is **16 entries, all provisionally
Book I**, at the baseline above.
The content map is based on public chapter headings, not a fresh semantic audit:

| Current material | Proposed treatment |
| --- | --- |
| PCRTC, GTE, GPU, IRQ, DMA, APU, GEO, IMGDEC, INPUT, SYSTEM: ten primarily hardware chapters | Hardware volume, with the overview/specification route before detailed devices. Presence of BLua examples is not grounds for moving the device reference to software. |
| CPU and BLua32 instruction reference | Mixed. Preserve execution words, ISA, control and fault definitions with the processor reference. Explicitly assign source-language/value/call sections to the software reader route or canonical crossreferences. Do not move every CPU section wholesale based only on its filename. |
| Memory and program storage | Mixed. Preserve mapped windows, reservations, access/fault/shared-buffer contracts with hardware. Explicitly assign typed declarations and source/program-model teaching to the language route, retaining the hardware storage/ABI connection. Avoid duplicate address and lifetime rules. |
| BIOS base services, BIOS table library, BIOS String operations, Protected calls and coroutines: four software chapters | Software volume. Keep the factual chapter titles and protected-call material discoverable; do not classify the whole group as hardware. |
| Global specification summary; complete language/environment coverage; cartridge/expansion reference; full SDK onboarding/debugging | Remaining authored work, not completed books produced by changing labels. Existing unit facts, examples and partial setup instructions do not close these reader routes. |

The CPU and Memory partition is an explicit later editorial decision at section
level. This map authorizes neither a blind file move nor deletion of their
cross-domain foundations. Stable chapter identities and links must survive a
future reorganization.

## Applying the proposal

- The immediate defect is in the owning publication representation: every
  current catalog entry has the same book membership, while
  `scripts/manual/render.mjs:24,33` uses it for the document title and hardcodes
  `HARDWARE REFERENCE` for every running title. Correct membership and actual
  volume titles together when applying the selected map; do not hide the
  mismatch with per-chapter CSS, guessed labels or compatibility wrappers.
- Keep the existing publisher. Updating the central title/membership data does
  not call for another schema, validation framework, helper layer or review
  harness. Do not renumber everything before the section assignments and
  companion links have been checked.
- A changed running title is a changed printed artifact. Render affected
  chapters and inspect the affected pages; old PDF hashes do not approve new
  headers automatically. Classification approval and visual rendering are
  separate from factual accuracy and completeness.
- The technical overview still needs sourced authorship. Do not introduce
  physical/electrical claims because another component data sheet has them,
  or present conditional execution budgets as unspecified electrical ratings.

## Acceptance remains open

This review changes the next organization task; it does not finish the manual.
All seven runtime-owner questions, the common Table-length publication stop,
the separate BZ01 compiler question, remaining BIOS/environment and graphics
work, cartridge/expansion coverage and whole-console newcomer acceptance stay
open. Book I/II/III above are proposed assignments, not newly published volumes.
The NES primary-source comparison also remains unverified.


Independent bounded exemplar-source and current-content/reader-map reviews
found no remaining unsupported organization or inventory claim. Their scope is
the inspected source pages and current chapter categories above, not every
page of the exemplars, BMSX technical correctness, final volume adoption or
whole-manual completion. The NES limitation remains explicit.
