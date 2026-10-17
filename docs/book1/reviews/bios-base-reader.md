# BIOS base services: public-only newcomer review

## Scope and method

Reviewed `docs/book1/bios-base.md`, the relevant public CPU, Memory, protected-call/coroutine, SYSTEM and IRQ sections, and `carts/bios_base_manual/README.md` solely for assembly/build/observation instructions. Re-read the final public `assert` dependency and `select` conversion additions. No owner implementation, facts/reviews, compiler, cartridge implementation, test/timeline files, architecture document, historical or rendered PDF was read. No build or test was run. No repository file was edited.

This is a programming-usability review for an experienced programmer new to BMSX. It does not establish runtime factual accuracy, native/runtime parity, rendered pagination, or acceptance of other BIOS/manual chapters.

## Verdict: bounded acceptance

The chapter and its permitted companion instructions are sufficient to program the documented twelve base services and assemble and ordinarily observe the complete example without source reverse-engineering. The two previously identified public-contract ambiguities are now closed. No remaining missing programming step or contradiction requiring implementation inspection was found within this scope.

The listings provide 40 literal lines for `results.lua`, and 34 + 35 + 26 + 8 = 103 literal lines for `cart.lua`. Acceptance assumes the README's stated precondition of an installed BIOS and headless tooling artifacts; it is not a clean-machine installation guide or an executed-build claim.

## Original findings and closure

### 1. `select` Number-to-word conversion — closed

**Original location:** `docs/book1/bios-base.md`, `select(selector, ...)`, formerly lines 195-197.

The original wording permitted noninteger numeric selectors but stated only that they became a signed 32-bit register word. The public CPU rule at lines 574-578 expressly described bitwise inputs, leaving its application to `select` implied. A reader otherwise had to assume rounding, wrapping and nonfinite behavior to predict selectors such as 1.9, 4294967297 or NaN.

**Verified closure:** current `docs/book1/bios-base.md:211-213` explicitly states truncation toward zero, modulo-2^32 reduction, signed interpretation through bit 31, and zero for NaN/either infinity, before negative-offset calculation and filtering. No inference from bitwise implementation is now needed.

### 2. `assert` dependency capture versus mutable globals — closed

**Original location:** `docs/book1/bios-base.md`, introductory dependency promise and `assert(condition, ...)` subsection.

Other affected services named their live or captured dependencies, but `assert` did not say whether replacing public `error` or `select` changed its internal failure/argument-selection operations. This was an unresolved public-contract question, not a claim about its implementation.

**Verified closure:** current `docs/book1/bios-base.md:32` explicitly identifies captured error and argument-selection primitives and states that public `error`/`select` replacement does not replace them inside `assert`.

## Requirement coverage

- **Files, modules, type and manifest:** the chapter's program introduction/result-storage explanation and README lines 16-38 give the exact file tree, concatenation order, one entry declaration, `require('results')`/filename relationship, and complete manifest. Memory lines 858-863 explicitly demonstrate that a top-level struct from the storage module is visible to unqualified entry-module typed views without being returned in the runtime export table. The result address is returned separately and bound to a typed local view in the example.
- **All twelve names:** the chapter defines the installed no-import globals and individually covers assertion, raw equality, type names, text conversion, numeric conversion, stored-entry traversal, both iterator factories, argument selection, both live-global operations and output.
- **Language values versus byte storage:** CPU lines 393-401 and Memory lines 365-383 distinguish Number/value slots from raw words and typed storage. The example uses `f64` for numeric results, `word` for counts/relation observations, explicit 0/1 relations rather than a nil encoding, and zero-based typed arrays separately from ordinary Table keys.
- **Counts, nil and failure:** success tuples, explicit nil versus omitted assertion message, caught-error flags, zero-result `setglobal`/empty `select`, exhausted one-nil `next`, one-nil `print`, and fixed versus expanding result positions are explained. Memory lines 395-409 supply the concrete source-position adjustment rules; coroutines lines 31-50 explain nil error payloads and protected result layouts.
- **Numeric parser:** permitted whitespace/digits/signs, default decimal and prefixed hexadecimal forms, explicit-base prefix behavior, complete-input consumption, argument-check order, integer/range requirements, exact listed errors, ordered Number arithmetic and unbounded exponent-scaling risk are stated. It does not imply an ideal decimal conversion, finite-value rejection or bounded parser timing.
- **Iteration:** factory construction versus execution, three-value control triples, nil-only termination, false elements/keys, stored versus inherited indexing, sequence holes, no length-based count and no mutation-safe ordering guarantee are explicit. The next-continuation wording does not mistake an absent live mapping for an unrecognized continuation node.
- **Live globals and captures:** `getglobal`/`setglobal` are live ordinary-global operations, not local/upvalue access or system-global lookup. The affected mutable dependencies and captured dependencies are described, including the now-explicit `assert` captures. The owned counter example shows that protection does not undo writes. CPU lines 818-822 distinguish the two namespaces without treating namespace separation as a privilege boundary.
- **Ordinary observation versus a derived test:** README lines 42-57 distinguish the integration check from ordinary playback; lines 61-105 provide a complete observation timeline, exact host command, expected 17 diagnostic lines and the final parked state. The reader need not open the observation-input files to follow the printed procedure.
- **Text versus drawing:** the chapter's `print` subsection and SYSTEM lines 240-255 distinguish diagnostic publication, separate retained BIOS history and visible drawing. Neither printing nor flush is presented as a display-publication guarantee.

No new required gap was found on the final restricted re-read.
