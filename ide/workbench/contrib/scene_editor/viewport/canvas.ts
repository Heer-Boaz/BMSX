import { appendAffine2, type Affine2 } from '../../../../common/affine2';
import { clamp } from '../../../../../machine/ts/common/clamp';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type { HostBitmap } from '../../../../../machine/ts/render/host_overlay/bitmap';
import type { WorkspaceImageAssets } from '../../../../workspace/image_assets';
import type { SceneSourceObject } from '../model';
import type { SceneSpriteSource, SceneRectangleSource, SceneVisualReadModel } from '../visual_projection';
import type { SceneTransformPreview } from '../transform_proposal';
import type { SceneViewportCamera } from './camera';

type QuadGeometry = {
	affine: Affine2;
	width: number; height: number;
	x: number; y: number; xx: number; xy: number; yx: number; yy: number;
};
export type SceneViewportQuad<Owner = SceneSourceObject> = QuadGeometry & (
	{ readonly kind: 'sprite'; source: SceneSpriteSource<Owner>; bitmap: HostBitmap; u0: number; v0: number; u1: number; v1: number }
	| { readonly kind: 'rectangle'; source: SceneRectangleSource<Owner> }
);

type PreparedQuad<Owner> = SceneViewportQuad<Owner> & { placedWorld: Readonly<Affine2> | undefined };

/** Prepared source visuals and camera-projected quads; pixels never depend on camera motion. */
export class SceneViewportCanvas<Owner = SceneSourceObject> {
	public readonly items: SceneViewportQuad<Owner>[] = [];
	public readonly represented = new Set<Owner>();
	private readonly prepared: PreparedQuad<Owner>[] = [];
	private source: SceneVisualReadModel<Owner> | undefined;
	private preview: SceneTransformPreview<Owner> | undefined;
	private previewRevision: number | undefined = -1;
	private assetsRevision = -1;
	private contentRevision = 0;
	private projectedContent = -1;
	private projectedCamera = -1;
	private projectedAllocation = -1;
	public constructor(private readonly assets: WorkspaceImageAssets) {}
	public prepare(source: SceneVisualReadModel<Owner> | undefined, preview?: SceneTransformPreview<Owner>): void {
		const rebound = source !== this.source || this.assetsRevision !== this.assets.revision;
		if (!rebound && preview === this.preview && this.previewRevision === preview?.revision) return;
		this.preview = preview; this.previewRevision = preview?.revision;
		if (rebound) {
			this.source = source; this.assetsRevision = this.assets.revision;
			this.represented.clear();
			let count = 0;
			if (source !== undefined) for (const visual of source.canvas) {
				let item = this.prepared[count];
				if (visual.kind === 'rectangle') {
					if (item?.kind !== 'rectangle') {
						item = { kind: 'rectangle', source: visual, placedWorld: undefined, affine: { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 },
							width: visual.width, height: visual.height, x: 0, y: 0, xx: 0, xy: 0, yx: 0, yy: 0 };
						this.prepared[count] = item;
					}
					item.source = visual; item.width = visual.width; item.height = visual.height;
				} else {
					const image = this.assets.get(visual.image); if (image === undefined) continue;
					const bitmap = image.bitmap;
					if (item?.kind !== 'sprite') {
						item = { kind: 'sprite', source: visual, placedWorld: undefined, affine: { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 }, bitmap,
							width: 0, height: 0, x: 0, y: 0, xx: 0, xy: 0, yx: 0, yy: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
						this.prepared[count] = item;
					}
					item.source = visual; item.bitmap = bitmap;
					const region = visual.region;
					item.width = region === undefined ? image.width : region.width;
					item.height = region === undefined ? image.height : region.height;
					const left = region === undefined ? image.u0 : image.u0 + region.x / bitmap.image.width;
					const top = region === undefined ? image.v0 : image.v0 + region.y / bitmap.image.height;
					const right = region === undefined ? image.u1 : image.u0 + (region.x + region.width) / bitmap.image.width;
					const bottom = region === undefined ? image.v1 : image.v0 + (region.y + region.height) / bitmap.image.height;
					item.u0 = visual.flipH ? right : left; item.u1 = visual.flipH ? left : right;
					item.v0 = visual.flipV ? bottom : top; item.v1 = visual.flipV ? top : bottom;
				}
				count++;
			}
			this.prepared.length = count;
		}
		let count = 0, changed = rebound;
		for (const item of this.prepared) {
			const visual = item.source, overridden = preview !== undefined && preview.worlds.has(visual.entry);
			const world = overridden ? preview!.worlds.get(visual.entry) as Readonly<Affine2> | undefined : visual.world;
			if (world === undefined) { this.represented.delete(visual.entry); continue; }
			if (rebound || overridden || item.placedWorld !== world) {
				const affine = item.affine, attachment = visual.attachment, presentation = visual.presentation;
				const xx = affine.xx, xy = affine.xy, yx = affine.yx, yy = affine.yy, ox = affine.ox, oy = affine.oy;
				affine.xx = world.xx; affine.xy = world.xy; affine.yx = world.yx; affine.yy = world.yy; affine.ox = world.ox; affine.oy = world.oy;
				appendAffine2(affine, attachment.xx, attachment.xy, attachment.yx, attachment.yy, attachment.ox, attachment.oy);
				appendAffine2(affine, presentation.xx, presentation.xy, presentation.yx, presentation.yy, presentation.ox, presentation.oy);
				if (xx !== affine.xx || xy !== affine.xy || yx !== affine.yx || yy !== affine.yy || ox !== affine.ox || oy !== affine.oy) changed = true;
				item.placedWorld = world;
			}
			if (this.items[count] !== item) changed = true;
			this.items[count++] = item; this.represented.add(visual.entry);
		}
		if (count !== this.items.length) changed = true;
		this.items.length = count; if (changed) this.contentRevision++;
	}
	public project(camera: SceneViewportCamera, bounds: Readonly<RectBounds>, allocation: number): boolean {
		if (this.projectedContent === this.contentRevision && this.projectedCamera === camera.revision && this.projectedAllocation === allocation) return false;
		this.projectedContent = this.contentRevision; this.projectedCamera = camera.revision; this.projectedAllocation = allocation;
		if (camera.mode !== '2d') return true;
		const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2, scale = camera.scale;
		for (const item of this.items) {
			const affine = item.affine;
			item.x = centerX + camera.projectX(affine.ox, affine.oy, 0); item.y = centerY + camera.projectY(affine.ox, affine.oy, 0);
			item.xx = item.width * affine.xx * scale; item.xy = item.width * affine.xy * scale;
			item.yx = item.height * affine.yx * scale; item.yy = item.height * affine.yy * scale;
		}
		return true;
	}
	/** Hit actual solid coverage or nontransparent texels, from front to back. */
	public pick(x: number, y: number): Owner | undefined {
		for (let index = this.items.length - 1; index >= 0; index--) {
			const item = this.items[index];
			const determinant = item.xx * item.yy - item.yx * item.xy; if (determinant === 0) continue;
			const dx = x - item.x, dy = y - item.y;
			const u = (dx * item.yy - dy * item.yx) / determinant, v = (dy * item.xx - dx * item.xy) / determinant;
			if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) continue;
			if (item.kind === 'rectangle') return item.source.entry;
			const image = item.bitmap.image;
			const sourceX = clamp(Math.trunc((item.u0 + (item.u1 - item.u0) * u) * image.width), 0, image.width - 1);
			const sourceY = clamp(Math.trunc((item.v0 + (item.v1 - item.v0) * v) * image.height), 0, image.height - 1);
			if (image.pixels[(sourceY * image.width + sourceX) * 4 + 3] > 0) return item.source.entry;
		}
	}
	/** Actual world-space quad corners, before the editor camera; no inferred object boxes. */
	public frameBounds(selected: ReadonlySet<Owner> | undefined, target: RectBounds): boolean {
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
		for (const item of this.items) {
			if (selected !== undefined && !selected.has(item.source.entry)) continue;
			const affine = item.affine, x = affine.ox, y = affine.oy;
			const xx = item.width * affine.xx, xy = item.width * affine.xy, yx = item.height * affine.yx, yy = item.height * affine.yy;
			left = Math.min(left, x, x + xx, x + yx, x + xx + yx); right = Math.max(right, x, x + xx, x + yx, x + xx + yx);
			top = Math.min(top, y, y + xy, y + yy, y + xy + yy); bottom = Math.max(bottom, y, y + xy, y + yy, y + xy + yy); count++;
		}
		if (count === 0) return false;
		target.left = left; target.top = top; target.right = right; target.bottom = bottom; return true;
	}
	public dispose(): void { this.items.length = this.prepared.length = 0; this.represented.clear(); this.source = undefined; this.preview = undefined; }
}
