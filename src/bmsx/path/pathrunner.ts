import { Q, quat } from '../render/3d/math3d';
import { CatmullRomPath } from './catmullrompath';
import { Path, PathSample } from './ipath';

// Local easing lookup for segment meta (keep lightweight)
const EasingLookup: Record<string, (t: number) => number> = {
	linear: t => t,
	easeInQuad: t => t * t,
	easeOutQuad: t => 1 - (1 - t) * (1 - t),
	easeInOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
	easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
};

export type PlaybackPolicy = 'clamp' | 'loop' | 'pingpong';
export interface PathRunnerOptions { speed?: number; distanceMode?: boolean; playback?: PlaybackPolicy; bankFactor?: number; orientationKeys?: { u: number; q: quat }[]; lookAt?: () => { x: number; y: number; z: number }; baseUp?: { x: number; y: number; z: number }; }

export class PathRunner {
	u = 0;
	speed = 0.1;
	distanceMode = false;
	playback: PlaybackPolicy = 'clamp';
	paused = false;
	private _forward = 1;
	private _distanceCache = 0;
	readonly path: Path;
	// Orientation state
	orientation: quat = Q.ident();
	private _orientationKeys: { u: number; q: quat }[] = [];
	private _lookAt?: () => { x: number; y: number; z: number };
	private _baseUp = { x: 0, y: 1, z: 0 };
	private _bankFactor = 0;
	private _segBankFactor: number | undefined;
	constructor(path: Path, opts: PathRunnerOptions = {}) { this.path = path; if (opts.speed !== undefined) this.speed = opts.speed; if (opts.distanceMode) { this.distanceMode = true; this._distanceCache = path.distanceAtU(this.u); } if (opts.playback) this.playback = opts.playback; if (opts.orientationKeys) this._orientationKeys = opts.orientationKeys.slice().sort((a, b) => a.u - b.u); if (opts.lookAt) this._lookAt = opts.lookAt; if (opts.baseUp) this._baseUp = opts.baseUp; if (opts.bankFactor) this._bankFactor = opts.bankFactor; }
	setU(u: number): void { this.u = Math.min(1, Math.max(0, u)); this._updateOrientation(); }
	get distance(): number { return this.distanceMode ? this._distanceCache : this.path.distanceAtU(this.u); }
	update(dt: number): void {
		if (this.paused) return;
		// Segment metadata speed scaling (simple: sample segment meta pre-update)
		let speedScale = 1;
		if (this.path instanceof CatmullRomPath) {
			const meta = this.path.segmentMetaAt(this.u);
			if (meta !== undefined) {
				if (meta.speedScale !== undefined) speedScale = meta.speedScale;
				if (meta.bank !== undefined) {
					this._segBankFactor = meta.bank;
				} else {
					this._segBankFactor = undefined;
				}
			} else {
				this._segBankFactor = undefined;
			}
		}
		const effSpeed = this.speed * speedScale;
		if (this.distanceMode) {
			const adv = effSpeed * dt * this._forward; let newDist = this._distanceCache + adv; const L = this.path.length || 1;
			if (newDist > L || newDist < 0) {
				if (this.playback === 'loop') { newDist = ((newDist % L) + L) % L; }
				else if (this.playback === 'pingpong') { this._forward *= -1; newDist = Math.min(Math.max(newDist, 0), L); }
				else { newDist = Math.min(Math.max(newDist, 0), L); }
			}
			this._distanceCache = newDist; this.u = this.path.uAtDistance(newDist);
		} else {
			// Non-distance mode with potential per-segment easing
			if (this.path instanceof CatmullRomPath) {
				const seg = this.path.segmentBoundsAt(this.u);
				if (seg) {
					const span = (seg.u1 - seg.u0) || 1; const localT = (this.u - seg.u0) / span;
					const baseAdvance = effSpeed * dt * this._forward; // in u units
					const nextLocalT = localT + baseAdvance / span;
					const easingName = seg.meta ? seg.meta.easing : undefined;
					const easeFn = (easingName && EasingLookup[easingName]) ? EasingLookup[easingName] : undefined;
					if (easeFn) {
						const cl0 = Math.min(1, Math.max(0, localT)); const cl1 = Math.min(1, Math.max(0, nextLocalT));
						const e0 = easeFn(cl0); const e1 = easeFn(cl1); const deltaEased = (e1 - e0) * span;
						this.u += deltaEased;
					} else {
						this.u += baseAdvance;
					}
				} else {
					this.u += effSpeed * dt * this._forward;
				}
			} else {
				this.u += effSpeed * dt * this._forward;
			}
			if (this.u > 1 || this.u < 0) {
				if (this.playback === 'loop') { this.u = ((this.u % 1) + 1) % 1; }
				else if (this.playback === 'pingpong') { this._forward *= -1; this.u = Math.min(Math.max(this.u, 0), 1); }
				else { this.u = Math.min(Math.max(this.u, 0), 1); }
			}
		}
		this._updateOrientation();
	}
	private _updateOrientation(): void {
		const sample = this.sample();
		let fwd = sample.fwd;
		if (this._lookAt) { const tgt = this._lookAt(); const dx = tgt.x - sample.p.x, dy = tgt.y - sample.p.y, dz = tgt.z - sample.p.z; const L = Math.hypot(dx, dy, dz) || 1; fwd = { x: dx / L, y: dy / L, z: dz / L }; }
		// Orientation keys override
		if (this._orientationKeys.length) {
			const keys = this._orientationKeys; if (this.u <= keys[0].u) { this.orientation = keys[0].q; return; }
			if (this.u >= keys[keys.length - 1].u) { this.orientation = keys[keys.length - 1].q; return; }
			for (let i = 0; i < keys.length - 1; i++) { const a = keys[i], b = keys[i + 1]; if (this.u >= a.u && this.u <= b.u) { const span = (b.u - a.u) || 1; const t = (this.u - a.u) / span; this.orientation = Q.slerp(a.q, b.q, t); return; } }
		}
		// Tangent / banked
		let up = this._baseUp;
		const bankUse = (this._segBankFactor !== undefined) ? this._segBankFactor : this._bankFactor;
		if (bankUse !== 0) {
			// approximate curvature via forward delta
			const ahead = this.path.sample(Math.min(1, this.u + 0.002));
			const crossX = fwd.y * ahead.fwd.z - fwd.z * ahead.fwd.y;
			const crossY = fwd.z * ahead.fwd.x - fwd.x * ahead.fwd.z;
			const crossZ = fwd.x * ahead.fwd.y - fwd.y * ahead.fwd.x;
			const turnMag = Math.min(1, Math.max(-1, Math.hypot(crossX, crossY, crossZ))); // magnitude of change
			const sign = (crossY >= 0 ? 1 : -1); // using Y as up-axis sign heuristic
			const bankAngle = -sign * turnMag * bankUse; // roll inward
			// rotate baseUp around forward
			const L = Math.hypot(fwd.x, fwd.y, fwd.z) || 1; const fx = fwd.x / L, fy = fwd.y / L, fz = fwd.z / L;
			const c = Math.cos(bankAngle), s = Math.sin(bankAngle);
			const u = this._baseUp; const dotUF = u.x * fx + u.y * fy + u.z * fz;
			// Rodrigues' rotation formula for up rotated around fwd
			up = {
				x: u.x * c + (fy * u.z - fz * u.y) * s + fx * dotUF * (1 - c),
				y: u.y * c + (fz * u.x - fx * u.z) * s + fy * dotUF * (1 - c),
				z: u.z * c + (fx * u.y - fy * u.x) * s + fz * dotUF * (1 - c)
			};
		}
		this.orientation = Q.fromBasis(fwd, up);
	}
	sample(): PathSample { return this.path.sample(this.u); }
}
