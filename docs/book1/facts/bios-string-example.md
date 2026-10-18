# BIOS String operations: frozen complete-program facts

2026-10-18, baseline ea4ba90ab. Current software is the authority. No
architecture document or historical PDF was opened. Scope is the ordinary
teaching cartridge and its existing-harness observation inputs, not a runtime,
compiler, BIOS, cartlib, publisher or shared-harness change.

Production organization reference inspected before implementation:
https://raw.githubusercontent.com/lua/lua/master/lstrlib.c . This is not a BMSX
semantic source. Actual typed source/readonly/BSS precedents include
`carts/language_manual/cart.lua:1-8,57-75` and its result module; actual decoder
is `machine/bios/string/utf8.lua`, not a cartridge-local codec.

## Actual source and observations

- SX01. Literal complete source: `carts/bios_string_manual/results.lua:1-37`
  and `cart.lua:1-95`. Result record has 28 named fields / 33
  scalar word slots including completed. It separately declares257 caller-owned
  BSS bytes. Counts, scalar codepoints and relation words are not encodings of
  arbitrary language values. Typed entry views use actual exported addresses.
- SX02. Entry `cart.lua:6-27` declares8 readonly encoded bytes and3 readonly
  bytes with an embedded zero; constructs four codepoints65,122,233,128640;
  observes byte count8 versus String length4 and all four codes; ASCII upper
  and lower change only the stated ASCII letter. BIOS byte/char
  `machine/bios/string/base.lua:39-40`; wrappers:15-25,43-55. Actual aliases:
  TS `machine/ts/machine/cpu/cpu.ts:4320-4370`; native
  `machine/cpp/machine/cpu/cpu.cpp:2176-2224`.
- SX03. Entry:29-46 calls the installed String method sub, floors2.9/3.9,
  treats sub0/0 as empty, clamps-99/99, reverses complete codepoints and
  repeats go three times with separator/, plus zero/default counts. Exact
  expected relations all1 except zero lengths0. Actual wrapper algorithms
  `machine/bios/string/base.lua:27-36,58-120`; String-index installation
  `machine/bios/string.lua:1-22`, CPU ordinary String reads
  `machine/ts/machine/cpu/cpu.ts:629-637` and native
  `machine/cpp/machine/cpu/cpu.cpp:3251-3257`. No claim of substring-by-byte
  indexing, non-ASCII case mapping or universal Table-target length.
- SX04. Entry:48-65 observes byte(-1) nil, exactlyone byte result with supplied
  third argument, truncated-toward-zero signed-word position2.9->2, wrapped
  position0x100000001->1, char0x100000041->65 and char() empty. Actual
  byte/char owners are SX02; this is their numeric word conversion, not a local
  helper. The two actual protected errors are surrogate0xd800 and String index
  '2', each original String Invalid argument. Retained comparisons do not turn
  these cases into generic type checks for every wrapper.
- SX05. Entry:67-76 decodes the complete eight-byte mapped span to the same
  four-codepoint String, decodes3 bytes containing zero to length3/code0, then
  declares count1 starting at the mapped two-byte encoding of233. The decoder
  still reads its mapped continuation and returns233. This is a bounded
  overread demonstration with both bytes present, not memory-safety evidence
  for unmapped storage. Exact lead/read/pointer sequence
  `machine/bios/string/utf8.lua:10-38`; mapped byte ownership belongs to Memory.
- SX06. Entry:78-95 prepares all257 BSS bytes as65, decodes them and observes
  String length257 and codes65 at positions1/256/257 after rewriting the first source byte to90
  following the decoder return. The actual ordinary line also reads back90
  from the changed source; returned text is not a live view of those bytes. Decoder staging
  `machine/bios/string/utf8.lua:6,39-53` is256 codepoints per chunk, not an API
  maximum. Program writes completed1 then stays in halt_until_irq. No fixed
  latency, maximum successful size, glyph-rendering or physical bandwidth
  claim follows.
- SX07. Existing retained case
  `tests/carts/bios_string_manual/bios_string_manual_assert.lua:8-10`
  waits for completed1 (max8 observation frames); :11-42 contains32 explicit
  scalar assertions. Timeline: `ordinary_timeline.json:1-6`, frame4. Neither
  endpoint is a guaranteed boot time/cycle budget. Retained/ordinary execution
  are separate observations; no native ordinary cartridge execution is claimed.

## Executed final procedure

The documented five-command procedure ran successfully from repository root;
the final cartridge-only rerun after the source-reuse addition is scoped below:

1. `npm run build:product:node-headless-tooling -- --debug`
2. `npm run build:toolchain:bios -- --debug`
3. `npm run validate:toolchain:cart -- bios_string_manual --debug`
4. `npm run headless:test -- bios_string_manual tests/carts/bios_string_manual/bios_string_manual_assert.lua`
5. `npm run headless:tooling -- --input-timeline tests/carts/bios_string_manual/ordinary_timeline.json bios_string_manual`

Logs `/tmp/bmsx-bios-string-tooling-build.log`, `-bios-build.log`, `-build.log`,
`-test.log`, `-ordinary.log`. Cartridge validation includes actual lint and
compilation. The retained case passes; ordinary timeline completes with the
nine lines below. One early build failed the existing one-off-call-result
local lint rule; the actual source was corrected to inline the decoder call.
One source line was then wrapped in the actual file; a subsequent two-line
source-reuse observation was added and cartridge validation, retained case and
ordinary playback were rerun. The two prerequisite artifacts were unchanged. No lint exemption, runtime fix or harness change was added.
Final source maximum display width: 80 columns with tabs expanded at4.

Artifact ID `7bbc5f66760685cc2455b5127aa84aa184aa9211b6563bb21a30ea79a497987d`.
The artifact metadata contains the matching debug/O3 cart/system digests.

| File | SHA256 |
| --- | --- |
| `dist/bios_string_manual.debug.rom` | `fb7f0a30cdff5d2e821fd3074e4d1ea5f1ff6d7e9e36622f6e5b2862b97a5fae` |
| `dist/system/bmsx-bios.debug.rom` | `01b9f2f197e59144867d5844863aa7fd9752811e227e7a6901a1541a17b6e664` |
| `dist/host_headless_tooling.debug.js` | `a38274f9eea37a4a4a759a3d0b11c72fe8170e525d2eaf0ffe1a41d069c43470` |
| `carts/bios_string_manual/results.lua` | `1c1efe28a53349c0672d26e565da69c701f40a9a040b5deaf07e5897db2c0004` |
| `carts/bios_string_manual/cart.lua` | `2f805e6efb294b243a129b892819354a62b7685b66554798731c5a9d9db12bc9` |
| `tests/carts/bios_string_manual/bios_string_manual_assert.lua` | `553a271c33c50b22c1348dc75c318017f0a1139dfef27a7e1b19cea8b5e62415` |
| `tests/carts/bios_string_manual/ordinary_timeline.json` | `ab281af699472af0c28261c7aa944259d16c304c159befc7539af256499f474c` |

## Exact ordinary diagnostics

Actual tabs separate arguments. These9 lines follow real installed BIOS
startup and precede the host timeline-completion line; they are not console
stub or hypothetical native output:

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
