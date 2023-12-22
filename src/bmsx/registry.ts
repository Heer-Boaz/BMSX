import { Identifier, IIdentifiable } from "./bmsx";

export class Registry {
    private static _instance: Registry;
    private _registry: Map<Identifier, IIdentifiable>;
    public static get instance(): Registry {
        if (!Registry._instance) {
            Registry._instance = new Registry();
        }
        return Registry._instance;
    }

    constructor() {
        this._registry = new Map<Identifier, IIdentifiable>();
    }

    /**
     * Retrieves an entity from the registry based on its identifier.
     * @param id The identifier of the entity to retrieve.
     * @returns The retrieved entity if found, otherwise null.
     */
    public get<T extends IIdentifiable = any>(id: Identifier): T | null {
        return this._registry.get(id) as T || null;
    }

    /**
     * Checks if the model has the specified identifier.
     * @param id - The identifier to check.
     * @returns True if the model has the identifier, false otherwise.
     */
    public has(id: Identifier): boolean {
        return this._registry.has(id);
    }

    public register(entity: IIdentifiable) {
        this._registry.set(entity.id, entity);
    }

    public deregister(id: IIdentifiable | Identifier): boolean {
        const entityId = typeof id === 'string' ? id : id.id;
        return this._registry.delete(entityId);
    }

    public clear() {
        this._registry.clear();
    }

    public getRegisteredEntities(): IIdentifiable[] {
        return [...this._registry.values()];
    }

    public getRegisteredEntityIds(): Identifier[] {
        return [...this._registry.keys()];
    }

    public getRegisteredEntityIdsByType(type: string): Identifier[] {
        return this.getRegisteredEntities().filter(e => e.constructor.name === type).map(e => e.id);
    }

    public getRegisteredEntitiesByType(type: string): IIdentifiable[] {
        return this.getRegisteredEntities().filter(e => e.constructor.name === type);
    }
}