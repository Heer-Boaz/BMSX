# BIOS base services: an ordinary cartridge

The complete cartridge is `results.lua` plus `cart.lua` and the ROM manifest
below. It uses the BIOS globals directly: `assert`, `rawequal`, `type`,
`tostring`, `tonumber`, `next`, `pairs`, `ipairs`, `select`, `getglobal`,
`setglobal` and `print`. The already introduced `pcall`, `error` and
`coroutine.running` support the failure and Thread observations.

The program retains actual numeric values and tuple/iteration counts in typed
BSS. Word observations record relations involving nil, strings and identity;
there is no private language-value encoding or simulated register array. It
never uses table length to count tuples or a sequence containing a hole.

## Exact file assembly

Make this tree relative to the repository root:

```text
carts/bios_base_manual/
    results.lua
    cart.lua
    res/manifest/manifest.rommanifest
```

Save the chapter's complete **Result storage** listing as `results.lua`.
Concatenate its four **Entry** listings in order as `cart.lua`, inserting
nothing between them. Only the first entry listing declares `module<entry>`.
The listings include every line of both modules. `require('results')` names
`results.lua`; the type declaration and typed BSS follow Memory's module rules.
No other source, asset, BIOS import or package is needed.

Use this exact `res/manifest/manifest.rommanifest`:

```yaml
title: BIOS Base Services Manual
hardware:
    - type: rom
```

## Reproduce the build and retained-result check

From the repository root, with the normal installed BIOS and headless tooling
artifacts available:

```sh
npm run validate:toolchain:cart -- bios_base_manual --debug
npm run headless:test -- bios_base_manual tests/carts/bios_base_manual/bios_base_manual_assert.lua
```

Expect `[test] base_service_observations: passed`. After its completion wait,
the case checks 37 retained observations. The test is a derived integration
image; it is not the ordinary cartridge playback below and is not native
execution or exhaustive runtime-parity evidence.

The two files under `tests/carts/bios_base_manual/` are supplied observation
inputs, not cartridge modules. The source listings above are sufficient to
build the ordinary image without those test inputs.

## Observe the ordinary image

Use this complete `tests/carts/bios_base_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BIOS base-service observations retained"
  }
]
```

Then run:

```sh
npm run headless:tooling -- --input-timeline tests/carts/bios_base_manual/ordinary_timeline.json bios_base_manual
```

The supplied presentation-frame-4 timeline completes normally. After the BIOS
startup messages the ordinary cartridge emits these 17 lines. Separators below
are literal tabs, not spaces:

```text
Assert values	0	kept	nil	7
Assert nil error	false	nil
Assert default	false	assertion failed!
Conversions	12.5	-125	0.25	16	-5	35	nil
Invalid base	false	bad argument #2 to tonumber (base out of range)
Type names	nil/boolean/number/string/table/function/thread
Object labels	table/function/thread
Identity	true	false
Next	4	41	1
Inventory	3	66
Sequence prefix	2	30	90
Select suffix	nil	9
Tuple counts	4	3	2	0
Global writes	11	22	false	counter changed
Global cleared	nil
Print tuple	nil	7
Print result count	1
```

The cartridge finishes its observations, sets `result.completed` to 1 and
remains in `halt_until_irq`; it does not return to the launcher. The timeline
then ends host observation. Frame 4 is the observation timeline's endpoint,
not a promised boot latency or CPU-cycle budget.

## Retained groups

- Assert: first 0, last 7, tuple count 4; interior nil and both caught failure
  contracts observed. An explicit nil error differs from omitted-message text.
- Conversion slots 0..5: 12.5, -125, 0.25, 16, -5, 35; rejected text gives nil
  and explicit base 37 is a protected error.
- Type labels: all seven names; object text is `table/function/thread`, not an
  address. Identity distinguishes the shared table from an equal-shaped table.
- Next: key 4 and value 41, followed by exactly one nil on exhaustion.
  Pairs: count 3, sum 66, with no hash-order dependency.
- Ipairs: count 2, sum 30, stops at slot 3's nil; slot 4 still contains 90.
- Select: input count 3, suffix count 2 preserving nil then 9, empty suffix
  count 0. Print's ordinary fallthrough produces one nil result.
- Owned global: 11 read by ordinary name, then 22 still present after the
  protected error, then cleared to nil. No builtin is rebound and no previous
  public state is captured or restored.

The chapter's retained-results table names every field. These observations
exercise the shown paths; they do not broaden the BIOS contract beyond its
source-defined behavior.
