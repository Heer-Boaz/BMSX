> 1. What are the absolute core features you want to preserve from the current engine (e.g., FSM flexibility, event-driven architecture, timelines, ECS, etc.)?
Everything and that makes it so hard. I understand that all the core-engine features are required to allow for easy development of games. E.g.
* the ECS allows for strict game rules, easy extension crafting, as well as that it prevents bugs based on race-conditions.
* the `EventEmitter` provides a centralized bus that enables communication between all part of the game engine.
* the FSMs are powerful and can do almost anything.
* the timelines were designed to decrease the complexity of the FSMs and to make them fist-class citizens.
* the input system is powerful, yet simple.
* GAS should provide a solution to many if-then-else/FSM code that is required for any game that has slightly more than trivial controls.
* the AEM (Audio Event Manager) is a powerful module that actually decreases complexity regarding audio design.

Yet, things can be greatly simplified:
* Events:
  * Remove the `EventLane` totally and completely.
  * Remove the concept of "parent-scoped events" as I don't see its value. Just filter on specific emitters.
  * Remove the requirement of providing an `emitter` (or `emitter_id`) for events.
  * Somehow find a way to make subscribing to events much simpler by changing the way that the event bus (`EventEmitter`) works. Now, the filtering happens in a strange way, where you subscribe to an event globally, but also provide a filter, expect when you really really subscribe to a global event (`any`). That is not how that usually works: you subscribe to an event by directly requesting a subscription at the entity responsible for emitting the events. E.g. just consider all modules and entities to be event emitters and allow entities/modules to subscribe to them directly. Then, under-the-hood, the `EventEmitter` would still be doing the thing it does now. However, I don't know how to achieve that in a generic way, e.g. I don't know how to simplify:
```ts
					on: {
						[RETURN_TO_TITLE_EVENT]: '/TITLESCREEN',
						[`TIMELINE.FRAME:${TIMEOUT_TIMELINE_ID}`]: {
							scope: 'GAMEOVER',
							do() {
								return '/TITLESCREEN';
							},
						},
					},
```

* ECS:
  * Remove the `GameplayMovementSystem`, `GameplayCommandBuffer`, `FsmEventDispatchSystem`.
  * Merge the `InputIntentSystem` into the `InputAbilitySystem`.
  * Remove the `SpriteAnimationSystem` and just have sprites manage their own animations via `Timeline`s.
  * Remove the `SpriteColliderSyncSystem` and just have sprites manage their own colliders via their components.
  * Merge the `Collision2DBroadphaseSystem` into the `Overlap2DSystem` and just have one 2D collision system.

* FSM:
  * Remove the `fsm_classic_linter.ts` and just have one FSM style.
  * Just have events scoped to the entity itself. No "parent-scoped" events. Also, self-scoped events are the default. No need to specify `scope: 'self'` and also see above regarding event subscriptions, which would make that even clearer or more straightforward.

* Services:
  * Merge the `collision2d_service.ts` into the `Overlap2DSystem` and just have one 2D collision/overlap system.

* Input System:
  * Don't allow non-triggered actions to be consumed and non-pressed buttons to be consumed.

* Timelines:
  * Remove the `TimelineDefinition` and just have `Timeline`s that are defined programmatically.
  * Remove the `TimelineEntry` and just have the `Timeline` manage its own state.
  * Remove the `TimelineComponent` and just have timelines be managed by a `TimelineSystem` that is part of the ECS.
  * Remove the `TimelineEventPayload` and just provide the relevant data directly in the event.

* GAS:
  * Remove the Intent system and just have abilities be activated directly.
  * Remove the `InputIntentComponent` and just have input be managed by the `Input` and `GAS` systems.
  * Remove the `Effect` and just have handlers that apply the effect programmatically.
  * Remove the `GameplayAbilityExecution` and just have ability executions be functions that perform the execution.
  * Greatly simplify the `InputAbilityDSL` and just have ability activations be function calls, although still allow for data-driven definitions of abilities. Then it becomes similar to how FSMs and BehaviorTrees are defined now.

> 2. How Lua integration will look—are you targeting scriptable logic (e.g., game rules, transitions) or replacing large parts of TypeScript logic with Lua?
The Lua integration should be the same as it is now: core-engine completely in TypeScript, while the game-cart itself is pure Lua. I believe the key to simplifying the architecture lies in the API between the game-cart and the core-engine. There already is some simplification in place, e.g. defining new WorldObjects in a data-driven manner while also providing options for writing specific handlers.

> 3. Do you want the architecture to resemble a specific mental model (like UE5's, Godot’s node tree, or classic OO composition)?
My own mental model that's in place, that is a combination between UE5 and OO composition (I believe, please provide your own input).

> 4. Are you open to replacing your FSM system with a much leaner version or entirely event-less gameplay logic for most actors (as Codex-friendly as possible)?
Yes.

> 5. Is the goal to support both small arcade-style games and larger adventure/fighter-style games, or just prioritize simplicity and fast prototyping for now?
Both small arcade-style games and larger adventure/fighter-style games. Also 3D-games.

> 6. Any coding practices or patterns you want to enforce or avoid (e.g., no singletons, strict immutability, functional programming)?
Coding policies: *no defensive checks, trust the types, trust proper initialization and configuration (thus: no `ensure`), let the code just fail (thus: trust the code and just let runtime errors pop-up)!, and no legacy fallbacks permitted!*

> 7. Do I need to consider any existing codebases or projects that must be compatible with the new architecture?
No, not at all. The new architecture can be a complete rewrite. I even temporarily removed the existing game project folders to avoid any temptation to keep compatibility. Note that you will see a lot of changes when checking Git diffs via `git status`, but those are just because I moved files around and can be ignored.

• - Adopt snake_case consistently across the new APIs so Lua-facing glue matches engine expectations: e.g. entity:activate_ability, timeline.frame.TIMEOUT, clip_id, timeline_events(owner, clip_id), and DSL helpers like events.channel('timeline', clip_id) all use
    underscores; same for context slots such as ctx.wait_event, ctx.add_tags, input_intent_component.
  - Update the planned EventPort helper to expose channel(namespace: string, key?: string) and timeline_events(owner, clip_id) using snake-case event ids (timeline.frame.timeout, timeline.end.timeout), ensuring direct subscriptions rely on emitter-owned ports (src/bmsx/
    core/eventemitter.ts:28-60, src/bmsx/component/timeline_component.ts:248-259, src/bmsx/core/object/worldobject.ts:229-274).
  - Keep the merged ECS responsibilities (input ability, overlap, sprite timeline/collider) as currently implemented (src/bmsx/ecs/input_ability_system.ts:55-205, src/bmsx/ecs/overlap2d_system.ts:21-605, src/bmsx/component/sprite_component.ts:65-160), but rename the
    remaining camelCase runtime helpers (e.g. resolveIntentPlayerInput, makePairKey) when you touch those files so the Lua bridge keeps snake_case parity.
  - Build the programmatic timeline builder and generator-based ability runtime with snake_case identifiers (timeline_builder, play_clip, wait_event, apply_effect), then surface Lua bindings like timeline.define(entity, 'attack', builder_fn) and ability.register('dash',
    dash_fn) through HandlerRegistry (src/bmsx/core/handlerregistry.ts:368-406) so scripts stay pure Lua without defensive fallbacks.

  Next steps: update the concrete TypeScript surfaces with snake_case names, add the events.channel/timeline_events helpers, and prototype one Lua cart using the generator-based ability flow to validate the API end-to-end.
