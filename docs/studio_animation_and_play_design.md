# Animation authoring and interactive scenarios

This is the implementation plan for the agreed Studio workflow. A section being
specified here does not mean that its UI or execution path already exists.

## Implementation status

The source-authoring foundation is implemented. **Animation** opens exported or
selected inline Lua timeline definitions; **New Timeline Definition** creates an ordinary Lua
document through the existing resource service. Tracks, native-coordinate key
selection/movement, field editing, insertion/removal and shared Undo/Redo/Save
use the same working copies as Source. Imported tables retain their written
document owners. Neither opening this editor nor moving its cursor plays a
timeline or advances a machine.

The visible browser check used ordinary keyboard/pointer interaction in Studio
with `2025` loaded: resource creation, track creation, key selection/drag/cancel,
Undo/Redo, insertion/removal, Save, Source navigation and reopening. It exposed
and corrected an inverse-pixel-rounding bug: a click must not move a key. Separate
development harnesses execute an edited definition through the real cartlib/CPU
at O0 and O3; they are not the Studio-only acceptance test.

Persistent interactive Play is now exposed through Scenario Lab's **Play** action.
It captures the selected integration module's shared fixture and the current
working copies, admits an independent physical machine, and keeps it alive for
human input. The Play viewport owns no new terminal, animation evaluator or
transport: the shared rewind bar binds that session's actual history/navigation.
Stop performs bounded fixture cleanup; Reset captures current source and joins
the old lifetime before constructing another world. Closing the transient tab
revokes input/audio immediately and joins backend work before disposal.

This is **not yet** the final `2025` transition/combat workflow. Inline
procedural definition selection/navigation is implemented below; coordinated
curve/sequence authoring remains separate work. Play's Actor/FSM inspection is implemented in the
target-binding slice below. No exported-definition rewrite has been
imposed on those carts to make the first editor appear complete.

The compiled fixture mechanism is now separate from automatic case policy.
`GuestFixture` owns physical admission and phase calls; `FixtureOperations`
transports the existing compiled context yields. `TestExecution` still owns
automatic budgets/results and composes debugger instrumentation. `PlayFixture`
admits an integration module's shared setup without executing any test body or
creating a result. Ready grants no CPU time; explicit Stop performs bounded
teardown. Uncooperative continuations remain quarantined and inspectable.
Only Ready worlds are eligible for gameplay history; admission/cleanup never
restore a partially executed host protocol. Teardown resolves the current guest
module after a restored heap, not borrowed pre-restore closures.

These are **development-harness checks**, not an interactive Play UI claim:
O0/O3 admission, real ICU setup samples, publication/capture, independent world
execution, authoring isolation, cancellation/failure and Stop after save-state
restore. A local Node 22 comparison against the previous case runner used 5,000
compiled log yields (12 alternating measured runs per version after warmup):
115.67 ms versus 116.50 ms median, the same 420,443 guest cycles and 5,003 grants.
Guest heap use fell by six bytes because unused `cancel` is no longer eagerly
interned. This is a specific admission workload measurement, not a general
performance guarantee. These checks established fixture admission; they did not
prove the visible Play viewport or the Studio-only `2025` acceptance.

Host focus now names a physical-input recipient, not merely game bounds. The
primary player, a secondary session channel and the UI are exclusive recipients;
secondary focus cannot release the author's workbench hold. Existing Game,
Actor Lab and BIOS viewports all explicitly name the primary recipient. The
primary BIOS/supervisor retains its own physical input and request line. The
real two-machine ICU check also preserves a previously latched sample until
the next sampling edge: focus does not rewrite MMIO. Existing Studio Game/Actor
focus/transport workflows pass on software, WebGL2 and WebGPU. A Node 22 check
of one million primary snapshots (12 alternating measured runs after warmup)
measured 440.40 ms old / 432.64 ms new, with identical snapshots; this does not
establish whole-game performance or an interactive test-scene viewport.

Completed offscreen frames now have an explicitly subscribed, retained bitmap
resource. Pixel storage survives equal-size publications and no automatic test
copies pixels unless it requests this resource. Actual software/WebGL2/WebGPU
pixel checks cover first upload, an unaccepted producer mutation, revision update
and resized texture bindings. This check caught and fixed a WebGL draw-binding
error: uploads select their own texture unit, so the draw unit must be selected
after upload admission. The permanent pixel check failed before that correction.
Compiled O0/O3 fixture checks use real PCRTC writes to publish completed frames,
not a no-draw tick relabelled as an image. A Node 22 copy-only measurement
(ten measured batches of 5,000 publications after warmup) measured approximately
3/47/202 microseconds per publication at 256x212/320x240/640x512, retaining storage.
Those are local host-copy timings, not GPU upload cost or whole-game performance.
This resource is one dependency of Play, not an alternative session owner.

The fixture operation port is now independent of the physical target's input
source. Automatic cases still own a `TestInput`; Play's input owner selects that
scripted port during setup/cleanup and its explicit physical channel during play.
There is no blended snapshot, forwarding test-target facade or change to the
primary input source. Compiled O0/O3 checks keep a physical key held throughout
admission, exercise human input through the actual ICU/IRQ, then verify bounded
teardown cannot consume that held key. This is session-boundary evidence, not
an interactive viewport or completed `2025` authoring claim.

Physical audio now has a single device owner with explicit runtime-source
selection. Inactive session controls cannot suspend or retime the primary
output; each output retains its own mute reasons and resampler. The actual
selected callback goes directly to the transport, adding no per-sample routing.
Source changes discard output-only playback, while releasing composed mutes
preserves the valid PCM produced after supervisor voice-clock release. Physical
two-runtime PCM checks and the existing APU/resampler/frame suites pass (44
checks). Existing real-cart Game/Actor input workflows pass on all three browser
backends; WebGPU rewind still produces real audible PCM and hidden reconstruction
passes. Those are development conformance checks, not an interactive Play
viewport or final Studio-only authoring acceptance.

## Reference owners

- [Godot's animation track editor](https://github.com/godotengine/godot/blob/master/editor/animation/animation_track_editor.cpp)
  separates gesture preview from an undoable resource edit. Moving a key does
  not rewrite an animation on every pointer sample.
- [Godot's AnimationPlayer editor](https://github.com/godotengine/godot/blob/master/editor/animation/animation_player_editor_plugin.cpp)
  binds authoring to the animation resource and playback to a concrete player.
- [Godot's scene run bar](https://github.com/godotengine/godot/blob/master/editor/run/editor_run_bar.cpp)
  launches a chosen scene with an explicit run lifetime. The editor document is
  not the running instance.
- [Unreal's PIE/SIE](https://dev.epicgames.com/documentation/en-us/unreal-engine/ineditor-testing-play-and-simulate-in-unreal-engine)
  distinguishes interacting with the game from inspecting it. BMSX uses an
  authored test fixture instead of copying an arbitrary live world.

The references establish ownership and interaction patterns, not permission to
copy their compatibility layers, defensive checks, simulation or UI framework.

## Existing owners and the missing boundary

| Concern | Current owner | Required change |
| --- | --- | --- |
| Authored animation | ordinary Lua timeline definitions | A source projection and key editor, not a second animation database |
| Evaluation | `cartlib/timeline/program`, track/scalar/sequence programs | Keep the native definition and evaluator; no host playback interpreter |
| Behavior transitions | source-backed FSM/BT editors | Select when an animation plays; do not duplicate the animation editor |
| Composition | canonical scene-library Lua and the Scene Editor | Add composition tools here, not in an animation-specific scene format |
| Text, history, save | `EditorTextModel`, working-copy services | Every visual edit is a targeted edit on these same documents |
| Automatic scenario | `ScenarioRunService`, `TestRun`, `TestExecution` | Preserve bounded assertions, cleanup and result semantics |
| Isolated machine | product-composed `OffscreenMachine` | Reuse physical machine construction; do not swap the authoring Runtime |
| Live inspection | target-bound debugger; authoring-bound Actor Lab | Explicit session bindings before live test inspection is exposed |
| Rewind | Runtime history plus host transport/presentation policy | A test session owns its own history and transport, never the author's |
| Physical input | host input manager and focused Game viewport | Explicit routing to the focused session; scripted setup and human play do not compete |

The current test runner is intentionally not a persistent Play session: it
finishes/disposes successful cases, advances in bounded batches and does not
publish a continuously displayed viewport. Removing budgets, keeping successful
tests alive or redirecting global `getRuntime()` would not fix that ownership.

## Source-backed animation slice

Start with ordinary Lua modules that export timeline definitions, for example:

```lua
return {
	frame_duration = 20,
	duration_ms = 1000,
	tracks = {},
}
```

The cart installs that definition through its existing timeline component.
There is no new ROM asset kind, annotation, decoder, registration API or wrapper
around `timeline_program.compile`. Discovery follows the retained Lua source
reader, including imported definitions. It does not run Lua or identify a
timeline by looking at a live table.

- Tracks retain authored order. Keys retain source identity; their time order
  is a presentation/evaluation concern, not a source rewrite.
- Native coordinates remain `frame`, `time_ms` or normalized `u`. A missing
  frame duration is not guessed from nominal video frequency. The first editor
  presents the selected track on its own labelled native axis.
- Values, bindings, paths, interpolation and cubic tangents are the existing
  cartlib fields. Dynamic producers and callbacks stay source; they are not
  baked into editable default tracks or silently evaluated by the host.
- Structural edits require a uniquely written, unmutated table with understood
  field boundaries. Known fields of a partial definition remain inspectable.
- Pointer motion changes only the retained key gesture. Release commits one
  document edit; Escape, lost capture, source changes or disposal cancel it.
- Source, Undo/Redo, Save, recovery and reapplication use normal document owners.
  The source editor and animation editor must see the same working copy.
- Source projection/layout happens on source/font/bounds changes. No Lua parse,
  graph solve, temporary key arrays or source writes occur per idle host frame.

Subsequent slices add coordinated track overview, curve handles, subsequences,
sprite-sequence authoring and composition. They extend these owners rather than
introducing a parallel animation format. Procedural builders remain procedural;
producer parameters can be edited, generated samples cannot become source.

## Interactive scenario slice

Reusable guest fixture admission is separate from automatic test policy.
Initialization/setup/teardown use actual compiled guest coroutines
and the existing physical publication boundaries. A Play session must neither
fake a passing test nor keep an assertion coroutine running indefinitely.

- A fixture launches into a fresh physical target from captured working copies.
  Automated tests and interactive sessions consume the same setup source.
- Setup is bounded. Interactive play is paced by host elapsed time, not the
  test runner's accelerated grant loop. Explicit Stop owns teardown/disposal.
- Reset rebuilds/relaunches the fixture from a new source admission. Rewind
  restores the test machine, not the authoring cart or a host shadow world.
- Runtime, immutable admitted sources, debugger, suspended inspection, input,
  output, transport and history have one session lifetime. Views bind to it;
  the authoring session keeps its identity and plans.
- Focus loss releases human input. UI shortcuts do not reserve normal game keys.
  Game view, Actor Lab and behavior/timeline inspection share the chosen target.
- Seeking reconstructs offscreen; only the completed requested state is
  published. Stepping uses physical video boundaries, not animation key time.
- Editing an animation changes source, not the live instance. Reapply/reset is
  explicit and reports the admitted source identity; no hidden restart.

Any hardware/runtime changes require the TS/C++ representation table and the
hot-path audit. None are required for the first source-authoring slice.

### Input recipient boundary

The next host slice replaces the primary game's capture boolean with an explicit
physical-input recipient. A focused viewport carries both its bounds and its
recipient; focusing a test viewport must not unblock the authoring machine.
[Godot's SubViewportContainer](https://github.com/godotengine/godot/blob/master/scene/gui/subviewport_container.cpp)
similarly routes input into the chosen viewport rather than treating any game
rectangle as the primary scene. BMSX retains ICU sampling, not Godot's event API.

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Physical HID/pad/pointer state | host `Input` handlers | `LibretroInput` physical words | No guest representation change |
| Focused recipient | primary `Input`, session `InputChannel`, or UI/null | one native player, no Studio/session focus | Explicit TS host routing only |
| ICU sample | fixed snapshot arrays and raw words | mirrored `InputControllerSnapshot` | Unchanged |
| Supervisor input/request | primary host/supervisor policy | libretro supervisor policy | Unchanged; no request leakage into secondary sessions |
| Recorded input | Runtime-owned journal | mirrored Runtime journal | Unchanged; replay bypasses physical routing at the existing device observer |
| Fixture/play handoff | session `PlayInput` selects `TestInput` or `InputChannel` | no native Studio fixture | Host admission/cleanup policy, not a hardware input format |

Hot-path callsites are `InputController.onVblankEdge` ->
`Input.sampleInputControllerSnapshot` (primary) or
`InputChannel.sampleInputControllerSnapshot` (session), and the shared physical
snapshot writer/pad-remap scratch. Focus selection changes once per host frame
after UI dispatch. No per-sample recipient lookup, event queue, array allocation,
numeric encoding, Runtime replacement or native dormant session is required.

### Completed-frame resource boundary

An interactive offscreen target publishes retained RGBA8 pixels only after a
completed presentation. A borrowed software framebuffer is not such a resource:
partial rendering can overwrite it while a view is still displaying the previous
completed state. One copy into retained host storage per accepted frame separates
those lifetimes. It is neither screenshot encoding nor a guest readback. Targets
without a frame consumer do not allocate or copy this storage.

[Godot's ImageTexture](https://github.com/godotengine/godot/blob/master/scene/resources/image_texture.cpp)
distinguishes updating an existing texture from replacing its storage. BMSX's
host bitmap owner similarly publishes a revision. Repainting a held view does
not upload again; a changed revision updates storage, and changed dimensions
replace backend texture storage. Pixels and physical publication position travel
together. Seek reconstruction does not publish intermediate states.

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Guest GPU words/VRAM | GX GPU and software datapath | mirrored GX GPU/datapath | Unchanged |
| Completed physical position | `RenderPresentationState.gameFrame` | existing native presentation policy | No guest state or codec change |
| Process-local bitmap | `HostBitmap`, host overlay only | no Studio bitmap resource | Explicit retained pixel revisions in TS host rendering |
| Same-size texture update | WebGL `texSubImage2D`, WebGPU `writeTexture` | GLES2 `glTexSubImage2D` | Use existing upload boundaries; native datapath unchanged |
| Resized storage | WebGL/WebGPU texture creation | existing GLES2 texture storage resize | Bitmap cache replaces its owned texture; no stale bindings |
| Software view sampling | retained `HostBitmap.image` pixels | no native Studio view | Reads the same accepted revision as GPU-backed views |

Hot-path callsites: `OffscreenMachine.present` publishes only a newly completed
`gameFrame`; `HostBitmap.update` copies into retained storage; the WebGL/WebGPU
host-overlay pipelines use `HostBitmapTextures.get` to upload changed revisions.
The headless host-overlay bitmap path consumes retained pixels directly. The
WebGL texture owner updates its existing metadata record rather than allocating
one on each upload. No CPU, scheduler, VRAM, replay or C++ machine code changes
are needed for this host-output slice.

### Physical audio ownership

Play must not construct a second output controller against the same physical
sink. The device selects one runtime output. Each runtime output retains its
own mute reasons, resampler and APU output queue; a source that is not selected
cannot suspend, replace or retime the selected source. Switching discards the
previous transport and resets source playback, not guest APU state.

[JUCE's AudioSourcePlayer](https://github.com/juce-framework/JUCE/blob/master/modules/juce_audio_devices/sources/juce_AudioSourcePlayer.cpp)
selects an explicit source with a separate device callback lifetime. BMSX needs
that ownership separation, not a mixer, per-session fake sink, mutex or host
audio sample interpreter. The physical sink receives the selected output's
existing resampler callback directly: selection adds no per-sample dispatch.

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Guest APU slots/commands/timing | `AudioController`, device service clock | mirrored APU | Unchanged |
| PCM output | signed stereo i16 `ApuOutputRing` | mirrored output ring | Unchanged |
| Resampling | per-runtime `AudioOutputResampler` | per-player resampler | Same algorithm and sample rates |
| Mute intent | per-runtime `HostAudioOutput` reason mask | existing native host reasons | Not a guest register or cross-host schema |
| Device callback | one selected output, `HostAudioDevice` owns the sink | one libretro player output | Explicit TS host source selection; no dormant native Studio |
| Transport discard | source resampler reset/APU queue clear; sink puller replacement clears browser transport | existing playback reset/output clear | Output-only boundary, never guest rollback |

Hot-path callsites remain the selected `HostAudioOutput` callback ->
`AudioController.synchronizeOutput` -> `AudioOutputResampler.pull`. Browser
audio transport pumping still runs once at host presentation. Device selection,
mute transitions, reboot/reset and frequency changes are control boundaries;
they must not allocate callbacks or poll a source registry per sample.

### Session pacing and history

The primary host polls physical devices and updates the UI input clock once.
Session execution reuses the existing paced machine-update/frame-step functions
without an `Input` manager parameter: output synchronization is a machine/audio
boundary, not permission to retime the editor's keyboard handling. Only primary
product composition updates `Input`'s frame duration. There is no no-op input
manager or copied execution loop to conceal this distinction.

A Play session owns an `OffscreenMachine`, `PlayFixture`, `PlayInput`,
`HostExecutionControl`, `HostFrameSession`, `HostRewind`, `RuntimeTaskQueue` and
completed-frame subscription. Setup/cleanup retain bounded fixture grants;
Ready uses elapsed host time and physical video boundaries. History starts only
after Ready, on that machine's checkpoint/input-journal owners. Closing first
stops admission, then joins queued readbacks/history work before releasing the
machine. Reset rebuilds a new session from explicitly captured source; it does
not replace the authoring Runtime or silently install working-copy edits.

| Representation | TypeScript | C++ | Change |
| --- | --- | --- | --- |
| Scheduler/cycles/video boundaries | existing Runtime/FrameScheduler | mirrored scheduler | Unchanged |
| Elapsed-time pacing | one `HostFrameSession` per running physical target | native single player frame pacing | Reuse existing TS execution functions; no dormant native Studio session |
| UI input clock | primary `Input` only | frontend physical input timing | Independent from secondary machine frequency |
| Checkpoints/input journal | target's Runtime history | mirrored history | Unchanged, no host shadow world |
| Async backend lifetime | session `RuntimeTaskQueue.join` before target disposal | existing native output/task lifetime | No callback may retain a released session |

Hot-path callsites are the existing `executeHostUpdate`/
`executeHostLogicalTick` -> Runtime frame scheduler -> physical devices, with
`HostFrameSession.syncMachineOutput` synchronizing audio only. Primary input
timing is updated at product frame completion, using the existing changed-value
check in `Input.setFrameDurationMs`. Ready uses no fixture yields, fabricated
test results or repeated source capture. History reconstruction remains hidden
and publishes only the requested completed image through `OffscreenMachine`.

## Product gates

1. Source edits preserve unrelated bytes/comments; imported documents share
   Undo/Save/recovery. Incomplete, ambiguous and mutated source is not invented.
2. Visible Studio key editing, focus, capture cancellation, document history,
   save/reopen and runtime application are observed, not inferred from unit tests.
3. The interactive fixture runs with real user input and adjacent inspection;
   pause/step/rewind/reset do not touch the authoring machine.
4. `2025` is an acceptance case, not an editor schema: visually redesign a
   transition, then combat animation with effects/audio/behavior connections.
5. Final authoring is normal visible Studio interaction only: no external cart
   edits, direct model mutations, `page.evaluate`, clipboard injection or hidden
   target setup scripts presented as UI-only proof. Development harness coverage
   is reported separately from this acceptance evidence.

### Session composition boundary

`workbench/play_runtime.ts` is the physical composition owner: it constructs the
execution/audio/history owners and schedules the actual offscreen presenter.
Play contributions receive the `PlaySession` lifetime contract and factory;
they do not construct a machine or import a host frame-loop/presentation owner.
`frame_session.ts` and `machine_step.ts` own the reusable paced execution, while
`host_frame.ts` retains primary input polling, host menus and product frame
composition. There is no compatibility re-export or copied machine loop.
`PublishedGameFrame` belongs to the image contract; the retained `FrameBitmap`
is a view resource, not permission to invoke presentation policy.

The real compiled O0/O3 checks exercise human ICU input, zero-elapsed pacing,
held pause, exact video stepping, independent authoring state, target history
review/branch, teardown after heap restore and deferred target disposal. Original
host errors retain their identity; an already published physical fault blocks
the next grant. The latter check stimulates the producer-side read-only fault
latch, not a guest write or a claimed end-to-end firmware crash.
These remain development checks, separate from the visible Play checks below.
Final `2025` authoring is not yet validated.

### Physical transport and source execution

`SourceExecutionState` composes the existing source debugger and execution plans
without authoring working copies or fabricated test results. The authoring state
adds its actual breakpoint/source owners to that same object; the Play state uses
the immutable compiled fixture source catalog. Fixture admission owns the CPU
hook until Ready; gameplay then hands it to source execution, and cleanup takes
it back. Restore invalidates borrowed guest objects and resets source execution
against the same admitted compiled media.

The finite frame-navigation owner accepts this execution state for either physical
target. A real host/machine failure settles its outstanding navigation operation;
it cannot leave a waiter attached to a quarantined runtime. Tests stop at an
actual compiled-source breakpoint, verify that host frames and frame-step cannot
bypass it, source-step on the shared finite execution owner, then continue and
video-step that target only. Play's compiled-source picker binds to that immutable
catalog; its source execution actions use the same physical debugger. Original
physical faults also settle pending source operations.

`RuntimeTransport` owns playback intent and the matching navigation/history
target. Live editor panes expose their physical transport alongside their command
scope, and the shared rewind bar binds both. Ordinary authoring tabs deliberately
select the primary machine for global Run commands; they do not disable Pause
or borrow a secondary session. Switching the bar cancels its owned seek against
the previous target, not the newly selected one.

Reference: VS Code's [debug session lifecycle](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugSession.ts)
and [focused-session toolbar](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/browser/debugToolBar.ts).
The real browser Game/Actor input workflow passes on software, WebGL2 and WebGPU,
including the source editor's separate game panel and its explicit Pause. This
is regression evidence for current primary views, not the visible `2025` redesign.

### Interactive contribution and retained evidence

`PlayService` owns source admission, asynchronous preparation, retirement and
identity-bound Stop/Reset/close. The contribution controller resolves the actual
integration fixture; the editor input/pane retain only view state and that
handle. They do not fabricate a passing case or redirect global runtime/source
owners. Transient inputs declare their persistence capability; the editor group
does not maintain another list of kind-specific exclusions.

Fixture compilation is shared with automatic scenarios through the existing
working-copy capture/compiler/media pipeline. FSM and ActionEffect recorder
readers publish primitive facts to either an automatic-result sink or Play's
bounded evidence sink. Automatic cases retain strict overflow failure; human
Play explicitly keeps a rolling observation window and reports expired records.
The compiled fixture context retains recorder roots across checkpoints. Restore
retires borrowed tables and begins a new live evidence epoch; reconstruction
cannot append historical work to that epoch. No ship-cart trace calls are added.
Session Details formats a snapshot only on request, not on each host frame.

The visible Play check uses ordinary browser keyboard/pointer interaction with
`2025`: select an existing integration fixture in Scenario Lab, launch, focus the
game, press the real start key, pause and navigate frames, Reset, switch to the
independent original Game view, return to Play, Stop and inspect Session Details.
The compiled-source picker installs a real `cart.lua` render breakpoint. Seeking
past it and returning to the recorded present complete without a debugger stop;
live continuation then stops at that breakpoint, and Source Step Over reports a
source-step stop. Game focus deliberately routes keyboard input to the physical
game: clicking outside that viewport restores workbench command routing.
No direct model writes, guest setup injection, clipboard injection or
`page.evaluate` is part of this check. It tests existing shared setup, not a
case's scene-specific body, and is not the final transition/combat redesign.

That check exposed a debugger/history deadlock: a newly installed live source
breakpoint could interrupt hidden reconstruction, while source execution and
return-to-present both correctly refused to take over the reviewed world.
The shared source execution hook now admits user stops only outside recorded
replay. Hidden seeks and paced recorded playback select retained history;
explicit Resume Here restores ordinary live breakpoint policy. Physical faults
still stop the machine. The real O0/O3 regression fails before this change and
checks reconstruction, recorded playback, then a real breakpoint after live
admission. It does not clear breakpoints, invent a successful seek, disable the
machine's fault handling or silently branch history.

[MAME's debugger hook admission](https://github.com/mamedev/mame/blob/master/src/emu/debug/debugcpu.cpp)
similarly distinguishes debugger execution from machine save/load work. BMSX
uses its own recorded-history policy, not MAME's debugger flags. The added
condition is on the already instrumented source hook; a machine without active
source stops retains its uninstrumented executor. No hardware representation,
guest instructions/cycles, history codec or mirrored C++ machine change is needed.

The physical Actor/FSM binding is implemented in the target-binding slice below.
Remaining acceptance work: extend canonical procedural animation authoring,
then perform the transition and combat redesign through visible Studio
interaction. Do not present primary Actor Lab as inspection of Play.

### Installed code provenance before target-bound inspection

Runtime readers now depend on the installed code/source contract rather than
requiring a writable authoring `RuntimeSourceState`. The actual Play session
implements that contract with its admitted physical images; it does not create
fake registries, working copies or authoring media. Actor/behavior readers,
callback details and watches can consume this same owner without a runtime swap.
Their UI controllers and mutation/presentation bindings still need the separate
target-binding slice: this change alone does not expose Play's Actor Lab.

| Representation | Primary authoring session | Interactive Play | C++ machine |
| --- | --- | --- | --- |
| Physical code domain/address | installed image and actual CPU call target | admitted image and actual CPU call target | Unchanged |
| Written resource identity | path/domain captured at ROM load or code installation | captured original resource domain; physical cartridge may be remounted | No Studio source owner |
| Source payload | admitted text retained independently from writable registries | shared compiled text or lazily decoded immutable ROM bytes | Diagnostic/image encoding unchanged |
| Working copies | actual source registry/document services | None in the physical session | Not machine state |

`Blua32CompiledSource` is the existing lazy source payload moved out of the
test-specific builder into the central tooling owner. Image admission captures
written paths and source content together; Hot Resume captures the compiler's
diagnostic source map before installation. Source inspection no longer resolves
a live closure through a mutable working-copy filename. A rename/edit does not
change the code's source provenance, and physical execution domain is kept
separate from the original authoring resource domain.

The warmed callback cache compares actual call location and installed-media
identity only. It no longer reads working-copy registries or their revisions
per property update. A local Node 22 microbenchmark of one million cached
updates (12 alternating measured batches after warmup) measured 63.37 ms before
and 50.32 ms after this boundary change. This is one inspection-cache workload,
not a whole-Studio performance claim. Source capture/indexing occurs at admission,
not on host frames or CPU instructions; automatic test debugging gains no unused
inspection-media index.

O0/O3 development checks cover changed/renamed working copies, actual callback
address changes, a Play cartridge remounted from resource domain 1 into physical
domain 0, warmed source identity and no guest work/mutation during inspection.
These are architecture checks, not visible Play Actor/FSM acceptance.

Reference: VS Code's [session-bound debug source identity](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugSource.ts)
keeps debug source identity separate from an ordinary file path. BMSX uses its
own installed image provenance, not VS Code's URI/DAP or compatibility machinery.

### Physical Actor/FSM view and operation binding

**Play: Inspect Actors** opens the existing Actor Lab contribution against the
captured Play session. Each input names its actual controller and target; the
reusable pane binds to that input on attachment, not to the primary controller
captured by its constructor. The primary Actor Lab remains a separate input.
Play inspectors are transient and retire on Stop, Reset, close or fault. Closing
an inspector alone does not close its Play fixture.

The viewport binding names the actual presenter, input recipient, transport and
completed-frame resource. It neither substitutes a Runtime nor invents a source
registry. Actor choices, tree, FSM graph, follow, Details, watches and mutations
use the same physical guest and admitted images as the displayed game. Source
navigation separately checks the authored working copy against the captured
callback text; a newer primary code installation cannot make the wrong source
correspond to an older Play address. Stable callback/model versions reuse that
comparison without repeatedly flattening unchanged documents.

Actor operations use the existing guest-owned World rendezvous and debugger
control plans. The session's ordinary host-frame path executes/settles those
plans and temporarily excludes explicit mutations from gameplay history. It
restarts history only after completion and owned GPU work have settled. Restore
and close retire operation plans/borrows; Stop closes new operation admission
before bounded fixture teardown. No second CPU loop, rollback or shadow world
was added. The physical source debugger owns retained-stop/media correspondence;
the primary document UI observes primary stop changes rather than being cleared
by target-independent guest-call services.

Inspection hold is target-specific. An unfocused paused Actor view holds only
its displayed machine; focused game input or an explicit execution plan permits
that target to run. The authoring hold requires the primary transport/recipient,
so a live Play inspector cannot accidentally release the main cart.

| Representation | TypeScript owner | C++/machine change |
| --- | --- | --- |
| Actor identity and live values | actual `SuspendedGuestSession`, typed guest membership | None |
| Call admission/execution | session `ActorExecutionService`, World receipt, `SourceExecutionState` | Existing compiled guest API/instructions unchanged |
| Input and game coordinates | attached input's actual recipient/presenter | ICU/presentation datapaths unchanged |
| Accepted output | primary direct frame or Play's completed bitmap | No screenshot transport or native Studio facade |
| Source address and document | admitted image provenance plus canonical working-copy correspondence | Symbol encoding unchanged |
| Stop/reset lifetime | session plans/tasks and transient view/controller detachment | No machine reset policy change |

Hot-path changes are in `PlayRuntimeSession.advancePlay` (existing debugger-plan
boundaries), `runWorkbenchHostFrame` (once-per-frame target hold) and the active
Actor pane (existing retained projection/bitmap draw). Game input controls are
created on attachment, not repaint. Source-stop listeners notify on actual stop
identity changes, not instruction misses. Callback correspondence is cached by
admitted callback identity and document version. Idle primary machine/CPU
execution acquires no new guest instructions, numeric conversions or per-sample
input dispatch.

Reference: VS Code's [debug view model](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/debug/common/debugViewModel.ts)
keeps focused session/thread/frame identity explicit and binds capabilities to
that actual target. BMSX preserves its own physical machine and view lifetimes,
not VS Code's context-key/DAP machinery.

Development checks: O0/O3 real compiled actor calls, rendezvous, source breakpoint
pause/resume, close during a paused operation, unchanged primary state, retired
plans and restarted history; actual callback/working-copy edit/Undo/reopen
correspondence; the existing Actor projection/navigation tests. These 153
checks pass, as do IDE/test/browser typechecks and the strict boundary audit.
The primary real-cart Game/Actor input/Details/frame-navigation workflow also
passes on software, WebGL2 and WebGPU.

The visible `2025` Studio check uses only normal keyboard/pointer interaction:
Play fixture, actual game input into the classroom, select `p3.director`, inspect
and follow its actual FSM, shared previous/next frame controls, invoke the real
Go to State action, resume/focus the preview and advance dialogue, then verify
the separate main Game still shows the title. Reset and Stop retire the old
Play Actors tab. Images and action log are under `/tmp/bmsx-play-visible` during
development. This proves the target-bound interactive inspection path, not yet
procedural transition/combat authoring or the final animation redesign.

### Inline and procedural definition ownership

The authoring view selects a **written definition**, not a file, program
ID or live timeline. One Lua document can contain several definitions; its
working copy still owns their text, history and persistence. Inline views track
the selected table's text range through edits. Removing/replacing that range
retires the projection; it must not silently select another definition.

Discovery admits exported definitions, import-bound timeline-program producers
and the native `timelines[*].def` fields of import-bound FSM registrations. It
uses existing retained syntax and written-source queries, never the may-call
solver or a same-named `define` heuristic. A dynamic receiver such as
`self.timelines:define(...)` can instead be opened explicitly at its written
definition in Source. That gesture selects source, not a claimed runtime type.

`frames`, `tracks`, `subsequences` and authored durations are native definition
fields. A procedural `frames` function is not an editable key array. Details
retains the written expression; navigation to its written value source or single
named definition opens the actual builder/initializer, including imported documents.
The latter uses the language service's existing definition lookup, as in
[TypeScript's Go to Definition](https://github.com/microsoft/TypeScript/blob/v5.9.3/src/services/goToDefinition.ts),
and is navigation evidence, not a claim about which value a member or call produces.
It never grants structural edit authority or turns a call result into keys. Ambiguous
or runtime-created values remain Source. No sampling, generated replacement
tracks, global-to-literal substitution or new cart format is part of this slice.

This follows Godot's selected animation-resource ownership and VS Code's
resource/selection navigation, not their runtime reflection or compatibility
machinery. The TypeScript/C++ hardware representations and hot-path callsites
are unchanged. Discovery runs on command invocation; projection runs on source
generation changes. Dynamic/mutated track or key producers remain visible in
Details and navigate to Source; they are not hidden behind an empty key list.
An unambiguous frames-only definition can receive an ordinary native `tracks`
field without replacing its builder. Existing dynamic tracks are not overwritten.

Development checks cover imported/FSM registration discovery, explicit dynamic
receiver selection, range retirement/recovery, called-builder navigation without
execution, retained idle projection and real frame-builder plus authored-track
composition at O0/O3. The focused authoring/source/working-copy bundle passes
100 checks; IDE/test typechecks, browser build and strict boundary audit pass.
Those are development evidence, not a Studio-only game redesign.

The visible `2025` Studio check opens the actual combat definitions and their
original `timelinebuilders.lua` source, opens the inline transition at its Source
cursor, edits a definition property and undoes it, and adds a native track to
the existing combat intro before undoing that edit in its shared Source view.
No cart source was exported/restructured to fit the editor, and no source edit
was saved during this check. The screenshots/action log are under
`/tmp/bmsx-play-visible/inline-animation-*` during development. This proves
source-backed native definition authoring/navigation, not yet the final
transition/combat redesign or coordinated curve/sequence authoring.
