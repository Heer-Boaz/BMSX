# BLua generic iteration: false is not nil

Two complete files form this cartridge: `results.lua` owns typed BSS;
`entry.lua` defines the iterator and its state, then requests three loop values.
It uses no Table-length operation, guessed RAM address or replacement library.

From the repository root with the existing development prerequisites:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run validate:toolchain:cart -- iterators_manual --debug
npm run headless:test -- iterators_manual tests/carts/iterators_manual/iterators_manual_assert.lua
```

Expect `[test] generic_iteration_control: passed`. Ten assertions inspect the
retained observations after completion. This is a fresh derived integration
image, not byte-identical ordinary playback. Linked addresses may differ; the
builder selects the matching BIOS.

For separate ordinary playback:

```sh
npm run headless:tooling -- --debug --input-timeline tests/carts/iterators_manual/ordinary_timeline.json iterators_manual
```

Compare these three lines; `print` separates arguments with tabs:

```text
Iter calls	3	2	30
Iter controls	0	1	2
Iter values	1	2	198	999
```

The first `false` result permits a body visit; the final `nil` stops before a
visit. The iterator receives controls 0, false, 2, even though the body changes
the first visible variable to 99. Two supplied results fill three requested
variables, so the third is nil on both visits. The final payload 999 is returned
with nil and does not enter the body's sum 30.

The timeline chooses zero-based presentation offset 4, not an assertion or
startup/frame/cycle guarantee. These finite TS runs do not prove native,
all-iterator/all-input/optimizer or separate BIOS runtime-parser behavior.
CPU7, Table length, BZ01 and the repeat-scope LS01 issue remain open.
