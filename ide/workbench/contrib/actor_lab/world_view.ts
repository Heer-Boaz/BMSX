import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { GX_SYSTEM_TEXTURE_X, GX_SYSTEM_TEXTURE_Y } from '../../../../toolchain/ts/rompack/system_texture';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { api } from '../../../runtime/overlay_api';
import { ARTWORK_COLORS } from '../../../theme/artwork_colors';
import { WorkbenchViewportCamera } from '../../ui/viewport_camera';
import { SceneViewportGeometry, type SceneViewportGeometryBounds } from '../scene_editor/viewport/geometry';
import { measureViewportCanvas, pickViewportCanvas, projectViewportCanvas, type ViewportCanvasQuad } from '../scene_editor/viewport/canvas_geometry';
import { ActorWorldAssets } from './world_assets';
import type { ActorRenderFrames } from './render_frames';
import { ActorRenderGeometry } from './render_geometry';
import type { WorldActor, WorldCanvasVisual, WorldModelKey, WorldModelVisual, WorldPacket } from './world_geometry';
import { drawCanvas } from '../scene_editor/viewport/canvas_render';

/** One live view of the displayed world's retained evidence. Navigation never
 * executes Lua, installs media, or changes the cartridge's camera. */
export class ActorWorldView {
	public mode: 'game' | '2d' | '3d' = 'game';
	public navigationTool: 'select' | 'pan' | 'orbit' = 'select';
	public navigationSpeed = 1;
	public readonly camera = new WorkbenchViewportCamera();
	public readonly bounds = create_rect_bounds();
	public readonly assets: ActorWorldAssets;
	public readonly canvas = { items: [] as ViewportCanvasQuad<WorldActor>[], revision: 0, packetRevision: 0 };
	public readonly geometry: SceneViewportGeometry<WorldActor, WorldModelKey>;
	// Game-frame commits happen after this view's draw submission. Own the poses
	// and identities used by its pixels and picking until its next publication.
	// Immutable appearances remain shared; scalar slots are reused, not allocated
	// per frame or read back from the guest during navigation.
	private readonly presentation = new ActorRenderGeometry();
	private readonly models: WorldModelVisual[] = [];
	private readonly frame = { models: this.models };
	private readonly appearances: WorldCanvasVisual['appearance'][] = [];
	private readonly packets: ViewportCanvasQuad<WorldActor>[] = [];
	private readonly packetInputs: WorldPacket[] = [];
	private selectedDomain = -2; private selectedHashId = 0;
	private frameRevision = -1;
	private geometryRevision = -1;
	private cameraRevision = -1;
	private allocationRevision = 0;
	private projectedAllocation = -1;
	private readonly selected = new Set<WorldActor>();
	private readonly canvasBounds = create_rect_bounds();
	private readonly spaceBounds: SceneViewportGeometryBounds = { originX: 0, originY: 0, originZ: 0, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
	private readonly outlines = new ScratchBuffer<number[]>(() => []);
	private readonly boxCorners = new Float64Array(16);
	public constructor(sources: RuntimeSourceState, private readonly frames: ActorRenderFrames) {
		this.assets = new ActorWorldAssets(sources); this.geometry = new SceneViewportGeometry(this.assets, this.canvas);
	}
	public setMode(mode: 'game' | '2d' | '3d'): void {
		this.mode = mode;
		if (mode !== 'game') this.camera.setMode(mode);
		if (mode === '2d' && this.navigationTool === 'orbit') this.navigationTool = 'select';
	}
	public refresh(bounds: Readonly<RectBounds>, domain: number, hashId: number): void {
		if (this.mode === 'game') return;
		const resized = bounds.left !== this.bounds.left || bounds.top !== this.bounds.top || bounds.right !== this.bounds.right || bounds.bottom !== this.bounds.bottom;
		if (resized) { Object.assign(this.bounds, bounds); this.allocationRevision++; this.camera.setViewport(bounds.right - bounds.left, bounds.bottom - bounds.top); }
		const revision = this.frames.revision, frameChanged = revision !== this.frameRevision;
		if (frameChanged) {
			this.frameRevision = revision;
			this.presentation.copyFrom(this.frames.displayed);
			const world = this.presentation.world;
			let count = 0, changed = this.appearances.length !== world.canvas.length;
			for (let index = 0; index < world.canvas.length; index++) {
				const visual = world.canvas.peek(index), appearance = visual.appearance!;
				const rebuild = this.appearances[index] !== appearance;
				this.appearances[index] = appearance; changed ||= rebuild;
				for (const packet of appearance.packets) {
					const image = packet.image, kind = image === undefined ? 'rectangle' : 'sprite';
					let quad = this.packets[count];
					if (quad === undefined || quad.kind !== kind) {
						const common = { source: { entry: visual.actor }, affine: visual.pose, offsetX: 0, offsetY: 0, color: 0,
							width: 0, height: 0, x: 0, y: 0, xx: 0, xy: 0, yx: 0, yy: 0 };
						quad = image === undefined ? { ...common, kind: 'rectangle' } : { ...common, kind: 'sprite', bitmap: this.assets.texture(image.texture), u0: 0, v0: 0, u1: 0, v1: 0 };
						this.packets[count] = quad; changed = true;
					}
					if (this.packetInputs[count] !== packet || quad.source.entry !== visual.actor) {
						this.packetInputs[count] = packet;
						quad.source = visual.actor === quad.source.entry ? quad.source : { entry: visual.actor };
						quad.offsetX = packet.x; quad.offsetY = packet.y; quad.width = packet.width; quad.height = packet.height; quad.color = packet.color;
						if (quad.kind === 'sprite') {
							quad.bitmap = this.assets.texture(image!.texture);
							const fixed = image!.texture.address === null, x = image!.x - (fixed ? GX_SYSTEM_TEXTURE_X : 0), y = image!.y - (fixed ? GX_SYSTEM_TEXTURE_Y : 0);
							const width = quad.bitmap.image.width, height = quad.bitmap.image.height;
							quad.u0 = (x + (packet.flipH ? image!.width : 0)) / width; quad.u1 = (x + (packet.flipH ? 0 : image!.width)) / width;
							quad.v0 = (y + (packet.flipV ? image!.height : 0)) / height; quad.v1 = (y + (packet.flipV ? 0 : image!.height)) / height;
						}
					}
					quad.affine = visual.pose;
					this.canvas.items[count++] = quad;
				}
			}
			changed ||= count !== this.canvas.items.length;
			this.appearances.length = world.canvas.length; this.canvas.items.length = count;
			this.canvas.revision++; if (changed) this.canvas.packetRevision++;
			for (let i = 0; i < world.models.length; i++) this.models[i] = world.models.peek(i);
			this.models.length = world.models.length;
		}
		// The 2D reader does not build/upload a second, hidden 3D copy of every animated glyph or sprite.
		if (this.mode === '3d' && this.geometryRevision !== revision) {
			this.geometry.prepare(this.frame, undefined, revision); this.geometryRevision = revision;
		}
		const selectionChanged = domain !== this.selectedDomain || hashId !== this.selectedHashId;
		if (frameChanged || selectionChanged) {
			this.selectedDomain = domain; this.selectedHashId = hashId; this.selected.clear();
			for (const item of this.canvas.items) if (item.source.entry.domain === domain && item.source.entry.hashId === hashId) this.selected.add(item.source.entry);
			for (const model of this.models) if (model.entry.domain === domain && model.entry.hashId === hashId) this.selected.add(model.entry);
		}
		if (this.camera.initial) this.frameAll(false);
		if (this.cameraRevision !== this.camera.revision || this.projectedAllocation !== this.allocationRevision || this.canvas.revision !== this.projectedCanvas || selectionChanged) {
			this.cameraRevision = this.camera.revision; this.projectedAllocation = this.allocationRevision; this.projectedCanvas = this.canvas.revision;
			if (this.mode === '2d') projectViewportCanvas(this.canvas.items, this.camera, this.bounds);
			else this.geometry.project(this.camera, this.bounds);
			this.projectSelection();
		}
	}
	private projectedCanvas = -1;
	public frameAll(selection: boolean): void {
		const selected = selection ? this.selected : undefined, b = this.bounds;
		if (this.mode === '2d') {
			if (measureViewportCanvas(this.canvas.items, selected, this.canvasBounds)) {
				const a = this.canvasBounds; this.camera.frame2D(a.left, a.top, a.right, a.bottom, b.right - b.left, b.bottom - b.top);
			}
		} else if (this.geometry.frameBounds(selected, this.spaceBounds)) {
			const a = this.spaceBounds; this.camera.frame3D(a.minX, a.minY, a.minZ, a.maxX, a.maxY, a.maxZ, a.originX, a.originY, a.originZ);
		}
	}
	public pick(x: number, y: number): WorldActor | undefined {
		return this.mode === '2d' ? pickViewportCanvas(this.canvas.items, x, y)
			: this.geometry.pick(x - (this.bounds.left + this.bounds.right) / 2, y - (this.bounds.top + this.bounds.bottom) / 2, this.camera)?.entry;
	}
	public draw(): void {
		const b = this.bounds;
		api.pushClipRect(b.left, b.top, b.right, b.bottom); api.fill_rect(b.left, b.top, b.right, b.bottom, 0, ARTWORK_COLORS.background);
		if (this.mode === '2d') drawCanvas(this.canvas.items, 0xff000000);
		else api.drawMeshScene(this.geometry.scene, b.left, b.top, b.right, b.bottom);
		for (let i = 0; i < this.outlines.length; i++) {
			const points = this.outlines.peek(i); if (points.length !== 0) api.outlinedPolyline(points, 0, 0, 0);
		}

		api.popClipRect();
	}
	private projectSelection(): void {
		this.outlines.clear();
		const b = this.bounds, sign = this.mode === '3d' ? -1 : 1;
		for (const quad of this.presentation.quads) {
			if (quad.domain !== this.selectedDomain || quad.hashId !== this.selectedHashId) continue;
			const points = this.outlines.get(this.outlines.length); points.length = 0;
			for (let corner = 0; corner < 4; corner++) {
				const x = (corner === 1 || corner === 2 ? quad.ax : 0) + (corner >= 2 ? quad.bx : 0);
				const y = (corner === 1 || corner === 2 ? quad.ay : 0) + (corner >= 2 ? quad.by : 0);
				if (this.mode === '3d' && this.camera.depth(x, -y, 0, quad.ox, -quad.oy) < this.camera.near) { points.length = 0; break; }
				points.push((b.left + b.right) / 2 + this.camera.projectX(x, y * sign, 0, quad.ox, quad.oy * sign),
					(b.top + b.bottom) / 2 + this.camera.projectY(x, y * sign, 0, quad.ox, quad.oy * sign));
			}
			if (points.length !== 0) points.push(points[0], points[1]);
		}
		if (this.mode !== '3d') return;
		let modelSelected = false;
		for (const model of this.models) if (this.selected.has(model.entry)) { modelSelected = true; break; }
		if (!modelSelected || !this.geometry.frameBounds(this.selected, this.spaceBounds)) return;
		// Selection extent is measured from the transformed mesh vertices. It is
		// not a collision shape and never substitutes for triangle/texel picking.
		const a = this.spaceBounds, corners = this.boxCorners;
		for (let corner = 0; corner < 8; corner++) {
			const x = (corner & 1) === 0 ? a.minX : a.maxX, y = (corner & 2) === 0 ? a.minY : a.maxY, z = (corner & 4) === 0 ? a.minZ : a.maxZ;
			if (this.camera.depth(x, y, z, a.originX, a.originY, a.originZ) < this.camera.near) return;
			corners[corner * 2] = (b.left + b.right) / 2 + this.camera.projectX(x, y, z, a.originX, a.originY, a.originZ);
			corners[corner * 2 + 1] = (b.top + b.bottom) / 2 + this.camera.projectY(x, y, z, a.originX, a.originY, a.originZ);
		}
		for (let corner = 0; corner < 8; corner++) for (let bit = 1; bit <= 4; bit <<= 1) if ((corner & bit) === 0) {
			const line = this.outlines.get(this.outlines.length), other = corner | bit;
			line.length = 4; line[0] = corners[corner * 2]; line[1] = corners[corner * 2 + 1]; line[2] = corners[other * 2]; line[3] = corners[other * 2 + 1];
		}
	}
	public retire(): void {
		this.presentation.clear();
		this.frameRevision = this.geometryRevision = -1; this.models.length = this.canvas.items.length = this.appearances.length = this.packets.length = this.packetInputs.length = 0;
		this.canvas.revision++; this.canvas.packetRevision++; this.geometry.prepare(undefined); this.assets.dispose(); this.selected.clear(); this.outlines.clear();
	}
	public dispose(): void { this.geometry.dispose(); this.assets.dispose(); }
}
