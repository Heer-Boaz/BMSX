import { V3 } from '../../render/3d/math3d';
import type { vec3 } from '../../rompack/rompack';
import { EventEmitter } from '../eventemitter';

export interface RailPoint { p: vec3; t?: number; }
export interface RailEvent { time: number; name: string; data?: any; fired?: boolean; }
export interface RailSample { t: number; p: vec3; fwd: vec3; }

export class RailPath extends EventEmitter {
    points: RailPoint[] = [];
    events: RailEvent[] = [];
    length = 0;
    private _samples: RailSample[] = [];
    private _granularity = 200;
    private _arcLengths: Float32Array = new Float32Array(0); // cumulative distance at each sample (0..length)
    constructor(points?: RailPoint[]) { super(); if (points) this.setPoints(points); }
    setPoints(points: RailPoint[]): void { this.points = points.slice(); this._recompute(); }
    addPoint(p: vec3, t?: number): void { this.points.push({ p: { x: p.x, y: p.y, z: p.z }, t }); this._recompute(); }
    addEvent(ev: RailEvent): void { this.events.push(ev); this.events.sort((a, b) => a.time - b.time); }
    addEvents(evs: RailEvent[]): void { for (const e of evs) this.events.push(e); this.events.sort((a, b) => a.time - b.time); }
    resetEvents(): void { for (const e of this.events) e.fired = false; }
    private _recompute(): void {
        if (this.points.length < 2) { this._samples = []; this.length = 0; return; }
        const pts = this.points; const dists: number[] = [0]; let total = 0;
        for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].p.x - pts[i - 1].p.x, pts[i].p.y - pts[i - 1].p.y, pts[i].p.z - pts[i - 1].p.z); dists[i] = total; }
        this.length = total;
        for (let i = 0; i < pts.length; i++) if (pts[i].t === undefined) pts[i].t = dists[i] / total;
        const t0 = pts[0].t!; const t1 = pts[pts.length - 1].t!; const span = t1 - t0 || 1;
        for (const p of pts) p.t = (p.t! - t0) / span;
        this._samples = []; const N = this._granularity; for (let i = 0; i <= N; i++) { const u = i / N; this._samples.push(this._sampleAt(u)); }
        // Build arc-length table (cumulative distances across sample positions)
        if (this._samples.length) {
            this._arcLengths = new Float32Array(this._samples.length);
            this._arcLengths[0] = 0;
            let acc = 0;
            for (let i = 1; i < this._samples.length; i++) {
                const a = this._samples[i - 1].p, b = this._samples[i].p;
                acc += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
                this._arcLengths[i] = acc;
            }
            // normalize discrepancy: use measured acc instead of straight-line aggregated length for better travel speed fidelity
            this.length = acc; // override with sampled length (smoother for curved splines)
        } else {
            this._arcLengths = new Float32Array(0);
        }
    }
    private _catmullRom(p0: vec3, p1: vec3, p2: vec3, p3: vec3, t: number, out: vec3): vec3 {
        const t2 = t * t, t3 = t2 * t;
        const ax = (-0.5 * p0.x) + (1.5 * p1.x) + (-1.5 * p2.x) + (0.5 * p3.x);
        const bx = (1 * p0.x) + (-2.5 * p1.x) + (2 * p2.x) + (-0.5 * p3.x);
        const cx = (-0.5 * p0.x) + (0 * p1.x) + (0.5 * p2.x) + (0 * p3.x);
        const dx = p1.x;
        const ay = (-0.5 * p0.y) + (1.5 * p1.y) + (-1.5 * p2.y) + (0.5 * p3.y);
        const by = (1 * p0.y) + (-2.5 * p1.y) + (2 * p2.y) + (-0.5 * p3.y);
        const cy = (-0.5 * p0.y) + (0 * p1.y) + (0.5 * p2.y) + (0 * p3.y);
        const dy = p1.y;
        const az = (-0.5 * p0.z) + (1.5 * p1.z) + (-1.5 * p2.z) + (0.5 * p3.z);
        const bz = (1 * p0.z) + (-2.5 * p1.z) + (2 * p2.z) + (-0.5 * p3.z);
        const cz = (-0.5 * p0.z) + (0 * p1.z) + (0.5 * p2.z) + (0 * p3.z);
        const dz = p1.z;
        out.x = ax * t3 + bx * t2 + cx * t + dx;
        out.y = ay * t3 + by * t2 + cy * t + dy;
        out.z = az * t3 + bz * t2 + cz * t + dz;
        return out;
    }
    private _sampleAt(u: number): RailSample {
        const pts = this.points; const n = pts.length; if (!n) return { t: u, p: V3.of(), fwd: { x: 0, y: 0, z: 1 } };
        let i = 0; while (i < n - 2 && pts[i + 1].t! < u) i++; const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(n - 1, i + 1), i3 = Math.min(n - 1, i + 2);
        const span = (pts[i2].t! - pts[i1].t!) || 1; const localT = (u - pts[i1].t!) / span; const p = V3.of();
        this._catmullRom(pts[i0].p, pts[i1].p, pts[i2].p, pts[i3].p, localT, p);
        const eps = 0.001; const u2 = Math.min(1, u + eps); if (u2 !== u) { const ahead = V3.of(); this._catmullRom(pts[i0].p, pts[i1].p, pts[i2].p, pts[i3].p, Math.min(1, localT + eps / span), ahead); const diff = V3.sub(ahead, p); const L = V3.len(diff) || 1; return { t: u, p, fwd: { x: diff.x / L, y: diff.y / L, z: diff.z / L } }; }
        return { t: u, p, fwd: { x: 0, y: 0, z: 1 } };
    }
    sample(u: number): RailSample { if (!this._samples.length) return { t: u, p: V3.of(), fwd: { x: 0, y: 0, z: 1 } }; const N = this._granularity; const f = u * N; const i = Math.min(N - 1, Math.floor(f)); const frac = f - i; const a = this._samples[i], b = this._samples[i + 1]; const lerp = (pa: vec3, pb: vec3, t: number) => ({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: pa.z + (pb.z - pa.z) * t }); const p = lerp(a.p, b.p, frac); const fwdRaw = lerp(a.fwd, b.fwd, frac); const L = Math.hypot(fwdRaw.x, fwdRaw.y, fwdRaw.z) || 1; return { t: u, p, fwd: { x: fwdRaw.x / L, y: fwdRaw.y / L, z: fwdRaw.z / L } }; }
    /** Returns approximate distance (0..length) along rail for parameter u */
    distanceAtU(u: number): number {
        if (!this._arcLengths.length) return 0;
        u = Math.min(1, Math.max(0, u));
        const N = this._granularity; const f = u * N; const i = Math.min(N, Math.floor(f)); const frac = f - i; if (i >= this._arcLengths.length - 1) return this.length; const a = this._arcLengths[i], b = this._arcLengths[i + 1]; return a + (b - a) * frac;
    }
    /** Inverse of distanceAtU: maps distance s (0..length) to u (0..1) via binary search + linear refine */
    uAtDistance(s: number): number {
        if (!this._arcLengths.length || this.length === 0) return 0;
        s = Math.min(this.length, Math.max(0, s));
        // binary search
        let lo = 0, hi = this._arcLengths.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this._arcLengths[mid] < s) lo = mid + 1; else hi = mid;
        }
        const idx = Math.max(1, lo);
        const s0 = this._arcLengths[idx - 1]; const s1 = this._arcLengths[idx];
        const span = s1 - s0 || 1; const t = (s - s0) / span;
        const u0 = (idx - 1) / this._granularity; const u1 = idx / this._granularity;
        return u0 + (u1 - u0) * t;
    }
    updateAndFire(prevU: number, newU: number): void { if (newU < prevU) for (const ev of this.events) ev.fired = false; for (const ev of this.events) if (!ev.fired && ev.time >= prevU && ev.time < newU) { this.emit(ev.name, ev.data); ev.fired = true; } }
    static fromJSON(json: string | any): RailPath { const obj = (typeof json === 'string') ? JSON.parse(json) : json; const pts: RailPoint[] = obj.points?.map((p: any) => ({ p: { x: p.x, y: p.y, z: p.z }, t: p.t })) ?? []; const rail = new RailPath(pts); if (obj.events) rail.addEvents(obj.events.map((e: any) => ({ time: e.time, name: e.name, data: e.data }))); return rail; }
    toJSON(): any { return { points: this.points.map(pt => ({ x: pt.p.x, y: pt.p.y, z: pt.p.z, t: pt.t })), events: this.events.map(ev => ({ time: ev.time, name: ev.name, data: ev.data })) }; }
}

export interface RailRunnerOptions { distanceMode?: boolean; speed?: number; looping?: boolean; }
export class RailRunner {
    u = 0; // normalized parameter 0..1
    speed = 0.1; // if distanceMode=false: units of u/sec; else: world units per second along arc length
    rail: RailPath; looping = false; paused = false; distanceMode = false; private _distanceCache = 0; // current traveled distance when distanceMode
    constructor(rail: RailPath, opts: RailRunnerOptions = {}) { this.rail = rail; if (opts.speed !== undefined) this.speed = opts.speed; if (opts.looping !== undefined) this.looping = !!opts.looping; if (opts.distanceMode) { this.distanceMode = true; this._distanceCache = rail.distanceAtU(this.u); } }
    setSpeed(speed: number): void { this.speed = speed; }
    setPaused(p: boolean): void { this.paused = p; }
    /** Returns current traveled distance (0..rail.length) if distanceMode else scaled u. */
    get distance(): number { return this.distanceMode ? this._distanceCache : this.rail.distanceAtU(this.u); }
    update(dt: number): void {
        if (this.paused) return;
        const prevU = this.u;
        if (this.distanceMode) {
            const advance = this.speed * dt; // world units
            let newDist = this._distanceCache + advance;
            const L = this.rail.length || 1;
            if (newDist > L) {
                if (this.looping) newDist = newDist % L; else newDist = L;
            }
            this._distanceCache = newDist;
            this.u = this.rail.uAtDistance(newDist);
        } else {
            this.u += this.speed * dt;
            if (this.u > 1) { if (this.looping) this.u = this.u % 1; else this.u = 1; }
        }
        this.rail.updateAndFire(prevU, this.u);
    }
    sample(): RailSample { return this.rail.sample(this.u); }
}
