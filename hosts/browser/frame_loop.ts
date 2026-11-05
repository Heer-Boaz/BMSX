import type { FrameLoop } from '../common/frame_loop';
import type { BrowserVideoOutput } from './video_output';

/** One browser callback owns allocation, drawing and final display fitting.
 * An independent layout rAF could clear an already drawn canvas before paint. */
export class BrowserFrameLoop implements FrameLoop {
	public constructor(private readonly video: BrowserVideoOutput) {}

	public start(tick: (time: number) => void): { stop(): void } {
		let request = 0;
		let alive = true;
		const loop = (time: number) => {
			if (!alive) return;
			this.video.prepareFrame();
			if (!alive) return;
			tick(time);
			if (!alive) return;
			this.video.finishFrame();
			if (!alive) return;
			request = window.requestAnimationFrame(loop);
		};
		request = window.requestAnimationFrame(loop);
		return {
			stop: () => {
				if (!alive) return;
				alive = false;
				window.cancelAnimationFrame(request);
			},
		};
	}
}
