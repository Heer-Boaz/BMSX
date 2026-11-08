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
uploads/draws each frame), `direct16-256` (256x224) and `palette4-128`.
`streaming.json` records the configuration, compressed/decoded sizes and hashes.
The TS software reference checks every uploaded texture/CLUT word, rendered
frame/asset markers, uninterrupted guest progress and non-silent mixed audio.

For a hardware-backend comparison, use the custom libretro host with GLES2,
rewind off and the same ROM/BIOS. Measure noise CRT with real audio separately
from CRT-off/no-audio controls. Do not include PNG capture calls in performance
runs. Host timing, present/drop and audio-underrun counts matter: guest-side
completion alone does not establish realtime host performance.

A capture timeline can contain `{"frame":100,"capture":true}` entries for
frames 100–103 and 200–203. Verify the actual displayed uploads:

```sh
npm run test:exec -- tsx --tsconfig tsconfig.base.json \
  tests/conformance/imgdec_streaming/verify_captures.ts /tmp/streaming CAPTURES \
  SOFTWARE_REFERENCE_CAPTURES
```

Omit the last argument for noise-on captures, where only the explicit black/white
marker protocol is exact. With CRT disabled the optional comparison checks every
pixel. The asset's three-bit phase must match the independent sixteen-bit drawn
frame counter, and both must advance at every captured frame. The cartridge
reports `STREAM` counters every 1000 completed frames; that small reporting cost
remains part of the workload. It never stops streaming to improve a measurement.
