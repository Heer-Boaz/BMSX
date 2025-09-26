// Moved from core/rail/timeline.ts to generic core scope.
import type { PathRunner } from '../path/pathrunner';
import type { quat } from '../render/3d/math3d';
import type { vec3 } from '../rompack/rompack';
import { EventEmitter } from './eventemitter';

export interface TimelineEvent { time: number; name: string; data?: any; fired?: boolean; }
export interface TimelineAction { start: number; end: number; update: (tNorm: number, globalU: number) => void; done?: boolean; }
export type EasingFn = (t: number) => number;

const Easings: Record<string, EasingFn> = {
	linear: t => t,
	easeInQuad: t => t * t,
	easeOutQuad: t => 1 - (1 - t) * (1 - t),
	easeInOutQuad: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
	easeOutBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); }
};

export interface AnimateNumberOptions { easing?: EasingFn | string; clamp?: boolean; }
export interface AnimateVec3Options { easing?: EasingFn | string; }
export interface AnimateQuatOptions { easing?: EasingFn | string; shortestPath?: boolean; }

export class Timeline extends EventEmitter {
	private events: TimelineEvent[] = [];
	private actions: TimelineAction[] = [];
	private _u = 0; // normalized position 0..1
	playing = true;
	loop = false;
	get u() { return this._u; }
	private dispatch(name: string, data: unknown): void {
		super.emit(name, this, data);
	}
	reset(): void { for (const e of this.events) e.fired = false; for (const a of this.actions) a.done = false; this._u = 0; }
	addEvent(time: number, name: string, data?: any): this { this.events.push({ time, name, data }); this.events.sort((a, b) => a.time - b.time); return this; }
	addEvents(list: { time: number; name: string; data?: any; }[]): this { for (const e of list) this.addEvent(e.time, e.name, e.data); return this; }
	addAction(start: number, end: number, update: (tNorm: number, globalU: number) => void): this { if (end < start) [start, end] = [end, start]; this.actions.push({ start, end, update }); this.actions.sort((a, b) => a.start - b.start); return this; }
	animateNumber(set: (v: number) => void, from: number, to: number, start: number, duration: number, opts: AnimateNumberOptions = {}): this { const end = start + duration; const easing = typeof opts.easing === 'string' ? (Easings[opts.easing] || Easings.easeOutQuad) : (opts.easing || Easings.easeOutQuad); return this.addAction(start, end, (tn) => { const eased = easing(Math.min(1, Math.max(0, tn))); const v = from + (to - from) * eased; set(opts.clamp ? (to > from ? Math.min(v, to) : Math.max(v, to)) : v); }); }
	animateVec3(set: (v: vec3) => void, from: vec3, to: vec3, start: number, duration: number, opts: AnimateVec3Options = {}): this { const end = start + duration; const easing = typeof opts.easing === 'string' ? (Easings[opts.easing] || Easings.easeOutQuad) : (opts.easing || Easings.easeOutQuad); return this.addAction(start, end, (tn) => { const e = easing(Math.min(1, Math.max(0, tn))); set({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, z: from.z + (to.z - from.z) * e }); }); }
	animateQuat(set: (q: quat) => void, from: quat, to: quat, start: number, duration: number, opts: AnimateQuatOptions = {}): this { const end = start + duration; const easing = typeof opts.easing === 'string' ? (Easings[opts.easing] || Easings.easeOutQuad) : (opts.easing || Easings.easeOutQuad); let toAdj = { ...to }; if (opts.shortestPath) { const dot = from.x * to.x + from.y * to.y + from.z * to.z + from.w * to.w; if (dot < 0) { toAdj = { x: -to.x, y: -to.y, z: -to.z, w: -to.w }; } } return this.addAction(start, end, (tn) => { const e = easing(Math.min(1, Math.max(0, tn))); let x = from.x + (toAdj.x - from.x) * e; let y = from.y + (toAdj.y - from.y) * e; let z = from.z + (toAdj.z - from.z) * e; let w = from.w + (toAdj.w - from.w) * e; const len = Math.hypot(x, y, z, w) || 1; set({ x: x / len, y: y / len, z: z / len, w: w / len }); }); }
	advanceTo(u: number): void { const prev = this._u; let looped = false; if (u < prev && this.loop) looped = true; this._u = u; if (looped) { for (const e of this.events) e.fired = false; for (const a of this.actions) a.done = false; } for (const ev of this.events) { if (!ev.fired) { if (!looped && ev.time >= prev && ev.time < u) { this.dispatch(ev.name, ev.data); ev.fired = true; } else if (looped && (ev.time >= prev || ev.time < u)) { this.dispatch(ev.name, ev.data); ev.fired = true; } } } for (const a of this.actions) { if (a.done) continue; const span = a.end - a.start || 1; let tn: number | undefined; if (!looped) { if (u >= a.start && prev <= a.end) { const clamped = Math.min(u, a.end); tn = (clamped - a.start) / span; if (clamped >= a.end) a.done = true; } } else { if (u >= a.start || prev <= a.end) { if (u >= a.start) tn = (u - a.start) / span; else tn = (1 - a.start + u) / span; if (u >= a.end && prev < a.end) a.done = true; } } if (tn !== undefined) a.update(Math.min(1, Math.max(0, tn)), this._u); } }
	// Generic path helpers (renamed from *Rail* variants)
	bindToPath(_runner: PathRunner): this { return this; }
	updateFromPath(runner: PathRunner): void { this.advanceTo(runner.u); }
	drivePath(runner: PathRunner): void { runner.u = this.u; }
	// Deprecated rail-named helpers kept for compatibility (no-op wrappers)
	bindToRail(r: PathRunner): this { return this.bindToPath(r); }
	updateFromRail(r: PathRunner): void { this.updateFromPath(r); }
	driveRail(r: PathRunner): void { this.drivePath(r); }
	play(): this { this.playing = true; return this; }
	pause(): this { this.playing = false; return this; }
}
export const TimelineEasings = Easings;
