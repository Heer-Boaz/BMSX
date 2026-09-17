# Authored cart compositions

The composition migration is complete for `nemesis_s`, `2025` and `pietious`.
Scenes contain placed objects. FSMs and timelines continue to own sequence,
animation and gameplay. Lua remains the authored source that Studio edits.

## References and ownership

The current production implementations reviewed for this slice are
[Godot SceneState::instantiate](https://github.com/godotengine/godot/blob/master/scene/resources/packed_scene.cpp),
[SceneTree scene replacement](https://github.com/godotengine/godot/blob/master/scene/main/scene_tree.cpp)
and [XState state entry](https://github.com/statelyai/xstate/blob/main/packages/core/src/stateUtils.ts).
Construction applies authored properties before activation; scene replacement
uses a structural lifetime boundary; entry actions precede scoped playback.
BMSX reuses its World and FSM boundaries. The follow-up
[lifetime migration](scene_lifetimes.md) adds explicit live scene ownership and
independent session state, without another scheduler.

The Nemesis audit confirms that the earlier manual autoplay restart has been
removed. Entry constructs members before autoplay; exit submits their disposal
to World. See [the Nemesis report](nemesis_s_scene_migration.md).

## 2025

| Source | Independently authored members |
| --- | --- |
| `scenes/dialogue.lua` | Background, main text, choices, prompt |
| `scenes/combat.lua` | Monster, two Maya poses, all-out surface, portrait, results cover and text |
| `scenes/transition.lua` | Fade overlay, three sliding panels, accent, caption |

`session.lua` owns story progression and statistics. `director.lua` consumes
that model; `combat.lua` owns combat phases. Neither constructs a private parallel representation of scene visuals.
The previous rectangle-state tables and director-wide drawing loop are gone;
those rectangles are ordinary visual objects with authored position and size.
The eleven role-specific copies of sprite/text/surface definitions are replaced
by their actual reusable visual prefabs in `presentation.lua`.

Combat retains each instance's authored anchor and animates from it on every
entry. Sliding panels animate component offsets relative to authored placement.
Text layout is converted once from scene-local bounds into TextObject's existing
world-space rectangle contract. Source options are not mutated. Cart reset uses
World clear; no separate scene tick, polling or recovery path is introduced.

Composition-migration validation (before the lifetime follow-up):

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

The lifetime follow-up replaces the persistent room object with one live room
per scene entry. `session.lua` owns durable progress independently of castle,
player and room objects. World disposes the entire outgoing composition,
including inactive members, pending admissions, projectiles and drops. Reentry
constructs eligible objects from definition plus session state. Doors derive
collision tiles from placement; shrine and entrance input use admitted objects.
See [the ownership and reset-policy table](scene_lifetimes.md).

The first room migration passed all 30 then-existing Pietious scenarios,
including Enter/halo, pause, door, seal, shrine, region respawn and scene
ownership/reentry. Current results are in the [lifetime report](scene_lifetimes.md#validation).
The 24 room scanouts plus the final image match the pre-migration ROM exactly.
Several older scenarios bound state paths or spawned probes before their
requested restart committed; they now wait for the incoming director identity.

Pietious now has 34 scene sources: the 24 room compositions plus these ten
compositions with 33 independently placed members:

| Source | Authored members |
| --- | --- |
| `scenes/gameplay.lua` | Player start and HUD |
| `scenes/intro.lua` | White background and logo |
| `scenes/title.lua` | Background and animated sparkle |
| `scenes/narrative.lua` | Story/epilogue caption |
| `scenes/shrine.lua` | Background and caption |
| `scenes/lithograph.lua` | Background and caption |
| `scenes/inventory.lua` | Background, eight icons, selector, map title and map widget |
| `scenes/transition.lua` | Black background, banner and game-over caption |
| `scenes/end_demo.lua` | Picture, message cover and caption |
| `scenes/effects.lua` | Seal-flash backdrop, closing curtain, victory message cover and caption |

`presentation.lua` contains the sprite, caption and rectangle prefabs. The map
and HUD remain coherent widgets with local geometry relative to their authored
origins. Controllers retain component references for animation and content;
they no longer construct private copies of screen geometry. Sparkle motion is
relative to the authored anchor. Curtain playback derives its step width once
from the instantiated rectangle. The director moves its authored effects with
the active presentation space and owns their scene; World commits their teardown.

The unused `transition.timeline` and its playback calls have been removed.
Transition timing already belongs to the director. Inventory visibility is
bound on entry rather than querying inventory for every icon every draw. The
player's authored start position seeds the session spawn anchor; death restart
and Enter/halo use that anchor even after replacing the actor. The duplicate start,
screen-position and effect-depth constants are gone. Runtime player/castle/room
bindings are applied to copies of authored options during world construction.

Composition-migration validation (before the lifetime follow-up):

- All 31 Pietious headless scenarios pass. The final effect change also passes
  the complete cinematic and death/restart paths.
- The 24 room poses and 16 presentation poses, plus their final captures,
  match the pre-migration ROM pixel for pixel. The victory animation is sampled
  at an explicit presentation-clock frame, independently of the gameplay clock.
- `browser.mjs --studio-cart-scenes pietious` edits the intro logo, player
  start, a room-2 rock, the victory caption and the halo icon through visible
  pointer/keyboard controls. Save, reboot, walking into room 2, opening inventory,
  Enter/halo back to the authored start and reopening the saved room source all
  pass on software, WebGL2 and WebGPU. Game captures follow an actual
  update/render/scanout pair; inspection does not inject runtime values or code.
- An identical 1,500-host-frame input recording covers intro/story skip, title,
  gameplay, room entry, inventory and halo. Retired instructions are 13,193,801
  versus 13,284,607 before migration; estimated base cycles are 14,688,648 versus
  14,815,575. This measures the recorded path, not SNES Mini hardware FPS.
- The architecture audit reports zero issues. The tests TypeScript check has
  the same 70 existing diagnostics as the pre-migration baseline.

Procedural bullets, drops, clouds and the 2025 hit-slash animation remain their
existing gameplay/effect producers. Terrain and topology remain map resources.
Neither needs a scene per frame, enemy state or draw primitive. The migration
adds no alternate lifecycle, recovery path or second authored placement store.
