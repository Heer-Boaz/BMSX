# BMSX ModeGraph & Gameplay Pipeline Overhaul

## High-level Summary
- Introduced deterministic frame phases (Input → Intents → Ability gating → Ability runtime → ModeGraph → Physics → Animation → Presentation → Flush) orchestrated via `World.systems.updatePhase` and a revised `TickGroup` layout.
- Added a gameplay intent queue (`GameplayIntentQueue`) and rewired the ability system so input, AI and scripts queue intents that are consumed in phase 2 before abilities tick in phase 3.
- Reworked fighter control FSM to make the ModeGraph the sole owner of gameplay tags, collapse per-move attack states into a parameterised action node, and switched all `go_*` events to scoped `mode.*` events.
- Added explicit event-bus lanes with runtime guards (`gameplay` vs `presentation`) and helpers (`Game.emitGameplay` / `Game.emitPresentation`). FSM `emit` actions now default to the presentation lane.
- Gameplay tag mutations now assert if attempted outside Phase 4 and Ability intents flow through a bounded, fair intent queue (deterministic ordering, dedupe, backpressure telemetry).
- Event lanes are enforced at runtime (listener lanes vs emit lanes, consistent naming) and gameplay events are captured each frame via the new `GameplayEventRecorder` hook.

## Breaking Changes
- `TickGroup` values and semantics changed. Custom ECS registrations must use the updated groups (`Input`, `IntentResolution`, `AbilityUpdate`, `ModeResolution`, `Physics`, `Animation`, `Presentation`, `EventFlush`).
- `World.run` no longer calls `updateUntil`/`updateFrom`; systems are expected to participate in discrete phases.
- Ability activation must flow through `AbilitySystemComponent.requestAbility`/`GameplayIntentQueue`; direct `tryActivate` from gameplay code is no longer supported.
- Fighter control events renamed from `go_*` to `mode.*` scopes; downstream listeners must update.
- FSM attack states collapsed into a single `attack` branch with payload-driven `attackType`. Behavioural hooks should consult `state.data.currentAttack` rather than per-move substates.
- `EventEmitter.emit` now validates gameplay events have an identifiable emitter and accepts an optional lane parameter. Presentation broadcasts must opt into `{ lane: 'presentation' }` (or use the new helpers).

## Migration Notes
- Scripts that previously called `asc.tryActivate` directly should switch to `asc.requestAbility` (returns `false` when gating fails) or push intents to `GameplayIntentQueue`.
- Gameplay code emitting presentation-only notifications (UI, audio, animation) should use `$.emitPresentation(...)`.
- Custom FSM YAML can opt into the presentation bus via `emit: { event: 'Foo', lane: 'presentation' }` or rely on the new default.
- ECS extensions registering physics systems should review priorities against the new `physicsStep` system in the builtin pipeline.

## Next Steps / TODO
- Backfill replay capture on the gameplay bus.
- Wire lint/assert coverage for tag mutations outside ModeGraph and hook presentation-only event audit.
- Port remaining animation/state charts to the `mode.*` event family.
