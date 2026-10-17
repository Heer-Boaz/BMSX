# CPU source audit and bounded execution record

The CPU manuscript is a **draft**, not an approved complete CPU specification.
Its supported-domain claims are checked separately from seven stopped paired-owner
contracts. The coverage record retains those open questions and publication
remains blocked. A bounded source pass, reader pass and clean PDF are not a
claim that those differences have disappeared or that Book I is finished.

## Method and scope

Separate extractors froze numeric/value, call/object and memory/control facts.
Three different section authors consumed only their assigned sheets; root
supplied independently frozen decode/charge/reset/installed-model facts, source
spellings and the actual example. Each section was then checked by a nonauthor
against actual mirrored owner/spec lines. The public-only newcomer reviewer
read no implementation or fact sheets; the print reviewer inspected actual PDF
pages. No architecture chapter or reference PDF supplied a BMSX fact.

Structural production reference before this slice: MAME's
[MIPS instruction execution/fetch owner](https://github.com/mamedev/mame/blob/master/src/devices/cpu/mips/mips1.cpp)
was inspected only to separate fetch, interrupt acceptance, dispatch and base/
extra charging in an instruction reference. No foreign address, instruction,
clock, behavior or API was imported. No runtime, compiler, BIOS, cartlib,
publisher, stylesheet or shared test-harness code was changed.

## Executed evidence

| Evidence | Actual result and scope |
|---|---|
| Ordinary cart validation | `npm run validate:toolchain:cart -- cpu_manual --debug` passes; artifact `6529e06daad31e63b3ceda76e6b1419a8a8efceb405735b012d265d4d6b4b844` |
| Retained-result integration | `npm run headless:test -- cpu_manual tests/carts/cpu_manual/cpu_manual_assert.lua` passes its named case and26 data assertions after completion; derived image, not native cart parity |
| Ordinary BIOS playback | Companion's exact `headless:tooling` timeline command passes and prints all three documented lines; not an artificial drawing claim |
| Bounded paired raw CPU programs | Twelve actual central-writer/test-ROM cases produce13 byte-equal expected TS/native rows: A64/A256, ignored prefix EXT, narrow/WIDE signed immediate, whole-WIDE skip, branch width, unsigned FFH displacement,2cycle-grant overshoot, counted stores0/1/4/5 |
| Existing TS CPU cases | Cycle-cost, mapped-execution, interrupt-state, superinstruction and save-state-replay suites:70 tests pass |
| Current native CPU targets | `bmsx_cpu_supervisor_tests` and `bmsx_cpu_save_state_replay_tests` freshly built with no rebuild needed; both executables exit0 |
| Existing manual pipeline | All17 tests pass; no new publisher branch, helper or validation layer |

The raw fixture first used an incorrect scratch RAM constant; the test input was
corrected to consume DYNAMIC_RAM_BASE from the central owner before the final
paired observation. The first native build request named an obsolete target;
only the two current configured targets above are claimed as built/run. No
runtime source was changed to turn either fixture mistake green.

Logs: `/tmp/bmsx-cpu-cart-build.log`, `-cart-test.log`,
`-public-ordinary-command.log`, `-probe-{ts,native}.log`, `-ts-tests.log`,
`-native-{build,supervisor,replay}.log`, `-final-manual-tests.log` under the same
`/tmp/bmsx-cpu` prefix. Reproducible public commands live in the cart companion;
raw probe inputs/results are frozen separately in `facts/cpu-replay.md`.

## Independent section audits

The following are the actual nonauthor audit reports, including findings caught
and rechecked. Original sentence quotations are historical findings, not current
accepted manuscript text. Internal source pointers and stopped contracts are
not printed in the public licensee chapter.


### Corrections found and closed

**Overbroad graphics exclusion in root opening:**

> “A word transferred to a device is an unsigned 32-bit numeric payload; it does not transfer an arbitrary CPU value or invoke a graphics operation by itself.”

The last clause is unsupported. Word stores reach address-selected IO callbacks:
TS `machine/ts/machine/memory/memory.ts:371–375,627–642`; native
`machine/cpp/machine/memory/memory.cpp:253–258,522–536`. The revision removes
that exclusion and delegates device addresses/payloads to the owning chapter.
The independent reviewer rechecked and closed it.

**Promised diagnostic output not displayed:**

> “Ordinary calls to the installed `print` global produce the three diagnostic lines shown below.”

The original section displayed the calls but not their output. The revision
adds all three actual output lines. Independent recheck confirms byte equality,
including tabs, with ordinary playback, plus literal equality of all printed
Lua to both real modules. This was a presentation omission, not a wrong result.

**Generated IRQ callback overgeneralized with exception callback:**

> “The generated IRQ and exception vectors call their bound callbacks, then perform RFE after the callback returns.”

The IRQ vector conditionally bypasses CALL on a zero FLAGS read:
`toolchain/ts/lua/compiler.ts:1638–1649`; the exception vector's CALL is
unconditional at1661–1665. The revision explicitly distinguishes both paths
and keeps RFE on the zero-FLAGS path. Final independent closure is recorded
below with the root-boundary review.

The public-only reader additionally requested explicit numeric NaN/infinity on
the integer-store/address conversion path. That clarification uses the existing
central word conversion (numeric sheet plus memory M01a); the reader rechecked
it and has no remaining missing-step finding. The source check is separate.

### Section coverage checked independently

- Numeric nonauthor: all 32 opcode/cost rows mechanically checked; actual
  mirrored dispatch, word/Number conversions, MOD/FLOORDIV, explicit POW cases,
  LEN, value text, comparisons and WIDE skip read. No mismatch in the bounded
  positive-count LOADNIL/in-range LOADKR contract.
- Memory/control nonauthor: all 13 opcodes, six kinds/alignment, actual address
  conversions, IO/readiness/preflight, ordered F64/sequence side effects,
  per-event fault sequence, branch basis, privilege/CP0/EXEC/RFE/HALT read.
  No mismatched supported-domain sentence or table cell found.
- Calls/object nonauthor: all 18 opcode/effect/cost rows plus actual frame entry,
  top/result placement, upvalue capture/closing, two namespaces, key-source/
  SELF order, actual table constructors/index boundaries and builtin charging
  read. Assembled section matches the audited prose after the documented
  duplicated top-column removal and raw-word wording correction.
- Program/source nonauthor: all 29 result-module lines and concatenated 64 entry
  lines are literal copies; every result-table cell matches its actual case;
  lexer/parser/operator lowering and actual diagnostic output read. No hidden
  Lua source, source function-address API or fictitious register-array interface
  is used. Source CP0 forms and real BIOS precedents read independently.

Detailed temporary nonauthor audit artifacts: `/tmp/bmsx-cpu-{numeric,memory,
calls}-source-audit.md`, `/tmp/bmsx-cpu-root-program-source-audit.md` and
`/tmp/bmsx-cpu-root-source-audit.md`. Persistent exact source locators remain
in the separate frozen sheets indexed by `facts/cpu.md`; the worklist and
coverage record retain the six stopped questions instead of hiding them as
safe defaults or calling them style issues.

### Final root-boundary closure

The nonauthor finished the current encoding/resources, full-width/fetch/skip/
lookahead, base/admission/overshoot/scheduler waits, actual reset/EXEC and BLua
control review against the exact mirrored ranges indexed in
`facts/cpu-boundaries.md`. The installed-model producer/consumer chain was read,
not assumed from an unused constant; 33,868,800 cycles/s,4 MiB actual RAM and the
separate 3.5 MiB language-allocation accounting distinction are supported. The
added NaN/infinity integer-path sentence was checked against central native
conversion and actual TS integer accesses. No new unsupported or mismatched
current sentence/table cell was found. The conditional-IRQ finding above was
independently rechecked and closed. Existing paired probe logs were independently
compared, not represented as a new rerun by that reviewer.

**Supported-domain source audit PASS.** No decorative figure was added for
nonvisual CPU computation; actual data/diagnostic output, code and field tables
supply the relevant explanatory material. Whole CPU publication is still
blocked by the six explicitly open owner contracts. The ordinary-route reader
pass and actual-PDF layout acceptance are separate reports, not a loophole
around those questions or whole-console acceptance.

The authors' unexpanded formatter, POW special-base, table-semantic and complete
library/environment dependencies are also retained as ordinary reference
coverage gaps, separate from the six paired-owner decisions. The bounded source
and reader passes do not close them or approve whole-CPU publication.

Final recorded-review check intentionally exits 1 with the ten precise coverage
entries above still open; it has no pending fact/figure/print review. It is not
reported as a successful publication. Final preview generation remains DRAFT,
and all 25 final page rasters are pixel-identical to the accepted visual review
(25 initial individual pages, revised 18–20 rechecked). No release PDF was forced.


## Value-reference expansion: independent review and execution

Current slice baseline5a5a26e15. Before authoring, the production Lua owners
[lobject.c](https://github.com/lua/lua/blob/master/lobject.c) and
[ltable.c](https://github.com/lua/lua/blob/master/ltable.c) were inspected only
as structural precedents for separating scalar conversion, key identity and
mutation ownership. No Lua behavior was imported into BMSX facts. Three fresh
facts-only authors wrote Number text, POW and Table paragraphs independently;
root integrated their separate maps and supplied the complete ordinary example.
Live cited paired owners and ordinary source descriptors were then audited by
nonauthors, separately from public-reader and actual-PDF review.

| Executed evidence | Actual bounded result |
|---|---|
| New ordinary cartridge build | validate:toolchain:cart cpu_values_manual --debug passes; artifact1242990b48df6932921df121eb4bc4bee7a54311b65d49c06e387cb25be08add |
| Retained-result integration | power_text_and_table_contracts passes68 assertions after completion; derived image, not native cartridge parity |
| Ordinary BIOS playback | Companion timeline command passes, prints18 indexed Number texts and two closing lines, completes frame4 timeline |
| Direct paired numeric owners |174 byte-equal rows:135 special-base POW grid,32 finite formatter inputs,7 limit/ordinary powers |
| Direct paired Table owners |30 rows:29 common, one generic cross-capacity refill difference; deliberately not a parity pass |
| Actual paired CPU SETT/LEN program | TS5,1,5 versus native5,1,4; both33 cycles, affected common contract stopped |
| Existing TS POW/Table cases |10 tests pass |
| Current native owners | bmsx_cpu_supervisor_tests and bmsx_table_inspection_tests exit0 after current build; no-work rebuild confirmed |
| Existing manual pipeline |17 tests pass; no publisher, stylesheet, harness or layout-check addition |

The initial source extension omitted rawset's value and setmetatable's second
argument. The actual ordinary-source build rejected those calls. Source now
passes explicit nil, and the printed final source was rebuilt and rerun. This
was a producer/signature fact to document, not a reason for a compatibility
wrapper, a compiler/runtime fix or inferred stock-Lua call syntax. One long
code expression was wrapped without a helper; literal source equality remains
checked independently.

Exact evidence and scope: cpu-number-format, cpu-pow-special,
cpu-table-semantics, cpu-table-bios, cpu-values-execution and cpu-values-example
fact sheets. Logs use /tmp/bmsx-cpu-values-* and the paired numeric/Table probe
paths recorded there. The new source audit covers the added text and program;
the earlier full instruction audit remains historical evidence for unchanged
material, not a claim to have rerun every instruction. All seven owner questions
and complete BIOS/protected-call/coroutine/environment coverage remain open.


### Nonauthor numeric source verdict

No failures found within the bounded source audit of the newly added POW and Default Number-to-text material in `docs/book1/cpu.md`, including the changed finite-Number conversion table row. Checked the added semantic claims against the frozen `cpu-number-format.md`, `cpu-pow-special.md`, and `cpu-values-execution.md` sheets and their live paired TypeScript/C++ POW, binary64-word, formatter, scalar conversion, and CONCAT/CONCATN owners. Special-case precedence, every special-base table cell, represented-exponent parity, signs, rounding subject and operation order, carry/notation thresholds, and the stated exact examples agree with the inspected evidence. These additions contain no new address, register-bit, reset, timing, or fault claims.

This is a bounded source review, not an exhaustive finite-input POW accuracy or TypeScript/C++ parity claim. No architecture document or PDF was opened; no repository/runtime files were edited and no new runtime execution was performed.


### Nonauthor Table/program source verdict

No failures found within the bounded source audit of the new Table entries/inherited reads section, second complete program and its complete retained-result tables, companion README/cart/tests, supplied Table/BIOS/execution fact sheets, and their live paired Table/value/CPU/BIOS/compiler-descriptor owners. The latest chapter Lua fences reproduce both cart modules literally. This is a source audit, not new execution, native cartridge parity, a full GC audit, or PDF review.
