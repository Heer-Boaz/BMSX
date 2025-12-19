import { type Identifier, vec3 } from '../rompack/rompack';
import { insavegame, excludepropfromsavegame, onload, type RevivableObjectArgs } from '../serializer/serializationhooks';
import { $ } from './engine_core';
import { WorldObject } from './object/worldobject';
import type { SpawnReason } from './world';
import { DEFAULT_ZCOORD } from '../render/backend/webgl/webgl.constants';
export type initial_world_spaces = 'game_start' | 'default' | 'ui';

@insavegame
/**
 * Represents a space in the game world, which contains a collection of game objects.
 */
export class Space {
	@excludepropfromsavegame
	private readonly objectsById: Map<Identifier, WorldObject>;

	// private static readonly CLASS_REGISTRATION_DONE = Symbol('class_registration_done');

	/**
	 * Returns the WorldObject with the specified ID, or undefined if no such object exists in this space.
	 * @template T - The type of the WorldObject to return.
	 * @param {Identifier} id - The ID of the WorldObject to retrieve.
	 * @returns {T} The WorldObject with the specified ID, or undefined if no such object exists in this space.
	 */
	public get<T extends WorldObject>(id: Identifier): T {
		return this.objectsById.get(id) as T;
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
		this.objectsById = new Map<Identifier, WorldObject>();
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
		this.objects.sort((a, b) => (a.z ?? DEFAULT_ZCOORD) - (b.z ?? DEFAULT_ZCOORD));
	}

	/**
	 * Adds object to the game and triggers it's onspawn-event.
	 * @param {WorldObject} o  - WorldObject to add
	 * @param {vec3} pos - Position to spawn object
	 * @param {boolean | { skipOnSpawn?: boolean; reason?: SpawnReason }} opts - Either a legacy boolean (skip), or an options object with a spawn reason.
	 * Example uses include reviving the game (part of loading a saved game) and moving objects from one space to another.
	 * @returns {void} Nothing
	 */
	public spawn(o: WorldObject, pos?: vec3, opts?: { skipOnSpawn?: boolean; reason?: SpawnReason }): void {
		if (!o?.id) throw new Error(`Cannot spawn object '${o?.id ?? 'undefined'}' as it doesn't have a valid id!`);
		const world = $.world;
		if (world.objToSpaceMap.has(o.id) && opts?.reason === 'fresh') {
			const existingSpaceId = world.objToSpaceMap.get(o.id);
			throw new Error(`Cannot spawn object '${o.id}' in space '${this.id}' because it already exists in space '${existingSpaceId}'.`);
		}

		this.objects.push(o); // Add the object to the space

		this.objectsById.set(o.id, o); // Register the object in the id→object map
		world.objToSpaceMap.set(o.id, this.id); // Register the object in the obj→space map
		world.onObjectSpawned(this, o);
		// Ensure we pass a full vec3 to onspawn (z defaults to 0)
		const spawnPos = pos ? { x: pos.x, y: pos.y, z: pos.z } : undefined;
		// BeginPlay: call onspawn once with an explicit reason; transfer/move paths pass skip=true.
		const skip = opts?.skipOnSpawn ?? false;
		const reason = (typeof opts === 'object' && opts !== null && !(opts instanceof Boolean)) ? opts.reason : undefined;
		if (!skip) { o.onspawn?.(spawnPos, { reason: reason ?? 'fresh' }); }
		world.dispatchWorldLifecycleSlot(o, 'spawn', {
			world,
			spaceId: this.id,
			reason: reason ?? 'fresh',
			position: spawnPos,
		});

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
		const world = $.world;
		if (!skip_ondespawn_event) o.ondespawn?.();
		world.dispatchWorldLifecycleSlot(o, 'despawn', {
			world,
			spaceId: this.id,
			reason: skip_ondespawn_event ? 'transfer' : 'despawn',
		});
		if (index > -1) this.objects.splice(index, 1);
		this.objectsById.delete(o.id);
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
		for (let index = this.objects.length - 1; index >= 0; index--) {
			const object = this.objects[index]!;
			this.despawn(object, false);
		}
		this.depthSortDirty = false;
	}

	/** Rebind internal maps and world indexes after revive. */
	@onload
	public onloadSetup(): void {
		// Rebuild fast id → object map from revived objects array
		this.objectsById.clear();
		if (!this.objects) throw new Error(`[Space:${this.id}] objects array is undefined during onloadSetup.`);
		for (const o of this.objects) {
			this.objectsById.set(o.id, o);
			// Register object → space mapping and per-space indexes in world
			$.world.objToSpaceMap.set(o.id, this.id);
			$.world.onObjectSpawned(this, o);
		}
		this.depthSortDirty = true;
	}
}
