import type { ConversationObserverFactory } from '../../hosts/common/conversation_observer';
import type { GameImageCapture, ImageDecoder } from '../../hosts/common/image';
import type { AssistantConnectionFactory } from '../../hosts/common/assistant_protocol';
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
import { RuntimeCartEditor, type CartEditor } from '../cart_editor';
import { OverlayRenderer } from '../runtime/overlay_renderer';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import type { PlaySessionFactory } from './services/play/session';
import type { TestTargetFactory } from '../testing/target';
import { editorTextModelService } from '../editor/model/model_service';
import type { WorkspaceRecord } from '../workspace/records';
import { clearAllRuntimeErrorOverlays } from '../runtime_error/navigation';
import { pointerHover } from '../input/pointer/hover';
import { StudioWorkbench } from './workbench';
import { activateEditor } from './overlay_modes';
import { presentRuntimeDebuggerStop } from './contrib/debugger/controller';
import { openHostError } from './contrib/host_error/editor_input';

export const DEFAULT_IDE_FONT_VARIANT: FontVariant = 'tiny';
export type OverlayResolutionMode = 'offscreen' | 'viewport';

export class RuntimeIdeState extends StudioWorkbench {
	public readonly editor: CartEditor;
	public readonly overlayRenderer: OverlayRenderer;
	public lastIdeInputFrame = -1;
	public shortcutDisposers: Array<() => void> = [];
	public constructor(
		runtime: Runtime,
		presenter: VideoPresenter,
		gameCapture: GameImageCapture,
		decodeImage: ImageDecoder,
		display: EditorDisplay,
		input: Input,
		audioOutput: HostAudioOutput,
		runtimeTasks: RuntimeTaskQueue,
		execution: HostExecutionControl,
		rewind: HostRewind,
		clock: HostClock,
		clipboard: Clipboard,
		microtasks: MicrotaskQueue,
		logOutput: LogOutput,
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		sources: RuntimeSourceState,
		workspaceDirtyRecords: ReadonlyMap<string, WorkspaceRecord>,
		createGraphLayoutEngine: GraphLayoutEngineFactory,
		createTestTarget: TestTargetFactory,
		createPlaySession: PlaySessionFactory,
		connectAssistant?: AssistantConnectionFactory,
		observeConversation?: ConversationObserverFactory,
	) {
		super({ runtime, input, audioOutput, runtimeTasks, execution, rewind, clock, microtasks, logOutput, sources,
			models: editorTextModelService, workspaceDirtyRecords, gameCapture, createTestTarget, createPlaySession });
		this.overlayRenderer = new OverlayRenderer(presenter.hostOverlayQueue);
		this.editor = new RuntimeCartEditor(
			this, presenter, display, input, clock, clipboard, logOutput, resourcePanelWidthRatio,
			viewport, DEFAULT_IDE_FONT_VARIANT, this.overlayRenderer, decodeImage, createGraphLayoutEngine,
			connectAssistant, observeConversation,
		);
		this.overlayRenderer.setViewportSize(viewport);
		this.editor.updateViewport(viewport);
		this.hotResumes.onDidApply(() => clearAllRuntimeErrorOverlays(this.editor.editorGroup));
		this.onDidReplaceMachine(() => {
			this.editor.terminal.discard();
			clearAllRuntimeErrorOverlays(this.editor.editorGroup);
			pointerHover.clear();
		});
		this.onDidStop(() => {
			activateEditor(this.editor, sources, runtime);
			void presentRuntimeDebuggerStop(this.editor, this.debugger, sources.catalog).catch(error => this.failHostFrame(error));
		});
		this.onDidFailHostFrame(stack => {
			this.overlayRenderer.abandonFrame();
			openHostError(this.editor.editorGroup, stack);
			this.editor.activate();
		});
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
