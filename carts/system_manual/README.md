# SYSTEM controller cartridge example

Fresh installed BIOS entry, current user mode, exclusive ownership of the
central VBlank mask/handler, no other enabled interrupt producers and no
concurrent diagnostic writer. The program keeps inherited running PCRTC timing;
it is not an arbitrary resumed-state or display-initialization routine.

`results.lua` owns 172 bytes of typed BSS. No absolute storage address is guessed.
Its `f64` field retains the BIOS clock's fractional seconds; raw device words
remain word fields. The entry writes the four supervisor command bits without
RESET in current user mode and records their ignored effect. This is not a way
to request supervisor entry or to grant privilege.

Four separate waits compare modulo-2^32 TIME_MS differences with 100 ms. VBlank
only supplies wake-ups; each wake rechecks TIME_MS. The records are successive
reads, not an atomic snapshot or a guaranteed 100 ms cadence. The short isolated
run spans less than one TIME_MS wrap. Its BIOS `os.clock()`/`os.time()` observations
are bracketed by separate TIME_MS reads, not assumed simultaneous with them.

BIOS `print` supplies a heading and completion line. The raw port sequence
writes codepoints S, U+00E9, U+1F600 and FFFFFFFFH, then FLUSH0. With room and
no interleaving writer the diagnostic byte stream contains `Sé😀?` plus LF.
CHAR's final raw readback is FFFFFFFFH and FLUSH's is0. Raw port writes do not
add those characters to BIOS console history or perform GPU drawing.

## Cartridge materials

The chapter prints both modules in full. Put the result-module listing in
`carts/system_manual/results.lua`; concatenate the consecutive entry listings
into `carts/system_manual/cart.lua`, in their printed order. The entry's
`require('results')` resolves that const module. The existing public
`cartlib/clock` module is supplied by the repository, not copied into this cart.

The complete `carts/system_manual/res/manifest/manifest.rommanifest` is:

```yaml
title: System Controller Manual
hardware:
    - type: rom
```

No extra asset, BIOS-private module or absolute result-storage address is needed.

```sh
npm run build:toolchain:cart -- system_manual --debug
npm run headless:test -- system_manual tests/carts/system_manual/system_manual_assert.lua
```

The existing headless tooling product is a prerequisite:
`npm run build:product:node-headless-tooling -- --debug`. Cartridge building also
builds its matching BIOS as required. Full source validation is
`npm run validate:toolchain:cart -- system_manual --debug`.

The integration case checks all four elapsed predicates, nonzero running timing
words, current-user ignored commands, six zero initial fault words, bracketed
BIOS time results and raw diagnostic readbacks. It uses a derived integration
image on an independent target. A separate ordinary-ROM timeline confirmed the
three diagnostic lines, including the Unicode/replacement bytes. Neither result
is native cartridge parity, general privileged continuation/reset proof, physical output,
sustained transmitter throughput or a whole-console acceptance claim.

## Observe the ordinary cartridge and its console history

```sh
npm run headless:tooling -- --input-timeline tests/carts/system_manual/monitor_timeline.json system_manual
```

This runs the ordinary ROM, not the derived integration image. The terminal
output contains the heading, `Sé😀?`, and completion line. The supplied timeline
waits until presentation frame80 after the observations, records the current
screen, asserts the actual supervisor-request line at82, releases it at84 and
captures the monitor at90. No ordinary keyboard key is substituted for that
line. The input unit observes its rising level on VBlank independently of ARM.

The generated image is
`tests/carts/system_manual/screenshots/frame_00090.png`. It shows the monitor
heading, the two retained BIOS print lines and its prompt. The raw `Sé😀?` line
is diagnostic output only, so it is absent from that BIOS history. The earlier
screen need not show either BIOS print line: `print` does not itself draw it.

A separate real-input/read-only-physical-observation check exercises a second
edge to leave and another to re-enter:

```sh
npm run ide:test -- system_manual tests/ide/system_manual.idetest.js
```

It checks STATUS0→5→0→5, restored cartridge MASK4, advancing machine time and
unchanged fault sequence0. It never writes guest state or runs guest expressions
through the harness. This is bounded normal NMI entry/leave evidence, not
arbitrary fault repair, reset, every banked state, native parity or UI-only proof.
