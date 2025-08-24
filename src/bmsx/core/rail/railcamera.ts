import { quat } from '../../render/3d/math3d';
import type { vec3 } from '../../rompack/rompack';
import { CameraObject } from '../cameraobject';
import { RailRunner } from './railpath';

export interface CameraRailBindOptions {
    lookAhead?: number; // seconds (normalized) to sample ahead for forward vector
    worldUp?: vec3; // optional up override
    autoRotate?: boolean; // face forward direction
}

export class CameraRailBinder {
    private runner: RailRunner;
    private cameraObj: CameraObject;
    private opts: CameraRailBindOptions;
    private baseFov?: number;
    private fovPulseActive = false;
    private fovPulseEndTime = 0;
    private fovPulseFrom = 0;
    private fovPulseTo = 0;
    private fovPulseTotal = 0;
    private fovPulseStart = 0;
    private fovPulseCurve: (t: number) => number = (t) => 1 - (t - 1) * (t - 1);
    private shakeActive = false;
    private shakeEndTime = 0;
    private shakeAmp = 0;
    private shakeFreq = 0;
    private tAccum = 0;

    constructor(runner: RailRunner, cameraObj: CameraObject, opts: CameraRailBindOptions = {}) {
        this.runner = runner; this.cameraObj = cameraObj; this.opts = opts; this.baseFov = cameraObj.camera.fovDeg;
    }

    attachRailEvents(): void {
        this.runner.rail.on('camera.shake', (data: any) => this.startShake(data), this);
        this.runner.rail.on('camera.fovPulse', (data: any) => this.startFovPulse(data), this);
        this.runner.rail.on('rail.speed', (d: any) => { if (typeof d?.speed === 'number') this.runner.speed = d.speed; }, this);
        this.runner.rail.on('rail.pause', (d: any) => { this.runner.paused = true; if (d?.duration) { const end = this.tAccum + (d.duration || 0); const resume = () => { if (this.tAccum >= end) this.runner.paused = false; else requestAnimationFrame(resume); }; requestAnimationFrame(resume); } }, this);
        this.runner.rail.on('rail.resume', () => { this.runner.paused = false; }, this);
    }

    public startShake(d: any): void { this.shakeActive = true; this.shakeAmp = d?.amp ?? 0.2; this.shakeFreq = d?.freq ?? 20; this.shakeEndTime = this.tAccum + (d?.duration ?? 0.5); }

    public startFovPulse(d: any): void {
        this.fovPulseActive = true; this.fovPulseFrom = this.cameraObj.camera.fovDeg; this.fovPulseTo = this.baseFov! + (d?.delta ?? 10); this.fovPulseTotal = d?.duration ?? 0.4; this.fovPulseStart = this.tAccum; this.fovPulseEndTime = this.tAccum + this.fovPulseTotal;
        const curveName: string = d?.curve ?? 'easeOutQuad';
        const curves: Record<string, (t: number) => number> = {
            linear: t => t,
            easeOutQuad: t => 1 - (1 - t) * (1 - t),
            easeInQuad: t => t * t,
            easeInOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
            easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
        };
        this.fovPulseCurve = curves[curveName] || curves['easeOutQuad'];
    }

    update(dt: number): void {
        this.tAccum += dt; const cam = this.cameraObj.camera; const sample = this.runner.sample();
        cam.position.x = sample.p.x; cam.position.y = sample.p.y; cam.position.z = sample.p.z;
        if (this.opts.autoRotate) {
            let f = sample.fwd;
            if (this.opts.lookAhead && this.opts.lookAhead > 0) {
                const futureU = Math.min(1, this.runner.u + this.runner.speed * this.opts.lookAhead);
                const future = this.runner.rail.sample(futureU);
                const dx = future.p.x - sample.p.x, dy = future.p.y - sample.p.y, dz = future.p.z - sample.p.z;
                const len = Math.hypot(dx, dy, dz);
                if (len > 1e-5) f = { x: dx / len, y: dy / len, z: dz / len };
            }
            const up = this.opts.worldUp ?? { x: 0, y: 1, z: 0 };
            const rx = up.y * f.z - up.z * f.y; const ry = up.z * f.x - up.x * f.z; const rz = up.x * f.y - up.y * f.x;
            const rlen = Math.hypot(rx, ry, rz) || 1; const rnx = rx / rlen, rny = ry / rlen, rnz = rz / rlen;
            const ux = f.y * rnz - f.z * rny; const uy = f.z * rnx - f.x * rnz; const uz = f.x * rny - f.y * rnx;
            const m00 = rnx, m01 = rny, m02 = rnz; const m10 = ux, m11 = uy, m12 = uz; const m20 = f.x, m21 = f.y, m22 = f.z;
            const tr = m00 + m11 + m22; let q: quat;
            if (tr > 0) { const S = Math.sqrt(tr + 1.0) * 2; q = { w: 0.25 * S, x: (m21 - m12) / S, y: (m02 - m20) / S, z: (m10 - m01) / S }; }
            else if ((m00 > m11) && (m00 > m22)) { const S = Math.sqrt(1.0 + m00 - m11 - m22) * 2; q = { w: (m21 - m12) / S, x: 0.25 * S, y: (m01 + m10) / S, z: (m02 + m20) / S }; }
            else if (m11 > m22) { const S = Math.sqrt(1.0 + m11 - m00 - m22) * 2; q = { w: (m02 - m20) / S, x: (m01 + m10) / S, y: 0.25 * S, z: (m12 + m21) / S }; }
            else { const S = Math.sqrt(1.0 + m22 - m00 - m11) * 2; q = { w: (m10 - m01) / S, x: (m02 + m20) / S, y: (m12 + m21) / S, z: 0.25 * S }; }
            cam.setRotationQ(q, true);
        }
        if (this.fovPulseActive) {
            if (this.tAccum >= this.fovPulseEndTime) { cam.fovDeg = this.baseFov!; this.fovPulseActive = false; }
            else { const t = (this.tAccum - this.fovPulseStart) / this.fovPulseTotal; const ease = this.fovPulseCurve(Math.min(1, Math.max(0, t))); cam.fovDeg = this.fovPulseFrom + (this.fovPulseTo - this.fovPulseFrom) * (1 - ease); }
            cam.markDirty();
        }
        if (this.shakeActive) {
            if (this.tAccum >= this.shakeEndTime) { this.shakeActive = false; }
            else { const phase = this.tAccum * this.shakeFreq; const decay = 1 - (this.tAccum / this.shakeEndTime); cam.position.x += (Math.sin(phase * 12.9898) * 43758.5453 % 1 - 0.5) * this.shakeAmp * decay; cam.position.y += (Math.sin(phase * 78.233) * 96453.5453 % 1 - 0.5) * this.shakeAmp * decay; cam.markDirty(); }
        }
    }
}
