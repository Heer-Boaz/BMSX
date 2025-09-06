import { BehaviorTreeContext, BehaviorTreeID, BehaviorTrees, Blackboard, ConstructorWithBTProperty } from "../../ai/behaviourtree";
import { Component, ComponentConstructor, ComponentContainer, ComponentTag, ConstructorWithAutoAddComponents, KeyToComponentMap } from "../../component/basecomponent";
import { StateMachineController } from "../../fsm/fsmcontroller";
import type { ConstructorWithFSMProperty, Stateful } from "../../fsm/fsmtypes";
import { AbstractConstructor, Area, Direction, vec2, vec3, type Identifier, type Polygon, type vec2arr } from "../../rompack/rompack";
import { insavegame, onload } from "../../serializer/gameserializer";
import { $ } from '../game';
import { ObjectTracker } from "./objecttracker";
import { middlepoint_area, new_area, new_vec2, new_vec3 } from '../utils';
import { StateDefinitions } from '../../fsm/fsmlibrary';
import { normalizeDecoratedClassName } from '../decorators';
import { EventEmitter } from "../eventemitter";
import { Registry } from "../registry";

const DEFAULT_HITTABLE = true;
const DEFAULT_VISIBLE = true;
const DEFAULT_POSITION_VALUES: [number, number, number] = [0, 0, 0];
const DEFAULT_SIZE_VALUES: [number, number, number] = [0, 0, 0];

type LeaveLeavingScreenPayload = { d: Direction, old_x_or_y: number };

export type WorldObjectEventPayloads = {
	['leaveScreen']: LeaveLeavingScreenPayload;
	['leavingScreen']: LeaveLeavingScreenPayload;
};

@insavegame
export class WorldObject implements vec3, ComponentContainer, Stateful {
	/**
	 * Represents a map of components associated with their respective keys.
	 */
	public components: KeyToComponentMap = {};

	/**
	 * The object tracker for the world object.
	 */
	public objectTracker?: ObjectTracker;

	/**
	 * Retrieves a component of the specified type from the world object.
	 *
	 * @template T - The type of the component to retrieve.
	 * @param constructor - The constructor function of the component.
	 * @returns The component of the specified type if found, otherwise undefined.
	 */
    getComponent<T extends Component>(constructor: ComponentConstructor<T>) {
        const key = normalizeDecoratedClassName((constructor)?.name);
        return this.components[key] as T | undefined;
    }

	/**
	 * Adds a component to the world object.
	 *
	 * @template T - The type of the component.
	 * @param {T} component - The component to be added.
	 * @returns {void}
	 */
    addComponent<T extends Component>(component: T): void {
        this.components[normalizeDecoratedClassName(component.constructor?.name)] = component;
        // Late-init: bind component event subscriptions and perform registry registration here,
        // after the component has been fully constructed and added to the container.
        component.onloadSetup();
    }

	/**
	 * Removes a component from the world object.
	 *
	 * @template T - The type of the component to remove.
	 * @param constructor - The constructor of the component to remove.
	 * @returns void
	 */
    removeComponent(constructor: { name: string } | Function): void {
        const key = normalizeDecoratedClassName((constructor)?.name);
        const component = this.components[key];
        if (!component) return;
        // Remove from the components map first to avoid recursive cycles when component.dispose()
        // calls back into removeComponent. This makes removal idempotent from the container side.
        delete this.components[key];

		// If the component exposes a detach method, call it (best-effort).
		component.detach();
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

    /** True when the object is part of the world and should participate in gameplay. */
    public active: boolean;
    /** If false, systems should not advance time-based logic for this object. */
    public tickEnabled: boolean;
    /**
     * Indicates whether the object is flagged for disposal.
     * If true, the object will be disposed of at the end of the game's current update cycle.
     */
    public disposeFlag: boolean;

	protected _pos: vec3;
	/**
	 * The position of the world object. The position is represented as a 3D vector with x, y, and z coordinates.
	 */
	public get pos(): vec3 { return this._pos; }

	/**
	 * The position of the world object. The position is represented as a 3D vector with x, y, and z coordinates.
	 * The z-coordinate is used for layering objects in the game world.
	 * see {@link setPosZ} for setting the z-coordinate, as it handles the z-coordinate bounds.
	 */
	public set pos(pos: vec3) { this._pos = pos; }

	/**
	 * Gets the x-coordinate of the world object.
	 */
	public get x(): number { return this.pos.x; }

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
	public get y(): number { return this.pos.y; }

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
	public get z(): number { return this.pos.z; }
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

	/**
	 * The size of the world object. The size is represented as a 3D vector with x, y, and z coordinates.
	 * Note that the size is only used for collision detection if the world object has no collision area and
	 * no bounding boxes. If the world object has a collision area or bounding boxes, the size is not used for collision detection.
	 */
	protected _size: vec3;
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
	private _btreecontexts: { [id: BehaviorTreeID]: BehaviorTreeContext };

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
	public tickTree(bt_id: BehaviorTreeID): void {
		const context = this.btreecontexts[bt_id];
		if (!context) {
			console.error(`Behavior tree context with ID '${bt_id}' does not exist!`);
			return;
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
	public resetTree(bt_id: BehaviorTreeID): void {
		if (!this.btreecontexts[bt_id].blackboard) {
			console.error(`Blackboard with ID ${bt_id} does not exist.`);
			return;
		}
		this.btreecontexts[bt_id].blackboard.clearAllNodeData();
	}

	/**
	 * The hit area of the world object, which is used for collision detection.
	 * The hit area is an instance of the Area class, which represents a rectangular area in the game world.
	 * If the hit area is not defined, it will be created based on the position and size of the world object.
	 */
	protected _hitarea: Area;

	protected _hitpolygon: Polygon[];
	// DARN: ON CREATING SAVEGAME, THIS WILL BE SAVED AND THEN LOADED IN THE GAMEOBJECT. THIS IS NOT WHAT WE WANT. WE WANT TO LOAD THE HIT-POLYGON FROM THE IMG ASSET. THIS IS A TEMPORARY FIX AND THIS COMMENT IS GENERATED BY AICOPILOT, WHICH MEANS I AM NOT THE ONLY ONE FACING THIS ISSUE :-)
	public set hitpolygon(polys: Polygon[]) {
		this._hitpolygon = polys;
	}

	/**
	 * Gets the hit polygon of the world object.
	 * The hit polygon is an array of polygons, where each polygon is represented as an array of points (vec2).
	 * The points are offset by the current position of the world object.
	 * @returns The hit polygon as an array of 2D points.
	 */
	public get hitpolygon(): Polygon[] {
		if (!this._hitpolygon) return undefined;
		return this._hitpolygon.map(poly => {
			const res: number[] = [];
			for (let i = 0; i < poly.length; i += 2) {
				res.push(poly[i] + this.x, poly[i + 1] + this.y);
			}
			return res;
		});
	}

	/**
	 * Checks if the world object has a hit polygon defined.
	 * The reason to have this check is to avoid unnecessary calculations before translating the hit polygon to account for the current position of the world object.
	 * @returns True if the world object has a hit polygon, false otherwise.
	 */
	public get hasHitPolygon(): boolean {
		return this._hitpolygon && this._hitpolygon.length > 0;
	}

	/**
	 * Indicates whether the object is hittable. If false, collision detection will be skipped and always return false.
	 */
	public hittable: boolean;
	/**
	 * Indicates whether the world object should be rendered or not.
	 */
	public visible: boolean;

	/**
	 * Gets the hitbox area of the world object.
	 * If the hitbox is not initialized, it creates a new area using the provided coordinates.
	 * If there is no hitbox and no bounding boxes, it returns an area based on the position and size of the world object.
	 * @returns The hitbox area of the world object.
	 */
	public get hitbox(): Area {
		return new_area(this.hitbox_left, this.hitbox_top, this.hitbox_right, this.hitbox_bottom);
	}

	/**
	 * Returns the middle point of the world object's hitbox.
	 *
	 * @returns The middle point as a `vec2` object.
	 */
	public get middlepoint(): vec2 {
		return middlepoint_area(this.hitbox);
	}

	public get hitbox_left(): number {
		if (this._hitarea) return this.hitarea_left;
		return this.x;
	}

	public get hitbox_top(): number {
		if (this._hitarea) return this.hitarea_top;
		return this.y;
	}

	public get hitbox_right(): number {
		if (this._hitarea) return this.hitarea_right;
		return this.x_plus_width;
	}

	public get hitbox_bottom(): number {
		if (this._hitarea) return this.hitarea_bottom;
		return this.y_plus_height;
	}

	public get hitarea_left(): number {
		return this.pos.x + (this._hitarea?.start.x ?? 0);
	}

	public get hitarea_top(): number {
		return this.pos.y + (this._hitarea?.start.y ?? 0);
	}

	public get hitarea_right(): number {
		return this.pos.x + (this._hitarea?.end.x ?? 0);
	}

	public get hitarea_bottom(): number {
		return this.pos.y + (this._hitarea?.end.y ?? 0);
	}

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
    public onspawn(spawningPos?: vec3): void {
		if (spawningPos) {
			this.x_nonotify = spawningPos.x ?? this.x;
			this.y_nonotify = spawningPos.y ?? this.y;
			this.z_nonotify = spawningPos.z ?? this.z;
		}

		$.registry.register(this); // Register the object in the registry so it can be retrieved by id.

		// Call the method to initialize event subscriptions
		this.onLoadSetup();
		// Call the method to initialize linked state machines
		this.initializeLinkedFSMs();
		// Call the method to initialize linked behavior trees
		this.initializeBehaviorTrees();

		// Add components that should be auto-added to this class after the object has been spawned so that the component can retrieve the object via its id
		this.addAutoComponents();

		this.active = true;
		this.tickEnabled = true;
		this.eventhandling_enabled = true; // Now active for event handling
		// Start the object's state machines on fresh spawn
		// (Revive path skips onspawn, so revived machines are not reset.)
		this.sc.start();
    }

    /** BeginPlay-style activation entry; mirrors onspawn behavior. */
    public activate(): void { this.onspawn(); }

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
		// Unsubscribe from events
		this.active = false;
		this.eventhandling_enabled = false; // Disable event handling immediately

		// Dispose of components
		const components = Object.values(this.components);
		components.forEach(component => this.removeComponent(component.constructor as ComponentConstructor<Component>)); // Remove the component from the world object and dispose (as part of the removal process)

		// Dispose all state machines
		this.sc.dispose();

		// Deregister the object from the entity registry
		this.unbind();
	}

	/**
	 * Abstract method that is called when the world object should be painted as part of the game loop.
	 */
	public paint?(): void;
	/**
	 * Abstract method that is called after the world object has been painted as part of the game loop.
	 * This method is used for post-processing effects such as lighting effects.
	 */
	public postpaint?(): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite

	/**
	* Gebruik ik als event handler voor e.g. onLeaveScreen
	*/
	public markForDisposal(): void {
		this.disposeFlag = true;
	}

	/** Specific flag controlling whether this WorldObject processes events. */
	public eventhandling_enabled: boolean;

	/**
	 * Represents a callback function that is triggered when a collision occurs with another WorldObject.
	 *
	 * @param src - The WorldObject that triggered the collision.
	 */
	public oncollide?: (src: WorldObject) => void;
	/**
	 * Callback function that is triggered when the world object collides with a wall.
	 * @param dir - The direction of the collision.
	 */
	public onWallcollide?: (dir: Direction) => void;
	/**
	 * Callback function that is called when the WorldObject leaves the screen.
	 *
	 * @param ik - The WorldObject that is leaving the screen.
	 * @param dir - The direction in which the WorldObject is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the WorldObject before leaving the screen.
	 */
	public onLeaveScreen?: (ik: WorldObject, { d, old_x_or_y }: WorldObjectEventPayloads['leaveScreen']) => void;
	/**
	 * Callback function that is triggered when the world object is leaving the screen.
	 *
	 * @param ik - The world object that is leaving the screen.
	 * @param dir - The direction in which the world object is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the world object before leaving the screen.
	 */
	public onLeavingScreen?: (ik: WorldObject, { d, old_x_or_y }: WorldObjectEventPayloads['leavingScreen']) => void;

	private _direction: Direction;
	public oldDirection: Direction;

	private _orientation: vec3;
	public oldOrientation: vec3;

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
		this.oldOrientation = this._orientation;
		this._orientation = value;
	}

	/**
	 * Gets the direction of the world object.
	 *
	 * @returns The direction of the world object.
	 */
	public get direction(): Direction {
		return this._direction;
	}

	/**
	 * Sets the direction of the world object.
	 *
	 * @param value - The new direction to set.
	 */
	public set direction(value: Direction) {
		this.oldDirection = this._direction;
		this._direction = value;
	}

	/**
	 * Generates a unique identifier for a world object.
	 * The generated identifier is a combination of the class name and a unique number.
	 * @returns The generated unique identifier.
	 */
	protected generateId(): string {
		const model = $.world;
		let result: string;
		do {
			const baseId = normalizeDecoratedClassName(this.constructor?.name);
			const uniqueNumber = model.getNextIdNumber();
			result = `${baseId}_${uniqueNumber}`;
		} while (model.exists(result));
		return result;
	}

	/**
	 * @param id The id of the newly created object. If not given, defaults to generated id. This ID is unique within the world and is used to identify the object.@see {@link generateId}.
	 * @note IT IS THUS NOT REQUIRED TO GENERATE A RANDOM ID YOURSELF!!
	 * @param fsm_id The id of the state machine that will be created for this object.
	 * If there is no state machine for this object, don't pass any value!! The state machine factory will ensure that an "empty" state machine is created. @see {@link statecontext.create}.
	 */
	constructor(id?: string, fsm_id?: string) {
		this.id = id ?? this.generateId();
		this.hittable = DEFAULT_HITTABLE;
		this.visible = DEFAULT_VISIBLE;
		this.pos = new_vec3(...DEFAULT_POSITION_VALUES);
		this.size = new_vec3(...DEFAULT_SIZE_VALUES);
        this.disposeFlag = false;
        this.active = false;
        this.tickEnabled = true;
        this.eventhandling_enabled = false; // Block event handling until spawned

		// Check if the FSM ID refers to a valid state machine in the library, but only if it was explicitly passed as an argument
		if (fsm_id && !StateDefinitions[fsm_id]) throw new Error(`[StateMachineController] Invalid FSM ID: "'${fsm_id}'"`);
		// Create the state context that will be used to manage the state of the world object
		this.sc = new StateMachineController(fsm_id ?? normalizeDecoratedClassName(this.constructor?.name), this.id);
	}

	removeComponentsWithTag(tag: ComponentTag): void {
		const componentsToRemove = Object.values(this.components).filter(component => component.hasTag(tag));
		componentsToRemove.forEach(component => this.removeComponent(component.constructor as ComponentConstructor<Component>));
	}

	removeAllComponents(): void {
		const componentsToRemove = Object.values(this.components);
		componentsToRemove.forEach((component) => this.removeComponent(component.constructor as ComponentConstructor<Component>));
	}

	/**
	 * Adds auto components to the world object.
	 * Auto components are added based on the `autoAddComponents` property of the world object's constructor.
	 */
	private addAutoComponents() {
		if ((this.constructor as ConstructorWithAutoAddComponents).autoAddComponents) {
			for (const componentClass of (this.constructor as ConstructorWithAutoAddComponents).autoAddComponents) {
				this.addComponent(new componentClass(this.id));
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
        this.sc.bind();
    }

    /** Unwire subscriptions and FSM listeners for this object. */
    public unbind(): void {
        // Best-effort: remove sc listeners by removing the subscriber (target) as well
		this.sc.unbind();
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
		const constructor = this.constructor as ConstructorWithBTProperty;
		this._btreecontexts = {};

		// Iterate over the behavior tree names and create the behavior trees
		constructor.linkedBTs?.forEach(bt_id => {
			let blackboard = new Blackboard(bt_id);
			this._btreecontexts[bt_id] = {
				root: BehaviorTrees[bt_id],
				blackboard: blackboard,
				running: true,
			};
		});
	}

	/**
	 * Calls the `oncollide` event handler with the given `WorldObject` instance as the source of the collision.
	 * @param src The `WorldObject` instance that collided with this instance.
	 */
	public collide(src: WorldObject): void {
		this.oncollide?.(src);
	}

	/**
	 * Checks if this WorldObject collides with another WorldObject or Area or polygon.
	 * Supports polygon-polygon, polygon-box, and box-polygon collision.
	 * Falls back to bounding box logic if polygons are not present.
	 * @param o The WorldObject or Area to check collision with.
	 * @returns True if a collision occurs, false otherwise.
	 */
	public collides(o: WorldObject | Area): boolean {
		if (!this.hittable) return false;
		const isWorldObject = (obj: any): obj is WorldObject => typeof obj === 'object' && 'id' in obj;
		const areaToPoly = (area: Area) => [
			area.start.x, area.start.y,
			area.end.x, area.start.y,
			area.end.x, area.end.y,
			area.start.x, area.end.y
		] as number[];

		if (isWorldObject(o)) {
			const other = o as WorldObject;
			if (!other.hittable) return false;
			// Quick hitbox reject using precomputed bounding boxes
			if (!WorldObject.detect_aabb_collision_areas(this.hitbox, other.hitbox)) return false;

			// If one of the objects has polygons, check polygon collision
			if (this.hasHitPolygon || other.hasHitPolygon) {
				// If this object has polygons, use them; otherwise convert its hitbox to a polygon
				const thisPoly = this.hasHitPolygon ? this.hitpolygon : [areaToPoly(this.hitbox)];
				const otherPoly = other.hasHitPolygon ? other.hitpolygon : [areaToPoly(other.hitbox)];
				if (WorldObject.polygonsIntersect(thisPoly, otherPoly)) return true;
				return false;
			}
			else return true; // AABB collision already checked above
		} else {
			// o is Area

			// Quick hitbox reject using precomputed bounding boxes
			if (!WorldObject.detect_aabb_collision_areas(this.hitbox, o as Area)) return false;

			// If this has polygons and the other is an area, convert the area to a polygon
			if (this.hasHitPolygon) {
				const areaPoly = areaToPoly(o as Area);
				if (WorldObject.polygonsIntersect(this.hitpolygon, [areaPoly])) {
					return true;
				}
				return false;
			}
			// Fallback: both are rectangles, do simple AABB overlap check, which is already done above
			return true; // AABB collision already checked above
		}
	}

	public getCollisionCentroid(o: WorldObject): vec2arr | null {
		if (!this.hittable || !o.hittable) return null;
		const isWorldObject = (obj: any): obj is WorldObject => typeof obj === 'object' && 'id' in obj;
		const areaToPoly = (area: Area) => [
			area.start.x, area.start.y,
			area.end.x, area.start.y,
			area.end.x, area.end.y,
			area.start.x, area.end.y
		] as number[];

		if (isWorldObject(o)) {
			const other = o as WorldObject;
			// Quick hitbox reject using precomputed bou`nding boxes
			if (!WorldObject.detect_aabb_collision_areas(this.hitbox, other.hitbox)) return null;

			// If one of the objects has polygons, check polygon collision
			if (this.hasHitPolygon || other.hasHitPolygon) {
				// If this object has polygons, use them; otherwise convert its hitbox to a polygon
				const thisPoly = this.hasHitPolygon ? this.hitpolygon : [areaToPoly(this.hitbox)];
				// If the other object has polygons, use them; otherwise convert its hitbox to a polygon
				const otherPoly = other.hasHitPolygon ? other.hitpolygon : [areaToPoly(other.hitbox)];

				// Check for polygon intersection
				const points = WorldObject.polygonsIntersectionPoints(thisPoly, otherPoly);
				if (points) {
					return WorldObject.getCentroidFromListOfIntersectionPoints(points);
				}
				return null; // No intersection points found
			}
		}

		console.warn(`'getCollisionCentroid' called by or with a WorldObject that doesn't have hitpolygons, which is not supported yet. this='${this.id}', o='${o.id}'.`);
		return null; // No polygons to check, so no centroid can be calculated
	}


	/**
	 * Determines if the current `WorldObject` instance collides with another `WorldObject` instance.
	 * Detects Axis-Aligned Bounding Box collision (AABB).
	 * @param o The `WorldObject` instance to check for collision.
	 * @returns `true` if the current instance collides with the given instance, `false` otherwise.
	 */
	public detect_object_collision(o: WorldObject): boolean {
		if (!this.hittable || !o.hittable) return false;
		return WorldObject.detect_aabb_collision_areas(this.hitbox, o.hitbox);
	}

	/**
	 * Detects AABB collision between two areas.
	 * @param a1 The first area.
	 * @param a2 The second area.
	 * @returns True if there is a collision, false otherwise.
	 */
	public static detect_aabb_collision_areas(a1: Area, a2: Area): boolean {
		return !(a1.start.x > a2.end.x || a1.end.x < a2.start.x || a1.end.y < a2.start.y || a1.start.y > a2.end.y);
	}

	/**
	 * Determines if the current `WorldObject` instance collides with an `Area` instance.
	 * Detects Axis-Aligned Bounding Box collision (AABB).
	 * @param a The `Area` instance to check for collision.
	 * @returns `true` if the current instance collides with the given instance, `false` otherwise.
	 */
	public detect_aabb_collision_area(a: Area): boolean {
		return WorldObject.detect_aabb_collision_areas(this.hitbox, a);
	}

	/**
	 * Determines whether two sets of polygons intersect.
	 *
	 * This function checks for intersection between two sets of polygons (arrays of polygons),
	 * using edge intersection and point-in-polygon tests.
	 *
	 * @param polys1 - An array of polygons (each polygon is an array of vec2 points).
	 * @param polys2 - An array of polygons (each polygon is an array of vec2 points).
	 * @returns `true` if any polygons intersect or one is inside the other, otherwise `false`.
	 */
	static polygonsIntersect(polys1: Polygon[], polys2: Polygon[]): boolean {
		for (const p1 of polys1) {
			for (const p2 of polys2) {
				if (WorldObject.singlePolygonsIntersect(p1, p2)) return true;
			}
		}
		return false;
	}

	/**
	 * Determines whether two single polygons intersect (internal helper).
	 */
	private static singlePolygonsIntersect(poly1: Polygon, poly2: Polygon): boolean {
		function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
			// Returns a positive value if c is to the left of the line from a to b,
			// a negative value if c is to the right, and zero if collinear.
			// This is the 2D cross product of vectors (b - a) and (c - a).
			// This is equivalent to the determinant of the matrix formed by the vectors.
			// | b.x - a.x  b.y - a.y |
			// | c.x - a.x  c.y - a.y |
			// The result is positive if c is to the left of the line, negative if to the right, and zero if collinear.
			return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
		}
		function onSegment(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
			return cx >= Math.min(ax, bx) && cx <= Math.max(ax, bx)
				&& cy >= Math.min(ay, by) && cy <= Math.max(ay, by);
		}
		const n1 = poly1.length, n2 = poly2.length;
		for (let i = 0; i < n1; i += 2) {
			const ax = poly1[i], ay = poly1[i + 1];
			const ni = (i + 2 === n1) ? 0 : i + 2;
			const bx = poly1[ni], by = poly1[ni + 1];
			for (let j = 0; j < n2; j += 2) {
				const cx = poly2[j], cy = poly2[j + 1];
				const nj = (j + 2 === n2) ? 0 : j + 2;
				const dx = poly2[nj], dy = poly2[nj + 1];
				const o1 = orient(ax, ay, bx, by, cx, cy);
				const o2 = orient(ax, ay, bx, by, dx, dy);
				const o3 = orient(cx, cy, dx, dy, ax, ay);
				const o4 = orient(cx, cy, dx, dy, bx, by);
				if (o1 * o2 < 0 && o3 * o4 < 0) return true;
				if (o1 === 0 && onSegment(ax, ay, bx, by, cx, cy)) return true;
				if (o2 === 0 && onSegment(ax, ay, bx, by, dx, dy)) return true;
				if (o3 === 0 && onSegment(cx, cy, dx, dy, ax, ay)) return true;
				if (o4 === 0 && onSegment(cx, cy, dx, dy, bx, by)) return true;
			}
		}
		function pointInPoly(px: number, py: number, poly: Polygon): boolean {
			let inside = false;
			for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
				const xi = poly[i], yi = poly[i + 1];
				const xj = poly[j], yj = poly[j + 1];
				if (((yi > py) !== (yj > py)) &&
					(px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
					inside = !inside;
				}
			}
			return inside;
		}
		if (pointInPoly(poly1[0], poly1[1], poly2)) return true;
		if (pointInPoly(poly2[0], poly2[1], poly1)) return true;
		return false;
	}

	/**
	 * Returns all intersection points between two sets of polygons (arrays of polygons).
	 *
	 * @param polys1 - An array of polygons (each polygon is an array of vec2 points).
	 * @param polys2 - An array of polygons (each polygon is an array of vec2 points).
	 * @returns Array of intersection points (vec2).
	 */
	static polygonsIntersectionPoints(polys1: Polygon[], polys2: Polygon[]): vec2arr[] | null {
		const intersections: vec2arr[] = [];
		for (const p1 of polys1) {
			for (const p2 of polys2) {
				intersections.push(...WorldObject.singlePolygonsIntersectionPoints(p1, p2));
			}
		}
		return intersections.length > 0 ? intersections : null;
	}

	/**
	 * Returns all intersection points between two single polygons (internal helper).
	 */
	private static singlePolygonsIntersectionPoints(poly1: Polygon, poly2: Polygon): vec2arr[] {
		function edgeIntersection(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): vec2arr | null {
			const a1 = by - ay;
			const b1 = ax - bx;
			const c1 = a1 * ax + b1 * ay;
			const a2 = dy - cy;
			const b2 = cx - dx;
			const c2 = a2 * cx + b2 * cy;
			const det = a1 * b2 - a2 * b1;
			if (Math.abs(det) < 1e-12) return null; // Parallel
			const x = (b2 * c1 - b1 * c2) / det;
			const y = (a1 * c2 - a2 * c1) / det;
			if (
				Math.min(ax, bx) - 1e-8 <= x && x <= Math.max(ax, bx) + 1e-8 &&
				Math.min(ay, by) - 1e-8 <= y && y <= Math.max(ay, by) + 1e-8 &&
				Math.min(cx, dx) - 1e-8 <= x && x <= Math.max(cx, dx) + 1e-8 &&
				Math.min(cy, dy) - 1e-8 <= y && y <= Math.max(cy, dy) + 1e-8
			) {
				return [x, y] as vec2arr;
			}
			return null;
		}
		function pointInPoly(px: number, py: number, poly: Polygon): boolean {
			let inside = false;
			for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
				const xi = poly[i], yi = poly[i + 1];
				const xj = poly[j], yj = poly[j + 1];
				if (((yi > py) !== (yj > py)) &&
					(px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi)) {
					inside = !inside;
				}
			}
			return inside;
		}
		const n1 = poly1.length, n2 = poly2.length;
		const intersections: vec2arr[] = [];
		for (let i = 0; i < n1; i += 2) {
			const ax = poly1[i], ay = poly1[i + 1];
			const ni = (i + 2 === n1) ? 0 : i + 2;
			const bx = poly1[ni], by = poly1[ni + 1];
			for (let j = 0; j < n2; j += 2) {
				const cx = poly2[j], cy = poly2[j + 1];
				const nj = (j + 2 === n2) ? 0 : j + 2;
				const dx = poly2[nj], dy = poly2[nj + 1];
				const pt = edgeIntersection(ax, ay, bx, by, cx, cy, dx, dy);
				if (pt) intersections.push(pt);
			}
		}
		for (let i = 0; i < n1; i += 2) {
			if (pointInPoly(poly1[i], poly1[i + 1], poly2)) intersections.push([poly1[i], poly1[i + 1]]);
		}
		for (let j = 0; j < n2; j += 2) {
			if (pointInPoly(poly2[j], poly2[j + 1], poly1)) intersections.push([poly2[j], poly2[j + 1]]);
		}
		return intersections;
	}

	/**
	 * Returns the centroid from all intersection points between two sets of polygons.
	 */
	static getCentroidFromIntersectionPoints(polys1: Polygon[], polys2: Polygon[]): vec2arr {
		const intersectionPoints = WorldObject.polygonsIntersectionPoints(polys1, polys2);
		return WorldObject.getCentroidFromListOfIntersectionPoints(intersectionPoints);
	}

	/**
	 * Returns the centroid from a list of intersection points.
	 */
	static getCentroidFromListOfIntersectionPoints(points: vec2arr[]): vec2arr {
		if (points.length === 0) return [0, 0] as vec2arr;
		let sumX = 0, sumY = 0;
		for (const pt of points) {
			sumX += pt[0];
			sumY += pt[1];
		}
		return [sumX / points.length, sumY / points.length] as vec2arr;
	}

	/**
	 * Returns the AABB (axis-aligned bounding box) of a polygon.
	 */
	static polygonAABB(poly: vec2[]): Area {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const p of poly) {
			if (p.x < minX) minX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.x > maxX) maxX = p.x;
			if (p.y > maxY) maxY = p.y;
		}
		return new_area(minX, minY, maxX, maxY);
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

	/**
	 * Runs the world object by updating its components and running its state.
	 */
	public run(): void {
		for (const id in this.btreecontexts) {
			this.tickTree(id);
		}
		this.sc.tick();
	}
}

// A type representing a constructor for WorldObject instances.
// It takes optional parameters _id and _fsm_id, and any additional arguments.
export type WorldObjectConstructorBase = new (_id?: Identifier, _fsm_id?: string, ...args: any[]) => WorldObject;

// A type representing either a concrete WorldObject constructor or an abstract constructor for WorldObject.
export type WorldObjectConstructorBaseOrAbstract = WorldObjectConstructorBase | AbstractConstructor<WorldObject>;
