# Generic-iterator ordinary program — current executed evidence

2026-10-18, baseline `e43ee94f1` plus this example. No runtime, BIOS, compiler,
publisher, stylesheet or shared test harness implementation changed.

| File | Complete lines | SHA-256 |
| --- | --- | --- |
| `carts/iterators_manual/results.lua` | 19 | `5255144f80f0796ebe73a4e12ece34f1cde8b03800687e8a4d967dfc6f6a115e` |
| `carts/iterators_manual/entry.lua` | 44 | `2248acbfb66305328f9c54b41bcb2dbb0a29f01a1f541c2d46371cccf9e16ce7` |

Eleven word fields, including completion, form the typed BSS result. This is
not a register array or Table-length test. `context` is an ordinary Table with
one named counter field; the iterator is a real stateful ordinary closure.

## Actual commands and results

1. `npm run validate:toolchain:cart -- iterators_manual --debug` passed the
   existing full system/cart build and unchanged quality rules; artifact
   `15e638f1f6a3056eb722c64841dcb76206ef3d9ae4583213f7f013757705faa8`.
   Log `/tmp/bmsx-iterators-manual-build.log`.
2. `npm run headless:test -- iterators_manual tests/carts/iterators_manual/iterators_manual_assert.lua`
   passed `[test] generic_iteration_control: passed`, ten retained assertions
   after completion. Log `/tmp/bmsx-iterators-manual-guest.log`. This is a fresh
   derived TS integration target, not ordinary ROM playback or native proof.
3. `npm run headless:tooling -- --debug --input-timeline tests/carts/iterators_manual/ordinary_timeline.json iterators_manual`
   separately ran the ordinary TS debug cartridge and emitted all three lines:

```text
Iter calls	3	2	30
Iter controls	0	1	2
Iter values	1	2	198	999
```

Log `/tmp/bmsx-iterators-manual-ordinary.log`. The zero-based presentation offset4
is an endpoint, not a latency guarantee or output assertion.

## Finite observed meaning

- Three iterator calls produce two body visits; payloads10+20 sum30. First
  result false does not stop; nil on call3 does, despite returned payload999.
- Recorded call controls are Number0, False (the nonnil-false flag is1),
  Number2. Body writes key99 twice, observed sum198, do not replace the hidden
  control delivered to the next call.
- Three loop variables request three results from each call. The iterator's
  two supplied results leave the third nil on both body visits, count2.
- The iterator explicitly records terminal payload999 before returning nil,999;
  that reached marker and body sum30 are separate observed facts.

No native execution, all-input/iterator/fault, optimizer-wide, clock/bandwidth,
Table-length, lifetime/reset or separate BIOS runtime-parser guarantee is
claimed. CPU7, Table length, BZ01 and repeat-scope LS01 remain open. Source and
public-reader/PDF audits are separate; this executed record does not approve
its own prose.
