import { RectBounds, BoundingBoxPrecalc, type HitPolygonsPrecalc, type Polygon } from "../../rompack/rompack";
import { insavegame, type RevivableObjectArgs } from '../../serializer/serializationhooks';
import { WorldObject } from "./worldobject";
import { SpriteComponent } from '../../component/sprite_component';
import { Collider2DComponent } from '../../component/collisioncomponents';
import { $ } from '../engine_core';
import { TimelinePlayOptions } from '../..';
import { color } from '../../render/shared/render_types';

const BASE_SPRITE_ID = 'base_sprite';
const PRIMARY_COLLIDER_ID = 'primary';

@insavegame
/**
 * A class representing a world object that can be rendered as a sprite.
 * Extends the WorldObject class.
 */
export class SpriteObject extends WorldObject {
	public override get __native__(): string { return 'sprite_object'; }

	private get sprite_component(): SpriteComponent {
		const comp = this.get_component_by_local_id(SpriteComponent, BASE_SPRITE_ID);
		if (!comp) {
			throw new Error(`[SpriteObject:${this.id}] Missing SpriteComponent '${BASE_SPRITE_ID}'.`);
		}
		return comp;
	}
	public get flip_h(): boolean { return this.sprite_component.flip.flip_h; }
	public set flip_h(fh: boolean) { this.sprite_component.flip = { ...this.sprite_component.flip, flip_h: !!fh }; this.updateHitareas(); }
	public get flip_v(): boolean { return this.sprite_component.flip.flip_v; }
	public set flip_v(fv: boolean) { this.sprite_component.flip = { ...this.sprite_component.flip, flip_v: !!fv }; this.updateHitareas(); }
	public get imgid(): string { return this.sprite_component.imgid; }
	/** Sets the image id and updates object size/hitareas from ROM metadata. */
	public set imgid(id: string) {
		const comp = this.sprite_component;
		comp.imgid = id;
		const entry = $.rompack.img[id];
		if (!entry) {
			if (id === 'none') { this.updateHitareas(); return; }
			throw new Error(`[SpriteObject:${this.id}] Sprite asset '${id}' not found in rompack.`);
		}
		const imgmeta = entry.imgmeta;
		if (!imgmeta) {
			throw new Error(`[SpriteObject:${this.id}] Sprite asset '${id}' is missing metadata.`);
		}
		this.sx = imgmeta['width'];
		this.sy = imgmeta['height'];
		this.updateHitareas();
	}
	public get colorize(): color { return this.sprite_component.colorize; }
	public set colorize(c: color) { this.sprite_component.colorize = c; }

	private updateHitareas() {
		const id = this.imgid;
		if (id === 'none') {
			const collider = this.collider;
			collider.set_local_area(null);
			collider.set_local_poly(null);
			return;
		}
		const entry = $.rompack.img[id];
		if (!entry) {
			throw new Error(`[SpriteObject:${this.id}] Sprite asset '${id}' not found in rompack.`);
		}
		const imgmeta = entry.imgmeta;
		if (!imgmeta) {
			throw new Error(`[SpriteObject:${this.id}] Sprite asset '${id}' is missing metadata.`);
		}
		const col = this.collider;
		const boundingbox = imgmeta['boundingbox'];
		if (boundingbox) {
			col.set_local_area(SpriteObject.selectBoundingBox(this.flip_h, this.flip_v, boundingbox));
		}
		const polygonsMeta = imgmeta['hitpolygons'];
		if (polygonsMeta) {
			col.set_local_poly(SpriteObject.selectConcavePolygon(this.flip_h, this.flip_v, polygonsMeta));
		}
		else {
			col.set_local_poly(null);
		}
	}

	private static selectBoundingBox(flip_h: boolean, flip_v: boolean, box: BoundingBoxPrecalc): RectBounds {
		if (flip_h && flip_v) {
			return box.fliphv;
		} else if (flip_h) {
			return box.fliph;
		} else if (flip_v) {
			return box.flipv;
		} else {
			return box.original;
		}
	}

	private static selectConcavePolygon(flip_h: boolean, flip_v: boolean, polys: HitPolygonsPrecalc): Polygon[] {
		if (flip_h && flip_v) {
			return polys.fliphv;
		} else if (flip_h) {
			return polys.fliph;
		} else if (flip_v) {
			return polys.flipv;
		} else {
			return polys.original;
		}
	}

	constructor(opts: RevivableObjectArgs & { id?: string, fsm_id?: string }) {
		super(opts);
		// Attach base SpriteComponent (data-driven sprite handled by SpriteRenderSystem)
		const baseSprite = new SpriteComponent({ parent_or_id: this, imgid: 'none', id_local: BASE_SPRITE_ID, collider_local_id: PRIMARY_COLLIDER_ID });
		this.add_component(baseSprite);
		// Attach Collider by default; sprite-driven sync will populate shapes
		this.add_component(new Collider2DComponent({ parent_or_id: this, id_local: PRIMARY_COLLIDER_ID }));
	}

	public play_ani(id: string, opts?: TimelinePlayOptions): void {
		this.get_component_by_local_id(SpriteComponent, BASE_SPRITE_ID).play_ani(id, opts);
	}

	public stop_ani(id: string): void {
		this.get_component_by_local_id(SpriteComponent, BASE_SPRITE_ID).stop_ani(id);
	}

	public resume_ani(id: string): void {
		this.get_component_by_local_id(SpriteComponent, BASE_SPRITE_ID).resume_ani(id);
	}

	// Note: rendering handled by SpriteRenderSystem via SpriteComponent
}
