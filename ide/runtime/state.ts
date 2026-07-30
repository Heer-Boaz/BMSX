import type { Viewport } from '../common/viewport';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { FontVariant } from '../../machine/ts/render/shared/bmsx_font';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { GateGroup } from '../../machine/ts/common/taskgate';
import { taskGate } from '../../machine/ts/common/taskgate';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { Input } from '../../machine/ts/input/manager';
import type {
	ClipboardService,
	HostClock,
	LogOutput,
	MicrotaskQueue,
	StorageService,
} from '../../machine/ts/platform/platform';
import { RuntimeCartEditor, type CartEditor } from '../cart_editor';
import { createRuntimeDebuggerState, type RuntimeDebuggerState } from './debugger_state';
import { createRuntimeFaultState, type RuntimeFaultState } from './fault_state';
import { RuntimeLuaTooling } from './lua_tooling';
import { OverlayRenderer } from './overlay_renderer';
import type { RuntimeSourceState } from './sources';

export const DEFAULT_IDE_FONT_VARIANT: FontVariant = 'tiny';
export type OverlayResolutionMode = 'offscreen' | 'viewport';

export class RuntimeIdeState {
	public readonly editor: CartEditor;
	public readonly overlayRenderer: OverlayRenderer;
	public lastIdeInputFrame = -1;
	public readonly debugger: RuntimeDebuggerState = createRuntimeDebuggerState();
	public shortcutDisposers: Array<() => void> = [];
	public readonly luaGate: GateGroup = taskGate.group('ide:lua');
	public readonly luaTooling: RuntimeLuaTooling;
	public readonly fault: RuntimeFaultState = createRuntimeFaultState();

	public constructor(
		runtime: Runtime,
		presenter: VideoPresenter,
		input: Input,
		audioOutput: HostAudioOutput,
		storage: StorageService,
		clock: HostClock,
		clipboard: ClipboardService,
		microtasks: MicrotaskQueue,
		logOutput: LogOutput,
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		public readonly sources: RuntimeSourceState,
	) {
		this.overlayRenderer = new OverlayRenderer(presenter.hostOverlayQueue);
		this.luaTooling = new RuntimeLuaTooling(runtime, sources);
		this.editor = new RuntimeCartEditor(
			runtime,
			presenter,
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
			this.luaGate,
			this.overlayRenderer,
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
