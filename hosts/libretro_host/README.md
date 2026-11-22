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
- `dist/snesmini/host/current/bmsx_snesmini_input`

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
rollback arguments; the entrypoint passes them after `--clover`, where the host
handles the suspend-point and transition paths separately from its own options.
The launcher disables background rewind and selects exit for a long Select +
Start press. The old
`/root/run.sh` is no longer needed by these menu entries and is left untouched.

Only content whose SHA-256 differs is transferred or replaced. Transfers use
SSH and tar, not SCP/SFTP; payload checksums are checked before installation.
Core and game files publish by rename while Clover is stopped, and Clover
restarts afterward. Updating only the host and input executables does not
interrupt Clover; the installer requires the BMSX game to be stopped first.
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
arguments as ordinary host options; they follow `--clover`. Do not route the
title through RetroArch.

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
  Set `bmsx_gamepad_hold_action` to `exit` instead of its default `rewind` to
  make a controller's long Select + Start press request frontend shutdown.
- `--video fb|sdl`: `fb` uses `/dev/fb0` + evdev; `sdl` provides windowed software or GLES2 video and SDL input
- `--hidden-window`: keeps the SDL window unmapped while retaining its GLES2 context for unattended runs
- `--input-timeline <path>`: replays an explicit input timeline
- `--paced-timeline`: keeps an active timeline on the normal host deadline instead of running it as fast as possible
- `--max-frames <count>`: owns run lifetime explicitly, including when the timeline has ended
- `--guest-ticks <count>`: run a fixed guest workload with an explicit
  `--input-timeline`, `--timing-report`, and a larger `--max-frames` safety
  limit. The core must support guest progress and single-tick pacing. A call
  that doesn't finish the current guest tick leaves the scripted input held.
  After the initial cartridge tick, exactly the requested number of guest
  ticks must complete; an incomplete run, rewind, or multi-tick call fails
  without a benchmark summary.
- `--timing-report`: prints fixed-size `retro_run`, core-without-presentation, final-blit and swap histograms at shutdown; the GLES2 backend additionally reports GX CPU-to-VRAM command/call/byte/time totals
  `over_period` counts host calls longer than their assigned display period.
  `missed_deadlines` counts paced host calls that finish after their scheduled
  deadline, even if the call itself takes less than one period. Unpaced calls
  have no deadline. Neither count is the number of dropped presentations.
  It retains the 32 slowest measured calls with their host-frame numbers,
  presentation times and matching GX upload counters. Samples use fixed
  storage; no per-frame log output is emitted.
  With `--max-frames`, it also lists every measured call strictly above 15 ms
  in frame order, with exact durations before and after subtracting final
  blit and swap. It reserves storage before the run and prints at shutdown.
  The ALSA underrun line covers the same measured window; `before_timing` counts
  earlier underruns. The final `audio stats` line covers the entire session,
  including teardown.
- `--profile-native-compilation`: requires `--timing-report` and a native-enabled
  core. Adds compilation deltas to the existing slow-frame records and prints
  cumulative measured-window totals at shutdown. In profile V2, discovery
  includes decoding and source preparation. Retirement measures capacity
  eviction, not every withdrawal. Compilation measures foreground code
  generation and stops before publication. V2 separately reports collected
  background jobs
  (`background_completed`, including `background_cancelled`) and their elapsed
  generation time (`background_ns`). A job is charged when its result is
  collected, not divided across the calls it overlapped; this duration is not
  host CPU time and must not be added to foreground or frame times.
  Timers run only at cold owner boundaries, not for guest instructions or warm
  native entries. Profile runs are separate from unprofiled throughput
  comparisons.
  Counts, emitted bytes and times cover measured `retro_run` calls only.
  Source-instruction, entry and emitted-byte totals count compilation work,
  including repeated or merged source; they are not unique guest instructions,
  resident entry counts or memory footprint.
  `live_code_bytes` is the final live executable-code gauge; `lifetime_peak_*`
  and `lifetime_max_*` remain absolute maxima since profiling was enabled,
  including excluded warmup runs. The worst prepare identifies its raw domain,
  physical socket, root PC and page PC. Reset/restore does not rewind these
  host-only counters; loading another runtime starts a new lifetime. Cache
  bytes exclude metadata and allocator reservation. A merge is not a capacity
  eviction, and repeated publications alone do not prove cache churn.
  The host reports the negotiated `profile_version`. New cores offer the V2
  command only; the host can read the historical V1 command to measure an
  unchanged baseline. V1 logs no worker fields. Its `capacity_events_v1` is
  build-specific: older cores counted whole-cache flushes, and later V1 cores
  counted per-region evictions. Do not compare that field to V2's
  `capacity_evicted_regions`.
- `--timing-warmup <count>`: excludes the first `<count>` host runs from timing
  reports (default: 500; must be positive). With `--guest-ticks`, the count
  excludes that many scripted guest ticks, in addition to boot. Histograms
  retain all subsequent measured host calls, including calls with no guest
  progress. Timed ALSA underruns cover that same window.
- `--profile-execution`: requires `--timing-report` and a core built with
  `BMSX_DIAGNOSTIC_CPU_SLICES=ON`; a core without this private diagnostic
  interface is rejected instead of silently omitting attribution. Works with
  interpreter and native cores. Adds execution counters to the same retained
  32 slow-frame records and reports a separate `[execution]` summary from the
  first pre-call snapshot to the last post-call snapshot, including every
  measured call, not just the slowest 32. No per-frame log output or growing
  trace is produced. The same two fixed snapshots bracket each measured host
  call outside its elapsed-time clocks. `scheduler_before_cycles`
  and `scheduler_after_cycles` are raw signed machine positions: reset and
  state restore can move them backwards. They are not clamped or relabelled as
  elapsed time. Without a reset/restore inside the call, their difference less
  `cpu_consumed_cycles` is scheduled time outside CPU slices, including idle
  and DMA/MMIO-wait advancement; it is not device host execution time.
  `cpu_slices` and `cpu_consumed_cycles` are interval deltas of the existing
  CPU-lifetime counters around `CPU::runUntilDepth`. Consumption is emulated
  budget cycles, not retired instructions or host nanoseconds.
  `gc_collections` counts collection cycles started in the interval;
  `gc_steps` counts full-collection increments and synchronous small collections;
  `gc_full_collections` counts explicit or emergency full-collection requests. Continuing an incremental cycle can
  therefore add GC time with zero new collections. Phase `gc_*_ns` values are
  interval deltas of host monotonic timings. Total time encloses roots,
  graph/ephemeron tracing, the second marking pass, weak cleanup, object sweep,
  string reclamation and final heap accounting. `gc_atomic_ns` encloses the
  final remark and overlaps its roots/trace/weak timings; do not add it to the
  phase sum. `gc_max_step_lifetime_ns` is the absolute maximum at the sampled
  frame, including warmup, not a delta or the sum of steps in that frame.
  `gc_steps_over_2ms` and `gc_steps_over_8ms` count individual steps exceeding
  those durations in the interval. A synchronous full collection can run many
  steps back-to-back; its total pause is not the maximum individual step.
  These fields still describe the retained slow-frame samples, not every GC
  step in the session. Phase timers close on exception unwinding; restore-time heap
  reconstruction is not a guest collection. CPU reset/restore never rewinds
  these counters; loading another runtime starts a new lifetime.
  Diagnostic builds collect these probes regardless of frontend acceptance;
  ordinary builds contain no slice-counter or GC-timer instrumentation and do
  not offer the interface. Keep diagnostic attribution runs separate from
  ordinary throughput comparisons. This does not expose background compiler
  time, guest-function samples or host device timing.
- `--rewind on|off`: sets the `bmsx_rewind_recording` core option. Automatic
  recording defaults to off on SNES Mini and on elsewhere. Disabling it removes
  periodic rewind checkpoints and their history storage, not manual save states.
- `--crt-postprocessing on|off`: sets the `bmsx_crt_postprocessing` core option
- `--crt-noise on|off`: sets the `bmsx_crt_noise` core option
- `--dither off|rgb565|msx10`: sets the `bmsx_dither` core option

Input timelines may include `capture: true` entries. Both the libretro host and headless runner save `.png` screenshots into a `screenshots/` subfolder next to the timeline JSON file.

Timeline time advances once after each completed cartridge-session `retro_run()`
call, independently of presentation. Earlier BIOS-only runs do not advance it.
The first completed run with cartridge execution active starts the clock; input
events are dispatched before subsequent runs. Frame-0 input retains startup
ordering and is first dispatched alongside frame-1 input before the following
run. Once started, dropped presentations, missing video callbacks and BIOS calls
within the cartridge session do not pause timeline time.

With a BMSX core that offers the standalone cadence interface, a call that
only services guest maintenance leaves the input timeline and current video
frame in place. The host can reoffer its remaining display slot without
granting a second frame of console time. Maintenance consumes real wall time:
an expired host deadline closes the slot normally. This also applies to
`--guest-ticks`; normal pause, backend waits and partial guest execution are
not classified as maintenance. External frontends that do not accept the
private interface keep their existing `retro_run` cadence.

Capture marker `N` requests the image presented during cartridge run `N`.
Captures require an actual presentation. If presentation is delayed, the next
available image consumes the latest overdue marker; it is not a reconstructed
historical image. Capture polling does not advance input time.

Without `--max-frames`, the host exits after all timeline inputs and requested
captures have been consumed and the completed-run count has passed the final
marker. `--max-frames` instead limits total host runs, including BIOS startup.

### Timing a fixed guest-tick interval

With `--guest-ticks N`, the first completed tick whose post-call execution
domain is a cartridge anchors playback. Timeline frame 0 is the *next* guest
tick, not the anchor. Subsequent frame numbers refer to guest ticks; any host
calls that only do maintenance or advance part of a tick leave that frame's
input in place. When comparing cores, use the same input-only timeline with
frame numbers below `N`. Capture entries are rejected in this mode: screenshot
cost and the availability of a new presentation are separate from guest work.
Do not feed other input during the timed run.

The `guest-progress` line gives the absolute tick and CPU-clock positions at
the ends of the measurement window, the numbers of host calls without a
completed tick or without any guest clock progress, summed measured run time,
wall time including pacing between calls, and process CPU time summed within
the measured calls. Work on a background thread between calls is not part of
that CPU sum. Every retained
`over-15ms` sample includes the guest positions for that particular host call.
Compare only successful runs with the same guest interval, timeline and
cartridge/BIOS bytes, build settings, and presentation/audio configuration.
A shorter host-call histogram by itself does not show higher guest throughput.
Matching tick counts do not guarantee identical guest instructions or output
when comparing different machine specifications. Check the visible workload
separately and distinguish end-to-end changes from JIT-only measurements.
For a baseline predating the private interfaces, apply only the core-side
benchmark adapter commit `579dce456` in its own worktree, rebuild its Release
core, and run it with the same timing host as the candidate. The adapter selects
the existing single-tick scheduler path only on request and needs no CPU
diagnostics. Leave the execution/native compilation profiling options off for
a throughput comparison; use those in separate attribution runs.

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
