import type { HostClock, MonoTime, TimerHandle } from '../../common/clock';

export class RealtimeHeadlessClock implements HostClock {
	private readonly origin = performance.now();

	public scheduleOnce(delayMs: number, cb: (t: MonoTime) => void): TimerHandle {
		let active = true;
		const handle = setTimeout(() => {
			if (!active) {
				return;
			}
			active = false;
			cb(this.now());
		}, delayMs);
		return {
			cancel: () => {
				if (!active) {
					return;
				}
				active = false;
				clearTimeout(handle);
			},
			isActive: () => active,
		};
	}

	public now(): MonoTime {
		return performance.now() - this.origin;
	}

	public readonly dateNow = Date.now;
}

type VirtualTimer = {
	dueMs: number;
	cb: (t: MonoTime) => void;
	active: boolean;
};

export class VirtualHeadlessClock implements HostClock {
	private currentMs = 0;
	private readonly epochMs = Date.now();
	private readonly timers: VirtualTimer[] = [];

	public scheduleOnce(delayMs: number, cb: (t: MonoTime) => void): TimerHandle {
		const timer: VirtualTimer = {
			dueMs: this.currentMs + delayMs,
			cb,
			active: true,
		};
		this.timers.push(timer);
		return {
			cancel: () => {
				timer.active = false;
			},
			isActive: () => timer.active,
		};
	}

	public advance(stepMs: number): void {
		this.currentMs += stepMs;
		for (;;) {
			let dueIndex = -1;
			let dueMs = Infinity;
			for (let index = 0; index < this.timers.length; index += 1) {
				const timer = this.timers[index];
				if (!timer.active || timer.dueMs > this.currentMs) {
					continue;
				}
				if (timer.dueMs < dueMs) {
					dueMs = timer.dueMs;
					dueIndex = index;
				}
			}
			if (dueIndex < 0) {
				break;
			}
			const timer = this.timers[dueIndex];
			timer.active = false;
			timer.cb(this.currentMs);
		}

		let writeIndex = 0;
		for (let readIndex = 0; readIndex < this.timers.length; readIndex += 1) {
			const timer = this.timers[readIndex];
			if (!timer.active) {
				continue;
			}
			this.timers[writeIndex] = timer;
			writeIndex += 1;
		}
		this.timers.length = writeIndex;
	}

	public now(): MonoTime {
		return this.currentMs;
	}

	public dateNow(): number {
		return this.epochMs + Math.round(this.currentMs);
	}
}
