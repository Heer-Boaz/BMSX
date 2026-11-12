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

## Remote input

The Mini can also be controlled over SSH without installing a helper or building
an ARM executable. This writes input events to the existing Linux input devices;
the controller must be connected for controller commands.

```sh
npm run control:snesmini -- --ssh root@169.254.13.37 button start
npm run control:snesmini -- --ssh root@169.254.13.37 button left
npm run control:snesmini -- --ssh root@169.254.13.37 button select start
npm run control:snesmini -- --ssh root@169.254.13.37 button a --player 2
npm run control:snesmini -- --ssh root@169.254.13.37 button reset
npm run control:snesmini -- --ssh root@169.254.13.37 reset
npm run control:snesmini -- --ssh root@169.254.13.37 keyboard
```

Buttons are named by the SNES controller labels: `a`, `b`, `x`, `y`, `l`, `r`,
`select`, `start`, `left`, `right`, `up`, `down` and `reset`. Give multiple
names to press them together; controller buttons are sent in one input report.
RESET can be combined with controller buttons, but uses a separate device and
SSH stream, so its timing relative to the controller is not exact. Player 1 is
the default.
The physical Clovercon driver continues polling and can release an injected
button, so the command reasserts it for 100 ms by default (`--duration-ms`
changes that interval). This may produce multiple press/release edges, not one
precise continuous hold; menu navigation may repeat and gameplay timing is not
guaranteed.

`keyboard` opens a small focus window; use the physical PC keyboard rather than
clicking on buttons. The arrow keys are the D-pad, A/B/X/Y are the face buttons,
L/R are the shoulders, Enter is Start, Backspace is Select and F5 is RESET.
Closing the window or switching focus releases held buttons. This mode requires
Python's Tk support and a connected Clovercon; it does not stream video. The
same physical-driver limitation applies to held keys and long combinations.
If SSH disconnects, the window stays open; F9 reconnects without replaying
previous button presses.

`button reset` and the shorter `reset` command send the same two-key press and
release as the physical RESET switch. RESET alone defaults to 150 ms; when
combined with controller buttons it uses the selected controller interval.
It has the same effects, including ending a running game and potentially losing
unsaved progress.

## Clover suspend points

The Mini launcher disables background rewind recording and passes Clover's
suspend-point paths to the host. After RESET, press Down in the Clover menu and
save the temporary point to a slot with Y. Select a saved point and press Start
to resume the game. The host stores a compressed libretro state, a screenshot
and the accumulated playtime; Clover manages the slots.

Holding Select and Start together on one controller for 500 ms exits the game
through the same suspend-point path as RESET. A shorter press keeps the BMSX
host-menu shortcut. This replaces the long-press rewind shortcut for Clover
launches; standalone libretro hosts keep their existing shortcuts.

Rewind is not implemented for these points. Clover still displays its X Rewind
option, but selecting it returns to the menu without changing the point. State
compatibility across different core, BIOS or cartridge builds is not guaranteed.

## Core build defaults

The standard SNES Mini core build explicitly enables native CPU execution,
background native compilation and hybrid rendering. GX drawing and scanout use
the exact software renderer; GLES2 uploads that frame and runs CRT postprocessing
and presentation. Selecting GLES2 in the host therefore still enables GPU CRT
effects, not CPU CRT processing.

The compiler has one bounded background job. Only the emulation thread publishes
completed code and handles invalidation. The separate emulation/render submission
worker described below remains opt-in; it is not required by background compilation
or hybrid rendering.

Other platform builds keep synchronous compilation and hardware GLES2 drawing by
default. Direct CMake builds can select `BMSX_NATIVE_COMPILER_WORKER` and
`BMSX_GLES2_SOFTWARE_GX` independently. Set the latter to `OFF` when comparing the
hardware drawing modes below. This is a build choice, not an automatic fallback.

Rebuild the BIOS and cartridges with the current toolchain when updating the core:
the shared activation-stack call ABI requires matching program images. The deploy
script's `--build` route builds the selected carts and BIOS together with the core.

## Integrated GLES2 draw-target comparison

In hardware-drawing builds (`BMSX_GLES2_SOFTWARE_GX=OFF`), the libretro core reads
`BMSX_GLES2_TARGETS` once when creating its GLES2 backend. This setting has no
effect on the hybrid renderer:

| Value | Drawing storage | Destination blending |
| --- | --- | --- |
| `full` | Full nibble VRAM texture | Exact shader arithmetic |
| `nibbles` (SNES Mini hardware-drawing default) | Two disjoint cached nibble regions | Exact shader arithmetic |
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
Cached modes pack the admitted command interval's raw upload payloads into
three temporary host-side textures (1 MiB each, 3 MiB combined). All used pages
are uploaded before any transfer or drawing command in that interval executes;
intervening draws no longer cause an upload source to be rewritten. Transfers
still update VRAM in command order. Single-command pages upload directly from
command storage; shared pages use the existing packing scratch. A fixed 32 KiB
command-span table selects each payload's page and offset. These are host staging
resources, not guest VRAM capacity or measured total renderer memory. The textures
rotate between intervals, but reusing a texture can still stall if the GPU has
not finished the previous interval. Shared VRAM
textures and drawing caches use additional host memory; the cartridge-visible
capacity remains the one specified in the [GPU manual](../../docs/book1/gpu.md).
The full-target route retains one staging texture.

For controlled comparisons, set the variable before launching the custom host,
and replay the same input timeline in a fresh process for each value. Keep CRT
options, audio, pacing and warmup identical. Run timing separately from capture:
screenshots synchronize GPU readback and distort frame times. These integrated
modes remain available independently of the synthetic experiment below; an
unfavorable result on one workload does not remove another representation.

## Experimental threaded GLES2 submission

`BMSX_GLES2_THREADED=1` enables the C++ libretro emulation worker. The frontend
thread keeps its GL context, input polling, audio/video callbacks, menu and rewind.
The worker publishes completed GX command prefixes into two bounded, owned raw-word
buffers while the frontend submits earlier work. An ordered Present packet owns
the selected tail commands, latched scanout, history-commit mode and resource-usage
values; scanout, CRT and live overlays consume it without borrowing the Runtime.
Selection still follows the fully admitted current cycle grant: no next-frame
input, extra guest grant, audio queue or one-frame display latency is introduced.
This is intra-frame submission overlap, not a continuous cross-frame pipeline.
Readback and supervisor boundaries wait for the ordered publications; every frame
returns machine ownership before capture,
restore or context teardown. The TypeScript execution route is unchanged.

For the 2 MiB VRAM model, the command buffers plus snapshot/readback transport
scratch use approximately 7.28 MiB of additional host RAM, excluding the worker
stack and renderer resources. Guest VRAM capacity and device timing do not change.
The route is opt-in for controlled comparisons; local correctness coverage is not
a claim of faster SNES Mini frame times.

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
