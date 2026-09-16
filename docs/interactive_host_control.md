# Interactive host control

A persistent, loopback-only connection delivers **user I/O**, not editor commands,
Lua calls or heap access. Develop the Studio with repository tools; exercise game
creation through this interface and the ordinary UI. Missing operations are
product work, not reasons to bypass the UI.

## Run

```sh
npm run build:product:node-headless-tooling -- --debug
node dist/host_headless_tooling.debug.js --control 0 --studio-workspace "$PWD" nemesis_s
# Native frontend (no TypeScript Studio):
build-libretro-host-wsl/bmsx_libretro_host --core build-libretro-wsl/libretro_bmsx.so \
  dist/nemesis_s.debug.rom --system-dir dist --video sdl --hidden-window --control 0
node scripts/host_control.mjs PORT
```

Build BIOS/cart ROMs first. The host prints its selected port and screenshot
directory. Omit `--studio-workspace` for TS gameplay/quickmenu only. Studio uses
real workspace files; no global `fetch` replacement. One client stays connected
between decisions; disconnect releases its held input. Normal host pacing
continues without requests. There is no implicit test timeout.

## JSON lines

The client adds numeric request IDs. Requests execute in order; successful
actions print `{id,result}` and errors abort the rest of that JSON line. Pointer
coordinates refer to captured host-surface pixels. A line can contain one action
or an array. Client gestures expand into the same wire requests on either host;
press, motion and release acknowledgements preserve their host-frame boundaries.

| client `execute` | fields |
| --- | --- |
| `press` | physical `keys`, e.g. `ControlLeft+KeyS`; releases the chord after its press frame |
| `click` | `x`, `y`, optional `button` (default `primary`) |
| `drag` | `path`: `[[x,y], ...]`, optional `button`; one host frame per point |
| `paste` | `text`; sets clipboard, then presses Ctrl+V (does not select or edit directly) |

Low-level wire requests remain available for holds across decisions:

| `execute` | fields | result |
| --- | --- | --- |
| `input` | `events`: key `{type:'key',code,down}`, pointer `{type:'pointer',x,y}`, button `{type:'button',button,down}`, wheel `{type:'wheel',deltaY}` | `{hostFrame}` after input processing |
| `wait` | positive integral `frames` | `{hostFrame}` after host iterations, not guest ticks |
| `capture` | — | `{presentationFrame,width,height,path}` for the next presentation |
| `clipboard-set` / `clipboard-get` | `text` for set | ordinary clipboard; native reports unsupported |
| `quit` | — | acknowledgement, then shutdown |

Keys use DOM physical codes. Buttons: `primary`, `secondary`, `aux`, `back`,
`forward`; positive wheel is down. Select+RB opens Studio:

```json
[{"execute":"press","keys":"ControlRight+ShiftRight"},{"execute":"capture"}]
```

Captures show normal game/IDE/menu pixels. Input acknowledgement does not imply
that asynchronous editor queries have finished. Clipboard-set does not edit a
document: use the normal Paste shortcut. For an automation PTY, use
`stty -icanon -echo; node scripts/host_control.mjs PORT` so the terminal driver
does not truncate long JSON lines; ordinary piped stdin needs no terminal setup.

## Authoring regression

`npm run test:ide-authoring` builds the required artifacts incrementally and runs
Studio in an isolated workspace. The test uses this same client for all edits:
Ctrl+comma opens files, Ctrl+N creates Lua files, clipboard paste changes source,
and the Command Palette starts a program, applies Hot Resume and reboots it.
It checks saved files, actual rendered colors and guest output through new module
imports, BIOS source edits, Undo/Redo, syntax-error repair and rejected
live-continuation changes.
It has no editor-model, command-service or machine-state mutation API. Screenshots
remain under the reported `.bmsx/control/screenshots/` directory.

## Owners and references

| Surface | TypeScript | Native frontend |
| --- | --- | --- |
| held input | `RemoteInput` → normal host input | independent `keyboard_input` source / remote pointer → libretro callbacks |
| frame completion | `runHostFrame` / `runWorkbenchHostFrame` | `main` / `retro_run` |
| screenshot | `HeadlessGPUBackend` final presentation | `video_presenter` final surface/default framebuffer |

No machine/cartlib/ROM ABI changes. Input polling retains state; screenshots and
JSON allocations are request-driven. Storage uses browser HTTP or Node disk
providers under the existing workspace-record owner.

References: [QEMU input](https://github.com/qemu/qemu/blob/v10.1.0/ui/input.c),
[QMP](https://github.com/qemu/qemu/blob/v10.1.0/monitor/qmp.c),
[Playwright input](https://github.com/microsoft/playwright/blob/v1.55.0/packages/playwright-core/src/server/input.ts),
[VS Code file providers](https://github.com/microsoft/vscode/blob/1.103.0/src/vs/platform/files/common/fileService.ts).
