# Lean Historical Style

Use selected 2024 BMSX engine code as the style anchor. Do not use 2019 Sintervania gameplay code, and do not use 2021-2022 engine code as the primary style source unless the user explicitly asks for that period.

The useful 2024 signal is not "copy every line from 2024"; some files still contain over-commenting, temporary work, and defensive leftovers. Copy the engine direction: explicit ownership, direct runtime flow, precompiled work, hot-path data reuse, and domain concepts split into real modules.

## Reference Commits
- `60fdc037` refactored state machine transition flow.
- `65e43e77` state run, input processing, run checks, and transition logic.
- `e0f1e36b` transition-to-next-state via events/runchecks unified into one method.
- `271860d5` extracted `TOKEN_REGEX` for action parser performance.
- `0c50b022` action parser refactor.
- `1ac42b0e` precompiled action state modifiers into a single action evaluator.
- `39c109e5` event emitter organization.
- `318d56dd` GLSL imports moved out of TypeScript strings.
- `0790bc3b` CRT shader readability and constants.
- `3fc8be57` GLView shader property management.
- `0c481a5b` GameObject organization.
- `8833d440` hitarea and size calculations.

When concrete examples are needed, inspect these directly:

```bash
git show 0c50b022:src/bmsx/actionparser.ts
git show 1ac42b0e:src/bmsx/input.ts
git show 60fdc037:src/bmsx/bfsm.ts
git show 9fd731da:src/bmsx/eventemitter.ts
git show 9fd731da:src/bmsx/glview.ts
git show 9fd731da:src/bmsx/gameobject.ts
git show 9fd731da:src/bmsx/basemodel.ts
```

## Useful Signals
- `ActionParser` moved parsing into a dedicated module, cached parsed definitions, and precompiled repeated action checks instead of reparsing or rebuilding logic per query.
- FSM code owns state transition rules directly: events, run checks, transition queues, and state paths are state-machine concerns, not generic service concerns.
- Input code converged keyboard/gamepad/onscreen concepts into shared button state machinery instead of parallel almost-identical implementations.
- Event emitter code uses explicit scoped listener maps. The abstraction is the real domain mechanism, not a facade hiding unrelated ownership.
- `GLView` owns WebGL buffers, shader programs, uniforms, texture setup, and draw queues directly. Hot render data lives in preallocated typed arrays.
- Shader code was moved to GLSL files instead of giant TypeScript string blobs. Split files when it clarifies ownership.
- Game object and collision work moved toward named geometry/component concepts instead of scattered hitarea math.

## What To Copy
- Direct runtime and state-machine control flow.
- Precompute and cache expensive parsing/lookup/modifier work.
- Keep hot-path buffers alive and mutate them; avoid fresh arrays, objects, closures, and strings per frame.
- Use closed-kind dispatch with `switch` or table-driven dispatch when the set is explicit.
- Split modules by real engine concepts: parser, FSM, input, event emitter, view, shader, object/collision.
- Throw at contract violations that reveal broken internal state. Handle fallibility only at true boundaries.

## What Not To Copy
- Over-commenting that repeats type names, parameter names, or obvious assignments.
- Temporary WIP commits, debug-only scaffolding, or half-finished compatibility branches.
- Gameplay names, Sintervania save paths, or game-specific constants.
- Optional chains and fallback returns that hide incomplete initialization.
- Broad "maintainability" abstractions that add layers without moving ownership closer to data.

## Translation To Current BMSX
- A machine/runtime device should expose the hardware contract directly through memory maps, MMIO, scheduler/device ownership, or explicit runtime APIs.
- A cart-facing API should be short, stable, and cheap. Avoid long repeated string identifiers or host shortcuts that leak implementation.
- IDE/editor code should centralize text, identifier, normalization, query, bounds, and caret concepts instead of repeating local mini-implementations.
- C++ and TS versions should converge on the same conceptual ownership. Do not create parallel "almost same" helpers unless the language boundary demands it.
