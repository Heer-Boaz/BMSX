# BIOS Math complete program: independent actual-source audit

2026-10-18. Baseline `0fca01fd4`. **Bounded PASS: no source mismatch found in the audited program and route.**

## Initial audited snapshot

Read only the public Math manuscript from `## Complete program: Math operations`
(onward; lines288–628 in this snapshot), the new Math route in the development
companion (lines784–850), and the ordinary cartridge README. The example facts
file was an index, not authority. Compared actual cartridge source, manifest,
suite and timeline, actual captured build/test/playback logs, and the actual
BIOS/numeric/word/call and harness owners needed to resolve the finite claims.
Did not read the earlier Math reference prose, `docs/architecture.md`, or any
historical PDF. No repository file was edited. No build, test or playback was
rerun by this reviewer; read-only byte comparisons, hashes and finite arithmetic
calculations are not a new runtime observation.

| Audited artifact | SHA-256 |
| --- | --- |
| `docs/book1/bios-math.md` | `04356fd02a1a76e2fe664f02b16351cbadb56280d58c8cda65f9472a33815471` |
| `docs/programming/getting-started.md` | `7e81e21e69f07f8762caed379a9e0eea1627b5a35591b9135947551b24e77346` |
| `carts/bios_math_manual/README.md` | `a512304cba21ae8565ecacdb0dc20032cfd617b0ceff60704c535222af2c5537` |
| `carts/bios_math_manual/results.lua` | `a091432b733f45e69cec539988c56a4a2d7ba95f0e9a6db569e77fdf50312c67` |
| `carts/bios_math_manual/entry.lua` | `f56e914491a785ffce8a1230a4724e372ff7db7ee1addcb301d8dafef9dce49e` |
| `carts/bios_math_manual/res/manifest/manifest.rommanifest` | `19bcf1e4198cbde65b66ab1ed75e9c626c2a9e87fba0d5abb17da72dd41f8e10` |
| `tests/carts/bios_math_manual/bios_math_manual_assert.lua` | `b7c5b689b2517a1876d1acdfd7e064a2f77324869dba3d351945113804dbbb61` |
| `tests/carts/bios_math_manual/ordinary_timeline.json` | `fedb07ee4194d1221469ecce9a00ca023f0671cc5ab1500ba9133b21723adf87` |
| Math program section after its H2 | `95ca5151eafaf0c7988b7ddc67b1de5dc17e007c659b5ec3a95d97281041f417` |
| Companion Math route after its H2 | `63facc7d2cccb1b18c1be0b0801ce8f81d863d81e6d187f33b015abf541e564f` |

The captured build's published artifact ID is
`55f584905d4323816a3b714e77f5c0092a8346359971f37ccc2038b20e5cb10f`
(`/tmp/bmsx-bios-math-build-all.log:8–30`). Its stored artifact metadata names the
same cartridge and records ROM digest
`c66675dd6434c44c3fbabef7ca87a39f54d67e6963758c6660c2a6586e2f76ea`,
which matches the current `dist/bios_math_manual.debug.rom` bytes. Its matching
system ROM digest is
`01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664`,
also matching current bytes. Artifact ID and individual ROM digest are distinct.

## Checked acceptance surface

- The public storage fence is byte-identical to all67 lines of `results.lua`.
  The five entry fences contain37,42,46,35 and11 lines. Concatenation is
  byte-identical to all171 lines of `entry.lua`:238 source lines in total,
  exactly one `module<entry>`, no omitted declarations or execution tail.
- The companion's complete YAML manifest and JSON timeline are byte-identical
  to their actual files. Its paths and README agree with the actual cartridge.
- Actual Math exports at `machine/bios/math.lua:349–379` expose25 callables and
  four constants. The entry invokes all24 callables except floor and reads all
  four constants. `math.floor` is not called or hidden behind an alias. The
  source-policy claim matches `scripts/lint/rules/lua_cart/forbidden_math_floor_pattern.ts:5–17`,
  its active visit in `scripts/rompacker/cart_lua_linter_runtime.ts:354–368`, and
  cart lint invocation at `scripts/rompacker/compile.ts:162–165`.
- The actual suite has84 `assert` statements (lines11–94), after the completion
  wait (lines8–10). The supplied final guest log ends in
  `[test] math_observations: passed` (line5). No log claim was promoted to a
  native execution or a universal numerical guarantee.
- All24 public diagnostic lines and all24 README diagnostic lines match the
  ordinary log's lines13–36 byte-for-byte, including tabs, text, order and
  rounding. Actual printing inserts tabs in `machine/bios/base.lua:265–274`;
  Number conversion is at `machine/ts/machine/cpu/value.ts:182–195` and
  `machine/ts/common/number_format.ts:77–100`. The finite f64 values remain
  separately asserted; printed text is not represented as an exact dump.
- The supplied elementary, classification, zero-sign and protected-error
  observations agree with the actual entry and retained assertions, and with
  `machine/bios/math.lua:27–90,281–313`. Missing forwarded `abs` argument is
  actually tested through `pcall(math.abs)`; no accepted direct `math.abs()`
  source expression is alleged.
- The specific LUT contrast is corroborated by suite lines51–52, ordinary
  line25 and actual `machine/bios/math.lua:3–10,92–120` plus the257-word table
  and interpolation at `machine/bios/math/sin.lua:2–36,43–64`. Independent finite
  arithmetic gives phases357913941/357913942, index85 in both, fractions
  1398101/1398102, base32651, delta348 and shifted contributions115/116:
 32766/65536 and32767/65536. This does not establish a general error bound.
- String sin/cos/tan inputs and `atan(1,false)` agree with suite lines73–76,
  ordinary line30 and actual math paths at `machine/bios/math.lua:27–32,100–120,162–184`.
  The cosine quarter offset is before its bitwise boundary; no idealized
  conversion or string parser was substituted. Paired boundaries were checked
  at `machine/ts/machine/cpu/{cpu.ts:2551–2604,value_slots.ts:128–130}` and
  `machine/cpp/machine/cpu/{cpu_dispatch.inl:171–267,value.h:132–148,199–229}`.
- Root, exponential and logarithm sample interpretations agree with actual
  math branches at `machine/bios/math.lua:123–145,195–279`, entry lines98–116,
  suite lines60–72, and ordinary lines27–29. The prose states selected
  observations, not library-wide exact accuracy, termination or cycle costs.
- The one-result supplied seed, replay, rejected-bound consumption and
  false/nil distinctions agree with `machine/bios/math.lua:316–347`, entry
  lines126–159 and suite lines77–90. Seed1's first five words independently
  reproduce1015568748,1586005467,2165703038,3027450565,217083232; seed0's first
  three reproduce1013904223,1196435762,3519870697. Bare/fallthrough source returns
  produce one nil via `toolchain/ts/lua/compiler.ts:4372–4377,5767–5770`, consumed
  directly by `machine/ts/machine/cpu/cpu.ts:2942–2951` and
  `machine/cpp/machine/cpu/cpu_dispatch.inl:506–513`.
- Retained checks and ordinary playback are correctly distinguished. The
  guest CLI builds a test image and creates its target from the derived layer
  (`scripts/bootrom/platforms/hostrunner/test_runner.ts:16–44`,
  `ide/testing/run.ts:31–45`); the ordinary log separately loads the cartridge
  and reaches timeline completion. Presentation offset4 is an endpoint rather
  than output checking, startup latency or a fixed cycle assertion, matching
  `scripts/bootrom/platforms/input_timeline.ts:75–95,124–157`.

## Limits

This PASS covers only the audited complete program, its companion route and
README at the hashes above. It is not acceptance of the rest of the Math
reference chapter, source-blind newcomer readability, print layout, native
execution, compiled optimizer behavior across inputs, universal numerical
accuracy/termination, RNG statistics, default-clock seed/reset/persistence,
runtime-parser behavior, all SDK policy, CPU7/Table/BZ01/LS01 closure or the
whole manual. Captured runtime evidence is finite and TS-only. Public wording
retains those limits. There are no mismatched sentences to quote within scope.

## Final print-driven source/presentation delta: narrow recheck

**Bounded PASS. This final addendum supersedes the historical snapshot's entry
counts, current public hashes and current artifact identity above.**

Only the `interval_error ==` comparison was split before its String literal.
Rejoining that whitespace boundary reproduces the earlier entry hash exactly.
The current public storage fence is byte-identical to results.lua67 lines; its
five entry fences are37+42+46+36+11 lines and concatenate byte-identically to
entry.lua172 lines:239 source lines total. No operation, value, diagnostic,
execution order or assertion changed.

The chapter now places two long error diagnostics in two ordered four-argument
table rows between its first20 and final2 output lines. Joining adjacent row
cells with tabs reproduces the exact same24 lines from the new and old ordinary
logs, including every literal character. README still prints all24 as a single
literal text block, also byte-identical to both logs. This is presentation only,
not changed `print` behavior.

Current SHA-256:

| File or section | SHA-256 |
| --- | --- |
| `docs/book1/bios-math.md` | `04356fd02a1a76e2fe664f02b16351cbadb56280d58c8cda65f9472a33815471` |
| `docs/programming/getting-started.md` | `392adb82eb675562da3cb8e368a4e25d887736dddf3f9b119fd36c9c398548a7` |
| `carts/bios_math_manual/README.md` | `a512304cba21ae8565ecacdb0dc20032cfd617b0ceff60704c535222af2c5537` |
| `carts/bios_math_manual/entry.lua` | `c7b4600609c30a48c24339818f493d33660c41ef3a58bfa30765caa58666b82e` |
| Math program section after its H2 | `95ca5151eafaf0c7988b7ddc67b1de5dc17e007c659b5ec3a95d97281041f417` |

`/tmp/bmsx-bios-math-build-layout.log` records the full quality/build stages and
artifact`73cd790d03b4db17ad32f50bb79dfc8841ade31793abfa79600a5cfb20afe7d2`.
Its stored metadata records cartridge digest
`b425d49300055faa6f9ebfb92eebf10834ee6f7b3bddbaad7f1da94230900881`,
matching the current exported ROM. The matching BIOS digest is unchanged.
`/tmp/bmsx-bios-math-guest-layout.log` again ends in
`[test] math_observations: passed`; the unchanged suite still has84 retained
assertions. `/tmp/bmsx-bios-math-ordinary-layout.log` independently contains the
unchanged24 diagnostics and timeline completion. This reviewer read those
captured results rather than rerunning them. No mismatched sentence found;
all original finite-scope limitations remain.
