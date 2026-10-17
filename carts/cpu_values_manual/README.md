# CPU powers, text, keys and metatables

`results.lua` and `cart.lua` are the complete ordinary BLua cartridge. Boot it
through the installed BIOS. It owns typed BSS and uses real BIOS globals; it
changes no device configuration and invents no CPU-register or String encoding.

The entry supplies runtime POW operands, stores signed-zero/infinity/NaN and
subnormal outcomes, and checks reciprocal zero signs. Eighteen empty-String
concatenations check the actual default Number text. A bounded Table mutation
trace, zero/NaN/reference keys, nil deletion and false presence are retained.
Ten metatable flags distinguish own/inherited reads, raw access, explicit-nil
clearing and ignored function-valued indexers. This is not a universal Table
length contract: the known cross-capacity paired-owner conflict remains open.

## Build and check retained results

From the repository root:

```sh
npm run validate:toolchain:cart -- cpu_values_manual --debug
npm run headless:test -- cpu_values_manual tests/carts/cpu_values_manual/cpu_values_manual_assert.lua
```

Expect `[test] power_text_and_table_contracts: passed`. After completion the
case checks68 retained observations:12 powers,4 reciprocal signs,18 formatting
flags,8 lengths,9 key values,7 key/deletion flags and10 metatable flags. This is
a derived integration image, not native cartridge parity, exhaustive numerical
accuracy, nil-key fault execution or every metatable-chain boundary.

## Observe the ordinary image

```sh
npm run headless:tooling -- --input-timeline tests/carts/cpu_values_manual/ordinary_timeline.json cpu_values_manual
```

Playback ends after presentation frame4. It prints18 `CPU format` lines,
indexed1..18, whose text is the complete `expected` array in `cart.lua`, then:

```text
CPU values: reciprocal signs   -inf   inf
CPU values: table length   4
```

Separators are tabs. The CPU chapter prints both modules in full, with these
same retained results. This is nonvisual computation; no artificial rendering
is used as evidence.
