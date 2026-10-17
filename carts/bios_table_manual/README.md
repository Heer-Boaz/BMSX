# BIOS table library: an ordinary cartridge

The complete cartridge is `results.lua` plus `cart.lua` and the ROM manifest
below. It calls the installed BIOS `table.pack`, `table.unpack`, `table.concat`,
`table.insert`, `table.remove` and `table.sort`, with the already introduced
`select`, `print`, `pcall` and `error`. It uses no cartridge-local implementation
of those services.

Numeric observations and counts are retained in typed BSS. Comparison words
record nil positions, resulting text and caught error identity. The program
uses actual default-length sequence operations as well as the explicit
`packed.n` tuple recipe. It does not provide a generic value-word encoding or
simulate a register file.

## Exact file assembly

Make this tree relative to the repository root:

```text
carts/bios_table_manual/
    results.lua
    cart.lua
    res/manifest/manifest.rommanifest
```

Save the chapter's complete **Result storage** listing as `results.lua`.
Concatenate its three **Entry** listings in order as `cart.lua`, inserting
nothing between them. Only the first entry listing declares `module<entry>`.
These listings include every line of both source modules. `require('results')`
names `results.lua`; its typed declarations and BSS follow Memory's module
rules. No other source module, asset, cartridge BIOS import or package is
needed.

Use this complete `res/manifest/manifest.rommanifest`:

```yaml
title: BIOS Table Library Manual
hardware:
    - type: rom
```

## Reproduce the build and retained-result check

From the repository root, first build the installed BIOS and headless tooling,
then validate the cartridge and run the retained-result check:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run validate:toolchain:cart -- bios_table_manual --debug
npm run headless:test -- bios_table_manual tests/carts/bios_table_manual/bios_table_manual_assert.lua
```

Expect `[test] table_library_observations: passed`. After the completion wait,
the case checks 30 retained scalar observations. This test uses a derived
integration image. It is not ordinary cartridge playback, native execution or
exhaustive runtime-parity evidence.

The two files supplied under `tests/carts/bios_table_manual/` are observation
inputs, not cartridge source modules. The source listings and manifest above
are enough to build the ordinary image without those inputs.

## Observe the ordinary image

Use this complete `tests/carts/bios_table_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BIOS table-library observations retained"
  }
]
```

Then run:

```sh
npm run headless:tooling -- --input-timeline tests/carts/bios_table_manual/ordinary_timeline.json bios_table_manual
```

The presentation-frame-4 timeline completes normally. After BIOS startup, the
ordinary cartridge emits these fourteen lines. Separators below are literal
tabs, not spaces; `Empty ranges` contains an empty argument between two tabs.

```text
Packed tuple	10	nil	30	nil
Tuple counts	4	4
Packed concat	10||30|
Mutation	1	3	4
Ascending	1	5.5,7,8,9
Default unpack	5.5	7	8	9
Default unpack count	4
Negative range	7:8:9
Zero range	5.5:7:8:9
Empty ranges		0
Descending	9,8,7,5.5
Removed last	5.5	3
Comparator failure	false	true	5
Partial sequence	1,3,2
```

The cartridge sets `result.completed` to 1 and remains in `halt_until_irq`;
it does not return to the launcher. The timeline then ends host observation.
Frame 4 is that observation endpoint, not a boot-latency or CPU-cycle promise.

## Retained groups and bounds

- The packed tuple has four positions: 10, nil, 30, nil. Both explicit unpack
  calls use `packed.n`; the expanded tuple count is 4. Its explicit concat
  range produces `10||30|` rather than losing the final empty field.
- The ordinary sequence starts as 9,3,7. Insert position 2 value 5.5; remove
  position 3 returns 3; append 8. Length is 4. Default sort yields 5.5,7,8,9,
  and default unpack returns four values. Counted insert and sort each return
  one nil result. Default-length concat produces `5.5,7,8,9`.
- Negative concat endpoints -3,-1 give `7:8:9`; zero endpoints 0,0 give
  `5.5:7:8:9`. Reversed range 3,2 gives an empty concat String of length zero
  and zero unpack results.
- Descending comparator yields 9,8,7,5.5. Default remove returns 5.5 and the
  observed remaining length is 3.
- On the separate sequence 3,1,2, the fifth comparator call raises a Table.
  The protected result is false plus that same object; the actual partial
  sequence is 1,3,2. The comparison schedule and partial arrangement describe
  this call, not all sort implementations or arbitrary comparators.

The chapter's result table names every retained field, including completion.
These ordinary observations do not settle the known generic SETT/rawset
array/hash-boundary refill length disagreement between TypeScript and native
owners described by the CPU reference. No native execution of this ordinary
image is claimed, and no universal Table-capacity, recursion-depth, memory or
performance bound is inferred from these short examples.
