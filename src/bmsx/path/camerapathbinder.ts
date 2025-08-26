import { CameraObject } from '../core/cameraobject';
import type { vec3 } from '../rompack/rompack';
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

    startShake(d: any): void {
        this.shakeActive = true;
        this.shakeAmp = d?.amp ?? 0.2;
        this.shakeFreq = d?.freq ?? 20;
        const dur = d?.duration ?? 0.5;
        this.shakeStart = this.tAccum;
        this.shakeEnd = this.tAccum + dur;
    }
    startFovPulse(d: any): void {
        this.fovPulseActive = true; this.fovPulseFrom = this.cameraObj.camera.fovDeg; this.fovPulseTo = this.baseFov + (d?.delta ?? 10); this.fovPulseDur = d?.duration ?? 0.4; this.fovPulseStart = this.tAccum; this.fovPulseEnd = this.tAccum + this.fovPulseDur;
        const curveName: string = d?.curve ?? 'easeOutQuad';
        const curves: Record<string, (t: number) => number> = {
            linear: t => t,
            easeOutQuad: t => 1 - (1 - t) * (1 - t),
            easeInQuad: t => t * t,
            easeInOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
            easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
        };
        this.fovCurve = curves[curveName] || curves.easeOutQuad;
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
            const rx = up.y * f.z - up.z * f.y; const ry = up.z * f.x - up.x * f.z; const rz = up.x * f.y - up.y * f.x;
            const rlen = Math.hypot(rx, ry, rz) || 1; const rnx = rx / rlen, rny = ry / rlen, rnz = rz / rlen;
            const ux = f.y * rnz - f.z * rny; const uy = f.z * rnx - f.x * rnz; const uz = f.x * rny - f.y * rnx;
            const m00 = rnx, m01 = rny, m02 = rnz; const m10 = ux, m11 = uy, m12 = uz; const m20 = f.x, m21 = f.y, m22 = f.z;
            const tr = m00 + m11 + m22; let q: any;
            if (tr > 0) { const S = Math.sqrt(tr + 1.0) * 2; q = { w: 0.25 * S, x: (m21 - m12) / S, y: (m02 - m20) / S, z: (m10 - m01) / S }; }
            else if ((m00 > m11) && (m00 > m22)) { const S = Math.sqrt(1.0 + m00 - m11 - m22) * 2; q = { w: (m21 - m12) / S, x: 0.25 * S, y: (m01 + m10) / S, z: (m02 + m20) / S }; }
            else if (m11 > m22) { const S = Math.sqrt(1.0 + m11 - m00 - m22) * 2; q = { w: (m02 - m20) / S, x: (m01 + m10) / S, y: 0.25 * S, z: (m12 + m21) / S }; }
            else { const S = Math.sqrt(1.0 + m22 - m00 - m11) * 2; q = { w: (m10 - m01) / S, x: (m02 + m20) / S, y: (m12 + m21) / S, z: 0.25 * S }; }
            cam.setRotationQ(q, true);
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
