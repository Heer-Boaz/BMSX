# Modular BLua cartridge — executed evidence

2026-10-18, baseline `fce16b952`; sources initially uncommitted. No runtime,
BIOS, compiler, publisher or test harness implementation changed. This evidence
concerns this program, not arbitrary module graphs or both language frontends.

## Frozen authored sources

| File | Complete lines | SHA-256 |
| --- | --- | --- |
| `carts/modules_manual/entry.lua` | 54 | `1d55b06d2353592e24f720169cb3241f79e284bc56778fe8111d4fe621ecca8b` |
| `carts/modules_manual/lib/counter.lua` | 10 | `d2e8e61b97043072875fc62ac0fa1ea412abc9d11d41adea4a999b74841cdadf` |
| `carts/modules_manual/lib/false_export.lua` | 7 | `3d74fa9b23cb32b6a84506f8ace05cdf0106541002d3f986b38643b8da879599` |
| `carts/modules_manual/lib/nil_export.lua` | 5 | `decacedea9e8608c1dfcb5df5d7b2cbf0a8dea3cddda2bc0fed9db1c93d89e6f` |
| `carts/modules_manual/lib/settings.lua` | 3 | `6419adb30de31b52facb3236e9c2f76de9e0473c75801c4c6bce0f57069c0079` |
| `carts/modules_manual/results.lua` | 28 | `01b22550030ccde5f57d1c5f87ccab8c02780190d5e757ad3325adc806e3550d` |

`carts/modules_manual/res/manifest/manifest.rommanifest` is the actual ROM
manifest. `tests/carts/modules_manual/modules_manual_assert.lua` contains 19
assertions after the completion wait. `ordinary_timeline.json` in that test
directory selects zero-based presentation offset 4; it is an observation
endpoint, not an assertion or startup/frame/cycle-time guarantee.

## Current commands and evidence

1. `npx tsx --tsconfig tsconfig.base.json --test tests/lua/module_export_lowering.test.ts tests/lua/preload_module.test.ts tests/lua/const_function_module.test.ts`
   passed 47 existing compiler/CPU fixture tests. This is not ordinary cartridge
   playback or proof of the new program. Log `/tmp/bmsx-language-module-baseline-tests.log`.
2. `npm run build:product:node-headless-tooling -- --debug` passed through the
   existing automatic build. Log `/tmp/bmsx-language-tooling-build.log`.
3. `npm run validate:toolchain:cart -- modules_manual --debug` finally passed
   full system/cart compilation and quality checks, published/exported artifact
   `2bcf2bb45aeb2a84fb3b6c1daff36241d9b2516343b6a4e2c557ee5f7464ded3`.
   Log `/tmp/bmsx-modules-cart-build.log`. The initial unpublished example had
   two explicit-Boolean-comparison and one getter-wrapper lint violations.
   The program was corrected, not the rules: test nonnil falsey exports and
   use a genuine state-changing operation with the global step. No suppression,
   fallback, new runtime helper or semantic change was introduced.
4. `npm run headless:test -- modules_manual tests/carts/modules_manual/modules_manual_assert.lua`
   passed `[test] modules_and_globals: passed`; 19 retained checks. This uses
   a fresh TS target with a derived integration image, not the ordinary ROM.
   Log `/tmp/bmsx-modules-guest-test.log`.
5. `npm run headless:tooling -- --debug --input-timeline tests/carts/modules_manual/ordinary_timeline.json modules_manual`
   separately ran the ordinary debug ROM and printed all five lines below.
   Log `/tmp/bmsx-modules-ordinary.log`. The BIOS boot banner is not a timing or
   capacity specification.

```text
Modules startup	1	1	1
Modules dependency	1
Modules sharing	1	16	32	1
Modules exports	1	1	1	1
Modules globals	1	2	99	36	4	5	46
```

## Bounded observed facts and authored locations

- All three ordinary constructor counts are 1 before entry import assignments:
  `entry.lua:7-10`, constructors in `lib/counter.lua:1-3`,
  `lib/false_export.lua:1-5`, `lib/nil_export.lua:1-3`.
- The false-export module observes its ordinary nil-export dependency already
  initialized: `lib/false_export.lua:1-5` and `entry.lua` dependency diagnostic.
- Two imports share the counter export/closure, and false/nil exports are not
  mistaken for uninitialized modules: import/observation expressions in
  `entry.lua:12-28`, with the two explicit-return modules above.
- The owned global starts nil on these fresh runs. Setting the global step to
  2 yields `10 + 3*2 = 16`; global 4 yields `16 + 4*4 = 32`. A caller block's
  local step 99 does not replace the global: the next operation gives 36, not
  131. Outside the block the global remains 4. After global 5 the last operation
  gives `36 + 2*5 = 46`. Actual operation `lib/counter.lua:5-8`, ordered entry
  writes/calls and retained checks prove these particular observations.
- The result record is 20 declared word fields including completion; it is typed
  byte storage, not a raw registerfile. Source `results.lua:3-24`; the canonical
  Memory declaration/layout/startup contracts supply representation semantics.

This is not native execution, all-optimization/all-graph coverage, constructor
fault recovery, SDK/fresh-OS acceptance or the separate BIOS runtime compiler.
Ordinary retained globals/module state must not be assumed cleared by a second
EXEC. Existing Table-length, CPU7 and BZ01 work remains open. Build quality rules
are not automatically grammar restrictions; their broader developer-companion
coverage remains a separate missing route.
