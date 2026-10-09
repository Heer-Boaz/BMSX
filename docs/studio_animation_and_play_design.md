# Animation authoring and interactive scenarios

This is the implementation plan for the agreed Studio workflow. A section being
specified here does not mean that its UI or execution path already exists.

## Implementation status

The first source-authoring slice is implemented. **Animation** opens an exported
Lua timeline definition; **New Timeline Definition** creates an ordinary Lua
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

This is **not yet** the final `2025` transition/combat workflow. Inline procedural
definitions, coordinated curve/sequence authoring and persistent interactive
scenario sessions remain separate slices below. No exported-definition rewrite
has been imposed on those carts to make the first editor appear complete.

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
performance guarantee. Persistent Play input handoff/output, real-time pacing,
session inspection/history and the Studio-only `2025` acceptance remain open.

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
This resource does not yet constitute a persistent Play session or its viewport.

The fixture operation port is now independent of the physical target's input
source. Automatic cases still own a `TestInput`; Play's input owner selects that
scripted port during setup/cleanup and its explicit physical channel during play.
There is no blended snapshot, forwarding test-target facade or change to the
primary input source. Compiled O0/O3 checks keep a physical key held throughout
admission, exercise human input through the actual ICU/IRQ, then verify bounded
teardown cannot consume that held key. This is session-boundary evidence, not
an interactive viewport or completed `2025` authoring claim.

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
