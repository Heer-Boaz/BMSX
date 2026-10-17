# APU cartridge example

This cartridge uses the BIOS's actual BLua conventions: named readonly data,
typed word ports, the existing central `apu_command_registers` / `badp_header`
types, explicit BSS and predicate waits. `cartlib/apu` requires the ordinary DMA
and IRQ modules. Their DMA callbacks remain installed; the cartridge registers
only its APU event callback. There is no second global `irq` handler.

The four routes own slots 2–5 and channel 0 for the duration of the example:

1. **ROM PCM16.** A named 32-sample signed little-endian mono waveform plays at
   7040 source frames/second, looping the half-open interval `[0,16)`: a 440 Hz
   authored period. Parameters are copied as whole words into the staging bank,
   with the actual readonly source address written explicitly and CMD last.
   The code reselects slot 2 after command admission, performs a live signed
   Q12 gain write, pauses, observes the continuing sample clock with the slot
   still active, resumes, and uses a 441-output-frame fade to obtain an end event.
2. **Private sample RAM.** `apu.upload` submits sixteen words through the fixed
   transfer port. `dma.wait0_idle` completes submission; a separate
   TRANSFER_BUSY predicate waits for the last FIFO-to-RAM batch. Download uses
   `apu.download` and the same DMA wait, then STOP cancels unneeded prefetch.
   All sixteen downloaded words are retained. A separate PLAY binds the same
   PCM metadata at source descriptor address `40000000H`; no CPU load/store
   attempts to treat that address as main RAM. This loop also fades to an end.
3. **Fractional square.** A one-frame loop at source rate 440 Hz and unity Q16
   step advances fractional phase through the square generator's half-duty
   comparison. It is not a two-frame PCM square. Gain is one quarter; the
   running loop is stopped with a finite fade.
4. **Normally packed BADP.** The authored mono PCM16 `res/audio/tone.wav` is
   processed by the existing resource producer. The generated
   `bmsx/assets.audio_tone_addr` / `_len` symbols address its encoded BADP bytes
   directly. The existing typed BADP header supplies source metadata. This
   known one-shot uses no loop and ends naturally; no hand-authored compressed
   payload, local header decoder or asset-lookup facade is involved.

The APU callback retains kind, slot, source address and hardware event sequence
before advancing a BSS service sequence. Each fade/natural-end wait snapshots
that sequence before issuing the stop or PLAY. Only one slot ends at a time;
this deliberately does not pretend that the single hardware event latch is a
FIFO. Command capture clears staging selection to slot zero, so every bank
observation explicitly reselects the intended slot. Disabled VBlank remains
pending through the enabled DMA/APU services.

```sh
npm run build:product:node-headless-tooling -- --debug
npm run build:toolchain:bios -- --debug
npm run build:toolchain:cart -- apu_manual --debug
npm run headless:test -- apu_manual tests/carts/apu_manual/apu_manual_assert.lua
```

The ordinary integration suite checks the raw retained addresses and bank
words, all sixteen transfer words, separate upload submission/commit, download
prefetch cancellation, sample-clock progress, four hardware end events, cleared
ended banks, preserved disabled VBlank and absence of APU faults. It checks the
BADP asset's produced version, channel/rate/frame count, extent and seek offsets.

These are guest programming/data-path observations, **not audible/speaker
proof**. The normal headless output sink discards sound. Selected raw gain and
an advancing clock do not by themselves prove a particular DAC waveform or the
paused voice's private cursor; those require separate output-datapath evidence.
The waits do not specify fixed CPU routine or IRQ-delivery latency.
