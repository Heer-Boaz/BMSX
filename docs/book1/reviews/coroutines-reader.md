# Public-only newcomer review: protected calls and coroutines

## Result

**No programming-blocking omissions or contradictions found on the specified route.**

An experienced programmer new to BMSX can reconstruct the separate result-storage module and consecutive entry-module listings, then use the README's supplied build and ordinary-image launch commands without consulting implementation code. The public CPU/Memory material supplies the required language-value, result-adjustment, closure/capture, typed-storage, initialization, and module/type-visibility concepts.

The chapter gives usable contracts for all three protected-call globals and all eight coroutine functions. In particular, it distinguishes caller-side argument errors from returned failure tuples; `normal` from `running`; public `dead` from retained failure; failed-close reporting from a refusal to close; and yielded tuples from the arguments received by the suspended yield on the next resume. Nil positions, bare-return behavior, wrapper cleanup, handler restrictions, hardware exception boundaries, and non-total cycle charges are sufficiently explicit for this route.

## Acceptance boundary

This acceptance covers **the printed protected-call/coroutine cartridge programming route and the documented API contracts needed to write comparable ordinary BLua code**. It is not acceptance of the full BIOS API, the whole book, implementation conformance, unprinted edge-case execution, or hardware-fault recovery. No source, compiler, BIOS, cartridge implementation, test, architecture, PDF, or prior-review evidence was used to resolve a programming question. Build/launch commands were read but not executed. The actual SVG and its printed rendering were not inspected; only the chapter's caption/alt text were included.

## Public sections consulted

- `docs/book1/coroutines.md`: complete chapter.
- `docs/book1/cpu.md`: language values; truth; ordinary calls and result counts; captures; globals; Table and BIOS raw-access interface; reset; HALT and exception control.
- `docs/book1/memory.md`: static sections and startup; BIOS handoff; typed storage, arrays, structs and views; language values versus byte RAM; source argument/result adjustment; the public two-module example's type-visibility explanation.
- `docs/book1/irq.md`: CPU delivery, exception entry/return and waiting; public example module/file assembly instructions.
- `docs/book1/system.md`: retained fault words, faults and continuation, reset, diagnostic output.
- `carts/coroutines_manual/README.md`: supplied build/check and ordinary-image launch commands only as operational instructions, not as semantic evidence.

## Narrow recheck: corrected wrapper failure handling

Re-read only the current public chapter's coroutine contracts after the wrap correction. **No new newcomer programming ambiguity found.** The wrap subsection now states: “On a false resume result, the wrapped function raises the first error value returned by that resume instead of returning a false prefix.” It separately states: “This failed-state cleanup also applies if resume rejected an already failed thread. In that case the wrapper raises the rejection string, not the earlier retained body error.”

Together with the preceding resume and close contracts, this distinguishes the value raised from the retained failure being cleared. Resume's own rejection leaves the target unchanged; the wrapper's subsequent failed-state close is a separate action. The original bounded acceptance remains unchanged. No implementation evidence or repository edits were involved in this recheck.

## Narrow recheck: public cartridge assembly instructions

Reviewed the README's added **Assemble the cartridge** section against the complete public chapter. **No inconsistency found.** The chapter has one result-storage listing and four consecutive entry listings; their `results` name, single `module<entry>` declaration, and continuation instructions agree with the README's `results.lua`/`cart.lua` assembly. The relative manifest location is unambiguous under `carts/coroutines_manual/`, and its three-line YAML supplies the stated ROM declaration without adding another cartridge module. The supplied test and observation timeline are explicitly separated from source modules and firmware imports.

This is a public-instruction consistency check, not independent validation of the manifest schema or build-tool behavior. No owners, implementation facts, or tests were consulted or executed.
