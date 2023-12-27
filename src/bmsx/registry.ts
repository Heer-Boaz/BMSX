import { Identifier, IRegisterable } from "./game";

export class Registry {
    private static _instance: Registry;
    private _registry: Record<Identifier, IRegisterable>;
    public static get instance(): Registry {
        if (!Registry._instance) {
            Registry._instance = new Registry();
        }
        return Registry._instance;
    }

    // public static get registry(): Record<string, IRegisterable> {
    //     return new Proxy(Registry.instance._registry, {
    //         get: function (target, prop: string) {
    //             // prop is expected to be an Identifier
    //             return target[prop] || null;
    //         }
    //     });
    // }

    constructor() {
        this._registry = {};
    }

    /**
     * Retrieves an entity from the registry based on its identifier.
     * @param id The identifier of the entity to retrieve.
     * @returns The retrieved entity if found, otherwise null.
     */
    public get<T extends IRegisterable = any>(id: Identifier): T | null {
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

    public register(entity: IRegisterable) {
        this._registry[entity.id] = entity;
    }

    public deregister(id: IRegisterable | Identifier): boolean {
        const entity_id = typeof id === 'string' ? id : id.id;
        return delete this._registry[entity_id];
    }

    public clear() {
        this._registry = {};
    }

    public getRegisteredEntities(): IRegisterable[] {
        return Object.values(this._registry);
    }

    public getRegisteredEntityIds(): Identifier[] {
        return Object.keys(this._registry);
    }

    public getRegisteredEntityIdsByType(type: string): Identifier[] {
        return this.getRegisteredEntities().filter(e => e.constructor.name === type).map(e => e.id);
    }

    public getRegisteredEntitiesByType(type: string): IRegisterable[] {
        return this.getRegisteredEntities().filter(e => e.constructor.name === type);
    }
}