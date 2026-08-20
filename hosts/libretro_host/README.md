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

The core build executes the target loader, core, privately built BIOS and cart,
and software frames on the PC before publication. The host build separately
enters the real ARM host CLI through that same imported target loader after its
full runtime closure has passed the ABI audit. Framebuffer, evdev, GLES, audio,
and timing still require the real SNES Mini.

## Clover launch (SNES Mini)

The libretro core remains independently installable. Install the accepted host
artifact as an executable and let the game's Clover desktop entry invoke it
directly:

```ini
[Desktop Entry]
Type=Application
Exec=/root/bmsx_libretro_host --core /etc/libretro/core/libretro_bmsx.so --system-dir /etc/libretro/system --save-dir /var/saves/CLV-S-BMSX /var/games/CLV-S-BMSX/game.rom
Path=/var/saves/CLV-S-BMSX
```

Use the actual installed core, game, and save paths for the Clover title. Do not
route this command through RetroArch or a `/bin/sh` wrapper.

Options:

- `--core <path>`: libretro core `.so` path (default: `./libretro_bmsx.so`)
- `--no-game`: call `retro_load_game(NULL)` (requires `supports_no_game`)
- `--system-dir <path>`: used for `RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY`
- `--save-dir <path>`: used for `RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY`
- `--backend software|gles2`: sets the `bmsx_render_backend` core option
- `--video fb|sdl`: `fb` uses `/dev/fb0` + evdev; `sdl` provides windowed software or GLES2 video and SDL input
- `--hidden-window`: keeps the SDL window unmapped while retaining its GLES2 context for unattended runs
- `--input-timeline <path>`: replays an explicit input timeline
- `--paced-timeline`: keeps an active timeline on the normal host deadline instead of running it as fast as possible
- `--max-frames <count>`: owns run lifetime explicitly, including when the timeline has ended
- `--timing-report`: prints fixed-size `retro_run`, core-without-presentation, final-blit and swap histograms at shutdown; the GLES2 backend additionally reports GX CPU-to-VRAM command/call/byte/time totals
- `--timing-warmup <count>`: excludes the first frames from the timing report
- `--crt-postprocessing on|off`: sets the `bmsx_crt_postprocessing` core option
- `--crt-noise on|off`: sets the `bmsx_crt_noise` core option
- `--dither off|rgb565|msx10`: sets the `bmsx_dither` core option

Input timelines may include `capture: true` entries. Both the libretro host and headless runner save `.png` screenshots into a `screenshots/` subfolder next to the timeline JSON file.

Timeline frame `N` labels the boundary after accepted cartridge presentation `N`. Input posted at that boundary affects the next accepted presentation, and a capture records that next presentation under marker `N`. The clock starts when cartridge execution first becomes active; BIOS output is not part of a cartridge timeline.

Native host builds require SDL2 and provide the SDL video, audio, and input path. Cross-compiled SNES Mini host builds use fbdev and evdev without SDL.

## Host controls

- Select+Start opens or closes the core-options menu.
- Select+L opens or closes the BIOS supervisor terminal. A partial chord
  remains normal gameplay; once both buttons are held, the host consumes both
  until they are fully released. The core receives a dedicated supervisor line,
  not a synthetic F2 key.
- L+R+Start held for two seconds exits the direct host.
