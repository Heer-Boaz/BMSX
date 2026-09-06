import type { HostAudioOutput } from './audio_output';

export const enum HostPauseReason {
	Requested = 1 << 0,
	VibrationInitialization = 1 << 1,
	Fullscreen = 1 << 2,
}

/** Execution policy, independent of frame pacing, presentation and focused views. */
export class HostExecutionControl {
	private pauseReasons = 0;
	private elapsedTimeResetPending = false;
	private readonly executionListeners = new Set<() => void>();

	public constructor(private readonly audioOutput: HostAudioOutput) {}

	public get paused(): boolean { return this.pauseReasons !== 0; }
	public get userPaused(): boolean { return (this.pauseReasons & HostPauseReason.Requested) !== 0; }
	public get vibrationInitializationActive(): boolean {
		return (this.pauseReasons & HostPauseReason.VibrationInitialization) !== 0;
	}

	public executionBlocked(explicitStep = false): boolean {
		return (this.pauseReasons & (explicitStep ? ~HostPauseReason.Requested : -1)) !== 0;
	}

	public consumeElapsedTime(hostDeltaMs: number): number {
		if (!this.elapsedTimeResetPending) return hostDeltaMs;
		this.elapsedTimeResetPending = false;
		return 0;
	}

	public setPauseReason(reason: HostPauseReason, active: boolean): void {
		const next = active ? this.pauseReasons | reason : this.pauseReasons & ~reason;
		if (next === this.pauseReasons) return;
		this.pauseReasons = next;
		if (next === 0) this.elapsedTimeResetPending = true;
		this.audioOutput.mutePause(next !== 0);
	}

	/** Explicit Continue/Step, not a view transition. A step retains requested pause. */
	public requestExecution(continueRunning: boolean): void {
		if (continueRunning) this.setPauseReason(HostPauseReason.Requested, false);
		this.elapsedTimeResetPending = true;
		for (const listener of this.executionListeners) listener();
	}

	public onWillExecute(listener: () => void): () => void {
		this.executionListeners.add(listener);
		return () => this.executionListeners.delete(listener);
	}
}
