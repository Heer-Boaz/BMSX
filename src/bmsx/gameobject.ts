import { statecontext } from "./bfsm";
import { Point, Size, Area, Direction, moveArea, multiplyPoint, newPoint, divPoint, mod } from "./bmsx";
import { insavegame } from "./gamereviver";
import { TileSize } from "./msx";

@insavegame
export class GameObject {
	// For converting this GameObject to a string ('id')
	public [Symbol.toPrimitive]() {
		return this.id;
	}

	public id: string;
	public disposeFlag: boolean;
	public z: number;
	public pos: Point;
	public size: Size;

	public get wallHitarea(): Area { return this.hitarea; }
	public state: statecontext;
	public isWall?: boolean;

	public hitarea: Area;

	public hittable: boolean;
	public visible: boolean;

	public get hitbox_sx(): number {
		return this.pos.x + this.hitarea.start.x;
	}

	public get hitbox_sy(): number {
		return this.pos.y + this.hitarea.start.y;
	}

	public get hitbox_ex(): number {
		return this.pos.x + this.hitarea.end.x;
	}

	public get hitbox_ey(): number {
		return this.pos.y + this.hitarea.end.y;
	}

	public get x_plus_width(): number {
		return this.pos.x + this.size.x;
	}

	public get y_plus_height(): number {
		return this.pos.y + this.size.y;
	}

	public get wallhitbox_sx(): number {
		return this.pos.x + this.wallHitarea.start.x;
	}

	public get wallhitbox_sy(): number {
		return this.pos.y + this.wallHitarea.start.y;
	}

	public get wallhitbox_ex(): number {
		return this.pos.x + this.wallHitarea.end.x;
	}

	public get wallhitbox_ey(): number {
		return this.pos.y + this.wallHitarea.end.y;
	}

	public disposeOnSwitchRoom?: boolean;

	/**
	 * By default, will set location to `spawningPos` and
	 * the FSM-state to the initial state (if specified).
	 * @param spawningPos
	 */
	public onspawn?(spawningPos?: Point): void {
		if (spawningPos) [this.pos.x, this.pos.y] = [spawningPos.x, spawningPos.y];

		let start_state_id = this.state?.definition?.start_state;
		start_state_id && this.state.to(start_state_id);
	}
	public ondispose?: () => void;

	public paint?(offset?: Point): void;
	public postpaint?(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
	public onloaded?: () => void;

	/**
	* Gebruik ik als event handler voor e.g. onLeaveScreen
	*/
	public markForDisposure(): void {
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
	private static generateId(): string {
		const chars = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
		let result: string;
		do {
			result = [...Array(GameObject.GENERATED_ID_LENGTH)].map(() => chars[Math.random() * chars.length | 0]).join('');
		} while (global.model?.exists(result)); // Make sure that the randomly generated string is unique!
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
		this.pos ??= { x: 0, y: 0 };
		this.size ??= { x: 0, y: 0 };
		this.z = 0;
		this.disposeFlag = false;
		this.disposeOnSwitchRoom = true;
		this.state = statecontext.create(_fsm_id ?? this.constructor.name, this.id);
	}

	static objectCollide(o1: GameObject, o2: GameObject): boolean {
		return o1.objectCollide(o2);
	}

	public collides(o: GameObject | Area): boolean {
		if ((o as GameObject).id) return this.objectCollide(<GameObject>o);
		else return this.areaCollide(<Area>o);
	}

	public collide(src: GameObject): void {
		this.oncollide?.(src);
	}

	public objectCollide(o: GameObject): boolean {
		return this.areaCollide(moveArea(o.hitarea, o.pos));
	}

	public areaCollide(a: Area): boolean {
		if (!this.hittable) return false;

		let o1 = this;
		let o1p = o1.pos;
		let o1a = o1.hitarea;

		let o2a = a;

		return o1p.x + o1a.end.x >= o2a.start.x && o1p.x + o1a.start.x <= o2a.end.x &&
			o1p.y + o1a.end.y >= o2a.start.y && o1p.y + o1a.start.y <= o2a.end.y;
	}

	public inside(p: Point): boolean {
		let o1 = this;

		let o1p = o1.pos;
		if (o1.hitarea) {
			let o1a = o1.hitarea;
			return o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
				o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y;
		}
		if (o1.size) {
			let o1a = o1.size;
			return o1p.x + o1a.x >= p.x && o1p.x <= p.x &&
				o1p.y + o1a.y >= p.y && o1p.y <= p.y;
		}
		return false;
	}

	/**
	*  This method is used for debugging. Handling mouse events on game objects requires
	*  transforming the game coordinates to canvas coordinates and that requires scaling
	*  to be taken into account.
	*/
	public insideScaled(p: Point): Point | null {
		let o1 = this;

		let o1p = multiplyPoint(o1.pos, global.view.scale);
		let o1a: Area;
		if (o1.hitarea) {
			o1a = <Area>{ start: multiplyPoint(o1.hitarea.start, global.view.scale), end: multiplyPoint(o1.hitarea.end, global.view.scale) };
		}
		else if (o1.size) {
			o1a = <Area>{ start: newPoint(0, 0), end: multiplyPoint(o1.size, global.view.scale) };
		}
		else return null;

		if (o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
			o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y) {
			let offsetToP = newPoint(p.x - o1p.x, p.y - o1p.y);
			return divPoint(offsetToP, global.view.scale);
		}
		return null;
	}

	public setx(newx: number) {
		let oldx = this.pos.x;
		this.pos.x = ~~newx;
		if (newx < oldx) {
			if (global.model.collidesWithTile(this, Direction.Left)) {
				this.onWallcollide?.(Direction.Up);
				newx += TileSize - mod(newx, TileSize);
			}
			this.pos.x = ~~newx;
			if (newx + this.size.x < 0) { this.onLeaveScreen?.(this, Direction.Left, oldx); }
			else if (newx < 0) { this.onLeavingScreen?.(this, Direction.Left, oldx); }
		}
		else if (newx > oldx) {
			if (global.model.collidesWithTile(this, Direction.Right)) {
				this.onWallcollide?.(Direction.Right);
				newx -= newx % TileSize;
			}
			this.pos.x = ~~newx;
			if (newx >= global.model.gamewidth) { this.onLeaveScreen?.(this, Direction.Right, oldx); }
			else if (newx + this.size.x >= global.model.gamewidth) { this.onLeavingScreen?.(this, Direction.Right, oldx); }
		}
	}

	public sety(newy: number) {
		let oldy = this.pos.y;
		this.pos.y = ~~newy;
		if (newy < oldy) {
			if (global.model.collidesWithTile(this, Direction.Up)) {
				this.onWallcollide?.(Direction.Up);
				newy += TileSize - mod(newy, TileSize);
			}
			this.pos.y = ~~newy;
			if (newy + this.size.y < 0) { this.onLeaveScreen?.(this, Direction.Up, oldy); }
			else if (newy < 0) { this.onLeavingScreen?.(this, Direction.Up, oldy); }
		}
		else if (newy > oldy) {
			if (global.model.collidesWithTile(this, Direction.Down)) {
				this.onWallcollide?.(Direction.Down);
				newy -= newy % TileSize;
			}
			this.pos.y = ~~newy;
			if (newy >= global.model.gameheight) { this.onLeaveScreen?.(this, Direction.Down, oldy); }
			else if (newy + this.size.y >= global.model.gameheight) { this.onLeavingScreen?.(this, Direction.Down, oldy); }
		}
	}

	public run(): void {
		this.state.run();
	}
}

// Shared function used for using as event handler for IGameObject/Sprite.OnLeavingScreen
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
