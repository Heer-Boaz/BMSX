# BIOS Math: bounded source and execution review

2026-10-18, baseline `0fca01fd4` plus the working documentation/example slice.
**DRAFT: full chapter source, public-reader and print acceptance are pending.**
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
- The eleven transcendental/angle interfaces still need their frozen packet,
  facts-only prose and independent actual-source audit. Executing their chosen
  example inputs is not a substitute for this reference coverage.

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

The finite trigonometry contrast retains32766/65536 and32767/65536, rather
than an ideal one-half. Explicit-seed RNG replay distinguishes the already
consumed update at each bound rejection; false and nil take different actual
branches. None of these finite observations establishes a general numerical
error bound, termination bound, statistical quality, clock-seed entropy,
reset/persistence or fixed whole-call cycle budget.

Independent complete-program source comparison and public-only project/
observation reconstruction are separate pending passes. The exact manifest,
build/test/playback commands and endpoint live in the development companion
and cartridge README. Those setup instructions are not a complete SDK guide.

## Figures and print

There is no Math registerfile or visual output plate to manufacture. The
formula, source and observed-value tables still require source comparison and
actual-page inspection. No Math PDF has yet received independent visual
acceptance. Use the existing shared publisher and recorded review fields;
no new schema, framework, gate or helper layer is needed.

The accompanying BLua source chapter's known-call/explicit-nil delta has
separate actual-source and28-page DRAFT print evidence in its existing
[source](blua-programs-source.md) and [print](blua-programs-print.md) records.
Its LS01 publication stop remains open; Math work does not waive it.
