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
		const id = window.setTimeout(() => {
			if (!active) return;
			active = false;
			cb(this.now());
		}, delayMs);
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
