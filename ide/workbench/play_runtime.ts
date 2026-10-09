import { HostAudioOutput } from '../../hosts/common/audio_output';
import type { HostAudioDevice } from '../../hosts/common/audio_device';
import { HostExecutionControl, HostPauseReason } from '../../hosts/common/execution_control';
import { executeHostUpdate } from '../../hosts/common/machine_step';
import { HostFrameSession } from '../../hosts/common/frame_session';
import type { LogOutput } from '../../hosts/common/log';
import { HostRewind } from '../../hosts/common/rewind';
import { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { SystemOutputLog } from '../../hosts/common/system_output_log';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import type { BuiltTestCartridge } from '../../toolchain/ts/rompack/test_cartridge';
import type { ResourceDomain } from '../common/resource';
import { readSupervisorFaultReport } from '../runtime/fault_state';
import { SuspendedGuestSession } from '../runtime/suspended_guest';
import type { FixtureOutput } from '../testing/fixture_operations';
import { PlayFixture, type PlayFixtureBudgets } from '../testing/play_fixture';
import type { PlaySession, PlaySessionFailure, PlaySessionState } from './services/play/session';
import type { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import type { PlayInput } from './services/play/input';

/** Physical play lifetime, not a retained passing case or a second implementation of the machine loop. */
export class PlayRuntimeSession implements PlaySession {
	public readonly fixture: PlayFixture;
	public readonly guest: SuspendedGuestSession;
	public readonly audio: HostAudioOutput;
	public readonly execution: HostExecutionControl;
	public readonly tasks: RuntimeTaskQueue;
	public readonly rewind: HostRewind;
	public readonly frameSession: HostFrameSession;
	public readonly frames;
	public failure: PlaySessionFailure | undefined;
	private readonly systemOutput = new SystemOutputLog();
	private stopRequested = false;
	private closing = false;
	private closeOperation: Promise<void> | undefined;

	public constructor(public readonly target: OffscreenMachine<PlayInput>, public readonly program: BuiltTestCartridge,
		public readonly sourceDomain: ResourceDomain, device: HostAudioDevice, output: FixtureOutput,
		private readonly log: LogOutput, budgets?: PlayFixtureBudgets) {
		const runtime = target.runtime;
		this.frames = target.frameOutput;
		this.guest = new SuspendedGuestSession(runtime);
		this.audio = new HostAudioOutput(device, runtime.machine.audioController, runtime.timing.ufpsScaled);
		this.execution = new HostExecutionControl(this.audio);
		this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, true);
		this.tasks = new RuntimeTaskQueue(this.audio, target.presenter);
		this.rewind = new HostRewind(runtime, target.presenter, target.presentation, this.tasks, this.audio, log);
		this.frameSession = new HostFrameSession(runtime.timing.ufpsScaled, 0, this.rewind, this.execution);
		this.fixture = new PlayFixture(target, target.input.fixture, program, sourceDomain, output, budgets);
		runtime.onStateRestored = origin => this.guest.invalidate(origin === RuntimeRestoreOrigin.HistorySeek ? 'history-restored' : 'heap-replaced');
		runtime.history.onWillEndReview = () => this.guest.willEndHistoryReview();
	}
	public get input(): PlayInput { return this.target.input; }
	public get state(): PlaySessionState {
		return this.fixture.state === 'closed' ? 'closed' : this.closing ? 'closing' : this.failure !== undefined ? 'faulted' : this.fixture.state;
	}
	public get ready(): boolean { return this.state === 'ready' && !this.stopRequested; }

	/** Host entry calls once after physical input routing. Admission time is never gameplay elapsed time. */
	public advance(hostDeltaMs: number): void {
		if (this.closing || this.failure !== undefined || this.fixture.state === 'closed') return;
		try {
			if (this.tasks.failure !== undefined) throw this.tasks.failure.error;
			if (!this.tasks.ready) return;
			if (this.stopRequested) {
				this.stopRequested = false;
				this.guest.invalidate();
				this.rewind.service(false);
				this.fixture.stop();
			}
			if (this.fixture.admitting) {
				this.guest.invalidate();
				for (let grant = 0; grant < 16 && this.fixture.admitting; grant++) this.fixture.advance();
				if (this.fixture.state === 'ready') {
					this.target.input.interactive = true;
					this.target.runtime.frameScheduler.clearQueuedTime();
					this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, false);
					this.audio.restart(this.target.runtime.timing.ufpsScaled);
				}
			} else if (this.fixture.state === 'ready') this.advancePlay(hostDeltaMs);
			this.systemOutput.flush(this.target.runtime, this.log);
		} catch (error) {
			this.quarantine({ kind: 'host', error });
		}
	}

	private advancePlay(hostDeltaMs: number): void {
		const runtime = this.target.runtime, presentation = this.target.presentation;
		const existingFault = readSupervisorFaultReport(runtime);
		if (existingFault !== undefined) {
			this.quarantine({ kind: 'machine', message: existingFault, cycles: runtime.machine.scheduler.currentNowCycles(), videoTick: runtime.frameScheduler.lastTickSequence });
			return;
		}
		presentation.clearPresentation();
		if (this.rewind.seeking || this.rewind.playing) this.guest.invalidate();
		this.rewind.service(true);
		if (this.rewind.playing && !this.execution.executionBlocked()) {
			this.rewind.runPlayback(this.execution.consumeElapsedTime(hostDeltaMs));
			this.frameSession.syncMachineOutput(runtime, this.audio);
		}
		if (this.tasks.ready && !this.rewind.active && !this.execution.executionBlocked()) {
			this.guest.invalidate();
			executeHostUpdate(this.frameSession, runtime, this.target.presenter, this.audio, presentation, hostDeltaMs);
		} else runtime.frameScheduler.clearQueuedTime();
		const fault = readSupervisorFaultReport(runtime);
		if (fault !== undefined) {
			this.quarantine({ kind: 'machine', message: fault, cycles: runtime.machine.scheduler.currentNowCycles(), videoTick: runtime.frameScheduler.lastTickSequence });
		}
		this.target.present();
		if (this.tasks.ready && runtime.history.checkpointPending) this.rewind.service(true);
	}
	private quarantine(failure: PlaySessionFailure): void {
		this.failure = failure;
		this.execution.finishFrameStep();
		this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, true);
		this.target.input.interactive = false;
		this.guest.invalidate();
	}

	/** Explicit Stop runs bounded cleanup. A quarantined fault is retained, never unwound into invented cleanup. */
	public stop(): void {
		if (this.closing || this.failure !== undefined || this.fixture.state === 'closed' || this.fixture.state === 'failed' || this.fixture.state === 'stopped') return;
		this.stopRequested = true;
		this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, true);
		this.target.input.interactive = false;
	}

	/** Forced lifetime close admits no more guest work and releases the target only after owned callbacks finish. */
	public dispose(): Promise<void> {
		if (this.closeOperation !== undefined) return this.closeOperation;
		this.closing = true;
		this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, true);
		this.target.input.interactive = false;
		this.target.input.dispose();
		this.audio.dispose();
		this.guest.invalidate('heap-replaced');
		this.closeOperation = this.close();
		return this.closeOperation;
	}
	private async close(): Promise<void> {
		await this.tasks.join();
		await this.target.backend.finishGxGpuReadbacks();
		this.target.runtime.history.stop();
		this.target.runtime.onStateRestored = undefined;
		this.target.runtime.history.onWillEndReview = undefined;
		this.fixture.dispose();
	}
}
