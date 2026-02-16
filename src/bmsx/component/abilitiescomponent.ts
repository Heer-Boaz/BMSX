import { insavegame, excludepropfromsavegame } from '../serializer/serializationhooks';
import { Component, type ComponentAttachOptions } from './basecomponent';
import type { WorldObject } from '../core/object/worldobject';

export type AbilityActivationContext<TPayload = unknown> = {
	component: AbilitiesComponent;
	owner: WorldObject;
	ability: string;
	payload?: TPayload;
};

export type AbilityDefinition = {
	activate?(context: AbilityActivationContext): boolean | void;
};

function mergeAbilityPayload(base: Record<string, unknown>, payload: unknown): Record<string, unknown> {
	if (payload === undefined) return base;
	if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
		Object.assign(base, payload as Record<string, unknown>);
		return base;
	}
	base.payload = payload;
	return base;
}

@insavegame
export class AbilitiesComponent extends Component {
	public static override get unique(): boolean { return true; }
	static { this.autoRegister(); }

	@excludepropfromsavegame private readonly registered = new Map<string, AbilityDefinition>();
	private readonly instance_seq: Record<string, number> = {};
	private readonly active_seq: Record<string, number> = {};
	private readonly ended_seq: Record<string, number> = {};

	constructor(opts: ComponentAttachOptions) {
		super(opts);
	}

	public register_ability(id: string, definition: AbilityDefinition): void {
		if (!id) throw new Error('[AbilitiesComponent] register_ability requires a non-empty id.');
		if (!definition) throw new Error(`[AbilitiesComponent] register_ability('${id}') requires a definition.`);
		this.registered.set(id, definition);
	}

	public activate(id: string, payload?: unknown): boolean {
		const definition = this.registered.get(id);
		if (!definition) throw new Error(`[AbilitiesComponent] Unknown ability '${id}' on '${this.ownerOrThrow().id}'.`);
		if (!definition.activate) return false;
		const result = definition.activate({
			component: this,
			owner: this.ownerOrThrow(),
			ability: id,
			payload,
		});
		return result !== false;
	}

	public begin(id: string, payload?: unknown): number {
		const activeSeq = this.active_seq[id] ?? 0;
		if (activeSeq !== 0) {
			return activeSeq;
		}
		const nextSeq = (this.instance_seq[id] ?? 0) + 1;
		this.instance_seq[id] = nextSeq;
		this.active_seq[id] = nextSeq;
		const eventPayload = mergeAbilityPayload({
			ability: id,
			ability_instance_seq: nextSeq,
		}, payload);
		this.ownerOrThrow().emit_gameplay_fact(`evt.ability.start.${id}`, eventPayload);
		return nextSeq;
	}

	public end_once(id: string, reason: string, payload?: unknown): boolean {
		const activeSeq = this.active_seq[id] ?? 0;
		if (activeSeq === 0) {
			return false;
		}
		if (this.ended_seq[id] === activeSeq) {
			return false;
		}
		this.ended_seq[id] = activeSeq;
		this.active_seq[id] = 0;
		const eventPayload = mergeAbilityPayload({
			ability: id,
			ability_instance_seq: activeSeq,
			reason,
		}, payload);
		this.ownerOrThrow().emit_gameplay_fact(`evt.ability.end.${id}`, eventPayload);
		return true;
	}

	private ownerOrThrow(): WorldObject {
		const owner = this.parent;
		if (!owner) throw new Error('[AbilitiesComponent] Owner not found.');
		return owner;
	}
}
