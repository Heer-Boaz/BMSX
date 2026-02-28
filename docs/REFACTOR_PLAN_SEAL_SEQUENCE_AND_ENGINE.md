# Refactor Plan: Seal/Daemon Sequence + Engine Primitives

## Context

The seal dissolution → daemon appearance sequence is implemented using a mix of
hand-rolled tick-counters, direct method calls, and boolean flags spread across
`director.lua`, `castle_service.lua`, and `room.lua`. This is a literal
translation of the C++ `fighting_demon` counter from `ingamecycle.cpp` /
`demons.cpp`, rather than an idiomatic use of the engine's own primitives
(timelines, events, FSM tags, markers).

This plan has two parts:
1. **Engine changes** — remove/rename primitives that invite wrong patterns.
2. **Cart refactor** — rewrite the seal/daemon sequence using correct primitives.

---

## Part 1: Engine Changes (BIOS)

### 1A. Remove `run_checks` from the FSM

**File:** `src/bmsx/res/bios/fsm.lua`

**Why:** `run_checks` is a per-tick polling escape hatch in an otherwise
event-driven FSM. Every current usage falls into one of two categories:

| Usage location | What it does | Correct primitive |
|---|---|---|
| `room.lua` room_state | Polls `next_room_state_transition()` every tick | Should be an event emitted when room state actually changes |
| `player.lua` quiet/walking/stairs | Calls `runcheck_*_controls()` which samples input and emits events | Should be `process_input` (which already exists and runs in the same tick) |

Both categories are misuse: they either poll for state changes that could be
events, or duplicate the role of `process_input`.

**Action:**

1. Remove `run_checks` from `statedefinition.new()` (line ~209).
2. Remove `validate_run_checks()` function.
3. Remove `state:run_checks_for_current_state()` function.
4. Remove the `self:run_checks_for_current_state()` call from `state:tick()`.
5. Update the tick pipeline to be:
   ```
   run_substate_machines → process_input → run_current_state (tick)
   ```

**Migration path for cart code:**

- **`room.lua` room_state `run_checks`**: Replace with event-driven transitions.
  `castle_service` already knows when room state changes (it sets
  `has_active_seal`, `daemon_fight_active`, etc.). After setting these, it should
  emit a `room_state.changed` event. The room FSM `room_state` concurrent machine
  listens for this event and transitions accordingly. Remove the `run_checks` and
  the `next_room_state_transition()` polling pattern.

- **`player.lua` `runcheck_*` functions**: Merge into the existing
  `process_input = player.sample_input` handler. The `sample_input` function
  already runs every tick and has access to the same input state. The
  `runcheck_*` functions just sample held/pressed booleans and emit events — this
  is exactly what `process_input` is for. Combine them into a single
  `process_input` per state that both samples raw input AND evaluates
  state-specific control responses.

### 1B. Rename `tick` on FSM states to `update`

**File:** `src/bmsx/res/bios/fsm.lua`

**Why:** The name `tick` on an FSM state suggests "do per-frame work here",
which invites counter-patterns and mini-orchestrators. `update` is more neutral
and aligns with the ECS `update()` convention. This is a cosmetic change that
reduces the temptation to write `self.counter = self.counter + 1` inside it.

**Action:**

1. In `statedefinition.new()`, read `def.update` instead of `def.tick` (keep
   `def.tick` as a deprecated alias during migration).
2. In `state:run_current_state()`, call `self.definition.update` (falling back
   to `self.definition.tick` during migration).
3. After all cart code is migrated, remove the tick alias.

**Note:** This is lower priority than the other changes. It can be done last.

### 1C. Do NOT add tag-based transition guards as a declarative feature

**Why not:** Tags are already queryable via `has_tag()` inside any `go` function.
A declarative `when_tags = { 'foo', '!bar' }` on transitions would duplicate
what `go` functions already do, and add a second way to express the same thing.
The `go`-function approach is already the canonical pattern and Codex follows it.
Adding a declarative alternative would reintroduce the "which pattern do I use?"
confusion.

**Instead:** Document that `go` functions are the canonical way to express
conditional transitions, including tag-checks:

```lua
on = {
    ['some_event'] = {
        go = function(self)
            if self:has_tag('ready') then
                return '/next_state'
            end
        end,
    },
},
```

---

## Part 2: Cart Refactor — Seal/Daemon Sequence

### 2A. Design: Single-owner phased timeline

The original C++ `fighting_demon` counter runs 1→160 in a flat loop.
The Lua equivalent should be a **single timeline with markers** on the director,
not a tick-counter + events + boolean flags.

**Phase breakdown** (from C++ `demon_intro()`):

| Phase | C++ frames | What happens |
|---|---|---|
| Flash | 1–31 | White checkerboard overlay, every 2 frames |
| Room dissolve | 32–63 | Room tiles dissolve in spiral pattern (16 steps, 1 step per 2 frames) |
| Seal dissolve | 64–95 | Seal sprite dissolves in same spiral pattern |
| Smoke / clouds | 97–159 | Spawn smoke clouds every 8 frames |
| Daemon load | 160 | Load daemon object, transition to fight |

**Timeline definition:**

```lua
local seal_timeline_id = 'director.seal'

-- In the director FSM seal_dissolution state:
timelines = {
    [seal_timeline_id] = {
        create = function()
            return timeline.new({
                id = seal_timeline_id,
                frames = timeline.range(160),
                playback_mode = 'once',
                markers = {
                    { frame = 0,  event = 'seal.phase', payload = { phase = 'flash' } },
                    { frame = 32, event = 'seal.phase', payload = { phase = 'room_dissolve' } },
                    { frame = 64, event = 'seal.phase', payload = { phase = 'seal_dissolve' } },
                    { frame = 96, event = 'seal.phase', payload = { phase = 'smoke' } },
                },
                windows = {
                    { name = 'flash', tag = 'd.seal.flash',
                      start = { frame = 0 }, ['end'] = { frame = 31 } },
                    { name = 'dissolve', tag = 'd.seal.dissolve',
                      start = { frame = 32 }, ['end'] = { frame = 95 } },
                    { name = 'smoke', tag = 'd.seal.smoke',
                      start = { frame = 97 }, ['end'] = { frame = 159 } },
                },
            })
        end,
        autoplay = true,
        stop_on_exit = true,
        play_options = { rewind = true, snap_to_start = true },
    },
},
```

### 2B. Director FSM states (simplified)

```lua
seal_dissolution = {
    timelines = { ... }, -- as above
    tags = { 'd.seal' },
    entering_state = function(self)
        self.events:emit('seal_breaking')
        self.events:emit('seal_dissolution')
    end,
    on = {
        ['timeline.end.' .. seal_timeline_id] = '/daemon_appearance',
    },
},
daemon_appearance = {
    timelines = {
        [daemon_timeline_id] = {
            create = function()
                return timeline.new({
                    id = daemon_timeline_id,
                    frames = timeline.range(125),
                    playback_mode = 'once',
                    windows = {
                        { name = 'clouds', tag = 'd.daemon.clouds',
                          start = { frame = 0 }, ['end'] = { frame = 124 } },
                    },
                })
            end,
            autoplay = true,
            stop_on_exit = true,
            play_options = { rewind = true, snap_to_start = true },
        },
    },
    entering_state = function(self)
        if self.daemon_appearance_after_death then
            self.daemon_appearance_after_death = false
            self.events:emit('daemon_appearance', { after_death = true })
        else
            self.events:emit('daemon_appearance')
        end
    end,
    on = {
        ['timeline.end.' .. daemon_timeline_id] = function(self)
            self:despawn_daemon_clouds()
            return '/room'
        end,
    },
},
```

**What is removed:**
- `tick_seal_dissolution()` — replaced by timeline auto-advance
- `tick_daemon_appearance()` — replaced by timeline auto-advance
- `demon_intro_state` field — replaced by timeline head position
- `seal_flash_on` field — replaced by tag `d.seal.flash`

### 2C. Castle service: react to events, not method calls

**Current (broken):**
- Director emits `seal.step` every tick with `intro_state`
- Castle service catches it, calls `set_seal_dissolve_intro_state()`
- This computes `room_dissolve_step` and `seal_dissolve_step` via `math.modf`

**New:**
- Castle service listens for `seal.phase` events (emitted by timeline markers)
- On `{ phase = 'room_dissolve' }`: begins room dissolve via
  `timeline.frame` events (or queries the director's timeline position)
- On `{ phase = 'seal_dissolve' }`: begins seal sprite dissolve

**Simpler alternative:** Castle service listens for `timeline.frame` events from
the seal timeline. The frame value (0–159) directly maps to dissolve steps:

```lua
self.events:on({
    event = 'timeline.frame.' .. seal_timeline_id,
    emitter = 'd',
    subscriber = self,
    handler = function(event)
        local frame = event.value
        self:update_seal_visual_state(frame)
    end,
})
```

Where `update_seal_visual_state(frame)` computes dissolve steps from the frame
number (same math as current `set_seal_dissolve_intro_state`, just driven by
timeline frames instead of a manual counter).

**What is removed:**
- `begin_seal_dissolution()` as a direct method call — the event `seal_dissolution` triggers the director FSM, which starts the timeline, which emits frame events
- `set_seal_dissolve_intro_state()` — replaced by `update_seal_visual_state()` driven by timeline frames
- `seal_sequence_active` boolean — replaced by director tag `d.seal`
- `seal_broken` boolean — replaced by progression state (progression already tracks world boss state)

### 2D. Room: react to tags, not booleans

**Current:**
- `room.seal_fx_active` is a boolean set by FSM entering_state
- `render_room()` reads `director_service.seal_flash_on`
- `render_tiles()` reads `self.room_dissolve_step`

**New:**
- `render_room()` queries `director_service:has_tag('d.seal.flash')` instead of
  `director_service.seal_flash_on`
- The room FSM `fx_state` machine reacts to the same events it already does
  (`seal_dissolution`, `room`, etc.), but the `seal_fx` state sets a tag on the
  room object instead of a boolean:

```lua
seal_fx = {
    tags = { 'r.seal_fx' },
},
```

- `render_room()` queries `self:has_tag('r.seal_fx')` instead of
  `self.seal_fx_active`

**Alternatively:** Remove `fx_state` entirely and have `render_room()` query the
director's tags directly. The room doesn't need its own mirrored state.

### 2E. Room FSM `room_state`: remove polling, use events

**Current:**
Every `room_state` substate polls `next_room_state_transition()` via
`run_checks` every tick.

**New:**
When `castle_service` changes room properties (`has_active_seal`,
`daemon_fight_active`), it emits `room_state.changed`. The room FSM
`room_state` machine handles this event:

```lua
room_state = {
    is_concurrent = true,
    initial = 'unknown',
    on = {
        ['room_state.sync'] = '/room_state/unknown',
        ['room_state.changed'] = {
            go = function(self)
                return self:next_room_state_transition(
                    room_runtime_state_name(self)
                )
            end,
        },
    },
    states = {
        unknown = {},
        castle = {},
        world = {},
        seal = {},
        daemon_fight = {},
    },
},
```

No `run_checks` needed. The transition is evaluated only when state actually
changes.

### 2F. Cloud spawning: timeline-driven, not tick-counter

**Current:** `tick_daemon_appearance()` checks `demon_intro_state % 8 == 0` and
calls `spawn_daemon_cloud()`.

**New:** The daemon timeline has markers every 8 frames:

```lua
markers = (function()
    local m = {}
    for f = 0, 124, 8 do
        m[#m + 1] = { frame = f, event = 'daemon.cloud.spawn' }
    end
    return m
end)(),
```

The director or castle_service listens for `daemon.cloud.spawn` and calls
`spawn_daemon_cloud()`. No tick handler, no modulo check.

---

## Part 3: Migration Order

Execute in this order to keep the game functional at each step:

1. **Engine: remove `run_checks`** (Part 1A)
   - First migrate all cart `run_checks` usages to events/`process_input`
   - Then remove from engine

2. **Cart: rewrite room_state to event-driven** (Part 2E)
   - Add `room_state.changed` event emission in castle_service
   - Convert room_state FSM to event-driven transitions
   - Remove `run_checks` from room.lua

3. **Cart: merge player `runcheck_*` into `process_input`** (Part 2E context)
   - Move logic from `runcheck_quiet_controls()` etc. into the existing
     `sample_input` flow
   - Remove `run_checks` from player.lua

4. **Engine: remove `run_checks` from fsm.lua** (Part 1A finalize)
   - Now safe: no cart code uses it

5. **Cart: rewrite seal/daemon with phased timelines** (Parts 2A–2D, 2F)
   - Define seal timeline with markers/windows on director
   - Define daemon timeline with markers on director
   - Remove `tick_seal_dissolution()`, `tick_daemon_appearance()`
   - Remove `demon_intro_state`, `seal_flash_on`
   - Update castle_service to react to timeline frame events
   - Update room rendering to use director tags
   - Remove boolean flags from room

6. **Engine: rename `tick` to `update`** (Part 1B, optional, last)

---

## Anti-patterns to avoid during implementation

When implementing this refactor, do NOT:

- **Create new boolean fields** that mirror FSM state. Use tags instead.
- **Use `tick` handlers for sequenced work.** If work has a known duration, use a
  timeline.
- **Call service methods directly from FSM handlers.** Emit an event and let the
  service react.
- **Poll for state changes.** Emit an event at the point of change.
- **Create manual counters** (e.g. `self.counter = self.counter + 1`). Use
  timeline frame progression.
- **Duplicate the C++ structure.** The C++ code is a flat game loop with a global
  counter. The Lua engine has timelines, events, FSMs, and tags. Use them.
