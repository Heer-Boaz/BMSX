# bmsx_libretro_host

Minimal Linux **fbdev + evdev** libretro frontend for debugging on the SNES Mini.

Unlike RetroArch, this executable directly loads a libretro core via `dlopen()` and drives it through the libretro callbacks.

## Build (SNES Mini)

From repo root:

```bash
npm run build:platform:libretro-snesmini:debug
```

Artifacts are placed in `dist/`:

- `dist/bmsx_libretro.so`
- `dist/bmsx_libretro.info`
- `dist/bmsx_libretro_host`

## Run (SNES Mini)

```bash
./bmsx_libretro_host --core ./bmsx_libretro.so --no-game --backend software
./bmsx_libretro_host --core ./bmsx_libretro.so ./somegame.rom --backend software
```

Options:

- `--core <path>`: libretro core `.so` path (default: `./bmsx_libretro.so`)
- `--no-game`: call `retro_load_game(NULL)` (requires `supports_no_game`)
- `--system-dir <path>`: used for `RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY`
- `--save-dir <path>`: used for `RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY`
- `--backend software|gles2`: sets the `bmsx_render_backend` core option (host only provides software video)
- `--video fb|sdl`: `fb` uses `/dev/fb0` + evdev, `sdl` opens a window and uses SDL input (software-only)
- `--input-debug`: logs evdev events and the resulting RETRO_DEVICE_JOYPAD state

Input timelines may include `capture: true` entries. The host saves screenshots into a `screenshots/` subfolder next to the timeline JSON file. Headless runs currently ignore those capture markers.

SDL video support is enabled when SDL2 is available during the host build (non-cross builds only).
