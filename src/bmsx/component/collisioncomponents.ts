import { EventEmitter, subscribesToParentScopedEvent } from "../core/eventemitter";
import { $ } from '../core/game';
import { WorldObject, WorldObjectEventPayloads } from "../core/object/worldobject";
import { mod, new_vec2, set_inplace_vec2 } from '../utils/utils';
import { vec2, type Area, type Polygon } from '../rompack/rompack';
import { excludepropfromsavegame, insavegame } from 'bmsx/serializer/serializationhooks';
import { TileSize } from "../systems/msx";
import { Component, componenttags_postprocessing, componenttags_preprocessing, ComponentUpdateParams, type ComponentAttachOptions } from "./basecomponent";


/**
 * ColliderComponent holds collision shapes for a WorldObject.
 * Shapes are stored in local space; world-space accessors apply parent position at read-time.
 *
 * - Preferred usage: derive local shapes from sprite metadata.
 * - Custom usage: call setters to provide authored shapes.
 */
@insavegame
export class Collider2DComponent extends Component<WorldObject> {
	/** Whether this object should participate in collision tests. */
	public hittable: boolean = true;
	/** Collision filtering: object's collision layer (bit). */
	public layer: number = 1;
	/** Collision filtering: which layers this collider tests against (bitmask). */
	public mask: number = 0xFFFFFFFF;
	/** If true, collider is considered a trigger (no physical response). */
	public isTrigger: boolean = true;
	/** If true, the OverlapSystem will emit overlap events for this collider. */
	public generateOverlapEvents: boolean = false;
	/**
	 * Scope for overlap event pairing by space.
	 * - 'current': only objects in the same active space
	 * - 'ui': only objects in the UI space
	 * - 'both': objects in current or UI spaces
	 * - 'all': objects in any space
	 */
	public spaceEvents: 'current' | 'ui' | 'both' | 'all' = 'current';

	/** Local-space rectangle bounds (nullable when only polygons are used). */
	@excludepropfromsavegame
	private _localArea: Area | null = null;

	/** Local-space polygons; each polygon is a flat [x0,y0,x1,y1,...] list. */
	@excludepropfromsavegame
	private _localPolys: Polygon[] | null = null;

	/** Local-space circle (x,y,r), optional. */
	@excludepropfromsavegame
	private _localCircle: { x: number; y: number; r: number } | null = null;

	/** Internal change token for sprite-driven sync (imgid + flip). */
	@excludepropfromsavegame
	private _syncToken?: string;

	/** Optional hint for a sync system to avoid repeated work. */
	public get syncToken(): string | undefined { return this._syncToken; }
	public set syncToken(v: string | undefined) { this._syncToken = v; }

	/** Returns world-space AABB. Falls back to object size if no local area is set. */
	public get worldArea(): Area {
		const p = this.parent.pos;
		if (!this._localArea) {
			return { start: { x: p.x, y: p.y }, end: { x: p.x + (this.parent.size?.x ?? 0), y: p.y + (this.parent.size?.y ?? 0) } } as Area;
		}
		return { start: { x: p.x + this._localArea.start.x, y: p.y + this._localArea.start.y }, end: { x: p.x + this._localArea.end.x, y: p.y + this._localArea.end.y } } as Area;
	}

	/** Returns world-space polygons, offset by parent position; null when none. */
	public get worldPolygons(): Polygon[] | null {
		if (!this._localPolys || this._localPolys.length === 0) return null;
		const px = this.parent.x, py = this.parent.y;
		return this._localPolys.map(poly => {
			const res: number[] = [];
			for (let i = 0; i < poly.length; i += 2) res.push(poly[i] + px, poly[i + 1] + py);
			return res;
		});
	}

	/** Returns local-space area, if any. */
	public get localArea(): Area | null { return this._localArea; }
	/** Returns local-space polygons, if any. */
	public get localPolygons(): Polygon[] | null { return this._localPolys; }
	/** Returns local-space circle, if any. */
	public get localCircle(): { x: number; y: number; r: number } | null { return this._localCircle; }

	/** Set local rectangle bounds (replaces previous). */
	public setLocalArea(a: Area | null): void { this._localArea = a; }
	/** Set local polygons (replaces previous). */
	public setLocalPolygons(polys: Polygon[] | null): void { this._localPolys = polys; }
	/** Set local circle (replaces previous). */
	public setLocalCircle(c: { x: number; y: number; r: number } | null): void { this._localCircle = c; }

	/** Returns world-space circle, if any. */
	public get worldCircle(): { x: number; y: number; r: number } | null {
		if (!this._localCircle) return null;
		const p = this.parent.pos;
		return { x: p.x + this._localCircle.x, y: p.y + this._localCircle.y, r: this._localCircle.r };
	}
}

/**
 * Shared function used for using as event handler for `IWorldObject`/`Sprite.OnLeavingScreen`
 * This function is used as an event handler for the `onLeavingScreen` event of a `WorldObject`.
 * It prohibits the `WorldObject` from leaving the screen in the direction specified by setting its position to its old position.
 * @param ik The `WorldObject` that is leaving the screen.
 * @param d The direction in which the `WorldObject` is leaving the screen.
 * @param old_x_or_y The old x or y position of the `WorldObject`.
 */
export function leavingScreenHandler_prohibit(ik: WorldObject, { d, old_x_or_y }: WorldObjectEventPayloads['leaveScreen']): void {
	switch (d) {
		case 'left': case 'right':
			ik.x = old_x_or_y;
			break;
		case 'up': case 'down':
			ik.y = old_x_or_y;
			break;
	}
}

/**
 * Represents a component responsible for updating the position of a world object along a specific axis.
 * This component handles preprocessing and postprocessing updates to handle collisions, screen boundaries, etc.
 */
@insavegame
@componenttags_preprocessing('position_update_axis') // Preprocessing update to store the old position so that it can be used in the postprocessing update to place the object back to its old position if it collides with a wall or leaves the screen, etc.
@componenttags_postprocessing('position_update_axis') // Postprocessing update to check for, and handle, collisions or leaving the screen, etc.
export abstract class PositionUpdateAxisComponent extends Component<WorldObject> {
	/**
	 * The previous position of the world object.
	 */
	public oldPos: vec2;

	constructor(opts: ComponentAttachOptions) {
		super(opts);
		this.oldPos = new_vec2(0, 0);
	}

	override preprocessingUpdate(): void {
		set_inplace_vec2(this.oldPos, this.parent.pos); // Store the old position
	}
}

/**
 * Represents a screen boundary component that handles collision detection with the screen boundaries.
 * @class
 * @extends PositionUpdateAxisComponent
 */
@insavegame
export class ScreenBoundaryComponent extends PositionUpdateAxisComponent {
	static override get unique(): boolean { return true; }
	/**
	 * Overrides the postprocessingUpdate method to check for boundary collisions on the X and Y axes.
	 * @override
	 */
	override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
		super.postprocessingUpdate({ params, returnvalue });
		const currentPos = this.parent.pos;
		if (this.oldPos.x !== currentPos.x) {
			this.checkBoundaryForXAxis.call($.world.getWorldObject(this.parentid), this.oldPos.x, currentPos.x);
		}
		if (this.oldPos.y !== currentPos.y) {
			this.checkBoundaryForYAxis.call($.world.getWorldObject(this.parentid), this.oldPos.y, currentPos.y);
		}
	}

	/**
	 * Checks for boundary collisions on the X axis.
	 * @private
	 * @param {WorldObject} this - The world object.
	 * @param {number} oldx - The old x position.
	 * @param {number} newx - The new x position.
	 */
	private checkBoundaryForXAxis(this: WorldObject, oldx: number, newx: number) {
		if (newx < oldx) {
			if (newx + this.size.x < 0) {
				const payload: WorldObjectEventPayloads['leaveScreen'] = { d: 'left', old_x_or_y: oldx };
				EventEmitter.instance.emit('leaveScreen', this, payload);
			}
			else if (newx < 0) {
				const payload: WorldObjectEventPayloads['leavingScreen'] = { d: 'left', old_x_or_y: oldx };
				EventEmitter.instance.emit('leavingScreen', this, payload);
			}
		}
		else if (newx > oldx) {
			if (newx >= $.world.gamewidth) {
				const payload: WorldObjectEventPayloads['leaveScreen'] = { d: 'right', old_x_or_y: oldx };
				EventEmitter.instance.emit('leaveScreen', this, payload);
			}
			else if (newx + this.size.x >= $.world.gamewidth) {
				const payload: WorldObjectEventPayloads['leavingScreen'] = { d: 'right', old_x_or_y: oldx };
				EventEmitter.instance.emit('leavingScreen', this, payload);
			}
		}
	}

	/**
	 * Checks for boundary collisions on the Y axis.
	 * @private
	 * @param {WorldObject} this - The world object.
	 * @param {number} oldy - The old y position.
	 * @param {number} newy - The new y position.
	 */
	private checkBoundaryForYAxis(this: WorldObject, oldy: number, newy: number) {
		if (newy < oldy) {
			if (newy + this.size.y < 0) {
				const payload: WorldObjectEventPayloads['leaveScreen'] = { d: 'up', old_x_or_y: oldy };
				EventEmitter.instance.emit('leaveScreen', this, payload);
			}
			else if (newy < 0) {
				const payload: WorldObjectEventPayloads['leavingScreen'] = { d: 'up', old_x_or_y: oldy };
				EventEmitter.instance.emit('leavingScreen', this, payload);
			}
		}
		else if (newy > oldy) {
			if (newy >= $.world.gameheight) {
				const payload: WorldObjectEventPayloads['leaveScreen'] = { d: 'down', old_x_or_y: oldy };
				EventEmitter.instance.emit('leaveScreen', this, payload);
			}
			else if (newy + this.size.y >= $.world.gameheight) {
				const payload: WorldObjectEventPayloads['leavingScreen'] = { d: 'down', old_x_or_y: oldy };
				EventEmitter.instance.emit('leavingScreen', this, payload);
			}
		}
	}
}

/**
 * Represents a collision component for game objects vs tiles.
 * Extends the PositionUpdateAxisComponent class.
 */
@insavegame
export class TileCollisionComponent extends PositionUpdateAxisComponent {
	static override get unique() { return true; }
	/**
	 * Performs post-processing update for collision components.
	 * Overrides the base class's update method and checks for tile collisions on the x and y axes.
	 */
	override postprocessingUpdate({ params, returnvalue }: ComponentUpdateParams): void {
		super.postprocessingUpdate({ params, returnvalue });
		const currentPos = this.parent.pos;
		if (this.oldPos.x !== currentPos.x) {
			this.checkTileCollisionForXAxis.call(this.parent, this.oldPos.x, currentPos.x);
		}
		if (this.oldPos.y !== currentPos.y) {
			this.checkTileCollisionForYAxis.call(this.parent, this.oldPos.y, currentPos.y);
		}
	}

	/**
	 * Checks for tile collision along the X-axis and updates the object's position accordingly.
	 * @param oldx The previous X-coordinate of the object.
	 * @param newx The new X-coordinate of the object.
	 */
	protected checkTileCollisionForXAxis(this: WorldObject, oldx: number, newx: number) {
		if (newx < oldx) {
			if ($.world.collidesWithTile(this, 'left')) {
				EventEmitter.instance.emit('wallcollide', this, { d: 'left' });
				newx += TileSize - mod(newx, TileSize);
			}
			this.x = ~~newx;
		}
		else if (newx > oldx) {
			if ($.world.collidesWithTile(this, 'right')) {
				EventEmitter.instance.emit('wallcollide', this, { d: 'right' });
				newx -= newx % TileSize;
			}
			this.x = ~~newx;
		}
	}

	/**
	 * Checks for tile collision along the Y-axis and updates the object's position accordingly.
	 * @param oldy The previous Y-coordinate of the object.
	 * @param newy The new Y-coordinate of the object.
	 */
	protected checkTileCollisionForYAxis(this: WorldObject, oldy: number, newy: number) {
		if (newy < oldy) {
			if ($.world.collidesWithTile(this, 'up')) {
				EventEmitter.instance.emit('wallcollide', this, { d: 'up' });
				newy += TileSize - mod(newy, TileSize);
			}
			this.y = ~~newy;
		}
		else if (newy > oldy) {
			if ($.world.collidesWithTile(this, 'down')) {
				EventEmitter.instance.emit('wallcollide', this, { d: 'down' });
				newy -= newy % TileSize;
			}
			this.y = ~~newy;
		}
	}
}

/**
 * Represents a component that prohibits the world object from leaving the screen boundary.
 * Inherits from ScreenBoundaryComponent.
 */
@insavegame
export class ProhibitLeavingScreenComponent extends ScreenBoundaryComponent {
	/**
	 * Event handler for the 'leavingScreen' event.
	 * @param emitter - The ID of the world object emitting the event.
	 * @param d - The direction in which the world object is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the world object.
	 */
	@subscribesToParentScopedEvent('leavingScreen')
	public onLeavingScreen(_event_name: string, emitter: WorldObject, { d, old_x_or_y }: WorldObjectEventPayloads['leavingScreen']) {
		leavingScreenHandler_prohibit(emitter, { d, old_x_or_y });
	}
}
