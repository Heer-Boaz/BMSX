# Architecture Review: pietious cart

Comprehensive audit of every module in `/src/carts/pietious/`.
Organized by severity: structural problems first, then per-file issues.

---

## 1. Systemic Problems

### 1A. "Service" as a glorified singleton bag — no actual service boundary

Every `*_service.lua` (castle, enemy, item, rock, elevator) follows the same
template:

```lua
local foo_service = {}
foo_service.__index = foo_service
function foo_service:ctor() ... end
function foo_service:tick() ... end

define_service({ def_id = 'foo', class = foo_service, fsms = { 'foo_service' }, ... })
```

Problems:
- **No encapsulation.** Every service reaches into other services via
  `service('x').something` and mutates objects directly. Castle service mutates
  `room.seal_dissolve_step`, enemy service calls `service('c').current_room`,
  rock service calls `service('c').current_room`, item service calls
  `service('c').current_room`. The "service" boundary is fictitious — everything
  is coupled to everything.
- **The FSM is vestigial.** `rock_service`, `item_service`, `castle_service`,
  `elevator_service` all have a single-state FSM (`active = {}` or
  `active = { tick = ... }`). These FSMs exist only to run a tick handler. The
  FSM primitive is wasted.
- **Services that are just tick loops.** `rock_service` and `elevator_service`
  exist purely to run a per-frame `tick()`. They don't manage state transitions,
  don't react to events, don't have multiple states.

### 1B. Tick-based polling where events should drive

Many modules poll every frame for changes that happen rarely:

| Module | What it polls | How often the thing actually changes |
|---|---|---|
| `rock_service.sync_room_rocks()` | Checks `synced_room_number` + `sync_dirty` flag | Only on room switch |
| `item_screen.tick()` | Polls player health/weapon level | Only on damage/pickup |
| `ui.tick()` | Polls player health/weapon level every frame | Only on damage/pickup |
| `castle_service.tick()` | Iterates `world_entrance_states` | Only during door-opening animation |
| `elevator_service.tick()` | Moves all elevators + checks player position | Legitimate per-frame (physics) |
| `draaideur.tick_active()` | Checks player overlap every frame | Legitimate per-frame (physics) |

The first three are pure waste. The UI should subscribe to `healing`/`damage`/
`pickupitem` events and animate on-demand, not poll `player.health` 60× per
second. Rock service should only sync on the `room.switched` event — and it
already does! The tick-based sync is redundant with the event-based sync.

### 1C. Fragmented object lifecycle management

Three separate "services" all independently do the same pattern:

```lua
-- Check if object still exists
local instance = object(id)
if instance == nil then
    -- Create new instance
    instance = inst('foo', { ... })
end
-- If it exists, sync properties
instance.x = def.x
-- Separately track which IDs are "active"
-- Separately deactivate stale ones
```

This pattern appears in:
- `enemy_service:sync_enemy_instance()` + `deactivate_stale_active_enemies()`
- `item_service:sync_item_instance()` + `deactivate_unused_items()`
- `rock_service:sync_rock_instance()` + `deactivate_unused_rocks()`
- `castle_service:sync_current_room_seal_instance()`
- `room_object:sync_lithograph_instances()`, `sync_shrine_instances()`,
  `sync_draaideur_instances()`, `sync_world_entrance_instances()`

Each re-invents the same lifecycle logic with slight variations. This should be
a **single generic room-object-sync mechanism** that all entity types share.

### 1D. Room as a god object

`room.lua` is 1031 lines and has three unrelated responsibilities:

1. **Static data**: tile grids, collision maps, stair geometry, solid lists
   (lines 1–480). Pure computation, no state.
2. **Dynamic state**: seal flags, dissolve steps, daemon_fight_active, runtime
   object tracking (lines 430–480, set by `apply_room_template`).
3. **Rendering + FSM**: `render_tiles()`, `render_room()`, room/fx/mode FSMs
   (lines 800–1031).

The room is a data container, a renderer, and a state machine simultaneously.
It stores 15+ boolean/numeric fields (`seal_fx_active`, `seal_sequence_active`,
`seal_broken`, `has_active_seal`, `daemon_fight_active`, `room_dissolve_step`,
`seal_dissolve_step`, `seal_sequence_frame`, `seal_dissolve_timer`, etc.) that
are mutated by `castle_service` from the outside.

### 1E. Cross-service mutation (violating ownership)

Services reach into each other's objects and mutate their state directly:

| Who mutates | What gets mutated | Where |
|---|---|---|
| `castle_service` | `room.has_active_seal`, `room.seal_sequence_active`, `room.room_dissolve_step`, `room.seal_dissolve_step`, `room.daemon_fight_active`, `room.seal_broken` | `begin_seal_dissolution()`, `set_seal_dissolve_intro_state()`, `finish_seal_dissolution()`, `activate_current_room_daemon_fight()` |
| `director` | `room.seal_flash_on` (via `director.seal_flash_on` read by `room.render_room()`) | `tick_seal_dissolution()` |
| `elevator_service` | `player.x`, `player.y`, `player.on_vertical_elevator` | `tick()` |
| `item_service` | `player.inventory_items`, `player.health`, `player.weapon_level` (via pickup handlers) | `pickup_*()` functions |

The engine has events specifically so objects can communicate without direct
mutation. Most of these should be events that the target object reacts to.

---

## 2. Per-Module Issues

### 2A. `rock_service.lua` — Should not exist

**This entire service is unnecessary.** Its responsibilities:

1. `sync_room_rocks()` — syncs rock instances when room changes. Already
   triggered by the `room.switched` event handler in `bind_events()`.
2. `on_rock_break_started()` — records a destroyed rock ID, tells item service.
3. `on_rock_destroyed()` — records destruction, deactivates instance.

Problem: **The FSM `tick` calls `sync_room_rocks()` every frame**, but the
event handler already calls it on `room.switched`. The tick is pure redundancy.

The rock-break lifecycle is handled by `rock.lua` itself (it has FSM states
`idle` → `breaking`, it calls `service('r'):on_rock_break_started()` and
`service('r'):on_rock_destroyed()`). The service is just a lookup table
(`rocks_by_id`, `destroyed_rock_ids`) with a redundant sync tick.

**Resolution:** Merge `destroyed_rock_ids` into rock progression state (like
enemies use `progression.matches`). Move `sync_room_rocks` into the room object
sync (unified lifecycle, see 1C). Remove the service entirely. The rock objects
themselves already have a proper FSM.

### 2B. `item_service.lua` — Rebuilds progression context every sync

`refresh_current_room_items()` does this every time it runs:

```lua
progression.unmount(self)
progression.mount(self, self.empty_progression_program)
for item_type, has_item in pairs(player.inventory_items) do
    if has_item then progression.set(self, item_type, true) end
end
```

This unmounts and remounts an empty progression program, then manually copies
all inventory flags into progression state, just to run `progression.matches()`
on item conditions. This is called on every `room.switched`, every
`enemy.defeated`, and every `room.condition_set` event.

The item service has the same pattern as enemy/rock services for
spawn/deactivate lifecycle (see 1C).

### 2C. `castle_service.lua` — God service

673 lines that owns:
- Room loading and switching
- Seal dissolution logic
- Daemon fight state
- World entrance door-opening state and tick animation
- Progression rules for enemies and room conditions
- Room geometry refresh coordination

This is at least 4 distinct responsibilities:
1. **Room switch orchestration** — `switch_room()`, `enter_world()`,
   `leave_world_to_castle()`, `halo_teleport_to_room_1()`,
   `commit_room_switch()`
2. **Seal/daemon state management** — `begin_seal_dissolution()`,
   `set_seal_dissolve_intro_state()`, `finish_seal_dissolution()`,
   `begin_daemon_appearance()`, `activate_current_room_daemon_fight()`,
   `resolve_death()` etc.
3. **World entrance animation** — `begin_open_world_entrance()`,
   `sync_world_entrance_visuals()`, the tick counter for opening states
4. **Progression program** — `build_progression_program()` constructs 200+ lines
   of rules

The seal/daemon logic should live in the director (which already owns the
sequence FSM). The world entrance animation should live on the `world_entrance`
object itself. The progression program could be a standalone data module.

### 2D. `enemy_service.lua` — Acceptable but lifecycle pattern duplicated

Enemy service follows the same spawn/track/deactivate pattern as item and rock
services. Its FSM (`active` ↔ `hidden_for_shrine`) is a legitimate use since it
actually has two states.

The `resolve_enemy_instance` function has a defensive `if instance ~= nil`
cache-repair pattern that searches for an object if the cached reference is nil.
This should not be necessary — if the service tracks enemy lifecycle correctly,
the cache should never be stale.

### 2E. `enemy_base.lua` — Mixin via function assignment

Uses a `extend(enemy_class, enemy_kind)` function that copies method references
one by one:

```lua
function enemy_base.extend(enemy_class, enemy_kind)
    enemy_class.onspawn = enemy_base.onspawn
    enemy_class.bind_overlap_events = enemy_base.bind_overlap_events
    enemy_class.take_weapon_hit = enemy_base.take_weapon_hit
    -- etc.
end
```

This is a manual mixin pattern. It works but is fragile — if a new method is
added to `enemy_base`, every enemy type needs `extend` to still be up-to-date. A
prototype-chain-based approach (where `enemy_base` is the metatable's
`__index`) would be more maintainable.

### 2F. `enemy_registry.lua` — Boilerplate registration

Every enemy module has separate `register_behaviour_tree()` and
`register_enemy_definition()` calls. The registry calls them all manually.
This is ~50 lines of pure boilerplate that could be automated with a table-
driven approach:

```lua
local enemy_types = { 'boekfoe', 'cloud', 'crossfoe', ... }
for _, name in ipairs(enemy_types) do
    local m = require('enemies/' .. name)
    m.register_behaviour_tree('enemy_' .. name)
    m.register_enemy_definition()
end
```

### 2G. `elevator_service.lua` — Legitimate per-frame, but unsafe mutation

The elevator tick directly mutates `player.x` and `player.y`:

```lua
if character_over then
    object('pietolon').x = object('pietolon').x + 2
end
```

This is position mutation from a service that doesn't own the player. It also
calls `player:try_room_switches_from_position()` — a player method —
from within the elevator service tick. This couples the elevator service to the
player's internal API.

The elevator should emit a `platform.move` event that the player listens for and
applies to itself. The player already has all the movement/collision logic
internally.

### 2H. `draaideur.lua` — Tick-based touch detection

`tick_active()` checks player overlap every frame. This is legitimate per-frame
physics (same category as elevator). However:

- Uses magic numbers for state: `self.state` is overloaded — positive = touch
  counter, negative = animation timer, zero = idle.
- `self.state2` encodes player-relative direction (0 or 1). This is a boolean
  that should be named `player_was_left` or similar.

### 2I. `ui.lua` — Polls player state every frame

`ui.tick()` reads `player.health` and `player.weapon_level` every frame and runs
a smoothing animation. This could be event-driven:

```lua
self.events:on({ event = 'healing', ... })
self.events:on({ event = 'damage', ... })
self.events:on({ event = 'pickupitem', ... })
```

The animation itself (smoothly moving from current to target) is legitimate
per-frame work. But the **polling** of the target value is not. The events
should set the target, and the tick should only run the animation interpolation
when `current ≠ target`.

The UI FSM has a single state `playing = {}` — it serves no purpose. The UI
object doesn't need an FSM.

### 2J. `player.lua` — 2866 lines, massive but structurally sound

The player FSM is the best-designed part of the cart:
- Tags are used extensively and idiomatically
- `tag_derivations` define computed groups cleanly
- State transitions use events through `on` handlers
- `process_input = player.sample_input` runs on all states consistently
- Per-frame tick methods (`tick_jump_motion`, `tick_walking_right`, etc.) are
  legitimate physics/movement work

**Problems:**
1. `run_checks` on 4 states (quiet, walking_right, walking_left, quiet_stairs)
   as discussed in the seal/daemon plan. These should be merged into
   `process_input`.
2. The tick method guards have redundant tag checks:
   ```lua
   function player:runcheck_quiet_controls()
       if not self:has_tag(state_tags.variant.quiet) then return end -- why?
   ```
   The FSM guarantees that `runcheck_quiet_controls` only runs in the `quiet`
   state. The tag check is a wasted defensive guard.
3. File is 2866 lines. Could be split: player_movement.lua (walking, jumping,
   falling, stairs), player_combat.lua (hit, damage, dying, invulnerability),
   player_world_transition.lua (entering/leaving worlds, shrines, doors).

### 2K. `player_abilities.lua` — Clean, good use of action_effects

This module correctly uses `action_effects.register_effect()` with
`can_trigger`/`handler` patterns, tag-based gating (`blocked_tags`), and the
input action effect program with proper bindings.

**Minor issue:** The halo effect's `can_trigger` checks
`service('c').current_room.daemon_fight_active` — a direct boolean on a room
object mutated by castle service. This should be a tag check on the director or
room object.

### 2L. `transition.lua` — Clean, good use of timelines and tags

Correctly uses:
- Timeline with events (`transition.mask.play`)
- Director tag query (`director_service:has_tag('d.bt')`) for render decisions

This is one of the best-written modules. It demonstrates the correct pattern
that the rest of the codebase should follow.

### 2M. `world_item.lua` — Clean

Simple overlap handler → pickup → self-disposal. Good use of FSM (`active` →
`picked`). Minor: the FSM could be removed since `picked` just calls
`mark_for_disposal()` — the overlap handler could do that directly. But the FSM
usage is clean and correct.

### 2N. `world_entrance.lua` — Passive, but animation owned by wrong module

The object itself is passive — `set_entrance_state()` just swaps a sprite.
The animation (cycling through `opening_1` → `opening_2` → `open`) is driven
by `castle_service.tick()` with a counter. This tick counter should live on the
`world_entrance` object itself, driven by a timeline.

### 2O. `daemon_cloud.lua` — Clean, good use of timelines

Correctly uses a timeline with `build_frame_sequence()` to animate through
sprites. Reacts to `timeline.frame` and `timeline.end` events to update sprite
and self-dispose. This is the correct pattern.

### 2P. `loot_drop.lua` — Clean, has minor structural issue

FSM has `active` → `picked` where `picked.entering_state = mark_for_disposal`.
Clean pattern. Minor: uses `worldobject.mark_for_disposal` as entering_state
which is an external dependency just for one method.

### 2Q. `pepernoot_projectile.lua` — Clean, has proper freeze FSM

Uses `seal_breaking` → `freeze` state with tag `v.fz`, which prevents movement
in the tick handler. Uses `pop_and_transition()` on `seal_flash_done` to return
to the `active` state. This is correct FSM usage.

### 2R. `item_screen.lua` — Tick-based input polling

Uses `action_triggered('right[jp]')` and `action_triggered('left[jp]')` inside
`tick_secondary_weapon_selection()`. This should use `input_event_handlers` on
the FSM state, but the item_screen FSM is defined separately from where the
tick runs (the tick is on the class, called by UI infrastructure, not the FSM).

The FSM has a single state `active = {}` — it serves no purpose.

### 2S. `seal.lua`, `lithograph.lua`, `shrine.lua` — Passive data shells

These objects are just sprite containers with no behavior. They have single-state
FSMs (`active = {}`). The FSMs serve no purpose. These could be raw sprite
instances without class definitions.

### 2T. `combat_overlap.lua` — Fine but duplicated usage

A simple classifier function. Clean. But every object that handles overlaps
re-implements the `on_overlap` → `classify_player_contact` → dispatch pattern.
This could be part of a base class or component.

### 2U. `cart.lua` — 200 lines of manual registration

`init()` calls 30+ `define_fsm()` functions and 30+ `register_definition()`
functions in a specific order. This is fragile and verbose. A table-driven or
auto-discovery approach would be better.

`new_game()` manually creates every persistent object with hardcoded positions
and IDs. `grant_starting_loadout()` is a debug function that gives the player
all items — this should be behind a debug flag, not always called.

---

## 3. Patterns That Work Well

For contrast, these patterns are correct and should be preserved/expanded:

1. **Player FSM tags + tag_derivations** — clean, expressive, well-organized
2. **Player `process_input`** — consistent across all states
3. **Timeline-driven animations** — `daemon_cloud`, `transition`, director
   banners
4. **Progression system in castle_service** — rules for enemy/room conditions
5. **Action effects in player_abilities** — tag-gated ability triggering
6. **Audio router (events.aem.yaml)** — declarative event→sound rules
7. **Event-driven subscriptions** — `room.switched`, `enemy.defeated`, etc.

---

## 4. Recommended Refactors (prioritized)

### Priority 1: Remove unnecessary services

| Service | Action |
|---|---|
| `rock_service` | Merge into room object sync; track destroyed IDs in progression |
| `item_service` | Keep as service but remove redundant progression mount/unmount cycle |

### Priority 2: Unify object lifecycle

Create a single `room_object_sync` mechanism that handles:
- Instance creation from room template definitions
- Activation/deactivation on room switch
- Stale instance cleanup

Shared by: enemies, rocks, items, lithographs, shrines, draaideuren, world
entrances, seals. All currently duplicate this pattern.

### Priority 3: Eliminate tick-based polling

| Module | Currently polls | Should use instead |
|---|---|---|
| `rock_service.sync_room_rocks` | Every frame via FSM tick | Already has `room.switched` event handler — remove the tick |
| `ui.tick` health/weapon target | Every frame | Events: `healing`, `damage`, `pickupitem` set the target |
| `castle_service.tick` entrance state | Every frame | Timeline on `world_entrance` object; or only tick during active animation |

### Priority 4: Stop cross-service mutation

- Castle service should emit events, not mutate room fields
- Elevator service should emit events, not mutate player position
- Item pickup handlers should emit events with values, not mutate player fields

### Priority 5: Split oversized files

| File | Lines | Suggested split |
|---|---|---|
| `player.lua` | 2866 | `player_movement.lua`, `player_combat.lua`, `player_transition.lua` |
| `castle_service.lua` | 673 | Seal logic → `director.lua`; entrance animation → `world_entrance.lua`; progression → `castle_progression.lua` |
| `room.lua` | 1031 | Tile/collision utilities → `room_geometry.lua`; rendering → `room_renderer.lua` |

### Priority 6: Remove pointless FSMs

These single-state FSMs serve no purpose and add noise:

- `rock_service` FSM (`active = { tick = ... }`) — use a tick method directly
- `item_service` FSM (`active = {}`) — does nothing
- `seal` FSM (`active = {}`) — does nothing
- `lithograph` FSM (`active = {}`) — does nothing
- `shrine` / `room_shrine` FSM (`active = {}`) — does nothing
- `world_entrance` FSM (`active = {}`) — does nothing (but should get one for
  entrance animation)
- `item_screen` FSM (`active = {}`) — does nothing
- `ui` FSM (`playing = {}`) — does nothing

### Priority 7: Fix magic numbers and naming

- `draaideur.state` overloads positive/negative/zero with 3 different meanings.
  Use an FSM or at minimum separate fields.
- `draaideur.state2` should be a named boolean.
- `boekfoe.bt_tick` uses `node.boek_state_ticks` and `node.boek_spawn_ticks` —
  blackboard keys that are undeclared and initialized inline with nil-checks.
  These should be initialized in `ctor()`.

---

## 5. Relationship to Seal/Daemon Plan

The seal/daemon refactor plan in `REFACTOR_PLAN_SEAL_SEQUENCE_AND_ENGINE.md`
addresses the most critical instance of several problems identified here:

- **Cross-service mutation** (castle_service mutating room fields)
- **Tick-as-timeline** (director's `tick_seal_dissolution`)
- **Boolean shadow FSM** (room's seal/daemon flags)
- **`run_checks` polling** (room_state concurrent FSM)

The architectural improvements recommended in this document are complementary:
they address the same classes of problems across the entire codebase, not just
the seal/daemon sequence.
