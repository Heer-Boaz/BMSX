# bmsx_libretro_host

Linux **fbdev + evdev** libretro frontend for the SNES Mini.

Unlike RetroArch, this executable directly loads a libretro core via `dlopen()` and drives it through the libretro callbacks.

## Build (SNES Mini)

From repo root:

```bash
npm run import:snesmini-rootfs -- /path/to/extracted-rootfs-or-tar
npm run setup:snesmini
npm run build:platform:libretro-snesmini
npm run build:libretro-host-snesmini
```

The imported root must come from the target device. The compile SDK and its
modern C++ frontend are generated from a pinned, package-hashed recipe and are
separate from that immutable runtime snapshot. The snapshot is never compiler
input; every artifact is audited against it before it is accepted.

Accepted target releases are published atomically:

- `dist/snesmini/core/current/libretro_bmsx.so`
- `dist/snesmini/core/current/libretro_bmsx.info`
- `dist/snesmini/host/current/bmsx_libretro_host`

Each `current` link points at an immutable content-addressed release containing
an `acceptance.txt` with the immutable builder image, toolchain, build type,
complete runtime-root, and artifact hashes. The core record also binds its
private smoke-ROM hashes and positive frame count. A failed build or audit never
changes that link.

For debug artifacts use:

```bash
npm run build:platform:libretro-snesmini:debug
npm run build:libretro-host-snesmini:debug
```

Debug builds publish to `core/debug` and `host/debug`, never the Release
`current` links. Publication retains only these selected outputs and explicit
symlinks under each product's `pins/` directory. The loader owns already loaded
native code; removing an unreferenced pathname does not unmap a running core.
To retain a release's files for later loading or debugging, add a named symlink
there to `../releases/<release-id>` before publishing another build.
There is no recent-build history. Inspect collection with
`python3 scripts/snesmini/releases.py collect dist/snesmini/core`; add `--apply`
to remove the listed unreferenced releases. The same command accepts the host
product directory.

The core build executes the target loader, core, privately built BIOS and cart,
and software frames on the PC before publication. The host build separately
enters the real ARM host CLI through that same imported target loader after its
full runtime closure has passed the ABI audit. Framebuffer, evdev, GLES, audio,
and timing still require the real SNES Mini.

## Deploy games into Hakchi and Clover

Close Hakchi on the PC and return the mini to its Clover menu. From Linux/WSL:

```bash
npm run deploy:snesmini -- \
  --hakchi-dir /path/to/hakchi2 \
  --ssh root@169.254.13.37 --build
```

`--build` first invokes the existing Release core, host and cartridge build
entrypoints. Omit it to install the selected completed products without building.
The default profile, `deploy/snesmini.json`, installs **pietsona** (`2025`),
**Nemesis S** and **Pietious** in the existing **More games...** folder. Their
stable Clover IDs, display names and source artwork live in this deployment
profile; no cartridge manifest icon convention is introduced here. `--profile`
selects another profile. A game's optional `artifact` pins an exact ROM artifact;
otherwise its current Release build is selected from the build store.

The script updates the PC's `games` collection (`games_snes` when separate local
storage is enabled) and its selected-games list.
It preserves original-game selections, other consoles and folder settings, so
a later Hakchi sync retains these titles. `--collection-only` updates just this
PC collection and does not connect to the mini. It still requires completed
native host/core and ROM products.

The mini uses Hakchi's linked-sync layout: payloads in `.storage/<code>` and
desktop entries in the configured menu folder. Each title has a small Clover
entrypoint which `exec`s the shared custom host/core in `/root`, with GLES2 and
its own save directory. Clover appends Nintendo-emulator state, transition and
rollback arguments; the entrypoint supplies only the custom host's argument
vector, without passing those incompatible arguments through or weakening its CLI.
Automatic rewind remains disabled by the Mini core's default policy. The old
`/root/run.sh` is no longer needed by these menu entries and is left untouched.

Only content whose SHA-256 differs is transferred or replaced. Transfers use
SSH and tar, not SCP/SFTP; payload checksums are checked before installation.
Files publish by rename while Clover is stopped, and Clover restarts afterward.
An already identical install does not restart the menu or rewrite files. The
installer refuses a running BMSX game and retains 30 MiB of NAND headroom for
saves, including the peak space needed to replace an existing file. No games,
save data or legacy `/root/*.rom` files are deleted.

## Clover launch (SNES Mini)

The libretro core remains independently installable. Install the accepted host
artifact as an executable and let the game's Clover desktop entry invoke its
platform entrypoint:

```ini
[Desktop Entry]
Type=Application
Exec=/bin/sh /var/games/CLV-S-BMSX/launch.sh
Path=/var/saves/CLV-S-BMSX
```

The generated `launch.sh` supplies the actual installed core, game and save
paths and replaces its shell with the custom host. It does not forward Clover's
Nintendo-emulator arguments. Do not route the title through RetroArch.

Options:

- `--core <path>`: libretro core `.so` path (default: `./libretro_bmsx.so`)
- `--no-game`: call `retro_load_game(NULL)` (requires `supports_no_game`)
- `--system-dir <path>`: used for `RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY`
- `--save-dir <path>`: used for `RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY`
- `--backend software|gles2`: sets the `bmsx_render_backend` core option
- `--core-option <key> <value>`: sets any core option before initialization;
  repeat for multiple options. Dedicated host flags take precedence. For a
  noise-only CRT measurement, keep CRT and noise on, and set
  `bmsx_crt_color_bleed`, `bmsx_crt_scanlines`, `bmsx_crt_blur`,
  `bmsx_crt_glow`, `bmsx_crt_fringing` and `bmsx_crt_aperture` to `off`.
- `--video fb|sdl`: `fb` uses `/dev/fb0` + evdev; `sdl` provides windowed software or GLES2 video and SDL input
- `--hidden-window`: keeps the SDL window unmapped while retaining its GLES2 context for unattended runs
- `--input-timeline <path>`: replays an explicit input timeline
- `--paced-timeline`: keeps an active timeline on the normal host deadline instead of running it as fast as possible
- `--max-frames <count>`: owns run lifetime explicitly, including when the timeline has ended
- `--timing-report`: prints fixed-size `retro_run`, core-without-presentation, final-blit and swap histograms at shutdown; the GLES2 backend additionally reports GX CPU-to-VRAM command/call/byte/time totals
  It retains the 32 slowest measured calls with their host-frame numbers,
  presentation times and matching GX upload counters. Samples use fixed
  storage; no per-frame log output is emitted.
  The ALSA underrun line covers the same measured window; `before_timing` counts
  earlier underruns. The final `audio stats` line covers the entire session,
  including teardown.
- `--timing-warmup <count>`: excludes the first frames from the timing report
- `--rewind on|off`: sets the `bmsx_rewind_recording` core option. Automatic
  recording defaults to off on SNES Mini and on elsewhere. Disabling it removes
  periodic rewind checkpoints and their history storage, not manual save states.
- `--crt-postprocessing on|off`: sets the `bmsx_crt_postprocessing` core option
- `--crt-noise on|off`: sets the `bmsx_crt_noise` core option
- `--dither off|rgb565|msx10`: sets the `bmsx_dither` core option

Input timelines may include `capture: true` entries. Both the libretro host and headless runner save `.png` screenshots into a `screenshots/` subfolder next to the timeline JSON file.

Timeline frame `N` labels the boundary after accepted cartridge presentation `N`. Input posted at that boundary affects the next accepted presentation, and a capture records that next presentation under marker `N`. The clock starts when cartridge execution first becomes active; BIOS output is not part of a cartridge timeline.

Native host builds require SDL2 and provide the SDL video, audio, and input path. Cross-compiled SNES Mini host builds use fbdev and evdev without SDL.

## Host controls

- Select+Start released before 500 ms opens or closes the core-options menu;
  holding it for 500 ms opens rewind, when recording is enabled, without first
  opening the menu. Release
  leaves rewind open; a fresh Start accepts, and the east action button cancels.
  Right Ctrl+Right Alt has the same short/hold behavior on a physical keyboard.
- Select+L opens or closes the BIOS supervisor terminal. A partial chord
  remains normal gameplay; once both buttons are held, the host consumes both
  until they are fully released. The core receives a dedicated supervisor line,
  not a synthetic F2 key.
- L+R+Start held for two seconds exits the direct host.
