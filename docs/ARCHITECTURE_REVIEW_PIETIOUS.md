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
- Per-frame `update` methods (`tick_jump_motion`, `tick_walking_right`, etc.) are
  legitimate physics/movement work

**Problems:**
1. `process_input = player.sample_input` runs on all states every frame,
   regardless of actual input. Input sampling should migrate to
   `input_event_handlers` on FSM states — event-driven, not per-frame.
2. `run_checks` on 4 states (quiet, walking_right, walking_left, quiet_stairs)
   polls boolean conditions every frame. These conditions should be
   event-driven transitions or handled inside `update` when justified.
3. Both `process_input` and `run_checks` are removed from the engine FSM
   pipeline (see 5C). All input handling moves to `input_event_handlers`;
   condition checks become event-driven transitions or inline `update` logic.
4. The tick method guards have redundant tag checks:
   ```lua
   function player:runcheck_quiet_controls()
       if not self:has_tag(state_tags.variant.quiet) then return end -- why?
   ```
   The FSM guarantees that `runcheck_quiet_controls` only runs in the `quiet`
   state. The tag check is a wasted defensive guard.
5. File is 2866 lines. Could be split: player_movement.lua (walking, jumping,
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
2. **Timeline-driven animations** — `daemon_cloud`, `transition`, director
   banners
3. **Progression system in castle_service** — rules for enemy/room conditions
4. **Action effects in player_abilities** — tag-gated ability triggering
5. **Audio router (events.aem.yaml)** — declarative event→sound rules
6. **Event-driven subscriptions** — `room.switched`, `enemy.defeated`, etc.

---

## 4. Recommended Refactors (prioritized)

### Priority 1: Remove all services

`service` as an engine concept is architecturally vague. A service is just a
registry-persistent object with an FSM, tags, and an event port — functionally
indistinguishable from a worldobject that's never despawned. The separate
`define_service` / `create_service` / `service()` API creates a false hierarchy
that leads to singletons with hidden per-frame ticks.

| Current service | Migration |
|---|---|
| `castle_service` | Split into `director` (worldobject, owns seal/daemon sequences), `castle_progression` (progression rules); room state stays on room |
| `rock_service` | Room object sync via events; progression tracks destroyed IDs |
| `item_service` | Merge pickup/inventory logic into player or item objects |
| `enemy_service` | Room object sync via events; enemy spawn definitions on room |
| `elevator_service` | Each elevator is a self-contained worldobject; no coordinator needed |

What "remove services" means concretely:
- Remove `define_service` and `create_service` from the engine API
- Remove `service()` global lookup — no more `service('c').current_room`
- Remove hidden service ticking from `statemachinesystem` (see 5G)
- Former services become regular worldobjects (persistent via registry if needed)

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
| `rock_service.sync_room_rocks` | Every frame via FSM tick | `room.switched` event — already has the handler, remove the tick |
| `ui.tick` health/weapon target | Every frame | Events: `player.health_changed`, `player.weapon_changed` |
| `castle_service.tick` entrance state | Every frame | Timeline on `world_entrance` object; or only update during active animation |

### Priority 4: Stop cross-object mutation

- Director should emit events, not mutate room fields
- Elevator objects should emit events, not mutate player position
- Item pickup handlers should emit events with values, not mutate player fields
- The convention: **tags + events for cross-object, direct fields only on
  your own object** (guideline, not enforcement — Lua has no private fields)

### Priority 5: Split oversized files

| File | Lines | Suggested split |
|---|---|---|
| `player.lua` | 2866 | `player_movement.lua`, `player_combat.lua`, `player_transition.lua` |
| `castle_service.lua` | 673 | Seal logic → `director.lua`; entrance animation → `world_entrance.lua`; progression → `castle_progression.lua` |
| `room.lua` | 1031 | Tile/collision utilities → `room_geometry.lua`; rendering → `room_renderer.lua` |

### Priority 6: Clean FSM / no-FSM binary split

The engine should enforce a clean binary:

| Has FSM? | Per-frame behavior | Example objects |
|---|---|---|
| Yes | FSM drives `update()` — this is the **only** per-frame hook | player, room, enemies, director |
| No | **No per-frame hook at all.** Object is purely passive: reacts only to events, timelines, components | seal, lithograph, shrine, world_entrance, item_screen, ui |

Objects that currently have a pointless `active = {}` FSM:
seal, lithograph, shrine, room_shrine, world_entrance, item_screen, ui,
item_service — all of these should lose their FSM and become passive objects.

An object without an FSM **must not** have `tick()` or `update()`. If it needs
periodic behavior, it either needs a real FSM or should use a timeline/event.
No middle ground — this eliminates the confusion about which tick runs when.

### Priority 7: Fix magic numbers and naming

- `draaideur.state` overloads positive/negative/zero with 3 different meanings.
  Use an FSM or at minimum separate fields.
- `draaideur.state2` should be a named boolean.
- `boekfoe.bt_tick` uses `node.boek_state_ticks` and `node.boek_spawn_ticks` —
  blackboard keys that are undeclared and initialized inline with nil-checks.
  These should be initialized in `ctor()`.

---

## 5. Engine Changes Required

The cart-level problems in sections 1–4 are not purely the cart author's fault.
The engine itself is structured in ways that invite, enable, or fail to prevent
these anti-patterns. The engine must be pruned harder — less engine is better.

### 5A. Remove `service` as an engine concept

`service.lua` is ~110 lines. A service is a registry-persistent object with an
FSM, tags, and an event port — functionally identical to a persistent worldobject.
The separate `service` type creates architectural ambiguity: what is a service
vs. a worldobject? When should you use which? The answer is unclear, and this
vagueness leads directly to the mess in pietious.

**What the separate service type causes in cart code:**
- Hidden execution: services are ticked from the registry, invisible to ECS
  queries (see 5G).
- Singleton coupling: `service('c')` returns a live mutable reference ⟶ every
  module grabs it and mutates fields directly.
- False boundaries: `service('c').current_room.seal_dissolve_step` — the
  "service boundary" is fictitious.

**Engine change:** Remove `define_service`, `create_service`, and `service()`
from the engine API entirely. Former services become regular worldobjects:
- Persistent objects use `registry.persistent = true` (already supported).
- Cross-object lookup uses `object(id)`, same as everything else.
- No special ticking path — FSM objects get ticked by `statemachinesystem`,
  non-FSM objects are passive.

### 5B. Cross-object communication: tags + events as convention (no enforcement)

Every field on a worldobject is directly accessible and mutable. Lua has no
private properties. This is fine — **we don't want getters, setters, or
`set_state()` enforcement**. The engine is a fantasy console; structural
enforcement is overkill.

Instead, establish a **guideline convention**:

| Communication | Mechanism | Example |
|---|---|---|
| Read another object's state | `has_tag()` for booleans, events for data | `object('room'):has_tag('seal_active')` |
| Signal a state change | `events:emit()` | `self.events:emit('health_changed', { hp = self.health })` |
| Mutate your own fields | Direct field access | `self.health = self.health - dmg` |
| Mutate another object's fields | **Don't.** Emit an event; the owner mutates itself. | `object('room').events:emit('request_dissolve', { step = 5 })` |

This is a guideline, not a locked-down API. Cart authors can break it
intentionally when warranted (e.g., physics moving an object's position). But
the convention makes it clear what the expected pattern is, and code review
catches violations.

The engine's role: make tags and events **convenient enough** that direct
cross-object mutation feels like extra work, not less. `define_event` (see
5H) is part of achieving this.

### 5C. FSM: Remove both `process_input` and `run_checks`

The FSM tick pipeline currently runs four phases:
```
run_substate_machines → process_input → run_current_state (tick) → run_checks
```

This gives cart authors **three** per-frame hooks. Two of them must go:

**Remove `process_input`:** Input is already handled by `input_event_handlers`
which are event-driven (fired by the input component on actual input). The
per-frame `process_input` hook runs every frame regardless of whether there's
input. Players sample input in `process_input` and also in `input_event_handlers`
— redundant dual paths.

**Remove `run_checks`:** This is explicitly a "poll conditions every frame"
hook. It invites the exact anti-pattern that events exist to eliminate. Room FSM
uses `run_checks` to poll `next_room_state_transition()` every frame — this
should be an event-driven transition.

**New pipeline:**
```
run_substate_machines → run_current_state (update)
```

Two phases. The state's `update` function is the **only** per-frame hook. Input
arrives via `input_event_handlers`. State transitions are triggered by events,
tag changes, or explicit `transition()` calls inside `update` when justified.

Rename `tick` to `update` to clarify that it's for per-frame simulation (physics,
animation), not a dumping ground for arbitrary polling.

### 5D. Make FSM opt-in

`worldobject.new()` currently creates a `statemachinecontroller` for every
object, even when no states are defined. This produces the pervasive
`active = {}` non-FSM pattern across eight objects in pietious.

**Engine change:** If an object definition provides no `fsms` and no states,
don't create a `statemachinecontroller`. `statemachinesystem:update()` skips
objects with `sc == nil`.

### 5E. Clean binary: FSM objects get `update`, non-FSM objects are passive

Currently an object has **two** per-frame entry points: the FSM state's `tick`
and the object-level `worldobject:tick()`. This creates confusion about which
one to use — and authors use both.

**Engine change — binary split:**

| Object type | Per-frame hook | Ticked by |
|---|---|---|
| Has FSM (`sc ~= nil`) | FSM state `update` only | `statemachinesystem` |
| No FSM (`sc == nil`) | **None.** No `tick()`, no `update()`. | Nothing — object is passive |

**Remove `objectticksystem`** entirely. Objects without an FSM are passive:
they react to events, timelines, and component updates. They don't get a
per-frame callback.

If an object needs periodic behavior, it **must** have an FSM. This is the clean
binary: FSM = active per-frame participation, no FSM = event-driven only. No
gray area, no confusion about which tick runs when.

Objects that currently use `obj:tick()` for rendering (room, UI) should either:
- Get a proper FSM with an `update` state that handles rendering, or
- Move rendering to a component that gets updated by its own ECS system.

### 5F. No "room object sync" primitive — every service re-invents lifecycle

The engine provides `world.spawn()` and `world.despawn()`. That's it.

There's no concept of:
- "These objects belong to the current room and should be activated/deactivated
  on room switch"
- "Sync instances from a room template definition"
- "Deactivate stale instances that no longer match the template"

**What this causes:**
- Five separate services all implement the same create/sync/deactivate lifecycle
  ⟶ **duplicated lifecycle management (1C)**.
- Each implementation has slight variations in cleanup, staleness detection, and
  error handling.

**Engine change:** Provide a `room_object_pool` primitive:
```lua
pool = room_object_pool({
    type = 'rock',
    create = function(def) return inst('rock', def) end,
    sync = function(obj, def) obj.x = def.x; obj.y = def.y end,
})
pool:sync(definitions) -- creates missing, syncs existing, deactivates stale
```

### 5G. Remove hidden service ticking from `statemachinesystem`

```lua
-- CURRENT: services ticked inside statemachinesystem alongside world objects
for _, entity in pairs(registry.instance:get_registered_entities()) do
    if entity.type_name == "service" and entity.active and entity.tick_enabled then
        entity.sc:tick(dt_ms)
        entity.timelines:tick_active(dt_ms)
    end
end
```

Services are ticked inside the same ECS system as world objects, but they live
in a separate `registry` table. This is invisible: services don't appear in
`world_instance:objects()`, don't appear in ECS queries, but run their FSMs in
the same `moderesolution` phase.

**Engine change:** With services removed as a concept (5A), this code disappears.
Former services are now regular worldobjects — they appear in
`world_instance:objects()` and get ticked by `statemachinesystem` like any other
FSM object. No hidden execution path.

### 5H. `define_event` — lean catalog, no runtime validation

Events are untyped strings with no discovery mechanism. Cart authors don't know
which events exist, so they reach into objects directly instead of subscribing.

**Engine change:** Add `define_event(name)` as a **catalog registration** only:

```lua
-- In cart or engine setup:
define_event('room.switched')
define_event('enemy.defeated')
define_event('player.health_changed')
define_event('seal_dissolution')
```

What `define_event` does:
- Registers the event name in a global catalog (a simple table)
- In debug mode: `events:emit()` warns if an event name is not in the catalog
  (catches typos)
- **No schema, no payload validation, no runtime enforcement in release mode**

What `define_event` does NOT do:
- No schema definitions
- No payload type checking
- No runtime validation in release builds
- No mandatory registration — unregistered events still work, they just produce
  a debug warning

**Auto-registration of standard events:** The engine already knows about several
event patterns that are always emitted. These should be auto-registered by the
subsystems that emit them:

| Subsystem | Auto-registered events |
|---|---|
| Timeline component | `timeline.frame.<id>`, `timeline.end.<id>` for each timeline added via `add_timeline()` |
| Action effects | `evt.ability.start.<id>`, `evt.ability.end.<id>` for each registered ability |
| FSM | `fsm.enter.<state>`, `fsm.exit.<state>` for each defined state |
| Object lifecycle | `object.spawned`, `object.despawned`, `object.activated`, `object.deactivated` |

This gives discoverability without boilerplate. Cart authors can look up the
catalog to see what events are available. The engine handles the standard events
automatically; cart authors only need `define_event` for their own custom events.

### 5I. `engine.define_prefab` uses method-copy, not prototypes

`apply_class_addons()` copies all methods from the class table onto each
instance:
```lua
local function apply_class_addons(instance, class_table)
    for k, v in pairs(class_table) do
        if not excluded_class_keys[k] then
            instance[k] = v
        end
    end
end
```

This means every rock instance, every enemy instance, every item instance gets
its own copy of every method. Combined with `enemy_base.extend()` which also
copies methods manually, this creates a flat, non-inheriting, fragile system.

**What this causes:**
- `enemy_base.extend()` must manually list every shared method ⟶ **fragile
  mixin pattern (2E)**.
- No prototype chain means there's no "base behavior" that subclasses inherit
  automatically.
- Adding a new method to `enemy_base` requires updating `extend()` — and if
  forgotten, enemies silently miss the new method.

**Engine change:** Use Lua metatables for prototype-based inheritance:
```lua
local function apply_class_prototype(instance, class_table)
    local mt = getmetatable(instance) or {}
    local prev_index = mt.__index
    mt.__index = function(self, key)
        local v = class_table[key]
        if v ~= nil then return v end
        if type(prev_index) == "function" then return prev_index(self, key) end
        if type(prev_index) == "table" then return prev_index[key] end
    end
    setmetatable(instance, mt)
end
```

This gives automatic inheritance without method copying. `enemy_base` would be
in the prototype chain, and new methods would automatically be available to all
enemy types.

### 5J. ECS pipeline runs empty systems every frame

The default pipeline includes 23 systems. Many are stubs:
```lua
function tilecollisionsystem:update() end
function physicssyncbeforestepsystem:update() end
function physicsworldstepsystem:update() end
function physicspostsystem:update() end
function physicscollisioneventsystem:update() end
function physicssyncafterworldcollisionsystem:update() end
```

Six empty systems are called every frame. On the target hardware (iPhone
10/11/12), this is wasteful iteration overhead.

**Engine change:** Either remove empty systems from the default pipeline or
activate the `when` predicate that already exists in the pipeline builder:
```lua
{ ref = "tilecollision", when = function(w) return w:has_objects_with("tilecollisioncomponent") end }
```

### 5K. Tag system: concrete guidance for cross-object observation

Tags are boolean-only and that's correct — they must stay lean. No key-value
extension, no tag payloads. Tags are for **observable boolean state** that
other objects can read via `has_tag()`.

**Convention for tag naming:**

Use a short domain prefix to prevent collisions and clarify ownership:

| Prefix | Domain | Examples |
|---|---|---|
| `p.` | Player | `p.jump`, `p.attack`, `p.invuln`, `p.grounded` |
| `d.` | Director | `d.seal`, `d.daemon`, `d.boss_intro`, `d.seal_dissolve` |
| `r.` | Room | `r.dark`, `r.underwater`, `r.seal_active` |
| `e.` | Enemy | `e.stunned`, `e.aggro`, `e.dying` |

**What tags replace:**

| Current anti-pattern | Tag replacement |
|---|---|
| `room.seal_dissolve_step > 0` (numeric field polled by castle_service) | `object('room'):has_tag('r.seal_dissolve')` — director checks tag, not numeric field |
| `room.daemon_fight_active` (boolean field set by castle_service) | `object('room'):has_tag('r.daemon_fight')` — set by room itself via event |
| `player.is_in_combat` (boolean checked by multiple modules) | `object('pietolon'):has_tag('p.combat')` — tag_derivation from FSM states |

**When NOT to use tags:**

Tags are booleans. Numeric state (health, position, counters) stays as direct
fields on the **owning** object. Other objects read numeric state by subscribing
to events that carry the value:

```lua
-- Owner emits event when numeric state changes:
self.health = self.health - dmg
self.events:emit('player.health_changed', { hp = self.health })

-- Observer subscribes instead of polling:
object('pietolon').events:on({
    event = 'player.health_changed',
    handler = function(data) self.hp_display = data.hp end,
})
```

**Tag derivations for automatic tag management:**

The FSM already supports `tag_derivations` — use them aggressively:
```lua
tag_derivations = {
    ['p.combat'] = { 'attack_a', 'attack_b', 'special_attack' },
    ['p.airborne'] = { 'jump_rise', 'jump_fall', 'wall_jump' },
    ['p.invuln'] = { 'dash', 'hit_stun', 'respawn_invuln' },
}
```

This keeps tags synchronized with FSM state automatically. No manual
`add_tag` / `remove_tag` calls needed for state-derived booleans.

---

## 6. Summary: How Engine Design Drives Cart Problems

| Cart Problem | Engine Root Cause | Fix |
|---|---|---|
| Cross-object mutation (1E) | No communication convention (5B) | Guideline: tags + events for cross-object, direct fields on own object |
| Tick-based polling (1B) | Three per-frame hooks invite polling (5C) | Remove `process_input` + `run_checks`. One `update` hook only |
| Duplicated lifecycle (1C) | No room-object-sync primitive (5F) | `room_object_pool` |
| Pointless FSMs (P6) | Every object gets FSM by default (5D) | FSM opt-in |
| Two tick entry points | `obj:tick()` + FSM `tick` coexist (5E) | Clean binary: FSM → `update`, no FSM → passive |
| Hidden service execution | Services ticked from registry (5G) | Remove `service` concept (5A) |
| Event discoverability | Untyped string events (5H) | `define_event` catalog + auto-registration |
| Fragile mixins (2E) | Method-copy instead of prototypes (5I) | Metatable-based prototype chain |
| Wasted CPU on stubs (5J) | 6 empty ECS systems run every frame | Use `when` predicate or remove stubs |

The engine provides excellent primitives (timelines, events, tags, FSMs,
progression, action effects) but doesn't guide cart authors toward using them
correctly. The fix is not more enforcement — it's **less engine** (remove
services, remove redundant tick hooks, remove `objectticksystem`) combined with
**lean conventions** (tag naming, event catalogs, FSM/no-FSM binary).

---

## 7. Relationship to Seal/Daemon Plan

The seal/daemon refactor plan in `REFACTOR_PLAN_SEAL_SEQUENCE_AND_ENGINE.md`
addresses the most critical instance of several problems identified here:

- **Cross-object mutation** (castle_service mutating room fields) ⟶ Fixed by
  events + tag convention (5B) and service removal (5A)
- **Tick-as-timeline** (director's `tick_seal_dissolution`) ⟶ Fixed by removing
  `run_checks` + `process_input` (5C), clean binary (5E)
- **Boolean shadow FSM** (room's seal/daemon flags) ⟶ Fixed by tag convention
  with `r.seal_active`, `r.daemon_fight` tags (5K)
- **`run_checks` polling** (room_state concurrent FSM) ⟶ Fixed by removing
  `run_checks` entirely (5C)

The seal/daemon plan should be updated to reflect the stricter engine changes
in this document:
- `service('c')` calls become `object('director')` calls (service removal)
- `process_input` on player states migrates to `input_event_handlers` only
- Director becomes a worldobject, not a service
