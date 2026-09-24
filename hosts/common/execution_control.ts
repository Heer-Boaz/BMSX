import type { HostAudioOutput } from './audio_output';

export const enum HostPauseReason {
	Requested = 1 << 0,
	VibrationInitialization = 1 << 1,
	Fullscreen = 1 << 2,
	AwaitingLaunch = 1 << 3,
	Workbench = 1 << 4,
}

/** Execution policy, independent of frame pacing, presentation and focused views. */
export class HostExecutionControl {
	/** Explicit transport intent, not changes caused by opening/repainting a view. */
	public revision = 0;
	private pauseReasons = 0;
	private elapsedTimeResetPending = false;
	private pendingFrameStep = false;
	private readonly executionListeners = new Set<() => void>();

	public constructor(private readonly audioOutput: HostAudioOutput) {}

	public get paused(): boolean { return this.pauseReasons !== 0; }
	public get userPaused(): boolean { return (this.pauseReasons & HostPauseReason.Requested) !== 0; }
	public get launchPending(): boolean { return (this.pauseReasons & HostPauseReason.AwaitingLaunch) !== 0; }
	public get frameStepPending(): boolean { return this.pendingFrameStep; }
	public get frameStepBlocked(): boolean {
		return (this.pauseReasons & ~(HostPauseReason.Requested | HostPauseReason.Workbench)) !== 0;
	}
	public get vibrationInitializationActive(): boolean {
		return (this.pauseReasons & HostPauseReason.VibrationInitialization) !== 0;
	}

	public executionBlocked(explicitStep = false): boolean {
		let ignored = explicitStep ? HostPauseReason.Requested : 0;
		if (this.pendingFrameStep) ignored |= HostPauseReason.Requested | HostPauseReason.Workbench;
		return (this.pauseReasons & ~ignored) !== 0;
	}

	public consumeElapsedTime(hostDeltaMs: number): number {
		if (!this.elapsedTimeResetPending) return hostDeltaMs;
		this.elapsedTimeResetPending = false;
		return 0;
	}

	public setPauseReason(reason: HostPauseReason, active: boolean): void {
		if (reason === HostPauseReason.Requested) this.revision += 1;
		if (reason === HostPauseReason.Requested && !active) this.pendingFrameStep = false;
		const next = active ? this.pauseReasons | reason : this.pauseReasons & ~reason;
		if (next === this.pauseReasons) return;
		this.pauseReasons = next;
		if (next === 0) this.elapsedTimeResetPending = true;
		this.audioOutput.mutePause(next !== 0);
	}

	/** Explicit Continue/Step, not a view transition. A step retains requested pause. */
	public requestExecution(continueRunning: boolean): void {
		this.revision += 1;
		this.pendingFrameStep = false;
		if (continueRunning) this.setPauseReason(HostPauseReason.Requested, false);
		this.elapsedTimeResetPending = true;
		for (const listener of this.executionListeners) listener();
	}

	/** Advance to the next video boundary, retaining pause while inspecting the result. */
	public requestFrameStep(): void {
		this.setPauseReason(HostPauseReason.Requested, true);
		this.requestExecution(false);
		this.pendingFrameStep = true;
	}

	public finishFrameStep(): void {
		this.pendingFrameStep = false;
	}

	public onWillExecute(listener: () => void): () => void {
		this.executionListeners.add(listener);
		return () => this.executionListeners.delete(listener);
	}
}
