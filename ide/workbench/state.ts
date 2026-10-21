import type { ConversationObserverFactory } from '../../hosts/common/conversation_observer';
import { ActorExecutionService } from './contrib/actor_lab/execution';
import { RuntimeDebuggerExecution } from '../runtime/debugger_execution';
import { RuntimeFrameNavigation } from '../runtime/frame_navigation';
import type { GameImageCapture, ImageDecoder } from '../../hosts/common/image';
import type { AssistantConnectionFactory } from '../../hosts/common/assistant_protocol';
import type { GraphLayoutEngineFactory } from './services/graph_layout/engine';
import type { HostRewind } from '../../hosts/common/rewind';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import type { EditorDisplay, Viewport } from '../common/viewport';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import type { Clipboard } from '../../hosts/common/clipboard';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { MicrotaskQueue } from '../common/microtask_queue';
import { RuntimeCartEditor, type CartEditor } from '../cart_editor';
import { createRuntimeDebuggerState, resetRuntimeDebuggerExecution, type RuntimeDebuggerState } from '../runtime/debugger_state';
import { clearFaultSnapshot, createRuntimeFaultState, type RuntimeFaultState } from '../runtime/fault_state';
import { SuspendedGuestSession, type GuestInvalidationReason } from '../runtime/suspended_guest';
import { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { ScenarioRunService } from './services/testing/scenario_runs';
import { PlayService } from './services/play/service';
import type { PlaySessionFactory } from './services/play/session';
import type { TestTargetFactory } from '../testing/target';
import { TextFileSaveService } from './services/working_copy/text_file_save';
import { HotResumeService } from './services/execution/hot_resume';
import { BootService } from './services/execution/boot';
import { ResourceDiagnosticsService } from './services/diagnostics/resource_diagnostics';
import { editorTextModelService } from '../editor/model/model_service';
import type { WorkspaceRecord } from '../workspace/records';
import { IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../machine/ts/spec/bmsx/io';
import { syncRuntimeSourceActivity } from '../runtime/sources';
import { clearAllRuntimeErrorOverlays } from '../runtime_error/navigation';
import { clearHoverTooltip } from '../editor/contrib/hover/controller';
import { RuntimeLuaEvaluation } from '../runtime/lua_evaluation';
import { RuntimeInspectionService } from '../runtime/inspection';
import { RuntimeEventHistory } from '../runtime/event_history';
import { RuntimeGteHistory } from '../runtime/gte_history';

export const DEFAULT_IDE_FONT_VARIANT: FontVariant = 'tiny';
export type OverlayResolutionMode = 'offscreen' | 'viewport';

export class RuntimeIdeState {
	public readonly editor: CartEditor;
	public readonly overlayRenderer: OverlayRenderer;
	public lastIdeInputFrame = -1;
	public readonly debugger: RuntimeDebuggerState;
	public readonly events: RuntimeEventHistory;
	public readonly gte: RuntimeGteHistory;
	public shortcutDisposers: Array<() => void> = [];
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
	public readonly fault: RuntimeFaultState = createRuntimeFaultState();

	public constructor(
		runtime: Runtime,
		presenter: VideoPresenter,
		public readonly gameCapture: GameImageCapture,
		decodeImage: ImageDecoder,
		display: EditorDisplay,
		input: Input,
		audioOutput: HostAudioOutput,
		public readonly runtimeTasks: RuntimeTaskQueue,
		public readonly execution: HostExecutionControl,
		public readonly rewind: HostRewind,
		clock: HostClock,
		clipboard: Clipboard,
		public readonly microtasks: MicrotaskQueue,
		public readonly logOutput: LogOutput,
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		public readonly sources: RuntimeSourceState,
		workspaceDirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
		createGraphLayoutEngine: GraphLayoutEngineFactory,
		createTestTarget: TestTargetFactory,
		createPlaySession: PlaySessionFactory,
		connectAssistant?: AssistantConnectionFactory,
		observeConversation?: ConversationObserverFactory,
	) {
		this.events = new RuntimeEventHistory(runtime, sources);
		this.gte = new RuntimeGteHistory(runtime, sources);
		this.debugger = createRuntimeDebuggerState(runtime, sources);
		this.overlayRenderer = new OverlayRenderer(presenter.hostOverlayQueue);
		this.guest = new SuspendedGuestSession(runtime);
		this.scenarioRuns = new ScenarioRunService(editorTextModelService, sources, workspaceDirtyRecords, runtime.model, createTestTarget);
		this.play = new PlayService(editorTextModelService, sources, workspaceDirtyRecords, runtime.model, input, createPlaySession);
		this.textFileSaves = new TextFileSaveService(editorTextModelService, clock, sources, this.guest, runtime, runtimeTasks);
		this.hotResumes = new HotResumeService(editorTextModelService, sources, this.guest, this.fault, this.debugger,
			input, runtime, runtimeTasks, execution, workspaceDirtyRecords);
		this.hotResumes.onDidApply = () => { this.events.beginTimeline(); this.gte.didInstall(); };
		this.boots = new BootService(editorTextModelService, sources, this.fault, runtime, runtimeTasks,
			execution, audioOutput, workspaceDirtyRecords);
		this.diagnostics = new ResourceDiagnosticsService(editorTextModelService, sources, clock);
		this.luaEvaluation = new RuntimeLuaEvaluation(runtime, sources, this.guest, this.debugger,
			this.fault, runtimeTasks, execution, rewind);
		this.actorExecution = new ActorExecutionService(runtime, sources, this.guest, this.debugger, this.fault, runtimeTasks, execution, rewind);
		this.frameNavigation = new RuntimeFrameNavigation(runtime, execution, rewind, runtimeTasks, this.debugger, this.fault, this.guest);
		this.debuggerExecution = new RuntimeDebuggerExecution(runtime, this.debugger, execution, rewind, runtimeTasks, this.fault, this.guest, this.frameNavigation);
		this.inspection = new RuntimeInspectionService(runtime, sources, this.guest, this.debugger,
			execution, runtimeTasks, rewind, this.fault, this.frameNavigation, this.debuggerExecution);
		this.editor = new RuntimeCartEditor(
			runtime,
			presenter,
			display,
			input,
			audioOutput,
			clock,
			clipboard,
			logOutput,
			resourcePanelWidthRatio,
			viewport,
			DEFAULT_IDE_FONT_VARIANT,
			sources,
			this.fault,
			this.guest,
			this.debugger,
			this.events,
			this.gte,
			this.runtimeTasks,
			execution,
			rewind,
			this.overlayRenderer,
			this.scenarioRuns,
			this.play,
			this.textFileSaves,
			this.hotResumes,
			this.boots,
			this.diagnostics,
			this.luaEvaluation,
			this.actorExecution,
			this.inspection,
			this.frameNavigation,
			this.debuggerExecution,
			this.gameCapture,
			decodeImage,
			createGraphLayoutEngine,
			connectAssistant,
			observeConversation,
		);
		this.overlayRenderer.setViewportSize(viewport);
		this.editor.updateViewport(viewport);
		const invalidateToolingState = (reason: GuestInvalidationReason) => {
			this.debuggerExecution.didReset();
			this.luaEvaluation.didReplaceMachine();
			this.editor.terminal.discard();
			this.actorExecution.didReplaceMachine();
			this.hotResumes.cancelPending('machine-reset');
			this.boots.didReplaceMachine();
			// A restored heap is a new inspection context, not the previous stop.
			this.guest.invalidate(reason);
			resetRuntimeDebuggerExecution(this.debugger);
			clearFaultSnapshot(this.fault);
			this.fault.hostFrameFailure = undefined;
			this.fault.supervisorFaultSequence = runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE);
			clearAllRuntimeErrorOverlays();
			clearHoverTooltip();
			syncRuntimeSourceActivity(this.sources, runtime.machine.cpu.activeCartridgeSlot());
		};
		runtime.onStateRestored = origin => {
			this.events.didRestore(origin);
			this.gte.didRestore(origin);
			this.frameNavigation.didRestore(origin);
			invalidateToolingState(origin === RuntimeRestoreOrigin.HistorySeek ? 'history-restored' : 'heap-replaced');
		};
		runtime.history.onWillResumeRecording = branched => {
			if (branched) { this.events.beginTimeline(); this.gte.beginTimeline(); }
		};
		runtime.history.onWillEndReview = () => this.guest.willEndHistoryReview();
		runtime.onStateReset = () => {
			this.events.beginTimeline();
			this.gte.didInstall();
			this.frameNavigation.didReset();
			invalidateToolingState('heap-replaced');
		};
	}
}

export function setOverlayResolutionMode(
	renderer: OverlayRenderer,
	editor: CartEditor,
	presenter: VideoPresenter,
	value: OverlayResolutionMode,
): void {
	renderer.setRenderingViewportType(presenter, value);
	editor.updateViewport(renderer.viewportSize);
}
