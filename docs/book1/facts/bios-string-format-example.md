# Formatting program: exact source and observed scope

2026-10-18, baseline f3a86b01c plus this documentation/example worktree.
Ordinary real BLua; no runtime/compiler/BIOS/local encoding helper change.

- `carts/bios_format_manual/results.lua`: SHA-256 `ab32c6d93fd8c58f6845ab8c70d41abe072a3c2a9eb86071e18b6b7075ec62ae`, 27 lines.
- `carts/bios_format_manual/cart.lua`: SHA-256 `166d4775667d8e618e5f5679bfcbeb2efcb19df1e570fb7e7efe23f0d9d2176c`, 69 lines.
- `tests/carts/bios_format_manual/bios_format_manual_assert.lua`: SHA-256 `c30bb8fe93b83a2c65c3e4daaef19e6506a0ad01af08cb43be087073cb0b82ec`, 31 lines.
- `tests/carts/bios_format_manual/format_char_assert.lua`: SHA-256 `3b7570487239d79a06c8d03fedc34ec77e95744e7efe32dc7480484c81684bdd`, 24 lines.
- `dist/bios_format_manual.debug.rom`: SHA-256 `c1f449e1c9f6eea7468ab7eef342a64e7dfcd6ab3239e849f447359c4b2cba3c`.
- `dist/system/bmsx-bios.debug.rom`: SHA-256 `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664`.

The 27-line result module and 69-line entry are printed completely in the
chapter. Each scalar observation is explicitly named in the result struct;
no language String is encoded into an address field. The retained integration
has 18 assertions after completion. A separate unit fixture checks both %c
codepoints, grouped-result counts, direct char distinction and width accounting.
These are fresh derived test targets, not byte-identical ordinary playback or
native execution. Current toolchain validation includes lint/type checking.

Actual commands/logs:

- `npm run build:product:node-headless-tooling -- --debug`:
  `/tmp/bmsx-format-tooling-build.log`.
- `npm run validate:toolchain:cart -- bios_format_manual --debug`:
  `/tmp/bmsx-format-cart-final-build.log`.
- `npm run headless:test -- bios_format_manual tests/carts/bios_format_manual/bios_format_manual_assert.lua`:
  `/tmp/bmsx-format-cart-final-test.log`, `[test] formatted_text: passed`.
- `npm run headless:test -- bios_format_manual tests/carts/bios_format_manual/format_char_assert.lua`:
  `/tmp/bmsx-format-char-final-test.log`, `[test] format_char_call_results: passed`.
- Separate ordinary `npm run headless:tooling -- --debug --input-timeline tests/carts/bios_format_manual/ordinary_timeline.json bios_format_manual`:
  `/tmp/bmsx-format-ordinary-final.log`, all eight literal lines below.

```text
Format fields	HP 7/10	+00042	0x00002a
Format stars	[    1.25]	[go   ]
Format integers	/0	4294967295
Format numbers	1.25/1.3e+01/100.	+INF/nan	1e+06
Format text	"A\t\""	2	0	0
Format argument paths	0	1
Format incomplete	false	string.format incomplete format specifier.
Format unsupported	false	string.format unsupported format specifier '%p'.
```

The initial retained test failed at the incorrect expectation of one %c
codepoint, while ordinary stdout already showed length2. That failure is kept
in `/tmp/bmsx-format-cart-test.log` and the initial ordinary log. The test was
corrected only after the actual source producer/consumer chain and separate
unit observations confirmed the current two-result delivery; no implementation
was changed to fit the text. The existing source/console grouping distinction
is already documented in Memory, not a newly invented global compiler rule.

These runs do not resolve the common Table-length stop, certify arbitrary
inputs/resources/whole-call timing, establish native ordinary playback, or
close the seven CPU questions/BZ01. Format examples intentionally use `#` with
general formatting to bypass zero stripping, without declaring other paths
invalid or supported only for Strings.
