# BMSX Finite State Machines

This document gives a high-level tour of the BMSX FSM system—what it is, how it
is structured, the authoring options that are available, and how you can use it
for general gameplay flow or for animation graphs.

## Why FSMs?

Finite State Machines let you author behaviour in a declarative way. Instead of
placing imperative `if`/`switch` blocks across multiple objects, a state machine
encodes the legal states an object may be in, how it transitions between them,
and which actions should run during those transitions. The result is logic that
is easier to reason about, inspect in the debugger, and hot‑swap while a game is
running.

FSMs in BMSX are not limited to animation. The same machinery powers AI logic,
UI flow, combat ability gating, cutscenes, dialogue trees, and more.

## Architecture Overview

- **StateDefinition** – describes a state, its substates, transitions and tape
  (sequence) data. Definitions can be declared in TypeScript or loaded from JSON
  / YAML. A definition is a tree: substates are just nested `states` objects.
- **State** – the runtime counterpart to a definition. Holds mutable data, the
  tape head, history stack, current substate references, etc.
- **StateMachineController** – owns one or more machines attached to an object
  (usually a `WorldObject` or the `World`). It routes events, ticks concurrent
  machines, manages pause/resume, and exposes helpers (`transition_to`,
  `matches_state_path`, `dispatch_event`, …).
- **Handler Registry** – the hoisting layer that binds handler methods (from
  classes or DSL actions) to runtime proxies. This enables hot‑swapping: a YAML
  change or a TypeScript handler update takes effect without manually rewiring
  listeners.

## Ways to Author

1. **TypeScript** – annotate static methods with `@build_fsm()`/`@assign_fsm()`
   and return plain objects. This is the most explicit style and gives access to
   inline handlers.
2. **ROM data (JSON/YAML)** – ship FSM blueprints with your ROM. These are read
   at boot, validated, hoisted, and hot‑swappable at runtime. This is the
   approach used by `ella2023` to author `player_animation.fsm.yaml`.
3. **Hybrid** – fetch a definition from data but still reference class
   handlers. Because handlers are hoisted through the registry, YAML/JSON can
   safely reference `game.handlers.MyClass.method` without leaking implementation
   details.

## Runtime Capabilities

- **Event Driven** – `on` / `input_event_handlers` map events to strings,
  transition specs, or declarative action objects. Events can be scoped (`$foo`
  for local) and the controller will subscribe/unsubscribe automatically at
  bind/unbind time.
- **Tape System** – attach `tape_data`, `ticks2advance_tape`, and related flags
  to a state to drive sequences (animation frames, quiz steps, etc.). Tape hooks
  such as `tape_next`, `tape_end` can be handlers or DSL actions.
- **Actions DSL** – the FSM blueprint DSL supports:
  - `set_property` to mutate the owning object or state.
  - `emit` and `dispatch_event` to notify other systems or controller machines.
  - `set_ticks_to_last_frame` for clip shortening.
  - Conditional execution (`when`/`then`/`else`) with argument, value, and
	`state_matches` predicates.
  - Sequencing (arrays of actions).
  You can keep things simple or drop down to TypeScript handlers whenever you
  need specialised behaviour.
- **Guards & History** – use `guards` to block transitions when conditions are
  not met and `pop()`/history to jump back to previous states.
- **Parallel Machines** – mark a machine as `is_concurrent` to run it alongside
  others. Controllers can pause/resume individual machines or all but a given
  one.

## Using FSMs for Animation

FSMs double as a light-weight animation graph system:

- Each animation state can set sprites, trigger audio/FX events, and control
  combat flags through declarative actions.
- Tapes provide frame stepping (`ticks2advance_tape`, `tape_playback_mode`, `tape_playback_easing`).
- Concurrency lets you run gameplay logic and animation machines in parallel.
- Events such as `animationEnd` can fan out to other systems (e.g. AI or combat).

See `src/ella2023/res/data/player_animation.fsm.yaml` for a real example. The
YAML file describes all of Eila’s animation states, their transitions, and the
events they raise; the TypeScript class no longer needs bespoke animation
handlers.

If you still need handcrafted logic—for instance blending sprite metadata,
performing physics responses, or sequencing effects—you can attach handlers via
`@fsmHandler` or reference them from the data blueprint.

## Inspection & Debugging

- **Debugger UI** – the built-in debugger shows active machines, current states,
  and history. Use it to validate transitions while the game is running.
- **Validation** – `validateStateMachine` runs when registering definitions and
  will throw on invalid transitions or missing states. Warnings are emitted when
  a referenced handler is missing.
- **Hot Swap** – because the registry hoists handlers and proxies them, updating
  a YAML blueprint or a TypeScript handler does not require a restart.

## Best Practices

- Use FSMs to encapsulate distinct behaviour modes (UI screens, combat phases,
  animation clips, quest states) and keep imperative logic minimal.
- Prefer declarative actions for state entry/exit side effects. Drop back to
  TypeScript handlers when you need reusable logic or performance-sensitive
  code.
- Keep machines small and composable—use substates or parallel machines instead
  of giant monolithic graphs.
- Combine FSMs with other systems: dispatch events for audio/FX, toggle
  components, or drive Behaviour Trees via shared state data.

---

For concrete usage examples browse:

- `src/ella2023/res/data/player_animation.fsm.yaml` – animation state machine.
- `src/ella2023/fighter.ts` – combat/AI machines driving gameplay.
- `docs/decorators.md` – reference for FSM decorators.
