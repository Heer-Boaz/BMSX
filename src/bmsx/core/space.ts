import { type Identifier, vec3 } from '../rompack/rompack';
import { insavegame, excludepropfromsavegame, onload, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import { $ } from './game';
import { WorldObject } from './object/worldobject';
import { id2obj, id2objectType } from './world';
import { makeIndexProxy } from "../utils/utils";
export type initial_world_spaces = 'game_start' | 'default' | 'ui';

export interface SpaceObject {
    spaceid: Identifier;
    objects: WorldObject[];
}
export type id2spaceType = Record<Identifier, Space>;
export type obj_id2space_id_type = Record<Identifier, Identifier>;
export const id_to_space_symbol = Symbol('id2space');
export const obj_id_to_space_id_symbol = Symbol('obj_id2obj_space_id');// Optional per-object hooks for space transitions

@insavegame
/**
 * Represents a space in the game world, which contains a collection of game objects.
 */
export class Space  {
    /** Map-backed index of id → object (exposed via Proxy for back-compat). */
    public [id2obj]: id2objectType;
    @excludepropfromsavegame
    private _id2objMap: Map<Identifier, WorldObject>;

    // private static readonly CLASS_REGISTRATION_DONE = Symbol('class_registration_done');

    /**
     * Returns the WorldObject with the specified ID, or undefined if no such object exists in this space.
     * @template T - The type of the WorldObject to return.
     * @param {Identifier} id - The ID of the WorldObject to retrieve.
     * @returns {T | undefined} The WorldObject with the specified ID, or undefined if no such object exists in this space.
     */
    public get<T extends WorldObject>(id: Identifier): T | undefined {
        return this._id2objMap.get(id) as T | undefined;
    }

    public id: Identifier;

    @excludepropfromsavegame
    public objects: WorldObject[];

    /** Z-sort dirty flag. Mark on add/remove; renderer sorts when true. */
    @excludepropfromsavegame
    public depthSortDirty: boolean = true;

    /** Optional hooks per space lifecycle. */
    public activate?: () => void;
    public deactivate?: () => void;

    /**
     * A function that is called when the Space object is disposed of.
     * @type {() => void}
     */
    public dispose?: () => void;

    /**
     * Represents a space in the game world, which contains a collection of game objects.
     * @constructor
     * @param {Identifier} id - The unique identifier for the space.
     */
    public constructor(opts: RevivableObjectArgs & { id: Identifier }) {
        this.id = opts.id;
        this.objects = [];
        this._id2objMap = new Map<Identifier, WorldObject>();
        this[id2obj] = makeIndexProxy(this._id2objMap);
    }
    [Symbol.dispose](): void {
        throw new Error('Method not implemented.');
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
     * @param {WorldObject} o  - WorldObject to add
     * @param {vec3} pos - Position to spawn object
     * @param {boolean | { skipOnSpawn?: boolean; reason?: 'fresh' | 'revive' | 'transfer' }} options - Either a legacy boolean (skip), or an options object with a spawn reason.
     * Example uses include reviving the game (part of loading a saved game) and moving objects from one space to another.
     * @returns {void} Nothing
     */
    public spawn(o: WorldObject, pos?: vec3, options?: boolean | { skipOnSpawn?: boolean; reason?: 'fresh' | 'revive' | 'transfer' }): void {
        if (!o?.id) throw new Error(`Cannot spawn object '${o?.id ?? 'undefined'}' as it doesn't have a valid id!`);
        const world = $.world;
        if (world.objToSpaceMap?.has(o.id)) {
            console.error(`Cannot spawn object '${o.id}' in space '${this.id}' as it already exists in space '${world.objToSpaceMap.get(o.id)}'!`);
            return;
        }

        this.objects.push(o); // Add the object to the space

        this._id2objMap.set(o.id, o); // Register the object in the id→object map
        world.objToSpaceMap.set(o.id, this.id); // Register the object in the obj→space map
        world.onObjectSpawned(this, o);
        // Ensure we pass a full vec3 to onspawn (z defaults to 0)
        const spawnPos = pos ? { x: pos.x, y: pos.y, z: pos.z ?? 0 } : undefined;
        // BeginPlay: call onspawn once with an explicit reason; transfer/move paths pass skip=true.
        const skip = typeof options === 'boolean' ? options : options?.skipOnSpawn ?? false;
        const reason = (typeof options === 'object' && options !== null && !(options instanceof Boolean)) ? options.reason : undefined;
        if (!skip) { o.onspawn?.(spawnPos, { reason: reason ?? 'fresh' }); }

        // Mark depth sort dirty; if in a batch, collect space id once
        if (world.depthDirtyBatch) world.depthDirtyBatch.add(this.id); else this.depthSortDirty = true;
    }

    /**
     * Remove the object from this space and update indexes.
     * Note: This does not call o.dispose(); world-level destroy orchestrates full disposal.
     */
    protected disposeWorldObject(o: WorldObject, skip_ondespawn_event: boolean = false): void {
        const index = this.objects.indexOf(o);
        if (index < 0) throw new Error(`WorldObject ${o?.id ?? o} to remove from space '${this.id}' was not found, while calling [Space.despawn]!`);
        if (!skip_ondespawn_event) o.ondespawn?.();
        if (index > -1) this.objects.splice(index, 1);
        this._id2objMap.delete(o.id);
        const world = $.world;
        world.objToSpaceMap.delete(o.id);
        world.onObjectExiled(this, o);
        if (world.depthDirtyBatch) world.depthDirtyBatch.add(this.id); else this.depthSortDirty = true;
    }

    /**
     * Detach an object from this space without disposing it.
     * Event handling is disabled on the object, but it remains in the Registry
     * so pooled workflows can reuse it without reallocations.
     */
    public despawn(o: WorldObject, skip_ondespawn_event: boolean = false): void {
        

        this.disposeWorldObject(o, skip_ondespawn_event);
    }

    /**
     * Detach all objects from this space and update indexes. Does not dispose objects.
     * World.clearAllSpaces() performs disposal once for each unique object.
     */
    public clear(): void {
        for (const o of this.objects) this.despawn(o, false);
        this.depthSortDirty = false;
    }

    /** Rebind internal maps and world indexes after revive. */
    @onload
    public onloadSetup(): void {
        // Rebuild fast id → object map from revived objects array
        this._id2objMap.clear();
        for (const o of (this.objects ?? [])) {
            this._id2objMap.set(o.id, o);
            // Register object → space mapping and per-space indexes in world
            $.world.objToSpaceMap.set(o.id, this.id);
            $.world.onObjectSpawned(this, o);
        }
        this.depthSortDirty = true;
    }
}
