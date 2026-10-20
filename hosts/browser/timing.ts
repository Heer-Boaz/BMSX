import type { FrameLoop } from '../common/frame_loop';
import type { HostClock } from '../common/clock';

export class BrowserHostClock implements HostClock {
	now(): number {
		return performance.now();
	}

	dateNow(): number {
		return Date.now();
	}

	scheduleOnce(delayMs: number, cb: (t: number) => void) {
		let active = true;
		const deadline = this.now() + delayMs;
		const tick = () => {
			if (!active) return;
			const now = this.now();
			const remaining = deadline - now;
			if (remaining > 0) {
				id = window.setTimeout(tick, Math.min(remaining, 0x7fffffff));
				return;
			}
			active = false;
			cb(now);
		};
		// Browser timers use signed 32-bit delays; the monotonic deadline retains
		// the full requested delay across timer-sized waits.
		let id = window.setTimeout(tick, Math.min(delayMs, 0x7fffffff));
		return {
			cancel: () => {
				if (!active) return;
				active = false;
				window.clearTimeout(id);
			},
			isActive: () => active,
		};
	}
}

export class BrowserFrameLoop implements FrameLoop {
	start(tick: (t: number) => void): { stop(): void } {
		let req = 0;
		let alive = true;
		const loop = (t: number) => {
			if (!alive) return;
			tick(t);
			if (!alive) return;
			// window.dispatchEvent(new Event('frame'));
			req = window.requestAnimationFrame(loop);
		};
		req = window.requestAnimationFrame(loop);
		return {
			stop: () => {
				if (!alive) return;
				alive = false;
				if (req !== 0) {
					window.cancelAnimationFrame(req);
					req = 0;
				}
			},
		};
	}
}
