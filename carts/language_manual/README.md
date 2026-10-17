# BLua values and byte storage example

The complete ordinary cartridge is `results.lua` plus `cart.lua`. It starts
through the installed BIOS and leaves numeric observations in its typed BSS
result record. It does not render, configure DMA, allocate raw RAM, or change
library globals. This is BLua, not a claim of stock Lua calling/string behavior.

The program demonstrates:

- Passing the address of caller-owned typed storage to a function, writing two
  words there and returning a sum and count.
- Missing/excess fixed arguments, varargs, one nil result from bare return,
  and a parenthesized cartridge-source call that still returns two values.
  On-console source loading is a distinct producer, not covered by that result.
- An ordinary table alias, one-based table construction versus typed zero-based
  storage, and a returned closure that retains a changing captured value.
- Eight actual UTF-8 bytes decoded through `string.from_utf8` into four
  codepoints, including a zero and a supplementary scalar. `#text` and
  `string.byte` observe codepoints, not encoded bytes.
- Character construction versus literal `\xc3\xa9`, which is two codepoints,
  not an instruction to decode a UTF-8 byte sequence.
- A real imported `gpu/system_vram_region` BIOS call with its two current
  result words, not a cast of a numeric function address.

Static packets, registers and payloads remain raw typed storage. The example
adds no encoder, string-pointer ABI, language wrapper, allocator or runtime API.
The existing BIOS function/typed-view and `string/utf8.lua` producers are the
programming precedents. Dynamic objects are created only for the one-time
language observations; the final loop halts without recreating them.

## Build and observe

From the repository root, with the existing tooling available:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:cart -- language_manual --debug
npm run headless:test -- language_manual tests/carts/language_manual/language_manual_assert.lua
```

Expect `[test] calls_values_and_utf8_storage: passed`. The case checks every
retained observation in the result record. It runs a derived integration image
on a fresh target, not byte-for-byte playback of the ordinary ROM; linked
addresses can differ. The build selects the matching BIOS automatically.
These are current-checkout result checks, not native/backend parity, visible
output, malformed-UTF8 safety or full language/fault-recovery certification.
