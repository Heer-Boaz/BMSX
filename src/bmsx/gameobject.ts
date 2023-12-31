import { ConstructorWithFSMProperty, IStateful, bfsm_controller } from "./bfsm";
import { insavegame } from "./gameserializer";
import { Component, ComponentTag, IComponentContainer, KeyToComponentMap, ComponentConstructor, update_tagged_components } from "./component";
import { BehaviorTrees, Blackboard, BTNode, BehaviorTreeID, ConstructorWithBTProperty } from "./behaviourtree";
import { ObjectTracker } from "./objecttracker";
import { onload } from "./gameserializer";
import { new_area, new_vec3, new_vec2, AbstractConstructor, middlepoint_area } from "./game";
import { vec2, vec3, Area, Vector } from "./rompack";
import { Direction } from "./game";
import { ZCOORD_MAX } from "./glview";
import type { Identifier } from "./game";

const DEFAULT_HITTABLE = true;
const DEFAULT_VISIBLE = true;
const DEFAULT_POSITION_VALUES: [number, number, number] = [0, 0, 0];
const DEFAULT_SIZE_VALUES: [number, number, number] = [0, 0, 0];

/**
 * Represents a static GameObject.
 */
interface IGameObjectStatic {
	autoAddComponents?: ComponentConstructor<Component>[];
}

/**
 * Represents a game object with a position, size, state, and hitbox.
 * Implements both vec2 and vec3 interfaces.
 */
@insavegame
export class GameObject implements vec3, IComponentContainer, IStateful {
	public components: KeyToComponentMap = {};
	public objectTracker?: ObjectTracker;

	getComponent<T extends Component>(constructor: ComponentConstructor<T>): T | undefined {
		return this.components[constructor.name] as T | undefined;
	}

	addComponent<T extends Component>(component: T): void {
		this.components[component.constructor.name] = component;
	}

	removeComponent<T extends Component>(constructor: ComponentConstructor<T>): void {
		const component = this.components[constructor.name];
		if (!component) return;
		component.dispose();
		delete this.components[constructor.name];
	}

	updateComponentsWithTag(tag: ComponentTag, ...args: any[]): void {
		// Update components with the given tag (preprocessing)
		Object.values(this.components).filter(component => component.hasPreprocessingTag(tag)).forEach(component => component.enabled && component.preprocessingUpdate(...args));
		// Update components with the given tag (postprocessing)
		Object.values(this.components).filter(component => component.hasPostprocessingTag(tag)).forEach(component => component.enabled && component.postprocessingUpdate({ params: args }));
	}

	/**
	 * Returns the primitive value of the GameObject instance.
	 * @returns The ID of the GameObject.
	 */
	public [Symbol.toPrimitive]() {
		return this.id;
	}

	public id: Identifier;
	public disposeFlag: boolean;

	protected _pos: vec3;
	public get pos(): vec3 { return this._pos; }
	public set pos(pos: vec3) { this._pos = pos; }
	public get x(): number { return this.pos.x; }
	/**
	 * Sets the x-coordinate of the object's position and handles collisions with tiles and screen edges.
	 * @param newx The new x-coordinate to set.
	 */
	public set x(x: number) {
		this.setPosX(x);
	}

	@update_tagged_components('position_update_axis')
	protected setPosX(x: number) {
		this.pos.x = x; // Set position here, as accessors cannot be decorated with update_tagged_components
	}

	public get y(): number { return this.pos.y; }
	/**
	 * Sets the x-coordinate of the object's position and handles collisions with tiles and screen edges.
	 * @param newx The new x-coordinate to set.
	 */
	public set y(y: number) {
		this.setPosY(y);
	}

	@update_tagged_components('position_update_axis')
	protected setPosY(y: number) {
		this.pos.y = y; // Set position here, as accessors cannot be decorated with update_tagged_components
	}

	public get z(): number { return this.pos.z; }
	public set z(z: number) {
		if (z < 0) z = 0;
		else if (z > ZCOORD_MAX) z = ZCOORD_MAX;
		this.setPosZ(z)
	}

	@update_tagged_components('position_update_axis')
	protected setPosZ(z: number) {
		this.pos.z = z; // Set position here, as accessors cannot be decorated with update_tagged_components
	}

	protected _size: vec3;
	public get size(): vec3 { return this._size; }
	public set size(value: vec3) { this._size = value; }

	public get sx(): number { return this.size.x; }
	public set sx(sx: number) { this.size.x = sx; }
	public get sy(): number { return this.size.y; }
	public set sy(sy: number) { this.size.y = sy; }
	public get sz(): number { return this.size.z; }
	public set sz(sz: number) { this.size.z = sz; }

	public get center(): vec2 {
		return new_vec2(this.x + this.size.x / 2, this.y + this.size.y / 2);
	}

	public get center_x(): number {
		return this.x + this.size.x / 2;
	}

	public get center_y(): number {
		return this.y + this.size.y / 2;
	}

	/**
	 * The StatemachineController of the game object.
	 */
	public sc: bfsm_controller;

	/**
	 * The mapping of behavior tree IDs to behavior tree IDs.
	 */
	public behaviortreeIds: { [id: BehaviorTreeID]: BehaviorTreeID };

	/**
	 * Gets the behavior trees associated with the game object.
	 * @returns An object containing the behavior trees.
	 */
	public get behaviortrees(): { [id: BehaviorTreeID]: BTNode } {
		return new Proxy(BehaviorTrees, {
			get: (target, prop: string) => {
				if (this.behaviortreeIds[prop]) {
					return target[prop];
				}
				return undefined;
			}
		});
	}

	/**
	 * The blackboards associated with the game object.
	 * @type {Object.<BehaviorTreeID, Blackboard>}
	 */
	public blackboards: { [name: BehaviorTreeID]: Blackboard };

	/**
	 * Executes the tick operation for the specified behavior tree.
	 * If the behavior tree or blackboard with the given ID does not exist, an error message is logged and the function returns.
	 * If an object tracker is available, it retrieves updates from the tracker and applies them to the blackboard before ticking the behavior tree.
	 *
	 * @param bt_id - The ID of the behavior tree to tick.
	 * @returns void
	 */
	public tickTree(bt_id: BehaviorTreeID): void {
		if (!this.behaviortrees[bt_id] || !this.blackboards[bt_id]) {
			console.error(`Behavior tree or blackboard with ID ${bt_id} does not exist.`);
			return;
		}

		// Get the updates from the ObjectTracker
		if (this.objectTracker) {
			let updates = this.objectTracker.getUpdates();

			// Apply the updates to the Blackboard
			this.blackboards[bt_id].applyUpdates(updates);
		}

		if ($.debug) {
			this.blackboards[bt_id].executionPath = [];
			this.behaviortrees[bt_id].debug_tick(this.id, this.blackboards[bt_id]);
		}
		else {
			this.behaviortrees[bt_id].tick(this.id, this.blackboards[bt_id]);
		}
	}

	/**
	 * Resets the tree with the specified BT_ID.
	 * If the blackboard with the given BT_ID does not exist, an error message is logged and the function returns.
	 * @param bt_id The ID of the blackboard to reset.
	 */
	public resetTree(bt_id: BehaviorTreeID): void {
		if (!this.blackboards[bt_id]) {
			console.error(`Blackboard with ID ${bt_id} does not exist.`);
			return;
		}
		this.blackboards[bt_id].clearAllNodeData();
	}

	public hitarea: Area;
	protected _boundingBoxes: Area[];
	// DARN: ON CREATING SAVEGAME, THIS WILL BE SAVED AND THEN LOADED IN THE GAMEOBJECT. THIS IS NOT WHAT WE WANT. WE WANT TO LOAD THE BOUNDING BOXES FROM THE IMG ASSET. THIS IS A TEMPORARY FIX AND THIS COMMENT IS GENERATED BY AICOPILOT, WHICH MEANS I AM NOT THE ONLY ONE FACING THIS ISSUE :-)
	public set boundingBoxes(boundingBoxes: Area[]) {
		this._boundingBoxes = boundingBoxes;
	}

	public hasBoundingBoxes(): boolean {
		return this._boundingBoxes && this._boundingBoxes.length > 0;
	}

	public get boundingBoxes(): Area[] {
		return this._boundingBoxes.map(box => new_area(box.start.x + this.x, box.start.y + this.y, box.end.x + this.x, box.end.y + this.y));
	}

	public hittable: boolean;
	public visible: boolean;

	/**
	 * Gets the hitbox area of the game object.
	 * If the hitbox is not initialized, it creates a new area using the provided coordinates.
	 * @returns The hitbox area of the game object.
	 */
	public get hitbox(): Area {
		return new_area(this.hitbox_left, this.hitbox_top, this.hitbox_right, this.hitbox_bottom);
	}

	public get middlepoint(): vec2 {
		return middlepoint_area(this.hitbox);
	}

	public get hitbox_left(): number {
		if (this.hitarea) return this.hitarea_left;
		return this.x;
	}

	public get hitbox_top(): number {
		if (this.hitarea) return this.hitarea_top;
		return this.y;
	}

	public get hitbox_right(): number {
		if (this.hitarea) return this.hitarea_right;
		return this.x_plus_width;
	}

	public get hitbox_bottom(): number {
		if (this.hitarea) return this.hitarea_bottom;
		return this.y_plus_height;
	}

	public get hitarea_left(): number {
		return this.pos.x + this.hitarea?.start.x ?? 0;
	}

	public get hitarea_top(): number {
		return this.pos.y + this.hitarea?.start.y ?? 0;
	}

	public get hitarea_right(): number {
		return this.pos.x + this.hitarea?.end.x ?? 0;
	}

	public get hitarea_bottom(): number {
		return this.pos.y + this.hitarea?.end.y ?? 0;
	}

	public get x_plus_width(): number {
		return this.pos.x + this.size?.x ?? 0;
	}

	public get y_plus_height(): number {
		return this.pos.y + this.size?.y ?? 0;
	}

	/**
	 * By default, will set location to `spawningPos` and
	 * the FSM-state to the initial state (if specified).
	 * @param spawningPos The position to spawn the object at.
	 */
	public onspawn(spawningPos?: Vector): void {
		if (spawningPos) {
			this.setXNoSweep(spawningPos.x ?? this.x);
			this.setYNoSweep(spawningPos.y ?? this.y);
			this.setZNoSweep((spawningPos as vec3).z ?? this.z);
		}

		// Call the method to initialize event subscriptions
		this.onLoadSetup();
		// Call the method to initialize linked state machines
		this.initializeLinkedFSMs();
		// Call the method to initialize linked behavior trees
		this.initializeBehaviorTrees();

		// Add components that should be auto-added to this class after the object has been spawned so that the component can retrieve the object via its id
		this.addAutoComponents();

		this.sc.start();
	}

	public dispose(): void {
		// Unsubscribe from events
		$.event_emitter.removeSubscriber(this);

		// Dispose of components
		const components = Object.values(this.components);
		components.forEach(component => this.removeComponent(component.constructor as ComponentConstructor<Component>)); // Remove the component from the game object and dispose (as part of the removal process)

		// Dispose all state machines
		this.sc.dispose();

		// Deregister the object from the entity registry
		$.registry.deregister(this);
	}

	public paint?(): void;
	public postpaint?(): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
	public onloaded?: () => void;

	/**
	* Gebruik ik als event handler voor e.g. onLeaveScreen
	*/
	public markForDisposal(): void {
		this.disposeFlag = true;
	}

	public oncollide?: (src: GameObject) => void;
	public onWallcollide?: (dir: Direction) => void;
	public onLeaveScreen?: (ik: GameObject, dir: Direction, old_x_or_y: number) => void;
	public onLeavingScreen?: (ik: GameObject, dir: Direction, old_x_or_y: number) => void;

	private _direction: Direction;
	public oldDirection: Direction;

	public get direction(): Direction {
		return this._direction;
	}

	public set direction(value: Direction) {
		this.oldDirection = this._direction;
		this._direction = value;
	}

	/**
	 * Generates a unique identifier for a game object.
	 * The generated identifier is a combination of the class name and a unique number.
	 * @returns The generated unique identifier.
	 */
	protected generateId(): string {
		const model = $.model;
		let result: string;
		do {
			const baseId = this.constructor.name;
			const uniqueNumber = $.model.getNextIdNumber();
			result = `${baseId}_${uniqueNumber}`;
		} while (model?.exists(result));
		return result;
	}

	/**
	 * @param id The id of the newly created object. If not given, defaults to generated id. @see {@link generateId}.
	 * @param fsm_id The id of the state machine that will be created for this object. Defaults to `this.constructor.name`. If there is no state machine with the given (default) name, the state machine factory will ensure that an "empty" state machine is created. @see {@link statecontext.create}.
	 */
	constructor(id?: string, fsm_id?: string) {
		this.id = id ?? this.generateId();
		this.hittable = DEFAULT_HITTABLE;
		this.visible = DEFAULT_VISIBLE;
		this.pos = new_vec3(...DEFAULT_POSITION_VALUES);
		this.size = new_vec3(...DEFAULT_SIZE_VALUES);
		this.disposeFlag = false;
		// Create the state context that will be used to manage the state of the game object
		this.sc = new bfsm_controller();
		this.sc.add_statemachine(fsm_id ?? this.constructor.name, this.id);
	}

	/**
	 * Adds auto components to the game object.
	 * Auto components are added based on the `autoAddComponents` property of the game object's constructor.
	 */
	private addAutoComponents() {
		if ((this.constructor as any).autoAddComponents) {
			for (const componentClass of (this.constructor as any).autoAddComponents) {
				this.addComponent(new componentClass(this.id));
			}
		}
	}

	@onload
	onLoadSetup() {
		$.event_emitter.initClassBoundEventSubscriptions(this);
	}

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

	protected initializeBehaviorTrees() {
		// Get the constructor of the current instance
		const constructor = this.constructor as ConstructorWithBTProperty;
		this.behaviortreeIds = {};
		this.blackboards = {};

		// Check if the constructor has the 'linkedBTs' property
		if (constructor.linkedBTs) {
			// Iterate over the behavior tree names and create the behavior trees
			constructor.linkedBTs.forEach(bt_id => {
				let blackboard = new Blackboard(bt_id);
				this.blackboards[bt_id] = blackboard;
				this.behaviortreeIds[bt_id] = bt_id;
			});
		}
	}

	/**
	 * Calls the `oncollide` event handler with the given `GameObject` instance as the source of the collision.
	 * @param src The `GameObject` instance that collided with this instance.
	 */
	public collide(src: GameObject): void {
		this.oncollide?.(src);
	}

	/**
	 * Checks if this GameObject collides with another GameObject or Area.
	 * If the given object is a GameObject, it checks if any of the bounding boxes of the two objects overlap.
	 * If the given object is an Area, it checks if any of the bounding boxes of this object overlap with the given area.
	 * If this object does not have bounding boxes, it checks if the given area overlaps with this object.
	 * If neither object has bounding boxes, it checks if the objects overlap.
	 * For optimization, it first checks if the objects overlap using an Axis-Aligned Bounding Box (AABB) test. If the objects overlap, it performs a more expensive collision detection algorithm.
	 * @param o The GameObject or Area to check collision with.
	 * @returns True if a collision occurs, false otherwise.
	 */
	public collides(o: GameObject | Area): false | Area {
		if (!this.hittable) return false; // If this object is not hittable, it cannot collide with anything
		if ((o as GameObject).id) { // If the given object has an id, it is a GameObject
			const other = o as GameObject; // Cast the object to a GameObject
			if (!other.hittable) return false; // If the other object is not hittable, it cannot collide with anything

			// Broad-phase collision detection: AABB test
			if (!this.detect_aabb_collision_area(other.hitbox)) {
				return false;
			}

			if (this.hasBoundingBoxes() && other.hasBoundingBoxes()) { // If both objects have bounding boxes, check if any of the bounding boxes overlap
				for (const box1 of this.boundingBoxes) { // Iterate over the bounding boxes of this object
					for (const box2 of other.boundingBoxes) { // Iterate over the bounding boxes of the other object
						if (GameObject.detect_aabb_collision_areas(box1, box2)) { // If the bounding boxes overlap, return true
							return GameObject.get_overlap_area(box1, box2);
						}
					}
				}
				return false; // If none of the bounding boxes overlap, return false
			} else if (this.hasBoundingBoxes()) { // If only this object has bounding boxes, check if any of the bounding boxes overlap with the other object
				for (const box of this.boundingBoxes) { // Iterate over the bounding boxes of this object
					if (other.detect_aabb_collision_area(box)) { // If the bounding boxes overlap, return true
						return GameObject.get_overlap_area(box, other.hitbox);
					}
				}
				return false; // If none of the bounding boxes overlap, return false
			} else if (other.hasBoundingBoxes()) { // If only the other object has bounding boxes, check if any of the bounding boxes overlap with this object
				for (const box of other.boundingBoxes) { // Iterate over the bounding boxes of the other object
					if (this.detect_aabb_collision_area(box)) { // If the bounding boxes overlap, return true
						return GameObject.get_overlap_area(this.hitbox, box);
					}
				}
				return false; // If none of the bounding boxes overlap, return false
			} else {
				return this.detect_object_collision(other) ? GameObject.get_overlap_area(this.hitbox, other.hitbox) : false; // If neither object has bounding boxes, check if the objects overlap
			}
		} else {
			// Broad-phase collision detection: AABB test
			if (!this.detect_aabb_collision_area(o as Area)) {
				return false;
			}
			if (this.hasBoundingBoxes()) { // If this object has bounding boxes, check if any of the bounding boxes overlap with the given area
				for (const box of this.boundingBoxes) { // Iterate over the bounding boxes of this object
					if (GameObject.detect_aabb_collision_areas(box, o as Area)) { // If the bounding boxes overlap, return true
						return GameObject.get_overlap_area(box, o as Area);
					}
				}
				return false; // If none of the bounding boxes overlap, return false
			} else {
				return this.detect_aabb_collision_area(o as Area) ? o as Area : false; // If this object does not have bounding boxes and the other object is an area, check if the given area overlaps with this object
			}
		}
	}

	/**
	 * Determines if the current `GameObject` instance collides with another `GameObject` instance.
	 * Detects Axis-Aligned Bounding Box collision (AABB).
	 * @param o The `GameObject` instance to check for collision.
	 * @returns `true` if the current instance collides with the given instance, `false` otherwise.
	 */
	public detect_object_collision(o: GameObject): boolean {
		if (!this.hittable || !o.hittable) return false;
		return GameObject.detect_aabb_collision_areas(this.hitbox, o.hitbox);
	}

	/**
	 * Calculates the overlap area between two areas.
	 * @param a The first area.
	 * @param b The second area.
	 * @returns The overlap area between the two areas.
	 */
	private static get_overlap_area(a: Area, b: Area): Area {
		const startX = Math.max(a.start.x, b.start.x);
		const startY = Math.max(a.start.y, b.start.y);
		const endX = Math.min(a.end.x, b.end.x);
		const endY = Math.min(a.end.y, b.end.y);
		return new_area(startX, startY, endX, endY);
	}

	public static detect_aabb_collision_areas(a1: Area, a2: Area): boolean {
		return !(a1.start.x > a2.end.x || a1.end.x < a2.start.x || a1.end.y < a2.start.y || a1.start.y > a2.end.y);
	}

	/**
	 * Determines if the current `GameObject` instance collides with an `Area` instance.
	 * Detects Axis-Aligned Bounding Box collision (AABB).
	 * @param a The `Area` instance to check for collision.
	 * @returns `true` if the current instance collides with the given instance, `false` otherwise.
	 */
	public detect_aabb_collision_area(a: Area): boolean {
		return GameObject.detect_aabb_collision_areas(this.hitbox, a);
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
	 * Sets the x-coordinate of the object's position without triggering component updates (sweeping).
	 *
	 * @param newx - The new x-coordinate value.
	 */
	public setXNoSweep(newx: number) {
		this.pos.x = ~~newx;
	}

	/**
	 * Sets the y-coordinate of the object's position without triggering component updates (sweeping).
	 *
	 * @param newy - The new y-coordinate value.
	 */
	public setYNoSweep(newy: number) {
		this.pos.y = ~~newy;
	}

	/**
	 * Sets the z-coordinate of the object's position without triggering component updates (sweeping).
	 *
	 * @param newz - The new z-coordinate value.
	 */
	public setZNoSweep(newz: number) {
		this.pos.z = ~~newz;
	}

	/**
	 * Moves the game object horizontally without performing any collision detection or resolution.
	 * @param dx - The amount to move the game object along the x-axis.
	 */
	public moveXNoSweep(dx: number) {
		this.setXNoSweep(this.x + dx);
	}

	/**
	 * Moves the game object vertically without sweeping.
	 * @param dy - The amount to move along the Y-axis.
	 */
	public moveYNoSweep(dy: number) {
		this.setYNoSweep(this.y + dy);
	}

	/**
	 * Moves the game object along the Z-axis without performing any collision checks.
	 * @param dz - The amount to move along the Z-axis.
	 */
	public moveZNoSweep(dz: number) {
		this.setZNoSweep(this.z + dz);
	}

	/**
	 * Runs the game object by updating its components and running its state.
	 */
	@update_tagged_components('run')
	public run(): void {
		for (const bt_id in this.behaviortreeIds) {
			this.tickTree(bt_id);
		}
		this.sc.run();
	}
}

export type GameObjectConstructorBase = new (_id?: Identifier, _fsm_id?: string, ...args: any[]) => GameObject;
export type GameObjectConstructorBaseOrAbstract = GameObjectConstructorBase | AbstractConstructor<GameObject>;

/**
 * Represents a constructor for the GameObject.
 * @typeparam T - The type of the GameObject.
 */
export type GameObjectConstructorWithComponentList = GameObjectConstructorBaseOrAbstract & IGameObjectStatic;
