# Numeric-loop ordinary program — current executed evidence

2026-10-18, baseline `e43ee94f1` plus this ordinary example. No runtime, BIOS,
compiler, publisher or shared test harness implementation changed. No foreign
Lua semantics or architecture manuscript supplies the expected behavior.

## Exact source snapshot

| File | Complete lines | SHA-256 |
| --- | --- | --- |
| `carts/loops_manual/results.lua` | 25 | `c334c00a38d8d14daa3a75b28eba0f7f75a558de5fe97437dc161352bfbc1b7b` |
| `carts/loops_manual/entry.lua` | 76 | `160567daf9eb176efb5d35533fb2a88a980de0c126d466664a7294e6b6248f79` |

The seventeen-word typed BSS record includes completion. Seven finite numeric
loops produce six diagnostic groups; forward/reverse mutations share one line.
The zero-step bodies that enter explicitly `break` after their chosen counts;
no timeout/fallback substitutes for completing a loop.

## Actual commands

- `npm run validate:toolchain:cart -- loops_manual --debug`: full existing
  system/cartridge build and quality rules passed; exported artifact
  `36ca627ddeef9c16f601f9519eceb58c34aa8f8d1a95093b4814f372d3d5287e`.
  Log `/tmp/bmsx-loops-manual-build.log`.
- `npm run headless:test -- loops_manual tests/carts/loops_manual/loops_manual_assert.lua`:
  `[test] numeric_loop_control: passed`, sixteen retained assertions after
  completion. Log `/tmp/bmsx-loops-manual-guest.log`. Fresh derived TS integration
  target, not byte-identical ordinary cartridge playback or native execution.
- `npm run headless:tooling -- --debug --input-timeline tests/carts/loops_manual/ordinary_timeline.json loops_manual`:
  separate ordinary TS debug playback produced all six lines below. Log
  `/tmp/bmsx-loops-manual-ordinary.log`. Frame4 is the selected zero-based
  presentation endpoint, not a latency assertion.
- `npm run build:product:node-headless-tooling -- --debug` also completed through
  the automatic existing builder with the host atlas up-to-date and the named
  tooling product emitted. Log `/tmp/bmsx-loop-tooling-build.log`. No owner
  source changed between the existing tool used for the runs and this build.

```text
Loops headers	3	4	10
Loops cached	4	10	0	7
Loops mutation	3	9	3	9
Loops zero-empty	0
Loops zero-fixed	3	9
Loops zero-equal	2	4
```

## Finite observations

- Three state-changing header calls supply start1, limit4, step1; four body
  visits sum10. The calls are not repeated per iteration.
- Reassigning the outer limit/step locals to0/7 does not replace the cached4/1;
  four visits still sum10, and the actual outer locals finish0/7.
- Body mutation uses the control variable itself: forward1,3,5 and reverse5,3,1,
  each three visits/sum9.
- Literal zero step with start1/limit3 skips the body. Start3/limit1 remains3
  through the three visits before the written break; equality2/2 remains2
  through two visits. No zero-step exception is observed in these cases.

These are actual finite O3 ordinary-source observations, not native execution,
all-Number/NaN/infinite termination or optimization coverage, clock/bandwidth,
constructor/reset/coroutine lifetime, separate BIOS runtime-parser behavior,
or full source-language acceptance. CPU7, Table length, BZ01 and the newly
identified repeat binder/compiler scope discrepancy remain separate work.

The pre-edit production reference inspection used CPython's compound-statement
reference and the official Lua loop test organization for structure only; none
of their loop semantics were copied into BMSX facts or expected results.
