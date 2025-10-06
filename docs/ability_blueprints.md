# Gameplay Ability Definitions

The Gameplay Ability System now consumes strongly typed **Gameplay Ability Definitions** instead of the previous coroutine/blueprint runner. Abilities remain fully data-driven, but the execution model is simpler and mirrors Unreal's phase/task approach.

## Key Building Blocks

- **GameplayAbilityDefinition** extends the base `AbilitySpec` metadata (id, unique policy, cooldown, tag requirements) and provides `activation`, optional `completion`, and optional `cancel` step lists.
- **Ability Steps** describe the work performed by an ability. Supported step kinds:
  - `call` &mdash; invoke a registered action with optional parameters.
  - `dispatch` &mdash; enqueue a mode/event dispatch on the owning object (optionally targeting another entity or lane).
  - `emit` &mdash; broadcast a gameplay event with payload and optional lane.
  - `waitEvent`, `waitTime`, `waitTag` &mdash; pause execution until an event, duration, or tag condition is satisfied.
  - `setVar`, `clearVar` &mdash; mutate per-ability scratch variables.
  - `modifyTags` &mdash; add/remove explicit gameplay tags while active.
  - `requestAbility` &mdash; trigger another ability.
  - `sequence` &mdash; group nested steps for clarity.
- **AbilityActionRegistry** maps string identifiers to TypeScript functions. `call` steps run these actions with a rich context (owner, tags, vars, command buffer, nested ability requests).
- **Runtime Bindings** expose tag mutation, gameplay event emission, and command submission through the existing `AbilitySystemComponent`. Definitions add optional `tags.grant`, `tags.removeOnActivate`, and `tags.removeOnEnd` helpers for common tag choreography.

## Authoring Workflow

1. Register domain-specific actions on an `AbilityActionRegistry`:
   ```ts
   const actions = new AbilityActionRegistry();
   actions.register('fighter.configureWalk', (ctx, params) => { /* ... */ });
   actions.register('fighter.beginAttack', (ctx, params) => { /* ... */ });
   ```
2. Describe abilities with plain objects, using the helper value builders exported from `bmsx/gas/gameplay_ability` (`literal`, `fromIntent`, `fromVar`, etc.).
   ```ts
   const walkAbility: GameplayAbilityDefinition = {
     id: 'fighter.locomotion.walk',
     unique: 'restart',
     requiredTags: ['state.grounded'],
     blockedTags: ['state.attacking', 'state.airborne', 'state.combat_disabled'],
     activation: [
      { type: 'call', action: 'fighter.configureWalk', params: { direction: fromIntent('payload.direction', { optional: true }) } },
      { type: 'dispatch', event: 'mode.locomotion.walk', payload: { direction: fromVar('locomotion.direction', { fallback: literal('right') }) } },
     ],
     cancel: [
       { type: 'dispatch', event: 'mode.locomotion.idle' },
     ],
   };
   ```
3. Grant abilities via the component: `asc.grantAbility(walkAbility, actions);`
4. Optional `completion` or `cancel` steps cover clean-up work without re-entering the main activation flow.

## Fighter Overhaul Highlights

- All fighter locomotion, jump, and attack abilities are authored with the new definitions in `src/ella2023/abilities.ts`.
- The action registry encapsulates operations like walking configuration, jump dispatch, attack bookkeeping, and flying-kick gating without scattering logic across abilities.
- Cooldowns, costs, and gameplay tags remain enforced by `AbilitySystemComponent`. Grant/remove helpers ensure tags revert correctly when abilities finish or cancel.

The new structure keeps abilities declarative, favors compile-time safety, and removes the coroutine-specific boilerplate from the previous blueprint runner.
