import { ConstructorWithFSMProperty, bfsm_controller, statecontext } from "./bfsm";
import { vec3, Area, Direction, new_vec2, mod, vec2, new_vec3, new_area, GameObjectId as GameObjectId } from "./bmsx";
import { insavegame } from "./gameserializer";
import { TileSize } from "./msx";
import { Component, ComponentTag, IComponentContainer, KeyToComponentMap, ComponentConstructor, update_tagged_components, ComponentUpdateArgs } from "./component";
import { BehaviorTrees, Blackboard, BTNode, BehaviorTreeID, constructBehaviorTree, ConstructorWithBTProperty } from "./behaviourtree";
import { ObjectTracker } from "./objecttracker";
import { onload } from "./gameserializer";
import { IEventSubscriber, EventEmitter } from "./eventemitter";

/**
 * Represents a static GameObject.
 */
interface IGameObjectStatic {
    autoAddComponents?: ComponentConstructor<Component>[];
}

/**
 * Represents a constructor for the GameObject.
 * @typeparam T - The type of the GameObject.
 */
export type GameObjectConstructor = {
    new(_id?: GameObjectId, _fsm_id?: string): GameObject;
} & IGameObjectStatic;

export interface IIdentifiable {
    id: string;
}

const DEFAULT_HITTABLE = true;
const DEFAULT_VISIBLE = true;
const DEFAULT_POSITION_VALUES: [number, number, number] = [0, 0, 0];
const DEFAULT_SIZE_VALUES: [number, number, number] = [0, 0, 0];

/**
 * Represents a game object with a position, size, state, and hitbox.
 * Implements both vec2 and vec3 interfaces.
 */
@insavegame
export class GameObject implements vec2, vec3, IComponentContainer, IIdentifiable {
    public components: KeyToComponentMap = {};
    public objectTracker?: ObjectTracker;

    getComponent<T extends Component>(constructor: ComponentConstructor<T>): T | undefined {
        return this.components[constructor.name] as T | undefined;
    }

    addComponent<T extends Component>(component: T): void {
        this.components[component.constructor.name] = component;
    }

    removeComponent<T extends Component>(constructor: ComponentConstructor<T>): void {
        delete this.components[constructor.name];
    }

    updateComponent<T extends Component>(constructor: ComponentConstructor<T>, ...args: any[]): void {
        const component = this.getComponent(constructor);
        if (component) {
            component.update({ params: args });
        }
    }

    updateComponentsWithTag(tag: ComponentTag, ...args: any[]): void {
        // Get all components with the given tag
        const components = Object.values(this.components).filter(component => component.hasPreprocessingTag(tag) || component.hasPostprocessingTag(tag));
        components.forEach(component => component.update({ params: args }));
    }

    /**
     * Returns the primitive value of the GameObject instance.
     * @returns The ID of the GameObject.
     */
    public [Symbol.toPrimitive]() {
        return this.id;
    }

    public id: GameObjectId;
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
        if (z > 10000) z = 10000;
        if (z < 0) z = 0;
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

    /**
     * The state of the game object.
     */
    public state: bfsm_controller;

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

        this.behaviortrees[bt_id].tick(this.id, this.blackboards[bt_id]);
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
    public hittable: boolean;
    public visible: boolean;

    private _hitbox: Area; // Cached hitbox
    /**
     * Gets the hitbox area of the game object.
     * If the hitbox is not initialized, it creates a new area using the provided coordinates.
     * @returns The hitbox area of the game object.
     */
    public get hitbox(): Area {
        if (!this._hitbox) {
            this._hitbox = new_area(this.hitbox_left, this.hitbox_top, this.hitbox_right, this.hitbox_bottom);
        }
        return this._hitbox;
    }
    public update_hitbox(): void {
        const _ = this.hitbox;
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
     * @param spawningPos
     */
    public onspawn?(spawningPos?: vec2 | vec3): void {
        if (spawningPos) {
            this.setXNoSweep(spawningPos.x ?? this.x);
            this.setYNoSweep(spawningPos.y ?? this.y);
            this.setZNoSweep((spawningPos as vec3).z ?? this.z);
        }

        this.state.start();
    }

    public ondispose?: () => void;

    public paint?(): void;
    public postpaint?(): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    public onloaded?: () => void;

    /**
    * Gebruik ik als event handler voor e.g. onLeaveScreen
    */
    public exile(): void {
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
        const model = global.model;
        let result: string;
        do {
            const baseId = this.constructor.name;
            const uniqueNumber = global.model.getNextIdNumber();
            result = `${baseId}_${uniqueNumber}`;
        } while (model?.exists(result));
        return result;
    }

    /**
     * @param _id The id of the newly created object. If not given, defaults to generated id. @see {@link generateId}.
     * @param _fsm_id The id of the state machine that will be created for this object. Defaults to `this.constructor.name`. If there is no state machine with the given (default) name, the state machine factory will ensure that an "empty" state machine is created. @see {@link statecontext.create}.
     */
    constructor(_id?: string, _fsm_id?: string) {
        this.id = _id ?? this.generateId();
        this.hittable = DEFAULT_HITTABLE;
        this.visible = DEFAULT_VISIBLE;
        this.pos = new_vec3(...DEFAULT_POSITION_VALUES);
        this.size = new_vec3(...DEFAULT_SIZE_VALUES);
        this.disposeFlag = false;
        // Create the state context that will be used to manage the state of the game object
        this.state = new bfsm_controller();
        this.state.add_statemachine(_fsm_id ?? this.constructor.name, this.id)
        // Add components that should be auto-added to this class
        this.addAutoComponents();

        // Call the method to initialize linked state machines
        this.initializeLinkedFSMs();
        // Call the method to initialize linked behavior trees
        this.initializeBehaviorTrees();
        // Call the method to initialize event subscriptions
        this.onLoadSetup();
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
        this.initEventSubscriptions();
    }

    protected initEventSubscriptions() {
        const constr = this.constructor as IEventSubscriber;
        if (!constr.eventSubscriptions) return;

        const eventEmitter = EventEmitter.getInstance();
        constr.eventSubscriptions.forEach(subscription => {
            const handler = this[subscription.handlerName].bind(this);
            let emitterFilter: string;
            switch (subscription.scope) {
                case 'all': emitterFilter = 'all'; break;
                case 'parent':
                    emitterFilter = (this as GameObject & { parentid?: GameObjectId }).parentid;
                    if (!emitterFilter) throw `Cannot subscribe GameObject ${this.id} to event ${subscription.eventName} with scope ${subscription.scope} as the class (instance) ${this.constructor.name} does not have a "parentid".`;
                    break;
                case 'self': emitterFilter = this.id; break;
            }
            eventEmitter.on(subscription.eventName, handler, this.id);
        });
    }

    protected initializeLinkedFSMs() {
        // Get the constructor of the current instance
        const constructor = this.constructor as ConstructorWithFSMProperty;

        // Check if the constructor has the 'linkedFSMs' property
        if (constructor.linkedFSMs) {
            // Iterate over the FSM names and create the state machines
            constructor.linkedFSMs.forEach(fsm => {
                this.state.add_statemachine(fsm, this.id);
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
     * Determines if two `GameObject` instances collide with each other.
     * @param o1 The first `GameObject` instance.
     * @param o2 The second `GameObject` instance.
     * @returns `true` if the two instances collide, `false` otherwise.
     */
    static objectCollide(o1: GameObject, o2: GameObject): boolean {
        return o1.detect_object_collision(o2);
    }

    /**
     * Calls the `oncollide` event handler with the given `GameObject` instance as the source of the collision.
     * @param src The `GameObject` instance that collided with this instance.
     */
    public collide(src: GameObject): void {
        this.oncollide?.(src);
    }

    // Determines if the current GameObject instance collides with another GameObject or an Area instance.
    // @param o The GameObject or Area instance to check for collision.
    // @returns `true` if the current instance collides with the given instance, `false` otherwise.
    public collides(o: GameObject | Area): boolean {
        if ((o as GameObject).id) return this.detect_object_collision(o as GameObject);
        else return this.detect_aabb_collision_area(o as Area);
    }

    /**
     * Determines if the current `GameObject` instance collides with another `GameObject` instance.
     * Detects Axis-Aligned Bounding Box collision (AABB).
     * @param o The `GameObject` instance to check for collision.
     * @returns `true` if the current instance collides with the given instance, `false` otherwise.
     */
    public detect_object_collision(o: GameObject): boolean {
        if (!this.hittable || !o.hittable) return false;
        const thisLeft = this.hitbox_left;
        const thisRight = this.hitbox_right;
        const thisTop = this.hitbox_top;
        const thisBottom = this.hitbox_bottom;
        const otherLeft = o.hitbox_left;
        const otherRight = o.hitbox_right;
        const otherTop = o.hitbox_top;
        const otherBottom = o.hitbox_bottom;
        return !(thisRight < otherLeft || thisLeft > otherRight || thisBottom < otherTop || thisTop > otherBottom);
    }

    /**
     * Determines if the current `GameObject` instance collides with an `Area` instance.
     * Detects Axis-Aligned Bounding Box collision (AABB).
     * @param a The `Area` instance to check for collision.
     * @returns `true` if the current instance collides with the given instance, `false` otherwise.
     */
    public detect_aabb_collision_area(a: Area): boolean {
        const hitbox_left = this.hitbox_left;
        const hitbox_right = this.hitbox_right;
        const hitbox_top = this.hitbox_top;
        const hitbox_bottom = this.hitbox_bottom;

        return !(hitbox_left > a.end.x || hitbox_right < a.start.x || hitbox_bottom < a.start.y || hitbox_top > a.end.y);
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
     * Runs the game object by updating its components and running its state.
     */
    @update_tagged_components('run')
    public run(): void {
        this.state.run();
    }
}
