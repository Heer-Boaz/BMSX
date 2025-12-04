import { Component, type ComponentAttachOptions } from './basecomponent';
import { excludepropfromsavegame, insavegame } from '../serializer/serializationhooks';
import { create_gameevent } from '../core/game_event';
import type { WorldObject } from '../core/object/worldobject';
import {
	type ActionEffectDefinition,
	type ActionEffectHandlerResult,
	type ActionEffectId,
	type ActionEffectPayloadFor,
	type ActionEffectTriggerOptions,
	type ActionEffectTriggerResult,
} from '../action_effects/effect_types';
import { ActionEffectRegistry } from '../action_effects/effect_registry';

@insavegame
export class ActionEffectComponent extends Component {
	public static override get unique(): boolean { return true; }
	static { this.autoRegister(); }

	private readonly definitions = new Map<ActionEffectId, ActionEffectDefinition>();
	@excludepropfromsavegame private readonly cooldownUntil = new Map<ActionEffectId, number>();
	// Component-local clock (advanced by ActionEffectRuntimeSystem); cooldowns depend on this.
	@excludepropfromsavegame private timeMs = 0;

	/*
		Wiring map (effects):
		- Effects are registered via define_effect/define_effect (Lua/console runtime) into the ActionEffectRegistry.
		- World objects attach ActionEffectComponent and list effect ids in their definition; attachWorldObjectEffects grants those definitions here.
		- Input-driven triggers: FSM/process_input or InputActionEffect programs call api.trigger_effect/component.trigger(...).
		- This component enforces cooldown (timeMs advanced by ActionEffectRuntimeSystem) and emits owner events (owner.events + owner.sc.dispatch_event).
		- Handlers should apply side effects directly and optionally return { event, payload } to customize the emitted event.
	*/

	constructor(opts: ComponentAttachOptions) {
		super(opts);
	}

	public advance_time(dtMs: number): void {
		if (!Number.isFinite(dtMs)) {
			throw new Error('[ActionEffectComponent] advance_time received invalid delta time.');
		}
		this.timeMs += dtMs;
		if (this.cooldownUntil.size === 0) return;
		const now = this.timeMs;
		for (const [id, until] of [...this.cooldownUntil]) {
			if (now >= until) this.cooldownUntil.delete(id);
		}
	}

	public grant_effect(definition: ActionEffectDefinition): void {
		if (!definition || !definition.id) {
			throw new Error('[ActionEffectComponent] Cannot grant effect without an id.');
		}
		this.definitions.set(definition.id, definition);
	}

	public grant_effect_by_id(id: ActionEffectId): void {
		const definition = ActionEffectRegistry.instance.get(id);
		if (!definition) {
			throw new Error(`[ActionEffectComponent] Effect '${id}' is not registered.`);
		}
		this.grant_effect(definition);
	}

	public revoke_effect(id: ActionEffectId): void {
		this.definitions.delete(id);
		this.cooldownUntil.delete(id);
	}

	public has_effect(id: ActionEffectId): boolean {
		return this.definitions.has(id);
	}

	public trigger<Id extends ActionEffectId>(id: Id, opts?: ActionEffectTriggerOptions<Id>): ActionEffectTriggerResult {
		const definition = this.definitions.get(id);
		if (!definition) return 'failed';

		const payload = opts?.payload as ActionEffectPayloadFor<Id>;
		ActionEffectRegistry.instance.validate(id, payload);

		const now = this.timeMs;
		const cdUntil = this.cooldownUntil.get(id);
		if (cdUntil !== undefined && now < cdUntil) {
			return 'on_cooldown';
		}

		const owner = this.ownerOrThrow();
		const outcome = this.invokeHandler(definition, owner, payload);
		// Effects emit owner-scoped events; handlers should apply side effects directly and return optional payload/event name.
		const eventType = outcome?.event ?? definition.event ?? (definition.id as string);
		const eventPayload = outcome && outcome.payload !== undefined ? outcome.payload : payload;
		const event = this.createOwnerEvent(owner, eventType, eventPayload);
		owner.events.emitEvent(event);
		owner.sc.dispatch_event(event);

		if (definition.cooldown_ms !== undefined && definition.cooldown_ms > 0) {
			this.cooldownUntil.set(id, now + definition.cooldown_ms);
		}
		return 'ok';
	}

	public cooldown_remaining(id: ActionEffectId): number {
		const until = this.cooldownUntil.get(id);
		if (until === undefined) return null;
		const remaining = until - this.timeMs;
		if (remaining <= 0) return null;
		return remaining;
	}

	private invokeHandler<Id extends ActionEffectId>(
		definition: ActionEffectDefinition<Id>,
		owner: WorldObject,
		payload: ActionEffectPayloadFor<Id>,
	): ActionEffectHandlerResult {
		const handler = definition.handler;
		if (!handler) return undefined;
		return handler({ owner, payload });
	}

	private createOwnerEvent(owner: WorldObject, type: string, payload: unknown): ReturnType<typeof create_gameevent> {
		const base: Record<string, unknown> = { type, emitter: owner };
		if (payload !== undefined) {
			if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
				Object.assign(base, payload as Record<string, unknown>);
			} else {
				base.payload = payload;
			}
		}
		return create_gameevent(base as unknown as { type: string } & Record<string, unknown>);
	}

	private ownerOrThrow(): WorldObject {
		const owner = this.parent;
		if (!owner) throw new Error('[ActionEffectComponent] Owner not found.');
		return owner;
	}
}
