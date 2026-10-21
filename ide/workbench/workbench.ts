import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { HostClock } from '../../hosts/common/clock';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import type { GameImageCapture } from '../../hosts/common/image';
import type { Input } from '../../hosts/common/input/manager';
import { LogLevel, type LogOutput } from '../../hosts/common/log';
import type { HostRewind } from '../../hosts/common/rewind';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { clearBackgroundTasks } from '../common/background_tasks';
import type { MicrotaskQueue } from '../common/microtask_queue';
import type { EditorTextModelService } from '../editor/model/model_service';
import { createRuntimeDebuggerState, discardRuntimeDebuggerPlans, resetRuntimeDebuggerExecution, type RuntimeDebuggerState } from '../runtime/debugger_state';
import { RuntimeDebuggerExecution } from '../runtime/debugger_execution';
import { RuntimeEventHistory } from '../runtime/event_history';
import { clearFaultSnapshot, createRuntimeFaultState } from '../runtime/fault_state';
import { RuntimeFrameNavigation } from '../runtime/frame_navigation';
import { RuntimeGpuHistory } from '../runtime/gpu_history';
import { RuntimeGteHistory } from '../runtime/gte_history';
import { RuntimeInspectionService } from '../runtime/inspection';
import { RuntimeLuaEvaluation } from '../runtime/lua_evaluation';
import { seedDefaultLuaBuiltins } from '../runtime/lua_builtins';
import { syncRuntimeSourceActivity, type RuntimeSourceState } from '../runtime/sources';
import { SuspendedGuestSession, type GuestInvalidationReason } from '../runtime/suspended_guest';
import type { TestTargetFactory } from '../testing/target';
import type { WorkspaceRecord } from '../workspace/records';
import { ActorExecutionService } from './contrib/actor_lab/execution';
import { BehaviorSourceDocuments } from './contrib/behavior_lens/source_documents';
import { WorkspaceToolService } from './services/assistant/tool_service';
import { ResourceDiagnosticsService } from './services/diagnostics/resource_diagnostics';
import { BootService } from './services/execution/boot';
import { HotResumeService } from './services/execution/hot_resume';
import { PlayService } from './services/play/service';
import type { PlaySessionFactory } from './services/play/session';
import { ScenarioRunService } from './services/testing/scenario_runs';
import { TextFileSaveService } from './services/working_copy/text_file_save';

export type StudioWorkbenchOptions = {
	readonly runtime: Runtime;
	readonly input: Input;
	readonly audioOutput: HostAudioOutput;
	readonly runtimeTasks: RuntimeTaskQueue;
	readonly execution: HostExecutionControl;
	readonly rewind: HostRewind;
	readonly clock: HostClock;
	readonly microtasks: MicrotaskQueue;
	readonly logOutput: LogOutput;
	readonly sources: RuntimeSourceState;
	readonly models: EditorTextModelService;
	readonly workspaceDirtyRecords: ReadonlyMap<string, WorkspaceRecord>;
	readonly gameCapture: GameImageCapture;
	readonly createTestTarget: TestTargetFactory;
	readonly createPlaySession: PlaySessionFactory;
};

/** One workspace and physical target. Frontends observe it; they do not own its services. */
export class StudioWorkbench {
	public readonly runtime: Runtime;
	public readonly sources: RuntimeSourceState;
	public readonly models: EditorTextModelService;
	public readonly runtimeTasks: RuntimeTaskQueue;
	public readonly execution: HostExecutionControl;
	public readonly rewind: HostRewind;
	public readonly gameCapture: GameImageCapture;
	public readonly microtasks: MicrotaskQueue;
	public readonly logOutput: LogOutput;
	public readonly debugger: RuntimeDebuggerState;
	public readonly events: RuntimeEventHistory;
	public readonly gte: RuntimeGteHistory;
	public readonly gpu: RuntimeGpuHistory;
	public readonly guest: SuspendedGuestSession;
	public readonly scenarioRuns: ScenarioRunService;
	public readonly play: PlayService;
	public readonly textFileSaves: TextFileSaveService;
	public readonly hotResumes: HotResumeService;
	public readonly boots: BootService;
	public readonly diagnostics: ResourceDiagnosticsService;
	public readonly luaEvaluation: RuntimeLuaEvaluation;
	public readonly actorExecution: ActorExecutionService;
	public readonly inspection: RuntimeInspectionService;
	public readonly frameNavigation: RuntimeFrameNavigation;
	public readonly debuggerExecution: RuntimeDebuggerExecution;
	public readonly behaviorSources: BehaviorSourceDocuments;
	public readonly tools: WorkspaceToolService;
	public readonly fault = createRuntimeFaultState();
	public readonly frame = { outputDrained: false, collectingHistory: true };
	public readonly clock: HostClock;
	private readonly replacedListeners = new Set<(reason: GuestInvalidationReason) => void>();
	private readonly stopListeners = new Set<() => void>();
	private readonly hostFailureListeners = new Set<(stack: string) => void>();
	private shutdownOperation: Promise<void> | undefined;

	public constructor(options: StudioWorkbenchOptions) {
		const { runtime, input, audioOutput, runtimeTasks, execution, rewind, clock, microtasks, logOutput,
			sources, models, workspaceDirtyRecords, gameCapture, createTestTarget, createPlaySession } = options;
		this.runtime = runtime;
		this.sources = sources;
		this.models = models;
		this.runtimeTasks = runtimeTasks;
		this.execution = execution;
		this.rewind = rewind;
		this.clock = clock;
		this.microtasks = microtasks;
		this.logOutput = logOutput;
		this.gameCapture = gameCapture;
		seedDefaultLuaBuiltins();
		this.events = new RuntimeEventHistory(runtime, sources);
		this.gte = new RuntimeGteHistory(runtime, sources);
		this.gpu = new RuntimeGpuHistory(runtime);
		this.debugger = createRuntimeDebuggerState(runtime, sources);
		this.guest = new SuspendedGuestSession(runtime);
		this.scenarioRuns = new ScenarioRunService(models, sources, workspaceDirtyRecords, runtime.model, createTestTarget);
		this.play = new PlayService(models, sources, workspaceDirtyRecords, runtime.model, input, createPlaySession);
		this.textFileSaves = new TextFileSaveService(models, clock, sources, this.guest, runtime, runtimeTasks);
		this.hotResumes = new HotResumeService(models, sources, this.guest, this.fault, this.debugger,
			input, runtime, runtimeTasks, execution, workspaceDirtyRecords);
		this.hotResumes.onDidApply = () => { this.events.beginTimeline(); this.gte.didInstall(); this.gpu.didInstall(); };
		this.boots = new BootService(models, sources, this.fault, runtime, runtimeTasks, execution, audioOutput, workspaceDirtyRecords);
		this.diagnostics = new ResourceDiagnosticsService(models, sources, clock);
		this.luaEvaluation = new RuntimeLuaEvaluation(runtime, sources, this.guest, this.debugger, this.fault, runtimeTasks, execution, rewind);
		this.actorExecution = new ActorExecutionService(runtime, sources, this.guest, this.debugger, this.fault, runtimeTasks, execution, rewind);
		this.frameNavigation = new RuntimeFrameNavigation(runtime, execution, rewind, runtimeTasks, this.debugger, this.fault, this.guest);
		this.debuggerExecution = new RuntimeDebuggerExecution(runtime, this.debugger, execution, rewind, runtimeTasks, this.fault, this.guest, this.frameNavigation);
		this.inspection = new RuntimeInspectionService(runtime, sources, this.guest, this.debugger, execution, runtimeTasks,
			rewind, this.fault, this.frameNavigation, this.debuggerExecution);
		this.behaviorSources = new BehaviorSourceDocuments(models, sources);
		this.tools = new WorkspaceToolService(models, sources, this.diagnostics, this.scenarioRuns, this.inspection,
			this.frameNavigation, gameCapture, this.luaEvaluation, this.debuggerExecution, this.actorExecution,
			this.behaviorSources, this.textFileSaves, this.boots, this.hotResumes, this.events, this.gte, this.gpu, clock);
		runtime.onStateRestored = origin => {
			this.events.didRestore(origin);
			this.gte.didRestore(origin);
			this.gpu.didRestore(origin);
			this.frameNavigation.didRestore(origin);
			this.didReplaceMachine(origin === RuntimeRestoreOrigin.HistorySeek ? 'history-restored' : 'heap-replaced');
		};
		runtime.history.onWillResumeRecording = branched => {
			if (branched) { this.events.beginTimeline(); this.gte.beginTimeline(); this.gpu.beginTimeline(); }
		};
		runtime.history.onWillEndReview = () => this.guest.willEndHistoryReview();
		runtime.onStateReset = () => {
			this.events.beginTimeline();
			this.gte.didInstall(); this.gpu.didInstall();
			this.frameNavigation.didReset();
			this.didReplaceMachine('heap-replaced');
		};
	}

	public onDidReplaceMachine(listener: (reason: GuestInvalidationReason) => void): () => void {
		this.replacedListeners.add(listener);
		return () => this.replacedListeners.delete(listener);
	}
	public onDidStop(listener: () => void): () => void {
		this.stopListeners.add(listener);
		return () => this.stopListeners.delete(listener);
	}
	public onDidFailHostFrame(listener: (stack: string) => void): () => void {
		this.hostFailureListeners.add(listener);
		return () => this.hostFailureListeners.delete(listener);
	}

	private didReplaceMachine(reason: GuestInvalidationReason): void {
		this.debuggerExecution.didReset();
		this.luaEvaluation.didReplaceMachine();
		this.actorExecution.didReplaceMachine();
		this.hotResumes.cancelPending('machine-reset');
		this.boots.didReplaceMachine();
		this.guest.invalidate(reason);
		resetRuntimeDebuggerExecution(this.debugger);
		clearFaultSnapshot(this.fault);
		this.fault.hostFrameFailure = undefined;
		this.fault.supervisorFaultSequence = this.runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE);
		syncRuntimeSourceActivity(this.sources, this.runtime.machine.cpu.activeCartridgeSlot());
		for (const listener of this.replacedListeners) listener(reason);
	}

	/** The physical stop is settled even when no frontend wants to reveal it. */
	public publishDebuggerStop(): void {
		this.execution.finishFrameStep();
		this.debugger.stopPresentationPending = false;
		for (const listener of this.stopListeners) listener();
	}

	public failHostFrame(error: unknown): void {
		const stack = error instanceof Error ? error.stack ?? error.toString() : String(error);
		this.fault.hostFrameFailure = stack;
		this.hotResumes.failPending(error);
		this.boots.failPending(error);
		this.logOutput.log(LogLevel.Error, stack);
		for (const listener of this.hostFailureListeners) listener(stack);
	}


	public shutdown(): Promise<void> {
		if (this.shutdownOperation === undefined) this.shutdownOperation = this.close();
		return this.shutdownOperation;
	}
	private async close(): Promise<void> {
		this.tools.dispose();
		this.events.dispose(); this.gte.dispose(); this.gpu.dispose();
		this.frameNavigation.dispose(); this.debuggerExecution.dispose();
		const evaluationDrained = this.luaEvaluation.shutdown(), actorsDrained = this.actorExecution.shutdown();
		this.scenarioRuns.dispose();
		const playDrained = this.play.dispose();
		this.diagnostics.dispose();
		const executionDrained = this.hotResumes.shutdown(), bootsDrained = this.boots.shutdown();
		discardRuntimeDebuggerPlans(this.debugger);
		await this.textFileSaves.shutdown();
		await executionDrained; await bootsDrained; await evaluationDrained; await actorsDrained; await playDrained;
		this.runtime.onStateRestored = undefined;
		this.runtime.onStateReset = undefined;
		this.runtime.history.onWillResumeRecording = undefined;
		this.runtime.history.onWillEndReview = undefined;
		this.replacedListeners.clear(); this.stopListeners.clear(); this.hostFailureListeners.clear();
		clearBackgroundTasks();
	}
}
