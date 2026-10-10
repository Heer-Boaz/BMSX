# Animation authoring and interactive scenarios

This is the implementation plan for the agreed Studio workflow. A section being
specified here does not mean that its UI or execution path already exists.

## Implementation status

The native Animation editor is implemented: coordinated track lanes, linear /
step / Hermite scalar curves, native tangent handles, child clips, sprite frame
sequences and event/tag/wave/sample track authoring. **Animation** opens exported,
inline or imported definitions. **New Timeline Definition** and **New Sprite
Frame Sequence** create ordinary Lua through the existing resource service.
Editing, ordering, duplication and Undo/Redo/Save use the same working copies as
Source. Imported tables retain their written owners and actual consuming factory
context. Opening the editor or moving its cursor does not play an animation or
advance a machine. Procedural producers remain navigable/editable Source, not
invented baked keys. The completion record below separates visible acceptance
from development-harness and performance evidence.

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

The `2025` transition/combat workflow is visibly exercised end to end: authored
fixtures, source-backed edits, Save, physical Reset, matching video frames and
target-bound Actor/FSM inspection. The completion slice also exercises native
curve/sequence editing and a timeline event reaching the existing AEM rule and
physical APU. No exported-definition rewrite has been imposed on the cart to
fit the editor.

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

The completion slice adds coordinated track overview, curve handles,
subsequences, sprite-sequence authoring and composition. It extends these owners
rather than introducing a parallel animation format. Procedural builders remain
procedural; producer parameters can be edited, generated samples cannot become
source.

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
The initial acceptance record validates procedural transition edits and a native
combat value track. The completion record adds coordinated curve/sequence
authoring and event/audio composition without changing physical transport.

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

The physical Actor/FSM binding and inline/procedural source navigation were
implemented in the subsequent slices below. The later acceptance record
exercises them during transition/combat edits. Primary Actor Lab must never be
presented as inspection of Play.

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

### Newly authored fixture admission

The visible acceptance creates, formats and saves an ordinary transition fixture
through Source, selects it in Scenario Lab and admits its independent Play world.
This exposed a payload-producer error: a present empty Lua buffer had no directory
extent, so its consumer received the entire ROM instead of zero bytes. Payload
layout now preserves `start == end` for present empty buffers; absent optional
payloads remain absent. No Play fallback, source exclusion or encoding recovery
was added. The directory and physical machine representations are unchanged.

The negative control reproduces the UTF-8 failure before the producer fix; the
directory round trip and actual O0/O3 new-fixture admission pass afterwards. The
49-check packaging/Play bundle, IDE/test typechecks, browser product and strict
boundary audit pass. The same visible Studio session, with its empty document
still present, now admits the new fixture, publishes the game and can pause it;
Session Details identifies the captured fixture and independent physical machine.
Evidence is under `/tmp/bmsx-play-visible/acceptance-transition-*` during
development. This check established admission; the subsequent redesign is
recorded below.

## Visible transition and combat acceptance

The browser session used ordinary Studio keyboard/pointer controls. The two
fixture files were created, typed, formatted and saved through Source:

- `carts/2025/tests/studio_transition_assert.lua` admits the real director at
  `overgang_monday` through its existing state machine.
- `carts/2025/tests/studio_combat_assert.lua` admits the real combat director
  at `combat_wekker` through its existing start operation.

Both reuse the integration fixture's bounded setup for automatic **Run** and
interactive **Play**. The case body verifies the admitted scene; Play does not
run that case or manufacture a test result. There is no hidden guest setup
script, generated substitute scene or live heap injection.

### Transition

1. Play the transition fixture; pause and review actual physical video frames
   9 and 10, including an actual previous/next frame round trip.
2. Inspect the independent `p3.director`, its active FSM and native timeline.
3. Use the existing `timelinebuilders.lua` Source view to replace the panel's
   entry/exit easing with its existing quadratic easing functions. Save and
   explicitly Reset Play from current source.
4. Review the same video frames again. The panel positions visibly differ;
   Actor Details reports the actual timeline's `position_ms = 140`, `head = 7`
   and playing state. The builder and canonical transition YAML remain intact.
5. Open the original Game view: the authoring machine still shows the title.

This is an actual procedural-source edit, not a claim that generated frames
became visually editable keys. The editor's producer navigation leads back to
that source instead of replacing the algorithm with sampled tracks.

### Combat

1. Play the combat fixture and record physical frame 8 as the baseline.
2. Open the existing inline `combat_intro` definition in Animation. Add a
   native linear value track, edit its keys to `(0 ms, 1.35)` and
   `(336 ms, 0.65)`, then Save through the shared Source document.
3. The initial track targeted `sprite_component.scale_x`. Live inspection
   correctly showed that the procedural frame still owned that same property:
   value evaluation precedes frame application in the native evaluator. A
   source edit or a green harness test alone would have missed this conflict.
4. Edit the path through Animation Details to the existing independent
   `sprite_component.draw_scale_x` channel. The sprite's native draw datapath
   multiplies that channel with its procedural scale. No evaluator-order change,
   new blending layer or cart rewrite was made to satisfy the test.
5. Save, Reset, review physical frame 8 and inspect the actual Maya sprite
   component. Its `draw_scale_x` is now `1.1` instead of `1`, and the portrait's
   geometry visibly differs from the baseline.
6. Resume and focus the Play viewport. Ordinary Down/confirm input selects the
   hit choice. Pause the real hit animation and open the corresponding live
   FSM graph: Follow reveals the active `combat_hit` state.

The artistic experiment edits were undone through the shared document history
and saved; the original `combat.lua` and `timelinebuilders.lua` bytes are
unchanged. The reusable fixtures remain. Both cases pass through Scenario Lab
Run, including after a full browser reload; the workspace catalog rediscovers
them without a shell rebuild. Play and Stop are also exercised after reload.

Local evidence is retained under the ignored
`.bmsx/authoring/2025-animation-play-2026-10-10/`: `actions.jsonl`, the input
driver, validation logs and `acceptance-transition-*`, `acceptance-combat-*`,
`acceptance-final-*` screenshots.
No `page.evaluate`, direct model edit, clipboard injection or external runtime
inspection drives this workflow. Repository source inspection was used during
development diagnosis; this is visible editing/playback/inspection evidence,
not a claim that every piece of project discovery occurred solely inside Studio.

Separate development validation: the combined focused bundle passes 402 checks;
IDE/test typechecks and the strict boundary audit pass. The earlier physical
audio and three-backend checks remain harness evidence, not proof of new audio
authoring in that initial browser session. At that point coordinated curve
handles, sequence overview and effects/audio composition remained open. The
completion slice below closes those editor/acceptance gates through the same
source/resource owners, without baking procedural samples or adding a format.

### Completion slice: authored lanes, curves and composition (2026-10-10)

Reference implementation inspected before changes: Godot's
[`animation_track_editor.cpp`](https://github.com/godotengine/godot/blob/master/editor/animation/animation_track_editor.cpp)
and [`animation_bezier_editor.cpp`](https://github.com/godotengine/godot/blob/master/editor/animation/animation_bezier_editor.cpp).
Their shared time axis, retained editor projection, preview-only drag and single
resource undo action are the applicable patterns. BMSX uses native Hermite slopes,
not Godot's Bezier resource representation.

Ownership for completion:

| Surface | Owner / representation | Runtime changes |
| --- | --- | --- |
| Coordinated lanes | Animation source projection, authored order, native coordinate units | None |
| Scalar curves | Written numeric values and native arrive/leave slopes; retained display geometry | None |
| Clip composition | Written `subsequences`, child `sequence` producers and binding maps | None |
| Frame sequences | Written `frames` arrays; callback-produced frames remain Source | None |
| Events, tags and waves | Existing native track definitions, ordinary Lua payloads/callbacks | None |
| Audition/input/history | Existing independent Scenario Lab Play target | None |
| Save / apply / undo | Shared resource working copies and existing installed-source pipeline | None |

An unknown duration, mutated table or procedural producer does not grant editable
baked data. Frame, millisecond and normalized coordinates are not guessed from a
host frame rate. Only lanes in the same native unit share the axis. Presentation
ordering never changes writer/effect evaluation order. Keys and tangents borrow
one source generation, preview without document writes, cancel on source/focus
retirement and commit one shared text-history operation on physical release.

Completion acceptance includes visible curve/tangent edit, cancellation and undo;
multiple aligned lanes and view navigation; native child clips and frame sequence
editing; event/effect/audio composition; real `2025` transition/combat Play and
source application. Parser/unit tests do not substitute for that UI evidence.

### Editing and navigation

- The selected scalar lane has a retained curve and key strip on the same native
  axis as its neighboring lanes. Pointer drag edits time/value together, or a
  native arrive/leave slope. Empty-space click chooses an insertion cursor;
  wheel zoom anchors at the pointer, middle-button drag pans, and **Frame All
  Keys** fits the authored extent. Arrow/Home/End navigation, capture loss and
  source edits do not accidentally commit a preview.
- Subsequence lanes expose native move and left/right trim. Left trim updates
  `clip_in_ms` with the native `time_scale`, retaining the same child time at an
  unchanged parent position. **Open Child Sequence** follows the actual inline
  or imported source. Binding maps remain ordinary editable Lua fields.
- Frame cells retain authored order. **Add Frame**, duplication and earlier /
  later moves operate on the shared source array and select the resulting
  occurrence. Sprite image choices come from the mounted ROM directory; the
  selected frame uses the shared image decoder, zoom/pan and retained bitmap.
  Timeline frame values remain native Lua values, not sprite-image records.
- Track creation offers the native linear, cubic, step, event, tag, wave and
  sample forms. Details edits native paths, payloads, bindings and parameters;
  Source/Producer navigation handles multiline or procedural callbacks. Sprite
  factories do not get timeline-only toolbar actions. Less frequent commands
  stay in the shared action menu/palette, not permanent transport buttons.
- Units never borrow semantics from a neighboring lane. Mixed/unknown domains
  remain Source after a working-copy change. Normalized cubic slopes without a
  known native frame domain are editable as source fields, not graphed with a
  fabricated scale. Wave/sample callbacks and frame builders execute only in
  the guest. These are explicit source-backed boundaries, not fallback data.

### Completion acceptance and negative control

The ordinary Studio browser session created temporary timeline, sprite and
composition-probe files through the resource/Source UI. Keyboard/pointer input
then exercised cubic time/value drag, native tangent drag, preview cancellation,
Undo, aligned event/tag/wave lanes, child move/trim/navigation, sprite image
selection, ordering/duplication and Undo/Save. Reload recovered factory context,
frame selection and zoom; frame-axis keyboard navigation and the actual packed
sprite preview were checked in the rendered low-resolution UI.

In the real `2025` combat definition, Animation added a cubic track for
`maya_b.sprite_component.draw_scale_x`, with keys `(0 ms, 1.35)` and
`(336 ms, 0.65)`, plus a `combat.results` event at `96 ms` and an activity tag.
The existing procedural frame builder remained intact. Explicit Save/Reset
captured these working copies into the independent Play machine. At the same
physical video frame 10, the portrait visibly differs from the baseline; the
target-bound Actor component reads `draw_scale_x = 1.07449`. A real next/previous
frame round trip returns to that physical position.

The UI-authored integration probe reuses the combat fixture's setup. It was run
through the actual Studio MCP tools (`studio_start_test_run`, event-driven
`studio_wait_test_run`, `studio_read_test_result` and `studio_reveal_test_run`),
not an external emulator harness. Its physical guest execution passes at tick 32:
the event fires once, the native cubic reaches `0.65`, and the APU music source
is the `m17` asset selected by the existing `combat.results` AEM rule. Source
inspection confirms that rule; this is event-map composition, not a new host
audio evaluator or an assertion about a listener's subjective audio experience.

Undo/Save restored the original combat bytes. The same Studio probe then fails
at the expected missing-event assertion, demonstrating that the earlier pass
actually depended on the authored timeline change. All temporary probes are
removed after acceptance; no artistic experiment or failing suite is shipped.
The reusable original transition/combat fixtures remain unchanged.
After cleanup, all 12 original `2025` Scenario Lab cases pass through the Studio
tools, including scene scanout, timeline composition and both reusable fixtures.

Local ignored evidence is retained in
`.bmsx/authoring/animation-completion-2026-10-10/`: physical `actions.jsonl`,
the input driver, `tools.jsonl`, accepted Lua snapshots, validation logs and
`completion-*`, `native-tangent-*`, `clip-native-*` and `sprite-*` screenshots.
No direct model writes, `page.evaluate`, clipboard injection or shell source
edits drove authoring. Shell reads were used for implementation diagnosis and
confirmation that the original artwork was restored.

Separate development checks execute source-preserving cubic/clip/template edits
through the native guest compiler/CPU at O0 and O3, verify one-drop/one-Undo and
source-generation retirement, and cover factory recovery and selected-occurrence
tracking. Retained key/curve arrays accept no idle projection writes. A local
Node 22.23.1 geometry-only measurement with 20,000 authored cubic keys, a
51-key visible interval and nine warmed batches measured a median 0.01844 ms
per viewport reprojection. This excludes source admission, painting and the
other lanes; it is not a whole-Studio or whole-game performance claim.
The final focused development bundle passes 319 checks; IDE/test typechecks,
the browser Studio build, strict architecture-boundary audit (zero issues) and
`git diff --check` pass separately. No machine, cartlib or C++ code changed in
this completion slice.

### Post-completion ownership and performance review (2026-10-10)

The review revisited Godot's track/Bezier editors and VS Code's resource edit
stack before changing the existing source, gesture and geometry owners. It
reproduced faults rather than treating every architectural suspicion as fact:

- Combined curve/clip edits were assembled in field-name order, while the shared
  text model consumes ascending source offsets. Independently authored field
  order could therefore corrupt Lua. The Animation edit producer now orders the
  edits; the shared model's contract and one-release/one-Undo ownership stay
  unchanged. No write/restore transaction or runtime rollback is introduced.
- Negative values/slopes became unresolved after projection. The written-source
  owner now retains a signed numeric literal as its actual authored terminal,
  including aliases. Other unary/computed expressions stay unresolved; the
  may-value solver is unchanged. Literal fields remain editable; an alias is
  readable but is not overwritten by a graphical literal edit.
- A step lane previously displayed its first value before the first key, unlike
  the native timeline. That un-authored clamp is removed. Linear/Hermite native
  endpoint behavior remains unchanged. Curve fitting uses the analytical
  Hermite derivative extrema rather than 32 arbitrary samples per segment.
- Track overview zoom/pan rescanned every key, and binding re-sorted the same
  source. Each admitted track now owns an immutable chronological index. The
  selected viewport borrows its positions and retains a mutable presentation
  order for gesture preview only. Overview/hit queries use binary bounds and
  visit visible keys. Curve bounds are retained until the source track changes.
  Equal-time priority and authored writer order are not rewritten.
- A tag vanished if both boundaries were outside the zoomed viewport. Its native
  interval is projected independently of endpoint markers and clipped by the
  existing overview render boundary.
- Changing from millisecond to frame coordinates kept the old cursor's numeric
  value. A new native axis now admits its cursor at its own extent start. Switching
  between lanes in the same unit retains the shared cursor, without converting or
  clamping authored coordinates.
- An arbitrary timeline string matching an image ID could acquire a sprite
  bitmap. Image preview now requires the existing proven sprite-factory source
  context; ordinary native frame values do not become asset references.

Source working-copy participation deliberately still has input lifetime, not
current syntax-node lifetime. Removing an import or breaking syntax must not
remove that resource from shared Undo/Save. No pruning facade or guest animation
evaluator was added. Machine, cartlib, C++ and the Play session owners are unchanged.

The source-order and step reproductions failed before their fixes. The signed
literal/alias and negative-curve reproductions likewise failed before changing
the shared source owner. Separate native compiler/CPU checks cover step behavior
and authored curve/clip execution at O0/O3. Indexed lookup checks retain frozen
source arrays and count visible-coordinate reads, rather than asserting UI text.

The local Node 22.23.1 comparison uses two 20,000-key tracks, 51 visible keys per
track and nine warmed batches. Median bind time fell from 18.57773 ms to
0.19155 ms; key-strip/curve/all-visible-overview reprojection fell from
0.38332 ms to 0.02098 ms. Source admission, paint/GPU work and machine execution
are excluded. This is a measured authoring workload, not a whole-Studio latency
guarantee or a claim that every operation is independent of total source size.

The broad Lua development suite passes 3,091 checks, with one existing skipped
check. Its old map-pane fixture initially failed because it installed a font but
not the corresponding inline-field metrics. The fixture now uses the normal font
configuration owner; no production fallback was added. IDE/test typechecks,
the browser Studio build and the strict boundary audit pass separately.

Visible review uses an ordinary Studio browser session with `2025` loaded. A
temporary resource is created and edited through keyboard/pointer input only;
negative curve/time edits and reordered clip trims survive Save/reprojection,
and each is undone once through shared Source history. The rendered step lane
has no line before its first key, and the zoomed tag spans the viewport even
with both endpoints offscreen. The same packed `maya_b` string is visibly an
ordinary frame value without factory context and a real decoded sprite with
the native sprite factory. Removing that factory call, without replacing the
written frames table, revokes the bitmap in the same open editor. The final
browser build also visibly changes a `500 ms` cursor to frame `0` when switching
native axes. All temporary resources are closed and removed after acceptance;
the original `2025` sources are unchanged. Its 12 Scenario Lab cases then pass
through the actual Studio MCP run/wait tools, including transition/combat
fixture admission and native curve/sequence behavior. Local evidence is retained under
`.bmsx/authoring/animation-review-2026-10-10/` (physical actions, screenshots,
accepted source snapshots, before/after measurements and validation logs).
