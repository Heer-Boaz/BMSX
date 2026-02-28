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

## 5. Engine Problems That Invite Cart-Level Anti-Patterns

The cart-level problems in sections 1–4 are not purely the cart author's fault.
The engine itself is structured in ways that invite, enable, or fail to prevent
these anti-patterns.

### 5A. `service.lua` is too thin — no ownership model

`service.lua` is ~110 lines. A service is just a registry-persistent object with
an FSM, tags, and an event port. That's it.

**What's missing:**
- No concept of **ownership** — there's no mechanism for a service to declare
  "I own these world objects" or "these fields are mine."
- No **interface contract** — `service('c')` returns the raw castle_service
  object. Any other service can call any method, read any field, mutate any
  property.
- No **boundary enforcement** — `registry.instance:get(id)` and `service(id)`
  return live references with full mutable access.

**What this causes in cart code:**
- Castle service reaches into room object and sets `room.seal_dissolve_step` ⟶
  **cross-mutation (1E)**.
- Elevator service reads `object('pietolon').x` and writes `object('pietolon').y`
  ⟶ **unauthorized field mutation (2G)**.
- Every service calls `service('c').current_room` because the engine gives no
  alternative ⟶ **tight coupling (1A)**.

**Engine fix:** Services should expose their intent through **events and tags**
rather than mutable properties. The engine could provide a `service:expose()`
or `service:command()` pattern — but more practically, the problem is that
services are just bags of methods with no convention for "read-only observation
vs. mutation." The engine needs to establish that events are the only cross-
boundary communication mechanism, and enforce it by convention since Lua can't
enforce it structurally.

### 5B. `worldobject.lua` — All fields public, no mutation signaling

Every field on a worldobject is directly accessible and mutable. There is no
distinction between "I own this field" and "someone else should set this."

```lua
-- Engine provides:
local room = object('room')
room.seal_dissolve_step = 5    -- ✓ No objection from the engine
room.daemon_fight_active = true -- ✓ No objection from the engine
```

The engine provides `worldobject.events:emit()` for communication, and
`worldobject.tags` for observable state. But there's nothing that nudges cart
authors toward using these instead of direct field mutation. The direct mutation
is always shorter, always works, and never fails.

**What this causes in cart code:**
- 15+ boolean/numeric fields on room are mutated by castle_service ⟶ **room as
  god object (1D)** and **cross-mutation (1E)**.
- `player.health`, `player.weapon_level`, `player.inventory_items` mutated from
  item_service ⟶ **ownership confusion**.

**Engine fix:** The engine should provide an `object:set_state(key, value)` or
equivalent that emits a state-change event when a property changes. This gives
observers (UI, room renderer, etc.) a reactive signal instead of requiring
per-frame polling. Alternatively: the engine should make tags + events the
canonical path for cross-object communication and document that direct field
access across object boundaries is an anti-pattern.

### 5C. FSM: Three per-frame hooks create ambiguity

The FSM tick pipeline runs four phases:
```
run_substate_machines → process_input → run_current_state (tick) → run_checks
```

This gives cart authors **three** places to put per-frame logic:

| Hook | Intended purpose | What cart authors use it for |
|---|---|---|
| `process_input` | Sample input, emit input events | Input + any polling the author didn't know where else to put |
| `tick` | Per-frame simulation (physics, animation) | **Everything**: counters, polling, orchestration, mini state machines |
| `run_checks` | Condition checks → transitions | Redundant input sampling, polling boolean fields |

The names don't help clarify intent:
- `tick` sounds like "put all per-frame work here" — it becomes a dumping ground
- `run_checks` sounds like "check conditions every frame" — a polling invitation
- `process_input` is the only one with a clear name, but it also runs every
  frame regardless of whether there's input

**What this causes in cart code:**
- Player has `process_input = player.sample_input` on every state AND
  `run_checks = { runcheck_quiet_controls }` on some states. These do
  overlapping work.
- Room FSM has `run_checks` that polls `next_room_state_transition()` every
  frame — the exact anti-pattern the engine's event system exists to avoid.

**Engine fix:** Remove `run_checks` (see REFACTOR_PLAN). Consider renaming
`tick` to `update` and documenting it as "per-frame physics/animation only —
not for polling or orchestration." The engine should actively discourage
counter-patterns in tick by providing timelines and events as alternatives.

### 5D. Every object gets an FSM — even when it doesn't need one

`worldobject.new()` creates a `statemachinecontroller` for every object:
```lua
self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, ... })
```

`service.new()` does the same:
```lua
self.sc = opts.sc or fsm.statemachinecontroller.new({ target = self, ... })
```

There's no "no FSM" option. Even if an object has no states, it gets an FSM
controller that gets ticked every frame by `statemachinesystem:update()`.

Cart authors see that the FSM exists and feel obligated to define at least one
state. This produces the pervasive `active = {}` non-FSM:

```lua
define_fsm('seal', { states = { active = {} } })
```

Eight objects in pietious have this pattern: seal, lithograph, shrine,
room_shrine, world_entrance, item_screen, ui, item_service.

**What this causes:**
- CPU waste: `statemachinesystem:update()` iterates these objects, calls
  `sc:tick()`, which traverses the FSM tree, for zero useful work.
- Conceptual noise: new authors see these FSMs and think "I must define states
  even if I have nothing to put in them."

**Engine fix:** Make the FSM controller **opt-in**. If an object definition
provides no `fsms` and no `definition` with states, don't create a controller.
`statemachinesystem:update()` should skip objects with `sc == nil`.

### 5E. `objectticksystem` calls `obj:tick()` on every active object every frame

```lua
function objectticksystem:update(dt_ms)
    for obj in world_instance:objects({ scope = "active" }) do
        if obj.tick_enabled then
            obj:tick(dt_ms)
        end
    end
```

`worldobject:tick()` is an empty virtual method. The ECS system calls it
unconditionally for every active, tick-enabled object. This is a blank per-frame
hook that invites cart authors to use it as a dumping ground.

Combined with the FSM's own `tick` hook, an object now has **two** separate
per-frame entry points: the FSM state's `tick` and the object's `tick()`.

**What this causes:**
- Services put polling logic in the FSM tick: `rock_service`, `castle_service`,
  `item_service`.
- Objects put rendering logic in `obj:tick()` (room, UI) alongside FSM ticks.
- It's unclear which tick to use, so authors use both, creating two execution
  paths for the same object.

**Engine fix:** An object should have **one** per-frame entry point. If an
object has an FSM, the FSM's `tick`/`update` should be the only per-frame hook.
The bare `worldobject:tick()` should be reserved for objects without FSMs. The
`objectticksystem` could skip objects that have an FSM controller (since
`statemachinesystem` already ticks those).

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

**Engine fix:** Provide a `RoomObjectPool` or equivalent primitive:
```lua
pool = engine.room_object_pool({
    type = 'rock',
    create = function(def) return inst('rock', def) end,
    sync = function(obj, def) obj.x = def.x; obj.y = def.y end,
})
pool:sync(definitions) -- creates missing, syncs existing, deactivates stale
```

### 5G. `statemachinesystem` ticks services from the registry — hidden execution

```lua
function statemachinesystem:update(dt_ms)
    -- Tick world objects
    for obj in world_instance:objects({ scope = "active" }) do
        obj.sc:tick(dt_ms)
    end
    -- ALSO tick registry services
    for _, entity in pairs(registry.instance:get_registered_entities()) do
        if entity.type_name == "service" and entity.active and entity.tick_enabled then
            entity.sc:tick(dt_ms)
            entity.timelines:tick_active(dt_ms)
        end
    end
end
```

Services are ticked inside the same ECS system as world objects, but they're not
world objects. They live in a separate `registry` table. This is invisible:
- You can't see services in `world_instance:objects()`.
- Services don't appear in any ECS query.
- But they run their FSMs in the same `moderesolution` phase.

**What this causes:**
- Services behave like hidden singletons with per-frame ticks. The ECS pipeline
  gives the illusion of structured execution order, but services are just
  loop-appended at the end.
- No way to control service tick order. All services tick in registry iteration
  order (undefined in Lua).

**Engine fix:** Either make services first-class in the ECS pipeline (with
explicit ordering) or move them out of `statemachinesystem` into their own
system. At minimum, provide a way to declare service tick ordering.

### 5H. Event emitter is untyped — no discovery, no schema

Events are untyped strings:
```lua
self.events:emit('room.switched', { room_number = n })
self.events:emit('seal_dissolution')
self.events:emit('enemy.defeated', { enemy_id = id })
```

There's no event catalog, no schema, no way to discover which events exist
or what payloads they carry. An event listener must exactly match the string:
```lua
self.events:on({ event = 'room.switched', handler = ... })
```

**What this causes:**
- Cart authors don't know which events exist, so they reach into services
  directly instead of subscribing to events ⟶ **cross-mutation (1E)**.
- No compile-time or runtime validation of event names or payloads.
- Events between services (like `seal_dissolution`) and events within an FSM
  (like `timeline.end.xyz`) use the same mechanism with no distinction.

**Engine fix:** This is inherent to Lua's dynamic nature. However, the engine
could provide:
- A convention for event name prefixes (service events vs. FSM events vs.
  object lifecycle events).
- A `define_event(name, schema)` registration function that at least documents
  which events exist and validates payloads in debug mode.

### 5I. `engine.define_prefab` / `engine.define_service` use method-copy, not prototypes

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

**Engine fix:** Use Lua metatables for prototype-based inheritance:
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

**Engine fix:** Either remove empty systems from the default pipeline or provide
a conditional registration mechanism:
```lua
{ ref = "tilecollision", when = function(w) return w:has_objects_with("tilecollisioncomponent") end }
```

The `when` predicate already exists in the pipeline builder but isn't used.

### 5K. No convention for "read-only observation" vs. "mutation"

The engine provides two communication mechanisms:
1. **Events** — asynchronous, decoupled, no return value
2. **Direct access** — `service('c').current_room.something` — synchronous,
   coupled, full mutation access

There's no middle ground. No "query" mechanism, no "get state without being
able to mutate it." Tags come closest (`has_tag()` is read-only) but tags can
only represent booleans.

**What this causes:**
- When a service needs to read numeric data from another service (e.g., room
  number, dissolve step, player health), the only option is direct field access.
- Direct access invites direct mutation.

**Engine fix:** Extend the tag system to support key-value tags (not just
boolean presence), or provide a `service:query(key)` that returns immutable
values. Alternatively: adopt the convention that **tags are for booleans,
events carry data, and direct access is never cross-boundary** — and enforce
this through code review and documentation.

---

## 6. Summary: How Engine Design Drives Cart Problems

| Cart Problem | Engine Root Cause |
|---|---|
| Cross-service mutation (1E) | No ownership model, all fields public (5A, 5B) |
| Tick-based polling (1B) | Three per-frame hooks, blank `tick()` virtual (5C, 5E) |
| Duplicated lifecycle (1C) | No room-object-sync primitive (5F) |
| Pointless FSMs (P6) | Every object gets FSM by default (5D) |
| God objects (1D) | No mutation signaling, no query primitives (5B, 5K) |
| Fragile mixins (2E) | Method-copy instead of prototypes (5I) |
| Hidden service execution (P3) | Services ticked from registry (5G) |

The engine provides excellent primitives (timelines, events, tags, FSMs,
progression, action effects) but doesn't guide cart authors toward using them
correctly. Direct field mutation is always easier than events. Tick polling is
always easier than event subscription. One-state FSMs are easier than deciding
"does this object need an FSM?"

The engine should make the right patterns the **easy** patterns and the wrong
patterns the **hard** patterns. Currently it's the opposite.

---

## 7. Relationship to Seal/Daemon Plan

The seal/daemon refactor plan in `REFACTOR_PLAN_SEAL_SEQUENCE_AND_ENGINE.md`
addresses the most critical instance of several problems identified here:

- **Cross-service mutation** (castle_service mutating room fields)
- **Tick-as-timeline** (director's `tick_seal_dissolution`)
- **Boolean shadow FSM** (room's seal/daemon flags)
- **`run_checks` polling** (room_state concurrent FSM)

The architectural improvements recommended in this document are complementary:
they address the same classes of problems across the entire codebase, not just
the seal/daemon sequence.
