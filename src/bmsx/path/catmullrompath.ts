import { EventEmitter } from '../core/eventemitter';
import { V3 } from '../render/3d/math3d';
import type { vec3 } from '../rompack/rompack';
import { Path, PathPoint, PathSample, PathSegmentMeta } from './ipath';

export interface CatmullRomPathJSON { points: { x: number; y: number; z: number; t?: number; meta?: PathSegmentMeta }[]; }

export class CatmullRomPath extends EventEmitter implements Path {
	points: PathPoint[] = [];
	length = 0;
	private _samples: PathSample[] = [];
	private _granularity = 200;
	private _arcLengths: Float32Array = new Float32Array(0);
	// Expose segment meta query (meta from preceding control point)
	segmentMetaAt(u: number): PathSegmentMeta | undefined {
		const pts = this.points; if (!pts.length) return undefined; if (u <= 0) return pts[0].meta; if (u >= 1) return pts[pts.length - 1].meta; let prev = pts[0]; for (let i = 1; i < pts.length; i++) { if (pts[i].t! >= u) return prev.meta; prev = pts[i]; } return pts[pts.length - 1].meta;
	}
	segmentBoundsAt(u: number): { u0: number; u1: number; meta?: PathSegmentMeta } | undefined {
		const pts = this.points; if (pts.length < 2) return undefined; if (u <= 0) return { u0: pts[0].t!, u1: pts[1].t!, meta: pts[0].meta }; if (u >= 1) return { u0: pts[pts.length - 2].t!, u1: pts[pts.length - 1].t!, meta: pts[pts.length - 2].meta }; let prev = pts[0]; for (let i = 1; i < pts.length; i++) { const cur = pts[i]; if (cur.t! >= u) { return { u0: prev.t!, u1: cur.t!, meta: prev.meta }; } prev = cur; } return { u0: pts[pts.length - 2].t!, u1: pts[pts.length - 1].t!, meta: pts[pts.length - 2].meta };
	}
	constructor(points?: PathPoint[]) { super(); if (points) this.setPoints(points); }
	setPoints(points: PathPoint[]): void { this.points = points.slice(); this._recompute(); }
	addPoint(p: vec3, t?: number, meta?: any): void { this.points.push({ p: { x: p.x, y: p.y, z: p.z }, t, meta }); this._recompute(); }
	private _recompute(): void {
		if (this.points.length < 2) { this._samples = []; this.length = 0; return; }
		const pts = this.points; const dists: number[] = [0]; let total = 0;
		for (let i = 1; i < pts.length; i++) { total += Math.hypot(pts[i].p.x - pts[i - 1].p.x, pts[i].p.y - pts[i - 1].p.y, pts[i].p.z - pts[i - 1].p.z); dists[i] = total; }
		this.length = total;
		for (let i = 0; i < pts.length; i++) if (pts[i].t === undefined) pts[i].t = total ? dists[i] / total : 0;
		const t0 = pts[0].t!, t1 = pts[pts.length - 1].t!, span = t1 - t0 || 1; for (const p of pts) p.t = (p.t! - t0) / span;
		this._samples = []; const N = this._granularity; for (let i = 0; i <= N; i++) { const u = i / N; this._samples.push(this._sampleAt(u)); }
		if (this._samples.length) { this._arcLengths = new Float32Array(this._samples.length); this._arcLengths[0] = 0; let acc = 0; for (let i = 1; i < this._samples.length; i++) { const a = this._samples[i - 1].p, b = this._samples[i].p; acc += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); this._arcLengths[i] = acc; } this.length = acc; } else { this._arcLengths = new Float32Array(0); }
	}
	private _cat(p0: vec3, p1: vec3, p2: vec3, p3: vec3, t: number, out: vec3): vec3 { const t2 = t * t, t3 = t2 * t; const ax = (-0.5 * p0.x) + (1.5 * p1.x) + (-1.5 * p2.x) + (0.5 * p3.x); const bx = (1 * p0.x) + (-2.5 * p1.x) + (2 * p2.x) + (-0.5 * p3.x); const cx = (-0.5 * p0.x) + (0 * p1.x) + (0.5 * p2.x) + (0 * p3.x); const dx = p1.x; const ay = (-0.5 * p0.y) + (1.5 * p1.y) + (-1.5 * p2.y) + (0.5 * p3.y); const by = (1 * p0.y) + (-2.5 * p1.y) + (2 * p2.y) + (-0.5 * p3.y); const cy = (-0.5 * p0.y) + (0 * p1.y) + (0.5 * p2.y) + (0 * p3.y); const dy = p1.y; const az = (-0.5 * p0.z) + (1.5 * p1.z) + (-1.5 * p2.z) + (0.5 * p3.z); const bz = (1 * p0.z) + (-2.5 * p1.z) + (2 * p2.z) + (-0.5 * p3.z); const cz = (-0.5 * p0.z) + (0 * p1.z) + (0.5 * p2.z) + (0 * p3.z); const dz = p1.z; out.x = ax * t3 + bx * t2 + cx * t + dx; out.y = ay * t3 + by * t2 + cy * t + dy; out.z = az * t3 + bz * t2 + cz * t + dz; return out; }
	private _sampleAt(u: number): PathSample { const pts = this.points; const n = pts.length; if (!n) return { u, p: V3.of(), fwd: { x: 0, y: 0, z: 1 } }; let i = 0; while (i < n - 2 && pts[i + 1].t! < u) i++; const i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(n - 1, i + 1), i3 = Math.min(n - 1, i + 2); const span = (pts[i2].t! - pts[i1].t!) || 1; const local = (u - pts[i1].t!) / span; const p = V3.of(); this._cat(pts[i0].p, pts[i1].p, pts[i2].p, pts[i3].p, local, p); const eps = 0.001; const local2 = Math.min(1, local + eps / span); const ahead = V3.of(); this._cat(pts[i0].p, pts[i1].p, pts[i2].p, pts[i3].p, local2, ahead); const diff = V3.sub(ahead, p); const L = V3.len(diff) || 1; return { u, p, fwd: { x: diff.x / L, y: diff.y / L, z: diff.z / L } }; }
	sample(u: number): PathSample { if (!this._samples.length) return { u, p: V3.of(), fwd: { x: 0, y: 0, z: 1 } }; const N = this._granularity; const f = u * N; const i = Math.min(N - 1, Math.floor(f)); const frac = f - i; const a = this._samples[i], b = this._samples[i + 1]; const lerp = (pa: vec3, pb: vec3, t: number) => ({ x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, z: pa.z + (pb.z - pa.z) * t }); const p = lerp(a.p, b.p, frac); const fwdRaw = lerp(a.fwd, b.fwd, frac); const L = Math.hypot(fwdRaw.x, fwdRaw.y, fwdRaw.z) || 1; return { u, p, fwd: { x: fwdRaw.x / L, y: fwdRaw.y / L, z: fwdRaw.z / L } }; }
	distanceAtU(u: number): number { if (!this._arcLengths.length) return 0; u = Math.min(1, Math.max(0, u)); const N = this._granularity; const f = u * N; const i = Math.min(N, Math.floor(f)); const frac = f - i; if (i >= this._arcLengths.length - 1) return this.length; const a = this._arcLengths[i], b = this._arcLengths[i + 1]; return a + (b - a) * frac; }
	uAtDistance(s: number): number { if (!this._arcLengths.length || this.length === 0) return 0; s = Math.min(this.length, Math.max(0, s)); let lo = 0, hi = this._arcLengths.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (this._arcLengths[mid] < s) lo = mid + 1; else hi = mid; } const idx = Math.max(1, lo); const s0 = this._arcLengths[idx - 1]; const s1 = this._arcLengths[idx]; const span = s1 - s0 || 1; const t = (s - s0) / span; const u0 = (idx - 1) / this._granularity; const u1 = idx / this._granularity; return u0 + (u1 - u0) * t; }
	static fromJSON(json: string | CatmullRomPathJSON): CatmullRomPath {
		const obj: CatmullRomPathJSON = (typeof json === 'string') ? JSON.parse(json) as CatmullRomPathJSON : json;
		if (!obj || !Array.isArray(obj.points)) {
			throw new Error('[CatmullRomPath] JSON payload does not contain a points array.');
		}
		const pts: PathPoint[] = obj.points.map(p => ({ p: { x: p.x, y: p.y, z: p.z }, t: p.t, meta: p.meta }));
		return new CatmullRomPath(pts);
	}
	toJSON(): CatmullRomPathJSON { return { points: this.points.map(pt => ({ x: pt.p.x, y: pt.p.y, z: pt.p.z, t: pt.t, meta: pt.meta })) }; }
}
