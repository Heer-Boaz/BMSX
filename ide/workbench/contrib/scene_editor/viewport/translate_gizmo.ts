import type { RectBounds } from '../../../../../machine/ts/common/rect';
import { segmentDistanceSquared } from '../../../../../machine/ts/common/vector';
import type { SceneSourceAffine } from '../model';
import type { SceneViewportCamera } from './camera';

export enum TranslateHandle { None = 0, X = 1, Y = 2, XY = 3, Z = 4, XZ = 5, YZ = 6, View = 7 }
export const TRANSLATE_PLANE_HANDLES = [TranslateHandle.XY, TranslateHandle.XZ, TranslateHandle.YZ] as const;

/** World-axis move handles and their frozen drag plane. All geometry is retained; source admission lives elsewhere. */
export class SceneTranslationGizmo {
	public readonly axes = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
	public readonly planes = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]];
	public readonly delta = new Float64Array(3);
	public visibleAxes = 0;
	public visiblePlanes = 0;
	public x = 0; public y = 0; public radius = 0;
	public hover = TranslateHandle.None;
	public active = TranslateHandle.None;
	public world: Readonly<SceneSourceAffine> | undefined;
	private projectedWorld: Readonly<SceneSourceAffine> | undefined;
	private projectedRevision = -1;
	private cameraRevision = -1;
	private allocation = -1;
	private lineHeight = 0;
	private startX = 0; private startY = 0;
	private startOriginX = 0; private startOriginY = 0;
	private centerX = 0; private centerY = 0;
	private mode: '2d' | '3d' = '2d';
	private readonly normal = new Float64Array(3);
	private readonly eye = new Float64Array(3);
	private readonly direction = new Float64Array(3);
	private readonly start = new Float64Array(3);

	public project(world: Readonly<SceneSourceAffine> | undefined, revision: number, camera: SceneViewportCamera,
		bounds: Readonly<RectBounds>, allocation: number, lineHeight: number): void {
		if (this.projectedWorld === world && this.projectedRevision === revision && this.cameraRevision === camera.revision
			&& this.allocation === allocation && this.lineHeight === lineHeight) return;
		if (this.projectedWorld !== world) this.hover = TranslateHandle.None;
		this.world = undefined;
		this.projectedWorld = world; this.projectedRevision = revision; this.cameraRevision = camera.revision;
		this.allocation = allocation; this.lineHeight = lineHeight; this.visibleAxes = this.visiblePlanes = 0;
		if (world === undefined || world.family !== camera.mode || bounds.left >= bounds.right || bounds.top >= bounds.bottom) { this.hover = TranslateHandle.None; return; }
		const z = world.family === '3d' ? world.oz : 0;
		if (camera.mode === '3d' && camera.depth(world.ox, world.oy, z) < camera.near) return;
		this.world = world;
		const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2;
		this.x = centerX + camera.projectX(world.ox, world.oy, z); this.y = centerY + camera.projectY(world.ox, world.oy, z);
		this.radius = lineHeight * 0.6;
		const pixels = Math.min(lineHeight * 5, (bounds.right - bounds.left) * 0.28, (bounds.bottom - bounds.top) * 0.28);
		const length = pixels * camera.unitsPerPixel(world.ox, world.oy, z);
		for (let axis = 0; axis < (camera.mode === '2d' ? 2 : 3); axis++) {
			const ex = axis === 0 ? length : 0, ey = axis === 1 ? length : 0, ez = axis === 2 ? length : 0;
			const x = centerX + camera.projectX(ex, ey, ez, world.ox, world.oy, z);
			const y = centerY + camera.projectY(ex, ey, ez, world.ox, world.oy, z), dx = x - this.x, dy = y - this.y;
			const span = Math.hypot(dx, dy);
			// End-on axes have no usable screen lever, rather than an arbitrary replacement drag direction.
			if (span < this.radius * 3) continue;
			const points = this.axes[axis], ux = dx / span, uy = dy / span, head = lineHeight * 0.65;
			points[0] = this.x + ux * this.radius; points[1] = this.y + uy * this.radius;
			points[2] = points[6] = x; points[3] = points[7] = y;
			points[4] = x - ux * head - uy * head * 0.5; points[5] = y - uy * head + ux * head * 0.5;
			points[8] = x - ux * head + uy * head * 0.5; points[9] = y - uy * head - ux * head * 0.5;
			this.visibleAxes |= 1 << axis;
		}
		if (camera.mode === '3d') for (let plane = 0; plane < 3; plane++) {
			const a = plane === 2 ? 1 : 0, b = plane === 0 ? 1 : 2, points = this.planes[plane];
			for (let corner = 0; corner < 4; corner++) {
				const u = (corner === 0 || corner === 3 ? 0.22 : 0.42) * length;
				const v = (corner < 2 ? 0.22 : 0.42) * length;
				const x = a === 0 ? u : 0, y = (a === 1 ? u : 0) + (b === 1 ? v : 0), zOffset = b === 2 ? v : 0;
				points[corner * 2] = centerX + camera.projectX(x, y, zOffset, world.ox, world.oy, z);
				points[corner * 2 + 1] = centerY + camera.projectY(x, y, zOffset, world.ox, world.oy, z);
			}
			points[8] = points[0]; points[9] = points[1];
			let area = 0;
			for (let corner = 0; corner < 4; corner++) area += (points[corner * 2] - points[0]) * (points[corner * 2 + 3] - points[1])
				- (points[corner * 2 + 2] - points[0]) * (points[corner * 2 + 1] - points[1]);
			if (Math.abs(area) >= this.radius * this.radius) this.visiblePlanes |= 1 << plane;
		}
	}

	/** Hit the same visible handles that are painted, independent of scene/collider bounds. */
	public hit(x: number, y: number): TranslateHandle {
		if (this.world === undefined) return TranslateHandle.None;
		if (Math.abs(x - this.x) <= this.radius && Math.abs(y - this.y) <= this.radius) return TranslateHandle.View;
		let hit = TranslateHandle.None, distance = this.radius * this.radius;
		for (let axis = 0; axis < 3; axis++) if ((this.visibleAxes & (1 << axis)) !== 0) {
			const points = this.axes[axis], candidate = segmentDistanceSquared(x, y, points[0], points[1], points[2], points[3]);
			if (candidate <= distance) { distance = candidate; hit = 1 << axis; }
		}
		if (hit !== TranslateHandle.None) return hit;
		for (let plane = 2; plane >= 0; plane--) if ((this.visiblePlanes & (1 << plane)) !== 0) {
			const points = this.planes[plane]; let positive = true, negative = true;
			for (let corner = 0; corner < 4; corner++) {
				const i = corner * 2, cross = (points[i + 2] - points[i]) * (y - points[i + 1]) - (points[i + 3] - points[i + 1]) * (x - points[i]);
				positive = positive && cross >= 0; negative = negative && cross <= 0;
			}
			if (positive || negative) return TRANSLATE_PLANE_HANDLES[plane];
		}
		return TranslateHandle.None;
	}

	public begin(handle: TranslateHandle, x: number, y: number, camera: SceneViewportCamera, bounds: Readonly<RectBounds>): boolean {
		const world = this.world!;
		this.mode = camera.mode; this.startX = x; this.startY = y;
		this.startOriginX = world.ox; this.startOriginY = world.oy;
		this.centerX = (bounds.left + bounds.right) / 2; this.centerY = (bounds.top + bounds.bottom) / 2;
		this.delta.fill(0);
		if (this.mode === '3d') {
			camera.eyeRelativeTo(world.ox, world.oy, world.family === '3d' ? world.oz : 0, this.eye);
			const normal = this.normal;
			if (handle === TranslateHandle.View) camera.rayDirection3D(0, 0, normal);
			else if (handle === TranslateHandle.X || handle === TranslateHandle.Y || handle === TranslateHandle.Z) {
				normal.set(this.eye); normal[handle === TranslateHandle.X ? 0 : handle === TranslateHandle.Y ? 1 : 2] = 0;
			} else { normal.fill(0); normal[handle === TranslateHandle.XY ? 2 : handle === TranslateHandle.XZ ? 1 : 0] = 1; }
			camera.rayDirection3D(x - this.centerX, y - this.centerY, this.direction);
			const direction = this.direction, eye = this.eye, denominator = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
			if (denominator === 0) return false;
			const distance = -(normal[0] * eye[0] + normal[1] * eye[1] + normal[2] * eye[2]) / denominator;
			if (distance < 0) return false;
			for (let axis = 0; axis < 3; axis++) this.start[axis] = eye[axis] + direction[axis] * distance;
		}
		this.active = handle; return true;
	}

	/** A parallel/behind-eye ray has no plane intersection and publishes no new proposal. */
	public move(x: number, y: number, camera: SceneViewportCamera): boolean {
		let dx = 0, dy = 0, dz = 0;
		if (this.mode === '2d') {
			if (x !== this.startX) dx = Math.round(this.startOriginX + (x - this.startX) / camera.scale) - this.startOriginX;
			if (y !== this.startY) dy = Math.round(this.startOriginY + (y - this.startY) / camera.scale) - this.startOriginY;
		}
		else {
			camera.rayDirection3D(x - this.centerX, y - this.centerY, this.direction);
			const n = this.normal, d = this.direction, eye = this.eye, denominator = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
			if (denominator === 0) return false;
			const distance = -(n[0] * eye[0] + n[1] * eye[1] + n[2] * eye[2]) / denominator;
			if (distance < 0) return false;
			dx = eye[0] + d[0] * distance - this.start[0]; dy = eye[1] + d[1] * distance - this.start[1]; dz = eye[2] + d[2] * distance - this.start[2];
		}
		if ((this.active & TranslateHandle.X) === 0) dx = 0;
		if ((this.active & TranslateHandle.Y) === 0) dy = 0;
		if ((this.active & TranslateHandle.Z) === 0) dz = 0;
		if (this.delta[0] === dx && this.delta[1] === dy && this.delta[2] === dz) return false;
		this.delta[0] = dx; this.delta[1] = dy; this.delta[2] = dz; return true;
	}
	public cancel(): void { this.active = this.hover = TranslateHandle.None; }
	public dispose(): void { this.cancel(); this.world = this.projectedWorld = undefined; this.visibleAxes = this.visiblePlanes = 0; }
}
