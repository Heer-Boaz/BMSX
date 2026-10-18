# BIOS Math ordinary program: staged execution evidence

2026-10-18, baseline `0fca01fd4`; no runtime, compiler, BIOS, linter, publisher or
shared harness implementation changed. This record distinguishes the initial
elementary snapshot from the later complete cartridge. Finite execution is
not full reference-coverage or source/reader/print acceptance.

## Initial elementary snapshot

- `results.lua`:42 lines, SHA-256
  `1198de6227c5b2822248f02c2ba827fad1efca8ec593de50d9ef7e8d49d09ce7`.
- `entry.lua`:90 lines, SHA-256
  `2d156c262f37dfcac83c53d2b59904576408815a2d016fa7fac447cf0c371f65`.
- Supplied suite:41 retained assertions after completion; snapshot SHA-256
  `e38700ccd27cfe97e0d7a954ece522313c655ed0145d5f9ba00c43f73c3ad015`.
- The exact initial sources remain at `/tmp/bmsx-bios-math-elementary-{entry,results,assert}.lua`
  while the full example is expanded. Final public source must be checked against
  its own later build/evidence, not inherited from this snapshot.

`npm run validate:toolchain:cart -- bios_math_manual --debug` passes the unchanged
full build/quality stages; artifact
`952c4f9a38dd6c75577741ec83756444036392a5cdfbacc61719be489fdd2b1f`.
Log `/tmp/bmsx-bios-math-build-elementary-final.log`.

`npm run headless:test -- bios_math_manual tests/carts/bios_math_manual/bios_math_manual_assert.lua`
passes `[test] math_observations: passed`; log `/tmp/bmsx-bios-math-guest-elementary.log`.
Fresh derived TS integration target; not byte-identical ordinary playback or native proof.

`npm run headless:tooling -- --debug --input-timeline tests/carts/bios_math_manual/ordinary_timeline.json bios_math_manual`
separately emits the thirteen tab-separated `Math ...` lines in
`/tmp/bmsx-bios-math-ordinary-elementary.log`. Frame4 is only the chosen zero-based
presentation endpoint, not an assertion or latency guarantee.

```text
Math rounding	12.5	1	2	-2	-1	2	-2
Math fractions	-1.5	0.5	-3	-0.75
Math selection	-3	8	1
Math supplied values	1	1	1	true
Math missing	true	nil
Math classification	9.0072e+15	1	1	1
Math unsigned	0	1	0
Math signs	-1	0	1
Math modf zero reciprocals	-inf	inf
Math zero signs	1	1	1	1	1	1	1
Math min error	false	min expects at least one argument.
Math max error	false	max expects at least one argument.
Math constants	-9.0072e+15	9.0072e+15	3.14159	inf
```

The Number constants and large tointeger observation retain their exact values
in f64 fields/assertions. Default printed text rounds them (`9.0072e+15`,
`3.14159`); it is not a full-precision dump. Reciprocal/flag observations
separately distinguish signed zeros from their ordinary printed spelling.

The source uses `//1` explicitly because cartridge policy rejects math.floor.
It does not execute that closure or conceal its name. Missing-parameter
behavior is observed through pcall(math.abs), not an accepted direct math.abs()
source call. See [call-boundary facts](bios-math-call-boundary.md) for the actual
static/compiler/policy distinctions; no rules were repaired, disabled or evaded.

CPU7, Table length, BZ01 and LS01 remain open. No all-input/optimizer/native,
transcendental/RNG, runtime-parser, SDK or whole-console claim follows.

## Complete ordinary source snapshot

The final entry invokes all24 installed Math callables other than the
cart-forbidden math.floor, reads all4 constant fields, and explicitly uses
//1 for unit flooring. The full ordinary source is results.lua67
lines plus entry.lua172 lines. No runtime/compiler/BIOS/linter/publisher
repair or rule suppression occurred.

| File | SHA-256 |
| --- | --- |
| carts/bios_math_manual/results.lua | `a091432b733f45e69cec539988c56a4a2d7ba95f0e9a6db569e77fdf50312c67` |
| carts/bios_math_manual/entry.lua | `c7b4600609c30a48c24339818f493d33660c41ef3a58bfa30765caa58666b82e` |
| tests/carts/bios_math_manual/bios_math_manual_assert.lua | `b7c5b689b2517a1876d1acdfd7e064a2f77324869dba3d351945113804dbbb61` |

- Full unchanged-quality build passes; artifact55f584905d4323816a3b714e77f5c0092a8346359971f37ccc2038b20e5cb10f. Log /tmp/bmsx-bios-math-build-all.log.
- Full retained suite passes84 assertions after completion, from the fresh
  derived TS target. Log /tmp/bmsx-bios-math-guest-all-final.log.
- Separate ordinary playback emits all24 lines below; log
  /tmp/bmsx-bios-math-ordinary-all.log. No native/optimizer-wide/statistical or
  global numerical accuracy guarantee follows.
- The public tooling build command was subsequently run successfully with
  current unchanged owners: log /tmp/bmsx-bios-math-tooling-build.log. Both
  supplied-suite and ordinary commands were rerun against that fresh tooling;
  the suite again passes and all24 ordinary Math lines are identical. Logs
  /tmp/bmsx-bios-math-guest-fresh-tooling.log and
  /tmp/bmsx-bios-math-ordinary-fresh-tooling.log. No cartridge source changed.

### Actual print-width correction and current final artifact

The initial publisher check identified two real overflows: the tab-expanded
long error comparison in entry, and the literal long diagnostic lines.
The comparison now wraps before its literal onto two source lines; no token
or expression order changes. Entry therefore has172 lines (the prior complete
snapshot had171), and its fourth public chunk has36 rather than35 lines. The
two long diagnostic lines are rendered as two ordered print-argument rows,
not truncated, reduced in type size or changed at runtime.

The full quality build and both executions were repeated after this source
layout change. Current artifact
`73cd790d03b4db17ad32f50bb79dfc8841ade31793abfa79600a5cfb20afe7d2`;
logs /tmp/bmsx-bios-math-build-layout.log,
/tmp/bmsx-bios-math-guest-layout.log and
/tmp/bmsx-bios-math-ordinary-layout.log. All84 assertions pass and all24
ordinary lines are identical to the previous complete snapshot. The source
hash table above describes this final source; earlier artifact hashes retain
their chronological scope. Mechanical preview now passes; that is not visual
or source acceptance. No CSS, renderer or publisher implementation changed.

```text
Math rounding	12.5	1	2	-2	-1	2	-2
Math fractions	-1.5	0.5	-3	-0.75
Math selection	-3	8	1
Math supplied values	1	1	1	true
Math missing	true	nil
Math classification	9.0072e+15	1	1	1
Math unsigned	0	1	0
Math signs	-1	0	1
Math modf zero reciprocals	-inf	inf
Math zero signs	1	1	1	1	1	1	1
Math min error	false	min expects at least one argument.
Math max error	false	max expects at least one argument.
Math trigonometry	0	1	0	0.499969	0.499985	1
Math angles	3.14159	180	0.785398	2.35619	1.5708	0
Math root	3	1	true
Math exponentials	1	2.71828	0.367879	inf	0
Math logarithms	0	3	2	-inf	true
Math nonnumeric angles	0	0	0	1.5708
Math random modes	1	0.236456	3	0	8
Math random replay	1	0.236456	true
Math random error	false	random upper bound must be positive.	0.504242
Math random interval error	false	random upper bound must be greater than or equal to lower bound.	0.0505436
Math random false	0.236068	true	0.819534
Math constants	-9.0072e+15	9.0072e+15	3.14159	inf
```

The first full-suite draft incorrectly expected32767/65536 for sin(rad30).
Actual execution rejected that hypothesis; the actual-source trace below
explains32766/65536. Only the expectation was corrected, not the BIOS.
The separate ordinary artifact source is unchanged by that fixture correction.

### Specific phase/LUT contrast, not an accuracy bound

Sources: rad/sin/cos at machine/bios/math.lua:92-108, constants:3-10;
actual257-word ROM LUT machine/bios/math/sin.lua:2-36 (index85=32651,
index86=32999), phase/interpolation at:43-64.

| Reached stage | sin(rad30) | cos(rad60) |
| --- | ---: | ---: |
| Scaled angle before truncation |357913941.3333333|715827882.6666666|
| Integer angle including cosine quarter offset |357913941|1789569706|
| Quadrant |0|1|
| Phase after odd-quadrant reflection |357913941|357913942|
| LUT index |85|85|
| Interval fraction |1398101|1398102|
| Base, delta |32651,348|32651,348|
| Shifted delta contribution |115|116|
| Integer sine result |32766|32767|
| Returned Number |0.499969482421875|0.4999847412109375|

This is a finite source-derived arithmetic trace corroborated by retained
assertions and ordinary rounded text, not proof of a universal error bound,
all-input parity or ideal mathematical sine/cosine. Nonnumeric sin/cos/tan
cases in the programme also yield0/0/0: the cosine offset occurs before its
NaN-to-word boundary, whereas tan first converts its angle before quarter
offset. Those actual operations must not be rearranged into an ideal library.

### RNG sequence and errors

Source recurrence/bounds: machine/bios/math.lua:316-347. Under seed1 the
first5 updated words are1015568748,1586005467,2165703038,3027450565,217083232.
Initial samples produce unit first/2^32, one-bound3, two-bound0 and truncated
equal-bounds8. Reseeding1 returns one nil and repeats the first sample. The
first bound error then consumes word2; next unit is word3/2^32. The second
bound error consumes word4; next unit is word5/2^32. Explicit false seed
stores0; subsequent words1013904223,1196435762,3519870697 support the normal,
false-bound NaN and ignored-upper-when-lower-nil observations.
No clock-default seed, automatic reset/persistence or full-cycle distribution
was executed/validated by this programme.
