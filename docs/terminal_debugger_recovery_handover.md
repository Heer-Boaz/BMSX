# Handover: terminal/debugger/Hot Resume/audio recovery

Date: 2026-08-03

Branch: `master`

Current HEAD: `9078b7bbf`

The user committed the rejected implementation deliberately so later work could
not accidentally reset or revert unrelated recovery changes. That commit stays
in history. The correction below is a new worktree change on top of it; no
commit was requested.

## `<init>` semantic correction (2026-08-03)

The implementation in `9078b7bbf` did not match the agreed design. It gave
`<init>` automatic cold-runtime call semantics and spread the annotation over
cart modules with no source callers. Both behaviors are rejected.

The actual language contract is deliberately narrow:

```lua
local function init<init>()
    -- the cart's existing preparation code
end

init()
```

- `<init>` adds **no call** to ordinary program execution. The explicit source
  `init()` remains the one and only cold preparation call.
- A program may mark multiple zero-argument, non-vararg, top-level local
  functions, both in its entry chunk and in statically required source modules.
  This language capability does not require carts to distribute their
  preparation across modules.
- The compiler emits each ordinary closure and retains it in a private slot so
  tooling can publish one raw callable vector. Hot Resume invokes the retained
  closures in dependency and lexical order after installing compatible code.
- The CPU, firmware, ROM header, runtime state and cart runtime know nothing
  about source revisions or Hot Resume. The annotation is a compiler/tooling
  contract only.
- `new_game()` remains exactly where existing carts already owned and called
  it. Hot Resume neither looks up nor invokes that name.

All cart changes introduced by the rejected distributed-init migration are
being undone against parent `d5998b5eb`. The only intended cart-source
differences from that parent are these six existing entry declarations changing
from `function init()` to `local function init<init>()` while their existing
explicit `init()` calls remain:

- `carts/2025/cart.lua`
- `carts/emptycart/entry.lua`
- `carts/hot_resume_test/entry.lua`
- `carts/nemesis_s/cart.lua`
- `carts/pietious/cart.lua`
- `carts/vblanktest/entry.lua`

There are no cartlib or module-local `<init>` functions. The extra Pietious
`game_session.lua` from the rejected migration is removed, and the old
Pietious cart and headless test ownership are restored. Useful library support
for rebinding retained FSM, behaviour-tree and timeline runtime objects remains,
but it is reached only through the existing cart `init()` body and its explicit
calls.

The validation contract for this correction is stronger than compilation:
compiler execution tests must prove annotation-only cold count zero, including
multiple annotations in source modules, and an explicit cold `init()` count
one; linker tests must reject annotation add/remove/reorder/identity changes;
the full IDE scenario must prove Hot Resume reruns
`init` exactly once without rerunning `new_game`, reaches an init breakpoint,
prints through the terminal path, survives repeated revisions and reboots
without corrupting the font; and Pietious must pass its real headless world
scenario.

Current completion evidence:

- Relative to `9078b7bbf`, the compiler correction is exactly the deletion of
  the emitted `MOV`/`CALL` sequence at an annotated declaration. The existing
  multi-annotation, module ordering, hidden-slot and tooling-vector machinery is
  otherwise unchanged.
- All 748 files under `carts/` were compared to parent `d5998b5eb`. There are
  zero mismatches beyond the six declaration-line changes listed above, and
  the only shipped Lua `<init>` annotations are those six.
- The compiler execution test uses four annotations across an entry and two
  source modules: cold execution leaves the counter at zero; the explicit
  tooling call then produces the dependency/lexical result `1234`. A separate
  test proves explicit source `init()` runs once cold and once more through
  tooling.
- The full Hot Resume IDE scenario passes 52 assertions over rejected edits,
  two consecutive revisions, system-only and no-op refreshes, retained heap
  identity, `init` counts, unchanged `new_game` count, breakpoint continuation,
  guest `print`, dual-cartridge selection and cold reboot.
- The reboot breakpoint and the underlying physical terminal were captured at
  `tests/ide/screenshots/frame_00493.png` and
  `tests/ide/screenshots/frame_00496.png`; both fonts are intact.
- Full Lua tests pass 531 with 1 skipped; rompacker passes 96/96. Pietious
  rebuilds and passes its real enter-world host test. `2025` and `nemesis_s`
  rebuild successfully. Machine and toolchain TypeScript compilation and the
  Browser Studio debug product build pass.
- AEM cold state is initialized once when its owner module loads. The existing
  cart `aem.reload()` calls now rebind event definitions without resetting live
  audio state during Hot Resume; no cart callsite or public API was added.

## Completion update (2026-08-02)

The recovery implementation was committed by the user as `1df6dad10` before
the completion audit. The worktree was clean at takeover; the obsolete
uncommitted-worktree warning below is historical and was not used as a reason
to reset or revert any part of that commit.

The remaining headless presentation proof passes against the committed
runtime. The scenario waited for the physical fault-sequence word, captured
the BIOS monitor, posted one real F1 press/release through `HeadlessInputHub`,
and captured the IDE. The captures show the physical exception first and then
`entry.lua` line 14 with the retained runtime-error overlay.

The completion audit also established:

- the root TypeScript project compiles;
- node-headless tooling, the libretro core, and the Linux libretro host build;
- `bare_metal_cart`, `pietious`, and `2025` match exactly across TS software,
  C++ software, and C++ GLES2 captures (146, 2, and 93 frames respectively);
- core parity, rompacker (90/90), Lua (514 passed, 1 skipped), Hot Resume
  (28 assertions), indentation, and the targeted native audio, system, and CPU
  supervisor tests pass;
- the worktree passes `git diff --check`.

The completion audit initially missed a real browser cold-boot failure: the
breakpoint payload changed from a path-keyed object to domain/path/line records
while the workspace record kept the same identity. Browser-local recovery
could therefore retain the incompatible old payload even after the on-disk
`.bmsx` directory was removed. The current workspace-session representation
now owns a new semantic record name, `.bmsx/session.json`; it does not decode,
migrate, or fall back to the obsolete payload.

One repository-wide C++ test build remains independently red in
`tests/cpp/device_quantize_test.cpp`: it constructs `OpenGLES2Backend` with the
old three-argument signature instead of the current four-argument signature.
That test and constructor are outside this recovery commit; the recovery-owned
native targets build and pass. The configured standalone SDL target still
reports the existing `SDL platform not yet implemented` warning, so an audible
direct-host latency claim cannot be made from this environment. No workaround
or unrelated repair was folded into this slice.

This document supersedes the earlier version of this handover. Git history
contains the older functional archaeology when it is needed.

## Assignment

Finish and audit the existing terminal/debugger/Hot Resume/audio recovery as
one coherent vertical slice. Start from the live diff. Do not reimplement it
from this document and do not seek quick wins by removing working emulator
behavior.

Read first:

1. the repository `AGENTS.md` instructions supplied with the task;
2. `docs/architecture.md` and its current diff;
3. `docs/open_architecture_slices.md`;
4. the owner files named below;
5. the complete live diff.

No commit has been requested.

## Non-negotiable behavior

### Physical fault presentation

- A debug ROM fault enters the physical BIOS terminal first.
- The terminal shows cause/status/EPC/register information plus filename,
  line, column, and the failing source line/snippet.
- A non-debug ROM has no source directory and therefore shows only physical
  PC/status/register information and whatever firmware-owned disassembly is
  available. Hosts must not reconstruct source context.
- The fault must **not** auto-open the IDE. When the user explicitly opens the
  IDE afterward, it must focus the correct file and line and render the
  retained runtime-error overlay immediately.
- Breakpoint and step stops may open the IDE automatically.
- `Ctrl+E` means focus the retained runtime error; it must not open file search.
- Empty `FAULT` at the monitor prompt performs no action and prints no
  `NO SAVED FAULT` placeholder.
- Guest/system output and the complete exception remain visible through the
  physical terminal and host log transport.

### Debugger

- Continue, step-in, real step-over, step-out, breakpoints, optimized/inlined
  code, and Hot Resume breakpoint relocation must work.
- CPU state contains machine representations only: raw execution domain IDs,
  PCs, registers, and execution control. Source paths, source revisions,
  source maps, editor objects, and debugger DTOs remain tooling-owned.
- There must be no execution-hook branch in the normal CPU interpreter loop.
  The current design observes selected domains at the outer execution-slice
  boundary; the ordinary no-debug path still uses bulk slices.

### Hot Resume

- Preserve the already-working lifecycle and global/module/asset behavior.
- A newly introduced global must not make Hot Resume fail merely because the
  physical global slot layout changed.
- Never restore this deleted guard:

  ```ts
  if (fault.hostFrameFailed) {
      throw new Error('Hot Resume cannot continue a failed host frame. Reboot the machine.');
  }
  ```

- No workspace migration, legacy payload support, schema versioning, save
  codec versioning, or compatibility fallback.
- Leave the existing `freshRange === null ? undefined : ...` conversion alone.

### Monitor audio

- Entering supervisor/monitor freezes the guest voice/song clock.
- Existing outgoing host backlog is discarded.
- `CONT` resumes at the same machine audio position without queued latency.
- Never add `writeSilence`, silence frames, prebuffering, an extra output ring,
  or audio latency compensation.
- The machine owns the physical clock gate. Browser/libretro/direct hosts only
  suspend or resume their transport and discard their transport backlog.

## Hard implementation constraints

- No panic rollback. The diff contains working pieces and fixes for bugs found
  during the recovery.
- No defensive guards, speculative fallbacks, DTO validation, facade layers,
  cosmetic one-line wrappers, or local encoding helpers.
- No host object identity, string-kind probes, or shape casts as substitutes
  for guest/runtime representation.
- No hot-path allocations, repeated decode, unnecessary conditionals, or
  callbacks in the normal CPU loop.
- Keep TS/C++ machine contracts mirrored.
- Do not introduce tests. Modify existing tests only when their owned contract
  changed; use `/tmp` probes/scenarios for additional evidence.
- Builds and typechecks are not runtime proof. Run carts and inspect frames.
- Do not remove entries from `docs/open_architecture_slices.md` unless every
  stated end criterion of that entry is actually complete.

## Live worktree

At handover the worktree has roughly eighty modified paths plus:

- deleted `toolchain/ts/lua/compiler/resume_points.ts`;
- new `toolchain/ts/lua/compiler/execution_points.ts`;
- a newly modified `scripts/bootrom/platforms/node_tooling_entry.ts`;
- this handover update.

Run these before touching anything:

```sh
git status --short
git diff --stat
git diff --check
git diff -- docs/architecture.md
git diff -- docs/open_architecture_slices.md
```

`git diff --check` was green immediately before this document was written.
`docs/open_architecture_slices.md` was unchanged. Generated ROMs/build products
under `dist/` are not the source of truth.

All previously active subagents were interrupted for this handover. They were
running no-edit cart validation, so do not assume their unfinished tasks
produced evidence.

## Representation and hot-path table

| Concern | TypeScript representation/owner | C++ representation/owner | Hot-path callsite |
| --- | --- | --- | --- |
| Execution domain | raw `ExecutionDomainId` word in `machine/ts/spec/blua32/execution_domain.ts` | raw domain word in `machine/cpp/spec/blua32/execution_domain.h` | ordinary `CPU.runUntilDepth` / `CPU::runLoop<..., false>` contains no hook check; the separate instrumented loop checks only while a debugger hook is bound |
| Execution PC | raw 32-bit PC | raw `u32` PC | instruction fetch in both loops; source lookup remains outside the CPU |
| Suspended static call | raw execution-domain word plus raw function-record address | mirrored `ExecutionDomainId` plus `u32` address | explicit `beginCompletionCallInExecutionDomain`; no `CART_SELECT`, source, symbol or revision input |
| IRQ wait latch | raw frame depth, with `-1` meaning no latch | mirrored signed frame depth | one equality check against current frame depth at the existing halt boundary; it lets a suspended completion frame run above a waiting guest frame |
| Source statement | tooling symbol range with statement identity and inline depth | decoded tooling symbol range with the same fields | IDE/debugger lookup outside normal execution |
| Object global relocation | object-local global slot, then linker name/layout mapping | installed image-local name to live registerfile slot | image install/relocation, not instruction dispatch |
| Voice clock hold | `voiceClockHeld` in APU service-clock ownership | mirrored `voiceClockHeld` in native service clock | supervisor transition edge and APU service boundary |
| Host audio mute | browser/common transport state | libretro/direct-host transport state | host lifecycle edge, not guest mixing |

Normal execution does not pay for source mapping or debugger callbacks. The
no-hook path continues through the regular bulk interpreter loop. With a
debugger hook installed, the executor selects the separately compiled
instrumented loop, which observes instruction PCs inside the same scheduled
CPU slice; it does not force the host executor into one-instruction slices.

## Implemented work currently in the diff

### Compiler, symbols, linker, and Hot Resume

- `execution_points.ts` replaces the old resume-point-only model with statement
  points suitable for Hot Resume and debugger stepping.
- O3 preserves/clones statement-range identity for inlining and unrolling and
  records inline depth.
- TS and C++ BLua32 symbol codecs mirror `statementPointsByFunction` and inline
  depth.
- Compiler relocatable constants prevent linked asset addresses from becoming
  accidentally captured runtime upvalues.
- Global relocations use object-local slots, then map names through the prior
  live global layout. New globals no longer shift the active registerfile
  interpretation.
- `buildAssetModule` only repacks symbols at/after the rebuilt image offset or
  the exact edited asset.
- queued runtime tasks return a completion promise; the headless Hot Resume
  scenario awaits the actual queued rebuild.
- workspace persistence happens immediately before scheduling Hot Resume or
  reboot so an older autosave generation cannot reapply stale source.
- The user-deleted `hostFrameFailed` Hot Resume guard remains absent.

Primary owners:

```text
toolchain/ts/lua/compiler.ts
toolchain/ts/lua/compiler/execution_points.ts
toolchain/ts/lua/compiler/optimizer/**
toolchain/ts/rompack/blua32_linker.ts
toolchain/ts/rompack/blua32_symbols.ts
machine/cpp/rompack/tooling/blua32_symbols.{h,cpp}
ide/runtime/hot_resume.ts
ide/runtime/lua_pipeline.ts
ide/runtime/task_queue.ts
```

### Debugger

- The rejected `isEditorDebugCommand()` predicate does not exist. Debug
  commands use the `EditorDebugCommandId` type directly.
- Breakpoints persist directly as domain/path/line data in the current
  workspace payload; there is no migration or compatibility path.
- Breakpoints are resolved from tooling source points to raw domain/PC
  bindings.
- Continue, step-in, step-over, and step-out operate through outer execution
  slices. Pending interrupts are accepted before observing a debug boundary.
- Domain activation yield masks make the selected cartridge entry boundary
  observable without changing the normal interpreter loop.
- A retained physical fault stays in BIOS presentation. `CartEditor.activate()`
  consumes the retained fault snapshot and focuses/render its source overlay.
- Breakpoint/step stops set a pending presentation flag and activate the IDE.
- `Ctrl+E` is bound to `runtimeErrorFocus`.

Primary owners:

```text
ide/runtime/debugger_state.ts
ide/workbench/contrib/debugger/controller.ts
ide/workbench/host_frame.ts
ide/cart_editor.ts
ide/runtime_error/navigation.ts
ide/commands/**
ide/input/keyboard/global_bindings.ts
machine/ts/machine/runtime/cpu_executor.ts
machine/cpp/machine/runtime/cpu_executor.{h,cpp}
machine/ts/machine/cpu/cpu.ts
machine/cpp/machine/cpu/cpu.{h,cpp}
```

### BIOS terminal and physical source directory

- BIOS `FAULT` presentation retains raw cause, EPC, bad address, Lua reason,
  status, and IRQ mask.
- Debug ROM diagnostics resolve filename/line/column and the source line from
  ROM-resident debug data.
- Release ROMs omit that directory and therefore do not show source text.
- Empty `FAULT` returns no action instead of fabricating a message.
- The terminal block caret redraws the underlying glyph with inverse colors.

Primary owners:

```text
machine/bios/shell/commands.lua
machine/bios/shell/monitor.lua
machine/bios/tty/terminal.lua
toolchain/ts/rompack/**
```

### Supervisor audio

- TS/C++ APU service clocks contain a physical `voiceClockHeld` latch.
- USER-to-supervisor/fault asserts it; the final transition back to USER
  releases it.
- While held, scheduler epoch advances but voice/sample-carry/DAC sequence and
  command consumption do not.
- The non-cart-visible AOUT presentation ring is cleared on every actual
  false-to-true hold edge. This includes USER -> `CONT` -> a second fault that
  occurs within one host frame and is invisible as a host mute edge.
- Browser/common, libretro, and direct-host audio paths suspend transport and
  clear their existing queue/ring; none injects silence.

Primary owners:

```text
machine/ts/machine/devices/audio/**
machine/cpp/machine/devices/audio/**
machine/ts/machine/devices/system/controller.ts
machine/cpp/machine/devices/system/controller.{h,cpp}
hosts/common/audio_output.ts
hosts/common/host_frame.ts
hosts/libretro/audio_output.{h,cpp}
hosts/libretro/entry.cpp
hosts/libretro_host/audio_output.c
hosts/libretro_host/audio_queue.c
hosts/libretro_host/core_session.c
```

## Evidence already obtained

These results were obtained against the current recovery except for the final
two headless-runner lines described in the next section.

### Automated suites

- `npm run audit:core-parity`: passed.
- `npm run test:rompacker`: 90/90 passed.
- `npm run test:lua`: 514 passed, 1 skipped, 0 failed.
- `npm run test:hot-resume`: 28 assertions passed.
- targeted TS audio/system tests: 40/40 passed.
- native `bmsx_audio_controller_tests`: passed.
- native `bmsx_system_controller_tests`: passed.
- `git diff --check`: passed.

### Live/debug probes

- `/tmp/vblank_debugger_steps.idetest.js`: 11 assertions passed, including
  breakpoint stop, real step-in, step-out, continue, and step-over without
  entering the call.
- `/tmp/vblank_inline_debugger.idetest.js`: 19 assertions passed against an O3
  inline/unroll temporary cart.
- `/tmp/vblank_debugger_hot_resume.await.idetest.js`: 4 assertions passed from
  a clean temporarily moved workspace; the original workspace was restored.
- `/tmp/bmsx_cpp_execution_hook_probe.cpp`: passed against current native
  libraries; it stopped in cart domain, retained PC across the host update,
  then continued after hook removal.
- `/tmp/bmsx_supervisor_audio_ring_probe.ts`: passed first supervisor entry and
  hidden USER -> fault AOUT ring clearing.
- `/tmp/bmsx_cpp_supervisor_audio_ring_probe.cpp`: mirrored native pass.
- Debug `monitor_fault_probe` visibly showed in the BIOS terminal:

  ```text
  BMSX BIOS MONITOR
  EXCEPTION TRAP LUA RUNTIME FAULT
  ...
  entry.lua:14:1
  nothing()
  ```

- Release `monitor_fault_probe` showed register/PC information without source.
- An empty monitor `FAULT` showed the prompt with no bogus placeholder.
- Captured caret frames showed a block caret with the underlying glyph
  inversed.

Useful retained artifacts include:

```text
/tmp/bmsx-monitor-debug-1785645099.log
/tmp/bmsx-monitor-release-1785645099.log
/tmp/monitor_fault_probe_debug_registers/frame_00030.png
/tmp/bmsx-monitor-release-shots-1785645099/frame_00030.png
/tmp/bmsx-monitor-empty-fault.S6Wlnf/
/tmp/bmsx-monitor-caret.QFtgZ3/
```

Do not count `/tmp/vblank_debugger_loop_body.idetest.js` as evidence. It used
an obsolete assertion that current source line 112 could not be a Hot Resume
point; line 112 is now a normal call statement and legitimately is one.

## Latest incomplete change: headless IDE visual proof

The last edit added existing headless input and capture owners to `--ide-test`:

```text
scripts/bootrom/platforms/hostrunner/ide_test_runner.ts
scripts/bootrom/platforms/node_tooling_entry.ts
```

The intended proof is entirely headless:

1. boot `monitor_fault_probe.debug.rom` through `runWorkbenchHostFrame`;
2. wait for the physical supervisor fault sequence;
3. capture the BIOS fault terminal;
4. post real F1 down/up input through `HeadlessInputHub`;
5. advance frames and capture the IDE;
6. visually verify `entry.lua`, line 14, and the error overlay.

The product/tooling build after this change succeeded:

```sh
npm run build:product:node-headless-tooling -- --debug --force
```

The first `/tmp/monitor_fault_ide_headless.idetest.js` attempt is **invalid**.
It waited a fixed 30 clock frames and asserted `!isCartActive()`, but that is
also true before cartridge boot. It captured:

```text
/tmp/screenshots/frame_00033.png  # BIOS boot screen, fault not reached
/tmp/screenshots/frame_00046.png  # IDE main.lua, opened too early, no fault overlay
```

This does not prove a product regression. Correct the temporary scenario, not
the runtime. Wait for the actual physical fault sequence word:

```js
const faultSequenceAddress = 0x08010434;
let faultSequence = 0;
for (let frame = 0; frame < 1200 && faultSequence === 0; frame += 1) {
    await t.frames(1);
    faultSequence = t.runtime().machine.memory.readMappedU32LE(faultSequenceAddress);
}
assert(faultSequence !== 0, 'physical supervisor fault was not latched');
await t.frames(15);
t.capture('physical BIOS fault terminal');
// Post F1 down/up with one stable pressId, advancing at least one frame per edge.
await t.frames(12);
t.capture('IDE fault source overlay');
```

Use the existing raw `postInput` context method. Do not add another test
driver, server, browser, CDP session, or `.mjs` debugging stack. The current
temporary scenario may be overwritten. Preserve
`carts/monitor_fault_probe/.bmsx/~workspace` by moving it out and back around
the run; it was restored after the invalid attempt.

After correcting the scenario, run TypeScript compilation and inspect the
small runner diff. There is also a formatting-only indentation change on the
`case 'ide-test'` line in `node_tooling_entry.ts`; fix it while auditing that
file. Do not turn the two test-boundary calls into a new facade hierarchy.

## Remaining validation and audit

Do these in this order. Fix only a demonstrated blocker at its owner.

1. Complete the physical fault -> BIOS capture -> F1 -> correct IDE source and
   overlay proof above.
2. Run the repository TypeScript check after the latest runner edit.
3. Build the complete current C++ test/product surface, including libretro and
   the direct SDL/ALSA host.
4. Run `bare_metal_cart`, `pietious`, and `2025` in both TS and C++ headless
   runtimes. Inspect screenshots rather than accepting process exit alone.
5. Exercise `2025` combat/skip/background clearing. Exercise `pietious` long
   enough to cover the reported World 1 non-table/heap-overflow regression.
6. Exercise libretro/direct-host supervisor entry and `CONT` with audio
   transport enabled where the environment permits. Report honestly if audible
   latency cannot be proven in a dummy headless audio device.
7. Audit the complete diff for forbidden patterns, unnecessary allocations,
   duplicate validation, host source magic, hot-loop branches, silence
   injection, migrations, and versioning.
8. Rerun the green suites listed above plus `git diff --check`.
9. Compare every changed architecture statement with the implementation.
10. Leave `docs/open_architecture_slices.md` unchanged unless all applicable
    end criteria are genuinely proven.

Suggested quick audits:

```sh
git diff -U0 | rg "Number\\.isFinite|Number\\.isNaN|\\bisNaN\\b|typeof .*number|math\\.(floor|ceil)|writeSilence|prebuffer|schemaVersion|codecVersion|migration|backward|legacy"
rg -n "executionHook" machine/ts/machine machine/cpp/machine
rg -n "writeSilence|silence|prebuffer" machine hosts ide -g '*.{ts,cpp,h,c,lua}'
git diff --check
```

Do not mistake `ide.fault.hostFrameFailed` in the workbench frame scheduler for
the removed Hot Resume prohibition. The forbidden behavior is the deleted
throw inside Hot Resume, not all lifecycle recording of a failed host frame.

## Known process failure

A stale `rominspector --blua32-asm` pipeline was found running for more than
four hours at 100% CPU and was killed. Do not launch broad disassembly pipelines
for this recovery. Before long validation runs, check for stale processes:

```sh
ps -eo pid,etimes,pcpu,pmem,stat,cmd --sort=-pcpu | head -20
```

Keep every runtime probe bounded by the existing TTL/timeline mechanism.
