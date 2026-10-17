# APU source, programming and figure review

Editorial evidence for `docs/book1/apu.md` and its frozen APR/APT/APV/APUB
[claim sheets](../facts/apu.md). Book I as a whole remains unfinished.
The complete independent source/math/semantic-figure and whole-reader reviews
pass with no remaining factual or instructional failures. Print acceptance is
separate in [apu-print.md](apu-print.md).

## Scope and authorship

Separate extractors checked register/command/event/fault, transfer/clock and
voice/format/output slices against the scoped TypeScript/C++ spec leaves and
live owners. No confirmed disagreement was found. Source authors received
bounded frozen facts, not architecture prose or a historical hardware PDF.
Separate prose assignments cover sample formats, playback/rate/loop/filter/mix,
and transfer/timing; a further author implements the ordinary BLua cartridge.
Root integrates resources, register/command/IRQ/fault reference and the exact
printed modules. Nonauthor source/diagram and complete-reader passes are
independent assignments, not the authors approving their own prose.

MAME's production [SCSP owner](https://github.com/mamedev/mame/blob/master/src/devices/sound/scsp.cpp)
and [SPU owner](https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp)
were inspected only for responsibility separation and retained slot/datapath
structure. No foreign address, voice count, sample format, clock divider or
interrupt behavior supplied a BMSX fact. This documentation slice changes no
runtime, BIOS, cartlib, compiler, publisher or stylesheet.

Live software is authoritative for this edition, as requested. Independent
analog/pin/bus clocks, sustained electrical ratings and external delivery
latency remain separate future specification decisions, not guessed figures.
The chapter supplies the installed capacities, system/sample/transfer rates
and observable scheduled edges actually defined by that contract.

## Existing BIOS and source-language precedent

APUB01–10 name actual firmware static-record, typed-port and explicit-BSS
examples, especially `machine/bios/kernel/dma.lua`,
`machine/bios/shell/commands.lua` and `machine/bios/tty/terminal.lua`.
`cartlib/apu` already owns the named APU register and BADP header record types.
The example uses these types directly, with named readonly records/PCM data,
real MMIO writes and CMD last. The unsupported primitive readonly
symbol-address initializer was not papered over with a compiler change or
cart-local address/encoding helper.

Requiring the APU library already imports DMA and its IRQ dispatcher. The
example preserves the library's DMA0/1 callbacks and registers only its APU
callback; it does not install a conflicting second global `irq` function.
Its end waits snapshot a BSS sequence before the triggering command and test
that predicate around HALT. Separate predicates observe DMA completion and
sample-RAM commit. The four-entry BSS event array is sized for four exclusively
owned, serialized end operations, not presented as a hardware event FIFO.

## Executed ordinary cartridge

Stable sources are `carts/apu_manual/cart.lua`, `results.lua`, original
`res/audio/tone.wav`, the ordinary manifest and
`tests/carts/apu_manual/apu_manual_assert.lua`. Executed successfully:

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- apu_manual --debug
npm run headless:test -- apu_manual tests/carts/apu_manual/apu_manual_assert.lua
```

The normal integration case `pcm_transfer_generator_and_badp` passes. It checks
all sixteen uploaded/downloaded PCM words, ROM/live signed gain, retained paused
source/bank with advancing sample clock, sample-RAM playback, square configuration,
normal producer-encoded BADP playback, four exact source/slot/event sequences,
cleared ended banks, zero APU faults and preservation of unrelated masked VBlank.
Produced BADP metadata is 2,333 bytes, version 1, mono, 44,100 Hz, 4,410 frames,
dataOffset 56, seekCount 1, seekOffset 48. No hand-coded compressed-asset generator
or local decoder was added.

| Actual retained observation | Word/value |
|---|---|
| Upload DMA STATUS / APU STATUS after DMA wait | `00000002` / `00000420` |
| Upload APU STATUS after final commit | `000002a0` |
| Download DMA STATUS / APU STATUS after DMA wait | `00000002` / `00000420` |
| Download APU STATUS after STOP | `00000020` |
| Paused unsigned sample-clock distance | 2205 |
| End-event count / slots | 4 / 2,3,4,5 |
| Final ACTIVE_MASK / STATUS | `00000000` / `00000020` |
| Final FAULT_CODE / DETAIL / IRQ MASK | zero / zero / zero |
| Final central pending word | `00000004` (masked VBlank preserved) |

All nine printed Lua blocks reconstruct the two runnable modules exactly after
whitespace normalization, independently checked by root and the source reviewer.
This is real cartridge execution, not just compile-only evidence. It is **not**
audible/speaker proof, native full-cartridge parity or exact CPU/IRQ latency.
The ordinary headless audio sink discards output; retained slot words and an
advancing clock do not expose the private playback cursor or DAC samples.

## Executed mirrored output and transfer arithmetic

Separate scratch replays instantiate the real Memory/CPU/IRQ/DMA/scheduler/APU
and output owners, with installed timing, in both runtimes. They do not use a
fake output, resampler, new runtime hook or public test MMIO. Paired JSON logs
are byte-identical. These are actual discrete output/datapath observations,
not a claim about speakers or whole native guest execution.

Square source Hz 11025, frameCount 1, loop [0,1), unity Q16 rate, half duty and
quarter gain produces packed stereo frames `1fff1fff,1fff1fff,e000e000,e000e000`,
repeating. Four paused frames are zero with ACTIVE_MASK 1. Resume preserves
phase; a four-frame STOP fade produces
`1fff1fff,17ff17ff,f000f000,f800f800`. After 20 total frames SAMPLE_SEQUENCE 20,
ACTIVE_MASK 0, EVENT_SEQ 1, kind 1 and IRQ 20H are asserted in both owners.

Further full-output cases, unity gain/rate unless stated:

| Source or filter input | Actual signed samples, both owners |
|---|---|
| PCM8 bytes 0,128,255,64 | −32768,0,32512,−16384 |
| PCM16 frames 0,10000,−10000,0 at 22050 Hz | 0,5000,10000,0,−10000,−5000,0,0 |
| Mono BADP predictor 0/index 0; payload 70,8f,12,34 | 11,13,12,−11,−1,14,32,55 |
| Mono BADP predictor 1000/index 0; payload 17 | 1001,1012 |
| Enabled b0=b1=2000H, other coefficients 0; input 8192,0,−8192,0 | 4096,4096,−4096,−4096 |

The actual phase-step owners also return q 11888/remainder 27200 for 8000 Hz
and unity Q16 rate, satisfying 524288000=11888×44100+27200. Right/left equality
is asserted on every packed output frame. Every output case naturally ends,
clears ACTIVE_MASK and
increments EVENT_SEQ once. The BADP fixture programs the actual consumed seek
fields and block header, not an invented signature/version-validation path.

A real twenty-word cartridge-ROM→APU upload uses fixed DATA, APU_WRITE gating
and sixteen-word DMA blocks under installed timing. It yields:

| Cycle | DMA remaining | APU batch cycles remaining | APU STATUS | RAM visibility |
|---:|---:|---:|---|---|
| 132 | 4 | 512 | `0420H` | First block not committed |
| 644 | 4 | 0 | `02a0H` | First 16 words committed; tail DMA admitted |
| 680 | 0 | 128 | `0420H` | DMA DONE; tail still not committed |
| 808 | 0 | 0 | `02a0H` | All 20 words committed; SAMPLE_SEQUENCE 1 |

This exactly corroborates the chapter's stated controlled trace; it does not
measure CPU setup, handlers or an electrical bus. RAM words 1..20 and the
intermediate uncommitted tail were directly asserted in both implementations.
Scratch programs/logs use `/tmp/bmsx-apu-{dac,format,upload}-replay` stems.
No runtime changes or defensive validation were needed.

Existing scoped regressions also pass: 33 TypeScript audio-controller tests,
the freshly built native `bmsx_audio_controller_tests` suite and 16 existing
manual-tool tests. Builds and regression tests are not substituted for the
executed cartridge, mirrored sample traces or final printed-page inspection.

## Independent review findings

The reader review found two source-ownership/naming ambiguities: the initial
prose attributed resource address/extent to the BADP header, and did not say
that the audio resource must be named `tone`. The final text distinguishes
symbol-produced address/length from header-produced data offset and states the
resource name. The companion README's selection-clear edge was corrected from
command execution to command capture. No runtime behavior was changed.

The nonauthor final source/math/semantic-figure review found no factual failures
or paired-owner/spec disagreements. It checked all 60 ports, actual command and
fault emitters, source binding/lifetime, every 89-entry BADP step/index pair,
8000-Hz quotient/remainder, 441-Hz square pattern and gain/filter/fade arithmetic.
It also independently rechecked the final four-pair table and shortened access
paragraph after print edits; source approval stands. Private numeric phase codes
were deliberately omitted from the public chapter because they are not mapped
register fields. The independent whole-reader pass subsequently reread the entire integrated
chapter and accepted the source-selection/format/rate/loop/filter/mix journey,
all command/live/transfer boundaries and complete BLua assembly. It verified
all three initial findings corrected and independently reconstructed both
modules from the nine printed blocks. No instructional failures remain for
this chapter. This does not close the scheduled cross-chapter specification
and actual graphics-output illustration work in `docs/manual/README.md`.
