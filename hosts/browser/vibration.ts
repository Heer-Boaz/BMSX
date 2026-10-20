import type { HostClock, TimerHandle } from '../common/clock';

// navigator.vibrate controls one device-wide, binary actuator. Its physical
// pattern entries are limited to ten seconds, not the guest's u32 duration.
const MAX_VIBRATION_PULSE_MS = 10000;

export class BrowserVibration {
	private deadline = 0;
	private timer: TimerHandle = null;
	private readonly continueVibration = (now: number): void => {
		this.timer = null;
		const remaining = this.deadline - now;
		if (remaining <= 0) {
			this.navigator.vibrate(0);
			return;
		}
		this.navigator.vibrate(Math.min(remaining, MAX_VIBRATION_PULSE_MS));
		if (remaining > MAX_VIBRATION_PULSE_MS) {
			this.timer = this.clock.scheduleOnce(MAX_VIBRATION_PULSE_MS, this.continueVibration);
		}
	};

	public constructor(
		private readonly clock: HostClock,
		private readonly navigator: Pick<Navigator, 'vibrate'>,
	) {}

	public setVibration(durationMs: number, intensity: number): void {
		this.timer?.cancel();
		this.timer = null;
		if (durationMs === 0 || intensity === 0) {
			this.navigator.vibrate(0);
			return;
		}
		const now = this.clock.now();
		this.deadline = now + durationMs;
		this.continueVibration(now);
	}
}
