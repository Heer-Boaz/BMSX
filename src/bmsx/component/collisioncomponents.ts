import { EventEmitter, subscribesToParentScopedEvent } from "../core/eventemitter";
import type { GameEvent } from '../core/game_event';
import { $ } from '../core/game';
import { WorldObject, WorldObjectEventPayloads } from "../core/object/worldobject";
import { new_vec2, set_inplace_vec2 } from '../utils/vector_operations';
import { mod } from '../utils/mod';
import { vec2, type Area, type Polygon } from '../rompack/rompack';
import { excludepropfromsavegame, insavegame } from '../serializer/serializationhooks';
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

	constructor(opts: ComponentAttachOptions & {
		hittable?: boolean;
		layer?: number;
		mask?: number;
		istrigger?: boolean;
		generateoverlapevents?: boolean;
		spaceevents?: 'current' | 'ui' | 'both' | 'all';
	}) {
		super(opts);
		this.hittable = opts.hittable;
		this.layer = opts.layer;
		this.mask = opts.mask;
		this.isTrigger = opts.istrigger;
		this.generateOverlapEvents = opts.generateoverlapevents;
		this.spaceEvents = opts.spaceevents;
	}

	/** Returns world-space AABB. Falls back to object size if no local area is set. */
	public get worldArea(): Area {
		const parent = this.parentOrThrow();
		const p = parent.pos;
		if (!this._localArea) {
			const size = parent.size;
			return { start: { x: p.x, y: p.y }, end: { x: p.x + size.x, y: p.y + size.y } };
		}
		return {
			start: { x: p.x + this._localArea.start.x, y: p.y + this._localArea.start.y },
			end: { x: p.x + this._localArea.end.x, y: p.y + this._localArea.end.y }
		};
	}

	/** Returns world-space polygons, offset by parent position; null when none. */
	public get worldPolygons(): Polygon[] | null {
		if (!this._localPolys || this._localPolys.length === 0) return null;
		const parent = this.parentOrThrow();
		const px = parent.x;
		const py = parent.y;
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
		const parent = this.parentOrThrow();
		const p = parent.pos;
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
export function leavingScreenHandler_prohibit(ik: WorldObject, { d, old_x_or_y }: WorldObjectEventPayloads['screen.leave']): void {
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
		const parent = this.parentOrThrow();
		set_inplace_vec2(this.oldPos, parent.pos);
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
		const parent = this.parentOrThrow();
		const currentPos = parent.pos;
		if (this.oldPos.x !== currentPos.x) {
			this.checkBoundaryForXAxis(parent, this.oldPos.x, currentPos.x);
		}
		if (this.oldPos.y !== currentPos.y) {
			this.checkBoundaryForYAxis(parent, this.oldPos.y, currentPos.y);
		}
	}

	/**
	 * Checks for boundary collisions on the X axis.
	 * @private
	 * @param {WorldObject} this - The world object.
	 * @param {number} oldx - The old x position.
	 * @param {number} newx - The new x position.
	 */
	private checkBoundaryForXAxis(parent: WorldObject, oldx: number, newx: number) {
		if (newx < oldx) {
			if (newx + parent.size.x < 0) {
				const payload: WorldObjectEventPayloads['screen.leave'] = { d: 'left', old_x_or_y: oldx };
				EventEmitter.instance.emit('screen.leave', parent, payload);
			}
			else if (newx < 0) {
				const payload: WorldObjectEventPayloads['screen.leaving'] = { d: 'left', old_x_or_y: oldx };
				EventEmitter.instance.emit('screen.leaving', parent, payload);
			}
		}
		else if (newx > oldx) {
			if (newx >= $.world.gamewidth) {
				const payload: WorldObjectEventPayloads['screen.leave'] = { d: 'right', old_x_or_y: oldx };
				EventEmitter.instance.emit('screen.leave', parent, payload);
			}
			else if (newx + parent.size.x >= $.world.gamewidth) {
				const payload: WorldObjectEventPayloads['screen.leaving'] = { d: 'right', old_x_or_y: oldx };
				EventEmitter.instance.emit('screen.leaving', parent, payload);
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
	private checkBoundaryForYAxis(parent: WorldObject, oldy: number, newy: number) {
		if (newy < oldy) {
			if (newy + parent.size.y < 0) {
				const payload: WorldObjectEventPayloads['screen.leave'] = { d: 'up', old_x_or_y: oldy };
				EventEmitter.instance.emit('screen.leave', parent, payload);
			}
			else if (newy < 0) {
				const payload: WorldObjectEventPayloads['screen.leaving'] = { d: 'up', old_x_or_y: oldy };
				EventEmitter.instance.emit('screen.leaving', parent, payload);
			}
		}
		else if (newy > oldy) {
			if (newy >= $.world.gameheight) {
				const payload: WorldObjectEventPayloads['screen.leave'] = { d: 'down', old_x_or_y: oldy };
				EventEmitter.instance.emit('screen.leave', parent, payload);
			}
			else if (newy + parent.size.y >= $.world.gameheight) {
				const payload: WorldObjectEventPayloads['screen.leaving'] = { d: 'down', old_x_or_y: oldy };
				EventEmitter.instance.emit('screen.leaving', parent, payload);
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
		const parent = this.parentOrThrow();
		const currentPos = parent.pos;
		if (this.oldPos.x !== currentPos.x) {
			this.checkTileCollisionForXAxis(parent, this.oldPos.x, currentPos.x);
		}
		if (this.oldPos.y !== currentPos.y) {
			this.checkTileCollisionForYAxis(parent, this.oldPos.y, currentPos.y);
		}
	}

	/**
	 * Checks for tile collision along the X-axis and updates the object's position accordingly.
	 * @param oldx The previous X-coordinate of the object.
	 * @param newx The new X-coordinate of the object.
	 */
	protected checkTileCollisionForXAxis(parent: WorldObject, oldx: number, newx: number) {
		if (newx < oldx) {
			if ($.world.collidesWithTile(parent, 'left')) {
				EventEmitter.instance.emit('wallcollide', parent, { d: 'left' });
				newx += TileSize - mod(newx, TileSize);
			}
			parent.x = ~~newx;
		}
		else if (newx > oldx) {
			if ($.world.collidesWithTile(parent, 'right')) {
				EventEmitter.instance.emit('wallcollide', parent, { d: 'right' });
				newx -= newx % TileSize;
			}
			parent.x = ~~newx;
		}
	}

	/**
	 * Checks for tile collision along the Y-axis and updates the object's position accordingly.
	 * @param oldy The previous Y-coordinate of the object.
	 * @param newy The new Y-coordinate of the object.
	 */
	protected checkTileCollisionForYAxis(parent: WorldObject, oldy: number, newy: number) {
		if (newy < oldy) {
			if ($.world.collidesWithTile(parent, 'up')) {
				EventEmitter.instance.emit('wallcollide', parent, { d: 'up' });
				newy += TileSize - mod(newy, TileSize);
			}
			parent.y = ~~newy;
		}
		else if (newy > oldy) {
			if ($.world.collidesWithTile(parent, 'down')) {
				EventEmitter.instance.emit('wallcollide', parent, { d: 'down' });
				newy -= newy % TileSize;
			}
			parent.y = ~~newy;
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
	 * Event handler for the 'screen.leaving' event.
	 * @param emitter - The ID of the world object emitting the event.
	 * @param d - The direction in which the world object is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the world object.
	 */
	@subscribesToParentScopedEvent('screen.leaving')
	public onLeavingScreen(event: GameEvent) {
		const emitter = event.emitter as WorldObject;
		const detail = event as GameEvent<'screen.leaving', WorldObjectEventPayloads['screen.leaving']>;
		leavingScreenHandler_prohibit(emitter, { d: detail.d, old_x_or_y: detail.old_x_or_y });
	}
}
