# BIOS table chapter: bounded newcomer reader review

## Scope and method

Reading-only review by an experienced developer new to BMSX. Conclusions use `docs/book1/bios-table.md`, `carts/bios_table_manual/README.md`, and the linked public CPU, Memory, BIOS-base, protected-calls/coroutines, SYSTEM and IRQ sections. No builds or tests were run. No cartridge implementation, owner/compiler source, spec, facts, reviews, supplied test/timeline files, architecture document or PDF was opened.

Scope limitation: an early filename-discovery `rg` used `cpu*`, `bios-base*` and `system*` globs and incidentally printed a few corresponding `*-outline.md` headings/task-summary lines, including the already-disclosed SETT disagreement. Subsequent reads used exact public chapter paths. No conclusion below relies on outline material.

This is not whole-manual acceptance, native/runtime-parity validation, or fresh SDK/dependency-install verification. The chapter remains DRAFT; the common Table-length contract is externally unresolved.

## Findings and closure

### 1. Original local prerequisite omission: closed in the current public README

The initial **Reproduce the build and retained-result check** precondition was:

> “From the repository root, with the installed BIOS and headless tooling artifacts available:”

That left a newcomer without the required commands to create those artifacts. The current same section instead says:

> “From the repository root, first build the installed BIOS and headless tooling, then validate the cartridge and run the retained-result check:”

It now lists `npm run build:product:node-headless-tooling -- --debug` and `npm run build:toolchain:bios -- --debug` before the cartridge-validation and retained-check commands. The missing local artifact-build step is therefore closed on the public reading path. This review does not assert that those commands executed successfully.

### 2. Shared length behavior: still externally unresolved, not a local reproduction fix

The chapter's **Tables, lengths and visible effects** delegates the definition:

> “CPU and BLua32 instruction reference defines the maintained length and Table operations.”

The public CPU **Stored length** section explicitly limits that definition:

> “Cross-capacity length transitions remain incomplete in this reference.”

For its delete/refill example it further says:

> “No common result is specified here.”

Consequently a newcomer cannot derive one cross-runtime result for every sparse/cross-capacity edit followed by a default-length table operation. This is a genuine unresolved public contract, not something this chapter's small example proves or this review can resolve. The companion README already disclaims that its observations settle the disagreement. No owner/source inspection was used to choose a result.

## Required reader tasks checked

No additional chapter-local missing or ambiguous required step was found for the following bounded tasks:

- **All six APIs and exact successful result counts.** The interface table distinguishes one Table, one String, one nil, one possibly-nil removed value, and the variable/zero-result `unpack` tuple. `pack` explicitly retains supplied nil positions in `n`; the explicit `packed.n` recipe and final-argument `select('#', ...)` distinguish trailing nils from zero results.
- **Argument choice.** `insert` specifies trailing-argument-count dispatch, lone nil append, positional nil, ignored excess arguments, and the direct-signature versus indirect missing-slot distinction. `remove`, range bounds, separator and comparator specify omitted/explicit nil behavior. The linked Memory result-adjustment rules explain expansion and fixed-size assignment.
- **Normalized ranges and odd positions.** The range table specifies flooring, negative/zero/NaN normalization, numeric-looking Strings, lack of clamping and empty intervals. Insert/remove separately specify actual zero/negative keys, write direction, gaps, removal beyond `L`, and the unconditional tail clear. Large/nonfinite and NaN noncompletion hazards are stated rather than hidden behind normal-completion promises.
- **Reads, callbacks, errors and partial effects.** Public text distinguishes own/inherited reads, direct writes, deletion exposing inheritance, live `select`/`tostring`, separator-conversion ordering, first comparator result/truthiness, strict ordering, callback mutation hazards, sequential swaps and retained writes. The caught error object's identity and exact bounded partial-sort example are explained without promising a general visit schedule. The linked protected-call and SYSTEM sections separate language interception from hardware faults.
- **Complete module assembly without source inspection.** The public Result storage block contains 31 source lines; the three Entry blocks contain 19, 26 and 28 lines, concatenating to 73. The README explicitly names `results.lua`, `cart.lua`, their directory tree, the one entry declaration, `require('results')`, and the complete ROM manifest. Memory explains BSS zeroing, cross-module struct names and zero-based typed views. No hidden source module is needed on this documented assembly path.
- **Observation recipe and expected results.** The README provides artifact-build commands, cartridge validation, a separately labelled derived retained-result check, the entire ordinary timeline JSON, and the ordinary headless command. The chapter names every retained field and supplies all fourteen diagnostic lines; tabs and the empty argument are explicit. The README explains that completion remains in HALT and frame 4 ends host observation rather than promising boot timing.

## Verdict

For an otherwise working repository development environment, the current public chapter plus companion README leave **no remaining local API-use, source-assembly or ordinary-observation instruction gap identified by this bounded reading review**. The two modules are textually reconstructible from the public listings alone. Actual build/run success was not independently observed here. The unresolved shared length contract, native execution, arbitrary-input bounds and whole-manual acceptance remain outside that conclusion.
