import { create_rect_bounds, copy_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import type { SceneAuthoringContext } from '../authoring_context';
import type { SceneSourceObject } from '../model';
import type { SceneSpatialReadModel } from '../spatial_projection';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import { SceneViewportCamera } from './camera';
import { SceneViewportSprites } from './sprites';

export const SCENE_VIEWPORT_POINT_STRIDE = 8;
const AXIS_UNIT_PIXELS = 16;

/** Retained source reading and numeric screen projection; selection stays with the authored context. */
export class SceneViewportViewState {
	public readonly camera = new SceneViewportCamera();
	public readonly sprites: SceneViewportSprites;
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
	private projectedSource: SceneSpatialReadModel | undefined;
	private projectedCamera = -1;
	private projectedAllocation = -1;
	private disposed = false;
	private readonly visualBounds = create_rect_bounds();
	private readonly listeners = new Set<() => void>();
	private readonly unbindCamera: () => void;
	public constructor(public readonly authoring: SceneAuthoringContext, catalog: WorkspaceSourceCatalog) {
		this.sprites = new SceneViewportSprites(catalog, authoring.workingCopy.identity.contextId);
		this.unbindCamera = this.camera.onDidChange(() => { for (const listener of this.listeners) listener(); });
	}
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public layout(bounds: Readonly<RectBounds>): void {
		if (this.bounds.left === bounds.left && this.bounds.top === bounds.top && this.bounds.right === bounds.right && this.bounds.bottom === bounds.bottom) return;
		copy_rect_bounds(this.bounds, bounds); this.allocationRevision++;
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
		this.sprites.prepare(visuals);
		if (this.camera.initial && this.source !== undefined && this.bounds.right > this.bounds.left && this.bounds.bottom > this.bounds.top) {
			for (const entry of this.source.entries) {
				const world = this.source.worlds.get(entry);
				if (world !== undefined) {
					this.camera.initializeMode(world.family);
					if (this.disposed) return;
					if (this.camera.initial) this.frame(undefined);
					if (this.disposed) return;
					break;
				}
			}
		}
		if (this.sprites.project(this.camera, this.bounds, this.allocationRevision)) this.projectionRevision++;
		if (this.projectedSource === this.source && this.projectedCamera === this.camera.revision && this.projectedAllocation === this.allocationRevision) return;
		this.projectedSource = this.source; this.projectedCamera = this.camera.revision; this.projectedAllocation = this.allocationRevision;
		let count = 0;
		const camera = this.camera, centerX = (this.bounds.left + this.bounds.right) / 2, centerY = (this.bounds.top + this.bounds.bottom) / 2;
		if (this.source !== undefined) for (const entry of this.source.entries) {
			const world = this.source.worlds.get(entry);
			if (world === undefined || world.family !== camera.mode) continue;
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
	public frame(selected: SceneSourceObject | undefined): boolean {
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
		if (this.camera.mode === '2d' && this.sprites.frameBounds(selected, this.visualBounds)) {
			left = this.visualBounds.left; top = this.visualBounds.top; right = this.visualBounds.right; bottom = this.visualBounds.bottom; count++;
		}
		if (this.source !== undefined) for (const entry of this.source.entries) {
			if (selected !== undefined && entry !== selected) continue;
			const world = this.source.worlds.get(entry);
			if (world === undefined || world.family !== this.camera.mode) continue;
			const z = world.family === '3d' ? world.oz : 0;
			const x = this.camera.horizontal(world.ox, world.oy, z), y = this.camera.vertical(world.ox, world.oy, z);
			left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); count++;
		}
		if (count === 0) return false;
		this.camera.frame(left, top, right, bottom, this.bounds.right - this.bounds.left, this.bounds.bottom - this.bounds.top); return true;
	}
	public dispose(): void {
		this.disposed = true; this.unbindCamera(); this.listeners.clear(); this.entries.length = this.points.length = 0;
		this.sprites.dispose();
		this.source = this.projectedSource = undefined; this.selected = undefined;
	}
}
