import { appendAffine2, type Affine2 } from '../../../../common/affine2';
import { clamp } from '../../../../../machine/ts/common/clamp';
import { create_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import type { HostBitmap } from '../../../../../machine/ts/render/host_overlay/bitmap';
import type { WorkspaceImageAsset, WorkspaceImageAssets } from '../../../../workspace/image_assets';
import type { SceneSourceObject } from '../model';
import type { SceneSpriteSource, SceneRectangleSource, SceneTextSource, SceneCanvasSource, SceneVisualReadModel } from '../visual_projection';
import type { SceneTransformPreview } from '../transform_proposal';
import type { SceneViewportCamera } from './camera';
import { layoutSceneText } from './text_layout';

type QuadGeometry = {
	affine: Affine2;
	offsetX: number; offsetY: number; color: number;
	width: number; height: number;
	x: number; y: number; xx: number; xy: number; yx: number; yy: number;
};
export type SceneViewportQuad<Owner = SceneSourceObject> = QuadGeometry & (
	{ readonly kind: 'sprite'; source: SceneSpriteSource<Owner> | SceneTextSource<Owner>; bitmap: HostBitmap; u0: number; v0: number; u1: number; v1: number }
	| { readonly kind: 'rectangle'; source: SceneRectangleSource<Owner> | SceneTextSource<Owner> }
);

export type SceneViewportOutline<Owner = SceneSourceObject> = {
	source: SceneCanvasSource<Owner>;
	affine: Affine2;
	readonly bounds: RectBounds;
	readonly points: number[];
	visible: boolean;
};
type PreparedVisual<Owner> = {
	source: SceneCanvasSource<Owner>; readonly affine: Affine2; placedWorld: Readonly<Affine2> | undefined;
	first: number; count: number;
};

/** Prepared source visuals and camera-projected quads; pixels never depend on camera motion. */
export class SceneViewportCanvas<Owner = SceneSourceObject> {
	public readonly items: SceneViewportQuad<Owner>[] = [];
	public readonly outlines: SceneViewportOutline<Owner>[] = [];
	public readonly represented = new Set<Owner>();
	private readonly prepared: PreparedVisual<Owner>[] = [];
	private readonly packets: SceneViewportQuad<Owner>[] = [];
	private selectionDirty = true;
	private projectedSelection: Owner | undefined;
	private source: SceneVisualReadModel<Owner> | undefined;
	private preview: SceneTransformPreview<Owner> | undefined;
	private previewRevision: number | undefined = -1;
	private assetsRevision = -1;
	public revision = 0;
	/** Packet layout/membership changes, independently of component pose changes. */
	public packetRevision = 0;
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
			this.represented.clear(); this.selectionDirty = true;
			let count = 0, packets = 0;
			if (source !== undefined) for (const visual of source.canvas) {
				const image = visual.kind === 'sprite' ? this.assets.get(visual.image) : undefined;
				if (visual.kind === 'sprite' && image === undefined) continue;
				const text = visual.kind === 'text' ? layoutSceneText(visual, this.assets) : undefined;
				if (visual.kind === 'text' && text === undefined) continue;
				let item = this.prepared[count];
				if (item === undefined) {
					item = { source: visual, placedWorld: undefined, affine: { xx: 1, xy: 0, yx: 0, yy: 1, ox: 0, oy: 0 }, first: 0, count: 0 };
					this.prepared[count] = item;
				}
				item.source = visual; item.first = packets;
				if (visual.kind === 'rectangle') this.rectangle(item, packets++, visual, visual.width, visual.height, 0, 0, visual.color);
				else if (visual.kind === 'sprite') this.sprite(item, packets++, visual, image!, 0, 0);
				else {
					if (visual.backgroundColor !== undefined) for (const glyph of text!.glyphs)
						this.rectangle(item, packets++, visual, glyph.image.width, glyph.image.height, glyph.x, glyph.y, visual.backgroundColor);
					for (const glyph of text!.glyphs) this.sprite(item, packets++, visual, glyph.image, glyph.x, glyph.y);
				}
				item.count = packets - item.first;
				count++;
			}
			this.prepared.length = count; this.packets.length = packets;
		}
		let count = 0, changed = rebound, packetsChanged = rebound;
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
			for (let index = item.first; index < item.first + item.count; index++) {
				const quad = this.packets[index];
				if (this.items[count] !== quad) { changed = packetsChanged = true; this.selectionDirty = true; }
				this.items[count++] = quad;
			}
			if (item.count > 0) this.represented.add(visual.entry);
		}
		if (count !== this.items.length) { changed = packetsChanged = true; this.selectionDirty = true; }
		this.items.length = count; if (changed) this.revision++;
		if (packetsChanged) this.packetRevision++;
	}
	/** One component pose is shared by all of its retained draw packets. */
	private rectangle(item: PreparedVisual<Owner>, index: number, source: SceneRectangleSource<Owner> | SceneTextSource<Owner>,
		width: number, height: number, offsetX: number, offsetY: number, color: number): void {
		let quad = this.packets[index];
		if (quad?.kind !== 'rectangle') {
			quad = { kind: 'rectangle', source, affine: item.affine, offsetX, offsetY, color, width, height,
				x: 0, y: 0, xx: 0, xy: 0, yx: 0, yy: 0 };
			this.packets[index] = quad;
		}
		quad.source = source; quad.affine = item.affine; quad.offsetX = offsetX; quad.offsetY = offsetY; quad.color = color;
		quad.width = width; quad.height = height;
	}
	private sprite(item: PreparedVisual<Owner>, index: number, source: SceneSpriteSource<Owner> | SceneTextSource<Owner>,
		image: WorkspaceImageAsset, offsetX: number, offsetY: number): void {
		let quad = this.packets[index];
		if (quad?.kind !== 'sprite') {
			quad = { kind: 'sprite', source, affine: item.affine, offsetX, offsetY, color: source.color,
				bitmap: image.bitmap, width: 0, height: 0, x: 0, y: 0, xx: 0, xy: 0, yx: 0, yy: 0, u0: 0, v0: 0, u1: 0, v1: 0 };
			this.packets[index] = quad;
		}
		quad.source = source; quad.affine = item.affine; quad.bitmap = image.bitmap; quad.offsetX = offsetX; quad.offsetY = offsetY; quad.color = source.color;
		const region = source.kind === 'sprite' ? source.region : undefined, bitmap = image.bitmap;
		quad.width = region === undefined ? image.width : region.width;
		quad.height = region === undefined ? image.height : region.height;
		const left = region === undefined ? image.u0 : image.u0 + region.x / bitmap.image.width;
		const top = region === undefined ? image.v0 : image.v0 + region.y / bitmap.image.height;
		const right = region === undefined ? image.u1 : image.u0 + (region.x + region.width) / bitmap.image.width;
		const bottom = region === undefined ? image.v1 : image.v0 + (region.y + region.height) / bitmap.image.height;
		const flipH = source.kind === 'sprite' && source.flipH, flipV = source.kind === 'sprite' && source.flipV;
		quad.u0 = flipH ? right : left; quad.u1 = flipH ? left : right;
		quad.v0 = flipV ? bottom : top; quad.v1 = flipV ? top : bottom;
	}

	/** Selection owns envelopes; unselected components allocate and project none. */
	private bindOutlines(selected: Owner | undefined): void {
		let count = 0;
		if (selected !== undefined && this.represented.has(selected)) for (const item of this.prepared) {
			if (item.source.entry !== selected || item.count === 0) continue;
			let outline = this.outlines[count];
			if (outline === undefined) {
				outline = { source: item.source, affine: item.affine, bounds: create_rect_bounds(), points: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], visible: true };
				this.outlines[count] = outline;
			}
			outline.source = item.source; outline.affine = item.affine;
			const bounds = outline.bounds;
			bounds.left = bounds.top = Infinity; bounds.right = bounds.bottom = -Infinity;
			for (let index = item.first; index < item.first + item.count; index++) {
				const quad = this.packets[index];
				bounds.left = Math.min(bounds.left, quad.offsetX, quad.offsetX + quad.width);
				bounds.top = Math.min(bounds.top, quad.offsetY, quad.offsetY + quad.height);
				bounds.right = Math.max(bounds.right, quad.offsetX, quad.offsetX + quad.width);
				bounds.bottom = Math.max(bounds.bottom, quad.offsetY, quad.offsetY + quad.height);
			}
			count++;
		}
		this.outlines.length = count; this.projectedSelection = selected; this.selectionDirty = false;
	}

	public project(camera: SceneViewportCamera, bounds: Readonly<RectBounds>, allocation: number, selected?: Owner): boolean {
		const geometry = this.projectedContent !== this.revision || this.projectedCamera !== camera.revision || this.projectedAllocation !== allocation;
		const selection = this.selectionDirty || this.projectedSelection !== selected;
		if (!geometry && !selection) return false;
		if (selection) this.bindOutlines(selected);
		this.projectedContent = this.revision; this.projectedCamera = camera.revision; this.projectedAllocation = allocation;
		const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2, scale = camera.scale;
		if (geometry && camera.mode === '2d') for (const item of this.items) {
			const affine = item.affine;
			const x = affine.xx * item.offsetX + affine.yx * item.offsetY;
			const y = affine.xy * item.offsetX + affine.yy * item.offsetY;
			item.x = centerX + camera.projectX(x, y, 0, affine.ox, affine.oy);
			item.y = centerY + camera.projectY(x, y, 0, affine.ox, affine.oy);
			item.xx = item.width * affine.xx * scale; item.xy = item.width * affine.xy * scale;
			item.yx = item.height * affine.yx * scale; item.yy = item.height * affine.yy * scale;
		}
		for (const outline of this.outlines) {
			const { affine, bounds, points } = outline;
			const signY = camera.mode === '3d' ? -1 : 1;
			outline.visible = true;
			for (let corner = 0; corner < 4; corner++) {
				const x = corner === 0 || corner === 3 ? bounds.left : bounds.right;
				const y = corner < 2 ? bounds.top : bounds.bottom;
				const localX = affine.xx * x + affine.yx * y, localY = affine.xy * x + affine.yy * y;
				if (camera.mode === '3d' && camera.depth(localX, -localY, 0, affine.ox, -affine.oy) < camera.near) { outline.visible = false; break; }
				points[corner * 2] = centerX + camera.projectX(localX, localY * signY, 0, affine.ox, affine.oy * signY);
				points[corner * 2 + 1] = centerY + camera.projectY(localX, localY * signY, 0, affine.ox, affine.oy * signY);
			}
			points[8] = points[0]; points[9] = points[1];
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
			const affine = item.affine, x = affine.ox + affine.xx * item.offsetX + affine.yx * item.offsetY;
			const y = affine.oy + affine.xy * item.offsetX + affine.yy * item.offsetY;
			const xx = item.width * affine.xx, xy = item.width * affine.xy, yx = item.height * affine.yx, yy = item.height * affine.yy;
			left = Math.min(left, x, x + xx, x + yx, x + xx + yx); right = Math.max(right, x, x + xx, x + yx, x + xx + yx);
			top = Math.min(top, y, y + xy, y + yy, y + xy + yy); bottom = Math.max(bottom, y, y + xy, y + yy, y + xy + yy); count++;
		}
		if (count === 0) return false;
		target.left = left; target.top = top; target.right = right; target.bottom = bottom; return true;
	}
	public dispose(): void { this.items.length = this.outlines.length = this.prepared.length = this.packets.length = 0; this.represented.clear(); this.source = undefined; this.preview = undefined; }
}
