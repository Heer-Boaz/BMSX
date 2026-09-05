const INITIAL_REPEAT_DELAY_FRAMES = 15;
const REPEAT_INTERVAL_FRAMES = 4;

/** Host-time repeat cadence shared by UI input and per-player IDE queries. */
export class ButtonRepeat {
	private active = false;
	private nextRepeatAtMs = 0;
	private lastFrameEvaluated = -1;
	private lastResult = false;

	public reset(): void {
		this.active = false;
		this.nextRepeatAtMs = 0;
		this.lastFrameEvaluated = -1;
		this.lastResult = false;
	}

	public update(pressed: boolean, justPressed: boolean, pressedAtMs: number, now: number, frameDurationMs: number, frameId: number): boolean {
		if (this.lastFrameEvaluated === frameId) return this.lastResult;
		this.lastFrameEvaluated = frameId;
		this.lastResult = justPressed;
		if (!pressed) {
			this.active = false;
			this.nextRepeatAtMs = 0;
		} else {
			if (justPressed || !this.active) {
				this.active = true;
				this.nextRepeatAtMs = pressedAtMs + INITIAL_REPEAT_DELAY_FRAMES * frameDurationMs;
			}
			if (!justPressed && now >= this.nextRepeatAtMs) {
				this.nextRepeatAtMs += REPEAT_INTERVAL_FRAMES * frameDurationMs;
				this.lastResult = true;
			}
		}
		return this.lastResult;
	}
}
