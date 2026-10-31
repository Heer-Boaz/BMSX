import { clamp } from '../../../../../machine/ts/common/clamp';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type { HostBitmap } from '../../../../../machine/ts/render/host_overlay/bitmap';
import { WorkspaceImageAssets } from '../../../../workspace/image_assets';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import type { SceneSourceObject } from '../model';
import type { SceneSpriteSource, SceneVisualReadModel } from '../visual_projection';
import type { SceneViewportCamera } from './camera';

export type SceneViewportSprite = {
	source: SceneSpriteSource;
	bitmap: HostBitmap;
	width: number; height: number;
	x: number; y: number; xx: number; xy: number; yx: number; yy: number;
	u0: number; v0: number; u1: number; v1: number;
};

/** Prepared source visuals and camera-projected quads; pixels never depend on camera motion. */
export class SceneViewportSprites {
	public readonly items: SceneViewportSprite[] = [];
	public readonly represented = new Set<SceneSourceObject>();
	private readonly assets: WorkspaceImageAssets;
	private readonly imageIds = new Set<string>();
	private source: SceneVisualReadModel | undefined;
	private catalogRevision = -1;
	private contentRevision = 0;
	private projectedContent = -1;
	private projectedCamera = -1;
	private projectedAllocation = -1;
	public constructor(private readonly catalog: WorkspaceSourceCatalog, private readonly contextId: string) {
		this.assets = new WorkspaceImageAssets(catalog);
	}
	public prepare(source: SceneVisualReadModel | undefined): void {
		if (source === this.source && this.catalogRevision === this.catalog.revision) return;
		this.source = source; this.catalogRevision = this.catalog.revision; this.contentRevision++;
		this.imageIds.clear(); this.represented.clear();
		if (source !== undefined) for (const sprite of source.sprites) this.imageIds.add(sprite.image);
		this.assets.update(this.contextId, this.imageIds);
		let count = 0;
		if (source !== undefined) for (const sprite of source.sprites) {
			const image = this.assets.get(sprite.image); if (image === undefined) continue;
			const bitmap = image.bitmap;
			let item = this.items[count];
			if (item === undefined) {
				item = { source: sprite, bitmap, width: 0, height: 0, x: 0, y: 0, xx: 0, xy: 0, yx: 0, yy: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
				this.items.push(item);
			}
			item.source = sprite; item.bitmap = bitmap;
			this.represented.add(sprite.entry);
			const region = sprite.region;
			item.width = region === undefined ? image.width : region.width;
			item.height = region === undefined ? image.height : region.height;
			const left = region === undefined ? image.u0 : image.u0 + region.x / bitmap.image.width;
			const top = region === undefined ? image.v0 : image.v0 + region.y / bitmap.image.height;
			const right = region === undefined ? image.u1 : image.u0 + (region.x + region.width) / bitmap.image.width;
			const bottom = region === undefined ? image.v1 : image.v0 + (region.y + region.height) / bitmap.image.height;
			item.u0 = sprite.flipH ? right : left; item.u1 = sprite.flipH ? left : right;
			item.v0 = sprite.flipV ? bottom : top; item.v1 = sprite.flipV ? top : bottom;
			count++;
		}
		this.items.length = count;
	}
	public project(camera: SceneViewportCamera, bounds: Readonly<RectBounds>, allocation: number): boolean {
		if (this.projectedContent === this.contentRevision && this.projectedCamera === camera.revision && this.projectedAllocation === allocation) return false;
		this.projectedContent = this.contentRevision; this.projectedCamera = camera.revision; this.projectedAllocation = allocation;
		if (camera.mode !== '2d') return true;
		const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2, scale = camera.scale;
		for (const item of this.items) {
			const affine = item.source.affine;
			item.x = centerX + camera.projectX(affine.ox, affine.oy, 0); item.y = centerY + camera.projectY(affine.ox, affine.oy, 0);
			item.xx = item.width * affine.xx * scale; item.xy = item.width * affine.xy * scale;
			item.yx = item.height * affine.yx * scale; item.yy = item.height * affine.yy * scale;
		}
		return true;
	}
	/** Hit the actual displayed, nontransparent texture, from front to back. */
	public pick(x: number, y: number): SceneSourceObject | undefined {
		for (let index = this.items.length - 1; index >= 0; index--) {
			const item = this.items[index];
			const determinant = item.xx * item.yy - item.yx * item.xy; if (determinant === 0) continue;
			const dx = x - item.x, dy = y - item.y;
			const u = (dx * item.yy - dy * item.yx) / determinant, v = (dy * item.xx - dx * item.xy) / determinant;
			if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) continue;
			const image = item.bitmap.image;
			const sourceX = clamp(Math.trunc((item.u0 + (item.u1 - item.u0) * u) * image.width), 0, image.width - 1);
			const sourceY = clamp(Math.trunc((item.v0 + (item.v1 - item.v0) * v) * image.height), 0, image.height - 1);
			if (image.pixels[(sourceY * image.width + sourceX) * 4 + 3] > 0) return item.source.entry;
		}
	}
	/** Actual world-space quad corners, before the editor camera; no inferred object boxes. */
	public frameBounds(selected: ReadonlySet<SceneSourceObject> | undefined, target: RectBounds): boolean {
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
		for (const item of this.items) {
			if (selected !== undefined && !selected.has(item.source.entry)) continue;
			const affine = item.source.affine, x = affine.ox, y = affine.oy;
			const xx = item.width * affine.xx, xy = item.width * affine.xy, yx = item.height * affine.yx, yy = item.height * affine.yy;
			left = Math.min(left, x, x + xx, x + yx, x + xx + yx); right = Math.max(right, x, x + xx, x + yx, x + xx + yx);
			top = Math.min(top, y, y + xy, y + yy, y + xy + yy); bottom = Math.max(bottom, y, y + xy, y + yy, y + xy + yy); count++;
		}
		if (count === 0) return false;
		target.left = left; target.top = top; target.right = right; target.bottom = bottom; return true;
	}
	public dispose(): void { this.assets.dispose(); this.items.length = 0; this.imageIds.clear(); this.represented.clear(); this.source = undefined; }
}
