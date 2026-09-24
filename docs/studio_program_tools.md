# Studio program installation tools

This extends the source lifecycle with ordinary Lua program Reboot. Hot Resume
and non-Lua asset rebuild orchestration remain separate, open integration gates;
Reboot must not impersonate either of them.

## Owner audit and production references

Before implementation, the live BootService, HotResumeService, runtime pipeline,
debugger execution, source snapshots, host-frame admission and isolated Scenario
Lab media build were inspected. Their boundaries are different:

- BootService captures retained program documents, reads workspace overrides,
  builds, installs and physically resets. It does not Save or run guest code.
- Hot Resume additionally owns relocation, supervisor return and physical init
  completion batches. Its deferred plans and suspended init roots require
  explicit workbench execution/control; routing it through Reboot or pretending
  admission is completion would be wrong.
- RuntimeDebuggerExecution and frame navigation already execute the authoring
  target behind an open IDE. Reboot need not close the chat or invent a runner.
- ScenarioRunService builds separate physical test targets. A test pass cannot
  prove which code is installed in the authoring target; installed-source reads
  and execution observations must establish that separately.
- The end-to-end test exposed two source-layer ownership defects. Derived ROM
  entries lost their payload domain after generic layout; the layer producer
  now assigns its domain before publishing its in-memory index. Forked builds
  also shared mutable layer containers with authoring; each fork now owns its
  bytes/index/header references while sharing immutable backing bytes. A later
  authoring install cannot retarget an already admitted test build. Neither fix
  adds a fallback in source discovery or test execution.
- The real WebGPU path also exposed an image-admission race: Terminal return
  had completed, but background history readback still held the task queue.
  RuntimeInspectionService now waits for that admitted readback before observing
  the stopped target and handing off to host GPU capture. Execution/replacement
  invalidates the wait; pending mutation or failure rejects it. No provider retry,
  heap inspection allocation or extra machine frame is used.

References studied before implementation:
[VS Code restart orchestration](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugService.ts)
separates preparation from restarting the debug session, while its
[debug task runner](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugTaskRunner.ts)
does not interpret cancelled preparation as successful launch. MAME's
[reset scheduler and notifier](https://github.com/mamedev/mame/blob/mame0280/src/emu/machine.cpp#L895-L920)
separate the reset request from actual physical reset. BMSX retains its own
exclusive queue and source/runtime representations, not their compatibility or
fallback policies.
MAME's [snapshot ownership and pixel lock](https://github.com/mamedev/mame/blob/mame0280/src/emu/video.cpp#L1027-L1060)
were also reviewed: BMSX keeps its existing retained-frame readback and task
admission, rather than moving image production into the assistant or borrowing
MAME's substitute-render path.

## Contract

`studio_reboot_runtime(target)` calls the same BootService as ordinary Reboot.
It captures **current** retained writable Lua program models at admission, not
old chat text, proposed edits or a previously read source receipt. It reads
remaining source overrides through ordinary workspace preparation. Captured
document domain/path/version and the accepted operation ID are returned with the
actual terminal result. Later typing remains dirty and does not enter this
operation's captured documents. Source-only test modules are not program images.

The tool is destructive to current gameplay and history, as ordinary Reboot is.
It does not approve edits, Save, rebuild YAML assets, hide the editor, change
requested pause or silently Continue. `reset` means physical reset only, not
successful guest initialization. Existing debugger-source reads, execution,
Terminal, images and Scenario Lab tools supply subsequent evidence.

BootService accepts an optional cancellation signal for any caller. Pre-aborted
requests do not supersede existing work. Cancellation before installation
retires queued/asynchronous preparation; the existing queue still drains its
admitted IO. Installation/reset are synchronous physical writes: there is no
rollback after them. Cancellation listeners detach on terminal completion and
cannot cancel a later request. The conversation's prompt/request lifetime binds
this signal, so Stop prevents a pending Reboot rather than only hiding its reply.

`studio_runtime_status` includes the same owner's latest Boot operation, also
for ordinary manual commands. This is historical acknowledgement, not a claim
that later gameplay, source edits or external state still match it. External
machine replacement retains the existing owner's retirement behavior.

## Representation and performance

| Representation | TypeScript owner | C++ | Changes |
| --- | --- | --- | --- |
| Captured program source | LuaTextModelSourceSnapshot | no native IDE working copies | unchanged |
| Accepted Reboot and result | BootService | no native IDE BootService | request ID and cancellation lifetime |
| Compiled/installable media | existing Lua pipeline | existing native runtime media | unchanged |
| Derived tooling asset entries | buildBlua32Tail / RomSourceLayer | no native tooling layer; packed ABI unchanged | producer publishes the owning payload domain |
| Forked build input | forkRuntimeSourceState | no native IDE source build | private layer containers, shared immutable bytes/index |
| Stopped image observation | RuntimeInspectionService / GameImageCapture | native synchronous capture unchanged | await existing history work, invalidate on execution/replacement |
| CPU/registers/guest globals | physical Runtime | physical native Runtime | unchanged |
| Reset/step/Terminal execution | existing owners | existing mirrored machine/BIOS paths | unchanged |

No mirrored-runtime edit, per-instruction hook, host-frame callback, per-frame
renderer allocation or polling is added. IDs/listeners are per accepted Reboot; document
and error formatting is performed only for explicit tool results/status reads.
The assistant does not retain a second program, build queue or reset owner.

## Evidence

`studio_program_tools.test.ts` drives the actual native Codex app-server, browser
Studio and existing HTTP source API with a deterministic local Responses
provider. Its disposable authored cartridge contains a function returning 1;
the unchanged integration test requires 2. The conversation runs that actual
failure, reads the source, proposes the targeted fix, and waits for visible
shared review Apply. The next prompt Saves the fix, verifies Save is still
runtime-pending, Reboots, reads the newly installed source, hits an installed
source breakpoint, calls the function through the cart-context Terminal, gets
2 and the current game PNG, explicitly advances 120 video frames to capture the
visible intro, and reruns the unchanged scenario successfully. The test
does not weaken the assertion or infer authoring installation from test success.
The first image is honestly still the black boot frame: its publication precedes
the stopped CPU. The second image contains the actual rendered intro; capture
alone never advances gameplay to make its output appear newer.

A further prompt holds actual Reboot source GET IO. Visible typing creates newer
dirty source; visible Stop cancels the Reboot before installation. Releasing the
IO cannot reset the machine or overwrite those edits. The next prompt reads the
same Boot owner's historical cancellation. The exchange uses one connection,
34 finite provider requests and one interrupt, without model polling.

This is automated integration evidence, not personal-account authentication,
live-model reasoning or UI-only authored development. The provider's final
summary is formatted from actual tool replies. Screenshots and request evidence
are retained in `/tmp/bmsx-studio-chat/program-*`.

The source-layer regression reproduced before its fixes: a real rebuilt cart
fork lost its installed source map, and a later authoring install replaced the
fork's backing bytes. After repair, direct forks and reloaded ROM bytes agree,
and the fork retains the original image across another authoring Reboot. A
separate system-layer test reads derived symbols through ordinary RomSourceStack.

The capture regression reproduces with an explicitly held history task and on
real WebGPU following Terminal completion. Its tests include prompt/request
cancellation, resumed/replaced targets, later mutation, failed history readback,
and immediate GPU-copy admission when idle. None advances the guest or substitutes
an old/black image for a failed request.

## Validation (2026-09-24)

- Complete program workflow: software, WebGL2 and WebGPU pass. Their second
  256x192 game PNGs have identical decoded pixels after the explicit 120-frame
  advance; publication and observation both identify video tick 173. The first
  image's older publication is kept, not relabelled as the Terminal return time.
- Full assistant integration suite, including that workflow: 57 pass using the
  real app-server and deterministic provider fixtures, not a live model account.
- Capture/inspection/conversation unit bundle: 59 pass. Full Lua suite: 2804
  pass, one existing skip. Rompacker suite: 189 pass.
- Ordinary browser Boot and Hot Resume operation workflows pass on all three
  renderers, including rejected source, stopped/faulted init, deferred failure,
  replacement and shutdown. Node ordinary Boot: 9 assertions; Hot Resume heap:
  47 assertions across eight resumes with stable tracked counts. This is a
  no-regression check, not a general performance benchmark.
- Browser Studio and Node headless tooling build in debug and release. Product
  IDE/common/browser/Node typechecks pass; strict architecture audit reports
  zero issues and core-parity checks pass. No native/BIOS representation changed.
- The tests-project typecheck still reports the same 94 baseline diagnostics;
  none was added by this slice. Repository indentation still reports four
  unrelated existing files. Changed files and `git diff --check` are clean.
