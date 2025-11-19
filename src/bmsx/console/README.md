# Bmsx Console API

`BmsxConsoleApi` is the Lua-facing facade for the runtime. Every cart receives an instance named `api` inside its lifecycle hooks, letting it talk to the renderer, input stack, audio engine, world/registry, and task gates without touching browser specifics.

## Conventions
- All API functions use `lowercase_snake_case`. Private helpers now follow the same convention to keep the file searchable.
- Tokens shown in this document use `UPPERCASE` (e.g. `"PLAYER_HIT"`, `"SPAWN_ENEMY"`). Keep actual engine literals such as `'pointer_primary'` or spawn reasons like `'fresh'` exactly as defined in the engine.
- Use `register_world_object` when defining new world object descriptors to stay consistent with the snake_case API.

## Frame & Input Helpers
- `set_render_backend`, `begin_frame`, `begin_paused_frame`, and `end_frame` bracket console rendering.
- `frame_number`, `delta_seconds`, `display_width`, and `display_height` expose timing and viewport information.
- Pointer helpers (`mousebtn`, `mousebtnp`, `mousebtnr`, `mousepos`, `pointer_screen_position`, `pointer_delta`, `pointer_viewport_position`, `mousewheel`, and `stat(32-36)`) let a cart react to buttons and movement regardless of platform.
- Use `check_action_state` to query arbitrary action bindings for any player index (>=1).

## Text & Primitive Rendering
- `cls`, `rect`, `rectfill`, and `rectfill_color` submit basic UI geometry into the console render layer.
- `write` renders with the built-in console font, while `write_with_font` accepts a custom `ConsoleFont`.
- Text rendering remembers a cursor; calling `write` without coordinates continues from the previous call until `cls` resets it.

## Storage, Stats & Audio
- `cartdata`, `dset`, and `dget` expose the persistent console storage namespace.
- `stat` mirrors the MSX-style indices already used in the engine (`32-36` map to pointer state). Additional indices can be extended in engine code as needed.
- `sfx`, `music`, `stop_sfx`, `stop_music`, `set_master_volume`, `pause_audio`, and `resume_audio` delegate straight into `$.sndmaster`.

## World Objects & Spawning
- `world`, `world_object`, and `world_objects` expose the currently running `World`.
- `spawn_world_object` instantiates a class by `class_ref` with optional overrides (position, orientation, scale, components, systems, etc.), while `spawn_object` clones a registered descriptor by id.
- Use `despawn` to exile and optionally dispose instances, `attach_fsm` to bind state machines, and `attach_bt` to bind behavior trees (IDs must already exist inside the FSM/BT registries).
- Registration helpers:
  - `register_world_object` registers console-level descriptors that carts can spawn later.
  - `register_component`, `define_component`, `register_component_preset`, `define_component_preset`, and `attach_component` manage component definitions and instances.
  - `register_service`, `define_service`, `register_ability`, `define_ability`, `grant_ability`, `request_ability`, `add_component`, and `remove_component` forward to the runtime to keep ECS wiring centralized.

## Registry, Services & Game Metadata
- `registry`, `registry_ids`, `rget`, `services`, and `service` give carts read access to the global registry and service instances.
- `game` exposes the underlying `Game`; `rompack` returns metadata about the active pack (if available).

## Events, Timelines & Task Gates
- `events` returns the shared `EventEmitter`.
- `emit`, `emit_gameplay`, and `emit_presentation` emit events (example: `api.emit('PLAYER_HIT', 'PLAYER_CORE', { damage = 2 })`).
- `timelines` enumerates registered `EventTimeline`s to coordinate scripted sequences.
- `taskgate(name)` fetches a named `GateGroup`, while `rungate()` returns the global run gate for coarse execution control.

## Behavior Registration
- `register_prepared_fsm(id, blueprint, options?)` installs a state machine blueprint factory and optionally runs `setupFSMlibrary`.
- `register_behavior_tree(descriptor)` forwards descriptors to the runtime so that `attach_bt` can find and instantiate them later.

## Example

```lua
function cart_init(api)
  api.cartdata('LEVEL_TEST')
  api.register_world_object({
    id = 'SPAWN_ENEMY',
    class_ref = 'EnemyWorldObject',
    components = {
      { classname = 'HealthComponent', options = { hitpoints = 5 } },
    },
  })
end

function cart_update(api)
  if api.mousebtn(BmsxConsolePointerButton.Primary) then
    api.emit('PLAYER_FIRE', 'PLAYER_CORE', { projectile = 'PLASMA' })
  end

  if api.mousebtnp(BmsxConsolePointerButton.Secondary) then
    api.spawn_object('SPAWN_ENEMY')
  end
end
```

This example highlights the preferred naming (`register_world_object`) and shows how event tokens remain uppercase for readability while engine literals (pointer actions) stay untouched.
