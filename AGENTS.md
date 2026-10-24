# Repository agent instructions

## Product specification and documentation boundaries

- The technical manuals are the authoritative product specification of the
  physical BMSX console: Book I covers system/hardware, Book II covers BLua32
  and BIOS, Book III covers cartridge/expansion interfaces. Start at
  `docs/index.md`, the `docs/_quarto-book-*.yml` chapter lists and
  `docs/book1/console.md`.
- `docs/architecture.md` describes internal software ownership and dependencies
  only. Never use it, remembered excerpts or historical handovers as hardware,
  instruction, ROM-format or public BIOS authority.
  Keep fix-specific behavior explanations and bug narratives in regression tests
  and commit notes, not in the architecture document.
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
- Build understanding before encoding: connect the desired result, the operation
  and its supplied parameters before packed words or bit fields. Use the form
  appropriate to the task (system map, geometric explanation, operating procedure
  or independent reference entry), not a universal chapter template. Keep names
  and example values consistent across prose, figures, equations and code.
- Keep the system overview at machine level: structure, resources, capabilities
  and the relationships between operations. Put complete procedures and encodings
  in their owning references. Book I owns physical memory mapping and bus access;
  Book II owns program-image records, startup and BIOS diagnostic interfaces.
  Summaries may explain a shared boundary without duplicating its full contract.
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
  Markdown tree. Report unresolved product disagreements explicitly; regression
  evidence belongs in hardware/BIOS tests and substantive commit notes.
- Publish with standard Quarto and LuaLaTeX. Book profiles own chapter order;
  native headings, tables, figures and references own document structure. Do not
  add a renderer, PDF postprocessor, approval catalog or test suite for standard
  publishing behavior. Keep hardware/BIOS fact checks separate from typesetting.

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

## UI test contracts

- UI/integration tests verify observable behavior, state transitions and
  ownership/lifetimes, not incidental labels, wording or pixel coordinates.
- Text-content or geometry assertions require a specific contract and an
  explicit reason. Exact producer/clipboard content can be a data-integrity
  contract; positions and dimensions can be the subject of a focused layout
  algorithm test. Neither is a default assertion strategy for a UI workflow.
- Do not replace weak label checks with arbitrary geometry checks, freeze the
  same details in a snapshot, or add production state/APIs solely for tests.
  Put each regression at its real behavioral or component owner; remove tests
  that prove no meaningful contract.

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

## Studio-backed development and debugging

- For external conversations asked to work through the live IDE/Studio, discover
  and call the native `studio_list_sessions` tool. Explicitly select the intended
  Studio session, open its tool context and read its runtime status before editing or
  executing anything.
  An empty session list is a real state, not permission to select another target.
  An embedded Studio assistant instead uses its already-bound domain tools and
  window context; it must not create an external client or another conversation.
- Configured MCP entries, a listening HTTP server, direct SDK/RPC calls and
  previous test results do not prove that this conversation has native tools.
  Missing or failing native tools block the requested Studio workflow: report
  the failure immediately. Do not silently substitute Playwright/key-chord
  automation, shell-driven MCP, a headless emulator, external source writes or
  another assistant conversation. A different workflow requires explicit user
  agreement.
- A real headless Studio is a native session, not a substitute emulator/test
  workflow. When the user requests a background Studio, create it explicitly
  through `studio_start_headless` from a completed workspace build, select that
  session and follow the same context/status workflow. Never open a foreground
  browser or capture desktop input as an implicit substitute. Source-edit rights
  and review approval are explicit capabilities, not inferred from host kind.
- Use `npm run codex:studio -- [--server <origin>] [-- <codex arguments>]` for a
  Studio-dependent CLI session; `-- resume <thread-id>` continues the same
  conversation. It requires the existing server's real native MCP connection.
  Ordinary Codex work and standalone Studio remain usable without that server.
  An already running client must use its supported configuration reload or
  restart/resume; repository changes cannot inject tools into an active turn.
- Once native tools are available, use the shared source/review/Save, build,
  debugger and runtime owners. Browser interaction may validate the visible UI,
  but screenshots are not a substitute for frame/history, actor or GTE/GPU
  observations. State precisely which surface was actually exercised.
