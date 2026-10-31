import { clamp } from '../../../../../machine/ts/common/clamp';

export type SceneViewportCameraState = {
	readonly mode: '2d' | '3d';
	readonly centerX: number; readonly centerY: number; readonly centerZ: number;
	readonly scale: number; readonly yaw: number; readonly pitch: number;
	readonly reading: 'initial' | 'manual';
};

/** Editor orthographic camera, independent of guest cameras and authored transforms. */
export class SceneViewportCamera {
	private modeValue: '2d' | '3d' = '2d';
	private reading: 'initial' | 'manual' = 'initial';
	public get mode(): '2d' | '3d' { return this.modeValue; }
	public get initial(): boolean { return this.reading === 'initial'; }
	public get scale(): number { return this.scaleValue; }
	public get revision(): number { return this.revisionValue; }
	private centerX = 0; private centerY = 0; private centerZ = 0;
	private scaleValue = 1; private yaw = 0.65; private pitch = 0.55;
	private revisionValue = 0;
	private rx = 1; private rz = 0;
	private dx = 0; private dy = 1; private dz = 0;
	private readonly listeners = new Set<() => void>();
	public onDidChange(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
	public capture(): SceneViewportCameraState {
		return { mode: this.mode, centerX: this.centerX, centerY: this.centerY, centerZ: this.centerZ,
			scale: this.scale, yaw: this.yaw, pitch: this.pitch, reading: this.reading };
	}
	public restore(state: SceneViewportCameraState): void {
		this.reading = state.reading; this.modeValue = state.mode; this.centerX = state.centerX; this.centerY = state.centerY; this.centerZ = state.centerZ;
		this.scaleValue = state.scale; this.yaw = state.yaw; this.pitch = state.pitch; this.updateBasis(); this.changed();
	}
	public setMode(mode: '2d' | '3d'): void {
		if (mode === this.mode && !this.initial) return;
		this.modeValue = mode; this.reading = 'manual'; this.updateBasis(); this.changed();
	}
	/** Source-derived mode admission preserves pending initial framing through snapshots. */
	public initializeMode(mode: '2d' | '3d'): void {
		if (!this.initial || this.mode === mode) return;
		this.modeValue = mode; this.updateBasis(); this.changed();
	}
	public horizontal(x: number, _y: number, z: number): number { return this.rx * x + this.rz * z; }
	public vertical(x: number, y: number, z: number): number { return this.dx * x + this.dy * y + this.dz * z; }
	public projectX(x: number, y: number, z: number): number {
		return this.horizontal(x - this.centerX, y - this.centerY, z - this.centerZ) * this.scale;
	}
	public projectY(x: number, y: number, z: number): number {
		return this.vertical(x - this.centerX, y - this.centerY, z - this.centerZ) * this.scale;
	}
	/** Inverse screen-plane movement preserves the editor camera's depth. */
	public pan(x: number, y: number): void {
		this.reading = 'manual';
		this.centerX -= (this.rx * x + this.dx * y) / this.scale;
		this.centerY -= this.dy * y / this.scale;
		this.centerZ -= (this.rz * x + this.dz * y) / this.scale; this.changed();
	}
	/** Keep the world point under the pointer fixed, as Godot's canvas zoom does. */
	public zoom(steps: number, anchorX: number, anchorY: number): void {
		const scale = clamp(this.scale * 2 ** steps, 1 / 64, 64);
		if (scale === this.scale) return;
		this.reading = 'manual';
		const delta = 1 / this.scale - 1 / scale;
		this.centerX += (this.rx * anchorX + this.dx * anchorY) * delta;
		this.centerY += this.dy * anchorY * delta;
		this.centerZ += (this.rz * anchorX + this.dz * anchorY) * delta;
		this.scaleValue = scale; this.changed();
	}
	public orbit(x: number, y: number): void {
		this.reading = 'manual';
		this.yaw += x * 0.01; this.pitch = clamp(this.pitch + y * 0.01, -1.5, 1.5);
		this.updateBasis(); this.changed();
	}
	public frame(left: number, top: number, right: number, bottom: number, width: number, height: number): void {
		this.reading = 'manual';
		const x = (left + right) / 2 - this.horizontal(this.centerX, this.centerY, this.centerZ);
		const y = (top + bottom) / 2 - this.vertical(this.centerX, this.centerY, this.centerZ);
		this.centerX += this.rx * x + this.dx * y; this.centerY += this.dy * y; this.centerZ += this.rz * x + this.dz * y;
		// A lone origin has no geometric extent; the camera retains a useful reading span, not fake object bounds.
		this.scaleValue = clamp(Math.min(Math.max(1, width - 32) / Math.max(64, right - left),
			Math.max(1, height - 32) / Math.max(64, bottom - top)), 1 / 64, 64);
		this.changed();
	}
	private updateBasis(): void {
		if (this.modeValue === '2d') { this.rx = 1; this.rz = 0; this.dx = 0; this.dy = 1; this.dz = 0; return; }
		const sine = Math.sin(this.yaw), cosine = Math.cos(this.yaw), pitchSine = Math.sin(this.pitch);
		this.rx = cosine; this.rz = -sine;
		this.dx = sine * pitchSine; this.dy = -Math.cos(this.pitch); this.dz = cosine * pitchSine;
	}
	private changed(): void { this.revisionValue++; for (const listener of this.listeners) listener(); }
}
