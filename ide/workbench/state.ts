import type { EditorDisplay, Viewport } from '../common/viewport';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../hosts/common/input/manager';
import type { Clipboard } from '../common/clipboard';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';
import type { MicrotaskQueue } from '../common/microtask_queue';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import { RuntimeCartEditor, type CartEditor } from '../cart_editor';
import { createRuntimeDebuggerState, type RuntimeDebuggerState } from '../runtime/debugger_state';
import { createRuntimeFaultState, type RuntimeFaultState } from '../runtime/fault_state';
import { RuntimeLuaTooling } from '../runtime/lua_tooling';
import { SuspendedGuestSession } from '../runtime/suspended_guest';
import { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeSourceState } from '../runtime/sources';
import { RuntimeTaskQueue } from '../runtime/task_queue';
import { ScenarioRunService } from './contrib/scenario_lab/run_service';
import { ScenarioTestCollection } from '../testing/scenario/test_collection';

export const DEFAULT_IDE_FONT_VARIANT: FontVariant = 'tiny';
export type OverlayResolutionMode = 'offscreen' | 'viewport';

export class RuntimeIdeState {
	public readonly editor: CartEditor;
	public readonly overlayRenderer: OverlayRenderer;
	public lastIdeInputFrame = -1;
	public readonly debugger: RuntimeDebuggerState;
	public shortcutDisposers: Array<() => void> = [];
	public readonly luaTooling: RuntimeLuaTooling;
	public readonly runtimeTasks: RuntimeTaskQueue;
	public readonly scenarioTests: ScenarioTestCollection;
	public readonly scenarioRuns: ScenarioRunService;
	public readonly fault: RuntimeFaultState = createRuntimeFaultState();

	public constructor(
		runtime: Runtime,
		presenter: VideoPresenter,
		display: EditorDisplay,
		input: Input,
		audioOutput: HostAudioOutput,
		public readonly storage: KeyValueStorage,
		clock: HostClock,
		clipboard: Clipboard,
		public readonly microtasks: MicrotaskQueue,
		public readonly logOutput: LogOutput,
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		public readonly sources: RuntimeSourceState,
	) {
		this.debugger = createRuntimeDebuggerState(runtime, sources);
		this.overlayRenderer = new OverlayRenderer(presenter.hostOverlayQueue);
		this.luaTooling = new RuntimeLuaTooling(
			sources,
			new SuspendedGuestSession(runtime),
		);
		this.runtimeTasks = new RuntimeTaskQueue(microtasks, audioOutput);
		this.scenarioTests = new ScenarioTestCollection(sources);
		this.scenarioRuns = new ScenarioRunService(
			runtime,
			sources,
			input,
			audioOutput,
			storage,
			this.fault,
			this.luaTooling,
			this.debugger,
			this.runtimeTasks,
		);
		this.editor = new RuntimeCartEditor(
			runtime,
			presenter,
			display,
			input,
			audioOutput,
			storage,
			clock,
			clipboard,
			microtasks,
			logOutput,
			resourcePanelWidthRatio,
			viewport,
			DEFAULT_IDE_FONT_VARIANT,
			sources,
			this.fault,
			this.luaTooling,
			this.debugger,
			this.runtimeTasks,
			this.overlayRenderer,
			this.scenarioTests,
			this.scenarioRuns,
		);
		this.overlayRenderer.setViewportSize(viewport);
		this.editor.updateViewport(viewport);
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
