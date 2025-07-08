import { BehaviorTreeID, BehaviorTrees, Blackboard, BTNode, ConstructorWithBTProperty } from "./behaviourtree";
import { Component, ComponentConstructor, ComponentContainer, ComponentTag, KeyToComponentMap, update_tagged_components } from "./component";
import { StateMachineController } from "./fsm/fsm";
import type { ConstructorWithFSMProperty, Stateful } from "./fsm/fsmtypes";
import type { Identifier } from "./game";
import { AbstractConstructor, Direction, middlepoint_area, new_area, new_vec2, new_vec3 } from "./game";
import { ZCOORD_MAX } from "./glview";
import { ObjectTracker } from "./objecttracker";
import { Area, vec2, vec3, Vector, type vec2arr } from "./rompack";
import { insavegame, onload } from "./serializer/gameserializer";

const DEFAULT_HITTABLE = true;
const DEFAULT_VISIBLE = true;
const DEFAULT_POSITION_VALUES: [number, number, number] = [0, 0, 0];
const DEFAULT_SIZE_VALUES: [number, number, number] = [0, 0, 0];

/**
 * Represents a game object with a position, size, state, and hitbox.
 * Implements both vec2 and vec3 interfaces.
 */
@insavegame
export class GameObject implements vec3, ComponentContainer, Stateful {
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

	protected _hitpolygon: vec2arr[][];
	// DARN: ON CREATING SAVEGAME, THIS WILL BE SAVED AND THEN LOADED IN THE GAMEOBJECT. THIS IS NOT WHAT WE WANT. WE WANT TO LOAD THE HIT-POLYGON FROM THE IMG ASSET. THIS IS A TEMPORARY FIX AND THIS COMMENT IS GENERATED BY AICOPILOT, WHICH MEANS I AM NOT THE ONLY ONE FACING THIS ISSUE :-)
	public set hitpolygon(polys: vec2arr[][]) {
		this._hitpolygon = polys;
	}

	/**
	 * Gets the hit polygon of the game object.
	 * The hit polygon is an array of polygons, where each polygon is represented as an array of points (vec2).
	 * The points are offset by the current position of the game object.
	 * @returns The hit polygon as an array of 2D points.
	 */
	public get hitpolygon(): vec2arr[][] {
		if (!this._hitpolygon) return undefined;
		// Offset polygons by current position, but only return [x, y] as required by vec2arr
		return this._hitpolygon.map(poly => poly.map(pt => ([pt[0] + this.x, pt[1] + this.y] as [number, number])));
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
	public collides(o: GameObject | Area): boolean {
		if (!this.hittable) return false;
		const isGameObject = (obj: any): obj is GameObject => typeof obj === 'object' && 'id' in obj;
		const areaToPoly = (area: Area) => [
			[area.start.x, area.start.y],
			[area.end.x, area.start.y],
			[area.end.x, area.end.y],
			[area.start.x, area.end.y]
		] as vec2arr[];

		if (isGameObject(o)) {
			const other = o as GameObject;
			if (!other.hittable) return false;
			// Quick hitbox reject using precomputed bounding boxes
			if (!GameObject.detect_aabb_collision_areas(this.hitbox, other.hitbox)) return false;

			// If one of the objects has polygons, check polygon collision
			if (this.hasHitPolygon || other.hasHitPolygon) {
				// If this object has polygons, use them; otherwise convert its hitbox to a polygon
				const thisPoly = this.hasHitPolygon ? this.hitpolygon : [areaToPoly(this.hitbox)];
				// If the other object has polygons, use them; otherwise convert its hitbox to a polygon
				const otherPoly = other.hasHitPolygon ? other.hitpolygon : [areaToPoly(other.hitbox)];

				// Check for polygon intersection
				for (const poly1 of thisPoly) {
					for (const poly2 of otherPoly) {
						if (GameObject.polygonsIntersect([poly1], [poly2])) return true;
					}
				}
				// If no polygons intersect, return false
				return false;
			}
			else return true; // AABB collision already checked above
		} else {
			// o is Area

			// Quick hitbox reject using precomputed bounding boxes
			if (!GameObject.detect_aabb_collision_areas(this.hitbox, o as Area)) return false;

			// If this has polygons and the other is an area, convert the area to a polygon
			if (this.hasHitPolygon) {
				const areaPoly = areaToPoly(o as Area);
				for (const poly of this.hitpolygon) {
					if (GameObject.polygonsIntersect([poly], [areaPoly])) {
						return true;
					}
				}
				return false;
			}
			// Fallback: both are rectangles, do simple AABB overlap check, which is already done above
			return true; // AABB collision already checked above
		}
	}

	public getCollisionCentroid(o: GameObject): vec2arr | null {
		if (!this.hittable || !o.hittable) return null;
		const isGameObject = (obj: any): obj is GameObject => typeof obj === 'object' && 'id' in obj;
		const areaToPoly = (area: Area) => [
			[area.start.x, area.start.y],
			[area.end.x, area.start.y],
			[area.end.x, area.end.y],
			[area.start.x, area.end.y]
		] as vec2arr[];

		if (isGameObject(o)) {
			const other = o as GameObject;
			// Quick hitbox reject using precomputed bou`nding boxes
			if (!GameObject.detect_aabb_collision_areas(this.hitbox, other.hitbox)) return null;

			// If one of the objects has polygons, check polygon collision
			if (this.hasHitPolygon || other.hasHitPolygon) {
				// If this object has polygons, use them; otherwise convert its hitbox to a polygon
				const thisPoly = this.hasHitPolygon ? this.hitpolygon : [areaToPoly(this.hitbox)];
				// If the other object has polygons, use them; otherwise convert its hitbox to a polygon
				const otherPoly = other.hasHitPolygon ? other.hitpolygon : [areaToPoly(other.hitbox)];

				// Check for polygon intersection
				const points = GameObject.polygonsIntersectionPoints(thisPoly, otherPoly);
				if (points) {
					return GameObject.getCentroidFromListOfIntersectionPoints(points);
				}
				return null; // No intersection points found
			}
		}

		console.warn(`'getCollisionCentroid' called by or with a GameObject that doesn't have hitpolygons, which is not supported yet. this='${this.id}', o='${o.id}'.`);
		return null; // No polygons to check, so no centroid can be calculated
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
	 * Determines whether two sets of polygons intersect.
	 *
	 * This function checks for intersection between two sets of polygons (arrays of polygons),
	 * using edge intersection and point-in-polygon tests.
	 *
	 * @param polys1 - An array of polygons (each polygon is an array of vec2 points).
	 * @param polys2 - An array of polygons (each polygon is an array of vec2 points).
	 * @returns `true` if any polygons intersect or one is inside the other, otherwise `false`.
	 */
	static polygonsIntersect(polys1: vec2arr[][], polys2: vec2arr[][]): boolean {
		for (const poly1 of polys1) {
			for (const poly2 of polys2) {
				if (GameObject.singlePolygonsIntersect(poly1, poly2)) return true;
			}
		}
		return false;
	}

	/**
	 * Determines whether two single polygons intersect (internal helper).
	 */
	private static singlePolygonsIntersect(poly1: vec2arr[], poly2: vec2arr[]): boolean {
		function orient(a: vec2arr, b: vec2arr, c: vec2arr) {
			// Returns a positive value if c is to the left of the line from a to b,
			// a negative value if c is to the right, and zero if collinear.
			// This is the 2D cross product of vectors (b - a) and (c - a).
			// This is equivalent to the determinant of the matrix formed by the vectors.
			// | b.x - a.x  b.y - a.y |
			// | c.x - a.x  c.y - a.y |
			// The result is positive if c is to the left of the line, negative if to the right, and zero if collinear.
			return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
		}
		function onSegment(a: vec2arr, b: vec2arr, c: vec2arr) {
			return c[0] >= Math.min(a[0], b[0]) && c[0] <= Math.max(a[0], b[0])
				&& c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1]);
		}
		const n1 = poly1.length, n2 = poly2.length;
		for (let i = 0; i < n1; ++i) {
			const a1 = poly1[i], a2 = poly1[(i + 1 === n1) ? 0 : i + 1];
			for (let j = 0; j < n2; ++j) {
				const b1 = poly2[j], b2 = poly2[(j + 1 === n2) ? 0 : j + 1];
				const o1 = orient(a1, a2, b1);
				const o2 = orient(a1, a2, b2);
				const o3 = orient(b1, b2, a1);
				const o4 = orient(b1, b2, a2);
				if (o1 * o2 < 0 && o3 * o4 < 0) return true;
				if (o1 === 0 && onSegment(a1, a2, b1)) return true;
				if (o2 === 0 && onSegment(a1, a2, b2)) return true;
				if (o3 === 0 && onSegment(b1, b2, a1)) return true;
				if (o4 === 0 && onSegment(b1, b2, a2)) return true;
			}
		}
		function pointInPoly(pt: vec2arr, poly: vec2arr[]): boolean {
			let inside = false;
			for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
				const xi = poly[i][0], yi = poly[i][1];
				const xj = poly[j][0], yj = poly[j][1];
				if (((yi > pt[1]) !== (yj > pt[1])) &&
					(pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi)) {
					inside = !inside;
				}
			}
			return inside;
		}
		if (pointInPoly(poly1[0], poly2)) return true;
		if (pointInPoly(poly2[0], poly1)) return true;
		return false;
	}

	/**
	 * Returns all intersection points between two sets of polygons (arrays of polygons).
	 *
	 * @param polys1 - An array of polygons (each polygon is an array of vec2 points).
	 * @param polys2 - An array of polygons (each polygon is an array of vec2 points).
	 * @returns Array of intersection points (vec2).
	 */
	static polygonsIntersectionPoints(polys1: vec2arr[][], polys2: vec2arr[][]): vec2arr[] | null {
		const intersections: vec2arr[] = [];
		for (const poly1 of polys1) {
			for (const poly2 of polys2) {
				intersections.push(...GameObject.singlePolygonsIntersectionPoints(poly1, poly2));
			}
		}
		return intersections.length > 0 ? intersections : null;
	}

	/**
	 * Returns all intersection points between two single polygons (internal helper).
	 */
	private static singlePolygonsIntersectionPoints(poly1: vec2arr[], poly2: vec2arr[]): vec2arr[] {
		function edgeIntersection(p1: vec2arr, p2: vec2arr, q1: vec2arr, q2: vec2arr): vec2arr | null {
			const a1 = p2[1] - p1[1];
			const b1 = p1[0] - p2[0];
			const c1 = a1 * p1[0] + b1 * p1[1];
			const a2 = q2[1] - q1[1];
			const b2 = q1[0] - q2[0];
			const c2 = a2 * q1[0] + b2 * q1[1];
			const det = a1 * b2 - a2 * b1;
			if (Math.abs(det) < 1e-12) return null; // Parallel
			const x = (b2 * c1 - b1 * c2) / det;
			const y = (a1 * c2 - a2 * c1) / det;
			if (
				Math.min(p1[0], p2[0]) - 1e-8 <= x && x <= Math.max(p1[0], p2[0]) + 1e-8 &&
				Math.min(p1[1], p2[1]) - 1e-8 <= y && y <= Math.max(p1[1], p2[1]) + 1e-8 &&
				Math.min(q1[0], q2[0]) - 1e-8 <= x && x <= Math.max(q1[0], q2[0]) + 1e-8 &&
				Math.min(q1[1], q2[1]) - 1e-8 <= y && y <= Math.max(q1[1], q2[1]) + 1e-8
			) {
				return [x, y] as vec2arr;
			}
			return null;
		}
		function pointInPoly(pt: vec2arr, poly: vec2arr[]): boolean {
			let inside = false;
			for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
				const xi = poly[i][0], yi = poly[i][1];
				const xj = poly[j][0], yj = poly[j][1];
				if (((yi > pt[1]) !== (yj > pt[1])) &&
					(pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-12) + xi)) {
					inside = !inside;
				}
			}
			return inside;
		}
		const n1 = poly1.length, n2 = poly2.length;
		const intersections: vec2arr[] = [];
		for (let i = 0; i < n1; ++i) {
			const a1 = poly1[i], a2 = poly1[(i + 1 === n1) ? 0 : i + 1];
			for (let j = 0; j < n2; ++j) {
				const b1 = poly2[j], b2 = poly2[(j + 1 === n2) ? 0 : j + 1];
				const pt = edgeIntersection(a1, a2, b1, b2);
				if (pt) intersections.push(pt);
			}
		}
		for (let i = 0; i < n1; ++i) {
			if (pointInPoly(poly1[i], poly2)) intersections.push(poly1[i]);
		}
		for (let j = 0; j < n2; ++j) {
			if (pointInPoly(poly2[j], poly1)) intersections.push(poly2[j]);
		}
		return intersections;
	}

	/**
	 * Returns the centroid from all intersection points between two sets of polygons.
	 */
	static getCentroidFromIntersectionPoints(polys1: vec2arr[][], polys2: vec2arr[][]): vec2arr {
		const intersectionPoints = GameObject.polygonsIntersectionPoints(polys1, polys2);
		return GameObject.getCentroidFromListOfIntersectionPoints(intersectionPoints);
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
