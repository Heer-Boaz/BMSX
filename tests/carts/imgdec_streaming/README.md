# Sustained ROM-to-VRAM streaming fixture

This independent cartridge repeatedly decodes eight distinct ROM images with the
production texture/IMGDEC encoders and cartlib upload path. No uncompressed image
is retained in guest RAM. The workload includes moving retained actor records,
GPU draws and four looping, interpolated PCM voices read from ROM. Direct16
images mix flat/checkered tiles with full RGB555 noisy tiles; CLUT4 images use a
restricted palette and upload that palette every frame.

Build against the exact BIOS used by the host, without rebuilding a gameplay ROM:

```sh
npm run test:exec -- tsx --tsconfig tsconfig.base.json \
  tests/conformance/imgdec_streaming/build.ts /tmp/streaming BIOS.rom direct16-128
npm run test:exec -- tsx --tsconfig tsconfig.base.json \
  tests/conformance/imgdec_streaming/ts_runner.ts BIOS.rom /tmp/streaming 120
```

Other workloads: `direct16-128-idle` (no actors), `direct16-128-four` (four
uploads/draws each frame), `direct16-128-four-silent` (the same four uploads,
without active voices), `direct16-256` (256x224) and `palette4-128`.
`streaming.json` records the configuration, compressed/decoded sizes and hashes.
The TS software reference checks every uploaded texture/CLUT word, rendered
frame/asset markers, uninterrupted guest progress and the configured audible or silent audio.

For a hardware-backend comparison, use the custom libretro host with GLES2,
rewind off and the same ROM/BIOS. Measure noise CRT with real audio separately
from CRT-off/no-audio controls. Do not include PNG capture calls in performance
runs. Host timing, present/drop and audio-underrun counts matter: guest-side
completion alone does not establish realtime host performance.

The host enables unpaced timeline execution only for a nonempty timeline and
without `--paced-timeline`. An empty `[]` keeps ordinary wall-clock pacing.
For a bounded unpaced control, place a capture beyond `--max-frames` in the
timeline: the timeline is active, but no PNG capture occurs during the run.
Keep host audio off for that control. Timed `retro_run` calls exclude the outer
pacer sleep; their duration alone does not establish unpaced throughput.

A capture timeline can contain `{"frame":100,"capture":true}` entries for
frames 100–103 and 200–203. Verify the actual displayed uploads:

```sh
npm run test:exec -- tsx --tsconfig tsconfig.base.json \
  tests/conformance/imgdec_streaming/verify_captures.ts /tmp/streaming CAPTURES \
  --reference CORE_REFERENCE_CAPTURES
```

Omit the reference option for noise-on captures, where only the explicit black/white
marker protocol is exact. With CRT disabled the optional comparison checks every
pixel. The asset's three-bit phase must match the independent sixteen-bit drawn
frame counter, and both must advance at every captured frame. The cartridge
reports `STREAM` counters every 1000 completed frames; that small reporting cost
remains part of the workload. It never stops streaming to improve a measurement.

The framebuffer software frontend captures the physical, integer-scaled output
surface rather than the core target. Use `--software-surface` to check its marker
protocol through that documented blit mapping. Do not compare its surface bytes
directly with core-target PNGs; full software/GPU VRAM parity belongs to the native
renderer parity harness. Hardware captures of identical timelines can be compared
exactly through `--reference`.
