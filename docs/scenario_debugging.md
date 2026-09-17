# Scenario failures and debugging

## Production references, read before implementation

VS Code at `d456201d22788424abecff0d5127fa169d90f2aa`:

- [`ITestErrorMessage`](https://github.com/microsoft/vscode/blob/d456201d22788424abecff0d5127fa169d90f2aa/src/vs/workbench/contrib/testing/common/testTypes.ts)
  retains message text, optional location and structured stack frames separately.
- [`MessageSubject`](https://github.com/microsoft/vscode/blob/d456201d22788424abecff0d5127fa169d90f2aa/src/vs/workbench/contrib/testing/browser/testResultsView/testResultsSubject.ts)
  and [`TestResultsViewContent`](https://github.com/microsoft/vscode/blob/d456201d22788424abecff0d5127fa169d90f2aa/src/vs/workbench/contrib/testing/browser/testResultsView/testResultsViewContent.ts)
  expose the recorded failure and navigable frames, with an explicit Debug Test
  action rather than treating a completed result as a live debugger session.

The [Java test controller](https://github.com/microsoft/vscode-java-test/blob/4d240c0197470e7934cd676584f2092e430bd346/src/controller/testController.ts)
registers Run and Debug profiles against the same run handler. The
[Debug Adapter Protocol](https://github.com/microsoft/debug-adapter-protocol/blob/a671d70371daafd5235e804c922d61157bbb055a/specification.md)
separates exception details, stopped execution and session termination.

BMSX adopts those responsibilities using its existing result service, property
inspector, physical debugger and scenario media session. It adds neither DAP,
a second runner, a snapshot debugger, nor debugger policy to the machine.

## Proven defects

The 2024 Studio run reported only `Cannot read properties of null (reading
'functionAddress')`. Execution catches discarded the original exception stack;
preparation errors also invented test line 1 as the location of host exceptions.
Run completion immediately restored the canonical cartridge, destroying the
execution that a developer needed to inspect.

Retaining the real stack exposed `CPU.beginCompletionCall` reached from the
scenario install phase. The runner assumed cartridge initialization finished
after five ticks. The generated scenario entry already publishes its loader
closure; that publication is now the admission condition. There is no increased
delay, alternate closure, cart-specific check or CPU null-call fallback.

A live test-callback breakpoint then exposed a separate bookkeeping defect:
the derived ROM's symbols were installed without its accepted-source map. A
runtime hover consequently reported the test as not loaded. The media session
now installs both descriptions of the same compiled sources and restores both
canonical maps at Stop. Source-only test authoring records remain canonical.

## Ownership and lifecycle

- `scenario/failure.ts` retains the original message, stack and protocol phase.
  Only compiler diagnostics with a real resource acquire a Lua source location.
- Supervisor faults retain their existing structured guest stack. Details lists
  every frame; the developer can open the test callback behind a BIOS `assert`.
  An instruction-only frame has an address and no invented Lua location.
- Run keeps batch behavior and restores canonical media at completion. Debug
  stops the batch on failure and retains the failed machine and installed source
  identity until Stop. Both modes use the same execution service and breakpoints.
- A host exception escaping machine advancement always retains the failed
  execution, including in Run mode. The host-frame boundary records the original
  exception before the existing workbench error surface processes it.
- Stop restores once and preserves a failed result as failed. It is available
  while inspecting source as well as in Scenario Lab. Closing Studio cannot
  restart a failed inspection session. Preparation failure has no failed machine
  to preserve and keeps the existing unpublished-build contract.

Stack rows and text layout are prepared when Details opens. There is no stack
capture or source-map construction in ordinary game frames, and no additional
CPU/runtime state or mirrored native change.

## Validation

`studio_scenario_debug.ts` drives a real BIOS and cartridge through Studio's
commands on software, WebGL2 and WebGPU. It covers a test-callback breakpoint,
the actual local value `marker = 24`, Continue, a guest assertion and its
navigable callback frame, retained execution after hiding Studio, Stop and
canonical restoration. A malformed protocol command exercises original host
exception text/phase without a fake Lua location, in both Run and Debug modes.
The fixture edits an isolated workspace model, not a developer's cartridge.

Unit/media tests separately cover source and instruction frames, original host
stacks, compiler locations, installed test-source identity and host-frame failure
retention followed by Stop. They do not substitute for the browser workflow.

The targeted browser workflow passes on all three renderers; 19 focused Lua tests,
the media-session and cartridge packaging tests, product build, TypeScript build,
architecture audit (zero issues) and scoped quality checks pass.

### Broad workflow follow-through (2026-09-18)

The W03 breakpoint failure reproduced in the unchanged `a5558a7c3` owner.
Its test had both a stale source-line anchor and a second key press before the
cartridge consumed the previous release. The corrected test checks the actual
bound breakpoint and observes release in the ICU, then the following input
sample, before holding the key until the breakpoint. This follows the distinction
between input dispatch and application response in
[Playwright's keyboard implementation](https://github.com/microsoft/playwright/blob/63919674b13bbf0f18c5ff18c821ac7728d263f8/packages/playwright-core/src/server/input.ts),
and requested versus verified source breakpoints in
[VS Code's debug model](https://github.com/microsoft/vscode/blob/89ac545ab4d289d247a5feed1bcb1b71c3635f14/src/vs/workbench/contrib/debug/common/debugModel.ts).
No debugger or guest-input behavior changed. Scene tests also stopped assuming
six captured imports: statically bound imports need no capture slots. They still
verify that the actual capture layout and live actors survive each Hot Resume.

The title bootstrap likewise observes the current presentation before sending
Confirm. Two unconditional presses could queue a gameplay Start when WebGPU had
already advanced to Story, making later title-only assertions invalid. The
shared navigation fixture now confirms each observed presentation and checks
the title's actual idle state. It does not change cartridge input handling.

Reaching the cold reboot exposed a product defect: changing `intro.lua` could
replace the same-named `intro` texture with a Lua asset. A live atlas cache hid
that invalid ROM until reboot, where `atlas.resolve` faulted. The source rebuild
now selects replacements by `(asset type, asset id)`, matching the existing ROM
directory contract. Adding a new Lua file tests for an existing **Lua** asset,
not any asset with that name. This follows complete resource identity, as used
by [Godot's resource loader](https://github.com/godotengine/godot/blob/9c776068d6ed23acd0c78bfe534272d1d2a3a619/core/io/resource_loader.cpp#L689)
for canonical resource paths; BMSX retains its own typed ROM identity.

Both same-name source-edit and source-addition regressions failed before this
fix and pass afterwards, preserving texture bytes and publishing the new source
and parsed module. The browser fault gate resets its intentional-fault allowance
at reboot, when the physical counter resets. Post-scenario source tests navigate
by the cartridge resource's domain instead of assuming the paused CPU has
already left the BIOS. Canonical resources remain available without running the
cartridge just to open its source.

`--studio-scene-viewport` runs the existing viewport workflow independently on
software, WebGL2 and WebGPU. Both MSX and tiny fonts pass the focus, clipping,
scrollbar capture, source-edit/Undo and collapsed-panel checks. After checking
the end of the form, keyboard scrolling positions X immediately behind the
header; the test no longer assumes that XYZ are the only authored options.
It still checks that clicking a clipped field cannot focus or edit it.

Continuing into gameplay after Hot Resume exposed another product defect:
`rom_dir` retained raw addresses into the previous medium's TOC. Cached images
could still draw, but admitting the first new enemy failed at `image.resolve`.
`cartlib/rom_dir.lua` now renews its directory indices and decoded records in
the existing dependency-ordered `<init>` lifecycle, before dependent preparation.
The owner clears derived caches at the reload boundary, as
[ASP.NET Core's metadata update handler](https://github.com/dotnet/aspnetcore/blob/8821f7eb710e9ab70f1493e9be6fb9d5cff3d75b/src/Shared/PropertyHelper/PropertyHelper.cs#L557)
does for reflection caches. No revision polling or additional work was added to
ordinary lookup, game, or render frames.

The O0/O3 regression failed before this change and passes afterwards. It replaces
both physical media, relocates their directories, and checks previously cached,
new, removed, same-name typed, and system resources after annotated preparation.
The real Nemesis scene-authoring workflow also passes on software, WebGL2 and
WebGPU: save placements, cold reboot, enter gameplay, edit source, Hot Resume,
retain the stage/player, and admit the next enemy at the edited position.
The scenario-debug workflow also passes again on all three renderers, covering
the breakpoint, locals, navigable guest fault, original host trace, Debug/Stop,
and Run restoration. These are automated Studio workflows and guest-state
assertions, separate from the manual UI-only 2024 investigation below.

The complete `--studio` workflow passes on all three renderers after both product
fixes. It covers breakpoint/step, source revisions, rewind, fault repair, scene
edits, cold reboot, Scenario Lab Run/Cancel, and the viewport checks.
`BMSX_TEST_BACKEND=software|webgl2|webgpu` selects one renderer
for a reproduction; the default still runs all three. Logs and screenshots are
under `.bmsx/authoring/studio-w03/`. The test-project TypeScript check still has
67 pre-existing diagnostics, identical to the baseline; these changes add none.
The production TypeScript build and strict architecture audit pass (zero boundary
issues), as do the 22 focused directory/init and source/texture/media tests.

The 2024 investigation is separate: screenshots and physical keyboard/pointer
actions in the actual product, without application-state evaluation, clipboard
injection or external Lua-file edits. A breakpoint in `begin_quiz`, runtime
hovers and the retained assertion stack established that the test checked the
navigation state too early after its two-tick input pulses. The test
now holds each key until it observes that state, then releases it explicitly.
It keeps the question-index and portrait assertions and the runner's existing
deadline; no additional timing delay or cart change was introduced.

The complete navigation sequence passed through both Debug and Run in Studio:
intro -> question 1 -> intro -> question 1 -> last question -> conclusion -> last
question, including after a full page reload. The test was edited with keyboard
input and saved through Studio; repository diff inspection was used afterwards
to review the saved changes. The UI action log and screenshots are retained in
`.bmsx/authoring/2024-studio-only/`; `ui-449.png` shows the run after reloading.
