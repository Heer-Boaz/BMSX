# Scene definitions, instances and game state

The first composition migration exposed real editable objects but left Pietious'
room alive as both its current renderer and its memory of previous visits. It
also used the `rs` tag and global Registry lookups to find objects to discard.
That was an incomplete lifetime model. Room exit now destroys the room and its
objects. Reentry constructs a fresh scene from authored data and game state.

## Production references

Reviewed source, pinned for this change:

- Godot `97dab7a638ae8b613dcf6e657f93f020471d9040`:
  [PackedScene construction](https://github.com/godotengine/godot/blob/97dab7a638ae8b613dcf6e657f93f020471d9040/scene/resources/packed_scene.cpp)
  separates the stored definition from instantiated objects;
  [SceneTree replacement](https://github.com/godotengine/godot/blob/97dab7a638ae8b613dcf6e657f93f020471d9040/scene/main/scene_tree.cpp)
  removes the outgoing scene and commits destruction/admission at a safe boundary.
- SuperTux `7221469f7ec2f74014fb46131405743d4389f4b9`:
  [PlayerStatus](https://github.com/SuperTux/supertux/blob/7221469f7ec2f74014fb46131405743d4389f4b9/src/supertux/player_status.hpp)
  survives map/session changes;
  [GameSession](https://github.com/SuperTux/supertux/blob/7221469f7ec2f74014fb46131405743d4389f4b9/src/supertux/game_session.cpp)
  supplies that status when constructing a player, while
  [Savegame](https://github.com/SuperTux/supertux/blob/7221469f7ec2f74014fb46131405743d4389f4b9/src/supertux/savegame.hpp)
  owns it separately from the active level.

BMSX applies those lifetime boundaries to its existing Lua World and structural
barrier. It does not add another scene scheduler, interpreter or desktop-engine
object hierarchy.

## Owners

| Owner | Data and responsibility | Lifetime |
| --- | --- | --- |
| Scene definition | Ordered `member_id`, prefab and authored options | Registered source revision |
| Live scene | Named members and a dense set of all currently owned World objects | One instantiated composition |
| World | Construction, Registry admission, scheduling, disposal and completion barrier | Current cart world |
| Cart session model | Inventory, health/loadout, persistent terrain/progression or story statistics | One game; explicitly replaceable by New Game |
| Scene/controller/FSM objects | Current pose, motion, encounter, animation and subscriptions | Their actual scene or gameplay lifetime |

`scene_library.instantiate(id, bindings)` admits the complete definition.
`scene_library.create(id)` creates the same owner for staged admission: Pietious
chooses eligible members from progression; Nemesis admits actors at their scroll
columns. `scene:spawn_member(member, bindings)` preserves the authored member key.
`scene:spawn(prefab, options, optional_member_key)` owns procedural descendants.
Overrides copy authored options only when runtime bindings are supplied.

Scene-local identity and Registry identity are different. Repeated instances
may have the same member keys and distinct runtime IDs. Pietious's authored
placement keys also identify its explicit progression rules; they are no longer
fixed Registry slots. A previous room's queued deletion cannot unregister the
incoming room's actors. Definition replacement affects the next instance only.

World publishes scene ownership before constructors can spawn descendants.
Individual disposal removes both dense and named membership, including cancelled
admissions. A long scene therefore retains no list of every projectile ever
created. `scene:dispose(callback, context)` closes admission and submits the
whole current group before `ondespawn` hooks execute. The existing World barrier
handles nested disposal and invokes completion after teardown. Replacement that
needs singleton Registry IDs, such as Nemesis gameplay, starts in that completion.
Pietious rooms use fresh runtime IDs and can construct incoming actors during
the current group; structural publication still belongs to World.

Changing Space does not transfer lifetime ownership. Inactive objects, modal
views and pending spawns are covered by their scene. Controllers release owned
subscenes in their existing teardown hooks. Whole-World clear removes membership
through the same object teardown, without a parallel scene registry.

## Cart policies

Pietious `session.lua` contains game data, not room/player objects. Room collision
and rendering derive from the authored map and the room's session record.

| Pietious data | Reset boundary |
| --- | --- |
| Inventory, health, loadout, collected inventory drops, destroyed rocks | New Game, plus explicit gameplay effects such as damage/healing |
| Retained enemy defeat and puzzle conditions | Existing `room.region_enter` rules |
| Uncollected consumable rock drops | End of a region visit |
| Current enemies, projectiles, explosions, pickups, collision/render members | Room scene exit |
| Travelling player, HUD and cross-room elevator routes | Gameplay scene exit |
| Camera/presentation pose and transient encounter state | Their controller/FSM lifetime |

This preserves the game's reset rules without preserving dead room actors.
Castle coordinates transitions and mounts progression; it is no longer the only
storage for that progression. `progression.new_state(program)` creates values
and once-only rule state independently. Mount/unmount controls subscriptions,
not the data lifetime. A state belongs to its compiled program; migrating state
to a different program/schema is not automatic and is not implemented here.

Fresh room construction also exposed a hidden dependency on an earlier director
event: the old room FSM started with invisible tiles and waited for `room`, which
ordinary room switches do not emit. Rooms now initialize their visible state on
admission, including while gameplay is paused. Modal flow still explicitly hides
and reveals them. The unused mirrored mode/encounter/effect FSM regions and their
`room_state.sync`/`room_state.changed` events are removed. The seal flash is an
authored backdrop member of the effects scene, controlled directly by the seal
timeline; room rendering no longer reads a second pair of mirrored effect tags.

Collected items use their authored or procedural persistent key. There is no
fallback from a missing item key to a runtime actor ID: a reconstructed actor's
runtime identity must not determine whether an item was collected.

Nemesis' gameplay scene now also owns dynamically spawned players, scroll-gated
enemies and their effects. Its existing `player_state` remains the player data
model. Embedded projectile components retain their existing owner/lifetime;
they are not converted into per-frame scene instances.

2025 supplies story node, accumulated statistics and inline dialogue progress
from `session.lua`. Entering the story controller's boot state no longer erases
that progress. Combat visuals and their controller share the combat scene. New
Game constructs fresh story state.

These in-memory models are not a disk save format or a general snapshot system.

## Studio follow-up

The existing Scene Editor continues editing canonical Lua definitions and its
Save/Reboot workflows use the new model. Runtime reads in conformance tests
follow explicit instance/member/session ownership; product authoring does not
scan arbitrary guest objects to manufacture a scene database.

Further Studio work must expose three distinct concepts: editing the definition,
inspecting a selected live instance, and inspecting game/session state. A live
inspector should show procedural children and scene-local identity alongside
runtime identity. Reset/reload commands must name their policy: recreate a scene
against current session state, or start a new game. Persistence keys need explicit
rename/removal behavior before Studio offers state-preserving source migration.
The compiler/linker private-symbol and debugger owners must provide any live
binding; no new hand-authored guest globals or machine fields are justified.

## Validation

Evidence for this follow-up is retained under
`.bmsx/authoring/scene-lifetimes/`. The important regression contracts are:

- `scene_collection_assert`: independent instances, pending/inactive/dynamic
  ownership, release of expired objects and cascading encounter teardown.
- `progression_session_assert`: remounting retains values and once-only rules,
  removes old subscriptions, and fresh state resets both.
- `pietious_session_lifetime_assert`: destroy all original actors, reconstruct
  actual player/castle/room prefabs against retained state, then prove New Game
  creates separate state. No copying from old actors or replaying pickup events.
- `pietious_scene_lifecycle_assert`: normal room departure/reentry constructs new
  rooms and enemies while keeping collected items and destroyed terrain.
- `pietious_scene_rooms_scanout_assert`: fresh rooms are visible immediately,
  including paused admission, and all room layouts remain unchanged.
- The three cart suites, fixed-pose scanouts, production CPU-profiler recordings
  and actual Studio editing/Save/Reboot/play workflows exercise the full paths.

Results against the untouched `fa2197519` baseline ROMs:

- Pietious **32/32**, Nemesis **28/28**, and 2025 **10/10** headless scenarios
  pass. The shared cartlib suite passes **5/6**: its pre-existing
  `input_clock_resume_assert` timing failure also reproduces against the baseline
  ROM. Both scene ownership and progression-state tests pass.
- All **103 fixed-pose captures** match the baseline RGBA pixels exactly. Three
  additional terminal captures for daemon appearance, death restart and water
  walking also match. Those three images are final captures, not intermediate
  samples of every animation phase; scenario assertions cover phase behavior.
- Actual Scene Editor pointer/keyboard editing, Save, Reboot, gameplay and source
  readback pass for all three carts on **software, WebGL2 and WebGPU**. Runtime
  inspection is read-only; the workflows do not inject source through the
  clipboard or text-model APIs.
- The **14 targeted unit tests** for FSM entry, scene source edits and editor
  viewport pass. The strict architecture audit reports **zero issues**. The
  broad tests TypeScript check retains exactly the same **70 diagnostics** as
  the baseline; it is not a clean typecheck.

The production CPU profiler records the same bounded input routes before and
after the change:

| Cart | Host frames | Retired instructions, before → after | Estimated base cycles, before → after | Cycle change |
| --- | ---: | ---: | ---: | ---: |
| Pietious | 1,500 | 13,193,801 → 13,165,428 | 14,688,648 → 14,648,177 | −0.28% |
| 2025 | 1,200 | 3,063,946 → 3,067,015 | 3,389,050 → 3,392,812 | +0.11% |
| Nemesis | 2,000 | 4,753,719 → 4,763,970 | 5,051,555 → 5,062,780 | +0.22% |

These routes include boot/guest compilation and their recorded gameplay; they
are not isolated steady-state frame measurements or SNES Mini hardware FPS.
Scene creation and ownership hooks have a small cost. Removing Pietious's
duplicated room FSM state reduces that route's total work. There is no new scene
polling or per-frame ownership scan.
