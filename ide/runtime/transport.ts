import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostRewind } from '../../hosts/common/rewind';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { RuntimeFrameNavigation } from './frame_navigation';

/** Playback intent and finite navigation of one explicit physical target. Views own only their focus/projection. */
export class RuntimeTransport {
	private retired = false;
	private retirementListeners: Set<() => void> | undefined;
	public constructor(public readonly runtime: Runtime, public readonly execution: HostExecutionControl,
		public readonly rewind: HostRewind, public readonly navigation: RuntimeFrameNavigation,
		private readonly canControl: () => boolean) {}
	public get state(): 'SEEKING' | 'PAUSED' | 'REPLAY' | 'LIVE' {
		if (this.rewind.seeking) return 'SEEKING';
		if (this.execution.paused || this.rewind.active && !this.rewind.playing) return 'PAUSED';
		return this.rewind.active ? 'REPLAY' : 'LIVE';
	}
	public get available(): boolean { return !this.retired; }
	public get playbackEnabled(): boolean { return !this.retired && this.canControl() && !this.rewind.seeking; }
	public onDidRetire(listener: () => void): () => void {
		const listeners = this.retirementListeners ??= new Set();
		listeners.add(listener);
		return () => listeners.delete(listener);
	}
	public retire(): void {
		if (this.retired) return;
		this.retired = true;
		if (this.retirementListeners !== undefined) {
			for (const listener of this.retirementListeners) listener();
			this.retirementListeners.clear();
		}
	}
	public pause(): void {
		if (this.rewind.active) this.rewind.pauseSeek();
		this.execution.setPauseReason(HostPauseReason.Requested, true);
	}
	public resumeHere(): void {
		if (this.rewind.active) this.rewind.resumeHere();
		this.execution.requestExecution(true);
	}
	/** Reviewing keeps recorded future until the user explicitly chooses Resume Here. */
	public togglePlayback(): boolean {
		const playing = this.state === 'PAUSED';
		if (!playing) this.pause();
		else if (this.rewind.active && this.rewind.positionCycles < this.runtime.history.latestCycles) {
			if (!this.rewind.playing) this.rewind.togglePlayback();
			this.execution.setPauseReason(HostPauseReason.Requested, false);
		} else this.resumeHere();
		return playing;
	}
}
