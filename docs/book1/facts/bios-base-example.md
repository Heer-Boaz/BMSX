# BIOS base-services program: frozen execution facts

2026-10-18. Baseline `24a37a1df`. Scope: ordinary teaching cartridge,
its existing-harness observation inputs, companion README and scratch program
prose. No runtime/compiler/BIOS/cartlib/tooling/publisher modifications. The
concurrent `.vscode/launch.json` and `.vscode/tasks.json` changes are untouched.

Structural reference inspected before implementation:
https://raw.githubusercontent.com/lua/lua/master/lbaselib.c (production Lua
base-library organization). No Lua behavior was imported into BMSX claims.

- BX01. Complete source is `carts/bios_base_manual/results.lua:1-40` and
  `carts/bios_base_manual/cart.lua:1-103`. First module owns typed BSS;
  entry imports its public root and uses an explicit typed view. Source
  `carts/bios_base_manual/results.lua:3-40` and `cart.lua:1-4`. No local ABI,
  register array, fixed-point conversion, wrapper facade or fake primitive.
  The manifest is `carts/bios_base_manual/res/manifest/manifest.rommanifest:1-3`.
- BX02. All 12 requested public globals occur as real calls: assert,
  rawequal, type, tostring, tonumber, next, pairs, ipairs, select, getglobal,
  setglobal and print. Source `carts/bios_base_manual/cart.lua:6-99`.
  BIOS alias installation is `machine/bios/base.lua:205-216`; ordinary
  assert/rawequal/tostring/tonumber/print/ipairs/pairs implementations are
  `machine/bios/base.lua:219-296`. Program does not rebind any builtin.
- BX03. `assert(0,'kept',nil,7)` yields the actual four values 0,kept,nil,7;
  retained first0/last7/count4/interior-nil-word1. Protected explicit nil
  message gives false,nil; omitted message gives false,assertion failed!.
  Source `carts/bios_base_manual/cart.lua:6-18`; owner
  `machine/bios/base.lua:219-227`. Retained checks
  `tests/carts/bios_base_manual/bios_base_manual_assert.lua:11-16` pass.
- BX04. Six conversions retain 12.5,-125,0.25,16,-5,35 from numeric
  passthrough, signed decimal exponent, leading fraction, default prefixed
  hex, explicit base2 and explicit base36 respectively. Rejected 12x gives
  nil; explicit base37 gives protected false and exact string
  `bad argument #2 to tonumber (base out of range)`.
  Source `carts/bios_base_manual/cart.lua:20-34`; owner public conversion
  `machine/bios/base.lua:240-262`, based parse `:67-100`, decimal parse
  `:102-203`. Retained checks `tests/carts/bios_base_manual/bios_base_manual_assert.lua:17-24` pass.
- BX05. Seven exact names are nil/boolean/number/string/table/function/thread.
  The actual running Thread is a language value. Object labels are exactly
  table/function/thread, not addresses. Source
  `carts/bios_base_manual/cart.lua:36-46`; owner
  `machine/ts/machine/cpu/value.ts:149-167,182-205`; tostring uses concatenation
  at `machine/bios/base.lua:235-237`. Both retained match words are1.
  No dynamic string is encoded into a raw word; relation words preserve
  the observed comparisons while source values remain language values.
- BX06. `rawequal(shared,shared)` is true; a separate same-content Table is
  false. Source `carts/bios_base_manual/cart.lua:36-37,47-49`; owner
  `machine/bios/base.lua:230-232`. Both retained observation words are1.
- BX07. Singleton next gives key4/value41. Advancing with key4 gives one nil
  result, not zero results. Source `carts/bios_base_manual/cart.lua:51-56`;
  owner `machine/ts/machine/cpu/cpu.ts:4173-4192` pushes one Nil on no found
  entry. Retained next_key4/next_value41/next_done_count1/next_done_nil1.
- BX08. Named-key inventory traversal gives count3/sum66 without any
  expectation on hash order. Source `carts/bios_base_manual/cart.lua:57-62`;
  BIOS pairs produces next,target,nil at `machine/bios/base.lua:294-296`.
  Program does not use next-key order as public output.
- BX09. Ipairs visits quantities10/20 only: count2/sum30, retained slot4 is90
  despite nil at key3. Source `carts/bios_base_manual/cart.lua:63-69`; owner
  `machine/bios/base.lua:279-291`. No table-length operator is used anywhere
  in this program. No known table-length owner disagreement is crossed.
- BX10. Tuple skip,nil,9 has count3; suffix2 preserves nil,9 and count2;
  suffix4 is empty with count0. Source
  `carts/bios_base_manual/cart.lua:71-80`; owner
  `machine/ts/machine/cpu/cpu.ts:4286-4318` emits each selected slot in order.
  Retained first-nil-word1/last9/input-count3/suffix-count2/empty-count0.
- BX11. The uniquely named owned global is first set11 and read through its
  ordinary source name. Inside pcall ordinary assignment changes it22, then
  raises counter changed. Live getglobal still reads22 after false/error.
  Finally setglobal(name,nil) clears its value; subsequent getglobal is nil.
  Source `carts/bios_base_manual/cart.lua:82-95`; direct global-slot owners
  `machine/ts/machine/cpu/cpu.ts:3622-3639`. Retained values11/22 and
  error/cleared words1. No old public state is captured/restored; protection
  does not undo this observed write. No general transaction claim is made.
- BX12. Print tuple nil,7 emits actual tab-separated arguments. Expanding
  that real print call inside select records exactly one result, the ordinary
  function's fallthrough nil. Source `carts/bios_base_manual/cart.lua:97-99`;
  print owner `machine/bios/base.lua:265-275`; default return producer
  `toolchain/ts/lua/compiler.ts:5767-5771`. Actual line endings and tab output
  follow console at `machine/bios/tty/console.lua:19-55`.
- BX13. Completion is1 and entry remains in halt_until_irq, not a return to
  the launcher. Source `carts/bios_base_manual/cart.lua:100-103`. Timeline
  `tests/carts/bios_base_manual/ordinary_timeline.json:1-6` ends at presentation
  frame4. Separate actual ordinary playback completed normally and emitted
  the17 exact cartridge lines in `carts/bios_base_manual/README.md:83-99`
  after startup banner. Frame4 is the observation endpoint, not boot latency,
  performance, CPU budget, or native-runtime evidence.
- BX14. Retained case `base_service_observations` uses the existing integration
  harness. Source `tests/carts/bios_base_manual/bios_base_manual_assert.lua:1-50`.
  It waits for completion (`:8-10`) then37 source assertions (`:11-47`) pass.
  Completion itself is the wait predicate, not an additional counted assert.
  Integration compilation adds the test to a derived image; source
  `toolchain/ts/rompack/test_cartridge.ts:156-183`. This does not claim native
  execution of the ordinary cartridge or exhaustive runtime behavior/parity.
- BX15. Scratch program `/tmp/bmsx-bios-base-program.md` reproduces every
  source line literally: results1-40, then cart1-34/35-69/70-95/96-103.
  Five Lua fences concatenate exactly to those two files. Its retained-result
  table covers all38 scalar slots including completion; all37 non-completion
  observations are asserted by the existing retained integration case. The
  exact17-line output is extracted from the ordinary log, not predicted.
  Assembly/tree/manifest and reproducible commands are in
  `carts/bios_base_manual/README.md:14-105`. The companion README prints the complete
  six-line ordinary host timeline; the licensee-facing chapter has no host
  commands, source-tree paths or test-harness procedure.

## Executed artifacts and commands

- `npm run validate:toolchain:cart -- bios_base_manual --debug`: successful,
  lint included, debug/O3, artifact
  `5d81c556352c901b2c6874317b55f2ca29df2ee9ecc4bdb008cb95965cb7c322`.
- Executed ordinary image `dist/bios_base_manual.debug.rom` SHA256
  `31ea25f5359c4f323bf841e0dddbbaf91f04840b33485805d17c531ca61cd51a`.
- Installed `dist/system/bmsx-bios.debug.rom` SHA256
  `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664`.
- Executed `dist/host_headless_tooling.debug.js` SHA256
  `a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470`.
- `npm run headless:test -- bios_base_manual tests/carts/bios_base_manual/bios_base_manual_assert.lua`:
  actual derived-image case passed37 retained assertions.
- `npm run headless:tooling -- --input-timeline tests/carts/bios_base_manual/ordinary_timeline.json bios_base_manual`:
  separate ordinary-image run exited0, timeline completed;17 cartridge lines.
- Artifact metadata with system/cart output digests is
  `.bmsx/builds/artifacts/5d81c556352c901b2c6874317b55f2ca29df2ee9ecc4bdb008cb95965cb7c322/artifact.json:1`.
- Logs `/tmp/bmsx-bios-base-cart-build.log`,
  `/tmp/bmsx-bios-base-cart-test.log`, `/tmp/bmsx-bios-base-ordinary.log`.

First build rejected staged local exports of assertion first/last and next
key/value. The final source stores those actual call results directly into
owning typed fields while receiving only transient nil/string values in locals.
No lint exemption, framework change or runtime repair was made. All subsequent
required build/execution commands passed. No source/observed owner disagreement
was encountered in the final program. Native parity and exhaustive combinations
are not claimed.

Supplemental instruction check: `npm run headless:game -- bios_base_manual`
with its existing product/default options exited0 on its reported 1000ms TTL
after the BIOS startup banner, before any cartridge diagnostic line. Log
`/tmp/bmsx-bios-base-player.log`. That command is NOT used as the manual's
reproduction path and is NOT counted as a passing cartridge observation. The
companion README instead prints the full existing-style host timeline and uses
the separately executed successful tooling command above. No product repair,
undemonstrated longer-TTL behavior, or stale-product diagnosis is claimed.

Publisher-layout follow-through: three original source lines were too wide in
the actual publication. Their statements now use ordinary continuation lines
(`carts/bios_base_manual/cart.lua:16-17,41-42,91-92`), not helpers or CSS changes.
The entry now has103 lines; results still40. All five Lua fences again reconstruct
the full modules literally. Full cart validation,37 retained assertions and
separate17-line ordinary playback were rerun successfully for the current
artifact/hash above; output is unchanged. No chapter file was edited here.
