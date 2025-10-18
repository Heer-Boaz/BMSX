import { setup_bt_library, setup_btdef_library } from "../ai/behaviourtree";
import { ECSystemManager, TickGroup } from "../ecs/ecsystem";
import { StateMachineController } from "../fsm/fsmcontroller";
import { setupFSMlibrary, StateDefinitions } from "../fsm/fsmlibrary";
import { Stateful, type StateMachineBlueprint } from "../fsm/fsmtypes";
import { State } from '../fsm/state';
import { CollisionEvent, PhysicsWorld } from '../physics/physicsworld';
import { Camera } from '../render/3d/camera3d';
import type { ConcreteOrAbstractConstructor, Identifier, RegisterablePersistent, vec2 } from '../rompack/rompack';
import type { NodeSpec, SystemDescriptor } from '../ecs/pipeline';
import type { ECSPipelineExtensionContext } from '../ecs/extensions';
import { Direction, vec3, type Area, type vec2arr } from "../rompack/rompack";
import { excludepropfromsavegame, insavegame, type RevivableObjectArgs } from '../serializer/serializationhooks';
import { CameraObject } from './object/cameraobject';
import { WorldObject } from './object/worldobject';
import { AmbientLightObject, LightObject } from './object/lightobject';
import { Registry } from "./registry";
import { $ } from './game';
import type { Component, ComponentConstructor } from "../component/basecomponent";
import { Space, id2spaceType, initial_world_spaces, obj_id2space_id_type, obj_id_to_space_id_symbol, id_to_space_symbol } from './space';
import { EventEmitter } from './eventemitter';
import { filterIterable, makeIndexProxy, shallowCopy } from '../utils/utils';
import { Collision2DSystem } from '../service/collision2d_service';
import { GameplayCommandBuffer } from '../ecs/gameplay_command_buffer';
import { GameplayEventRecorder } from './replay/gameplayeventrecorder';
import { build_fsm } from '../fsm/fsmdecorators';

const MAX_ID_NUMBER = Number.MAX_SAFE_INTEGER; // 53-bit monotonic id space
const WORLD_DEFAULT_FSM_ID = 'world_default';

// Backwards-compatible index proxies: runtime uses Map for performance, while
// external code can still index with [id] due to Proxy handling.
export type id2objectType = Record<Identifier, WorldObject>;
export const id2obj = Symbol('id2object');

// Services and module types
export interface TileCollisionService {
	collidesWithTile(o: WorldObject, dir: Direction): boolean;
	isCollisionTile(x: number, y: number): boolean;
}
export type ModelModuleEcsConfig = {
	systems?: SystemDescriptor[];
	nodes?: NodeSpec[] | ((ctx: ECSPipelineExtensionContext) => NodeSpec[] | void);
};

export type WorldModule = {
	// The module's unique identifier (required, used for dependency management and debugging)
	id: string;
	// The module's version (optional, informational only)
	version?: string;
	// IDs of modules that must be loaded together with this one
	dependencyIDs?: string[];
	// A brief description of the module's purpose (optional, informational only)
	description?: string;
	onBoot: (world: World) => void;
	onTick?: (world: World, dt: number) => void;
	onLoad?: (world: World) => void;
	dispose?: () => void;
	ecs?: ModelModuleEcsConfig;
};

export type WorldConfiguration = {
	viewportSize?: vec2;
	viewCanvasSize?: vec2;
	viewOffscreenSize?: vec2;
	collisionService?: TileCollisionService;
	modules?: Array<WorldModule>;
	fsmId?: string;
};

export type WorldScope = 'active' | 'all';

export type SpawnReason = 'fresh' | 'transfer' | 'revive';

@insavegame
/**
 * The base world class for the game. Contains all the spaces and objects in the game world.
 * Provides methods to add, remove, and manipulate game objects and spaces.
 *
 * Pipeline note: the World owns the system manager and update loop, but pipelines
 * (which systems run) are selected and applied by the Game (see core/pipelines/*).
 */
export class World implements Stateful, RegisterablePersistent {
	@build_fsm(WORLD_DEFAULT_FSM_ID)
	public static define_default_fsm(): StateMachineBlueprint {
		return {
			initial: 'game',
			states: {
				game: {
					tick(this: World): void {
						// No-op; default worlds remain in the game state.
					},
				},
			},
		};
	}

	get registrypersistent(): true {
		return true;
	}

	public get id(): 'world' { return 'world'; } // Required for IStateful and IIdentifiable

	// Internal physics diagnostic frame counter (temporary instrumentation)
	private static _physDiagFrames?: number;

	/**
	 * The controller for the state machine.
	 */
	public sc: StateMachineController;

	@excludepropfromsavegame
	private _currentPhase: TickGroup | null = null;
	public get currentPhase(): TickGroup | null { return this._currentPhase; }

	/** ECS systems runner */
	@excludepropfromsavegame
	public systems: ECSystemManager = new ECSystemManager();

	/**
	 * An object that maps space IDs to their corresponding Space objects.
	 * @type {id2spaceType}
	 */
	public [id_to_space_symbol]: id2spaceType;
	@excludepropfromsavegame
	public _spaceMap: Map<Identifier, Space>;
	/**
	 * An object that maps object IDs to their corresponding space IDs.
	 * @type {obj_id2space_id_type}
	 */
	public [obj_id_to_space_id_symbol]: obj_id2space_id_type;
	@excludepropfromsavegame
	public objToSpaceMap: Map<Identifier, Identifier>;

	/**
	 * Gets all game objects in the current space.
	 * @returns {WorldObject[]} An array of all game objects in the current space.
	 */
	// public get activeObjects(): WorldObject[] {
	// 	const base = this.activeSpace.objects;
	// 	const overlay = this._spaceMap.get('ui')?.objects ?? [];
	// 	if (overlay.length === 0) return base;
	// 	// Merge without copying base array reference to avoid aliasing mutations
	// 	const out = new Array<WorldObject>(base.length + overlay.length);
	// 	let i = 0;
	// 	for (let j = 0; j < base.length; j++) out[i++] = base[j];
	// 	for (let j = 0; j < overlay.length; j++) out[i++] = overlay[j];
	// 	return out;
	// }

	// public *iterateActiveObjects(reverse = false): Iterable<WorldObject> {
	// 	if (reverse) {
	// 		for (let index = this.activeSpace.objects.length - 1; index >= 0; index--) {
	// 			yield this.activeSpace.objects[index];
	// 		}
	// 		if (this._spaceMap.has('ui')) {
	// 			for (let j = this._spaceMap.get('ui').objects.length - 1; j >= 0; j--) {
	// 				yield this._spaceMap.get('ui').objects[j];
	// 			}
	// 		}
	// 	} else {
	// 		this.activeSpace.objects.forEach(yield);
	// 		this._spaceMap.has('ui') && (this._spaceMap.get('ui').objects).forEach(yield);
	// 	}
	// }

	public get allObjectsFromSpaces(): WorldObject[] {
		const out: WorldObject[] = [];
		for (const sp of this.spaces) out.push(...sp.objects);
		return out;
	}

	public spaces: Space[]; // All spaces in the world
	protected _activeSpaceId: Identifier; // Current space. On world creation, a default space is created with id 'default'
	public get activeSpaceId(): Identifier { return this._activeSpaceId; } // Current space id. On world creation, a default space is created with id 'default'
	public get activeSpace(): Space { return this[id_to_space_symbol][this._activeSpaceId]; } // Current space. On world creation, a default space is created with id 'default'

	// Model configuration (size, services, modules)
	private _size: vec2 = { x: 256, y: 192 };
	private _collision?: TileCollisionService;
	private _modules: Array<WorldModule> = [];
	public get modules(): Array<WorldModule> { return this._modules; }
	private _fsmId: string = 'world';

	public get gamewidth(): number { return this._size.x; }
	public get gameheight(): number { return this._size.y; }

	protected idCounter = 0;

	public paused: boolean;

	private _activeCameraId: Identifier | null = null;

	public get activeCameraId(): Identifier | null {
		return this._activeCameraId;
	}

	public set activeCameraId(id: Identifier | null) {
		this._activeCameraId = id; // Set the active camera ID, which can be null if no camera is active
	}

	public get activeCameraObject(): CameraObject | null {
		return this._activeCameraId ? this.getWorldObject<CameraObject>(this.activeCameraId) : null;
	}

	public get activeCamera3D(): Camera | null {
		return this.activeCameraObject?.camera ?? null;
	}

	// Indexed cameras/lights for fast queries
	@excludepropfromsavegame private _camerasBySpace: Map<Identifier, Set<CameraObject>> = new Map();
	@excludepropfromsavegame private _lightsBySpace: Map<Identifier, Set<LightObject>> = new Map();
	// Batch depth marker: when non-null, collect touched space ids and mark once at end
	@excludepropfromsavegame public depthDirtyBatch: Set<Identifier> | null = null;

	public get activeCameras(): CameraObject[] {
		const out: CameraObject[] = [];
		const set = this._camerasBySpace.get(this._activeSpaceId);
		if (!set) return out;
		for (const c of set) out.push(c);
		return out;
	}

	public get activeLights(): LightObject[] {
		const out: LightObject[] = [];
		const set = this._lightsBySpace.get(this._activeSpaceId);
		if (!set) return out;
		for (const l of set) if (l.active) out.push(l);
		return out;
	}

	public get activeAmbientLight(): AmbientLightObject | null {
		return this.activeLights.find(light => light.type === 'ambient') as AmbientLightObject | null;
	}

	/**
	 * Gets the world object with the given id from the current space only.
	 * @param {Identifier} id - the id of the {@link WorldObject}.
	 * @returns {T} The world object with the given id from the current space only.
	 */
	public getFromCurrentSpace<T extends WorldObject>(id: Identifier): T | null { return this.activeSpace.get<T>(id) ?? null; }

	/**
	 * Gets the world object with the given id across all spaces.
	 * If `id === `, returns the game world instead! This is used for {@link State} to make game world as target for callbacks.
	 * @param {Identifier} id - the id of the {@link WorldObject}.
	 * @returns {T | null} The object with the given id or the game world itself (when `id === `), or null if the object is not found.
	 */
	public getWorldObject<T extends WorldObject = WorldObject>(id: Identifier): T | null {
		if (!id) return null;
		const sid = this.objToSpaceMap.get(id);
		if (!sid) return null;
		const space = this[id_to_space_symbol][sid];
		if (!space) {
			throw new Error(`[World] Object '${id}' is mapped to missing space '${sid}'.`);
		}
		return space.get<T>(id) ?? null;
	}

	public getSpaceOfObject(obj_id: Identifier): Space | null {
		const sid = this[obj_id_to_space_id_symbol][obj_id];
		if (!sid) return null;
		const space = this[id_to_space_symbol][sid];
		if (!space) throw new Error(`[World] Space '${sid}' referenced by object '${obj_id}' is missing.`);
		return space;
	}

	/**
	 * Returns true if an object exists **in any space** with the given object id.
	 * @param {Identifier} obj_id The id of the object that we want to know whether it exists.
	 * @returns {boolean} Whether an object was found _in any space_ with the given object id.
	 */
	public exists(obj_id: Identifier): boolean {
		return this.getWorldObject(obj_id) ? true : false;
	}

	/**
	 * Moves an object from one space to another. Object should exist in a space, otherwise error is thrown!
	 * @param {Identifier} obj_id - id of object to move.
	 * @param {Identifier} spaceid_to_move_obj_to - id of the new space of the object to move.
	 * @returns {void} Nothing
	 */
	public move_obj_to_space(obj_id: Identifier, spaceid_to_move_obj_to: Identifier): void {
		const obj = this.getWorldObject<WorldObject>(obj_id);
		if (!obj) throw Error(`Cannot move unknown object '${obj_id}' to space '${spaceid_to_move_obj_to}'!`);
		const target_space = this[id_to_space_symbol][spaceid_to_move_obj_to];
		if (!target_space) throw Error(`Cannot move object '${obj_id}' to unknown space '${spaceid_to_move_obj_to}'!`);
		const fromSid = this.objToSpaceMap.get(obj_id);
		if (!fromSid) {
			throw new Error(`Cannot move object '${obj_id}' because it is not registered in any space.`);
		}
		const origin_space = this[id_to_space_symbol][fromSid];
		if (!origin_space) {
			throw new Error(`Cannot move object '${obj_id}' because source space '${fromSid}' is missing.`);
		}
		origin_space.despawn(obj, true);
		target_space.spawn(obj, null, { skipOnSpawn: true, reason: 'transfer' });
	}

	/**
	 * Atomically transfer an object between spaces and update all indexes.
	 * If opts.suppressLifecycleHooks is true, spawn/leave hooks are suppressed.
	 */
	public transfer(o: WorldObject, to: Space | Identifier, opts?: { suppressLifecycleHooks?: boolean }): void {
		const toSpace = (to instanceof Space) ? to : this[id_to_space_symbol][to];
		if (!toSpace) throw new Error(`transfer: target space not found`);
		const fromSid = this.objToSpaceMap.get(o.id);
		const from = fromSid ? this[id_to_space_symbol][fromSid] : null;
		if (!from) {
			throw new Error(`transfer: object '${o.id}' is not currently assigned to a space.`);
		}
		if (from === toSpace) return;
		const suppress = opts?.suppressLifecycleHooks ?? true;
		from.despawn(o, suppress);
		toSpace.spawn(o, undefined, { skipOnSpawn: suppress, reason: 'transfer' });
		o.onleaveSpace?.(from.id);
		o.onenterSpace?.(toSpace.id);
	}

	/**
	 * Moves the object with the specified ID to the current space.
	 *
	 * @param obj_id - The identifier of the object to be moved.
	 */
	public move_obj_to_current_space(obj_id: Identifier): void {
		this.move_obj_to_space(obj_id, this._activeSpaceId);
	}

	public getNextIdNumber(): number {
		if (this.idCounter >= MAX_ID_NUMBER) {
			throw new Error('ID counter exhausted: max safe integer reached');
		}
		const nextNumber = this.idCounter;
		this.idCounter = this.idCounter + 1;
		return nextNumber;
	}

	/** **DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!**
	 *
	 * _Trying to add logic here will most often result in runtime errors!_
	 * These runtime errors usually occur because the world was not created and initialized (with states),
	 * while creating new game objects that reference the world or the world states
	 */
	constructor(opts: RevivableObjectArgs & WorldConfiguration) {
		Registry.instance.register(this);
		if (opts.constructReason === 'revive') return;

		this.spaces = [];
		this._spaceMap = new Map<Identifier, Space>();
		this[id_to_space_symbol] = makeIndexProxy(this._spaceMap);
		this.objToSpaceMap = new Map<Identifier, Identifier>();
		this[obj_id_to_space_id_symbol] = makeIndexProxy(this.objToSpaceMap);

		this.paused = false;
		if (opts.viewportSize) this._size = shallowCopy<vec2>(opts.viewportSize);
		if (opts.collisionService) this._collision = opts.collisionService;
		if (opts.modules) this._modules = opts.modules.slice();
		if (opts.fsmId) this._fsmId = opts.fsmId;
		// Note: ECS pipeline is configured by the Game (see ECSPipeline.md).
	}

	public init_on_boot(): void {
		// Order is important: build FSM & BT libraries before modules spawn objects that construct state machines.
		// Previous order invoked registerModuleHooks (spawning objects) before setupStateMachineLib, causing
		// StateDefinitions to be undefined during WorldObject construction (e.g. accessing 'Cube3D').
		this
			.initializeWorldSpaces()
			.setupStateMachineLib()      // ensures StateDefinitions populated
			.setupBTLib()                // behavior trees available prior to module object creation
			.registerModuleHooks()       // modules may now safely spawn objects relying on FSM/BT definitions
			.startWorldStateMachine();
	}

	public dispose(): void {
		// Clear all spaces and objects
		this.clearAllSpaces();
		// Dispose the state machine controller and deregister all state machines
		this.sc.dispose();
		// Unsubscribe from all events
		EventEmitter.instance.removeSubscriber(this);
		// Dispose modules
		for (const p of this._modules) p.dispose?.();
		Registry.instance.deregister(this);
	}

	/** Wire decorator-declared subscriptions for the world. */
	public bind(): void {
		// World may have decorator-declared listeners in derived games
		EventEmitter.instance.initClassBoundEventSubscriptions(this);
		// Ensure FSM controller event wiring is active on revive as well
		if (!this.sc) {
			throw new Error('[World] State machine controller is not initialized before bind().');
		}
		this.sc.bind();
	}

	/** Unwire world subscriptions and FSM listeners. */
	public unbind(): void { /* decorator listeners removed via removeSubscriber if needed elsewhere */ }

	// Note: World no longer needs an explicit registerEventSubscriptions() call.
	// Event-decorated methods auto-register on instance creation with lifecycle gating.

	/**
	 * Initializes the spaces for the world. This method should only be executed when the world is not being revived.
	 * Adds the 'default' and 'game_start' spaces to the world and sets the current space to 'game_start'.
	 * @returns {World} The current instance of the World.
	 */
	public initializeWorldSpaces(): World { // Should only be executed when world is *not* revived
		this.addSpace('default' satisfies initial_world_spaces);
		this.addSpace('game_start' satisfies initial_world_spaces);
		this.addSpace('ui' satisfies initial_world_spaces);

		this._activeSpaceId = 'game_start';

		return this; // Return the current instance of the World for chaining
	}

	/**
	 * Sets up the finite state machine definition library for the `World` class.
	 * This method should only be called once during the initialization of the `World` class.
	 * @returns {World} The current instance of the World for chaining.
	 */
	private setupStateMachineLib(): World {
		setupFSMlibrary();
		return this;
	}

	/**
	 * @returns {World} The current instance of the World for chaining.
	 */
	private setupBTLib(): World {
		setup_btdef_library();
		setup_bt_library();
		return this;
	}

	/**
	* Init world after construction. Needed as the states have not been build at
	* the constructor's scope yet. So, this is a kind of `onspawn` for the world.
	*/
	public startWorldStateMachine(): this {
		// Check if the FSM ID refers to a valid state machine in the library, but only if it was explicitly passed as an argument
		if (this._fsmId && !StateDefinitions[this._fsmId]) {
			console.warn(`[World] FSM ID '${this._fsmId}' not found in StateDefinitions; defaulting to 'default_world'.`);
			this._fsmId = WORLD_DEFAULT_FSM_ID;
			if (!StateDefinitions[this._fsmId]) {
				throw new Error(`[World] Default FSM ID 'default_world' not found in StateDefinitions.`);
			}
		}
		// throw new Error(`[StateMachineController] Invalid FSM ID: "'${this._fsmId}'"`);

		this.sc = new StateMachineController({ fsm_id: this._fsmId ?? 'world', id: this.id });
		this.sc.start(); // Start the state machine controller (this will start all state machines that are added to the controller) and transition to the default state of the world, and subscribe to all events that are defined in the state machine definitions

		return this; // Return the current instance of the World for chaining
	}

	public registerModuleHooks(): this {
		// Modules boot hooks (explicit lifecycle; no property chaining)
		for (const p of this._modules) {
			p.dependencyIDs?.forEach(depId => {
				if (!this._modules.find(m => m.id === depId)) { throw new Error(`[World] Module ${p.id} has unmet dependency: ${depId}`); }
			});
			p.onBoot(this);
		}

		return this; // Return the current instance of the World for chaining
	}

	/**
	 * Runs the current state of the world by calling the `run` method of the current state.
	 * @returns {void} Nothing.
	 */
	public run(deltaTime: number): void {
		this.systems.beginFrame();
		GameplayCommandBuffer.instance.beginFrame($.turnCounter ?? 0);
		GameplayEventRecorder.instance.beginFrame($.turnCounter ?? 0);

		try {
			// Phase 1: Input → command submission (no gameplay writes)
			this._currentPhase = TickGroup.Input;
			this.systems.updatePhase(this, TickGroup.Input);

			const commandSnapshot = GameplayCommandBuffer.instance.snapshot();
			if (commandSnapshot.length > 0) GameplayEventRecorder.instance.recordCommands(commandSnapshot);

			// Phase 2: Ability instances / montages
			this._currentPhase = TickGroup.AbilityUpdate;
			this.systems.updatePhase(this, TickGroup.AbilityUpdate);

			// Phase 3: ModeGraph resolution (FSMs own tag writes)
			this._currentPhase = TickGroup.ModeResolution;
			this.sc.tick();
			this.systems.updatePhase(this, TickGroup.ModeResolution);

			// Phase 4: Physics/collision resolution
			this._currentPhase = TickGroup.Physics;
			this.systems.updatePhase(this, TickGroup.Physics);

			// Phase 5: Animation controllers
			this._currentPhase = TickGroup.Animation;
			this.systems.updatePhase(this, TickGroup.Animation);

			// Phase 6: Presentation (render prep, audio/FX/UI)
			this._currentPhase = TickGroup.Presentation;
			this.systems.updatePhase(this, TickGroup.Presentation);

			// Phase 7: Event flush / debugging hooks
			this._currentPhase = TickGroup.EventFlush;
			this.systems.updatePhase(this, TickGroup.EventFlush);
		} finally {
			this._currentPhase = null;
		}

		for (const p of this._modules) p.onTick?.(this, deltaTime);

		GameplayEventRecorder.instance.endFrame();

		for (const o of this.objects({ scope: 'active', reverse: true })) {
			if (o.disposeFlag) this.despawnFromAllSpaces(o);
		}
	}

	public stepPhysics(deltaTime: number): void {
		const phys = Registry.instance.get<PhysicsWorld>('physics_world');
		if (!phys) return;
		const collisionEvents: CollisionEvent[] = [];
		phys.step(deltaTime, evt => collisionEvents.push(evt));
		World._physDiagFrames = World._physDiagFrames ?? 0;
		if (World._physDiagFrames < 5) {
			const firstDyn = phys.getBodies().find(b => b.invMass && !b.isTrigger);
			if (firstDyn) console.log('[PhysStep]', 'dt=', deltaTime, 'pos=', firstDyn.position, 'vel=', firstDyn.velocity, 'grav=', 'getGravity' in phys ? phys.getGravity() : 'n/a');
			World._physDiagFrames++;
		}
		if (collisionEvents.length) this._physicsEventQueue.push(...collisionEvents);
	}

	public rebuildCollisionIndex(cellSize = 64): void { Collision2DSystem.rebuildIndex(this, cellSize); }
	public queryAABB(area: Area): WorldObject[] {
		Collision2DSystem.rebuildIndex(this);
		const colliders = Collision2DSystem.queryAABB(this, area);
		const seen = new Set<WorldObject>();
		const out: WorldObject[] = [];
		for (const col of colliders) {
			const owner = col.parent;
			if (!owner || seen.has(owner)) continue;
			seen.add(owner);
			out.push(owner);
		}
		return out;
	}

	public raycast(origin: vec2arr, dir: vec2arr, maxDist: number) {
		Collision2DSystem.rebuildIndex(this);
		const hits = Collision2DSystem.raycastWorld(this, origin, dir, maxDist);
		return hits.length > 0 ? hits[0] : null;
	}

	public sweepAABB(area: Area, delta: vec2arr): WorldObject[] {
		Collision2DSystem.rebuildIndex(this);
		const colliders = Collision2DSystem.sweepAABB(this, area, delta);
		const seen = new Set<WorldObject>();
		const out: WorldObject[] = [];
		for (const col of colliders) {
			const owner = col.parent;
			if (!owner || seen.has(owner)) continue;
			seen.add(owner);
			out.push(owner);
		}
		return out!;
	}

	/**
	 * Clears the current space in the world instance by calling the `clear` method on the current space.
	 * @returns {void} Nothing.
	 */
	public clear(): void {
		this.activeSpace.clear();
	}

	/**
	 * Clears all spaces in the world instance and disposes each object once.
	 * Detaches all objects from their spaces first, then disposes unique objects.
	 */
	public clearAllSpaces(): void {
		for (const o of this.objects({ scope: 'all' })) o.dispose();
		for (const s of this.spaces) s.clear();
	}

	public disposeAndRemoveAllSpaces(): void {
		for (const s of this.spaces) s.dispose?.();
		this.spaces.length = 0;
	}

	/**
	 * Spawns a new world object in the current space.
	 * @param {WorldObject} o - The world object to spawn.
	 * @param {vec3} [pos] - The position to spawn the world object at. If not provided, the world object's default position will be used.
	 * @param {boolean} [ignoreSpawnhandler=false] - Whether to ignore the world object's spawn handler. If not provided, the spawn handler will be executed.
	 * @returns {void} Nothing.
	 */
	public spawn(o: WorldObject, pos?: vec3, opts?: { ignoreSpawnhandler?: boolean, reason?: SpawnReason }): void {
		if (!o?.id) throw new Error(`Cannot spawn object '${o?.id ?? 'undefined'}' as it doesn't have a valid id.`);
		this.activeSpace.spawn(o, pos, opts);
	}

	/**
	 * Despawn a world object from whichever space it currently lives in without disposing it.
	 * The object remains in the Registry, but event handling is disabled (via flag) so it won't react to events.
	 */
	public despawnFromAllSpaces(o: WorldObject): void {
		for (const s of this.spaces) {
			if (s.get(o.id)) { s.despawn(o); return; }
		}
	}

	public despawnFromSpace(o: WorldObject, space_id: Identifier): void {
		const space = this[id_to_space_symbol][space_id];
		if (space && space.get(o.id)) {
			space.despawn(o);
		}
	}

	/**
	 * Destroy a world object that currently lives in the active space: detach then dispose.
	 * If the object is not in the active space, no action is taken.
	 */
	public despawnFromActiveSpace(o: WorldObject): void {
		this.despawnFromSpace(o, this._activeSpaceId);
	}

	/**
	 * Adds a new space to the world instance.
	 * @param {Space | Identifier} s - The space to add to the world instance. Can be a `Space` object or a string representing the ID of the new space.
	 * @returns {void} Nothing.
	 * @throws {Error} Throws an error if a space with the same ID already exists in the world instance.
	 */
	public addSpace(s: Space | Identifier): void {
		const new_space: Space = (s instanceof Space ? s : new Space({ id: s }));
		if (this._spaceMap.has(new_space.id)) throw Error(`Cannot add duplicate Space '${new_space.id}' to world!`);
		this.spaces.push(new_space);
		this._spaceMap.set(new_space.id, new_space);
		// Ensure component indexes are initialized for this space
		this._camerasBySpace.set(new_space.id, this._camerasBySpace.get(new_space.id) ?? new Set());
		this._lightsBySpace.set(new_space.id, this._lightsBySpace.get(new_space.id) ?? new Set());
	}

	/**
	 * Removes a space from the world instance.
	 * @param {Space | Identifier} s - The space to remove from the world instance. Can be a `Space` object or a string representing the ID of the space to remove.
	 * @returns {void} Nothing.
	 * @throws {Error} Throws an error if the space to remove is not found in the world instance.
	 */
	public removeSpace(s: Space | Identifier): void {
		const space: Space = (s instanceof Space ? s : this[id_to_space_symbol][s]);
		if (!space) throw Error(`Space '${s}' to remove from world was not found, while calling [World.removeSpace]!`);

		const index = this.spaces.indexOf(space);
		const id = space.id;

		if (index > -1) { space.clear(); this.spaces.splice(index, 1); }
		this._spaceMap.delete(id);
		this._camerasBySpace.delete(id);
		this._lightsBySpace.delete(id);
		space.dispose?.();
	}

	public collidesWithTile(o: WorldObject, dir: Direction): boolean {
		return this._collision?.collidesWithTile(o, dir) ?? false;
	}
	public isCollisionTile(x: number, y: number): boolean {
		return this._collision?.isCollisionTile(x, y) ?? false;
	}

	/**
	 * Update per-space indexes when objects enter/leave a space.
	 */
	public onObjectSpawned(space: Space, o: WorldObject): void {
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
	public onObjectExiled(space: Space, o: WorldObject): void {
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
	public transferMany(objs: Array<WorldObject | Identifier>, to: Space | Identifier, opts?: { suppressLifecycleHooks?: boolean }): void {
		const toSpace = (to instanceof Space) ? to : this[id_to_space_symbol][to];
		if (!toSpace) throw new Error('transferMany: target space not found');
		this.runDepthBatch(() => {
			for (const it of objs) {
				const o = (typeof it === 'string') ? this.getWorldObject(it) : it;
				if (o) this.transfer(o, toSpace, opts);
			}
		});
	}

	/**
	 * Iterate game objects with explicit scope.
	 */
	public forEachWorldObject(fn: (o: WorldObject) => void, opts: { scope?: WorldScope } = {}): void {
		const scope = opts.scope ?? 'active';
		if (scope === 'active') { for (const o of this.activeSpace.objects) fn(o); return; }
		for (const sp of this.spaces) for (const o of sp.objects) fn(o);
	}

	/** Iterate only objects of a specific class. */
	public forEachWorldObjectOfType<T extends WorldObject>(ctor: new (...args: any[]) => T, fn: (o: T) => void, opts: { scope?: WorldScope } = {}): void {
		this.forEachWorldObject((o) => { if (o instanceof ctor) fn(o as T); }, opts);
	}

	/** Iterate objects that have instances of a given component; passes each component instance. */
	public forEachWorldObjectWithComponents<T extends Component>(component: ComponentConstructor<T>, fn: (o: WorldObject, c: T) => void, opts: { scope?: WorldScope } = {}): void {
		this.forEachWorldObject((o) => {
			const list = (o).getComponents?.(component) as T[] | undefined;
			if (list && list.length) for (const c of list) fn(o, c);
		}, opts);
	}

	/**
	 * Generator method: the leading `*` indicates this is a generator function.
	 * It returns an IterableIterator<WorldObject> and yields objects lazily via `yield`.
	 */
	public *objects(opts: { scope?: WorldScope, reverse?: boolean } = {}): IterableIterator<WorldObject> {
		const { scope = 'active', reverse = false } = opts;
		if (scope === 'active') {
			if (reverse) {
				const base = this.activeSpace.objects;
				for (let i = base.length - 1; i >= 0; i--) yield base[i]!;
				const overlay = this._spaceMap.get('ui')?.objects ?? [];
				for (let i = overlay.length - 1; i >= 0; i--) yield overlay[i]!;
			}
			else {
				const base = this.activeSpace.objects;
				for (let i = 0; i < base.length; i++) yield base[i]!;
				const overlay = this._spaceMap.get('ui')?.objects ?? [];
				for (let i = 0; i < overlay.length; i++) yield overlay[i]!;
			}
		}
		else {
			for (const sp of this.spaces) {
				const arr = sp.objects;
				if (reverse) for (let i = arr.length - 1; i >= 0; i--) yield arr[i]!;
				else for (let i = 0; i < arr.length; i++) yield arr[i]!;
			}
		}
	}

	public *filterObjects(predicate: (o: WorldObject) => boolean, opts: { scope?: WorldScope, reverse?: boolean } = {}): IterableIterator<WorldObject> {
		yield* filterIterable(this.objects(opts), o => predicate(o));
	}

	public countFilteredObjects(predicate: (o: WorldObject) => boolean, opts: { scope?: WorldScope } = {}): number {
		let count = 0;
		for (const _ of filterIterable(this.objects(opts), o => predicate(o))) { count++; }
		return count;
	}

	/** Iterate only objects of a specific class as an iterable.
	 *
	 * Note: 'abstract' classes in TypeScript emit regular constructor functions at runtime.
	 * instanceof checks the prototype chain against ctor.prototype, so using an abstract
	 * base class here (ctor) will correctly return true for derived instances.
	 */
	public *objectsOfType<T extends WorldObject>(ctor: ConcreteOrAbstractConstructor<T>, opts: { scope?: WorldScope, reverse?: boolean } = {}): IterableIterator<T> {
		for (const o of this.objects(opts)) { if (o instanceof ctor) yield o! as T; }
	}

	/** Iterate objects that have a given component; yields [object, component] for each instance.
	 * Note: 'abstract' classes in TypeScript emit regular constructor functions at runtime.
	 * instanceof checks the prototype chain against ctor.prototype, so using an abstract
	 * base class here (ctor) will correctly return true for derived instances.
	 */
	public *objectsWithComponents<T extends Component>(component: ConcreteOrAbstractConstructor<T>, opts: { scope?: WorldScope, reverse?: boolean } = {}): IterableIterator<[WorldObject, T]> {
		for (const o of this.objects(opts)) { for (const c of o.iterateComponentsByType(component)) yield [o!, c!]; }
	}

	/**
	 * Activate a new space; fires ondeactivate/onactivate hooks.
	 */
	public setSpace(newSpaceId: Identifier) {
		if (newSpaceId === this._activeSpaceId) return;
		const prev = this[id_to_space_symbol][this._activeSpaceId];
		this._activeSpaceId = newSpaceId;
		prev?.deactivate?.();
		this.activeSpace?.activate?.();
		EventEmitter.instance.emit('spaceChanged', this, { prev: prev?.id, curr: this._activeSpaceId });
	}
}
