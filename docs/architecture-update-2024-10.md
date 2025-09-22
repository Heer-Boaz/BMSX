# BMSX ModeGraph & Gameplay Pipeline Overhaul

## High-level Summary
- Introduced deterministic frame phases (Input → Ability runtime → ModeGraph → Physics → Animation → Presentation → Flush) orchestrated via `World.systems.updatePhase` and a revised `TickGroup` layout.
- Added a gameplay command buffer (`GameplayCommandBuffer`) and rewired the ability system so input, AI and scripts submit commands that are drained during the AbilityUpdate phase with deterministic `(frame, sequence)` ordering.
- Reworked fighter control FSM to make the ModeGraph the sole owner of gameplay tags, collapse per-move attack states into a parameterised action node, and switched all `go_*` events to scoped `mode.*` events.
- Added explicit event-bus lanes with runtime guards (`gameplay` vs `presentation`) and helpers (`Game.emitGameplay` / `Game.emitPresentation`). FSM `emit` actions now default to the presentation lane.
- Gameplay tag mutations now assert if attempted outside Phase 3 and ability activations flow through the gameplay command buffer so gameplay code cannot touch state outside the sanctioned phases.
- Event lanes are enforced at runtime (listener lanes vs emit lanes, consistent naming) and gameplay events are captured each frame via the new `GameplayEventRecorder` hook.

## Breaking Changes
- `TickGroup` values and semantics changed. Custom ECS registrations must use the updated groups (`Input`, `AbilityUpdate`, `ModeResolution`, `Physics`, `Animation`, `Presentation`, `EventFlush`).
- `World.run` no longer calls `updateUntil`/`updateFrom`; systems are expected to participate in discrete phases.
- Ability activation must flow through `AbilitySystemComponent.requestAbility`/`GameplayCommandBuffer`; direct `tryActivate` from gameplay code is no longer supported.
- Fighter control events renamed from `go_*` to `mode.*` scopes; downstream listeners must update.
- FSM attack states collapsed into a single `attack` branch with payload-driven `attackType`. Behavioural hooks should consult `state.data.currentAttack` rather than per-move substates.
- `EventEmitter.emit` now validates gameplay events have an identifiable emitter and accepts an optional lane parameter. Presentation broadcasts must opt into `{ lane: 'presentation' }` (or use the new helpers).

## Migration Notes
- Scripts that previously called `asc.tryActivate` directly should switch to `asc.requestAbility` (returns `false` when gating fails). The ability system now enqueues gameplay commands automatically.
- Gameplay code emitting presentation-only notifications (UI, audio, animation) should use `$.emitPresentation(...)`.
- Custom FSM YAML can opt into the presentation bus via `emit: { event: 'Foo', lane: 'presentation' }` or rely on the new default.
- ECS extensions registering physics systems should review priorities against the new `physicsStep` system in the builtin pipeline.

## Next Steps / TODO
- Backfill replay capture on the gameplay bus.
- Wire lint/assert coverage for tag mutations outside ModeGraph and hook presentation-only event audit.
- Port remaining animation/state charts to the `mode.*` event family.
