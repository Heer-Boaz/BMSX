import { clamp } from '../../../../../machine/ts/common/clamp';

export type SceneViewportPoint = { originX: number; originY: number; originZ: number; x: number; y: number; z: number };

type Reading = 'initial' | 'manual';
type CanvasCamera = { centerX: number; centerY: number; scale: number; reading: Reading };
type SpaceCamera = { originX: number; originY: number; originZ: number; centerX: number; centerY: number; centerZ: number; distance: number; yaw: number; pitch: number; reading: Reading };
export type SceneViewportCameraState = {
	readonly mode: '2d' | '3d';
	readonly modeIntent: 'source' | 'manual';
	readonly canvas: Readonly<CanvasCamera>;
	readonly space: Readonly<SpaceCamera>;
};

const TAN_HALF_FOV = Math.tan(Math.PI / 6);

/** Independent canvas and orbit readings, never the cartridge camera.
 * Space uses an infinite reversed-Z projection: clip Z in 0..W, near=1, far=0. */
export class SceneViewportCamera {
	private modeValue: '2d' | '3d' = '2d';
	private modeIntent: 'source' | 'manual' = 'source';
	private readonly canvas: CanvasCamera = { centerX: 0, centerY: 0, scale: 1, reading: 'initial' };
	private readonly space: SpaceCamera = { originX: 0, originY: 0, originZ: 0, centerX: 0, centerY: 0, centerZ: 0, distance: 8, yaw: 0.65, pitch: 0.55, reading: 'initial' };
	private width = 1; private height = 1;
	private revisionValue = 0; private spaceRevisionValue = 0;
	private rx = 1; private rz = 0;
	private dx = 0; private dy = -1; private dz = 0;
	private bx = 0; private by = 0; private bz = 1;
	public readonly clipFromOrigin = new Float64Array(16);
	private readonly listeners = new Set<() => void>();
	public constructor() { this.updateSpace(); }
	public get mode(): '2d' | '3d' { return this.modeValue; }
	public get automaticMode(): boolean { return this.modeIntent === 'source'; }
	public get initial(): boolean { return (this.mode === '2d' ? this.canvas : this.space).reading === 'initial'; }
	public get scale(): number { return this.mode === '2d' ? this.canvas.scale : this.focalLength / this.space.distance; }
	public get revision(): number { return this.revisionValue; }
	public get spaceRevision(): number { return this.spaceRevisionValue; }
	public get originX(): number { return this.space.originX; }
	public get originY(): number { return this.space.originY; }
	public get originZ(): number { return this.space.originZ; }
	public get near(): number { return this.space.distance / 10000; }
	private get focalLength(): number { return this.height / (2 * TAN_HALF_FOV); }
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public capture(): SceneViewportCameraState {
		return { mode: this.mode, modeIntent: this.modeIntent, canvas: { ...this.canvas }, space: { ...this.space } };
	}
	public restore(state: SceneViewportCameraState): void {
		this.modeValue = state.mode; this.modeIntent = state.modeIntent;
		Object.assign(this.canvas, state.canvas); Object.assign(this.space, state.space);
		this.updateSpace(); this.changed();
	}
	/** The attached view publishes its realized allocation, not hidden zero sizes. */
	public setViewport(width: number, height: number): void {
		if (width === this.width && height === this.height) return;
		this.width = width; this.height = height; this.updateSpace(); this.changed();
	}
	public setMode(mode: '2d' | '3d'): void {
		if (mode === this.mode && !this.automaticMode) return;
		this.modeValue = mode; this.modeIntent = 'manual'; this.changed();
	}
	public initializeMode(mode: '2d' | '3d'): void {
		if (!this.automaticMode || this.mode === mode) return;
		this.modeValue = mode; this.changed();
	}
	public horizontal(x: number, _y: number, z: number): number { return this.mode === '2d' ? x : this.rx * x + this.rz * z; }
	public vertical(x: number, y: number, z: number): number { return this.mode === '2d' ? y : this.dx * x + this.dy * y + this.dz * z; }
	public depth(x: number, y: number, z: number, originX = 0, originY = 0, originZ = 0): number {
		const s = this.space;
		return s.distance - this.bx * (((originX - s.originX) + x) - s.centerX) - this.by * (((originY - s.originY) + y) - s.centerY) - this.bz * (((originZ - s.originZ) + z) - s.centerZ);
	}
	public projectX(x: number, y: number, z: number): number {
		if (this.mode === '2d') return (x - this.canvas.centerX) * this.canvas.scale;
		const s = this.space;
		return this.horizontal((x - s.originX) - s.centerX, (y - s.originY) - s.centerY, (z - s.originZ) - s.centerZ) * this.focalLength / this.depth(x, y, z);
	}
	public projectY(x: number, y: number, z: number): number {
		if (this.mode === '2d') return (y - this.canvas.centerY) * this.canvas.scale;
		const s = this.space;
		return this.vertical((x - s.originX) - s.centerX, (y - s.originY) - s.centerY, (z - s.originZ) - s.centerZ) * this.focalLength / this.depth(x, y, z);
	}
	/** Screen-plane movement is measured at the orbit pivot's depth. */
	public pan(x: number, y: number): void {
		if (this.mode === '2d') {
			const c = this.canvas; c.reading = 'manual'; c.centerX -= x / c.scale; c.centerY -= y / c.scale;
		} else {
			const s = this.space, scale = this.scale; s.reading = 'manual';
			s.centerX -= (this.rx * x + this.dx * y) / scale;
			s.centerY -= this.dy * y / scale; s.centerZ -= (this.rz * x + this.dz * y) / scale; this.updateSpace();
		}
		this.changed();
	}
	/** Dolly around the picked world point, or the pointer on the pivot plane. */
	public zoom(steps: number, anchorX: number, anchorY: number, anchor?: Readonly<SceneViewportPoint>): void {
		if (this.mode === '2d') {
			const c = this.canvas, scale = clamp(c.scale * 2 ** steps, 1 / 64, 64);
			if (scale === c.scale) return;
			const delta = 1 / c.scale - 1 / scale;
			c.centerX += anchorX * delta; c.centerY += anchorY * delta; c.scale = scale; c.reading = 'manual';
		} else {
			const s = this.space, distance = clamp(s.distance / 2 ** steps, 1e-6, 1e15);
			if (distance === s.distance) return;
			const scale = this.scale, ratio = 1 - distance / s.distance;
			const x = anchor === undefined ? (this.rx * anchorX + this.dx * anchorY) / scale : ((anchor.originX - s.originX) + anchor.x) - s.centerX;
			const y = anchor === undefined ? this.dy * anchorY / scale : ((anchor.originY - s.originY) + anchor.y) - s.centerY;
			const z = anchor === undefined ? (this.rz * anchorX + this.dz * anchorY) / scale : ((anchor.originZ - s.originZ) + anchor.z) - s.centerZ;
			s.centerX += x * ratio; s.centerY += y * ratio; s.centerZ += z * ratio;
			s.distance = distance; s.reading = 'manual'; this.updateSpace();
		}
		this.changed();
	}
	public orbit(x: number, y: number): void {
		const s = this.space; s.reading = 'manual'; s.yaw += x * 0.01; s.pitch = clamp(s.pitch + y * 0.01, -1.5, 1.5);
		this.updateSpace(); this.changed();
	}
	public frame2D(left: number, top: number, right: number, bottom: number, width: number, height: number): void {
		const c = this.canvas; c.reading = 'manual'; c.centerX = (left + right) / 2; c.centerY = (top + bottom) / 2;
		const extentX = right - left, extentY = bottom - top, point = extentX === 0 && extentY === 0;
		c.scale = clamp(Math.min(extentX === 0 && !point ? Infinity : Math.max(1, width - 32) / (point ? 64 : extentX),
			extentY === 0 && !point ? Infinity : Math.max(1, height - 32) / (point ? 64 : extentY)), 1 / 64, 64);
		this.changed();
	}
	/** Bounds come from transformed vertices or an explicitly selected origin. */
	public frame3D(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, originX = 0, originY = 0, originZ = 0): void {
		const s = this.space; s.reading = 'manual';
		s.originX = originX; s.originY = originY; s.originZ = originZ;
		s.centerX = (minX + maxX) / 2; s.centerY = (minY + maxY) / 2; s.centerZ = (minZ + maxZ) / 2;
		const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
		if (radius !== 0) {
			const halfFov = Math.atan(TAN_HALF_FOV * Math.min(1, this.width / this.height));
			s.distance = radius * 1.1 / Math.sin(halfFov);
		}
		this.updateSpace(); this.changed();
	}
	/** Subtract the geometry origin before adding the small eye offset, matching combined model→clip arithmetic. */
	public eyeRelativeTo(x: number, y: number, z: number, target: Float64Array): void {
		const s = this.space;
		target[0] = ((s.originX - x) + s.centerX) + this.bx * s.distance;
		target[1] = ((s.originY - y) + s.centerY) + this.by * s.distance;
		target[2] = ((s.originZ - z) + s.centerZ) + this.bz * s.distance;
	}
	/** Unit world direction, using reusable caller-owned lanes. */
	public rayDirection3D(x: number, y: number, direction: Float64Array): void {
		const focal = this.focalLength;
		const dx = this.rx * x / focal + this.dx * y / focal - this.bx;
		const dy = this.dy * y / focal - this.by, dz = this.rz * x / focal + this.dz * y / focal - this.bz;
		const reciprocal = 1 / Math.hypot(dx, dy, dz);
		direction[0] = dx * reciprocal; direction[1] = dy * reciprocal; direction[2] = dz * reciprocal;
	}
	private updateSpace(): void {
		const s = this.space, sine = Math.sin(s.yaw), cosine = Math.cos(s.yaw), pitchSine = Math.sin(s.pitch), pitchCosine = Math.cos(s.pitch);
		this.rx = cosine; this.rz = -sine;
		this.dx = sine * pitchSine; this.dy = -pitchCosine; this.dz = cosine * pitchSine;
		this.bx = sine * pitchCosine; this.by = pitchSine; this.bz = cosine * pitchCosine;
		const m = this.clipFromOrigin, horizontal = this.height / this.width / TAN_HALF_FOV, vertical = 1 / TAN_HALF_FOV;
		m[0] = this.rx * horizontal; m[1] = -this.dx * vertical; m[2] = 0; m[3] = -this.bx;
		m[4] = 0; m[5] = -this.dy * vertical; m[6] = 0; m[7] = -this.by;
		m[8] = this.rz * horizontal; m[9] = -this.dz * vertical; m[10] = 0; m[11] = -this.bz;
		m[12] = -(this.rx * s.centerX + this.rz * s.centerZ) * horizontal;
		m[13] = (this.dx * s.centerX + this.dy * s.centerY + this.dz * s.centerZ) * vertical;
		m[14] = this.near; m[15] = s.distance + this.bx * s.centerX + this.by * s.centerY + this.bz * s.centerZ;
		this.spaceRevisionValue++;
	}
	private changed(): void { this.revisionValue++; for (const listener of this.listeners) listener(); }
}
