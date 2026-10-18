# String pattern program: exact source and observed evidence

2026-10-18, baseline b515e804e plus this documentation/example worktree.
No runtime, BIOS, compiler, local codec or publisher change. This is execution
and identity evidence, not the independent source audit or publication approval.

## Final source and artifact identity

- `carts/bios_pattern_manual/results.lua`, 47 lines; SHA-256 `b4af10e7290a76adef699f49db75431a4f8b0728cae755c9a1239ab69e5ec3f0`.
- `carts/bios_pattern_manual/cart.lua`, 122 lines; SHA-256 `215f1e96904e11dfd8eca819ee95a4c314516824a05567cfe0acbbc9b8e05583`.
- `carts/bios_pattern_manual/res/manifest/manifest.rommanifest`, 3 lines; SHA-256 `ad0c79b52d43a59e792a0cb531aea8175961a80bfb16712c67bc163c04d757a4`.
- `tests/carts/bios_pattern_manual/bios_pattern_manual_assert.lua`, 53 lines; SHA-256 `15210af14a09370a16c240dc204fb172590c5cc569f67d7f0daea59c487880b8`.
- `tests/carts/bios_pattern_manual/ordinary_timeline.json`, 6 lines; SHA-256 `22c80384d73c7454e3477d66be2cf2263333007335d54fad56b26f005c6d510d`.
- `dist/bios_pattern_manual.debug.rom`; SHA-256 `fc6f7686b9f77826091a18f180efb78df725da9cb1e143c31781e989d144116e`.
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
npm run validate:toolchain:cart -- bios_pattern_manual --debug
npm run headless:test -- bios_pattern_manual tests/carts/bios_pattern_manual/bios_pattern_manual_assert.lua
npm run headless:tooling -- --debug --input-timeline tests/carts/bios_pattern_manual/ordinary_timeline.json bios_pattern_manual
```

Logs: `/tmp/bmsx-pattern-build.log`, `/tmp/bmsx-pattern-test.log`, and
`/tmp/bmsx-pattern-ordinary.log`. All final commands exited 0. The validated
build includes existing lint/type checks; no rule was relaxed. The retained
case passed after waiting for completion and checking 40 assertions.
Ordinary playback independently produced the following 13 lines:

```text
Pattern positions	2	2	1	1	4	3	3
Pattern captures	ship_17	12	-3	5	42
Pattern end search	1	0
Pattern iteration	3	99	100	115	3
Pattern atoms	a1b2b	a1b	(a(b)c)	cat	go	1
Pattern replacement text	[red] [blue]	2	false blue	2
Pattern replacement callback	red B	2	2
Pattern replacement empty	____	4
Pattern deferred errors	x	0	x	0
Pattern syntax error	false	invalid string pattern
Pattern capture error	false	invalid string pattern capture
Pattern replacement error	false
string.gsub replacement must be a string, number, function, or table.
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
