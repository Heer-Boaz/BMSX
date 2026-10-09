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

Before implementation, separate reusable guest fixture admission from automatic
test policy. Initialization/setup/teardown use actual compiled guest coroutines
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
