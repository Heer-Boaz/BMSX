import { Registry } from '../core/registry';
import { RegisterablePersistent } from '../rompack/rompack';
import type { ActionEffectDefinition, ActionEffectId } from './effect_types';

export type Schema<T> = {
	validate(value: unknown): value is T;
	describe?: string;
};

export type RegisterEffectOptions<P> = {
	schema?: Schema<P>;
	validate?: (payload: P) => void;
};

export class ActionEffectRegistry implements RegisterablePersistent {
	/**
	 * The singleton instance of the ActionEffectRegistry class.
	 */
	public static instance: ActionEffectRegistry = new ActionEffectRegistry();

	get registrypersistent(): true {
		return true;
	}

	public get id(): 'ae_registry' { return 'ae_registry'; }

	/**
	 * Disposes the object and deregisters it from the registry.
	 */
	public dispose(): void {
		ActionEffectRegistry.instance.clear();
	}

	public bind(): void {
		Registry.instance.register(this);
	}

	public unbind(): void {
		Registry.instance.deregister(this);
	}

	private readonly schemas = new Map<ActionEffectId, Schema<unknown>>();
	private readonly validators = new Map<ActionEffectId, (payload: unknown) => void>();
	private readonly definitions = new Map<ActionEffectId, ActionEffectDefinition>();

	public register<Id extends ActionEffectId, P>(definition: ActionEffectDefinition<Id>, opts?: RegisterEffectOptions<P>): ActionEffectDefinition<Id> {
		if (!definition) throw new Error('[ActionEffectRegistry] definition is required.');
		const id = definition.id;
		if (!id) throw new Error('[ActionEffectRegistry] definition.id is required.');
		if (opts) {
			if (opts.schema) this.schemas.set(id, opts.schema);
			if (opts.validate) this.validators.set(id, opts.validate);
		}
		this.definitions.set(id, definition); // Note that we allow overwriting definitions here on purpose: we need game initialization to be idemptotent.
		return definition;
	}

	public clear(): void {
		this.schemas.clear();
		this.validators.clear();
		this.definitions.clear();
	}

	public get<Id extends ActionEffectId>(id: Id): ActionEffectDefinition<Id> {
		return this.definitions.get(id) as ActionEffectDefinition<Id>;
	}

	public has(id: ActionEffectId): boolean {
		return this.definitions.has(id);
	}

	public validate<Id extends ActionEffectId>(id: Id, payload: unknown): void {
		const schema = this.schemas.get(id);
		if (schema && !schema.validate(payload)) {
			const description = schema.describe ? schema.describe : 'invalid';
			throw new Error(`[ActionEffectRegistry] '${id}' payload failed schema (${description}).`);
		}
		const validator = this.validators.get(id);
		if (validator) {
			validator(payload);
		}
	}
}
