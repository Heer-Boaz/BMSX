import type { AbilityId } from './gastypes';

export type Schema<T> = {
	validate(value: unknown): value is T;
	describe?: string;
};

class AbilityRegistry {
	private readonly schemas = new Map<AbilityId, Schema<unknown>>();
	private readonly validators = new Map<AbilityId, (payload: unknown) => void>();

	public register<Id extends AbilityId, P>(id: Id, opts?: { schema?: Schema<P>; validate?: (payload: P) => void }): void {
		if (this.validators.has(id)) return;
		if (opts && opts.schema) {
			this.schemas.set(id, opts.schema as Schema<unknown>);
		}
		let validator: (payload: unknown) => void;
		if (opts && opts.validate) {
			const validateFn = opts.validate;
			validator = (payload: unknown) => {
				validateFn(payload as P);
			};
		} else {
			validator = () => {};
		}
		this.validators.set(id, validator);
	}

	public validate<Id extends AbilityId>(id: Id, payload: unknown): void {
		const validator = this.validators.get(id);
		if (!validator) {
			throw new Error(`[AbilityRegistry] Ability '${id}' not registered.`);
		}
		const schema = this.schemas.get(id);
		if (schema) {
			const valid = schema.validate(payload);
			if (!valid) {
				const description = schema.describe ? schema.describe : 'invalid';
				throw new Error(`[AbilityRegistry] '${id}' payload failed schema (${description}).`);
			}
		}
		validator(payload);
	}
}

export const abilityRegistry = new AbilityRegistry();

export function defineAbility<Id extends AbilityId, P>(id: Id, opts?: { schema?: Schema<P>; validate?: (payload: P) => void }): Id {
	abilityRegistry.register(id, opts);
	return id;
}
