# BIOS String operations: an ordinary cartridge

This cartridge uses all nine base exports of the installed `string` global:
`byte`, `char`, `len`, `upper`, `lower`, `sub`, `reverse`, `rep`, and `from_utf8`.
It supplies no local codec or cartridge-local replacement for those functions.
Pattern matching, formatted text and binary packing are separate interfaces.

## Exact source assembly

Create this tree relative to the repository root:

```text
carts/bios_string_manual/
    results.lua
    cart.lua
    res/manifest/manifest.rommanifest
```

Save the chapter's complete **Result storage** listing as `results.lua`.
Concatenate the four **Entry** listings in order as `cart.lua`, inserting
nothing between them. They contain all 37 result-module lines and all 95
entry-module lines. Only the first entry listing declares `module<entry>`.
`require('results')` resolves the result module; it exports the result address
and the caller-owned 257-byte BSS buffer. Memory's module/BSS rules apply.
The two readonly encoded byte spans are declared in the entry itself.

Use this entire `res/manifest/manifest.rommanifest`:

```yaml
title: BIOS String Operations Manual
hardware:
    - type: rom
```

No image, external text asset, extra source module or cartridge BIOS import is
required. The Unicode input is expressed as codepoint numbers and literal
encoded bytes; editing or displaying an emoji glyph is not a prerequisite.

## Build prerequisites and retained results

From the repository root in a working repository development environment:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run validate:toolchain:cart -- bios_string_manual --debug
npm run headless:test -- bios_string_manual tests/carts/bios_string_manual/bios_string_manual_assert.lua
```

Expect `[test] string_operations: passed`. After waiting for completion, the
case checks 32 scalar observations. This is an existing derived integration
image, not ordinary cartridge playback or native execution. The observation
input files under `tests/carts/bios_string_manual/` are not cartridge modules;
the two source listings and manifest suffice to build the ordinary cartridge.

## Observe the ordinary cartridge

Use this complete `tests/carts/bios_string_manual/ordinary_timeline.json`:

```json
[
  {
    "frame": 4,
    "description": "BIOS String operations retained"
  }
]
```

Then run:

```sh
npm run headless:tooling -- --input-timeline tests/carts/bios_string_manual/ordinary_timeline.json bios_string_manual
```

After BIOS startup, the ordinary cartridge emits these nine lines. Separators
between printed arguments are literal tabs:

```text
String sizes	8	4
Codepoints	65	122	233	128640
ASCII case	1	1
Slices	1	1	0	1	1
Repetition	go/go/go	0	1
Scalar conversion	1	1	122	65	1	0
Rejected arguments	false	Invalid argument.	false	Invalid argument.
Mapped decoding	1	3	0	233
Chunk boundary	257	65	65	65	90
```

The cartridge sets `result.completed` to one and remains in `halt_until_irq`.
Presentation frame 4 is the end of this observation, not a guaranteed boot time
or cycle count. Numeric diagnostics demonstrate codepoints and relations;
they do not promise that a particular text display can draw every codepoint.

## Observation boundaries

- Eight mapped UTF-8 bytes and four language codepoints describe the same
  content. Upper/lower change only the shown ASCII letter; slicing and reversal
  operate on the complete codepoints rather than splitting encoded bytes.
- The scalar probes distinguish `byte`'s signed-word index conversion from
  `sub`'s floored relative bounds. `byte` returns one value even with a third
  argument; a negative index gives nil. `char` converts its numeric inputs to
  unsigned words before checking Unicode scalar validity.
- The two protected failures are actual invalid argument values: a surrogate
  codepoint and a String used as a `byte` index. They are not generic validation
  rules for every String-library function.
- The two-byte encoding at `utf8_bytes[2]` is fully mapped. Declaring only one
  byte to `from_utf8` does not prevent its lead-driven continuation read; the
  observed result is codepoint 233. This is a deliberately bounded teaching
  case, not permission to read unmapped memory or a general memory-safety test.
- An embedded zero byte remains codepoint zero; it is not a terminator. A
  257-byte prepared BSS input crosses the decoder's 256-codepoint staging
  boundary successfully. Rewriting its first byte to 90 after decoding leaves
  the returned first codepoint at 65. This is one actual size/lifetime example,
  not a maximum-capacity claim.

The program does not settle the existing common Table-length/refill question,
test arbitrary malformed encodings, exhaust heap/stack resources, or establish
native ordinary-cartridge execution or physical decoder bandwidth.
