import { color } from "../../render/gameview";
import { Area, BoundingBoxPrecalc, type HitPolygonsPrecalc, type Polygon } from "../../rompack/rompack";
import { insavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import { $rompack } from '../game';
import { WorldObject } from "./worldobject";
import { SpriteComponent } from '../../component/sprite_component';
import { Collider2DComponent } from '../../component/collisioncomponents';

@insavegame
/**
 * An abstract class representing a world object that can be rendered as a sprite.
 * Extends the WorldObject class.
 */
export abstract class SpriteObject extends WorldObject {
	private get spriteComp(): SpriteComponent | undefined { return this.getFirstComponent(SpriteComponent); }
	public get flip_h(): boolean { return !!this.spriteComp?.flip.flip_h; }
	public set flip_h(fh: boolean) { if (this.spriteComp) this.spriteComp.flip = { ...this.spriteComp.flip, flip_h: !!fh }; this.updateHitareas(); }
	public get flip_v(): boolean { return !!this.spriteComp?.flip.flip_v; }
	public set flip_v(fv: boolean) { if (this.spriteComp) this.spriteComp.flip = { ...this.spriteComp.flip, flip_v: !!fv }; this.updateHitareas(); }
	public get imgid(): string { return this.spriteComp?.imgid ?? 'none'; }
	/** Sets the image id and updates object size/hitareas from ROM metadata. */
	public set imgid(id: string) {
		const comp = this.spriteComp; if (comp) comp.imgid = id;
		const imgmeta = $rompack['img'][id]?.['imgmeta'];
		if (imgmeta) {
			this.sx = imgmeta['width'];
			this.sy = imgmeta['height'];
			this.updateHitareas();
		}
	}
	public get colorize(): color { return this.spriteComp?.colorize ?? { r: 1, g: 1, b: 1, a: 1 }; }
	public set colorize(c: color) { if (this.spriteComp) this.spriteComp.colorize = c; }

	private updateHitareas() {
		const id = this.imgid;
		const imgmeta = $rompack['img'][id]?.['imgmeta'];
		if (!imgmeta) return; // No image metadata available (e.g. for image 'none'), cannot update collider
		const col = this.getOrCreateCollider();
		const boundingbox = imgmeta['boundingbox'];
		if (boundingbox) {
			col.setLocalArea(SpriteObject.selectBoundingBox(this.flip_h, this.flip_v, boundingbox));
		}
		const polygonsMeta = imgmeta['hitpolygons'];
		if (polygonsMeta) {
			col.setLocalPolygons(SpriteObject.selectConcavePolygon(this.flip_h, this.flip_v, polygonsMeta));
		}
		else {
			col.setLocalPolygons(null);
		}
	}

	private static selectBoundingBox(flip_h: boolean, flip_v: boolean, box: BoundingBoxPrecalc): Area {
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
		this.addComponent(new SpriteComponent({ parentid: this.id, imgid: 'none', id_local: 'base_sprite' }));
		// Attach Collider by default; sprite-driven sync will populate shapes
		this.addComponent(new Collider2DComponent({ parentid: this.id }));
	}

	// queueRenderSubmissions removed — handled by SpriteRenderSystem via SpriteComponent
}
