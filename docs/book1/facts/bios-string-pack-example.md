# String pack program: exact source and observed evidence

2026-10-18, baseline b515e804e plus this documentation/example worktree.
No runtime, BIOS, compiler, local codec or publisher change. This is execution
and identity evidence, not the independent source audit or publication approval.

## Final source and artifact identity

- `carts/bios_pack_manual/results.lua`, 42 lines; SHA-256 `014393c2fa8c85a19d06df7a8bdde166eb49acfcae87f6958c4bdb738e678491`.
- `carts/bios_pack_manual/cart.lua`, 117 lines; SHA-256 `c55e1f8b2541a858d798085625725fcb4db2070942ac774b5548567089bd76fa`.
- `carts/bios_pack_manual/res/manifest/manifest.rommanifest`, 3 lines; SHA-256 `1429ba7a47f506fa5a285a500eea9242df7241f26dfaa613a238b07fc0465edf`.
- `tests/carts/bios_pack_manual/bios_pack_manual_assert.lua`, 46 lines; SHA-256 `d48258458b0f542b414292632ab973383ba2a7774781cac2d62bff92fc3355f5`.
- `tests/carts/bios_pack_manual/ordinary_timeline.json`, 6 lines; SHA-256 `23a499cac25617ec55f70faed66b609ee9de85d97f5caedef799d7e034696d2b`.
- `dist/bios_pack_manual.debug.rom`; SHA-256 `5d3dcebd634189161c75693ff3d80e23cb095cd54708b715d020a7d1f8f3d127`.
- `dist/system/bmsx-bios.debug.rom`; SHA-256 `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664`.

The chapter prints the result module completely and the entry in five parts.
Joining those entry blocks with exactly one blank line between adjacent blocks
reconstructs the actual cart byte-for-byte. Both modules and the printed
manifest suffice for the ordinary cartridge; the supplied debug test is a
separate derived integration target, not an additional entry module.

## Actual commands and results

The existing debug headless tooling was already built for the prior String
slice. The current actual commands were:

```sh
npm run validate:toolchain:cart -- bios_pack_manual --debug
npm run headless:test -- bios_pack_manual tests/carts/bios_pack_manual/bios_pack_manual_assert.lua
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_pack_manual/ordinary_timeline.json bios_pack_manual
```

Logs: `/tmp/bmsx-pack-build.log`, `/tmp/bmsx-pack-test.log`, and
`/tmp/bmsx-pack-ordinary.log`. All final commands exited 0. The validated
build includes existing lint/type checks; no rule was relaxed. The retained
case passed after waiting for completion and checking 33 assertions.
Ordinary playback independently produced the following 8 lines:

```text
Pack layout	23	33	24	34	1
Pack fields	1	4660	-300	1.25	-2.5	POS
Pack endian and padding	52	18	254	212	1
Pack text	3	0	1	ready	4	0	1	5
Pack codepoints	1	256	256	0	2	2
Pack integer range	false	string.pack integer value out of range.
Pack zero text	false	string.pack z strings must not contain zero bytes.
Pack variable size	false	string.packsize format is variable-length.
```

The timeline's frame4 is a selected zero-based presentation offset, not a test
assertion or elapsed-frame/boot/cycle guarantee. `completed=1` alone means the
entry reached its final marker, not that comparison words were all true. The
separate assertions and literal ordinary values supply that bounded evidence.

Initial proposal lint rejected one-off cached call results and staged exports.
The cart was rewritten to consume selected results directly and avoid those
redundant locals; the existing linter and runtime were unchanged. Actual final
build/test/playback was repeated after source-line/diagnostic wrapping.

This does not establish native ordinary execution, every compiler pipeline,
all-input parity, malformed storage/resource exhaustion, whole-call timing or
universal output/result counts. The common Table-length STOP, CPU7 and BZ01
remain OPEN. No String-to-mapped-byte ABI is inferred from a passing example.
