import type { GameEvent } from '../core/game_event';
import { WorldObject, WorldObjectEventPayloads } from "../core/object/worldobject";
import { new_vec2, set_inplace_vec2 } from '../utils/vector_operations';
import { vec2, type Area, type Polygon } from '../rompack/rompack';
import { excludepropfromsavegame, insavegame } from '../serializer/serializationhooks';
import { Component, componenttags_preprocessing, type ComponentAttachOptions } from "./basecomponent";

/**
 * ColliderComponent holds collision shapes for a WorldObject.
 * Shapes are stored in local space; world-space accessors apply parent position at read-time.
 *
 * - Preferred usage: derive local shapes from sprite metadata.
 * - Custom usage: call setters to provide authored shapes.
 */
@insavegame
export class Collider2DComponent extends Component<WorldObject> {
	static { this.autoRegister(); }
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
	private _localArea: Area = null;

	/** Local-space polygons; each polygon is a flat [x0,y0,x1,y1,...] list. */
	@excludepropfromsavegame
	private _localPolys: Polygon[] = null;

	/** Local-space circle (x,y,r), optional. */
	@excludepropfromsavegame
	private _localCircle: { x: number; y: number; r: number } = null;

	/** Internal change token for sprite-driven sync (imgid + flip). */
	@excludepropfromsavegame
	private _syncToken?: string;

	/** Optional hint for a sync system to avoid repeated work. */
	public get syncToken(): string { return this._syncToken; }
	public set syncToken(v: string) { this._syncToken = v; }

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
		const parent = this.parent;
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
	public get worldPolygons(): Polygon[] {
		if (!this._localPolys || this._localPolys.length === 0) return null;
		const parent = this.parent;
		const px = parent.x;
		const py = parent.y;
		return this._localPolys.map(poly => {
			const res: number[] = [];
			for (let i = 0; i < poly.length; i += 2) res.push(poly[i] + px, poly[i + 1] + py);
			return res;
		});
	}

	/** Returns local-space area, if any. */
	public get localArea(): Area { return this._localArea; }
	/** Returns local-space polygons, if any. */
	public get localPolygons(): Polygon[] { return this._localPolys; }
	/** Returns local-space circle, if any. */
	public get localCircle(): { x: number; y: number; r: number } { return this._localCircle; }

	/** Set local rectangle bounds (replaces previous). */
	public setLocalArea(a: Area): void { this._localArea = a; }
	/** Set local polygons (replaces previous). */
	public setLocalPolygons(polys: Polygon[]): void { this._localPolys = polys; }
	/** Set local circle (replaces previous). */
	public setLocalCircle(c: { x: number; y: number; r: number }): void { this._localCircle = c; }

	/** Returns world-space circle, if any. */
	public get worldCircle(): { x: number; y: number; r: number } {
		if (!this._localCircle) return null;
		const parent = this.parent;
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
 * Physics systems read the captured old position to resolve collisions and boundaries.
 */
@insavegame
@componenttags_preprocessing('position_update_axis') // Store old position for physics systems.
export abstract class PositionUpdateAxisComponent extends Component<any> {
	/**
	 * The previous position of the world object.
	 */
	public oldPos: vec2;

	constructor(opts: ComponentAttachOptions) {
		super(opts);
		this.oldPos = new_vec2(0, 0);
	}

	override preprocessingUpdate(): void {
		const parent = this.parent;
		set_inplace_vec2(this.oldPos, parent.pos);
	}
}

/**
 * Marker component for screen boundary handling, used by BoundarySystem.
 * @class
 * @extends PositionUpdateAxisComponent
 */
@insavegame
export class ScreenBoundaryComponent extends PositionUpdateAxisComponent {
	static override get unique(): boolean { return true; }
	static { this.autoRegister(); }
}

/**
 * Marker component for tile collisions; TileCollisionSystem performs resolution.
 */
@insavegame
export class TileCollisionComponent extends PositionUpdateAxisComponent {
	static override get unique() { return true; }
	static { this.autoRegister(); }
}

/**
 * Represents a component that prohibits the world object from leaving the screen boundary.
 * Inherits from ScreenBoundaryComponent.
 */
@insavegame
export class ProhibitLeavingScreenComponent extends ScreenBoundaryComponent {
	static { this.autoRegister(); }

	public override bind(): void {
		super.bind();
		this.parent.events.on({
			event_name: 'screen.leaving',
			handler: this.onLeavingScreen,
			subscriber: this,
		});
		this.parent.events.on({
			event_name: 'screen.leave',
			handler: this.onLeavingScreen,
			subscriber: this,
		});
	}

	/**
	 * Event handler for the 'screen.leaving' event.
	 * @param emitter - The ID of the world object emitting the event.
	 * @param d - The direction in which the world object is leaving the screen.
	 * @param old_x_or_y - The previous x or y coordinate of the world object.
	 */
	public onLeavingScreen(event: GameEvent) {
		const emitter = event.emitter as WorldObject;
		const detail = event as GameEvent<'screen.leave', WorldObjectEventPayloads['screen.leave']>;
		leavingScreenHandler_prohibit(emitter, { d: detail.d, old_x_or_y: detail.old_x_or_y });
	}
}
