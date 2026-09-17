# Nemesis S: authored scenes

Nemesis S uses authored compositions for its presentation and gameplay. The
controllers own input, progression and animation; the scene sources own placed
objects. A scene is a useful group of objects, not a new name for every state
in the existing game sequence.

| Source | Authored members |
| --- | --- |
| `scenes/root.lua` | Director and presentation controllers |
| `scenes/intro.lua` | White background and independently placed logo |
| `scenes/story.lua` | Picture, two captions and transition curtain; panel content |
| `scenes/title.lua` | Background, selector and selection cover |
| `scenes/hangar.lua` | Background, ship and foreground lip |
| `scenes/gameplay.lua` | Starfield, terrain, HUD, two player starts and game-over curtain |
| `scenes/stage_actors.lua` | 179 individual enemies/scenery members and formation membership |
| `scenes/end_demo.lua` | Picture, caption and curtain; panel content |

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
Those options are an explicit image list; animation does not depend on a stale
`sprite_object.imgid` field after `set_imgid` updates the visual component.

Intro, story and end-demo controllers bind their timelines to ordinary scene
members. `presentation/caption.lua` and `presentation/curtain.lua` own reusable
visual components. Captions animate glyph visibility and panel-relative offsets;
curtains animate their opening at their authored position. Slides, lift, ignition,
boss progression and blackout remain FSM/timeline phases.

Gameplay owns six independent members rather than hiding all construction in a
stage controller. The starfield owns its particles and blink timeline. The HUD
draws sprites and text relative to its placement. The director admits selected
players at the authored start points; respawn uses those same points. Terrain
collision queries convert world coordinates through the terrain object's origin.

The actor scene contains actual level coordinates. Each `column` is a scroll
admission gate; `formation_id` groups actors that share progress in this run.
Stage builds its retained admission queue once, converting level x to screen x
at that gate and binding the current stage and formation state. It spawns members
through the existing World boundary as scrolling reaches them. The terrain YAML
now contains terrain only. `.` denotes empty terrain without generated snow;
enemy, chimney-controller and scenery marker decoding has been removed.

FSM entry installs completion bindings, runs `entering_state`, then starts
autoplay before entering child states. Title and hangar use that ordinary
lifecycle; they no longer disable autoplay and manually restart it to avoid
sampling unconstructed members. Explicit playback with runtime parameters
continues to use the completion binding installed before entry. State exit
owns stopping and unbinding playback.

This ordering follows the entry-actions-before-invoked-work sequence in
[XState `enterStates`](https://github.com/statelyai/xstate/blob/main/packages/core/src/stateUtils.ts).
The generic regression covers initial entry, reentry, compound/concurrent
states, manual playback completion and teardown. The existing allocation/cycle
budget for 10,000 transitions remains enforced.

## Lifetime and cost

Each presentation controller owns its returned member map. Sequence exit and
controller despawn release it through `scene_library.dispose`. That operation submits
each object to World's existing disposal/barrier path, including component and
subscription teardown. Title reentry constructs fresh members and resets
selection. Scene-local names are not global Registry IDs. Explicit singleton
runtime IDs belong to the composition or the director's admission call, not to
the reusable end-demo/HUD prefab defaults. Gameplay continues to use World's
normal space unload boundary on restart and end-demo entry.

`scene_library.instantiate(id, overrides)` accepts per-member runtime bindings
for values such as player state and checkpoint position. Only overridden options
are shallow-copied; authored definitions and untouched members are not copied or
mutated. The actor queue similarly owns its bound options and formation records.
Reentry never inherits the previous run's formation progress.

There is no new scene tick, hierarchy, reference resolver or World scheduling
branch. Construction and binding happen on entry. Existing sprite/custom-visual
producers still issue the draw calls.
`World`, its structural barriers and the machine/host contracts are unchanged.

## Studio workflow and validation

Open one of the scene sources through file search, then
**View → Scene Editor**. Select a member and edit its x/y/z properties. Save
and **Run → Reboot** install the changed cart source. Save alone does not patch
existing live objects. Source remains ordinary Lua with shared Undo/Redo.

The browser regression runs this workflow through keyboard and pointer input,
without injecting text into a model or using clipboard code. It changes the
selector x from 80 to 88 and ship placement from (48,129) to (56,125), exercises
Undo/Redo, saves, reboots and verifies the resulting game objects and relative lift.
It also edits the logo, story/end-demo captions, player start and an individual
stage enemy. After reboot it verifies the actual intro/story members, player
start and admitted enemy, then reopens the saved scenes. The file API uses an
isolated workspace. The same scenario passes with software, WebGL2 and WebGPU:

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
  runtime bindings without source mutation, re-registration and group disposal,
  including after World clear.
- `nemesis_s_title_scanout_assert.lua`: fourteen fixed title/hangar poses. The
  pre-migration and migrated carts produced identical pixels for every pose.
- `nemesis_s_presentation_scanout_assert.lua`: 25 intro/story/end-demo/gameplay
  poses; comparison against `719dd16ab` produced identical pixels, including the
  final capture (26 images).
- `nemesis_s_scene_compositions_assert.lua`: presentation teardown/reentry,
  independent formation state, authored respawn and terrain collision origins,
  plus the normal gameplay unload/restart boundary.
- `nemesis_s_gameplay_scanout_assert.lua`: compare actual gameplay at scroll
  steps 8, 30 and 80, independently of time spent loading the cartridge. Those
  captures and the final capture match the old ROM pixel for pixel.

The terrain/placement migration was also compared against the running old ROM:
all 12,188 decoded terrain/collision cells and all 179 actor records match,
including order, gate, admission position, type/direction and formation membership.

An identical 2,000-host-frame input recording covers boot, title, takeoff and
gameplay with the production fantasy-CPU profiler. Against `719dd16ab`, retired
instructions changed from 11,207,391 to 10,909,095 (-2.66%); estimated base cycles
changed from 11,761,435 to 11,459,533 (-2.57%). Fixed host-frame captures can have
different animation/progression phases when loading costs change; visual parity
is checked separately at equal poses and logical gameplay steps. This is a cost
check for the recorded path, not a hardware FPS or universal performance claim.

All 28 Nemesis headless scenarios pass, as do the generic scene-collection
scenario and 14 targeted FSM/scene editor tests. The strict architecture audit
reports zero issues. The broad tests TypeScript
check reports 70 diagnostics; comparison against the pre-migration sources
produced the identical diagnostic list. None was introduced by this slice.

## Other carts in scope

Nemesis's composition migration is complete. Stage progression, enemy behavior,
player state and boss phases remain gameplay responsibilities. `2025` and
`pietious` are also migrated; their ownership and validation are recorded in
[Authored cart compositions](cart_scene_migration.md). Pietious retains its
gameplay controller across room replacement, while an independent session model
preserves inventory and durable progression. Each room is now a fresh live
scene. The [lifetime follow-up](scene_lifetimes.md) also gives Nemesis gameplay
scenes ownership of dynamically admitted players, enemies and effects.
