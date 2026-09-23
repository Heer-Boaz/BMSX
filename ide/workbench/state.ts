import type { GraphLayoutEngineFactory } from './services/graph_layout/engine';
import type { HostRewind } from '../../hosts/common/rewind';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import type { EditorDisplay, Viewport } from '../common/viewport';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import type { Clipboard } from '../../hosts/common/clipboard';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { MicrotaskQueue } from '../common/microtask_queue';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import { RuntimeCartEditor, type CartEditor } from '../cart_editor';
import { createRuntimeDebuggerState, resetRuntimeDebuggerExecution, type RuntimeDebuggerState } from '../runtime/debugger_state';
import { clearFaultSnapshot, createRuntimeFaultState, type RuntimeFaultState } from '../runtime/fault_state';
import { RuntimeLuaTooling } from '../runtime/lua_tooling';
import { SuspendedGuestSession } from '../runtime/suspended_guest';
import { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { ScenarioRunService } from './contrib/scenario_lab/run_service';
import { ScenarioTestCollection } from '../testing/scenario/test_collection';
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

export const DEFAULT_IDE_FONT_VARIANT: FontVariant = 'tiny';
export type OverlayResolutionMode = 'offscreen' | 'viewport';

export class RuntimeIdeState {
	public readonly editor: CartEditor;
	public readonly overlayRenderer: OverlayRenderer;
	public lastIdeInputFrame = -1;
	public readonly debugger: RuntimeDebuggerState;
	public shortcutDisposers: Array<() => void> = [];
	public readonly luaTooling: RuntimeLuaTooling;
	public readonly scenarioTests: ScenarioTestCollection;
	public readonly scenarioRuns: ScenarioRunService;
	public readonly textFileSaves: TextFileSaveService;
	public readonly hotResumes: HotResumeService;
	public readonly boots: BootService;
	public readonly diagnostics: ResourceDiagnosticsService;
	public readonly fault: RuntimeFaultState = createRuntimeFaultState();

	public constructor(
		runtime: Runtime,
		presenter: VideoPresenter,
		display: EditorDisplay,
		input: Input,
		audioOutput: HostAudioOutput,
		public readonly runtimeTasks: RuntimeTaskQueue,
		public readonly execution: HostExecutionControl,
		public readonly rewind: HostRewind,
		public readonly storage: KeyValueStorage,
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
	) {
		this.debugger = createRuntimeDebuggerState(runtime, sources);
		this.overlayRenderer = new OverlayRenderer(presenter.hostOverlayQueue);
		this.luaTooling = new RuntimeLuaTooling(
			sources,
			new SuspendedGuestSession(runtime),
		);
		this.scenarioTests = new ScenarioTestCollection(sources);
		this.scenarioRuns = new ScenarioRunService(sources, this.luaTooling, storage, runtime.model, createTestTarget);
		this.textFileSaves = new TextFileSaveService(storage, clock, sources, this.luaTooling, runtime, runtimeTasks);
		this.hotResumes = new HotResumeService(sources, this.luaTooling, this.fault, this.debugger,
			input, runtime, runtimeTasks, storage, workspaceDirtyRecords);
		this.boots = new BootService(sources, this.luaTooling, this.fault, runtime, runtimeTasks,
			execution, audioOutput, storage, workspaceDirtyRecords);
		this.diagnostics = new ResourceDiagnosticsService(editorTextModelService, this.luaTooling, clock);
		this.editor = new RuntimeCartEditor(
			runtime,
			presenter,
			display,
			input,
			audioOutput,
			storage,
			clock,
			clipboard,
			logOutput,
			resourcePanelWidthRatio,
			viewport,
			DEFAULT_IDE_FONT_VARIANT,
			sources,
			this.fault,
			this.luaTooling,
			this.debugger,
			this.runtimeTasks,
			execution,
			rewind,
			this.overlayRenderer,
			this.scenarioTests,
			this.scenarioRuns,
			this.textFileSaves,
			this.hotResumes,
			this.boots,
			this.diagnostics,
			createGraphLayoutEngine,
		);
		this.overlayRenderer.setViewportSize(viewport);
		this.editor.updateViewport(viewport);
		runtime.onStateRestored = () => {
			this.hotResumes.cancelPending('machine-reset');
			this.boots.didReplaceMachine();
			// A restored heap is a new inspection context, not the previous stop.
			this.luaTooling.suspendedGuest.invalidate('heap-replaced');
			resetRuntimeDebuggerExecution(this.debugger);
			clearFaultSnapshot(this.fault);
			this.fault.supervisorFaultSequence = runtime.machine.memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE);
			this.luaTooling.luaInterpreter.clearLastFaultEnvironment();
			clearAllRuntimeErrorOverlays();
			clearHoverTooltip();
			syncRuntimeSourceActivity(this.sources, runtime.machine.cpu.activeCartridgeSlot());
		};
		runtime.onStateReset = runtime.onStateRestored;
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
