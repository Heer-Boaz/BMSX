import type { RailPath, RailRunner } from './railpath';

export interface RailDeterministicOptions {
    totalDuration: number; // seconds
    fixedStep?: number; // simulation step (seconds) default 1/60
}

// Deterministic controller mapping elapsed fixed time to runner.u (0..1)
export class RailDeterministicPlayer {
    private runner: RailRunner;
    private rail: RailPath;
    private opts: RailDeterministicOptions;
    private accumulator = 0;
    private elapsedFixed = 0;
    private wallClock = 0;
    private pausedUntil = 0;
    timeScale = 1; // modified by events via external listeners if desired

    constructor(runner: RailRunner, rail: RailPath, opts: RailDeterministicOptions) {
        this.runner = runner; this.rail = rail; this.opts = { fixedStep: 1 / 60, ...opts };
        // Optional: listen to rail events for pause / resume (consumer may also manage)
        rail.on('rail.pause', (d: any) => { const dur = d?.duration ?? 0; this.pausedUntil = this.wallClock + dur; }, this);
        rail.on('rail.resume', () => { this.pausedUntil = this.wallClock; }, this);
    }

    reset(): void { this.accumulator = 0; this.elapsedFixed = 0; this.wallClock = 0; this.runner.u = 0; }

    update(dt: number): void {
        if (this.runner.u >= 1) return; // finished
        const scaled = dt * this.timeScale;
        this.wallClock += scaled;
        if (this.wallClock < this.pausedUntil) return;
        this.accumulator += scaled;
        const step = this.opts.fixedStep!;
        while (this.accumulator >= step && this.runner.u < 1) {
            this.accumulator -= step;
            this.elapsedFixed += step;
            const prev = this.runner.u;
            const u = Math.min(1, this.elapsedFixed / this.opts.totalDuration);
            if (u !== prev) { this.runner.rail.updateAndFire(prev, u); this.runner.u = u; }
        }
    }
}
