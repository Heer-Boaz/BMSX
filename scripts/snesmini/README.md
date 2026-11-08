# SNES Mini deployment

Install completed Release carts, the accepted libretro core and the custom host
directly over SSH:

```sh
npm run deploy:snesmini -- --ssh root@169.254.13.37
```

This does not require the Windows Hakchi application or its PC collection. The
Mini must already have the modified firmware, SSH access and Clover menu layout
used by this installer. Exit any running BMSX game before deploying. Changed
files are installed with checksums; existing saves and unrelated games remain
untouched, and the Clover menu is restarted after installation.

Add `--build` to build the Release carts, core and host first. The default
`deploy/snesmini.json` selects games, stable menu IDs, folder and artwork;
`--profile <file>` selects another profile.

Optionally keep a PC Hakchi collection in sync too:

```sh
npm run deploy:snesmini -- --ssh root@169.254.13.37 \
  --hakchi-dir /mnt/c/Users/boazp/apps/hakchi2
```

Only this optional PC publication requires Hakchi to be closed. To update just
the PC collection, use `--hakchi-dir <directory> --collection-only` without SSH.
A later Hakchi synchronization uses that PC collection, so update it explicitly
if it should retain changes made by direct SSH deployments.

## Integrated GLES2 draw-target comparison

The libretro core reads `BMSX_GLES2_TARGETS` once when creating its GLES2 backend:

| Value | Drawing storage | Destination blending |
| --- | --- | --- |
| `full` | Full nibble VRAM texture | Exact shader arithmetic |
| `nibbles` (SNES Mini default) | Two disjoint cached nibble regions | Exact shader arithmetic |
| `rgb5` | Two disjoint cached RGB5_A1 regions | Exact shader arithmetic |
| `rgb5-mali` | Two disjoint cached RGB5_A1 regions | Mali-400 hardware blend profile; mask-check uses the exact shader |

Other platform builds default to `full`. The `rgb5-mali` profile is available
only in the SNES Mini build. Its blend
constants are specific to the tested Mini driver, not a portable GLES2 guarantee.
Semi-transparent textures use separate opaque and blended texel passes, while
overlapping primitives retain command order.

All cached modes retain exact nibble storage for shared VRAM. Texture-source
reads, copies and CPU readbacks materialize overlapping dirty regions; writes
invalidate them. Scanout reads cached pixels directly, and snapshots materialize
every dirty region. No cartridge, DMA timing or save-state format is changed.
Cached modes stage uploads through three temporary host-side upload textures
(1 MiB raw-word capacity each, 3 MiB combined), keeping adjacent transfers on separate storage
rather than immediately overwriting a queued draw's upload source. This is
staging capacity, not guest VRAM capacity or measured total renderer memory. Shared VRAM
textures and drawing caches use additional host memory; the cartridge-visible
capacity remains the one specified in the [GPU manual](../../docs/book1/gpu.md).
The full-target route retains one staging texture.

For controlled comparisons, set the variable before launching the custom host,
and replay the same input timeline in a fresh process for each value. Keep CRT
options, audio, pacing and warmup identical. Run timing separately from capture:
screenshots synchronize GPU readback and distort frame times. These integrated
modes remain available independently of the synthetic experiment below; an
unfavorable result on one workload does not remove another representation.

## Independent GLES2 VRAM experiment

The opt-in `bmsx_gles2_vram_experiment` CMake target probes RGBA4 nibble storage,
RGB5_A1, normalized RGBA8 and shifted RGBA8. It does not change or deploy a core:

```sh
cmake --build build-cpp-tests --parallel 6 --target bmsx_gles2_vram_experiment
npm run test:exec -- env EGL_PLATFORM=surfaceless LIBGL_ALWAYS_SOFTWARE=1 \
  build-cpp-tests/bmsx_gles2_vram_experiment --measure
```

An ARM build uses the same target in the existing SNES Mini cross-build tree.
Run that executable with `--fb` on the Mini while Clover is stopped, and always
restore Clover afterward. `--measure` adds timings; omit it for correctness only.

The probe queries actual attachment channel widths and checks all 65,536 words,
CLUT4/8 reconstruction, raw copies, masked writes and per-texel transparency
against the software word operations. Hardware-blend cases include every
32-by-32 channel pair, both mask bits, force-mask, opaque/semi-transparent texels,
and retained multi-step results. RGBA8 additionally tests all 256 physical
destination values against every five-bit foreground value. Candidate mismatch
counts are results, not successful correctness tests or a renderer selection.

Timings use completed offscreen work, five warmups and 24 samples. The sync
probe copies the same 128-by-128 region ten times at both target sizes. Synthetic
2D/3D probes submit 256/1,536 triangles over 320-by-240 pixels, include a readout
pass and compare final words against the nibble-shader run. The hybrid path
splits opaque and semi-transparent texels within disjoint layers and retains
shader destination reads for mask-check. This is not a stencil implementation.
These probes exclude BMSX command setup, exact Q12 interpolation, DMA, PCRTC
composition and CRT; their timings are not cartridge FPS or a complete backend
benchmark. GL frame completion is included; readback/verification is not timed.
