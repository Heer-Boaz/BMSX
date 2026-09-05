import { clamp } from '../../machine/ts/common/clamp';
import { HistoryMode, HistorySeekResult, type HistoryOptions } from '../../machine/ts/machine/runtime/history/history';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from './audio_output';
import { LogLevel, type LogOutput } from './log';
import type { RenderPresentationState } from './presentation_state';
import { RuntimeTaskKind, type RuntimeTaskQueue } from './runtime_task_queue';

const enum RewindRequest { None, Seek, Resume, Pause }
const REPLAY_CYCLE_GRANT = 16384;
const REPLAY_WORK_MS = 8;

/** Host operations/output policy. The runtime owns checkpoints and input replay. */
export class HostRewind {
	public active = false;
	public stopped = false;
	private request = RewindRequest.None;
	private requestedCycles = 0;
	private resumeAtTarget = false;
	private presentationPending = false;
	private readonly options: HistoryOptions;

	public constructor(
		private readonly runtime: Runtime,
		private readonly presenter: VideoPresenter,
		private readonly presentation: RenderPresentationState,
		public readonly tasks: RuntimeTaskQueue,
		private readonly audioOutput: HostAudioOutput,
		private readonly logOutput: LogOutput,
	) {
		this.options = { checkpointCapacity: 2, inputCapacity: 1024, checkpointIntervalCycles: runtime.timing.cpuHz * 6 };
	}

	public get available(): boolean { return this.runtime.history.checkpointCount !== 0; }
	public get seeking(): boolean { return this.request === RewindRequest.Seek || this.runtime.history.mode === HistoryMode.Replaying; }
	public get positionCycles(): number {
		return this.active ? this.requestedCycles : this.runtime.history.latestCycles;
	}

	public stepCheckpoint(direction: number): void {
		const history = this.runtime.history;
		const position = this.positionCycles;
		if (direction < 0) {
			for (let index = history.checkpointCount - 1; index >= 0; index -= 1) {
				const cycles = history.checkpointCycles(index);
				if (cycles < position) { this.seekTo(cycles); return; }
			}
		} else {
			for (let index = 0; index < history.checkpointCount; index += 1) {
				const cycles = history.checkpointCycles(index);
				if (cycles > position) { this.seekTo(cycles); return; }
			}
		}
	}

	public seekTo(cycles: number): void {
		const history = this.runtime.history;
		this.requestedCycles = clamp(cycles, history.earliestCycles, history.latestCycles);
		this.request = RewindRequest.Seek;
		this.resumeAtTarget = false;
		this.presentationPending = false;
		this.active = true;
		this.stopped = false;
		this.audioOutput.muteRewind(true);
	}

	public returnToPresent(): void {
		if (!this.active) return;
		this.seekTo(this.runtime.history.latestCycles);
		this.resumeAtTarget = true;
	}

	public resumeHere(): void {
		if (this.seeking) this.resumeAtTarget = true;
		else this.request = RewindRequest.Resume;
	}
	public pauseSeek(): void { this.request = RewindRequest.Pause; }

	private readonly onError = (error: unknown): void => {
		this.logOutput.log(LogLevel.Error, error instanceof Error ? error.message : String(error));
	};

	private readonly capture = async (): Promise<void> => {
		await this.presenter.backend.captureGxGpuVramSnapshot(this.runtime.machine.gxGpu);
		this.runtime.history.captureCheckpoint();
	};

	private readonly restore = async (): Promise<void> => {
		// Finish old asynchronous GPU work before replacing its machine state.
		await this.presenter.backend.captureGxGpuVramSnapshot(this.runtime.machine.gxGpu);
		// Navigation may change while the submitted readback completes. Only the
		// latest user intent is applied, after the old backend has finished.
		if (this.request === RewindRequest.Seek) {
			this.request = RewindRequest.None;
			this.runtime.history.beginSeek(this.requestedCycles);
			this.presentationPending = true;
		}
	};

	/** Frame-entry command service; also called after presentation for a newly pending checkpoint. */
	public service(collect: boolean): void {
		if (!this.tasks.ready) return;
		const runtime = this.runtime;
		const history = runtime.history;
		if (!collect) {
			history.stop();
			this.active = false;
			this.request = RewindRequest.None;
			this.resumeAtTarget = false;
			this.presentationPending = false;
			this.stopped = false;
			this.audioOutput.muteRewind(false);
			return;
		}
		if (history.mode === HistoryMode.Disabled) {
			this.active = false;
			this.request = RewindRequest.None;
			this.resumeAtTarget = false;
			this.presentationPending = false;
			this.stopped = false;
			this.audioOutput.muteRewind(false);
			history.start(this.options);
		}
		const gpu = runtime.machine.gxGpu;
		while (gpu.backendServicePending()) {
			if (gpu.backendCommandDrainPending()) this.presenter.backend.executeGxGpuCommandDrain(gpu);
			else this.presenter.backend.executeGxGpuReadback(gpu);
		}
		if (gpu.backendServiceBlocksMachine()) return;
		switch (this.request) {
			case RewindRequest.Seek:
				void this.tasks.schedule(this.restore, this.onError, RuntimeTaskKind.History);
				return;
			case RewindRequest.Resume:
				this.request = RewindRequest.None;
				if (history.mode !== HistoryMode.Recording) history.resumeRecording();
				this.active = false;
				this.resumeAtTarget = false;
				this.audioOutput.muteRewind(false);
				break;
			case RewindRequest.Pause:
				this.request = RewindRequest.None;
				if (history.mode === HistoryMode.Recording) {
					this.active = false;
					this.audioOutput.muteRewind(false);
				} else {
					history.cancelSeek();
					history.targetCycles = runtime.machine.scheduler.currentNowCycles();
					this.requestedCycles = history.targetCycles;
					this.presentationPending = true;
				}
				this.resumeAtTarget = false;
				break;
			case RewindRequest.None:
				break;
		}
		if (history.checkpointPending) {
			void this.tasks.schedule(this.capture, this.onError, RuntimeTaskKind.History);
			return;
		}
		if (!this.active) return;
		if (history.mode === HistoryMode.Replaying) {
			const previousTick = runtime.frameScheduler.lastTickSequence;
			const deadline = performance.now() + REPLAY_WORK_MS;
			while (history.mode === HistoryMode.Replaying) {
				const result = history.advanceSeek(REPLAY_CYCLE_GRANT);
				while (gpu.backendServicePending()) {
					if (gpu.backendCommandDrainPending()) this.presenter.backend.executeGxGpuCommandDrain(gpu);
					else this.presenter.backend.executeGxGpuReadback(gpu);
				}
				if (result === HistorySeekResult.Stopped) {
					history.cancelSeek();
					history.targetCycles = runtime.machine.scheduler.currentNowCycles();
					this.requestedCycles = history.targetCycles;
					this.stopped = true;
					this.resumeAtTarget = false;
				}
				if (result === HistorySeekResult.Complete || result === HistorySeekResult.Stopped) this.presentationPending = true;
				if (gpu.backendServiceBlocksMachine() || performance.now() >= deadline) break;
			}
			runtime.machine.audioController.synchronizeOutput().clear();
			runtime.machine.systemDebugTransmit.clearOutput();
			this.presentation.syncAfterRuntimeUpdate(runtime, previousTick);
		}
		if (this.presentationPending && !gpu.backendServiceBlocksMachine()) {
			this.presentation.requestRestoredPresentation();
			this.presentationPending = false;
		}
		if (history.mode === HistoryMode.Reviewing && !this.presentationPending && this.resumeAtTarget) this.request = RewindRequest.Resume;
	}
}
