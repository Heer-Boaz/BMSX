import { clamp } from '../../machine/ts/common/clamp';
import { HistoryMode, HistorySeekResult, type HistoryOptions } from '../../machine/ts/machine/runtime/history/history';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from './audio_output';
import { LogLevel, type LogOutput } from './log';
import type { RenderPresentationState } from './presentation_state';
import { RuntimeTaskKind, type RuntimeTaskQueue } from './runtime_task_queue';

const enum RewindRequest { None, Seek, Resume, Pause, Play }
const REPLAY_CYCLE_GRANT = 16384;
const REPLAY_WORK_MS = 8;

/** Host operations/output policy. The runtime owns checkpoints and input replay. */
export class HostRewind {
	public active = false;
	public stopped = false;
	private request = RewindRequest.None;
	private requestedCycles = 0;
	private afterSeek = RewindRequest.None;
	private playbackActive = false;
	private playbackTimeResetPending = false;
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
	public get seeking(): boolean { return this.request === RewindRequest.Seek || (this.request !== RewindRequest.Pause && !this.playbackActive && this.runtime.history.mode === HistoryMode.Replaying); }
	public get playing(): boolean { return this.request !== RewindRequest.Pause && (this.playbackActive || this.request === RewindRequest.Play || this.afterSeek === RewindRequest.Play); }
	public get audioMuted(): boolean { return this.active && !this.playbackActive; }
	public get positionCycles(): number {
		if (this.playbackActive) return this.runtime.machine.scheduler.currentNowCycles();
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
		this.afterSeek = RewindRequest.None;
		this.playbackActive = false;
		this.presentationPending = false;
		this.active = true;
		this.stopped = false;
		this.audioOutput.muteRewind(true);
	}

	public returnToPresent(): void {
		if (!this.active) return;
		this.seekTo(this.runtime.history.latestCycles);
		this.afterSeek = RewindRequest.Resume;
	}

	public resumeHere(): void {
		if (this.seeking) this.afterSeek = RewindRequest.Resume;
		else this.request = RewindRequest.Resume;
	}
	public pauseSeek(): void {
		this.request = RewindRequest.Pause;
		this.afterSeek = RewindRequest.None;
	}

	public togglePlayback(): void {
		if (this.playing) this.pauseSeek();
		else if (this.seeking) this.afterSeek = RewindRequest.Play;
		else if (!this.active) {
			this.seekTo(this.runtime.history.latestCycles);
			this.afterSeek = RewindRequest.Play;
		} else this.request = RewindRequest.Play;
	}

	private readonly onError = (error: unknown): void => {
		this.logOutput.log(LogLevel.Error, error instanceof Error ? error.message : String(error));
	};

	private readonly capture = async (): Promise<void> => {
		await this.presenter.backend.captureGxGpuVramSnapshot(this.runtime.machine.gxGpu);
		this.runtime.history.captureCheckpoint();
	};

	private readonly restore = async (): Promise<void> => {
		// Finish callbacks that reference old machine state; discarded VRAM needs no download.
		await this.presenter.backend.finishGxGpuReadbacks();
		// Navigation may change while the submitted readback completes. Only the
		// latest user intent is applied, after all old callbacks have finished.
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
			this.afterSeek = RewindRequest.None;
			this.playbackActive = false;
			this.presentationPending = false;
			this.stopped = false;
			this.audioOutput.muteRewind(false);
			return;
		}
		if (history.mode === HistoryMode.Disabled) {
			this.active = false;
			this.request = RewindRequest.None;
			this.afterSeek = RewindRequest.None;
			this.playbackActive = false;
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
				this.afterSeek = RewindRequest.None;
				this.playbackActive = false;
				this.audioOutput.muteRewind(false);
				break;
			case RewindRequest.Play:
				this.request = RewindRequest.None;
				history.beginPlayback();
				this.playbackActive = history.mode === HistoryMode.Replaying;
				this.playbackTimeResetPending = true;
				this.requestedCycles = runtime.machine.scheduler.currentNowCycles();
				this.stopped = false;
				this.audioOutput.muteRewind(this.audioMuted);
				return;
			case RewindRequest.Pause:
				this.request = RewindRequest.None;
				if (history.mode === HistoryMode.Recording) {
					this.active = false;
				} else {
					history.cancelSeek();
					history.targetCycles = runtime.machine.scheduler.currentNowCycles();
					this.requestedCycles = history.targetCycles;
					this.presentationPending = true;
				}
				this.afterSeek = RewindRequest.None;
				this.playbackActive = false;
				this.audioOutput.muteRewind(this.audioMuted);
				break;
			case RewindRequest.None:
				break;
		}
		if (history.checkpointPending) {
			void this.tasks.schedule(this.capture, this.onError, RuntimeTaskKind.History);
			return;
		}
		if (!this.active || this.playbackActive) return;
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
					this.afterSeek = RewindRequest.None;
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
		if (history.mode === HistoryMode.Reviewing && !this.presentationPending && this.afterSeek !== RewindRequest.None) {
			this.request = this.afterSeek;
			this.afterSeek = RewindRequest.None;
		}
	}

	/** Normal paced execution of recorded input, separate from fast seek reconstruction. */
	public runPlayback(hostDeltaMs: number): void {
		if (!this.playbackActive || !this.tasks.ready) return;
		if (this.playbackTimeResetPending) {
			this.playbackTimeResetPending = false;
			hostDeltaMs = 0;
		}
		const runtime = this.runtime;
		const history = runtime.history;
		const gpu = runtime.machine.gxGpu;
		const previousTick = runtime.frameScheduler.lastTickSequence;
		history.advancePlayback(hostDeltaMs);
		while (gpu.backendServicePending()) {
			if (gpu.backendCommandDrainPending()) this.presenter.backend.executeGxGpuCommandDrain(gpu);
			else this.presenter.backend.executeGxGpuReadback(gpu);
			history.advancePlayback(0);
		}
		this.presentation.syncAfterRuntimeUpdate(runtime, previousTick);
		this.requestedCycles = runtime.machine.scheduler.currentNowCycles();
		if (history.mode === HistoryMode.Reviewing) {
			this.playbackActive = false;
			this.audioOutput.muteRewind(true);
		}
	}
}
