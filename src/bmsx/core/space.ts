import { type Identifier, Vector } from '../rompack/rompack';
import { insavegame, excludepropfromsavegame } from '../serializer/gameserializer';
import { $ } from './game';
import { GameObject } from './object/gameobject';
import { id2obj, id2objectType, World, makeIndexProxy } from './world';
export type initial_world_spaces = 'game_start' | 'default' | 'ui';

@insavegame
/**
 * Represents a space in the game world, which contains a collection of game objects.
 */
export class Space {
    /** Map-backed index of id → object (exposed via Proxy for back-compat). */
    public [id2obj]: id2objectType;
    @excludepropfromsavegame
    private _id2objMap: Map<Identifier, GameObject>;

    /**
     * Returns the GameObject with the specified ID, or undefined if no such object exists in this space.
     * @template T - The type of the GameObject to return.
     * @param {Identifier} id - The ID of the GameObject to retrieve.
     * @returns {T | undefined} The GameObject with the specified ID, or undefined if no such object exists in this space.
     */
    public get<T extends GameObject>(id: Identifier): T | undefined {
        return this._id2objMap.get(id) as T | undefined;
    }

    public id: Identifier;

    @excludepropfromsavegame
    public objects: GameObject[];

    /** Z-sort dirty flag. Mark on add/remove; renderer sorts when true. */
    @excludepropfromsavegame
    public depthSortDirty: boolean = true;

    /** Optional hooks per space lifecycle. */
    public onactivate?: () => void;
    public ondeactivate?: () => void;

    /**
     * A function that is called when the Space object is disposed of.
     * @type {() => void}
     */
    public ondispose?: () => void;

    // Decouple from global `$`: prefer injected model; fallback to $world.
    @excludepropfromsavegame
    private _model?: World;
    public bindModel(m: World): void { this._model = m; }

    /**
     * Represents a space in the game world, which contains a collection of game objects.
     * @constructor
     * @param {Identifier} id - The unique identifier for the space.
     */
    public constructor(id: Identifier) {
        this.id = id;
        this.objects = [];
        this._id2objMap = new Map<Identifier, GameObject>();
        this[id2obj] = makeIndexProxy(this._id2objMap);
    }

    /**
     * Sorts the objects in the space by their depth (z-coordinate).
     * Objects with a lower z-coordinate will be drawn first, and objects with a higher z-coordinate will be drawn on top of them.
     * @returns {void} Nothing
     */
    public sort_by_depth(): void {
        this.depthSortDirty = false;
        this.objects.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    }

    /**
     * Adds object to the game and triggers it's onspawn-event.
     * @param {GameObject} o  - GameObject to add
     * @param {Vector} pos - Position to spawn object
     * @param {boolean} skip_onspawn_event - Disables triggering onspawn-event.
     * Example uses include reviving the game (part of loading a saved game) and moving objects from one space to another.
     * @returns {void} Nothing
     */
    public spawn(o: GameObject, pos?: Vector, skip_onspawn_event?: boolean): void {
        if (!o?.id) throw new Error(`Cannot spawn object '${o?.id ?? 'undefined'}' as it doesn't have a valid id!`);
        const model = this._model ?? $.world;
        if (model.objToSpaceMap?.has(o.id)) {
            console.error(`Cannot spawn object '${o.id}' in space '${this.id}' as it already exists in space '${model.objToSpaceMap.get(o.id)}'!`);
            return;
        }

        this.objects.push(o); // Add the object to the space

        this._id2objMap.set(o.id, o); // Register the object in the id→object map
        model.objToSpaceMap.set(o.id, this.id); // Register the object in the obj→space map
        model.onObjectSpawned(this, o);
        // Ensure we pass a full vec3 to onspawn (z defaults to 0)
        const spawnPos = pos ? { x: pos.x, y: pos.y, z: pos.z ?? 0 } : undefined;
        !skip_onspawn_event && o.onspawn?.(spawnPos); // Trigger onspawn after adding the object to the space

        // Mark depth sort dirty; if in a batch, collect space id once
        if (model.depthDirtyBatch) model.depthDirtyBatch.add(this.id); else this.depthSortDirty = true;
    }

    /**
     * Removes object from the game and triggers it's ondispose-event.
     * @param {GameObject} o  - GameObject to dispose
     * @param {boolean} skip_ondispose_event - Disables triggering ondispose-event.
     * Example uses include moving objects from one space to another.
     * @returns {void} Nothing
     */
    public exile(o: GameObject, skip_ondispose_event: boolean = false): void {
        const index = this.objects.indexOf(o);
        if (index < 0) throw new Error(`GameObject ${o?.id ?? o} to remove from space '${this.id}' was not found, while calling [Model.exile]!`);
        !skip_ondispose_event && o.dispose?.(); // Trigger ondispose event before removing the object from the space. `ondispose` unsubscribes the object from events and removes it from the registry
        if (index > -1) this.objects.splice(index, 1);
        this._id2objMap.delete(o.id);
        const model = this._model ?? $.world;
        model.objToSpaceMap.delete(o.id);
        model.onObjectExiled(this, o);
        if (model.depthDirtyBatch) model.depthDirtyBatch.add(this.id); else this.depthSortDirty = true;
    }

    /**
     * Removes all objects from the current space and triggers their ondispose-event.
     * @returns {void} Nothing
     */
    public clear(): void {
        const model = this._model ?? $.world;
        for (const o of this.objects) {
            model.onObjectExiled(this, o);
            o.dispose?.();
            model.objToSpaceMap.delete(o.id);
        }
        this._id2objMap.clear();
        this.objects.length = 0;
        this.depthSortDirty = false;
    }
}
export interface SpaceObject {
    spaceid: Identifier;
    objects: GameObject[];
}
export type id2spaceType = Record<Identifier, Space>;
export type obj_id2space_id_type = Record<Identifier, Identifier>;
export const spaceid_2_space = Symbol('id2space');
export const objid_2_objspaceid = Symbol('obj_id2obj_space_id');// Optional per-object hooks for space transitions
interface SpaceAware { onleaveSpace?(from: Identifier): void; onenterSpace?(to: Identifier): void; }
export function isSpaceAware(x: unknown): x is SpaceAware {
    return !!x && typeof x === 'object' && ('onleaveSpace' in (x as any) || 'onenterSpace' in (x as any));
}
