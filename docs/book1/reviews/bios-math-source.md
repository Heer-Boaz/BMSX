# BIOS Math: bounded source and execution review

## Current software disposition — 2026-10-19

**BH01 is repaired.** `machine/bios/math/trig.lua` supplies the ordinary
binary64 radian functions; `math/sin` retains its separate phase-word/Q16
interface. Independent kernel/range-reduction review found no issue. O0/O3
regressions cover finite exponents, quadrants, NaN, infinities and signed zero,
including literal `-0.0`; finite native execution and complete TS/C++ runtime
save-state comparison pass at both levels. The fresh BIOS and ordinary Math
cartridge pass84 assertions; separate playback retains24 diagnostic lines,
with the two changed trig lines reconciled in the manuscript and cartridge.

The chapter source now describes the repaired interface. Its updated source
and print acceptance are pending; old acceptance/hashes below do not approve
this revision. Table length, LS01 and BZ01 are also repaired separately; CPU7
and other unresolved runtime/firmware questions are not closed by this work.

## Historical source and print evidence

2026-10-18, baseline `0fca01fd4` plus the working documentation/example slice.
**Finite source/claim, fresh public-reader and canonical actual-PDF print
passes; this is not whole-manual completion.**
The current software is the authority; this work changes no runtime, compiler,
BIOS, source-policy rule, publisher or shared harness. CPU7, common Table
length, BZ01 and LS01 remain separate open questions.

## Independent section inputs and audits

- Twelve elementary callables and four constants were extracted separately;
  a fresh author consumed only that frozen packet. The independent
  [actual-source audit](bios-math-elementary-source.md) covers those formulas,
  branches, results/counts, dependencies and finite work claims, plus the
  separate known-call minimum and cartridge `math.floor` source-policy note.
- The two random interfaces have their own frozen sheet, facts-only author
  and [actual-source audit](bios-math-random-source.md). That audit found an
  unqualified public `error` dependency; its independent narrow recheck closes
  the corrected qualification. Default clock seeding, reset/persistence and
  statistical guarantees were not inferred from the supplied-seed observations.
- The eleven angle/transcendental interfaces have a separately frozen actual
  BIOS/paired-datapath sheet and a fresh facts-only author. The independent
  [actual-source audit](bios-math-transcendental-source.md) checks every formula,
  branch, signature, dependency and work/range statement. It found a mistaken
  local word-definition reference; the explicit canonical CPU link closes it
  on independent recheck. The one-argument forms and formula-versus-literal-
  BLua clarification also have finite independent source acceptance.

Source extractors read the actual BIOS and necessary paired numeric, word,
call and result owners. No architecture manuscript or historical manual was
an author input. The production-reference prerequisite used CPython's
[Math reference organization](https://github.com/python/cpython/blob/main/Doc/library/math.rst)
and the official Lua repository's
[Math-test organization](https://github.com/lua/lua/blob/master/testes/math.lua)
for presentation and finite-test structure only. Their semantics, seed state,
expected results and language spellings are not BMSX facts.

## Complete ordinary cartridge, separately from reference acceptance

The [staged execution record](../facts/bios-math-example.md) identifies exact
source hashes and the final ordinary artifact. The real cartridge has complete
67-line typed storage and 172-line entry modules, reproduced in six public
listings; the entry is five consecutive chunks of one file. Its unchanged
full-quality build passes. A fresh derived TS integration target passes84
retained assertions; separate ordinary playback emits24 exact Math lines.
The tooling product was freshly built and both commands repeated, with all24
ordinary lines identical. These are separate executions, not native or
all-input/optimizer-wide proof.

The program invokes all24 Math functions other than the cartridge-forbidden
`math.floor` and reads all4 constants. It uses `//1` openly for unit flooring;
that does not execute or conceal the forbidden closure. The missing-parameter
observation uses `pcall(math.abs)`, not the statically rejected direct spelling.
No source policy was disabled, suppressed or repaired.

All twenty-five function entries and four numeric constants now have authored
reference coverage, separately from the finite program's observations. The
actual 257-word lookup proves the stated range/quantum and finite tangent-ratio
bounds, not an analytic approximation-error guarantee. The chapter does not
claim standalone reproduction of all private lookup words or uniform numerical
accuracy, correct rounding, native/optimizer-wide parity or total service time.

The finite trigonometry contrast retains32766/65536 and32767/65536, rather
than an ideal one-half. Explicit-seed RNG replay distinguishes the already
consumed update at each bound rejection; false and nil take different actual
branches. None of these finite observations establishes a general numerical
error bound, termination bound, statistical quality, clock-seed entropy,
reset/persistence or fixed whole-call cycle budget.

The independent [complete-program source comparison](bios-math-program-source.md)
passes for the final artifact:239 literal source lines, all24 ordered ordinary
diagnostics,84 assertions and separate captured execution evidence. Its final
addendum supersedes the historical171-line entry snapshot; the current entry
has172 lines. This is not an audit of all reference text or a new execution.
The fresh [public-only reader](bios-math-reader.md), started without inherited
owner/fact/review context, checked the whole chapter and linked public
foundations. The direct CPU word-operation reference and the explicit-nil/
pseudocode clarifications close its final editorial hazards on narrow reread.
It finds no remaining concrete operation-contract, route or source-assembly
blocker. This is public reconstructibility, not another source/execution or
PDF pass. The exact manifest, build/test/playback commands and endpoint live in
the development companion and cartridge README. Those setup instructions are
not a complete SDK guide.

## Figures and print

There is no Math registerfile or visual output plate to manufacture. The
formula, source and observed-value tables still require source comparison and
actual-page inspection. The independent [actual-PDF review](bios-math-print.md)
first found eight concrete detached-lead/widow problems across successive
previews. Eight uses of the existing keep-together markup close them without
changing technical text, source code, formulas, commands or observed output.
The final22-page preview passes; normal gated publication then produced the
canonical non-DRAFT PDF, SHA-256
`e8d40b6248edffc63a2410c6fe012c078f6dc13708fc053e1b3a3dd4ed55a569`.
All22 canonical pages were independently rasterized and freshly viewed in
full, with no retained-pixel or preview-pass shortcut. The correct Book II
running title, continuous numbering, removed DRAFT markings and all eight
fixes pass. This is visual print-surface evidence, not another semantic or
physical-printer proof. The existing shared publisher and review fields were
used; no schema, framework, gate, stylesheet or helper was added.

The accompanying BLua source chapter's known-call/explicit-nil delta has
separate actual-source and28-page DRAFT print evidence in its existing
[source](blua-programs-source.md) and [print](blua-programs-print.md) records.
Its LS01 publication stop remains open; Math work does not waive it.

## Current layout-only source identity

The corrected source reviewed independently is `e826c3084ad73f4a6bdea8462ddca5368dd66dfae15d146744a350b36dfeaac7`.
Current source `55f4f3d4b16b7af1278f76d6c216e3744ec94af97cdca90bcdecb7231982e890`
adds only eight existing keep-together groups for observed PDF splits. Removing
exactly those opening/closing markup strings reproduces the corrected-source
hash byte-for-byte. All239 public source lines still reconstruct the actual
two files byte-for-byte; no formula, output, operation, command or assertion
changed. This is a root identity check, not a new independent source audit or
visual approval. No CSS, renderer, publisher or new review gate was introduced.

## BH01: source accuracy is not numerical API acceptance — 2026-10-18

The existing manuscript, examples and source/print evidence are retained.
Publication is reopened only for ordinary trig precision and special-value
policy; the old source PASS does not approve every observed output as a
permanent API guarantee. Math's coverage record now carries that decision.

Two independent source readers distinguish the ordinary radians conversion
(`machine/bios/math.lua:100-120`) from the raw phase-word/Q16 primitive
(`machine/bios/math/sin.lua:43-63`). Actual in-memory central compiler/CPU
execution at O0/O3, independently repeated by root, returns `sin(1e-6)=0`,
`sin(1)=0.841461181640625`, `sin(+inf)=0`, `sin(NaN)=0`, and `sin(-0)=+0`.
These are current software observations, not whole-cartridge/native proof,
an accuracy specification or a decision to preserve those edge results.
Existing assertions of quantized/nonnumeric results likewise do not settle
the owning API's intended contract.

The separate decoder's selected exact 4/8-byte vectors preserve signed zero,
normal/subnormal values and the largest significand below two; no defect in
that used raw-word domain was established. Neither export/use nor a non-4
else branch approves arbitrary byte-count aliases. No BIOS/runtime/compiler,
cartlib, program, test or public prose changed; no guard, wrapper or fix was
inferred. Evidence: `/tmp/bmsx-bios-helper-design-audit-current.md`,
`/tmp/bmsx-bios-helper-api-root-recheck.log` and independent source review.
All 19 existing manual tests pass; `manual:check bios-math` now correctly
withholds publication for the two BH01 coverage items, not a print defect.
