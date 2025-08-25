import type { PathRunner } from '../path/pathrunner';
import { EventEmitter } from './eventemitter';

// Generic event timeline supporting instantaneous events and ranged actions keyed either to
// normalized rail progress (u) or accumulated time (seconds). Lightweight forward evaluator.
export interface ETInstant { u?: number; time?: number; name: string; data?: any; fired?: boolean; }
export interface ETRange { startU?: number; endU?: number; startTime?: number; endTime?: number; update: (localT: number, globalU: number, dt: number) => void; done?: boolean; }
export interface EventTimelineOptions { mode?: 'u' | 'time'; loop?: boolean; }

export class EventTimeline extends EventEmitter {
    private instants: ETInstant[] = [];
    private ranges: ETRange[] = [];
    private _mode: 'u' | 'time' = 'u';
    private _u = 0;      // cached last rail u when mode = 'u'
    private _time = 0;   // accumulated time when mode = 'time'
    loop = false;
    playing = true;

    constructor(opts: EventTimelineOptions = {}) { super(); if (opts.mode) this._mode = opts.mode; if (opts.loop) this.loop = opts.loop; }
    get mode() { return this._mode; }
    get u() { return this._u; }
    get time() { return this._time; }

    reset(): void { for (const e of this.instants) e.fired = false; for (const r of this.ranges) r.done = false; this._u = 0; this._time = 0; }

    addInstant(ev: ETInstant): this { if (this._mode === 'u' && ev.u === undefined) throw new Error('Instant requires u in u-mode'); if (this._mode === 'time' && ev.time === undefined) throw new Error('Instant requires time in time-mode'); this.instants.push(ev); this.instants.sort((a, b) => (this._mode === 'u' ? (a.u! - b.u!) : (a.time! - b.time!))); return this; }
    addInstants(list: ETInstant[]): this { for (const e of list) this.addInstant(e); return this; }
    addRange(r: ETRange): this { if (this._mode === 'u') { if (r.startU === undefined || r.endU === undefined) throw new Error('Range needs startU/endU in u-mode'); } else { if (r.startTime === undefined || r.endTime === undefined) throw new Error('Range needs startTime/endTime in time-mode'); } this.ranges.push(r); this.ranges.sort((a, b) => { if (this._mode === 'u') return (a.startU! - b.startU!); else return (a.startTime! - b.startTime!); }); return this; }

    update(dt: number, runner?: PathRunner): void {
        if (!this.playing) return;
        const prevU = this._u, prevT = this._time;
        if (this._mode === 'u') {
            if (!runner) throw new Error('u-mode timeline requires PathRunner');
            this._u = runner.u;
            const looped = this.loop && this._u < prevU;
            // Instants
            for (const ev of this.instants) {
                if (ev.fired) continue; const uVal = ev.u!;
                if (!looped && uVal >= prevU && uVal < this._u) { this.emit(ev.name, ev.data); ev.fired = true; }
                else if (looped && (uVal >= prevU || uVal < this._u)) { this.emit(ev.name, ev.data); ev.fired = true; }
            }
            // Ranges
            for (const r of this.ranges) {
                if (r.done) continue; const a = r.startU!, b = r.endU!; const span = (b - a) || 1; let active = false, local = 0;
                if (!looped) { if (this._u >= a && prevU <= b) { active = true; const clamped = Math.min(this._u, b); local = (clamped - a) / span; if (clamped >= b) r.done = true; } }
                else { if (this._u >= a || prevU <= b) { active = true; if (this._u >= a) local = (this._u - a) / span; else local = (1 - a + this._u) / span; if (this._u >= b && prevU < b) r.done = true; } }
                if (active) r.update(Math.min(1, Math.max(0, local)), this._u, dt);
            }
        } else { // time mode
            this._time += dt; const looped = this.loop && this._time < prevT; // unlikely unless externally reset
            for (const ev of this.instants) {
                if (ev.fired) continue; const tVal = ev.time!;
                if (!looped && tVal >= prevT && tVal < this._time) { this.emit(ev.name, ev.data); ev.fired = true; }
                else if (looped && (tVal >= prevT || tVal < this._time)) { this.emit(ev.name, ev.data); ev.fired = true; }
            }
            for (const r of this.ranges) {
                if (r.done) continue; const a = r.startTime!, b = r.endTime!; const span = (b - a) || 1; let active = false, local = 0;
                if (!looped) { if (this._time >= a && prevT <= b) { active = true; const clamped = Math.min(this._time, b); local = (clamped - a) / span; if (clamped >= b) r.done = true; } }
                else { if (this._time >= a || prevT <= b) { active = true; if (this._time >= a) local = (this._time - a) / span; else local = (1 - a + this._time) / span; if (this._time >= b && prevT < b) r.done = true; } }
                if (active) r.update(Math.min(1, Math.max(0, local)), this._u, dt);
            }
        }
    }
}
