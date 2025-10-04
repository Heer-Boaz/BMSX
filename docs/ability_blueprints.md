# Ability Blueprints

The Gameplay Ability System now supports declarative **Ability Blueprints**. Instead of hand-written `Ability` subclasses, abilities are defined as data objects and interpreted by `AbilityBlueprintRunner`. Key concepts:

- **AbilityBlueprint** extends the traditional `AbilitySpec` metadata and adds `activation`, `onComplete`, and `onCancel` task lists.
- **Ability Tasks** perform the work of an ability. Provided tasks include `call.action`, `mode.dispatch`, `emit.gameplay`, `wait.event`, `wait.time`, `wait.tag`, `tags.add`, `tags.remove`, and `ability.request`.
- **AbilityActionRegistry** allows binding string identifiers to TypeScript functions. Tasks with `kind: 'call.action'` execute these actions and receive the shared ability execution context.
- **Execution Context** gives actions access to the owning object, gameplay tag mutations, command buffer, additional ability requests, and per-ability scratch variables.
- Blueprints run inside the existing `AbilitySystemComponent`, so cooldowns, costs, and tags continue to work exactly as before. The component exposes `grantBlueprint` for registering data-driven abilities.

## Authoring Workflow

1. Create (or reuse) an `AbilityActionRegistry` and register high-level actions that encapsulate complex logic (e.g. toggling fighter state, broadcasting events, applying movement).
2. Define ability data using `abilityBlueprint(...)`, supplying metadata (`id`, `requiredTags`, etc.) alongside task arrays.
3. Register the blueprint via `AbilitySystemComponent.grantBlueprint(blueprint, registry)`.
4. Optionally, supply `onCancel` or `onComplete` tasks for clean-up work.

Example:

```ts
const walkAbility = abilityBlueprint({
	id: 'fighter.locomotion.walk',
	requiredTags: ['state.grounded'],
	blockedTags: ['state.attacking'],
	activation: [
		{ kind: 'call.action', action: 'fighter.configureWalk', params: { direction: fromIntent('payload.direction', undefined, true) } },
		{ kind: 'mode.dispatch', event: 'mode.locomotion.walk', payload: { direction: fromVar('locomotion.direction', literal('right')) } },
	],
	onCancel: [
		{ kind: 'mode.dispatch', event: 'mode.locomotion.idle' },
	],
});
```

## Fighter Updates

- Fighter locomotion, jump, and attack abilities are now defined through blueprints in `src/ella2023/abilities.ts`.
- A shared registry (`fighterActions`) encapsulates reusable operations such as configuring walk direction, beginning attacks, dispatching jump events, and tracking the one-per-jump flying kick rule.
- The `fighter_control` state machine now calls `walkTick` on each frame, shifting horizontal movement into the FSM layer rather than the ability runner.
- A new gameplay tag `state.airborne.attackUsed` replaces the previous boolean for flying-kick gating. The tag is applied via blueprint tasks and cleared when the jump state exits or when the ability completes/cancels.

Refer to the updated source for further examples of composing blueprints with actions and state-machine automation.
