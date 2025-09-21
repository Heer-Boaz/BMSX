import { ConcreteOrAbstractConstructor, Identifier, Registerable } from '../rompack/rompack';

export class Registry {
	public static readonly instance: Registry = new Registry();
	private _registry: Record<Identifier, Registerable>;

	constructor() {
		this._registry = {};
	}

	/**
	 * Retrieves an entity from the registry based on its identifier.
	 * @param id The identifier of the entity to retrieve.
	 * @returns The retrieved entity if found, otherwise null.
	 */
	public get<T extends Registerable = any>(id: Identifier): T | null {
		return this._registry[id] as T || null;
	}

	/**
	 * Checks if the model has the specified identifier.
	 * @param id - The identifier to check.
	 * @returns True if the model has the identifier, false otherwise.
	 */
	public has(id: Identifier): boolean {
		return this._registry[id] !== undefined;
	}

	public register(entity: Registerable) {
		this._registry[entity.id] = entity;
	}

	public deregister(id: Registerable | Identifier, removePersistentRecord: boolean = false): boolean {
		const entity_id = typeof id === 'string' ? id : id.id;
		if (this._registry[entity_id]?.registrypersistent && !removePersistentRecord) return false; // If the entity is persistent, we don't delete it
		return delete this._registry[entity_id];
	}

	/**
	 * Retrieves all entities from the registry that are marked as persistent.
	 * Used to get entities for which we should reregister event subscriptions on loading gamestate.
	 * TODO: Find a better way to handle this.
	 * @returns {Registerable[]} An array of entities that have the `registrypersistent` property set to true.
	 */
	public getPersistentEntities(): Registerable[] {
		return Object.values(this._registry).filter(e => e.registrypersistent);
	}

	public clear() {
		for (const id in this._registry) {
			const entity = this._registry[id];
			if (!entity.registrypersistent) { // If the entity is persistent, we don't delete it
				delete this._registry[id];
			}
		}
	}

	public getRegisteredEntities(): Registerable[] {
		return Object.values(this._registry);
	}

	public *iterate<T extends Registerable>(type?: ConcreteOrAbstractConstructor<T>, persistent?: boolean): Generator<T> {
		for (const id in this._registry) {
			if (!type || this._registry[id] instanceof type) {
				if (!persistent || this._registry[id].registrypersistent) {
					yield this._registry[id] as T;
				}
			}
		}
	}

	public getRegisteredEntityIds(): Identifier[] {
		return Object.keys(this._registry);
	}

	public getRegisteredEntityIdsByType(wanted: string): Identifier[] {
		return this.getRegisteredEntities().filter(e => e.constructor.name === wanted).map(e => e.id);
	}

	public getRegisteredEntitiesByType(wanted: string): Registerable[] {
		return this.getRegisteredEntities().filter(e => e.constructor.name === wanted);
	}
}
