# bmsx_libretro_host

Minimal Linux **fbdev + evdev** libretro frontend for debugging on the SNES Mini.

Unlike RetroArch, this executable directly loads a libretro core via `dlopen()` and drives it through the libretro callbacks.

## Build (SNES Mini)

From repo root:

```bash
npm run build:platform:libretro-snesmini:debug
```

Artifacts are placed in `dist/`:

- `dist/libretro_bmsx.so`
- `dist/libretro_bmsx.info`
- `dist/bmsx_libretro_host`

## Run (SNES Mini)

```bash
./bmsx_libretro_host --core ./libretro_bmsx.so --no-game --backend software
./bmsx_libretro_host --core ./libretro_bmsx.so ./somegame.rom --backend software
```

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
- `--gles2-timing-report`: prints fixed-size `retro_run`, core-without-presentation, final-blit and swap histograms for the GLES2 callback path at shutdown
- `--timing-warmup <count>`: excludes the first frames from the timing report
- `--input-debug`: logs evdev events and the resulting RETRO_DEVICE_JOYPAD state
- `--crt-postprocessing on|off`: sets the `bmsx_crt_postprocessing` core option
- `--crt-noise on|off`: sets the `bmsx_crt_noise` core option

Input timelines may include `capture: true` entries. Both the libretro host and headless runner save `.png` screenshots into a `screenshots/` subfolder next to the timeline JSON file.

Native host builds require SDL2 and provide the SDL video, audio, and input path. Cross-compiled SNES Mini host builds use fbdev and evdev without SDL.
