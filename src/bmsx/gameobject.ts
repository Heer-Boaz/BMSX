import { BehaviorTreeID, BehaviorTrees, Blackboard, BTNode, ConstructorWithBTProperty } from "./behaviourtree";
import { Component, ComponentConstructor, ComponentTag, IComponentContainer, KeyToComponentMap, update_tagged_components } from "./component";
import { StateMachineController } from "./fsm";
import type { ConstructorWithFSMProperty, IStateful } from "./fsmtypes";
import type { Identifier } from "./game";
import { AbstractConstructor, Direction, middlepoint_area, new_area, new_vec2, new_vec3 } from "./game";
import { insavegame, onload } from "./gameserializer";
import { ZCOORD_MAX } from "./glview";
import { ObjectTracker } from "./objecttracker";
import { Area, vec2, vec3, Vector } from "./rompack";

const DEFAULT_HITTABLE = true;
const DEFAULT_VISIBLE = true;
const DEFAULT_POSITION_VALUES: [number, number, number] = [0, 0, 0];
const DEFAULT_SIZE_VALUES: [number, number, number] = [0, 0, 0];

/**
 * Represents a game object with a position, size, state, and hitbox.
 * Implements both vec2 and vec3 interfaces.
 */
@insavegame
export class GameObject implements vec3, IComponentContainer, IStateful {
	/**
	 * Represents a map of components associated with their respective keys.
	 */
	public components: KeyToComponentMap = {};
	/**
	 * The object tracker for the game object.
	 */
	public objectTracker?: ObjectTracker;

	/**
	 * Retrieves a component of the specified type from the game object.
	 *
	 * @template T - The type of the component to retrieve.
	 * @param constructor - The constructor function of the component.
	 * @returns The component of the specified type if found, otherwise undefined.
	 */
	getComponent<T extends Component>(constructor: ComponentConstructor<T>): T | undefined {
		return this.components[constructor.name] as T | undefined;
	}

	/**
	 * Adds a component to the game object.
	 *
	 * @template T - The type of the component.
	 * @param {T} component - The component to be added.
	 * @returns {void}
	 */
	addComponent<T extends Component>(component: T): void {
		this.components[component.constructor.name] = component;
	}

	/**
	 * Removes a component from the game object.
	 *
	 * @template T - The type of the component to remove.
	 * @param constructor - The constructor of the component to remove.
	 * @returns void
	 */
	removeComponent<T extends Component>(constructor: ComponentConstructor<T>): void {
		const component = this.components[constructor.name];
		if (!component) return;
		component.dispose();
		delete this.components[constructor.name];
	}

	/**
	 * Updates the components with the given tag.
	 * The components are updated in two phases: preprocessing and postprocessing.
	 * The preprocessing update is performed first, followed by the postprocessing update
	 * with the given arguments.
	 * The components are filtered based on the specified tag. Only components with the
	 * specified tags will be updated.
	 * Note that the tags are different for preprocessing and postprocessing updates, allowing
	 * for more fine-grained control over the update process.
	 *
	 * @param {ComponentTag} tag - The tag to filter components.
	 * @param {...any} args - Additional arguments to pass to the component update methods.
	 * @returns {void}
	 */
	updateComponentsWithTag(tag: ComponentTag, ...args: any[]): void {
		// Update components with the given tag (preprocessing)
		Object.values(this.components).filter(component => component.hasPreprocessingTag(tag)).forEach(component => component.enabled && component.preprocessingUpdate(...args));

		// TODO: I BELIEVE THIS IS A BUG. THE IS NO DISTINGUISHING BETWEEN PREPROCESSING AND POSTPROCESSING IF CALLING THIS METHOD DIRECTLY.
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

	/**
	 * The identifier of the game object, which is a unique string that is generated based on the class name and a unique number.
	 */
	public id: Identifier;
	/**
	 * Indicates whether the object is flagged for disposal.
	 * If true, the object will be disposed of at the end of the game's current update cycle.
	 */
	public disposeFlag: boolean;

	protected _pos: vec3;
	public get pos(): vec3 { return this._pos; }
	/**
	 * The position of the game object. The position is represented as a 3D vector with x, y, and z coordinates.
	 * The z-coordinate is used for layering objects in the game world.
	 * see {@link setPosZ} for setting the z-coordinate, as it handles the z-coordinate bounds.
	 */
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
	/**
	 * Sets the X position of the game object.
	 * This method is called by the setter for the related property to allow for decorating the method with the `update_tagged_components` decorator, as accessors cannot be decorated directly.
	 *
	 * @param x - The new X position value.
	 */
	protected setPosX(x: number) {
		this.pos.x = x; // Set position here, as accessors cannot be decorated with update_tagged_components
	}

	public get y(): number { return this.pos.y; }

	/**
	 * Sets the y-coordinate of the object's position and handles collisions with tiles and screen edges.
	 * @param y The new y-coordinate to set.
	 */
	public set y(y: number) {
		this.setPosY(y);
	}

	@update_tagged_components('position_update_axis')
	/**
	 * Sets the Y position of the game object.
	 * This method is called by the setter for the related property to allow for decorating the method with the `update_tagged_components` decorator, as accessors cannot be decorated directly.
	 *
	 * @param y - The new Y position value.
	 */
	protected setPosY(y: number) {
		this.pos.y = y; // Set position here, as accessors cannot be decorated with update_tagged_components
	}

	public get z(): number { return this.pos.z; }
	/**
	 * Sets the z-coordinate of the game object. The z-coordinate is used for layering objects in the game world.
	 * The z-coordinate is clamped between 0 and ZCOORD_MAX.
	 *
	 * @param z - The new z-coordinate value.
	 */
	public set z(z: number) {
		if (z < 0) z = 0;
		else if (z > ZCOORD_MAX) z = ZCOORD_MAX;
		this.setPosZ(z)
	}

	@update_tagged_components('position_update_axis')
	/**
	 * Sets the Z position of the game object.
	 * This method is called by the setter for the related property to allow for decorating the method with the `update_tagged_components` decorator, as accessors cannot be decorated directly.
	 *
	 * @param z - The new Z position value.
	 */
	protected setPosZ(z: number) {
		this.pos.z = z; // Set position here, as accessors cannot be decorated with update_tagged_components
	}

	/**
	 * The size of the game object. The size is represented as a 3D vector with x, y, and z coordinates.
	 * Note that the size is only used for collision detection if the game object has no collision area and
	 * no bounding boxes. If the game object has a collision area or bounding boxes, the size is not used for collision detection.
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
	public sc: StateMachineController;

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
		const tree = this.behaviortrees[bt_id];
		const blackboard = this.blackboards[bt_id];
		if (!tree || !blackboard) {
			console.error(`Behavior tree or blackboard with ID ${bt_id} does not exist.`);
			return;
		}

		if (!tree.isRunning) {
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
		if (!this.blackboards[bt_id]) {
			console.error(`Blackboard with ID ${bt_id} does not exist.`);
			return;
		}
		this.blackboards[bt_id].clearAllNodeData();
	}

	public hitarea: Area;

	protected _hitpolygon: vec2[][];
	// DARN: ON CREATING SAVEGAME, THIS WILL BE SAVED AND THEN LOADED IN THE GAMEOBJECT. THIS IS NOT WHAT WE WANT. WE WANT TO LOAD THE HIT-POLYGON FROM THE IMG ASSET. THIS IS A TEMPORARY FIX AND THIS COMMENT IS GENERATED BY AICOPILOT, WHICH MEANS I AM NOT THE ONLY ONE FACING THIS ISSUE :-)
	public set hitpolygon(polys: vec2[][]) {
		this._hitpolygon = polys;
	}

	/**
	 * Gets the hit polygon of the game object.
	 * The hit polygon is an array of polygons, where each polygon is represented as an array of points (vec2).
	 * The points are offset by the current position of the game object.
	 * @returns The hit polygon as an array of 2D points.
	 */
	public get hitpolygon(): vec2[][] {
		if (!this._hitpolygon) return undefined;
		// Offset polygons by current position
		return this._hitpolygon.map(poly => poly.map(pt => ({ x: pt.x + this.x, y: pt.y + this.y, z: this.z })));
	}

	/**
	 * Checks if the game object has a hit polygon defined.
	 * The reason to have this check is to avoid unnecessary calculations before translating the hit polygon to account for the current position of the game object.
	 * @returns True if the game object has a hit polygon, false otherwise.
	 */
	public get hasHitPolygon(): boolean {
		return this._hitpolygon && this._hitpolygon.length > 0;
	}

	/**
	 * Indicates whether the object is hittable. If false, collision detection will be skipped and always return false.
	 */
	public hittable: boolean;
	/**
	 * Indicates whether the game object should be rendered or not.
	 */
	public visible: boolean;

	/**
	 * Gets the hitbox area of the game object.
	 * If the hitbox is not initialized, it creates a new area using the provided coordinates.
	 * If there is no hitbox and no bounding boxes, it returns an area based on the position and size of the game object.
	 * @returns The hitbox area of the game object.
	 */
	public get hitbox(): Area {
		return new_area(this.hitbox_left, this.hitbox_top, this.hitbox_right, this.hitbox_bottom);
	}

	/**
	 * Returns the middle point of the game object's hitbox.
	 *
	 * @returns The middle point as a `vec2` object.
	 */
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
		return this.pos.x + (this.hitarea?.start.x ?? 0);
	}

	public get hitarea_top(): number {
		return this.pos.y + (this.hitarea?.start.y ?? 0);
	}

	public get hitarea_right(): number {
		return this.pos.x + (this.hitarea?.end.x ?? 0);
	}

	public get hitarea_bottom(): number {
		return this.pos.y + (this.hitarea?.end.y ?? 0);
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
	public onspawn(spawningPos?: Vector): void {
		if (spawningPos) {
			this.setXNoSweep(spawningPos.x ?? this.x);
			this.setYNoSweep(spawningPos.y ?? this.y);
			this.setZNoSweep((spawningPos as vec3).z ?? this.z);
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

		this.sc.start();
	}

	/**
	 * Dispose method for the game object.
	 *
	 * This method performs the following actions:
	 * 1. Unsubscribes from events.
	 * 2. Disposes of all components attached to the game object.
	 * 3. Disposes all state machines.
	 * 4. Deregisters the object from the entity registry.
	 */
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

	/**
	 * Abstract method that is called when the game object should be painted as part of the game loop.
	 */
	public paint?(): void;
	/**
	 * Abstract method that is called after the game object has been painted as part of the game loop.
	 * This method is used for post-processing effects such as lighting effects.
	 */
	public postpaint?(): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite

	/**
	* Gebruik ik als event handler voor e.g. onLeaveScreen
	*/
	public markForDisposal(): void {
		this.disposeFlag = true;
	}

	/**
	 * Represents a callback function that is triggered when a collision occurs with another GameObject.
	 *
	 * @param src - The GameObject that triggered the collision.
	 */
	public oncollide?: (src: GameObject) => void;
	/**
	 * Callback function that is triggered when the game object collides with a wall.
	 * @param dir - The direction of the collision.
	 */
	public onWallcollide?: (dir: Direction) => void;
	/**
	 * Callback function that is called when the GameObject leaves the screen.
	 *
	 * @param ik - The GameObject that is leaving the screen.
	 * @param dir - The direction in which the GameObject is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the GameObject before leaving the screen.
	 */
	public onLeaveScreen?: (ik: GameObject, dir: Direction, old_x_or_y: number) => void;
	/**
	 * Callback function that is triggered when the game object is leaving the screen.
	 *
	 * @param ik - The game object that is leaving the screen.
	 * @param dir - The direction in which the game object is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the game object before leaving the screen.
	 */
	public onLeavingScreen?: (ik: GameObject, dir: Direction, old_x_or_y: number) => void;

	private _direction: Direction;
	public oldDirection: Direction;

	/**
	 * Gets the direction of the game object.
	 *
	 * @returns The direction of the game object.
	 */
	public get direction(): Direction {
		return this._direction;
	}

	/**
	 * Sets the direction of the game object.
	 *
	 * @param value - The new direction to set.
	 */
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
		this.sc = new StateMachineController();
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

	/**
	 * Initializes the setup for the onLoad event.
	 */
	@onload
	onLoadSetup() {
		$.event_emitter.initClassBoundEventSubscriptions(this); // Initialize event subscriptions for the class.
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
	 * Initializes the behavior trees for the game object.
	 *
	 * This method creates behavior trees based on the 'linkedBTs' property of the constructor.
	 * It iterates over the behavior tree names and creates the behavior trees along with their associated blackboards.
	 *
	 * @remarks
	 * This method should be called during the initialization of the game object.
	 */
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
	 * Checks if this GameObject collides with another GameObject or Area or polygon.
	 * Supports polygon-polygon, polygon-box, and box-polygon collision.
	 * Falls back to bounding box logic if polygons are not present.
	 * @param o The GameObject or Area to check collision with.
	 * @returns True if a collision occurs, false otherwise.
	 */
	public collides(o: GameObject | Area): false | Area {
		if (!this.hittable) return false;
		const isGameObject = (obj: any): obj is GameObject => typeof obj === 'object' && 'id' in obj;
		const areaToPoly = (area: Area) => [
			{ x: area.start.x, y: area.start.y },
			{ x: area.end.x, y: area.start.y },
			{ x: area.end.x, y: area.end.y },
			{ x: area.start.x, y: area.end.y }
		];

		if (isGameObject(o)) {
			const other = o as GameObject;
			if (!other.hittable) return false;
			// Quick AABB reject
			// Quick hitbox reject using precomputed bounding boxes
			if (!GameObject.detect_aabb_collision_areas(this.hitbox, other.hitbox)) return false;

			if (this.hasHitPolygon && other.hasHitPolygon) {
				for (const poly1 of this.hitpolygon) {
					for (const poly2 of other.hitpolygon) {
						if (GameObject.polygonsIntersect(poly1, poly2)) {
							// Return the overlap AABB of the two polygons
							const aabb1 = GameObject.polygonAABB(poly1);
							const aabb2 = GameObject.polygonAABB(poly2);
							return GameObject.get_overlap_area(aabb1, aabb2);
						}
					}
				}
				return false;
			}
			// If only one has polygons, convert the other's hitbox to a polygon
			else if (this.hasHitPolygon) {
				const otherPoly = areaToPoly(other.hitbox);
				for (const poly1 of this.hitpolygon) {
					if (GameObject.polygonsIntersect(poly1, otherPoly)) {
						const aabb1 = GameObject.polygonAABB(poly1);
						const aabb2 = GameObject.polygonAABB(otherPoly);
						return GameObject.get_overlap_area(aabb1, aabb2);
					}
				}
				return false;
			} else if (other.hasHitPolygon) {
				const thisPoly = areaToPoly(this.hitbox);
				for (const poly2 of other.hitpolygon) {
					if (GameObject.polygonsIntersect(thisPoly, poly2)) {
						const aabb1 = GameObject.polygonAABB(thisPoly);
						const aabb2 = GameObject.polygonAABB(poly2);
						return GameObject.get_overlap_area(aabb1, aabb2);
					}
				}
				return false;
			}
			// Fallback: both are rectangles, do simple AABB overlap check
			else return GameObject.get_overlap_area(this.hitbox, other.hitbox);
		} else {
			// o is Area

			// Quick AABB reject
			if (!GameObject.detect_aabb_collision_areas(this.hitbox, o as Area)) return false;

			// If this has polygons and the other is an area, convert the area to a polygon
			if (this.hasHitPolygon) {
				const areaPoly = areaToPoly(o as Area);
				for (const poly of this.hitpolygon) {
					if (GameObject.polygonsIntersect(poly, areaPoly)) {
						const aabb1 = GameObject.polygonAABB(poly);
						const aabb2 = GameObject.polygonAABB(areaPoly);
						return GameObject.get_overlap_area(aabb1, aabb2);
					}
				}
				return false;
			}
			// Fallback: both are rectangles, do simple AABB overlap check
			else return GameObject.get_overlap_area(this.hitbox, o as Area);
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
	 * Determines if the current `GameObject` instance collides with an `Area` instance.
	 * Detects Axis-Aligned Bounding Box collision (AABB).
	 * @param a The `Area` instance to check for collision.
	 * @returns `true` if the current instance collides with the given instance, `false` otherwise.
	 */
	public detect_aabb_collision_area(a: Area): boolean {
		return GameObject.detect_aabb_collision_areas(this.hitbox, a);
	}

	/**
	 * Polygon-polygon intersection for arbitrary (concave) simple polygons using edge intersection and point-in-polygon tests.
	 */
	static polygonsIntersect(poly1: vec2[], poly2: vec2[]): boolean {
		// Helper to test segment intersection
		const segmentsIntersect = (p1: vec2, p2: vec2, q1: vec2, q2: vec2): boolean => {
			const orient = (a: vec2, b: vec2, c: vec2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
			const o1 = orient(p1, p2, q1);
			const o2 = orient(p1, p2, q2);
			const o3 = orient(q1, q2, p1);
			const o4 = orient(q1, q2, p2);
			if (o1 * o2 < 0 && o3 * o4 < 0) return true;
			// Colinearity checks
			const onSegment = (a: vec2, b: vec2, c: vec2) => c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x)
				&& c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
			if (o1 === 0 && onSegment(p1, p2, q1)) return true;
			if (o2 === 0 && onSegment(p1, p2, q2)) return true;
			if (o3 === 0 && onSegment(q1, q2, p1)) return true;
			if (o4 === 0 && onSegment(q1, q2, p2)) return true;
			return false;
		};
		// Check edge intersections
		for (let i = 0; i < poly1.length; i++) {
			const a1 = poly1[i], a2 = poly1[(i + 1) % poly1.length];
			for (let j = 0; j < poly2.length; j++) {
				const b1 = poly2[j], b2 = poly2[(j + 1) % poly2.length];
				if (segmentsIntersect(a1, a2, b1, b2)) return true;
			}
		}
		// Ray-casting point-in-polygon
		const pointInPoly = (pt: vec2, poly: vec2[]): boolean => {
			let inside = false;
			for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
				const xi = poly[i].x, yi = poly[i].y;
				const xj = poly[j].x, yj = poly[j].y;
				const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
					pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi;
				if (intersect) inside = !inside;
			}
			return inside;
		};
		// One polygon inside the other
		if (pointInPoly(poly1[0], poly2)) return true;
		if (pointInPoly(poly2[0], poly1)) return true;
		return false;
	}

	/**
	 * Polygon-AABB intersection using SAT.
	 */
	static polygonAABBIntersect(poly: vec2[], box: Area): boolean {
		// Convert box to polygon
		const boxPoly = [
			{ x: box.start.x, y: box.start.y },
			{ x: box.end.x, y: box.start.y },
			{ x: box.end.x, y: box.end.y },
			{ x: box.start.x, y: box.end.y }
		];
		return GameObject.polygonsIntersect(poly, boxPoly);
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

// A type representing a constructor for GameObject instances.
// It takes optional parameters _id and _fsm_id, and any additional arguments.
export type GameObjectConstructorBase = new (_id?: Identifier, _fsm_id?: string, ...args: any[]) => GameObject;

// A type representing either a concrete GameObject constructor or an abstract constructor for GameObject.
export type GameObjectConstructorBaseOrAbstract = GameObjectConstructorBase | AbstractConstructor<GameObject>;
