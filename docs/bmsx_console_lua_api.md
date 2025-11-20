# Bmsx Console Lua API Notes

Lua carts get every `BmsxConsoleApi` method as a global (in addition to the injected `api` object). This page spells out the shapes that are only visible through runtime usage, so Codex (and humans) can rely on them without guessing.

## Input / Action State

- `game:get_action_state(playerIndex, actionName)` and the `btn*` helpers return an **ActionState** table:

```lua
-- ActionState fields
-- pressed/justpressed/justreleased/waspressed/wasreleased/consumed/stickyConsumed
-- guardedjustpressed true only when the press isn't consumed or gated
-- repeatpressed (auto-repeat) with repeatcount
-- presstime/timestamp/pressedAtMs/releasedAtMs/pressId
-- analog: value, value2d { x, y }
```

Use `guardedjustpressed` for single-fire input (as in `console_a` and `console_b`), `pressed` for held input, and `value/value2d` for analog pointers or sticks.

## Events and Timelines

- Global emitters: `emit(name, emitter?, payload?)` for general events and `emit_gameplay` for gameplay-scoped events (records to the gameplay log).
- `events:on(name, handler, ctx?)` subscribes; `events:off(name, handler?)` removes.
- World object timelines emit both `timeline.frame` and `timeline.frame.<timelineId>` events. Payload:

```lua
-- frame payload
{
  timeline_id = 'hero.timeline',
  frame_index = 0,
  frame_value = 'rise', -- whatever you put in frames[]
  rewound = false,
  reason = 'advance' | 'seek' | 'snap',
  direction = 1 | -1,
}
```

- Define a timeline on a world object via `self:define_timeline({ id, frames, ticks_per_frame?, playback_mode?, markers? })`. Markers can add/remove tags for the owner’s `AbilitySystemComponent` and fire custom events adopted by `events:on`.

## FSMs

`register_prepared_fsm(id, { initial, states = { stateName = { entering_state?, leaving_state?, tick?, process_input? } } })`

- `tick(self)` runs every frame; returning `'/other_state'` triggers a transition.
- `process_input(self)` lets you branch on input separately; it follows the same `'/target'` convention.
- `entering_state/leaving_state` are optional hooks.

## Gameplay Abilities

`define_ability({ id, activation(ctx, payload), completion?, cancel?, requiredTags?, blockedTags?, grantTags?, removeOnActivate?, removeOnEnd?, cooldownMs?, cost? })`

- `ctx` is a `GameplayAbilityExecution` instance: `ctx.owner`, `ctx.ownerId`, `ctx.vars` (per-run scratch), `ctx.intentPayload` (payload forwarded via `request_ability`), tag helpers (`has_tag`, `add_tag`, `remove_tag`, `toggle_tag`), and `request_ability` for chaining.
- `grantTags`/`removeOnActivate`/`removeOnEnd` mutate gameplay tags via the owner’s `AbilitySystemComponent`.
- `request_ability(objectId, abilityId, { payload? })` forwards `payload` to the ability as `ctx.intentPayload` and as the `payload` argument passed to `activation`.

## World Objects & Services

- `register_world_object({ id, class = 'WorldObject' | ClassTable, components?, fsms?, behavior_trees?, abilities?, tags?, defaults?, asset_id? })` registers descriptors that `spawn_object` can clone.
- `register_service({ id, fsms?, behavior_trees?, abilities?, tags?, auto_activate?, asset_id? })` registers services; `register_service` accepts a Lua table with hooks (`on_boot`, `on_activate`, `on_deactivate`, `on_tick`, `get_state`, `set_state`, `dispose`).

## Cartridge Skeleton

```lua
local HERO = 'demo.hero'
local HERO_FSM = 'demo.hero.fsm'
local BLINK = 'demo.ability.blink'

function init()
  cartdata('demo_cart')

  register_prepared_fsm(HERO_FSM, {
    initial = 'idle',
    states = {
      idle = {
        tick = function(self)
          if game:get_action_state(1, 'console_right').pressed then
            self.x = self.x + 60 * game.deltatime_seconds
            return '/moving'
          end
        end,
      },
      moving = {
        tick = function(self)
          if not game:get_action_state(1, 'console_right').pressed then
            return '/idle'
          end
        end,
      },
    },
  })

  define_ability({
    id = BLINK,
    grantTags = { 'demo.tag.blinking' },
    cooldownMs = 300,
    activation = function(ctx, payload)
      local dir = payload and payload.dir or 'right'
      ctx.owner.x = ctx.owner.x + (dir == 'left' and -24 or 24)
      ctx.owner.events:emit('demo.hero.blink', { dir = dir })
    end,
    completion = function(ctx)
      ctx.owner.events:emit('demo.hero.blink', { phase = 'done' })
    end,
  })

  register_world_object({
    id = HERO,
    class = 'Hero',
    fsms = { { id = HERO_FSM } },
    abilities = { BLINK },
    components = { 'AbilitySystemComponent' },
    defaults = { x = 48, y = 64 },
  })

  spawn_object(HERO, { id = 'hero.instance' })
end

function update(dt)
  if game:get_action_state(1, 'console_a').guardedjustpressed then
    request_ability('hero.instance', BLINK, { payload = { dir = 'right' } })
  end
end

function draw()
  cls(1)
  local hero = world_object('hero.instance')
  rectfill(hero.x, hero.y, hero.x + 8, hero.y + 8, 11)
end
```
