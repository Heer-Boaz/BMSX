import { create_rect_bounds, copy_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import type { SceneAuthoringContext } from '../authoring_context';
import type { SceneSourceObject } from '../model';
import type { SceneSpatialReadModel } from '../spatial_projection';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import { SceneViewportCamera } from './camera';
import { SceneViewportSprites } from './sprites';
import { SceneViewportModels, type SceneViewportModelBounds } from './models';
import type { SceneVisualReadModel } from '../visual_projection';

export const SCENE_VIEWPORT_POINT_STRIDE = 8;
const AXIS_UNIT_PIXELS = 16;

/** Retained source reading and numeric screen projection; selection stays with the authored context. */
export class SceneViewportViewState {
	public readonly camera = new SceneViewportCamera();
	public readonly sprites: SceneViewportSprites;
	public readonly models: SceneViewportModels;
	public readonly bounds = create_rect_bounds();
	public readonly entries: SceneSourceObject[] = [];
	/** Per occurrence: origin XY, X endpoint XY, Y endpoint XY, Z endpoint XY. */
	public readonly points: number[] = [];
	public readonly segment = [0, 0, 0, 0];
	public readonly outline = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
	public source: SceneSpatialReadModel | undefined;
	public selected: SceneSourceObject | undefined;
	public allocationRevision = 0;
	public projectionRevision = 0;
	public canFrameAll = false;
	private projectedSource: SceneSpatialReadModel | undefined;
	private projectedCamera = -1;
	private projectedAllocation = -1;
	private disposed = false;
	private readonly visualBounds = create_rect_bounds();
	private readonly modelBounds: SceneViewportModelBounds = { originX: 0, originY: 0, originZ: 0, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
	private readonly frameEntries = new Set<SceneSourceObject>();
	private initialSource: SceneSpatialReadModel | undefined;
	private initialVisuals: SceneVisualReadModel | undefined;
	private initialAllocation = -1;
	private initialMode: string | undefined;
	private modeSource: SceneSpatialReadModel | undefined;
	private sourceMode: '2d' | '3d' | undefined;
	private readonly listeners = new Set<() => void>();
	private readonly unbindCamera: () => void;
	public constructor(public readonly authoring: SceneAuthoringContext, catalog: WorkspaceSourceCatalog) {
		this.sprites = new SceneViewportSprites(catalog, authoring.workingCopy.identity.contextId);
		this.models = new SceneViewportModels(catalog, authoring.workingCopy.identity.contextId);
		this.unbindCamera = this.camera.onDidChange(() => { for (const listener of this.listeners) listener(); });
	}
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public layout(bounds: Readonly<RectBounds>): void {
		if (this.bounds.left === bounds.left && this.bounds.top === bounds.top && this.bounds.right === bounds.right && this.bounds.bottom === bounds.bottom) return;
		copy_rect_bounds(this.bounds, bounds); this.allocationRevision++;
		if (bounds.left < bounds.right && bounds.top < bounds.bottom) this.camera.setViewport(bounds.right - bounds.left, bounds.bottom - bounds.top);
	}
	public refresh(): void {
		if (this.disposed) return;
		this.authoring.refresh();
		if (this.disposed) return;
		this.source = this.authoring.spatialScene;
		const selection = this.authoring.selection;
		if (this.disposed) return;
		this.selected = selection?.kind === 'member' && selection.entry.kind === 'object' ? selection.entry : undefined;
		const visuals = this.authoring.visualScene;
		if (this.disposed) return;
		this.sprites.prepare(visuals); this.models.prepare(visuals);
		if (this.modeSource !== this.source) {
			this.modeSource = this.source; this.sourceMode = undefined;
			if (this.source !== undefined) for (const entry of this.source.entries) {
				const world = this.source.worlds.get(entry);
				if (world !== undefined) { this.sourceMode = world.family; break; }
			}
		}
		if (this.camera.automaticMode && this.sourceMode !== undefined) this.camera.initializeMode(this.sourceMode);
		if (this.disposed) return;
		if (this.camera.initial && this.bounds.right > this.bounds.left && this.bounds.bottom > this.bounds.top
			&& (this.initialSource !== this.source || this.initialVisuals !== visuals || this.initialAllocation !== this.allocationRevision || this.initialMode !== this.camera.mode)) {
			this.initialSource = this.source; this.initialVisuals = visuals; this.initialAllocation = this.allocationRevision; this.initialMode = this.camera.mode;
			this.frame(undefined); if (this.disposed) return;
		}
		if (this.models.project(this.camera, this.bounds)) this.projectionRevision++;
		if (this.sprites.project(this.camera, this.bounds, this.allocationRevision)) this.projectionRevision++;
		if (this.projectedSource === this.source && this.projectedCamera === this.camera.revision && this.projectedAllocation === this.allocationRevision) return;
		this.projectedSource = this.source; this.projectedCamera = this.camera.revision; this.projectedAllocation = this.allocationRevision;
		let count = 0; this.canFrameAll = false;
		const camera = this.camera, centerX = (this.bounds.left + this.bounds.right) / 2, centerY = (this.bounds.top + this.bounds.bottom) / 2;
		if (this.source !== undefined) for (const entry of this.source.entries) {
			const world = this.source.worlds.get(entry);
			if (world === undefined || world.family !== camera.mode) continue;
			this.canFrameAll = true;
			if (world.family === '3d' && camera.depth(world.ox, world.oy, world.oz) < camera.near) continue;
			const index = count * SCENE_VIEWPORT_POINT_STRIDE, x = world.ox, y = world.oy, z = world.family === '3d' ? world.oz : 0;
			this.entries[count++] = entry;
			this.points[index] = centerX + camera.projectX(x, y, z); this.points[index + 1] = centerY + camera.projectY(x, y, z);
			// Diagnostic helpers use screen units; zoom fits the actual geometry, not giant helper arms.
			this.points[index + 2] = this.points[index] + camera.horizontal(world.xx, world.xy, world.family === '3d' ? world.xz : 0) * AXIS_UNIT_PIXELS;
			this.points[index + 3] = this.points[index + 1] + camera.vertical(world.xx, world.xy, world.family === '3d' ? world.xz : 0) * AXIS_UNIT_PIXELS;
			this.points[index + 4] = this.points[index] + camera.horizontal(world.yx, world.yy, world.family === '3d' ? world.yz : 0) * AXIS_UNIT_PIXELS;
			this.points[index + 5] = this.points[index + 1] + camera.vertical(world.yx, world.yy, world.family === '3d' ? world.yz : 0) * AXIS_UNIT_PIXELS;
			this.points[index + 6] = world.family === '3d' ? this.points[index] + camera.horizontal(world.zx, world.zy, world.zz) * AXIS_UNIT_PIXELS : this.points[index];
			this.points[index + 7] = world.family === '3d' ? this.points[index + 1] + camera.vertical(world.zx, world.zy, world.zz) * AXIS_UNIT_PIXELS : this.points[index + 1];
		}
		this.entries.length = count; this.points.length = count * SCENE_VIEWPORT_POINT_STRIDE; this.projectionRevision++;
	}
	public get canFrameSelection(): boolean {
		const world = this.selected === undefined ? undefined : this.source?.worlds.get(this.selected);
		return world !== undefined && world.family === this.camera.mode;
	}
	/** UI helpers are painted over geometry and therefore participate before the mesh depth hit. */
	public pick(x: number, y: number): SceneSourceObject | undefined {
		let picked: SceneSourceObject | undefined, distance = 36;
		const represented = this.camera.mode === '2d' ? this.sprites.represented : this.models.represented;
		for (let index = 0; index < this.entries.length; index++) {
			const entry = this.entries[index]; if (entry !== this.selected && represented.has(entry)) continue;
			const offset = index * SCENE_VIEWPORT_POINT_STRIDE, dx = this.points[offset] - x, dy = this.points[offset + 1] - y;
			const squared = dx * dx + dy * dy;
			if (squared <= distance) { distance = squared; picked = entry; }
		}
		if (picked !== undefined) return picked;
		return this.camera.mode === '2d' ? this.sprites.pick(x, y)
			: this.models.pick(x - (this.bounds.left + this.bounds.right) / 2, y - (this.bounds.top + this.bounds.bottom) / 2, this.camera)?.entry;
	}
	public frame(selected: SceneSourceObject | undefined): boolean {
		this.frameEntries.clear();
		if (selected !== undefined) {
			this.frameEntries.add(selected);
			if (this.source !== undefined) for (const entry of this.source.constructionOrder) {
				const parent = this.source.parents.get(entry);
				if (parent !== undefined && this.frameEntries.has(parent)) this.frameEntries.add(entry);
			}
		}
		const selectedEntries = selected === undefined ? undefined : this.frameEntries;
		let count = 0;
		if (this.camera.mode === '3d') {
			const target = this.modelBounds;
			if (this.models.frameBounds(selectedEntries, target)) count++;
			if (this.source !== undefined) for (const entry of this.source.entries) {
				if ((selectedEntries !== undefined && !selectedEntries.has(entry)) || this.models.represented.has(entry)) continue;
				const world = this.source.worlds.get(entry); if (world === undefined || world.family !== '3d') continue;
				if (count === 0) { target.originX = world.ox; target.originY = world.oy; target.originZ = world.oz; }
				const x = world.ox - target.originX, y = world.oy - target.originY, z = world.oz - target.originZ;
				target.minX = Math.min(target.minX, x); target.minY = Math.min(target.minY, y); target.minZ = Math.min(target.minZ, z);
				target.maxX = Math.max(target.maxX, x); target.maxY = Math.max(target.maxY, y); target.maxZ = Math.max(target.maxZ, z); count++;
			}
			if (count === 0) return false;
			this.camera.frame3D(target.minX, target.minY, target.minZ, target.maxX, target.maxY, target.maxZ, target.originX, target.originY, target.originZ); return true;
		}
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
		if (this.sprites.frameBounds(selectedEntries, this.visualBounds)) {
			left = this.visualBounds.left; top = this.visualBounds.top; right = this.visualBounds.right; bottom = this.visualBounds.bottom; count++;
		}
		if (this.source !== undefined) for (const entry of this.source.entries) {
			if ((selectedEntries !== undefined && !selectedEntries.has(entry)) || this.sprites.represented.has(entry)) continue;
			const world = this.source.worlds.get(entry); if (world === undefined || world.family !== '2d') continue;
			left = Math.min(left, world.ox); top = Math.min(top, world.oy); right = Math.max(right, world.ox); bottom = Math.max(bottom, world.oy); count++;
		}
		if (count === 0) return false;
		this.camera.frame2D(left, top, right, bottom, this.bounds.right - this.bounds.left, this.bounds.bottom - this.bounds.top); return true;
	}
	public dispose(): void {
		this.disposed = true; this.unbindCamera(); this.listeners.clear(); this.entries.length = this.points.length = 0;
		this.sprites.dispose(); this.models.dispose(); this.frameEntries.clear();
		this.source = this.projectedSource = this.modeSource = this.initialSource = undefined;
		this.initialVisuals = undefined; this.sourceMode = undefined; this.selected = undefined;
	}
}
