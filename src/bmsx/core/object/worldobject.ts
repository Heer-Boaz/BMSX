import { BehaviorTreeContext, BehaviorTreeID, instantiateBehaviorTree, Blackboard, ConstructorWithBTProperty } from "../../ai/behaviourtree";
import { Component, ComponentContainer, ComponentTag, ConstructorWithAutoAddComponents, KeyToComponentMap, ComponentConstructor } from "../../component/basecomponent";
import { StateMachineController } from "../../fsm/fsmcontroller";
import type { ConstructorWithFSMProperty, Stateful } from "../../fsm/fsmtypes";
import { ConcreteOrAbstractConstructor, Area, Direction, vec2, vec3, type Identifier, type Polygon, type Facing } from "../../rompack/rompack";
import { insavegame, onload, excludepropfromsavegame, type RevivableObjectArgs } from '../../serializer/serializationhooks';
import { $ } from '../game';
import type { Space } from '../space';
import { ObjectTracker } from "../../utils/objecttracker";
import { new_vec2, new_vec3 } from '../../utils/vector_operations';
import { middlepoint_area, new_area } from '../../utils/rect_operations';
import { StateDefinitions, registerHandlersForLinkedMachines } from '../../fsm/fsmlibrary';
import { EventEmitter } from "../eventemitter";
import { Registry } from "../registry";
import { CustomVisualComponent } from '../../component/customvisual_component';
import { Collider2DComponent } from '../../component/collisioncomponents';
import { V3 } from '../../render/3d/math3d';
import type { SpawnReason } from '../world';
import { AbilitySystemComponent } from '../../component/abilitysystemcomponent';
import { ensureTimelineComponent, TimelineComponent, type TimelinePlayOptions, type TimelineListener } from '../../component/timeline_component';
import type { Timeline, TimelineDefinition } from '../../timeline/timeline';

const COMPONENT_DEBUG_LOG_LIMIT = 50;
let componentAttachLogCount = 0;

const DEFAULT_HITTABLE = true;
const DEFAULT_VISIBLE = true;
const DEFAULT_POSITION_VALUES: [number, number, number] = [0, 0, 0];
const DEFAULT_SIZE_VALUES: [number, number, number] = [0, 0, 0];

type LeaveLeavingScreenPayload = { d: Direction, old_x_or_y: number };
type SpaceTransitionEventPayload = { from?: Identifier; to?: Identifier };

export type WorldObjectEventPayloads = {
	['screen.leave']: LeaveLeavingScreenPayload;
	['screen.leaving']: LeaveLeavingScreenPayload;
	['space.enter']: SpaceTransitionEventPayload;
	['space.leave']: SpaceTransitionEventPayload;
};

export const WorldObjectEvents = {
	LeaveScreen: 'screen.leave',
	LeavingScreen: 'screen.leaving',
	WallCollide: 'wallcollide',
	PhysicsCollisionEnter: 'physics.collision.enter',
	PhysicsCollisionStay: 'physics.collision.stay',
	PhysicsCollisionExit: 'physics.collision.exit',
	OverlapBegin: 'overlap.begin',
	OverlapStay: 'overlap.stay',
	OverlapEnd: 'overlap.end',
	SpaceEnter: 'space.enter',
	SpaceLeave: 'space.leave',
} as const;

@insavegame
export class WorldObject implements vec3, ComponentContainer, Stateful {
	/**
	 * Represents a map of components associated with their respective keys.
	 */
	public componentMap: KeyToComponentMap = {};

	public components: Component[] = []; // Array of all components in the object for easy iteration
	private _timelineComponent?: TimelineComponent;

	/**
	 * The object tracker for the world object.
	 */
	public objectTracker?: ObjectTracker;

	/**
	 * Iterates all components from the object.
	 *
	 * @returns An iterator for all components in the object.
	 */
	public *iterate_components(): IterableIterator<Component> {
		yield* this.components;
	}

	public *iterate_components_by_type<T extends Component>(constructor: ConcreteOrAbstractConstructor<T>): IterableIterator<T> {
		const arr = this.components.filter(c => c instanceof constructor) as T[];
		if (arr) yield* arr;
	}

	/**
	 * Retrieves a component of the specified type from the world object.
	 * Note: 'abstract' classes in TypeScript emit regular constructor functions at runtime.
	 * instanceof checks the prototype chain against ctor.prototype, so using an abstract
	 * base class here (ctor) will correctly return true for derived instances.
	 *
	 * @template T - The type of the component to retrieve.
	 * @param constructor - The constructor function of the component.
	 * @returns The component of the specified type if found, otherwise undefined.
	 */
	get_components<T extends Component>(constructor: ComponentConstructor<T>): T[] {
		const key = constructor.name;
		const arr = this.componentMap[key] as T[] | undefined;
		return arr ? [...arr] : [];
	}

	has_component<T extends Component>(constructor: ComponentConstructor<T>): boolean {
		const key = constructor.name;
		const arr = this.componentMap[key] as T[] | undefined;
		return !!arr && arr.length > 0;
	}

	get_first_component<T extends Component>(constructor: ComponentConstructor<T>): T | undefined {
		const key = constructor.name;
		const arr = this.componentMap[key] as T[] | undefined;
		return arr && arr.length > 0 ? arr[0] : undefined;
	}

	/** Returns the component of a given type that matches the supplied local id. */
	get_component_by_local_id<T extends Component>(constructor: ComponentConstructor<T>, idLocal: Identifier): T | undefined {
		for (const c of this.components) {
			if (c instanceof constructor && c.id_local === idLocal) return c as T;
		}
		return undefined;
	}

	/** Return the unique instance of a component type; throws if multiple are attached. */
	get_unique_component<T extends Component>(constructor: ComponentConstructor<T>): T | undefined {
		const key = constructor.name;
		const arr = this.componentMap[key] as T[] | undefined;
		if (!arr || arr.length === 0) return undefined;
		if (arr.length > 1) throw new Error(`Multiple '${key}' components attached to '${this.id}' but a unique instance was requested.`);
		return arr[0];
	}

	/**
	 * Adds a component to the world object.
	 *
	 * @template T - The type of the component.
	 * @param {T} component - The component to be added.
	 * @returns {void}
	 */
	add_component<T extends Component>(component: T): void {
		component.parent = this; // Do not use component.attach here, as it would cause infinite recursion
		this.components.push(component);
		const key = component.constructor?.name;
		let arr = this.componentMap[key];
		if (!arr) {
			arr = [];
			this.componentMap[key] = arr;
		}
		arr.push(component);
		if ($.debug && componentAttachLogCount < COMPONENT_DEBUG_LOG_LIMIT) {
			componentAttachLogCount++;
			const compName = component.constructor?.name ?? 'Component';
			console.debug(`[Component][attach] ${compName} -> ${this.id} (total=${this.components.length})`);
		}

		// Late-init: bind component event subscriptions and perform registry registration here,
		// after the component has been fully constructed and added to the container.
		component.onloadSetup();
	}

	/**
	 * Retrieves a component instance by its id or local_id.
	 */
	public get_component_by_id<T extends Component = Component>(id: string): T | undefined {
		const found = this.components.find(c => c.id === id || c.id_local === id);
		return found as T | undefined;
	}

	/**
	 * Retrieves the Nth instance of a component type attached to this object.
	 */
	public get_component_at<T extends Component>(constructor: ComponentConstructor<T>, index: number): T | undefined {
		const key = (constructor)?.name;
		const arr = this.componentMap[key] as T[] | undefined;
		return arr ? arr[index] : undefined;
	}

	/**
	 * Finds the first component of an optional type matching a predicate.
	 */
	public find_component<T extends Component>(predicate: (c: T, index: number) => boolean, constructor?: ComponentConstructor<T>): T | undefined {
		const arr = constructor ? this.get_components(constructor) : this.components as T[];
		for (let i = 0; i < arr.length; i++) {
			const c = arr[i];
			if (predicate(c, i)) return c;
		}
		return undefined;
	}

	/**
	 * Finds all components of an optional type matching a predicate.
	 */
	public find_components<T extends Component>(predicate: (c: T, index: number) => boolean, constructor?: ComponentConstructor<T>): T[] {
		const arr = constructor ? this.get_components(constructor) : this.components as T[];
		const out: T[] = [];
		for (let i = 0; i < arr.length; i++) { if (predicate(arr[i], i)) out.push(arr[i]); }
		return out;
	}

	/**
	 * Removes a component from the world object.
	 *
	 * @template T - The type of the component to remove.
	 * @param constructor - The constructor of the component to remove.
	 * @returns void
	 */
	remove_components(constructor: { name: string } | Function): void {
		const key = (constructor)?.name;
		const arr = this.componentMap[key];
		if (!arr || arr.length === 0) return;
		// Remove all instances of this type
		for (const c of [...arr]) this.remove_component_instance(c);
	}

	remove_component_instance<T extends Component>(component: T): void {
		// Remove from type bucket
		const key = component.constructor?.name;
		const arr = this.componentMap[key];
		if (arr) {
			const idx = arr.indexOf(component);
			if (idx !== -1) arr.splice(idx, 1);
			if (arr.length === 0) delete this.componentMap[key];
		}
		// Remove from flat list
		const i2 = this.components.indexOf(component);
		if (i2 !== -1) this.components.splice(i2, 1);
		// Unbind and clear parent linkage
		component.unbind();
	}

	protected get timeline_component(): TimelineComponent {
		if (!this._timelineComponent || this._timelineComponent.parent !== this) {
			this._timelineComponent = ensureTimelineComponent(this);
		}
		return this._timelineComponent;
	}

	public define_timeline(definition: TimelineDefinition): void {
		this.timeline_component.ensure(definition);
	}

	public play_timeline(definitionOrId: TimelineDefinition | string, opts?: TimelinePlayOptions): void {
		if ($.debug) {
			console.log('[Timeline][play]', {
				parent: this.id,
				definition: typeof definitionOrId === 'string' ? definitionOrId : definitionOrId.id,
				options: opts ?? null,
			});
		}
		if (typeof definitionOrId === 'string') {
			this.timeline_component.play(definitionOrId, opts);
			return;
		}
		this.timeline_component.playDefinition(definitionOrId, opts);
	}

	public stop_timeline(id: string): void {
		this.timeline_component.stop(id);
	}

	public rewind_timeline(id: string): void {
		this.timeline_component.rewind(id);
	}

	public seek_timeline(id: string, frame: number): void {
		this.timeline_component.seek(id, frame);
	}

	public force_timeline_head(id: string, frame: number): void {
		this.timeline_component.forceSeek(id, frame);
	}

	public advance_timeline(id: string): void {
		this.timeline_component.advance(id);
	}

	public get_timeline<T = unknown>(id: string): Timeline<T> | undefined {
		return this.timeline_component.get<T>(id);
	}

	public on_timeline_event(id: string, listener: TimelineListener): () => void {
		return this.timeline_component.addListener(id, listener);
	}

	/**
	 * Shorthand getter for retrieving the ability system component attached to this object.
	 */
	public get abilitysystem(): AbilitySystemComponent | undefined {
		return this.get_unique_component(AbilitySystemComponent);
	}

	/**
	 * Returns the primitive value of the WorldObject instance.
	 * @returns The ID of the WorldObject.
	 */
	public [Symbol.toPrimitive]() {
		return this.id;
	}

	/**
	 * The identifier of the world object, which is a unique string that is generated based on the class name and a unique number.
	 */
	public id: Identifier;

	public player_index?: number; // 1-based player index, if controlled by a player

	/** True when the object is part of the world and should participate in gameplay. */
	public active: boolean = false;
	/** If false, systems should not advance time-based logic for this object. */
	public tick_enabled: boolean = false;

	public _dispose_flag: boolean = false;
	@excludepropfromsavegame
	private _disposed: boolean = false;

	/**
	 * Indicates whether the object is flagged for disposal.
	 * If true, the object will be disposed of at the end of the game's current update cycle.
	 * @note We do not expose `setDisposeFlag` because we want to ensure that the @see {mark_for_disposal} is called instead.
	 */
	public get dispose_flag(): boolean { return this._dispose_flag; }

	protected _pos: vec3 = new_vec3(...DEFAULT_POSITION_VALUES);
	/**
	 * The position of the world object. The position is represented as a 3D vector with x, y, and z coordinates.
	 */
	public get pos(): vec3 { return this._pos; }

	/**
	 * The position of the world object. The position is represented as a 3D vector with x, y, and z coordinates.
	 * The z-coordinate is used for layering objects in the game world.
	 * see {@link setPosZ} for setting the z-coordinate, as it handles the z-coordinate bounds.
	 */
	// public set pos(pos: vec3) {
	// 	this._pos = pos;
	// }

	/**
	 * Gets the x-coordinate of the world object.
	 */
	public get x(): number { return this._pos.x; }

	/**
	 * Sets the x-coordinate of the object's position and handles collisions with tiles and screen edges.
	 * @param newx The new x-coordinate to set.
	 */
	public set x(x: number) {
		this.setPosX(x);
	}

	/**
	 * Sets the X position of the world object.
	 * This method is called by the setter for the related property to allow for decorating the method with the `update_tagged_components` decorator, as accessors cannot be decorated directly.
	 *
	 * @param x - The new X position value.
	 */
	protected setPosX(x: number) {
		this.pos.x = x; // Set position here, as accessors cannot be decorated with update_tagged_components
	}

	/**
	 * Gets the y-coordinate of the world object.
	 */
	public get y(): number { return this._pos.y; }

	/**
	 * Sets the y-coordinate of the object's position and handles collisions with tiles and screen edges.
	 * @param y The new y-coordinate to set.
	 */
	public set y(y: number) {
		this.setPosY(y);
	}

	/**
	 * Sets the Y position of the world object.
	 * This method is called by the setter for the related property to allow for decorating the method with the `update_tagged_components` decorator, as accessors cannot be decorated directly.
	 *
	 * @param y - The new Y position value.
	 */
	protected setPosY(y: number) {
		this.pos.y = y; // Set position here, as accessors cannot be decorated with update_tagged_components
	}

	/**
	 * Gets the z-coordinate of the world object.
	 * The z-coordinate is used for layering objects in the game world.
	 * The z-coordinate is clamped between 0 and ZCOORD_MAX.
	 */
	public get z(): number { return this._pos.z; }
	/**
	 * Sets the z-coordinate of the world object. The z-coordinate is used for layering objects in the game world.
	 * The z-coordinate is clamped between 0 and ZCOORD_MAX.
	 *
	 * @param z - The new z-coordinate value.
	 */
	public set z(z: number) {
		this.setPosZ(z)
	}

	/**
	 * Sets the Z position of the world object.
	 * This method is called by the setter for the related property to allow for decorating the method with the `update_tagged_components` decorator, as accessors cannot be decorated directly.
	 *
	 * @param z - The new Z position value.
	 */
	protected setPosZ(z: number) {
		this.pos.z = z; // Set position here, as accessors cannot be decorated with update_tagged_components
		// Mark depth-sort dirty for the object's space to ensure correct draw order
		$.world.markDepthDirtyForObjectId(this.id);
	}

	/**
	 * Gets the x coordinate of the world object.
	 * We need this accessor to allow the `x_nonotify += value` to work; Otherwise, the result is `NaN` as the `x_nonotify += value` is syntactically sugar for `x_nonotify = x_nonotify + value`.
	 */
	get x_nonotify(): number {
		return this.pos.x;
	}

	/**
	 * Gets the y coordinate of the world object.
	 * We need this accessor to allow the `y_nonotify += value` to work; Otherwise, the result is `NaN` as the `y_nonotify += value` is syntactically sugar for `y_nonotify = y_nonotify + value`.
	 */
	get y_nonotify(): number {
		return this.pos.y;
	}

	/**
	 * Gets the z coordinate of the world object.
	 * We need this accessor to allow the `z_nonotify += value` to work; Otherwise, the result is `NaN` as the `z_nonotify += value` is syntactically sugar for `z_nonotify = z_nonotify + value`.
	 */
	get z_nonotify(): number {
		return this.pos.z;
	}

	/**
	 * This setter is used to set the x coordinate without sweeping, e.g., without checking for collisions.
	 * It is used in cases where the world object is being moved without any side effects, such as when the world object is being teleported or when the position is being set directly without any physics calculations.
	 * @param x The new x-coordinate to set.
	 */
	public set x_nonotify(x: number) {
		this.pos.x = x;
	}

	/**
	 * This setter is used to set the y coordinate without sweeping, e.g., without checking for collisions.
	 * It is used in cases where the world object is being moved without any side effects, such as when the world object is being teleported or when the position is being set directly without any physics calculations.
	 * @param y The new y-coordinate to set.
	 */
	public set y_nonotify(y: number) {
		this.pos.y = y;
	}

	/**
	 * This setter is used to set the z coordinate without sweeping, e.g., without checking for collisions.
	 * It is used in cases where the world object is being moved without any side effects, such as when the world object is being teleported or when the position is being set directly without any physics calculations.
	 * @param z The new z-coordinate to set.
	 */
	public set z_nonotify(z: number) {
		this.pos.z = z;
		// Mark depth-sort dirty for the object's space to ensure correct draw order. This is still required.
		$.world.markDepthDirtyForObjectId(this.id);
	}

	public set pos_nonotify(pos: vec3) {
		V3.assign(this._pos, pos);
		$.world.markDepthDirtyForObjectId(this.id);
	}

	/**
	 * Read-only: the identifier of the Space this object currently belongs to, or null if not in a space.
	 */
	public get space_id(): Identifier | null {
		return this.space?.id ?? null;
	}

	/**
	 * Read-only: the Space this object currently belongs to, or null if not attached.
	 */
	public get space(): Space | null {
		return $.world.getSpaceOfObject(this.id);
	}

	/**
	 * The size of the world object. The size is represented as a 3D vector with x, y, and z coordinates.
	 * Note that the size is only used for collision detection if the world object has no collision area and
	 * no bounding boxes. If the world object has a collision area or bounding boxes, the size is not used for collision detection.
	 */
	protected _size: vec3 = new_vec3(...DEFAULT_SIZE_VALUES);
	public get size(): vec3 { return this._size; }
	public set size(value: vec3) { this._size = value; }

	public get sx(): number { return this.size.x; }
	public set sx(sx: number) { this.size.x = sx; }
	public get sy(): number { return this.size.y; }
	public set sy(sy: number) { this.size.y = sy; }
	public get sz(): number { return this.size.z; }
	public set sz(sz: number) { this.size.z = sz; }

	public get center(): vec3 {
		return new_vec3(this.x + this.size.x / 2, this.y + this.size.y / 2, this.z + this.size.z / 2);
	}

	public get center_x(): number {
		return this.x + this.size.x / 2;
	}

	public get center_y(): number {
		return this.y + this.size.y / 2;
	}

	public get center_z(): number {
		return this.z + this.size.z / 2;
	}

	/**
	 * The StatemachineController of the world object.
	 */
	public sc: StateMachineController;

	/**
	 * The mapping of behavior tree IDs to behavior tree contexts.
	 */
	private _btreecontexts: { [id: BehaviorTreeID]: BehaviorTreeContext } = {};

	public get btreecontexts() {
		return this._btreecontexts;
	}

	/**
	 * Executes the tick operation for the specified behavior tree.
	 * If the behavior tree or blackboard with the given ID does not exist, an error message is logged and the function returns.
	 * If an object tracker is available, it retrieves updates from the tracker and applies them to the blackboard before ticking the behavior tree.
	 *
	 * @param bt_id - The ID of the behavior tree to tick.
	 * @returns void
	 */
	public tick_tree(bt_id: BehaviorTreeID): void {
		const context = this.btreecontexts[bt_id];
		if (!context) {
			throw new Error(`[WorldObject:${this.id}] Behavior tree context '${bt_id}' does not exist.`);
		}
		if (!context.running) return;
		const tree = context.root;
		const blackboard = context.blackboard;

		if (!tree.enabled) {
			return;
		}

		// Get the updates from the ObjectTracker
		if (this.objectTracker) {
			const updates = this.objectTracker.getUpdates();

			// Apply the updates to the Blackboard
			blackboard.applyUpdates(updates);
		}

		if ($.debug) {
			blackboard.executionPath = [];
			tree.debug_tick(this.id, blackboard);
		}
		else {
			tree.tick(this.id, blackboard);
		}
	}

	/**
	 * Resets the tree with the specified BT_ID.
	 * If the blackboard with the given BT_ID does not exist, an error message is logged and the function returns.
	 * @param bt_id The ID of the blackboard to reset.
	 */
	public reset_tree(bt_id: BehaviorTreeID): void {
		const context = this.btreecontexts[bt_id];
		if (!context) {
			throw new Error(`[WorldObject:${this.id}] Behavior tree context '${bt_id}' does not exist.`);
		}
		context.blackboard.clearAllNodeData();
	}

	/** Returns the ColliderComponent if attached. */
	public get collider(): Collider2DComponent | undefined { return this.get_first_component(Collider2DComponent); }

	/**
	 * Indicates whether the object is hittable. Delegates to ColliderComponent when present.
	 */
	public get hittable(): boolean { return this.collider?.hittable ?? DEFAULT_HITTABLE; }
	public set hittable(v: boolean) { (this.getOrCreateCollider()).hittable = v; }
	/**
	 * Indicates whether the world object should be rendered or not.
	 */
	public visible: boolean = DEFAULT_VISIBLE;

	/**
	 * Gets the hitbox area of the world object.
	 * If the hitbox is not initialized, it creates a new area using the provided coordinates.
	 * If there is no hitbox and no bounding boxes, it returns an area based on the position and size of the world object.
	 * @returns The hitbox area of the world object.
	 */
	public get hitbox(): Area { return new_area(this.hitbox_left, this.hitbox_top, this.hitbox_right, this.hitbox_bottom); }

	/**
	 * Returns the middle point of the world object's hitbox.
	 *
	 * @returns The middle point as a `vec2` object.
	 */
	public get middlepoint(): vec2 {
		return middlepoint_area(this.hitbox);
	}

	public get hitbox_left(): number {
		const c = this.collider; if (c?.localArea) return this.pos.x + c.localArea.start.x;
		return this.x;
	}
	public get hitbox_top(): number {
		const c = this.collider; if (c?.localArea) return this.pos.y + c.localArea.start.y;
		return this.y;
	}
	public get hitbox_right(): number {
		const c = this.collider; if (c?.localArea) return this.pos.x + c.localArea.end.x;
		return this.x_plus_width;
	}
	public get hitbox_bottom(): number {
		const c = this.collider; if (c?.localArea) return this.pos.y + c.localArea.end.y;
		return this.y_plus_height;
	}

	/** Back-compat helpers: interpreted hitarea relative to object when collider exists. */
	public get hitarea_left(): number { const c = this.collider; return this.pos.x + (c?.localArea?.start.x ?? 0); }
	public get hitarea_top(): number { const c = this.collider; return this.pos.y + (c?.localArea?.start.y ?? 0); }
	public get hitarea_right(): number { const c = this.collider; return this.pos.x + (c?.localArea?.end.x ?? 0); }
	public get hitarea_bottom(): number { const c = this.collider; return this.pos.y + (c?.localArea?.end.y ?? 0); }

	/** World-space polygons if present. */
	public get hitpolygon(): Polygon[] | undefined { return this.collider?.worldPolygons ?? undefined; }
	public get has_hitpolygon(): boolean { const p = this.collider?.localPolygons; return !!(p && p.length > 0); }

	public get x_plus_width(): number {
		return this.pos.x + (this.size?.x ?? 0);
	}

	public get y_plus_height(): number {
		return this.pos.y + (this.size?.y ?? 0);
	}

	/**
	 * By default, will set location to `spawningPos` and
	 * the FSM-state to the initial state (if specified).
	 * @param spawningPos The position to spawn the object at.
	 */
	public onspawn(spawningPos?: vec3, opts?: { reason?: SpawnReason }): void {
		if (spawningPos) {
			this.x_nonotify = spawningPos.x ?? this.x;
			this.y_nonotify = spawningPos.y ?? this.y;
			this.z_nonotify = spawningPos.z ?? this.z;
		}
		const reason = opts?.reason ?? 'fresh';
		if (reason === 'fresh') {
			// Fresh spawn: full BeginPlay
			this.activate();
		}
		// Revive and transfer: do not mutate flags or controller; revived state is already set by deserialization,
		// and transfers should not trigger BeginPlay again.
	}

	/** BeginPlay-style activation entry; mirrors onspawn behavior. */
	public activate(): void {
		Registry.instance.register(this); // Register the object in the registry so it can be retrieved by id.

		// Call the method to initialize event subscriptions
		this.onLoadSetup();
		// Call the method to initialize linked state machines
		this.initializeLinkedFSMs();
		// Call the method to initialize linked behavior trees
		this.initializeBehaviorTrees();

		// Add components that should be auto-added to this class after the object has been spawned so that the component can retrieve the object via its id
		this.addAutoComponents();

		this.eventhandling_enabled = true; // Now active for event handling
		this.tick_enabled = true;
		this.sc.tickEnabled = true;
		this.active = true;
		// Start the object's state machines on fresh spawn
		// (Revive path skips onspawn, so revived machines are not reset.)
		this.sc.start();
	}

	public deactivate(): void {
		this.active = false;
		this.eventhandling_enabled = false;
		this.tick_enabled = false;
		this.sc.pause();
	}

	/**
	 * Called when the object is removed from its space without being destroyed.
	 * Default behavior: stop consuming events.
	 */
	public ondespawn(): void {
		this.active = false;
		this.eventhandling_enabled = false;
	}

	/**
	 * Dispose method for the world object.
	 *
	 * This method performs the following actions:
	 * 1. Unsubscribes from events.
	 * 2. Disposes of all components attached to the world object.
	 * 3. Disposes all state machines.
	 * 4. Deregisters the object from the entity registry.
	 */
	public dispose(): void {
		if (this._disposed) return; // idempotent
		this._disposed = true;
		// Unsubscribe from events, mark as inactive, and stop all ticks
		this.deactivate();

		// Dispose of components
		for (const c of [...this.components]) this.remove_component_instance(c);

		// Dispose all state machines
		this.sc.dispose();

		// Deregister the object from the entity registry
		const world = $.world;
		world.dispatchWorldLifecycleSlot(this, 'dispose', {
			world,
			spaceId: world.objToSpaceMap.get(this.id),
			reason: 'dispose',
		});
		this.unbind();
	}

	/** Ensure a GenericRendererComponent exists on this object and return it. */
	public getOrCreateCustomRenderer(): CustomVisualComponent {
		const existing = this.get_first_component(CustomVisualComponent);
		if (existing) return existing;
		const rc = new CustomVisualComponent({ parent_or_id: this });
		this.add_component(rc);
		return rc;
	}

	/** Ensure a ColliderComponent exists on this object and return it. */
	public getOrCreateCollider(): Collider2DComponent {
		const existing = this.get_first_component(Collider2DComponent);
		if (existing) return existing;
		const c = new Collider2DComponent({ parent_or_id: this, id_local: 'primary' });
		this.add_component(c);
		return c;
	}

	/**
	 * Marks the object to be disposed at the end of the current update cycle.
	 *
	 * Sets the internal dispose flag so the engine will perform actual cleanup
	 * later, and immediately deactivates the object to stop ticking and event handling.
	 *
	 * @remarks
	 * Prefer calling this over dispose() when you want safe, end-of-frame removal
	 * (avoids tearing down resources while other systems may still reference the object).
	 */
	public mark_for_disposal(): void {
		this._dispose_flag = true;
		this.deactivate();
	}

	/** Specific flag controlling whether this WorldObject processes events. */
	public eventhandling_enabled: boolean = false;

	protected _facing: Facing;
	public prevFacing: Facing;

	private _orientation: vec3;
	public prevOrientation: vec3;

	/**
	 * Gets the orientation of the world object.
	 * The orientation is represented as a 3D vector with x, y, and z coordinates.
	 * The z-coordinate is used for layering objects in the game world.
	 */
	public get orientation(): vec3 {
		return this._orientation;
	}

	/**
	 * Sets the orientation of the world object.
	 * The orientation is represented as a 3D vector with x, y, and z coordinates.
	 * The z-coordinate is used for layering objects in the game world.
	 *
	 * @param value - The new orientation to set.
	 */
	public set orientation(value: vec3) {
		this.prevOrientation = this._orientation;
		this._orientation = value;
	}

	/**
	 * Gets the direction of the world object.
	 *
	 * @returns The direction of the world object.
	 */
	public get facing(): Partial<Facing> {
		return this._facing;
	}

	/**
	 * Sets the direction of the world object.
	 *
	 * @param value - The new direction to set.
	 */
	public set facing(value: Partial<Facing>) {
		this.prevFacing = this._facing;
		this._facing = value;
	}

	/**
	 * Generates a unique identifier for a world object.
	 * The generated identifier is a combination of the class name and a unique number.
	 * @returns The generated unique identifier.
	 */
	protected generateId(): string {
		const world = $.world;
		let result: string;
		do {
			const baseId = (this.constructor?.name);
			const uniqueNumber = world.getNextIdNumber();
			result = `${baseId}_${uniqueNumber}`;
		} while (world.exists(result));
		return result;
	}

	/**
	 * @param id The id of the newly created object. If not given, defaults to generated id. This ID is unique within the world and is used to identify the object.@see {@link generateId}.
	 * @note IT IS THUS NOT REQUIRED TO GENERATE A RANDOM ID YOURSELF!!
	 * @param fsm_id The id of the state machine that will be created for this object.
	 * If there is no state machine for this object, don't pass any value!! The state machine factory will ensure that an "empty" state machine is created. @see {@link statecontext.create}.
	 */
	constructor(opts?: RevivableObjectArgs & { id?: string, fsm_id?: string }) {
		this.id = opts?.id ?? this.id ?? this.generateId();

		// Check if the FSM ID refers to a valid state machine in the library, but only if it was explicitly passed as an argument
		if (opts?.fsm_id && !StateDefinitions[opts.fsm_id]) throw new Error(`[StateMachineController] Invalid FSM ID: '${opts.fsm_id}'`);
		// Create the state context that will be used to manage the state of the world object
		//
		// The controller can optionally be seeded with an initial machine:
		//   1. When the caller passes an explicit `fsm_id`, we always instantiate that
		//      machine (validation of the id happened just above).
		//   2. Otherwise we fall back to the class name **only** when a definition exists
		//      for it. When no definition is registered we start with an empty controller
		//      so the runtime fails fast if a state machine is actually required.
		// Linked FSMs added via decorators are registered later in `initializeLinkedFSMs()`
		// so the first machine is always one the class explicitly requested.
		const explicitMachineId = opts?.fsm_id;
		const inferredMachineId = this.constructor.name;
		let initialMachineId: string | undefined = explicitMachineId;
		if (!initialMachineId) {
			const hasDefinitionForDefault = !!StateDefinitions[inferredMachineId];
			if (hasDefinitionForDefault) {
				initialMachineId = inferredMachineId;
			}
		}
		this.sc = new StateMachineController({ constructReason: undefined, fsm_id: initialMachineId, id: this.id });
	}

	removeComponentsWithTag(tag: ComponentTag): void {
		const componentsToRemove = this.components.filter(component => component.has_processing_tag(tag));
		componentsToRemove.forEach(component => this.remove_component_instance(component));
	}

	removeAllComponents(): void {
		for (const c of [...this.components]) this.remove_component_instance(c);
	}

	/**
	 * Adds auto components to the world object.
	 * Auto components are added based on the `autoAddComponents` property of the world object's constructor.
	 */
	private addAutoComponents() {
		if ((this.constructor as ConstructorWithAutoAddComponents).autoAddComponents) {
			for (const componentClass of (this.constructor as ConstructorWithAutoAddComponents).autoAddComponents) {
				const component = new componentClass({ parent_or_id: this });
				component.attach(this);
			}
		}
	}

	/**
	 * Initializes the setup for the onLoad event.
	 */
	@onload
	onLoadSetup() {
		// Ensure object is registered after revive (onspawn is skipped during revive)
		// Binding is orchestrated by the engine wiring phase via bind()
		// Do not force-enable event handling here; rely on lifecycle hooks (onspawn/ondespawn)
		this.bind();
	}

	/** Wire decorator-declared subscriptions for this object and bind its controller (revive path). */
	public bind(): void {
		Registry.instance.register(this);
		EventEmitter.instance.initClassBoundEventSubscriptions(this);
	}

	/** Unwire subscriptions and FSM listeners for this object. */
	public unbind(): void {
		EventEmitter.instance.removeSubscriber(this);
		Registry.instance.deregister(this);
	}

	/**
	 * Initializes the linked finite state machines (FSMs) for the current instance.
	 *
	 * This method retrieves the constructor of the current instance and checks if it has the 'linkedFSMs' property.
	 * If the property exists, it iterates over the FSM names and creates the state machines using the 'add_statemachine' method of the 'sc' object.
	 */
	protected initializeLinkedFSMs() {
		// Get the constructor of the current instance
		const constructor = this.constructor as ConstructorWithFSMProperty;

		// Check if the constructor has the 'linkedFSMs' property
		if (constructor.linkedFSMs) {
			registerHandlersForLinkedMachines(constructor, constructor.linkedFSMs);
			// Iterate over the FSM names and create the state machines
			constructor.linkedFSMs.forEach(fsm => {
				this.sc.add_statemachine(fsm, this.id);
			});
		}
	}

	/**
	 * Initializes the behavior trees for the world object.
	 *
	 * This method creates behavior trees based on the 'linkedBTs' property of the constructor.
	 * It iterates over the behavior tree names and creates the behavior trees along with their associated blackboards.
	 *
	 * @remarks
	 * This method should be called during the initialization of the world object.
	 */
	protected initializeBehaviorTrees() {
		// Get the constructor of the current instance
		const ctor = this.constructor as ConstructorWithBTProperty;
		const contexts = this._btreecontexts;

		// Iterate over the behavior tree names and ensure the behavior trees exist
		ctor.linkedBTs?.forEach(btId => {
			if (contexts[btId]) {
				return;
			}
			const blackboard = new Blackboard({ id: btId });
			contexts[btId] = {
				tree_id: btId,
				running: true,
				root: instantiateBehaviorTree(btId),
				blackboard,
			};
		});
	}

	/**
	 * Detects whether this object overlaps the given 2D point.
	 * @param {vec2} p 2D vector; The points for which the overlap is checked.
	 * @returns {vec2} If there is an overlap, the offset from this object to the point **(used for dragging in debugger)**, or _null_ otherwisse.
	 */
	public overlaps_point(p: vec2): vec2 | null {
		if (!(this.hitbox_left >= p.x || this.hitbox_right <= p.x || this.hitbox_bottom <= p.y || this.hitbox_top >= p.y))
			return new_vec2(p.x - this.hitbox_left, p.y - this.hitbox_top);
		return null;
	}
}

// A type representing a constructor for WorldObject instances.
// It takes optional parameters _id and _fsm_id, and any additional arguments.
export type WorldObjectConstructorBase = new (_id?: Identifier, _fsm_id?: string, ...args: any[]) => WorldObject;

// A type representing either a concrete WorldObject constructor or an abstract constructor for WorldObject.
export type WorldObjectConstructorBaseOrAbstract = ConcreteOrAbstractConstructor<WorldObject>;
