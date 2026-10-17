# CPU numbers, words, calls and memory

`results.lua` and `cart.lua` are the complete ordinary BLua cartridge. It starts
through the installed BIOS, owns typed BSS rather than hard-coded free RAM,
and does not program a graphics, DMA or audio unit. No private CPU-register
encoding, address allocator or compatibility wrapper is added.

The program reads back five f64 operands and demonstrates division versus
floor division, both modulus signs, Number addition versus a Word store and
signed bitwise results, arithmetic right shift and modulo32 shift counts,
fractional word conversion, truthy zero and a comparison. Four actual RODATA
bytes are read through u16/u32 views. A numeric2147483649 f32 store rounds to
2147483648. An ordinary function returns -4 and a returned closure retains its
counter, producing12 then15. The closing loop uses `halt_until_irq`.

## Build and check retained results

From the repository root:

```sh
npm run validate:toolchain:cart -- cpu_manual --debug
npm run headless:test -- cpu_manual tests/carts/cpu_manual/cpu_manual_assert.lua
```

Expect `[test] numbers_words_calls_and_memory: passed`. The case checks26
numeric observations after completion. It runs a derived integration image;
its linked addresses need not match ordinary playback. This is not native cart
parity, every instruction, all error behavior or a throughput benchmark.

## Observe the ordinary image

```sh
npm run headless:tooling -- --input-timeline tests/carts/cpu_manual/ordinary_timeline.json cpu_manual
```

This starts the ordinary ROM through the BIOS and stops after presentation
frame4. Diagnostic output includes:

```text
CPU: quotient   -2.33333   floor   -3
CPU: Number     2.14748e+09   signed word   -2.14748e+09
CPU: counter    12   15
```

Separators are tabs. Printed finite values are formatted text; the result
record retains the precise numeric values checked by the integration case.
The example is nonvisual computation, so no artificial drawing is used as
CPU evidence. Actual video-generation examples are in the graphics chapters.
