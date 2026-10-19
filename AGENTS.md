# Repository agent instructions

## Product specification and documentation boundaries

- The technical manuals are the authoritative product specification of the
  physical BMSX console: Book I covers system/hardware, Book II covers BLua32
  and BIOS, Book III covers cartridge/expansion interfaces. Start at
  `docs/manual/catalog.json` and `docs/book1/console.md`.
- `docs/architecture.md` describes internal software ownership and dependencies
  only. Never use it, remembered excerpts or historical handovers as hardware,
  instruction, ROM-format or public BIOS authority.
- Verify product facts against the relevant numeric specification leaves,
  actual TS/C++ owners and BIOS consumers (and the BLua frontend for
  language/linkage contracts). Report disagreements; do not assume
  architecture prose or one implementation settles the intended behavior.
- Hardware knowledge belongs in the manuals, not another internal spec mirror.
  Internal documents link to the relevant public chapter instead of copying
  register maps, formats, timing or public call contracts.
- Repository location does not determine product ownership. `cartlib`, packers,
  asset converters and project build tools are independent studio software,
  not BMSX hardware, BIOS or a manufacturer-mandated SDK.
- Write public chapters as self-contained manufacturer documentation for a
  cartridge programmer. Explain purpose and data flow, teach concise real
  programming sequences, then give complete reference details. No source paths,
  emulator internals, tests, history or tool-specific requirements in the books.
- A cartridge is a physical card, not a compiled or linked program. Distinguish
  the card's ROM/RAM/devices from program formats and byte contents. Explain
  execution formats where the interface requires them, not through elementary
  compiled-versus-interpreted lessons or repository-artifact descriptions.
- Complete known chapter content before its detailed review; evaluate
  authenticity, independence, explanation, relevance, product boundaries and
  technical completeness as well as factual accuracy. Content precedes print
  polishing. Use existing documentation/tooling; do not add status-file layers.
- Purge non-manual documents without current, unique engineering or operational
  value. Completed plans, handovers, review logs, frozen fact sheets and
  duplicate specifications belong in Git history, not an archive or replacement
  Markdown tree. Keep manual open questions/review evidence in the existing
  catalog; regression evidence belongs in tests and substantive commit notes.

## Implementation rules

- Before implementing anything, study best-practice reference implementations
  in serious production codebases on GitHub that match the problem domain.
  Example: IDE work -> VS Code, media player work -> VLC, fantasy
  console/emulator work -> MAME.
- Performance is mandatory. Do not introduce unnecessary allocations, GC
  churn, repeated work, redundant abstractions, duplicate validation, or
  defensive hot-path overhead.
- Follow professional codebase structure. Split responsibilities across files
  and modules the way mature apps do. Do not dump unrelated logic into one
  file.
- Before adding a new helper, first check whether an equivalent helper already
  exists. If not, decide whether it should be introduced as a general shared
  helper instead of a one-off local utility.
- No defensive-check clutter. Do not add redundant guard code, fallback junk,
  or speculative validation layers unless there is a real proven need.
- No ugly facade/host patterns. Do not add artificial wrapper layers that hide
  ownership, blur boundaries, or make control flow harder to follow.
- No useless `?? null` normalization.

## Architecture gates

- Never infer an implementation task from contextual documentation alone. Ask
  whether the requested output is an audit, plan, review, or implementation.
- Treat handover plans as hypotheses. Verify every proposed slice against the
  live owners and mirrored implementations before editing.
- A behavior-preserving move is forbidden when the moved code itself conflicts
  with the target architecture.
- Before mirrored-runtime edits, produce a TypeScript/C++ representation table
  and name every hot-path callsite.
- Guest-value classification must follow the guest/runtime representation.
  Host object identity, string-kind probes, and shape casts are not valid
  substitutes for a machine representation.
- Typechecks and unit tests prove neither architectural ownership nor hot-path
  performance.
- If the owner or representation is wrong, stop. Do not extract, wrap, rename,
  or relocate the bad code.
