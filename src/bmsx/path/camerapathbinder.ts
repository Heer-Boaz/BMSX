import { CameraObject } from '../core/object/cameraobject';
import type { vec3 } from '../rompack/rompack';
// (no direct math usage here; camera.lookAt handles orientation)
import { PathRunner } from './pathrunner';

export interface CameraPathBindOptions {
	lookAheadU?: number; // ahead in normalized u (0..1) for anticipatory facing
	worldUp?: vec3;      // override up vector (default Y-up)
	autoRotate?: boolean; // face forward automatically
}

// Generic camera binder for PathRunner (replaces legacy CameraRailBinder)
// Handles: positioning on path, optional look-ahead orientation, FOV pulse & shake effects.
export class CameraPathBinder {
	private runner: PathRunner;
	private cameraObj: CameraObject;
	private opts: CameraPathBindOptions;
	private baseFov: number;
	private tAccum = 0;
	// FOV pulse
	private fovPulseActive = false; private fovPulseEnd = 0; private fovPulseFrom = 0; private fovPulseTo = 0; private fovPulseDur = 0; private fovPulseStart = 0; private fovCurve: (t: number) => number = t => 1 - (t - 1) * (t - 1);
	// Shake
	private shakeActive = false; private shakeStart = 0; private shakeEnd = 0; private shakeAmp = 0; private shakeFreq = 0;

	constructor(runner: PathRunner, cameraObj: CameraObject, opts: CameraPathBindOptions = {}) { this.runner = runner; this.cameraObj = cameraObj; this.opts = opts; this.baseFov = cameraObj.camera.fovDeg; }

	startShake(d: { amp?: number; freq?: number; duration?: number }): void {
		if (!d || typeof d !== 'object') {
			throw new Error('[CameraPathBinder] startShake requires a parameter object.');
		}
		this.shakeActive = true;
		const amp = 'amp' in d ? d.amp : undefined;
		this.shakeAmp = typeof amp === 'number' ? amp : 0.2;
		const freq = 'freq' in d ? d.freq : undefined;
		this.shakeFreq = typeof freq === 'number' ? freq : 20;
		const durationVal = 'duration' in d ? d.duration : undefined;
		const dur = typeof durationVal === 'number' ? durationVal : 0.5;
		this.shakeStart = this.tAccum;
		this.shakeEnd = this.tAccum + dur;
	}
	startFovPulse(d: { delta?: number; duration?: number; curve?: string }): void {
		if (!d || typeof d !== 'object') {
			throw new Error('[CameraPathBinder] startFovPulse requires a parameter object.');
		}
		const deltaVal = 'delta' in d ? d.delta : undefined;
		const delta = typeof deltaVal === 'number' ? deltaVal : 10;
		const durationVal = 'duration' in d ? d.duration : undefined;
		this.fovPulseDur = typeof durationVal === 'number' ? durationVal : 0.4;
		this.fovPulseActive = true;
		this.fovPulseFrom = this.cameraObj.camera.fovDeg;
		this.fovPulseTo = this.baseFov + delta;
		this.fovPulseStart = this.tAccum;
		this.fovPulseEnd = this.tAccum + this.fovPulseDur;
		const curveNameValue = 'curve' in d ? d.curve : undefined;
		const curveName = (typeof curveNameValue === 'string' && curveNameValue.length > 0) ? curveNameValue : 'easeOutQuad';
		const curves: Record<string, (t: number) => number> = {
			linear: t => t,
			easeOutQuad: t => 1 - (1 - t) * (1 - t),
			easeInQuad: t => t * t,
			easeInOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
			easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
		};
		const curve = curves[curveName];
		if (!curve) {
			throw new Error(`[CameraPathBinder] Unknown FOV pulse curve '${curveName}'.`);
		}
		this.fovCurve = curve;
	}

	update(dt: number): void {
		this.tAccum += dt;
		const cam = this.cameraObj.camera;
		const s = this.runner.sample();
		cam.position.x = s.p.x; cam.position.y = s.p.y; cam.position.z = s.p.z;
		if (this.opts.autoRotate) {
			let f = s.fwd;
			if (this.opts.lookAheadU && this.opts.lookAheadU > 0) {
				const ahead = this.runner.path.sample(Math.min(1, this.runner.u + this.opts.lookAheadU));
				const dx = ahead.p.x - s.p.x, dy = ahead.p.y - s.p.y, dz = ahead.p.z - s.p.z; const L = Math.hypot(dx, dy, dz); if (L > 1e-5) f = { x: dx / L, y: dy / L, z: dz / L };
			}
			const up = this.opts.worldUp ?? { x: 0, y: 1, z: 0 };
			const tgt = { x: cam.position.x + f.x, y: cam.position.y + f.y, z: cam.position.z + f.z };
			cam.lookAt(tgt, up);
		}
		if (this.fovPulseActive) {
			if (this.tAccum >= this.fovPulseEnd) { cam.fovDeg = this.baseFov; this.fovPulseActive = false; }
			else { const t = (this.tAccum - this.fovPulseStart) / this.fovPulseDur; const e = this.fovCurve(Math.min(1, Math.max(0, t))); cam.fovDeg = this.fovPulseFrom + (this.fovPulseTo - this.fovPulseFrom) * (1 - e); }
			cam.markDirty();
		}
		if (this.shakeActive) {
			if (this.tAccum >= this.shakeEnd) {
				this.shakeActive = false;
			} else {
				const localT = (this.tAccum - this.shakeStart) / (this.shakeEnd - this.shakeStart);
				const decay = 1 - Math.min(1, Math.max(0, localT));
				const phase = this.tAccum * this.shakeFreq;
				const randX = (Math.sin(phase * 12.9898) * 43758.5453) % 1 - 0.5;
				const randY = (Math.sin(phase * 78.233) * 96453.5453) % 1 - 0.5;
				cam.position.x += randX * this.shakeAmp * decay;
				cam.position.y += randY * this.shakeAmp * decay;
				cam.markDirty();
			}
		}
	}
}
