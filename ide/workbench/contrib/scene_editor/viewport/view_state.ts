import { create_rect_bounds, copy_rect_bounds, type RectBounds } from '../../../../../machine/ts/common/rect';
import type { SceneAuthoringContext } from '../authoring_context';
import type { SceneSourceObject } from '../model';
import type { SceneSpatialReadModel } from '../spatial_projection';
import { SceneViewportCamera } from './camera';

export const SCENE_VIEWPORT_POINT_STRIDE = 8;
const AXIS_LENGTH = 16;

/** Retained source reading and numeric screen projection; selection stays with the authored context. */
export class SceneViewportViewState {
	public readonly camera = new SceneViewportCamera();
	public readonly bounds = create_rect_bounds();
	public readonly entries: SceneSourceObject[] = [];
	/** Per occurrence: origin XY, X endpoint XY, Y endpoint XY, Z endpoint XY. */
	public readonly points: number[] = [];
	public readonly segment = [0, 0, 0, 0];
	public source: SceneSpatialReadModel | undefined;
	public selected: SceneSourceObject | undefined;
	public allocationRevision = 0;
	public projectionRevision = 0;
	private projectedSource: SceneSpatialReadModel | undefined;
	private projectedCamera = -1;
	private projectedAllocation = -1;
	private disposed = false;
	private readonly listeners = new Set<() => void>();
	private readonly unbindCamera: () => void;
	public constructor(public readonly authoring: SceneAuthoringContext) {
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
			this.points[index + 2] = centerX + camera.projectX(x + world.xx * AXIS_LENGTH, y + world.xy * AXIS_LENGTH, z + (world.family === '3d' ? world.xz * AXIS_LENGTH : 0));
			this.points[index + 3] = centerY + camera.projectY(x + world.xx * AXIS_LENGTH, y + world.xy * AXIS_LENGTH, z + (world.family === '3d' ? world.xz * AXIS_LENGTH : 0));
			this.points[index + 4] = centerX + camera.projectX(x + world.yx * AXIS_LENGTH, y + world.yy * AXIS_LENGTH, z + (world.family === '3d' ? world.yz * AXIS_LENGTH : 0));
			this.points[index + 5] = centerY + camera.projectY(x + world.yx * AXIS_LENGTH, y + world.yy * AXIS_LENGTH, z + (world.family === '3d' ? world.yz * AXIS_LENGTH : 0));
			this.points[index + 6] = world.family === '3d' ? centerX + camera.projectX(x + world.zx * AXIS_LENGTH, y + world.zy * AXIS_LENGTH, z + world.zz * AXIS_LENGTH) : this.points[index];
			this.points[index + 7] = world.family === '3d' ? centerY + camera.projectY(x + world.zx * AXIS_LENGTH, y + world.zy * AXIS_LENGTH, z + world.zz * AXIS_LENGTH) : this.points[index + 1];
		}
		this.entries.length = count; this.points.length = count * SCENE_VIEWPORT_POINT_STRIDE; this.projectionRevision++;
	}
	public get canFrameSelection(): boolean {
		const world = this.selected === undefined ? undefined : this.source?.worlds.get(this.selected);
		return world !== undefined && world.family === this.camera.mode;
	}
	public frame(selected: SceneSourceObject | undefined): boolean {
		let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
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
		this.source = this.projectedSource = undefined; this.selected = undefined;
	}
}
