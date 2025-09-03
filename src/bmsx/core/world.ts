import { BehaviorTreeDefinition, BehaviorTreeDefinitions, BehaviorTreeID, setup_bt_library, setup_btdef_library } from "../ai/behaviourtree";
import { BehaviorTreeSystem, BoundarySystem, ECSystemManager, MeshAnimationSystem, PhysicsCollisionEventSystem, PhysicsPostSystem, PhysicsSyncAfterWorldCollisionSystem, PhysicsSyncBeforeStepSystem, PrePositionSystem, StateMachineSystem, TickGroup, TileCollisionSystem, TransformSystem } from "../ecs/system";
import { StateMachineController } from "../fsm/fsmcontroller";
import { StateDefinitions, setupFSMlibrary } from "../fsm/fsmlibrary";
import { Stateful } from "../fsm/fsmtypes";
import { State } from '../fsm/state';
import { StateDefinition } from '../fsm/statedefinition';
import { AbilityRuntimeSystem } from "../gas/abilityruntime";
import { TaskRuntimeSystem } from "../gas/tasks";
import { Input } from "../input/input";
import { PhysicsDescriptorComponent } from '../physics/physicsdescriptorcomponent';
import { CollisionEvent, PhysicsWorld } from '../physics/physicsworld';
import { Camera } from '../render/3d/camera3d';
import { renderGate } from '../render/view';
import type { Identifier, Registerable, RegisterablePersistent } from '../rompack/rompack';
import { Direction, Vector } from "../rompack/rompack";
import { BinaryCompressor } from "../serializer/bincompressor";
import { Reviver, Savegame, Serializer, excludepropfromsavegame, insavegame } from "../serializer/gameserializer";
import { CameraObject } from './cameraobject';
import { $, runGate } from './game';
import { GameObject } from './gameobject';
import { AmbientLightObject, LightObject } from './lightobject';
import { Registry } from "./registry";
import type { Component, ComponentConstructor } from "../component/basecomponent";

export interface SpaceObject {
    spaceid: Identifier;
    objects: GameObject[];
}
// Backwards-compatible index proxies: runtime uses Map for performance, while
// external code can still index with [id] due to Proxy handling.
export type id2objectType = Record<Identifier, GameObject>;
export type id2spaceType = Record<Identifier, Space>;
export type obj_id2space_id_type = Record<Identifier, Identifier>;
export const id2obj = Symbol('id2object');
export const spaceid_2_space = Symbol('id2space');
export const objid_2_objspaceid = Symbol('obj_id2obj_space_id');

// Services and plugin types
export interface TileCollisionService {
    collidesWithTile(o: GameObject, dir: Direction): boolean;
    isCollisionTile(x: number, y: number): boolean;
}
export type ModelPlugin = { onBoot: (model: World) => void; onTick?: (model: World, dt: number) => void; onLoad?: (model: World) => void; dispose?: () => void };

// Optional per-object hooks for space transitions
interface SpaceAware { onleaveSpace?(from: Identifier): void; onenterSpace?(to: Identifier): void; }
function isSpaceAware(x: unknown): x is SpaceAware {
    return !!x && typeof x === 'object' && ('onleaveSpace' in (x as any) || 'onenterSpace' in (x as any));
}

// Utility: wrap a Map so `mapLike['id']` resolves to `map.get('id')` and
// assignments delete/set through the same surface. Also exposes standard Map
// methods bound to the underlying map.
function makeIndexProxy<V>(backing: Map<Identifier, V>): any {
    return new Proxy(backing, {
        get(target, prop, receiver) {
            // Expose Map API (bound) for internal use
            if (prop === 'get') return (target.get).bind(target);
            if (prop === 'set') return (target.set).bind(target);
            if (prop === 'has') return (target.has).bind(target);
            if (prop === 'delete') return (target.delete).bind(target);
            if (prop === 'clear') return (target.clear).bind(target);
            if (prop === 'size') return (target.size);
            if (prop === Symbol.iterator) return (target[Symbol.iterator]).bind(target);
            if (prop === 'entries') return (target.entries).bind(target);
            if (prop === 'keys') return (target.keys).bind(target);
            if (prop === 'values') return (target.values).bind(target);
            if (prop === 'forEach') return (target.forEach).bind(target);
            // Map-like index access: proxy['id'] → map.get('id')
            if (typeof prop === 'string') return target.get(prop as unknown as Identifier);
            // Fallback to default behavior
            return Reflect.get(target as any, prop, receiver);
        },
        set(target, prop, value) {
            if (typeof prop === 'string') { target.set(prop as unknown as Identifier, value as V); return true; }
            (target as any)[prop as any] = value;
            return true;
        },
        has(target, prop) {
            if (typeof prop === 'string') return target.has(prop as unknown as Identifier);
            return prop in (target as any);
        },
        deleteProperty(target, prop) {
            if (typeof prop === 'string') return target.delete(prop as unknown as Identifier);
            delete (target as any)[prop as any];
            return true;
        },
    });
}

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

    // Decouple from global `$`: prefer injected model; fallback to $.model.
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
        const model = this._model ?? $.model;
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
        const model = this._model ?? $.model;
        model.objToSpaceMap.delete(o.id);
        model.onObjectExiled(this, o);
        if (model.depthDirtyBatch) model.depthDirtyBatch.add(this.id); else this.depthSortDirty = true;
    }

    /**
     * Removes all objects from the current space and triggers their ondispose-event.
     * @returns {void} Nothing
     */
    public clear(): void {
        const model = this._model ?? $.model;
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

export type base_model_spaces = 'game_start' | 'default';

@insavegame
/**
 * The base model class for the game. Contains all the spaces and objects in the game world.
 * Provides methods to add, remove, and manipulate game objects and spaces.
 */
export class World implements Stateful, RegisterablePersistent {
    get registrypersistent(): true {
        return true;
    }

    /**
     * Retrieves an entity from the registry based on its identifier.
     * @param id The identifier of the entity to retrieve.
     * @returns The retrieved entity if found, otherwise null.
     */
    public get<T extends Registerable = any>(id: Identifier): T | null {
        return $.registry.get(id);
    }

    public get id(): Identifier { return 'model'; } // Required for IStateful and IIdentifiable

    // Internal physics diagnostic frame counter (temporary instrumentation)
    private static _physDiagFrames?: number;

    /**
     * An array of keys to exclude from the serialized game state when saving the game.
     * These keys include references to objects and spaces that should not be saved.
     */
    public static readonly keys_to_exclude_from_save = [
        'objects',
        'id2object',
        'spaces',
        'id2space',
        'obj_id2obj_space_id',
        'registry',
    ];

    /**
     * The controller for the state machine.
     */
    public sc: StateMachineController;

    /** ECS systems runner */
    @excludepropfromsavegame
    public systems: ECSystemManager = new ECSystemManager();

    /**
     * An object that maps space IDs to their corresponding Space objects.
     * @type {id2spaceType}
     */
    public [spaceid_2_space]: id2spaceType;
    @excludepropfromsavegame
    public _spaceMap: Map<Identifier, Space>;
    /**
     * An object that maps object IDs to their corresponding space IDs.
     * @type {obj_id2space_id_type}
     */
    public [objid_2_objspaceid]: obj_id2space_id_type;
    @excludepropfromsavegame
    public objToSpaceMap: Map<Identifier, Identifier>;

    /**
     * Gets all game objects in the current space.
     * @returns {GameObject[]} An array of all game objects in the current space.
     */
    public get objects(): GameObject[] {
        return this.currentSpace.objects;
    }

    public spaces: Space[]; // All spaces in the model
    protected currentSpaceid: Identifier; // Current space. On model creation, a default space is created with id 'default'
    public get current_space_id(): Identifier { return this.currentSpaceid; } // Current space id. On model creation, a default space is created with id 'default'
    public get currentSpace(): Space { return this.get_space(this.currentSpaceid); } // Current space. On model creation, a default space is created with id 'default'
    // setSpace implemented later with activation hooks
    public get_space<T extends Space>(id: Identifier) { return this._spaceMap.get(id) as T; }

    public paused: boolean;
    public startAfterLoad: boolean;

    private _activeCameraId: Identifier | null = null;

    public get activeCameraId(): Identifier | null {
        return this._activeCameraId;
    }

    public set activeCameraId(id: Identifier | null) {
        this._activeCameraId = id; // Set the active camera ID, which can be null if no camera is active
    }

    public get activeCameraObject(): CameraObject | null {
        return this.activeCameraId ? this.getGameObject<CameraObject>(this.activeCameraId) : null;
    }

    public get activeCamera3D(): Camera | null {
        const co = this.activeCameraId ? this.getGameObject<CameraObject>(this.activeCameraId) : null;
        return co?.camera ?? null;
    }

    // Indexed cameras/lights for fast queries
    @excludepropfromsavegame private _camerasBySpace: Map<Identifier, Set<CameraObject>> = new Map();
    @excludepropfromsavegame private _lightsBySpace: Map<Identifier, Set<LightObject>> = new Map();
    // Batch depth marker: when non-null, collect touched space ids and mark once at end
    @excludepropfromsavegame public depthDirtyBatch: Set<Identifier> | null = null;

    public get cameras(): CameraObject[] {
        const out: CameraObject[] = [];
        for (const [, set] of this._camerasBySpace) for (const c of set) out.push(c);
        return out;
    }
    public getCameras(opts: { scope?: 'current' | 'all' } = {}): CameraObject[] {
        const scope = opts.scope ?? 'all';
        const out: CameraObject[] = [];
        if (scope === 'current') {
            const set = this._camerasBySpace.get(this.currentSpaceid);
            if (!set) return out;
            for (const c of set) out.push(c);
            return out;
        }
        for (const [, set] of this._camerasBySpace) for (const c of set) out.push(c);
        return out;
    }

    /**
     * Register a default pipeline of systems to replicate legacy behavior in a standard ECS loop.
     * Order: Pre(position), BehaviorTrees, StateMachines, Post(position)
     */
    public setupDefaultSystems(): void {
        const SM = this.systems;
        SM.clear();
        // Priorities create a stable order across all systems within each TickGroup
        SM.register(new PrePositionSystem(10));
        SM.register(new BehaviorTreeSystem(20));
        SM.register(new MeshAnimationSystem(25));
        SM.register(new StateMachineSystem(30));
        // Ability runtime (advance effects/coroutines) after object state machines
        SM.register(new AbilityRuntimeSystem(32));
        // Task runtime (world/actor cutscenes/behaviors)
        SM.register(new TaskRuntimeSystem(33));
        // Sync GO -> body after abilities, before physics step
        SM.register(new PhysicsSyncBeforeStepSystem(34));
        SM.register(new PhysicsPostSystem(35));
        // Resolve world-space collisions first, then screen boundary events
        SM.register(new TileCollisionSystem(10));
        SM.register(new BoundarySystem(20));
        SM.register(new PhysicsCollisionEventSystem(28)); // dispatch physics collisions as engine events
        SM.register(new PhysicsSyncAfterWorldCollisionSystem(30)); // GO -> body (if writeBack)
        SM.register(new TransformSystem(50));

    }

    public getActiveLights(opts: { scope?: 'current' | 'all' } = {}): LightObject[] {
        const scope = opts.scope ?? 'all';
        const out: LightObject[] = [];
        if (scope === 'current') {
            const set = this._lightsBySpace.get(this.currentSpaceid);
            if (!set) return out;
            for (const l of set) if (l.active) out.push(l);
            return out;
        }
        for (const [, set] of this._lightsBySpace) for (const l of set) if (l.active) out.push(l);
        return out;
    }

    public get ambientLight(): AmbientLightObject | null {
        return this.getActiveLights().find(light => light.type === 'ambient') as AmbientLightObject | null;
    }

    /**
     * Gets the game object with the given id from the current space only.
     * @param {Identifier} id - the id of the {@link GameObject}.
     * @returns {T} The game object with the given id from the current space only.
     */
    public getFromCurrentSpace<T extends GameObject>(id: Identifier): T | null { return this.currentSpace.get<T>(id) ?? null; }

    /**
     * Gets the game object with the given id across all spaces.
     * If `id === 'model'`, returns the game model instead! This is used for {@link State} to make game model as target for callbacks.
     * @param {Identifier} id - the id of the {@link GameObject}.
     * @returns {T | null} The object with the given id or the game model itself (when `id === 'model'`), or null if the object is not found.
     */
    public getGameObject<T extends GameObject = GameObject>(id: Identifier): T | null {
        const sid = this.objToSpaceMap.get(id);
        if (!sid) return null;
        const space = this.get_space(sid);
        return space?.get<T>(id) ?? null;
    }

    /**
     * Returns true if an object exists **in any space** with the given object id.
     * @param {Identifier} obj_id The id of the object that we want to know whether it exists.
     * @returns {boolean} Whether an object was found _in any space_ with the given object id.
     */
    public exists(obj_id: Identifier): boolean {
        return this.getGameObject(obj_id) ? true : false;
    }

    /**
     * Returns the id of the space that contains the object with the given id.
     * @param {Identifier} obj_id - The id of the object to search for.
     * @returns {Identifier} The id of the space that contains the object with the given id.
     */
    public get_spaceid_that_has_obj(obj_id: Identifier): Identifier { return this.objToSpaceMap.get(obj_id)!; }

    /**
     * Returns true if the object with the given id is in the current space.
     * @param {Identifier} obj_id - The id of the object to check.
     * @returns {boolean} Whether the object with the given id is in the current space.
     */
    public is_obj_in_current_space(obj_id: Identifier): boolean {
        return this.get_spaceid_that_has_obj(obj_id) === this.currentSpaceid;
    }

    /**
     * Moves an object from one space to another. Object should exist in a space, otherwise error is thrown!
     * @param {Identifier} obj_id - id of object to move.
     * @param {Identifier} spaceid_to_move_obj_to - id of the new space of the object to move.
     * @returns {void} Nothing
     */
    public move_obj_to_space(obj_id: Identifier, spaceid_to_move_obj_to: Identifier): void {
        const obj = this.getGameObject<GameObject>(obj_id);
        if (!obj) throw Error(`Cannot move unknown object '${obj_id}' to space '${spaceid_to_move_obj_to}'!`);
        const target_space = this.get_space(spaceid_to_move_obj_to);
        if (!target_space) throw Error(`Cannot move object '${obj_id}' to unknown space '${spaceid_to_move_obj_to}'!`);
        const fromSid = this.objToSpaceMap.get(obj_id);
        if (!fromSid) return; // Already absent
        const origin_space = this.get_space(fromSid);
        origin_space.exile(obj, true);
        target_space.spawn(obj, null, true);
    }

    /**
     * Atomically transfer an object between spaces and update all indexes.
     * If opts.suppressLifecycleHooks is true, spawn/leave hooks are suppressed.
     */
    public transfer(o: GameObject, to: Space | Identifier, opts?: { suppressLifecycleHooks?: boolean }): void {
        const toSpace = (to instanceof Space) ? to : this.get_space(to);
        if (!toSpace) throw new Error(`transfer: target space not found`);
        const fromSid = this.objToSpaceMap.get(o.id);
        const from = fromSid ? this.get_space(fromSid) : null;
        if (!from || from === toSpace) return;
        const suppress = opts?.suppressLifecycleHooks ?? true;
        from.exile(o, suppress);
        toSpace.spawn(o, undefined, suppress);
        if (isSpaceAware(o)) { o.onleaveSpace?.(from.id); o.onenterSpace?.(toSpace.id); }
    }

    /**
     * Moves the object with the specified ID to the current space.
     *
     * @param obj_id - The identifier of the object to be moved.
     */
    public move_obj_to_current_space(obj_id: Identifier): void {
        this.move_obj_to_space(obj_id, this.currentSpaceid);
    }

    /**
     * Returns the machine definition for the given machine id.
     * @param {Identifier} machineid - The id of the machine to get the definition for.
     * @returns {StateDefinition} The machine definition for the given machine id.
     */
    public static getMachinedef(machineid: Identifier): StateDefinition {
        return StateDefinitions[machineid];
    }

    /**
     * Returns the state definition for the given machine and state id.
     * @param {Identifier} machineid - The id of the machine to get the state definition for.
     * @param {Identifier} stateid - The id of the state to get the definition for.
     * @returns {StateDefinition} The state definition for the given machine and state id.
     */
    public static getMachineStatedef(machineid: Identifier, stateid: Identifier): StateDefinition {
        const m = StateDefinitions[machineid] as any;
        const s = m?.states?.[stateid] ?? m?.[stateid];
        if (!s) throw new Error(`Unknown state ${String(machineid)}.${String(stateid)}`);
        return s as StateDefinition;
    }

    public static getBTdef(btid: BehaviorTreeID): BehaviorTreeDefinition {
        return BehaviorTreeDefinitions[btid];
    }

    // Model configuration (size, services, plugins)
    private _size: { width: number; height: number } = { width: 256, height: 192 };
    private _collision?: TileCollisionService;
    private _plugins: Array<ModelPlugin> = [];
    private _fsmId: string = 'model';

    public get gamewidth(): number { return this._size.width; }
    public get gameheight(): number { return this._size.height; }

    private static readonly MAX_ID_NUMBER = Number.MAX_SAFE_INTEGER; // 53-bit monotonic id space
    protected idCounter = 0;

    public getNextIdNumber(): number {
        if (this.idCounter >= World.MAX_ID_NUMBER) {
            throw new Error('ID counter exhausted: max safe integer reached');
        }
        const nextNumber = this.idCounter;
        this.idCounter = this.idCounter + 1;
        return nextNumber;
    }

    /** **DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!**
     *
     * _Trying to add logic here will most often result in runtime errors!_
     * These runtime errors usually occur because the model was not created and initialized (with states),
     * while creating new game objects that reference the model or the model states
     */
    constructor(opts?: { size?: { width: number; height: number }, collision?: TileCollisionService, plugins?: Array<ModelPlugin>, fsmId?: string }) {
        Registry.instance.register(this);
        this.spaces = [];
        this._spaceMap = new Map<Identifier, Space>();
        this[spaceid_2_space] = makeIndexProxy(this._spaceMap);
        this.objToSpaceMap = new Map<Identifier, Identifier>();
        this[objid_2_objspaceid] = makeIndexProxy(this.objToSpaceMap);

        this.paused = false;
        if (opts?.size) this._size = { ...opts.size };
        if (opts?.collision) this._collision = opts.collision;
        if (opts?.plugins) this._plugins = opts.plugins.slice();
        if (opts?.fsmId) this._fsmId = opts.fsmId;
        // Initialize default ECS pipeline
        this.setupDefaultSystems();
    }

    public init_on_boot(): void {
        World.setup_fsmdef_library();
        World.setup_bt_library();
        this.init_event_subscriptions().init_spaces().init_model_state_machines();
        // Plugins boot hooks (explicit lifecycle; no property chaining)
        for (const p of this._plugins) p.onBoot(this);
    }

    public dispose(): void {
        // Clear all spaces and objects
        this.clearAllSpaces();
        // Dispose the state machine controller and deregister all state machines
        this.sc.dispose();
        // Unsubscribe from all events
        $.event_emitter.removeSubscriber(this);
        // Dispose plugins
        for (const p of this._plugins) p.dispose?.();
        $.registry.deregister(this);
    }

    public init_event_subscriptions(): World {
        $.event_emitter.initClassBoundEventSubscriptions(this);
        return this; // Return the current instance of the World for chaining
    }

    /**
     * Initializes the spaces for the model. This method should only be executed when the model is not being revived.
     * Adds the 'default' and 'game_start' spaces to the model and sets the current space to 'game_start'.
     * @returns {World} The current instance of the World.
     */
    public init_spaces(): World { // Should only be executed when model is *not* revived
        this.addSpace('default' satisfies base_model_spaces);
        this.addSpace('game_start' satisfies base_model_spaces);
        this.setSpace('game_start' satisfies base_model_spaces);

        return this; // Return the current instance of the World for chaining
    }

    /**
     * Sets up the finite state machine definition library for the `World` class.
     * This method should only be called once during the initialization of the `World` class.
     * @returns {void} Nothing.
     */
    private static setup_fsmdef_library(): void {
        setupFSMlibrary();
    }

    private static setup_bt_library(): void {
        setup_btdef_library();
        setup_bt_library();
    }

    /**
     * Returns the constructor name of the specific derived class that extends this `World`.
     * Required during game initialization where @see {@link init_model_state_machines} is called.
     * @see {@link this.init_model_state_machines}
     */
    public get constructor_name(): string { return this._fsmId; }

    /**
    * Init model after construction. Needed as the states have not been build at
    * the constructor's scope yet. So, this is a kind of `onspawn` for the model.
    *
    * Each derived model class should override @see {@link World.constructor_name} to get the proper constructor classname of that derived model class. We need the exact classname in order to map a state machine definition to an instance of an object.
    * @param {string} `derived_modelclass_constructor_name` - the constructor name of the derived modelclass (that derives from this World.
    */
    public init_model_state_machines(): this {
        this.sc = new StateMachineController(this._fsmId ?? 'model', this.id);
        this.sc.start(); // Start the state machine controller (this will start all state machines that are added to the controller) and transition to the default state of the model, and subscribe to all events that are defined in the state machine definitions

        return this; // Return the current instance of the World for chaining
    }

    /** Use this function for initializing spaces, global/static game objects, ...
    * Is automagically called from {@link Game} and expects the model to be created and its state machines populated.
    *
    * **Notes:**
    * 1. Use the state `game_start` to transition to the state in which the game will start after it started running and
    * not this function.**
    * 2. Game is not expected to be running yet.
    * @returns {this} `this` for chaining.
     */
    // Back-compat no-op; prefer plugins for boot logic
    public do_one_time_game_init(): this { return this; }

    /**
     * Runs the current state of the model by calling the `run` method of the current state.
     * @returns {void} Nothing.
     */
    public run(deltaTime: number): void {
        this.sc.tick(); // model-level state machine first

        // Phase 1: PrePhysics + Simulation (BT, Anim, Object FSM, AbilityRuntime)
        this.systems.updateUntil(this, TickGroup.Simulation);

        // Physics step & event collection (dispatch moved to an ECS system)
        const phys = $.registry.get<PhysicsWorld>('physics_world');
        if (phys) {
            const collisionEvents: CollisionEvent[] = [];
            phys.step(deltaTime, (evt) => collisionEvents.push(evt));
            World._physDiagFrames = World._physDiagFrames ?? 0;
            if (World._physDiagFrames < 5) {
                const firstDyn = phys.getBodies().find(b => b.invMass && !b.isTrigger);
                if (firstDyn) console.log('[PhysStep]', 'dt=', deltaTime, 'pos=', firstDyn.position, 'vel=', firstDyn.velocity, 'grav=', 'getGravity' in phys ? phys.getGravity() : 'n/a');
                World._physDiagFrames++;
            }
            if (collisionEvents.length) this._physicsEventQueue.push(...collisionEvents);
        }

        // Phase 2: PostPhysics + PreRender
        this.systems.updateFrom(this, TickGroup.PostPhysics);

        // Plugin tick hooks
        for (const p of this._plugins) p.onTick?.(this, deltaTime);

        // Cleanup disposed objects
        const objects = this.objects;
        for (let i = objects.length - 1; i >= 0; --i) {
            const o = objects[i];
            if (o.disposeFlag) this.exile(o);
        }
    }

    /**
     * The default input handler for allowing the game menu to be opened.
     * If the F5 key is pressed, the game menu substate is set to 'open'.
     * @param {World} this - The current instance of the World.
     * @param {State<World>} s - The current state of the World.
     * @returns {void} Nothing.
     */
    static default_input_handler_for_allow_open_gamemenu(this: World): void {
        if (Input.KC_F5) {
            this.sc.machines.gamemenu.transition_to('open');
        }
    }

    /**
     * The default input handler for allowing the game menu to be closed.
     * If the F5 key is pressed, the game menu substate is set to 'closed'.
     * @param {World} this - The current instance of the World.
     * @param {State<World>} s - The current state of the World.
     * @returns {void} Nothing.
     */
    static default_input_handler_for_allow_close_gamemenu(this: World): void {
        if (Input.KC_F5) {
            this.sc.machines.gamemenu.transition_to('closed');
        }
    }

    static default_input_handler(this: World) {
    }

    /**
     * Loads a serialized game state and applies it to the current model instance.
     * Clears all spaces and removes all objects from the model instance before loading the new state.
     * @param {string} serialized - The serialized game state to load.
     * @returns {void} Nothing.
     */
    public load(serialized: Uint8Array, compressed: boolean = true): void {
        // Block rendering during (de)serialization to avoid corrupt WebGL state.
        // Also block the game update/run loop while the model is being hydrated.
        renderGate.bump();
        const gateToken = renderGate.begin({ blocking: true, tag: 'load' });

        // Prevent the main update loop from running while loading the model
        runGate.bump();
        const runGateToken = runGate.begin({ blocking: true, tag: 'load' });
        try {
            this.clearAllSpaces(); // Clear all spaces and objects before loading the new state (otherwise, objects from the previous state will still be present)
            $.event_emitter.dispose(); // Dispose the event emitter before loading the new state (otherwise, event handlers from the previous state will still be present)

            const temp_array = this.spaces.slice(); // Create a copy of the spaces array to prevent the spaces from being cleared when clearing the model instance
            temp_array.forEach(s => this.removeSpace(s)); // Remove all spaces from the model instance before loading the new state (otherwise, spaces from the previous state will still be present)

            let serializedState: Uint8Array;
            if (compressed) {
                serializedState = BinaryCompressor.decompressBinary(serialized); // Decompress the serialized state
            } else {
                serializedState = serialized; // Use the serialized state as is
            }

            $.registry.clear(); // Clear the registry before loading the new state (otherwise, registered objects from the previous state will still be present). Note that this will not clear the model instance itself, as the model instance has the property `registrypersistent: true` and will not be cleared. The same applies to Input, View, and other persistent objects.

            // Remove all cached textures and images from the texture manager
            $.texmanager.clear();
            $.view.reset(); // Reset the view to the initial state

            const savegame = Reviver.deserialize(serializedState) as Savegame;
            // Assign only plain data back to the model to avoid clobbering runtime fields
            for (const [k, v] of Object.entries(savegame.modelprops as Record<string, unknown>)) {
                if (typeof v !== 'function') (this as any)[k] = v;
            }

            savegame.spaces.forEach(space => this.addSpace(space));
            this.beginDepthBatch();
            try {
                savegame.allSpacesObjects.forEach(space_and_objects => {
                    const space = this.get_space(space_and_objects.spaceid);
                    const objects = space_and_objects.objects;
                    objects.forEach(o => {
                        if (!o) return;
                        space.spawn(o, null, true);
                    });
                });
            } finally {
                this.endDepthBatch();
            }

            // Plugin load hook
            for (const p of this._plugins) p.onLoad?.(this);

            // Deferred physics world rebuild: after all objects & components are fully hydrated
            try {
                let needs = false;
                // Restrict physics world rebuild to current space to avoid cross-space coupling.
                for (const go of this.currentSpace.objects) {
                    if (go.getComponent && go.getComponent(PhysicsDescriptorComponent)) { needs = true; break; }
                }
                if (needs) {
                    const world = PhysicsWorld.rebuild();
                    if (world.solver) world.solver.iterations = 4; // tune stability
                }
            } catch { /* ignore to avoid load failure if physics not present */ }

            // No need to push lighting here; renderer pulls from model each frame
        }
        catch (e) {
            console.error(`Error loading game state: ${e}`);
        }
        finally {
            $.wasupdated = true; // Set the update flag to true to indicate that the game has been updated
            renderGate.end(gateToken);
            runGate.end(runGateToken);
            $.requestPausedFrame();
        }
    }

    /**
     * Saves the current game state by creating a `Savegame` object and serializing it.
     * Pauses the game while creating the `Savegame` object to ensure consistency.
     * Excludes keys listed in `World.keys_to_exclude_from_save` from the saved data.
     * @returns {string} The serialized `Savegame` object.
     */
    public save(compress: boolean = true): Uint8Array {
        const createSavegame = () => {
            const self = this as Record<string, any>;
            const keys = Object.keys(self);
            const data = {} as Record<string, any>;
            for (let index = 0; index < keys.length; ++index) {
                const key = keys[index];
                if (World.keys_to_exclude_from_save.includes(key) || Serializer.excludedProperties['World']?.[key]) continue;
                if (self[key] !== null && self[key] !== undefined) {
                    data[key] = self[key];
                }
            }
            const result = new Savegame();
            result.modelprops = data;
            result.spaces = this.spaces;
            result.allSpacesObjects = [];
            for (let space of this.spaces) {
                result.allSpacesObjects.push({
                    spaceid: space.id,
                    objects: [...(space.objects)]
                });
            }

            return result;
        };

        const savegame = createSavegame();
        const serializedState = Serializer.serialize(savegame) as Uint8Array; // Serialize the savegame to a binary format
        let returnedState: Uint8Array;
        if (compress) {
            returnedState = BinaryCompressor.compressBinary(serializedState); // Compress the serialized state if requested
        } else {
            returnedState = serializedState; // Use the serialized state as is if compression is not requested
        }

        return returnedState;
    }

    /**
     * Filters the game objects in the model instance using the provided predicate function and returns a new array containing the filtered objects.
     * @param {function} predicate - The function used to filter the game objects. It should take a game object as its first argument, and return a boolean indicating whether the object should be included in the filtered list.
     * @returns {GameObject[]} An array containing the filtered game objects.
     */
    public filter(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown): GameObject[] {
        return this.objects.filter(predicate);
    }

    // https://hackernoon.com/3-javascript-performance-mistakes-you-should-stop-doing-ebf84b9de951
    /**
     * Filters the game objects in the model instance using the provided predicate function and calls the provided callback function on each filtered object.
     * @param {function} predicate - The function used to filter the game objects. It should take a game object as its first argument, and return a boolean indicating whether the object should be included in the filtered list.
     * @param {function} callbackfn - The function called on each filtered game object. It should take a game object as its first argument, and can optionally take the index of the object in the filtered list, the filtered list itself, and the model instance as additional arguments.
     * @returns {void} Nothing.
     */
    public filter_and_foreach(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown, callbackfn: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => void): void {
        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            if (predicate(obj, i, this.objects, this)) {
                callbackfn(obj, i, this.objects, this);
            }
        }
    }

    /**
     * Clears the current space in the model instance by calling the `clear` method on the current space.
     * @returns {void} Nothing.
     */
    public clear(): void {
        this.currentSpace.clear();
    }

    /**
     * Clears all spaces in the model instance by calling the `clear` method on each space.
     * @returns {void} Nothing.
     */
    public clearAllSpaces(): void {
        this.spaces.forEach(s => s.clear());
    }

    /**
     * Spawns a new game object in the current space.
     * @param {GameObject} o - The game object to spawn.
     * @param {Vector} [pos] - The position to spawn the game object at. If not provided, the game object's default position will be used.
     * @param {boolean} [ignoreSpawnhandler=false] - Whether to ignore the game object's spawn handler. If not provided, the spawn handler will be executed.
     * @returns {void} Nothing.
     */
    public spawn(o: GameObject, pos?: Vector, ignoreSpawnhandler?: boolean): void {
        if (!o?.id) throw new Error(`Cannot spawn object '${o?.id ?? 'undefined'}' as it doesn't have a valid id.`);
        this.currentSpace.spawn(o, pos, ignoreSpawnhandler);
    }

    /**
     * Exiles a game object from all spaces in the model instance.
     * @param {GameObject} o - The game object to exile.
     * @returns {void} Nothing.
     */
    public exile(o: GameObject, skip_ondispose_event: boolean = false): void {
        this.spaces.forEach(s => s.get(o.id) && s.exile(o, skip_ondispose_event));
        // Note that we don't need to dispose / deregister the object, as that is done in the `ondispose` method of the `GameObject` class
    }

    /**
     * Exiles a game object from the current space in the model instance.
     * @param {GameObject} o - The game object to exile.
     * @returns {void} Nothing.
     */
    public exileFromCurrentSpace(o: GameObject): void {
        this.currentSpace.exile(o);
    }

    /**
     * Adds a new space to the model instance.
     * @param {Space | Identifier} s - The space to add to the model instance. Can be a `Space` object or a string representing the ID of the new space.
     * @returns {void} Nothing.
     * @throws {Error} Throws an error if a space with the same ID already exists in the model instance.
     */
    public addSpace(s: Space | Identifier): void {
        const new_space: Space = (s instanceof Space ? s : new Space(s));
        new_space.bindModel(this);
        if (this._spaceMap.has(new_space.id)) throw Error(`Cannot add duplicate Space '${new_space.id}' to model!`);
        this.spaces.push(new_space);
        this._spaceMap.set(new_space.id, new_space);
        // Ensure component indexes are initialized for this space
        this._camerasBySpace.set(new_space.id, this._camerasBySpace.get(new_space.id) ?? new Set());
        this._lightsBySpace.set(new_space.id, this._lightsBySpace.get(new_space.id) ?? new Set());
    }

    /**
     * Removes a space from the model instance.
     * @param {Space | Identifier} s - The space to remove from the model instance. Can be a `Space` object or a string representing the ID of the space to remove.
     * @returns {void} Nothing.
     * @throws {Error} Throws an error if the space to remove is not found in the model instance.
     */
    public removeSpace(s: Space | Identifier): void {
        const space: Space = (s instanceof Space ? s : this.get_space(s));
        if (!space) throw Error(`Space '${s}' to remove from model was not found, while calling [World.removeSpace]!`);

        const index = this.spaces.indexOf(space);
        const id = space.id;

        if (index > -1) { space.clear(); this.spaces.splice(index, 1); }
        this._spaceMap.delete(id);
        this._camerasBySpace.delete(id);
        this._lightsBySpace.delete(id);
        space.ondispose?.();
    }

    public collidesWithTile(o: GameObject, dir: Direction): boolean {
        return this._collision?.collidesWithTile(o, dir) ?? false;
    }
    public isCollisionTile(x: number, y: number): boolean {
        return this._collision?.isCollisionTile(x, y) ?? false;
    }

    /**
     * Update per-space indexes when objects enter/leave a space.
     */
    public onObjectSpawned(space: Space, o: GameObject): void {
        if (o instanceof CameraObject) {
            const set = this._camerasBySpace.get(space.id) ?? new Set<CameraObject>();
            set.add(o);
            this._camerasBySpace.set(space.id, set);
        }
        if (o instanceof LightObject) {
            const set = this._lightsBySpace.get(space.id) ?? new Set<LightObject>();
            set.add(o);
            this._lightsBySpace.set(space.id, set);
        }
    }
    public onObjectExiled(space: Space, o: GameObject): void {
        if (o instanceof CameraObject) this._camerasBySpace.get(space.id)?.delete(o);
        if (o instanceof LightObject) this._lightsBySpace.get(space.id)?.delete(o);
    }

    /** Mark the space containing given object id as depth-sort dirty. */
    public markDepthDirtyForObjectId(id: Identifier): void {
        const sid = this.objToSpaceMap.get(id);
        if (!sid) return;
        if (this.depthDirtyBatch) { this.depthDirtyBatch.add(sid); return; }
        const sp = this._spaceMap.get(sid);
        if (sp) sp.depthSortDirty = true;
    }

    // --- Physics collision event queue (drained by ECS) ---
    @excludepropfromsavegame private _physicsEventQueue: CollisionEvent[] = [];
    public drainPhysicsEvents(): CollisionEvent[] {
        if (this._physicsEventQueue.length === 0) return [];
        const evts = this._physicsEventQueue.slice();
        this._physicsEventQueue.length = 0;
        return evts;
    }

    /** Begin a batch of mutations affecting depth ordering. */
    public beginDepthBatch(): void { if (!this.depthDirtyBatch) this.depthDirtyBatch = new Set<Identifier>(); }
    /** End a batch and mark all touched spaces as depth-dirty. */
    public endDepthBatch(): void {
        const set = this.depthDirtyBatch; this.depthDirtyBatch = null;
        if (!set) return;
        for (const sid of set) { const sp = this._spaceMap.get(sid); if (sp) sp.depthSortDirty = true; }
    }
    /** Run a function within a depth-batch scope. */
    public runDepthBatch<T>(fn: () => T): T { this.beginDepthBatch(); try { return fn(); } finally { this.endDepthBatch(); } }

    /** Mark specific spaces as depth-dirty. */
    public markSpacesDepthDirty(spaces: Array<Identifier | Space>): void {
        for (const s of spaces) {
            const sid = (s instanceof Space) ? s.id : s;
            const sp = this._spaceMap.get(sid);
            if (sp) sp.depthSortDirty = true;
        }
    }

    /** Transfer many objects efficiently; marks spaces dirty once. */
    public transferMany(objs: Array<GameObject | Identifier>, to: Space | Identifier, opts?: { suppressLifecycleHooks?: boolean }): void {
        const toSpace = (to instanceof Space) ? to : this.get_space(to);
        if (!toSpace) throw new Error('transferMany: target space not found');
        this.runDepthBatch(() => {
            for (const it of objs) {
                const o = (typeof it === 'string') ? this.getGameObject(it) : it;
                if (o) this.transfer(o, toSpace, opts);
            }
        });
    }

    /**
     * Iterate game objects with explicit scope.
     */
    public forEachGameObject(fn: (o: GameObject) => void, opts: { scope?: 'current' | 'all' } = {}): void {
        const scope = opts.scope ?? 'current';
        if (scope === 'current') { for (const o of this.currentSpace.objects) fn(o); return; }
        for (const sp of this.spaces) for (const o of sp.objects) fn(o);
    }

    public get objectsAll(): GameObject[] {
        const out: GameObject[] = [];
        for (const sp of this.spaces) out.push(...sp.objects);
        return out;
    }

    /** Iterate only objects of a specific class. */
    public forEachGameObjectOfType<T extends GameObject>(ctor: new (...args: any[]) => T, fn: (o: T) => void, opts: { scope?: 'current' | 'all' } = {}): void {
        this.forEachGameObject((o) => { if (o instanceof ctor) fn(o as T); }, opts);
    }
    /** Iterate objects that have a given component; passes the component instance too. */
    public forEachGameObjectWithComponent<T extends Component>(component: ComponentConstructor<T>, fn: (o: GameObject, c: T) => void, opts: { scope?: 'current' | 'all' } = {}): void {
        this.forEachGameObject((o) => { const c = (o as any).getComponent?.(component) as T | undefined; if (c) fn(o, c); }, opts);
    }

    /**
     * Activate a new space; fires ondeactivate/onactivate hooks.
     */
    public setSpace(newSpaceId: Identifier) {
        if (newSpaceId === this.currentSpaceid) return;
        const prev = this.get_space(this.currentSpaceid);
        this.currentSpaceid = newSpaceId;
        prev?.ondeactivate?.();
        this.currentSpace?.onactivate?.();
        $.emit('spaceChanged', this, { prev: prev?.id, curr: this.currentSpaceid });
    }
}
