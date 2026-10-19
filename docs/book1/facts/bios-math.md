# BIOS math library: finite evidence index

## Current disposition — 2026-10-19

BH01 is repaired by `machine/bios/math/trig.lua` and the ordinary Math exports.
Radian inputs no longer pass through phase-word/Q16 conversion. The public
chapter and ordinary cartridge observations have been reconciled; O0/O3
regressions and finite TS/native execution pass, including signed-zero source
literals. The named `math/sin` phase primitive is unchanged. Updated chapter
source/print acceptance remains pending, not blocked on the former trig bug.
The earlier range/quantum and output observations below describe the old
implementation only. Table length, BZ01 and LS01 are independently repaired;
CPU7 and remaining firmware/whole-console questions remain open.

## Historical evidence index

2026-10-18, baseline `0fca01fd4`. The actual export table at
`machine/bios/math.lua:349–379` has twenty-five callables and four numeric
constants. This index records bounded source evidence, not whole-manual approval.
No architecture manuscript or historical reference PDF supplies a BMSX fact.

## Paragraph inputs

- [Elementary operations and constants](bios-math-elementary.md): twelve
  callables and four fields; actual BIOS bodies plus paired value, arithmetic,
  comparison, call, select and error owners. Runtime special-value deductions
  are separated from executed observations and mathematical accuracy claims.
- [Cartridge-call boundary](bios-math-call-boundary.md): one current static
  minimum-argument diagnostic route and the unconditional cart-source
  `math.floor` restriction. These are compiler/build policy, not guest call
  faults. Neither compiler nor policy was changed or suppressed.
- [Random numbers and seeding](bios-math-random.md): both state interfaces,
  advance-before-validation order, nil defaults, exact reached seed result
  count and captured versus live dependencies. Its independent
  [actual-source audit](../reviews/bios-math-random-source.md) closed the
  current-global `error` finding; default clock seeding and reset lifetime are
  not finite execution observations.
- [Eleven angle/transcendental interfaces](bios-math-transcendental.md):
  separately frozen actual BIOS/paired arithmetic, word and call boundaries;
  angular scales, phase lookup, approximations and variable normalization work.
  Its facts-only prose has an independent [actual-source audit](../reviews/bios-math-transcendental-source.md),
  including the closed canonical word-reference finding. Numerical range
  bounds are distinct from unspecified approximation-error guarantees.
- [Complete ordinary example](bios-math-example.md): all24 permitted callable
  entries and all4 constants, complete67+172-line source,84 retained assertions
  and24 separate ordinary diagnostics. This is finite TS execution, not an
  all-input, native, accuracy or statistical guarantee.

## Acceptance boundaries

The [elementary actual-source review](../reviews/bios-math-elementary-source.md)
covers the twelve elementary callables, four constants and cartridge-call
boundary. The initial ordinary snapshot exercised that portion with typed BSS,
forty-one retained assertions and thirteen separate ordinary diagnostics;
the complete-program evidence records the later84/24 stage separately.
It uses `// 1`, not an evasion of the `math.floor` restriction; that closure
was not executed. The independent [complete-program source comparison](../reviews/bios-math-program-source.md)
verifies the final239-line reconstruction, all24 ordered diagnostics and the
current artifact, separately from runtime observations. The fresh
[public-only reader](../reviews/bios-math-reader.md) also passes the complete
operation/reference and ordinary-project route after two editorial hazards
are clarified. The separate [actual-PDF review](../reviews/bios-math-print.md)
passes all22 canonical non-DRAFT pages, freshly viewed after normal gated
publication; the source index records the exact artifact and layout-only
identity. These source, reader, execution and print decisions remain separate.
Only the existing publisher and review representation were used.

Canonical CPU/Memory/base/protected-call chapters continue to own values,
operators, calls/results, typed storage and errors. CPU7, common Table length,
BZ01, LS01, whole SDK acceptance and whole-console newcomer acceptance remain
open; a finite Math programme does not resolve them.
