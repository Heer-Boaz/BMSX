# BIOS math library: finite evidence index

2026-10-18, baseline `0fca01fd4`. The actual export table at
`machine/bios/math.lua:349–379` has twenty-five callables and four numeric
constants. This index is not a claim of completed coverage or publication.
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
- Eleven transcendental/angle interfaces have a separate source-extraction
  assignment; their sheet and prose are not yet accepted by this index.
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
was not executed. Actual-owner source audits, public-only reconstruction and
actual-page PDF inspection remain separate required work. Use the existing
publisher and review representation only.

Canonical CPU/Memory/base/protected-call chapters continue to own values,
operators, calls/results, typed storage and errors. CPU7, common Table length,
BZ01, LS01, whole SDK acceptance and whole-console newcomer acceptance remain
open; a finite Math programme does not resolve them.
