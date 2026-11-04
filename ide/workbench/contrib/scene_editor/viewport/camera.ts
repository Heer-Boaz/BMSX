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
	/** An authored gesture adopts the displayed reading even when an empty scene
	 * has not supplied initial framing. Later source publication must not reframe it. */
	public retainReading(): void {
		const reading = this.mode === '2d' ? this.canvas : this.space;
		if (reading.reading === 'manual') return;
		reading.reading = 'manual'; this.changed();
	}
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
		this.width = width; this.height = height; this.updateProjection(); this.changed();
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
	/** Project an origin plus local offset without adding the small offset to a large world coordinate first. */
	public projectX(x: number, y: number, z: number, originX = 0, originY = 0, originZ = 0): number {
		if (this.mode === '2d') return ((originX - this.canvas.centerX) + x) * this.canvas.scale;
		const s = this.space;
		return this.horizontal(((originX - s.originX) + x) - s.centerX, ((originY - s.originY) + y) - s.centerY,
			((originZ - s.originZ) + z) - s.centerZ) * this.focalLength / this.depth(x, y, z, originX, originY, originZ);
	}
	public projectY(x: number, y: number, z: number, originX = 0, originY = 0, originZ = 0): number {
		if (this.mode === '2d') return ((originY - this.canvas.centerY) + y) * this.canvas.scale;
		const s = this.space;
		return this.vertical(((originX - s.originX) + x) - s.centerX, ((originY - s.originY) + y) - s.centerY,
			((originZ - s.originZ) + z) - s.centerZ) * this.focalLength / this.depth(x, y, z, originX, originY, originZ);
	}
	/** Inverse canvas projection; inputs are offsets from the viewport center. */
	public unproject2d(x: number, y: number, target: { x: number; y: number }): void {
		target.x = this.canvas.centerX + x / this.canvas.scale;
		target.y = this.canvas.centerY + y / this.canvas.scale;
	}
	/** Intersect the displayed ray with the world XZ construction plane. A parallel
	 * ray or a crossing behind the near plane supplies no placement. */
	public unprojectGround3d(x: number, y: number, target: { x: number; y: number; z: number }): boolean {
		const s = this.space, focal = this.focalLength, rayY = this.dy * y / focal - this.by;
		if (rayY === 0) return false;
		const distance = -(s.originY + (s.centerY + this.by * s.distance)) / rayY;
		if (distance < this.near) return false;
		target.x = s.originX + (s.centerX + this.bx * s.distance + (this.rx * x / focal + this.dx * y / focal - this.bx) * distance);
		target.y = 0;
		target.z = s.originZ + (s.centerZ + this.bz * s.distance + (this.rz * x / focal + this.dz * y / focal - this.bz) * distance);
		return true;
	}
	/** Local projection scale for world-sized handles with a stable screen footprint. */
	public unitsPerPixel(x: number, y: number, z: number): number {
		return this.mode === '2d' ? 1 / this.canvas.scale : this.depth(x, y, z) / this.focalLength;
	}
	/** Screen-plane movement is measured at the orbit pivot's depth. */
	public pan(x: number, y: number): void {
		if (this.mode === '2d') {
			const c = this.canvas; c.reading = 'manual'; c.centerX -= x / c.scale; c.centerY -= y / c.scale;
		} else {
			const s = this.space, scale = this.scale; s.reading = 'manual';
			s.centerX -= (this.rx * x + this.dx * y) / scale;
			s.centerY -= this.dy * y / scale; s.centerZ -= (this.rz * x + this.dz * y) / scale; this.updateProjection();
		}
		this.changed();
	}
	/** Dolly around the picked world point, or the pointer on the pivot plane. */
	public zoom(steps: number, anchorX: number, anchorY: number, anchor?: Readonly<SceneViewportPoint>): void {
		if (steps === 0) return;
		if (this.mode === '2d') {
			const c = this.canvas, scale = clamp(c.scale * 2 ** steps, 1 / 64, 64);
			if (scale === c.scale) { this.retainReading(); return; }
			const delta = 1 / c.scale - 1 / scale;
			c.centerX += anchorX * delta; c.centerY += anchorY * delta; c.scale = scale; c.reading = 'manual';
		} else {
			const s = this.space, distance = clamp(s.distance / 2 ** steps, 1e-6, 1e15);
			if (distance === s.distance) { this.retainReading(); return; }
			const scale = this.scale, ratio = 1 - distance / s.distance;
			const x = anchor === undefined ? (this.rx * anchorX + this.dx * anchorY) / scale : ((anchor.originX - s.originX) + anchor.x) - s.centerX;
			const y = anchor === undefined ? this.dy * anchorY / scale : ((anchor.originY - s.originY) + anchor.y) - s.centerY;
			const z = anchor === undefined ? (this.rz * anchorX + this.dz * anchorY) / scale : ((anchor.originZ - s.originZ) + anchor.z) - s.centerZ;
			s.centerX += x * ratio; s.centerY += y * ratio; s.centerZ += z * ratio;
			s.distance = distance; s.reading = 'manual'; this.updateProjection();
		}
		this.changed();
	}
	public orbit(x: number, y: number): void {
		const s = this.space; s.reading = 'manual'; s.yaw += x * 0.01; s.pitch = clamp(s.pitch + y * 0.01, -1.5, 1.5);
		this.updateSpace(); this.changed();
	}
	/** Free look rotates around the eye; orbit rotates around the focus point. */
	public look(x: number, y: number): void {
		if (x === 0 && y === 0) return;
		const s = this.space; s.reading = 'manual'; s.yaw -= x * 0.01; s.pitch = clamp(s.pitch + y * 0.01, -1.5, 1.5);
		this.updateSpace(true); this.changed();
	}
	/** Flight translates eye and pivot together. Vertical movement can use world or camera up. */
	public fly(right: number, up: number, forward: number, localUp = 0): boolean {
		if (right === 0 && up === 0 && forward === 0 && localUp === 0) return false;
		const s = this.space; s.reading = 'manual';
		s.centerX += this.rx * right - this.bx * forward - this.dx * localUp;
		s.centerY += up - this.by * forward - this.dy * localUp;
		s.centerZ += this.rz * right - this.bz * forward - this.dz * localUp;
		this.updateProjection(); this.changed(); return true;
	}
	public frame2D(left: number, top: number, right: number, bottom: number, width: number, height: number,
		adoptView = false, reading: Reading = 'manual'): void {
		const changeMode = this.modeValue !== '2d' || adoptView && this.modeIntent !== 'manual';
		const c = this.canvas, centerX = (left + right) / 2, centerY = (top + bottom) / 2;
		const extentX = right - left, extentY = bottom - top, point = extentX === 0 && extentY === 0;
		const scale = clamp(Math.min(extentX === 0 && !point ? Infinity : Math.max(1, width - 32) / (point ? 64 : extentX),
			extentY === 0 && !point ? Infinity : Math.max(1, height - 32) / (point ? 64 : extentY)), 1 / 64, reading === 'initial' ? 1 : 64);
		if (!changeMode && c.reading === reading && c.centerX === centerX && c.centerY === centerY && c.scale === scale) return;
		if (changeMode) { this.modeValue = '2d'; this.modeIntent = 'manual'; }
		c.reading = reading; c.centerX = centerX; c.centerY = centerY; c.scale = scale;
		this.changed();
	}
	/** Bounds come from transformed vertices or an explicitly selected origin. */
	public frame3D(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number,
		originX = 0, originY = 0, originZ = 0, adoptView = false, reading: Reading = 'manual'): void {
		const changeMode = this.modeValue !== '3d' || adoptView && this.modeIntent !== 'manual';
		const s = this.space, centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2, centerZ = (minZ + maxZ) / 2;
		const radius = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
		const distance = radius === 0 ? s.distance : radius * 1.1 / Math.sin(Math.atan(TAN_HALF_FOV * Math.min(1, this.width / this.height)));
		if (!changeMode && s.reading === reading && s.originX === originX && s.originY === originY && s.originZ === originZ
			&& s.centerX === centerX && s.centerY === centerY && s.centerZ === centerZ && s.distance === distance) return;
		if (changeMode) { this.modeValue = '3d'; this.modeIntent = 'manual'; }
		s.reading = reading; s.originX = originX; s.originY = originY; s.originZ = originZ;
		s.centerX = centerX; s.centerY = centerY; s.centerZ = centerZ; s.distance = distance;
		this.updateProjection(); this.changed();
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
	private updateSpace(keepEye = false): void {
		const s = this.space, sine = Math.sin(s.yaw), cosine = Math.cos(s.yaw), pitchSine = Math.sin(s.pitch), pitchCosine = Math.cos(s.pitch);
		if (keepEye) {
			s.centerX += (this.bx - sine * pitchCosine) * s.distance;
			s.centerY += (this.by - pitchSine) * s.distance;
			s.centerZ += (this.bz - cosine * pitchCosine) * s.distance;
		}
		this.rx = cosine; this.rz = -sine;
		this.dx = sine * pitchSine; this.dy = -pitchCosine; this.dz = cosine * pitchSine;
		this.bx = sine * pitchCosine; this.by = pitchSine; this.bz = cosine * pitchCosine;
		this.updateProjection();
	}
	/** Translation, dolly and resize reuse the camera basis until its orientation changes. */
	private updateProjection(): void {
		const s = this.space;
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
