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
