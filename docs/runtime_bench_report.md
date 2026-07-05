# BMSX Runtime Bench Report

Last checked: 2026-07-05.

Source-verified read of the dual TS/C++ console runtime: is the machine
well-built, and do its numbers cohere into a console you would believe existed?
Every figure below is read from the machine source — headline rates are declared
constants in `machine/cpp/machine/model_registry.h`; per-frame figures are
derived from them at the NTSC field rate.

A rendered version of this report is published as an artifact:
<https://claude.ai/code/artifact/3de34898-ba37-4c6c-bea5-dc97ab81a219>.

## Verdict

Serious and internally coherent — not a toy. Retro budgets (KiB/MiB, work-unit
throttling) wrapped around a modern command-buffer GPU (passes, pipelines,
shader variants, stream/constant bindings). Strongest axis: machine-enforced
TS/C++ parity. One honest gap: there is no explicit pixel fill-rate model.

## Performance envelope

| Resource            | Declared rate     | Per frame (NTSC) | Character                     |
| ------------------- | ----------------- | ---------------- | ----------------------------- |
| CPU clock           | 50 MHz            | 834,167 cyc      | ~1 cyc/op → ~50 MIPS          |
| Geometry unit       | 16,384,000 wu/s   | 273,340 wu       | vertex / matrix transform     |
| Render unit (RPU)   | 25,600 wu/s       | 427 wu           | draw-call / pass submission   |
| DMA — bulk          | 26,214,400 B/s    | 427 KiB          | asset upload channel          |
| DMA — ISO           | 8,388,608 B/s     | 137 KiB          | streaming / command channel   |
| Image decoder       | 26,214,400 B/s    | 427 KiB          | compressed-texture decode     |
| Audio (APU)         | 44,100 Hz         | ~736 smp         | CD-rate, independent clock    |
| Main RAM            | 4 MiB             | —                | VRAM 2 MiB tex + 136 KiB stg  |
| Cartridge ROM       | ≤ 80 MiB          | —                | framebuffer 320 × 240         |

Sources: `PSX_CPU_FREQ_HZ`, `PSX_GEO_WORK_UNITS_PER_SEC`,
`PSX_VDP_WORK_UNITS_PER_SEC`, `PSX_DMA_BYTES_PER_SEC_{ISO,BULK}`,
`PSX_IMGDEC_BYTES_PER_SEC`, `APU_SAMPLE_RATE_HZ`, `PSX_RAM_BYTES`,
`PSX_VRAM_TEXTURE_BYTES`, `CART_ROM_SIZE`.

### Does it cohere?

The internal ratios are the real believability test, and they hold:

- **640 : 1** geometry-to-render ratio — the machine transforms ~640 vertices
  per unit of draw-submission budget. Built to push vertices and issue few
  draws, exactly like a transform-offloaded 3D console.
- **~3 CPU instructions per transformed vertex** (50 MIPS ÷ 16.4 M vtx/s) —
  geometry is genuinely offloaded to a dedicated unit; the CPU orchestrates.
- The shipped `carts/bare_metal_cart` demo spends **~85 of 427** render
  units/frame (2 passes, 9 draws, ~13 binds) — ~20% load. Believable working
  headroom, not a maxed-out or empty machine.

## How the numbers are charged

Figures are metered, not asserted. Each device converts CPU cycles into device
work through a drift-free rational accumulator with preserved carry
(`machine/scheduler/budget.h`):

```
work  = (unitsPerSec * cycles + carry) / cpuHz
carry = (unitsPerSec * cycles + carry) % cpuHz
```

Frame and vblank timing (`machine/runtime/timing/index.cpp`):

```
cyclesPerFrame(NTSC) = 50,000,000 / 59.94006 = 834,167 cyc
cyclesPerFrame(PAL)  = 50,000,000 / 50       = 1,000,000 cyc
vblankCycles = cyclesPerFrame - cyclesPerFrame * (renderHeight / totalScanlines)
```

Render-unit cost per command (`machine/devices/vdp/budget.h`, ceil-bucketed):

```
drawCost = 4 + ceil(verts/64) + ceil(instances/16) + ceil(indices/64)
passCost = 8   bindCost = 1   uploadCost = 2 + ceil(bytes/N)
```

## Build quality, by axis

### CPU / ISA + toolchain — solid

Register VM with threaded (computed-goto) dispatch over a fixed 4-byte
instruction word: `WIDE` prefix for extended operands, register-or-constant
operands, inline caches on table access. The typed pointer/MMIO path
(`LOAD_MEM`/`STORE_MEM`, access kinds Word/U8/U16LE/U32LE/F32LE/F64LE) means a
cart's `*word = …` is a real address-routed bus write. The system/cart split is
enforced in the ISA itself (`GETSYS`/`SETSYS` vs `GETGL`/`SETGL`), mirroring the
linker's two-image layout. The cart language is a systems language — pointers,
structs, `sizeof`/`offsetof`, `.data`/`.bss`/`.rodata` — compiled and linked
with relocations to a ROM image, not a script.

### Convincing as a console — yes, with one tell

The MMIO bank (`machine/bus/io.h`) is a coherent machine a firmware would
recognise: VDP (FIFO + command doorbell + retired-render window), IRQ, DMA,
image decoder, geometry unit (Q16, per-stream strides), input (HID-usage key
bitmap, pointer, 4 pads × 7 words, rumble port), APU (filters, generators), with
fault latches throughout.

The tell: this is two machines fused. The lower layer (pointers, `.bss`, MMIO,
DMA, IRQ) is strikingly authentic bare-metal, but the CPU underneath is a
*managed* VM — NaN-boxed values, tables, closures, mark-sweep GC. No real 1990s
silicon had garbage-collected tables as a CPU primitive. Convincing as a serious
modern fantasy console; not as literal period hardware. The demo carts lean
almost entirely on the authentic layer.

### TS / C++ parity — strongest axis

Parity is a structurally enforced contract (`scripts/core_parity_manifest.json`,
3,951 lines), checked in CI by `scripts/audit_core_parity.ts`: 71 symbol-parity
+ 28 shape-parity + method-parity entries; 30 + 8 + 13 no-heap regions/functions
(allocation discipline statically enforced); save-state schema parity, shader
parity (WebGL ↔ GLES2), Lua-VDP-ABI parity, plus forbidden/required-substring
guards. This goes further than most single-runtime emulators.

### Timing model — rate-accurate, not per-pixel

A deadline-driven, cycle-budgeted, drift-free rate model. The CPU runs in slices
bounded by the next device deadline (`machine/scheduler/`); devices accrue work
at exact rational rates against consumed cycles. The device scheduler is a
binary min-heap of deadlines in CPU-cycle units with generation counters for
lazy stale-timer invalidation; the CPU yields when a device deadline falls
inside the current slice. Refresh is authentic (NTSC 59.94006 Hz / 262 lines,
PAL 50 Hz / 313 lines) and the vblank window is scanline-derived. This is *not*
per-cycle/per-pixel accurate like Mesen — calling it "cycle-accurate" overstates
it — but it is far more rigorous than frame-level.

## Fill-rate — the one unmodeled axis

Confirmed by exhaustion: the RPU frame cost has no width·height, viewport, area,
or pixel term anywhere (`machine/devices/vdp/rpu.cpp`, `vdp.cpp`). A frame
completes once `workRemaining` (= command-complexity cost) is drained by granted
work units; the rasterizer then runs to completion regardless of pixels touched.
A fullscreen triangle and a three-pixel triangle with identical vertex/index
counts cost the same.

Consequence: the machine is purely **draw-call- and geometry-bound**. Real
consoles hit a **fill-rate** wall first (pixels × blend × texture-fetch per
second), especially at 320×240 with overdraw. Heavy overdraw is effectively free
here — the one place cart-observable timing diverges from real silicon.

Recommendation (aligns with this repo's own "cart-observable facts are hardware
facts … timing edges" contract — a frame held longer under overdraw *is* such an
edge): add a coverage term to the render cost.

```
drawCost += ceil(coveredPixels / K)     // K = fill-units per pixel-block
// or a clear/pass cost proportional to viewport area:
passCost += ceil((vpW * vpH) / K)
```

Even a coarse bounding-box-area estimate introduces fill-pressure and gives the
envelope a believable pixel-throughput ceiling.

## Corrections log

This report's first draft was wrong on the fundamentals; honesty runs both ways.

- **Was:** "A Lua VM as CPU; cartridges are Lua programs." Wrong — cartridges
  are a compiled systems language lowered to a custom 4-byte register ISA and
  run as a ROM image against memory-mapped devices.
- **Was:** "Cycle-accurate." Overstated — corrected to a rate-accurate,
  deadline-scheduled model.
- **Held:** Scanline-derived vblank — initially doubted, then verified true.
- **Added:** Performance envelope and fill-rate analysis — the pieces that make
  (or break) the machine's believability as real hardware.
