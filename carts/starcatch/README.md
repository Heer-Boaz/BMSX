# Starcatch: Orbital Defense

A 320×240 top-down shooter with GTE-projected ships. Launch from the title
screen, fly into the sector in a depth-changing arrival animation, and destroy
twelve enemies before losing three lives.

## Controls

| Action | Keyboard | Controller |
| --- | --- | --- |
| Launch / retry | Space or X | A |
| Move | Arrow keys | Directional controls |
| Hold to fire | Space or X | A |
| Dash, after unlocking | Left Shift or C | Left bumper or B |

Three kills unlock a brief shielded dash; six unlock twin cannons. The enemy
aligns with the ship, visibly charges, then fires an aimed projectile. Twelve
kills clear the sector.

## Studio authoring and inspection

- `scenes.lua` owns real title, intro, play, victory and defeat compositions.
  Replacing a scene disposes its objects, including its projectile pool.
- `actions.lua` owns fire, dash and damage ActionEffects and their input
  actionstrings. Behavior Lens can edit the source-backed effect properties.
- `poses.lua` owns arrival, idle, recoil, damage, dash and burst timelines.
  Arrival uses the frame clock while gameplay is inactive.
- `sentinel.lua` owns the enemy's align → charge → fire Behaviour Tree.
- `milestones.lua` owns the event-driven progression rules.
- `scene_renderer.lua` submits retained GTE geometry through the shared World
  command list; text uses the existing font and text components.

Inspect `starcatch` and its scene actors through the runtime tools. Use GTE/GPU
history for submitted geometry and frame/history navigation for live state.
Scenario Lab discovers `starcatch_assert.lua`: its three integration cases use
physical keyboard input to exercise arrival, movement, firing, upgrades, victory,
damage, defeat and retry. They do not set gameplay state to manufacture outcomes.

Game code was authored and saved through native Studio source/review tools.
Effect cooldown tuning also exercised the shared Behavior Lens model. Scene and
timeline definitions were authored as Lua, not through the visual scene or
timeline editors.

## Build

Use **Studio: Build Cartridge**, target `starcatch`, debug, O3. Publication does
not replace the running cartridge; open the completed build to install it.

For an exported artifact in `dist`:

```sh
npm run build:toolchain:cart -- starcatch --debug -O3
```

Then open `/studio.debug.html?rom=starcatch.debug.rom` on the existing server.

The scene/input structure follows production examples from
[Godot's Dodge the Creeps demo](https://github.com/godotengine/godot-demo-projects/tree/master/2d/dodge_the_creeps)
and [TPS demo](https://github.com/godotengine/tps-demo).
