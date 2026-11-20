import type { FrameLoop } from '../../common/frame_loop';
import type { HostClock, MonoTime } from '../../common/clock';
import { GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED } from '../../../machine/ts/machine/devices/gx/gpu_pcrtc';
import { HZ_SCALE } from '../../../machine/ts/spec/bmsx/timing';
import type { VirtualHeadlessClock } from './clock';

export const HEADLESS_DEFAULT_FRAME_INTERVAL_MS =
	1000 * HZ_SCALE / GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED;

export class RealtimeHeadlessFrameLoop implements FrameLoop {
	public constructor(
		private readonly clock: HostClock,
		private readonly stepMs: number,
	) { }

	public start(tick: (t: MonoTime) => void): { stop(): void } {
		let active = true;
		const handle = setInterval(() => {
			if (!active) {
				return;
			}
			tick(this.clock.now());
		}, this.stepMs);
		return {
			stop: () => {
				if (!active) {
					return;
				}
				active = false;
				clearInterval(handle);
			},
		};
	}
}

export class UnpacedHeadlessFrameLoop implements FrameLoop {
	public constructor(
		private readonly clock: VirtualHeadlessClock,
		private readonly stepMs: number,
	) { }

	public start(tick: (t: MonoTime) => void): { stop(): void } {
		let active = true;
		const pump = (): void => {
			if (!active) {
				return;
			}
			this.clock.advance(this.stepMs);
			if (!active) {
				return;
			}
			tick(this.clock.now());
			setImmediate(pump);
		};
		setImmediate(pump);
		return {
			stop: () => {
				active = false;
			},
		};
	}
}

/** Advance on controller demand, not in the gaps between input edges. */
export class SteppedHeadlessFrameLoop implements FrameLoop {
	private tick: ((t: MonoTime) => void) | undefined;
	private pending: NodeJS.Immediate | undefined;

	public constructor(private readonly clock: VirtualHeadlessClock, private readonly stepMs: number) {}

	public start(tick: (t: MonoTime) => void): { stop(): void } {
		this.tick = tick;
		return { stop: () => {
			this.tick = undefined;
			if (this.pending !== undefined) clearImmediate(this.pending);
			this.pending = undefined;
		} };
	}

	public requestFrame(): void {
		if (this.tick === undefined || this.pending !== undefined) return;
		this.pending = setImmediate(this.advance);
	}

	private readonly advance = (): void => {
		this.pending = undefined;
		this.clock.advance(this.stepMs);
		this.tick?.(this.clock.now());
	};
}
