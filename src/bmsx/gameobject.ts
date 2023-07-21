import { statecontext } from "./bfsm";
import { vec3, Area, Direction, moveArea, multiply_vec2, new_vec2, div_vec2, mod, vec2, new_vec3, translate_vec2, new_area } from "./bmsx";
import { insavegame } from "./gameserializer";
import { TileSize } from "./msx";

/**
 * Represents a game object with a position, size, state, and hitbox.
 * Implements both vec2 and vec3 interfaces.
 */
@insavegame
export class GameObject implements vec2, vec3 {

    // For converting this GameObject to a string ('id')
    public [Symbol.toPrimitive]() {
        return this.id;
    }

    public id: string;
    public disposeFlag: boolean;

    public pos: vec3;
    public get x(): number {
        return this.pos.x;
    }
    public set x(__x: number) {
        this.pos.x = __x;
    }
    public get y(): number {
        return this.pos.y;
    }
    public set y(__y: number) {
        this.pos.y = __y;
    }
    public get z(): number {
        return this.pos.z;
    }
    public set z(__z: number) {
        if (__z > 10000) __z = 10000;
        if (__z < 0) __z = 0;
        this.pos.z = __z;
    }

    public size: vec3;

    public get sx(): number {
        return this.size.x;
    }
    public set sx(__sx: number) {
        this.size.x = __sx;
    }
    public get sy(): number {
        return this.size.y;
    }
    public set sy(__sy: number) {
        this.size.y = __sy;
    }
    public get sz(): number {
        return this.size.z;
    }
    public set sz(__sz: number) {
        this.size.z = __sz;
    }

    public state: statecontext;
    public hitarea: Area;

    public hittable: boolean;
    public visible: boolean;

    private _hitbox: Area; // Cached hitbox
    public get hitbox(): Area {
        if (!this._hitbox) {
            this._hitbox = new_area(this.hitbox_left, this.hitbox_top, this.hitbox_right, this.hitbox_bottom);
        }
        return this._hitbox;
    }
    public update_hitbox(): void {
        this._hitbox = new_area(this.hitbox_left, this.hitbox_top, this.hitbox_right, this.hitbox_bottom);
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
        return this.pos.x + this.hitarea.start.x;
    }

    public get hitarea_top(): number {
        return this.pos.y + this.hitarea.start.y;
    }

    public get hitarea_right(): number {
        return this.pos.x + this.hitarea.end.x;
    }

    public get hitarea_bottom(): number {
        return this.pos.y + this.hitarea.end.y;
    }

    public get x_plus_width(): number {
        return this.pos.x + this.size.x;
    }

    public get y_plus_height(): number {
        return this.pos.y + this.size.y;
    }

    /**
     * By default, will set location to `spawningPos` and
     * the FSM-state to the initial state (if specified).
     * @param spawningPos
     */
    public onspawn?(spawningPos?: vec2 | vec3): void {
        if (spawningPos) {
            this.x = spawningPos.x ?? this.x;
            this.y = spawningPos.y ?? this.y;
            this.z = spawningPos.z ?? this.z;
        }

        let start_state_id = this.state?.definition?.start_state;
        start_state_id && this.state.to(start_state_id);
    }
    public ondispose?: () => void;

    public paint?(): void;
    public postpaint?(): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    public onloaded?: () => void;

    /**
    * Gebruik ik als event handler voor e.g. onLeaveScreen
    */
    public banish(): void {
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

    // https://gist.github.com/6174/6062387
    private static readonly GENERATED_ID_LENGTH = 10;
    /**
     * Generates a unique identifier for a `GameObject` instance.
     * The generated identifier is a string of length `GameObject.GENERATED_ID_LENGTH` consisting of random alphanumeric characters.
     * The method ensures that the generated string is unique by checking if it already exists in the global model.
     * If the generated string already exists, a new string is generated until a unique one is found.
     * @returns A unique identifier for a `GameObject` instance.
     */
    private static generateId(): string {
        const model = global.model;
        const chars = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
        let result: string;
        do {
            result = [...Array(GameObject.GENERATED_ID_LENGTH)].map(() => chars[Math.random() * chars.length | 0]).join('');
        } while (model?.exists(result)); // Make sure that the randomly generated string is unique!
        // (Note that the model can be undefined. This can happen when an id is genereated for an object that is spawned as part of the model constructor)
        return result;
    }

    /**
     * @param _id The id of the newly created object. If not given, defaults to generated id. @see {@link generateId}.
     * @param _fsm_id The id of the state machine that will be created for this object. Defaults to `this.constructor.name`. If there is no state machine with the given (default) name, the state machine factory will ensure that an "empty" state machine is created. @see {@link statecontext.create}.
     */
    constructor(_id?: string, _fsm_id?: string) {
        this.id = _id ?? GameObject.generateId();
        this.hittable = true;
        this.visible = true;
        this.pos = new_vec3(0, 0, 0);
        this.size = new_vec3(0, 0, 0);
        this.disposeFlag = false;
        this.state = statecontext.create(_fsm_id ?? this.constructor.name, this.id);
    }

    static objectCollide(o1: GameObject, o2: GameObject): boolean {
        return o1.detect_object_collision(o2);
    }

    public collide(src: GameObject): void {
        this.oncollide?.(src);
    }

    public collides(o: GameObject | Area): boolean {
        if ((o as GameObject).id) return this.detect_object_collision(o as GameObject);
        else return this.detect_aabb_collision_area(o as Area);
    }

    /**
     * Detects Axis-Aligned Bounding Box collision (AABB)
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
     * Detects Axis-Aligned Bounding Box collision (AABB)
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
     * Sets the x-coordinate of the object's position and handles collisions with tiles and screen edges.
     * @param newx The new x-coordinate to set.
     */
    public setx(newx: number) {
        const oldx = this.pos.x;
        const model = global.model;

        this.pos.x = ~~newx;

        if (newx < oldx) {
            if (model.collidesWithTile(this, Direction.Left)) {
                this.onWallcollide?.(Direction.Up);
                newx += TileSize - mod(newx, TileSize);
            }
            this.pos.x = ~~newx;
            if (newx + this.size.x < 0) { this.onLeaveScreen?.(this, Direction.Left, oldx); }
            else if (newx < 0) { this.onLeavingScreen?.(this, Direction.Left, oldx); }
        }
        else if (newx > oldx) {
            if (model.collidesWithTile(this, Direction.Right)) {
                this.onWallcollide?.(Direction.Right);
                newx -= newx % TileSize;
            }
            this.pos.x = ~~newx;
            if (newx >= model.gamewidth) { this.onLeaveScreen?.(this, Direction.Right, oldx); }
            else if (newx + this.size.x >= model.gamewidth) { this.onLeavingScreen?.(this, Direction.Right, oldx); }
        }
    }

    /**
     * Sets the y-coordinate of the object's position and handles collisions with tiles and screen edges.
     * @param newy The new y-coordinate to set.
     */
    public sety(newy: number) {
        const oldy = this.pos.y;
        const model = global.model;

        this.pos.y = ~~newy;
        if (newy < oldy) {
            if (model.collidesWithTile(this, Direction.Up)) {
                this.onWallcollide?.(Direction.Up);
                newy += TileSize - mod(newy, TileSize);
            }
            this.pos.y = ~~newy;
            if (newy + this.size.y < 0) { this.onLeaveScreen?.(this, Direction.Up, oldy); }
            else if (newy < 0) { this.onLeavingScreen?.(this, Direction.Up, oldy); }
        }
        else if (newy > oldy) {
            if (model.collidesWithTile(this, Direction.Down)) {
                this.onWallcollide?.(Direction.Down);
                newy -= newy % TileSize;
            }
            this.pos.y = ~~newy;
            if (newy >= model.gameheight) { this.onLeaveScreen?.(this, Direction.Down, oldy); }
            else if (newy + this.size.y >= model.gameheight) { this.onLeavingScreen?.(this, Direction.Down, oldy); }
        }
    }

    public run(): void {
        this.state.run();
    }
}

/**
 * Shared function used for using as event handler for `IGameObject`/`Sprite.OnLeavingScreen`
 * This function is used as an event handler for the `onLeavingScreen` event of a `GameObject`.
 * It prohibits the `GameObject` from leaving the screen in the direction specified by setting its position to its old position.
 * @param ik The `GameObject` that is leaving the screen.
 * @param d The direction in which the `GameObject` is leaving the screen.
 * @param old_x_or_y The old x or y position of the `GameObject`.
 */
export function leavingScreenHandler_prohibit(ik: GameObject, d: Direction, old_x_or_y: number): void {
    switch (d) {
        case Direction.Left: case Direction.Right:
            ik.pos.x = old_x_or_y;
            break;
        case Direction.Up: case Direction.Down:
            ik.pos.y = old_x_or_y;
            break;
    }
}
