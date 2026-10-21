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
import { createRuntimeFaultState, readSupervisorFaultReport } from '../runtime/fault_state';
import { createSourceExecutionState, runtimeDebuggerExecutionRequested, willExecuteRuntimeDebuggerPlan, didExecuteRuntimeDebuggerPlan,
	didFaultRuntimeDebuggerPlan, discardRuntimeDebuggerPlans, type SourceExecutionState } from '../runtime/debugger_state';
import { RuntimeDebuggerExecution } from '../runtime/debugger_execution';
import { RuntimeFrameNavigation } from '../runtime/frame_navigation';
import { TestDebuggerSources } from '../testing/debugger_sources';
import { createBlua32SourceImage, type Blua32InstalledMedia } from '../runtime/sources';
import { generateUuid } from '../common/uuid';
import { RuntimeTransport } from '../runtime/transport';
import { SuspendedGuestSession } from '../runtime/suspended_guest';
import { PlayEvidence } from './services/play/evidence';
import { PlayFixture, type PlayFixtureBudgets } from '../testing/play_fixture';
import type { PlaySession, PlaySessionFailure, PlaySessionState } from './services/play/session';
import type { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import type { PlayInput } from './services/play/input';
import { ActorExecutionService } from './contrib/actor_lab/execution';

/** Physical play lifetime, not a retained passing case or a second implementation of the machine loop. */
export class PlayRuntimeSession implements PlaySession {
	public readonly fixture: PlayFixture;
	public readonly evidence: PlayEvidence;
	public readonly guest: SuspendedGuestSession;
	public readonly audio: HostAudioOutput;
	public readonly execution: HostExecutionControl;
	public readonly tasks: RuntimeTaskQueue;
	public readonly rewind: HostRewind;
	public readonly frameSession: HostFrameSession;
	public readonly frames;
	public readonly debugger: SourceExecutionState;
	public readonly debugSources: TestDebuggerSources;
	public readonly navigation: RuntimeFrameNavigation;
	public readonly transport: RuntimeTransport;
	public readonly debuggerExecution: RuntimeDebuggerExecution<SourceExecutionState>;
	public readonly actorExecution: ActorExecutionService;
	public readonly currentBlua32Media: Blua32InstalledMedia;
	private readonly fault = createRuntimeFaultState();
	public failure: PlaySessionFailure | undefined;
	private readonly systemOutput = new SystemOutputLog();
	private stopRequested = false;
	private closing = false;
	private closeOperation: Promise<void> | undefined;

	public constructor(public readonly target: OffscreenMachine<PlayInput>, public readonly program: BuiltTestCartridge,
		public readonly sourceDomain: ResourceDomain, device: HostAudioDevice,
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
		const [system, cartridge, companion] = program.debugImages;
		this.currentBlua32Media = {
			system: createBlua32SourceImage(system.image.layout, system.image.symbols, system.sources, -1),
			cartridgeSlots: [createBlua32SourceImage(cartridge.image.layout, cartridge.image.symbols, cartridge.sources, sourceDomain),
				companion === null ? null : createBlua32SourceImage(companion.image.layout, companion.image.symbols, companion.sources, (sourceDomain ^ 1) as 0 | 1)],
		};
		this.debugSources = new TestDebuggerSources(generateUuid(), program, sourceDomain, () => {
			if (this.ready) this.debugger.source.install(this.currentBlua32Media, this.debugSources.pcs);
		});
		this.debugger = createSourceExecutionState(runtime, this.currentBlua32Media, this.debugSources.pcs);
		this.navigation = new RuntimeFrameNavigation(runtime, this.execution, this.rewind, this.tasks, this.debugger, this.fault, this.guest);
		this.debuggerExecution = new RuntimeDebuggerExecution(runtime, this.debugger, this.execution, this.rewind,
			this.tasks, this.fault, this.guest, this.navigation);
		this.actorExecution = new ActorExecutionService(runtime, this, this.guest, this.debugger, this.fault, this.tasks, this.execution, this.rewind);
		this.transport = new RuntimeTransport(runtime, this.execution, this.rewind, this.navigation, () => this.ready && this.tasks.ready
			&& !this.execution.frameStepPending && this.debugger.source.stop === undefined && !this.debugger.plans.controlActive);
		this.evidence = new PlayEvidence(runtime, () => this.fixture.readContext());
		this.fixture = new PlayFixture(target, target.input.fixture, program, sourceDomain, this.evidence, budgets);
		runtime.onStateRestored = origin => {
			this.evidence.didRestore();
			this.debuggerExecution.didReset();
			this.actorExecution.didReplaceMachine();
			discardRuntimeDebuggerPlans(this.debugger);
			this.navigation.didRestore(origin);
			this.guest.invalidate(origin === RuntimeRestoreOrigin.HistorySeek ? 'history-restored' : 'heap-replaced');
			this.debugger.source.reset();
		};
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
				this.navigation.dispose();
				this.debuggerExecution.dispose();
				void this.actorExecution.shutdown();
				discardRuntimeDebuggerPlans(this.debugger);
				this.debugger.source.reset();
				this.target.runtime.machine.cpu.setExecutionHook(null, 0, 0);
				this.fixture.stop();
			}
			if (this.fixture.admitting) {
				this.guest.invalidate();
				for (let grant = 0; grant < 16 && this.fixture.admitting; grant++) {
					this.fixture.advance();
					if (this.fixture.state !== 'initializing') this.evidence.drain();
				}
				if (this.fixture.state === 'ready') {
					this.target.input.interactive = true;
					this.target.runtime.frameScheduler.clearQueuedTime();
					this.execution.setPauseReason(HostPauseReason.AwaitingLaunch, false);
					this.audio.restart(this.target.runtime.timing.ufpsScaled);
					this.debugger.source.install(this.currentBlua32Media, this.debugSources.pcs);
				}
			} else if (this.fixture.state === 'ready') this.advancePlay(hostDeltaMs);
			this.systemOutput.flush(this.target.runtime, this.log);
			this.navigation.afterHostFrame();
			this.debuggerExecution.afterHostFrame();
			this.actorExecution.afterHostFrame();
		} catch (error) {
			this.quarantine({ kind: 'host', error });
		}
	}

	private advancePlay(hostDeltaMs: number): void {
		const runtime = this.target.runtime, presentation = this.target.presentation;
		this.navigation.beforeHostFrame();
		this.debuggerExecution.beforeHostFrame();
		const existingFault = readSupervisorFaultReport(runtime);
		if (existingFault !== undefined) {
			this.quarantine({ kind: 'machine', message: existingFault, cycles: runtime.machine.scheduler.currentNowCycles(), videoTick: runtime.frameScheduler.lastTickSequence });
			return;
		}
		presentation.beginHostFrame();
		if (this.rewind.seeking || this.rewind.playing) this.guest.invalidate();
		const collectHistory = !this.debugger.plans.mutationActive;
		this.rewind.service(collectHistory);
		let executed = false;
		if (this.rewind.playing && !this.execution.executionBlocked()) {
			this.rewind.runPlayback(this.execution.consumeElapsedTime(hostDeltaMs));
			this.frameSession.syncMachineOutput(runtime, this.audio);
		}
		if (this.tasks.ready && !this.rewind.active && !this.execution.executionBlocked(runtimeDebuggerExecutionRequested(this.debugger))
			&& !this.debugger.plans.controlSuspended && this.debugger.source.stop === undefined) {
			if (this.debugger.plans.controlActive) willExecuteRuntimeDebuggerPlan(this.debugger);
			this.guest.invalidate();
			executeHostUpdate(this.frameSession, runtime, this.target.presenter, this.audio, presentation, hostDeltaMs);
			executed = true;
			this.debugger.source.didExecute();
		} else runtime.frameScheduler.clearQueuedTime();
		const fault = readSupervisorFaultReport(runtime);
		if (fault !== undefined) {
			this.quarantine({ kind: 'machine', message: fault, cycles: runtime.machine.scheduler.currentNowCycles(), videoTick: runtime.frameScheduler.lastTickSequence });
		} else if (executed && this.debugger.plans.controlActive) didExecuteRuntimeDebuggerPlan(this.debugger);
		this.target.present();
		if (!this.rewind.active) this.evidence.drain();
		if (this.tasks.ready && (runtime.history.checkpointPending || collectHistory !== !this.debugger.plans.mutationActive)) {
			this.rewind.service(!this.debugger.plans.mutationActive);
		}
	}
	private quarantine(failure: PlaySessionFailure): void {
		this.failure = failure;
		if (failure.kind === 'machine' && this.debugger.plans.controlActive) didFaultRuntimeDebuggerPlan(this.debugger);
		this.navigation.didFault(failure.kind === 'host' ? 'host' : 'guest', failure.kind === 'host' ? String(failure.error) : failure.message);
		this.debuggerExecution.didFault(failure.kind === 'host' ? 'host' : 'guest', failure.kind === 'host' ? String(failure.error) : failure.message);
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
		this.navigation.dispose();
		this.debuggerExecution.dispose();
		const actorsDrained = this.actorExecution.shutdown();
		discardRuntimeDebuggerPlans(this.debugger);
		this.evidence.dispose();
		this.closeOperation = this.close(actorsDrained);
		return this.closeOperation;
	}
	private async close(actorsDrained: Promise<void>): Promise<void> {
		await actorsDrained;
		await this.tasks.join();
		await this.target.backend.finishGxGpuReadbacks();
		this.target.runtime.history.stop();
		this.target.runtime.onStateRestored = undefined;
		this.target.runtime.history.onWillEndReview = undefined;
		this.debugSources.dispose();
		this.fixture.dispose();
	}
}
