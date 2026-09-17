# Authored cart compositions

The migration scope is `nemesis_s`, `2025`, then `pietious`. Scenes contain
placed objects. FSMs and timelines continue to own sequence, animation and
gameplay. Lua remains the authored source that Studio edits.

## References and ownership

The current production implementations reviewed for this slice are
[Godot SceneState::instantiate](https://github.com/godotengine/godot/blob/master/scene/resources/packed_scene.cpp),
[SceneTree scene replacement](https://github.com/godotengine/godot/blob/master/scene/main/scene_tree.cpp)
and [XState state entry](https://github.com/statelyai/xstate/blob/main/packages/core/src/stateUtils.ts).
Construction applies authored properties before activation; scene replacement
uses a structural lifetime boundary; entry actions precede scoped playback.
BMSX already has these boundaries in World and FSM. This migration adds no
second scheduler, SceneInstance or scene-specific World behavior.

The Nemesis audit confirms that the earlier manual autoplay restart has been
removed. Entry constructs members before autoplay; exit submits their disposal
to World. See [the Nemesis report](nemesis_s_scene_migration.md).

## 2025

| Source | Independently authored members |
| --- | --- |
| `scenes/dialogue.lua` | Background, main text, choices, prompt |
| `scenes/combat.lua` | Monster, two Maya poses, all-out surface, portrait, results cover and text |
| `scenes/transition.lua` | Fade overlay, three sliding panels, accent, caption |

`director.lua` owns story progression and statistics. `combat.lua` owns combat
phases. Neither constructs a private parallel representation of scene visuals.
The previous rectangle-state tables and director-wide drawing loop are gone;
those rectangles are ordinary visual objects with authored position and size.
The eleven role-specific copies of sprite/text/surface definitions are replaced
by their actual reusable visual prefabs in `presentation.lua`.

Combat retains each instance's authored anchor and animates from it on every
entry. Sliding panels animate component offsets relative to authored placement.
Text layout is converted once from scene-local bounds into TextObject's existing
world-space rectangle contract. Source options are not mutated. Cart reset uses
World clear; no separate scene tick, polling or recovery path is introduced.

Validation:

- All ten 2025 headless scenarios pass, including combat first-frame/skip,
  timeline/input regressions and scene instance/disposal/reentry checks.
- Fifteen fixed story/combat/transition poses and the final image match the
  pre-migration ROM pixel for pixel.
- `browser.mjs --studio-cart-scenes 2025` edits three scene sources through
  visible keyboard/pointer controls, saves, reboots, plays the transition and
  dialogue, then reopens the source. Software, WebGL2 and WebGPU all pass.
  Runtime inspection is read-only; no clipboard or model injection is used.
- An identical 1,200-host-frame recording from boot through dialogue retires
  3,063,946 instructions / 3,389,050 estimated base cycles versus
  3,077,492 / 3,401,664 before migration. This bounds the recorded path, not
  hardware FPS or every combat sequence.
- Strict architecture audit: zero issues. The broad tests TypeScript check
  retains the 70 pre-existing diagnostics; none concerns these scene changes.

Evidence is under `.bmsx/authoring/all-cart-scenes/` in the working checkout.

## Pietious

Cold boot now explicitly constructs the intro; an in-game restart explicitly
constructs the initial room after World update. The `init_epoch` /
`pending_intro_boot_epoch` bookkeeping has been removed. The `<init>` function
registers definitions; it does not decide the next game's presentation mode.
The cinematic-flow and death/restart scenarios both pass after this cleanup.

The 24 room compositions now author all 122 placed actors in
`scenes/rooms/room_*.lua`. Terrain, links and region topology remain in the map
resource. The YAML object lists and their placement decoder have been removed.
Cold category/dependency indices reference scene members directly; they do not
copy positions into a second representation. Compiled progression filters live
in castle's program, never on authored scene members. Retained enemy defeat is
checked once by admission, instead of also duplicating it in the conditions.

The persistent castle, player and room own inventory, defeated enemies and
destroyed rocks. Room departure disposes placed actors through World. Reentry
creates eligible actors with fresh bindings without resurrecting persistent
pickups. Doors derive collision tiles from placement; shrine and entrance input
queries use admitted objects. Procedural drops and projectiles remain procedural.

All 30 Pietious scenarios pass after the room migration, including Enter/halo,
pause, door, seal, shrine, region respawn and a new scene ownership/reentry test.
The 24 room scanouts plus the final image match the pre-migration ROM exactly.
Several older scenarios bound state paths or spawned probes before their
requested restart committed; they now wait for the incoming director identity.

In progress: author the independent presentation visuals and validate editing
room and presentation source through Studio.
