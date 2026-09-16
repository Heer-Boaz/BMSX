# Nemesis S: title and hangar scenes

The first migration replaces the title controller's private visual construction
with two authored compositions. This is a vertical slice, not a declaration
that every Nemesis phase has already been migrated.

## Ownership and production references

- [Godot `SceneState::instantiate`](https://github.com/godotengine/godot/blob/master/scene/resources/packed_scene.cpp)
  constructs the authored members and applies their properties, retaining local
  identity for references. BMSX already has that construction boundary in
  `scene_library.instantiate` and `World:spawn`; the returned member map binds
  the cart's controller to the concrete objects.
- [Unreal Level Instancing](https://dev.epicgames.com/documentation/en-us/unreal-engine/level-instancing-in-unreal-engine)
  treats a reusable placement as a group of Actors. The hangar therefore owns
  its background, placed ship and foreground. The ship's body/exhaust are
  components of one prefab, not separate scene phases.
- [Unreal Sequencer](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-engine-sequencer-movie-tool-overview)
  separates animation tracks and playback from the Actors they address. The
  existing title FSM and timelines continue to own selection, confirmation,
  lift, ignition and departure. Each animation phase is not another scene.

`scenes/title.lua` contains background images, selector placement and the
selection cover's placement, size and color. `scenes/hangar.lua` contains
background images, ship placement and the foreground lip. Both use the same
visual-only sprite prefab from `presentation.lua`. `hangar_ship.lua` is the
coherent body/exhaust prefab. `title_screen.lua` owns sequence and input; it
does not construct individual visuals.

Animation is relative to authored placement: player two adds 16 pixels to the
selector and cover visuals; the lift adds offsets from 0 to -56 to the ship's
spawn y. Editing the ship from y=129 to y=125 consequently changes its ignition
position from 73 to 69. Background tracks use the scene's two image options.

The existing FSM binds scoped timelines before its entry callback. The two
scene-creating entries explicitly start their timelines after construction.
Their scope still owns stopping and completion callbacks. This avoids sampling
unconstructed members without changing the FSM contract or adding hot guards.

## Lifetime and cost

The title controller owns one returned member map. Blackout and controller
despawn release it through `scene_library.dispose`. That operation submits
each object to World's existing disposal/barrier path, including component and
subscription teardown. Title reentry constructs fresh members and resets
selection. Scene-local names are not global Registry IDs.

There is no new scene tick, hierarchy, reference resolver, copied runtime
definition, or World scheduling branch. Scenes allocate their members only
on entry. Existing sprite/custom-visual producers still issue the draw calls.
`World`, its structural barriers and the machine/host contracts are unchanged.

## Studio workflow and validation

Open `scenes/title.lua` or `scenes/hangar.lua` through file search, then
**View → Scene Editor**. Select a member and edit its x/y/z properties. Save
and **Run → Reboot** install the changed cart source. Save alone does not patch
existing live objects. Source remains ordinary Lua with shared Undo/Redo.

The browser regression runs this workflow through keyboard and pointer input,
without injecting text into a model or using clipboard code. It changes the
selector x from 80 to 88 and ship placement from (48,129) to (56,125), exercises
Undo/Redo, saves, reboots, verifies the resulting game objects and relative lift,
enters gameplay, and reopens the saved scene. The file API uses an isolated
workspace. The same scenario runs with software, WebGL2 and WebGPU:

```sh
node tests/conformance/runtime_replay/browser.mjs --studio-nemesis-scenes dist/bmsx-bios.debug.rom dist/nemesis_s.debug.rom
```

Headless cart regressions:

- `nemesis_s_cinematic_flow_assert.lua`: the original VBlank/image/pose
  boundaries, two-player admission, gameplay, end demo and title reentry.
- `nemesis_s_scene_lifecycle_assert.lua`: independent instances, actual confirm
  input and complete takeoff, disposal on sequence exit, reentry and cart reset.
- `nemesis_s_scene_identity_assert.lua`: repeated root-prefab instances and
  independent Registry/component lifetime.
- `scene_collection_assert.lua` in `cartlib_test`: ordered construction,
  options, re-registration and group disposal, including after World clear.
- `nemesis_s_title_scanout_assert.lua`: fourteen fixed title/hangar poses. The
  pre-migration and migrated carts produced identical pixels for every pose.

A separate, identical 1,180-frame input recording covers boot, title and the
takeoff sequence with the production headless CPU profiler. Retired instructions
changed from 4,736,598 to 4,730,146 (-0.14%); estimated base cycles changed from
5,029,644 to 5,024,311 (-0.11%). Both captured frames matched pixel for pixel.
This checks this path for a CPU regression; it is not a hardware FPS measurement
or a claim about every gameplay phase.

The strict architecture audit reports zero issues. The broad tests TypeScript
check reports 70 diagnostics; comparison against the pre-migration sources
produced the identical diagnostic list. None was introduced by this slice.

## Remaining migration

Intro/story/end-demo composition and stage placements remain subsequent Nemesis
slices. Stage progression, enemy behavior, player state and boss phases remain
gameplay responsibilities. They must not be hidden inside a single scene member
that just runs the previous construction code.

Then migrate `2025`, followed by `pietious`. Pietious's room reentry and persistent
progress already constrain lifetime: disposing placed objects must not imply
deleting the cart's durable room/player state. That state needs an explicit cart
owner before its rooms move to authored scenes. This slice adds no speculative
persistence or streaming machinery to World.
