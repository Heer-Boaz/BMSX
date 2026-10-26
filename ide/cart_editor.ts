import { CodeDocumentProjections } from './editor/ui/code/document_projections';
import type { FontVariant } from '../machine/ts/render/shared/bmsx_font';
import { create_rect_bounds, write_rect_bounds } from '../machine/ts/common/rect';
import { HomeInput } from './workbench/contrib/home/editor_input';
import { HomeEditorPane } from './workbench/contrib/home/editor_pane';
import { workspaceState } from './workbench/workspace/state';
import { type PointerInputEvent, type WheelInputEvent } from '../hosts/common/input/pointer_event';
import type { DisposableStore } from './common/lifecycle';
import type { PointerInputSnapshot, WheelInputSnapshot } from './common/models';
import { projectEditorPointerEvent, projectEditorWheelEvent } from './input/pointer/frame';
import type { InputRecipient } from '../hosts/common/input/channel';
import { AnimationEditorController } from './workbench/contrib/animation/controller';
import { AnimationEditorPane } from './workbench/contrib/animation/editor_pane';
import { AnimationInputSerializer } from './workbench/contrib/animation/editor_serializer';
import { HostErrorPane } from './workbench/contrib/host_error/editor_pane';
import { BuildLogPane } from './workbench/contrib/builds/editor_pane';
import { RomInspectorPane } from './workbench/contrib/rom_inspector/editor_pane';
import { CartMapController } from './workbench/contrib/cart_maps/controller';
import { CartMapPane } from './workbench/contrib/cart_maps/editor_pane';
import { CartMapInputSerializer } from './workbench/contrib/cart_maps/editor_serializer';
import type { SuspendedGuestSession } from './runtime/suspended_guest';
import type { RuntimeEventHistory } from './runtime/event_history';
import { EventViewerInput } from './workbench/contrib/events/editor_input';
import { EventViewerPane } from './workbench/contrib/events/editor_pane';
import { GpuDebuggerPane } from './workbench/contrib/gpu_debugger/editor_pane';
import type { RuntimeGpuHistory } from './runtime/gpu_history';
import { GteDebuggerPane } from './workbench/contrib/gte_debugger/editor_pane';
import type { RuntimeGteHistory } from './runtime/gte_history';
import { AemEditorController } from './workbench/contrib/aem/controller';
import { AemEditorPane } from './workbench/contrib/aem/editor_pane';
import { AemEditorInputSerializer } from './workbench/contrib/aem/editor_serializer';
import { LuaProgramController } from './workbench/contrib/lua_program/controller';
import { LuaProgramEditorPane } from './workbench/contrib/lua_program/editor_pane';
import { RuntimeTimelineControl } from './workbench/ui/runtime_timeline_control';
import { LuaProgramInputSerializer } from './workbench/contrib/lua_program/editor_serializer';
import { ActionStringTester } from './workbench/contrib/scenario_lab/actionstring';
import type { PublishedBuildOpenResult } from './workbench/services/builds';
import type { WorkspaceBuilds } from './workbench/services/builds';
import type { WorkspaceProjects } from './workbench/services/projects';
import type { ImportWorkspaceFiles } from './workbench/services/file_import';
import type { ConversationObserverFactory } from '../hosts/common/conversation_observer';
import { PlayController } from './workbench/contrib/play/controller';
import { PlayEditorPane } from './workbench/contrib/play/editor_pane';
import { ObservedConversation } from './workbench/services/assistant/observed_conversation';
import { ConversationObserverPane } from './workbench/contrib/conversations/editor_pane';
import type { WorkspaceToolService } from './workbench/services/assistant/tool_service';
import type { ImageDecoder } from '../hosts/common/image';
import { AssistantConversation } from './workbench/services/assistant/conversation';
import { BiosTerminal } from './runtime/bios_terminal';
import type { RuntimeLuaEvaluation } from './runtime/lua_evaluation';
import { TerminalPane } from './workbench/contrib/terminal/editor_pane';
import { TerminalInput } from './workbench/contrib/terminal/editor_input';
import { AssistantPane } from './workbench/contrib/assistant/editor_pane';
import { AssistantChatCommands } from './workbench/contrib/assistant/chat_commands';
import type { StudioServerConnectionState } from './workbench/common/server_connection';
import type { AssistantConnectionFactory } from '../hosts/common/assistant_protocol';
import { ActorLabController } from './workbench/contrib/actor_lab/controller';
import { GameViewInput } from './workbench/contrib/game_view/editor_input';
import { GameViewEditorPane } from './workbench/contrib/game_view/editor_pane';
import { GamePanel } from './workbench/contrib/game_view/game_panel';
import { ActorLabEditorPane } from './workbench/contrib/actor_lab/editor_pane';
import type { EditorInputSerializers } from './workbench/services/editor/editor_serialization';
import { CodeEditorInputSerializer } from './workbench/contrib/code_editor/editor_serializer';
import { BehaviorLensInputSerializer } from './workbench/contrib/behavior_lens/editor_serializer';
import { SceneEditorInputSerializer } from './workbench/contrib/scene_editor/editor_serializer';
import { ScenarioLabInputSerializer } from './workbench/contrib/scenario_lab/editor_serializer';
import { ResourceViewerInputSerializer } from './workbench/contrib/resources/editor_serializer';
import { ContextMenuController } from './workbench/services/context_menu/controller';
import { drawContextMenu, layoutContextMenu } from './workbench/services/context_menu/render';
import { applyScrollbarScroll } from './input/pointer/scrollbar';
import type { GraphLayoutEngineFactory } from './workbench/services/graph_layout/engine';
import { SceneEditorController } from './workbench/contrib/scene_editor/controller';
import { QuickInputController } from './workbench/services/quick_input/controller';
import { SceneEditorPane } from './workbench/contrib/scene_editor/editor_pane';
import { clearHoverTooltip } from './editor/contrib/hover/controller';
import type { HostAudioOutput } from '../hosts/common/audio_output';
import type { Input } from '../hosts/common/input/manager';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import type { Clipboard, ClipboardTarget } from '../hosts/common/clipboard';
import type { HostClock } from '../hosts/common/clock';
import type { LogOutput } from '../hosts/common/log';
import type { VideoPresenter } from '../machine/ts/render/video_presenter';
import { runtimeSourcesSupportIde, type RuntimeSourceState } from './runtime/sources';
import { blua32ToolingImageForDomain } from '../toolchain/ts/rompack/blua32_media';
import type { EditorDisplay, Viewport } from './common/viewport';
import { api } from './runtime/overlay_api';
import * as constants from './common/constants';
import type { FaultSnapshot, RuntimeErrorDetails, RuntimeFaultState } from './runtime/fault_state';
import type { ResourceIdentity } from './common/resource';
import { type RuntimeDebuggerState } from './runtime/debugger_state';
import type { OverlayRenderer } from './runtime/overlay_renderer';
import { showEditorMessage, updateEditorMessage, setEditorFeedbackActive, editorFeedbackState } from './common/feedback_state';
import { editorRuntimeState } from './editor/common/runtime_state';
import { invalidateLuaCommentContextFromRow } from './common/text';
import { measureText, measureTextRange } from './editor/common/text/layout';
import { applyRuntimeErrorOverlay } from './editor/render/error_overlay';
import { drawEditorText, setEditorCaseInsensitivity } from './editor/render/text_renderer';
import {
	applyViewportSize,
	configureFontVariant,
	setFontVariant,
} from './editor/ui/view/view';
import { editorViewState } from './editor/ui/view/state';
import { ensureCursorVisible, updateDesiredColumn } from './editor/ui/view/caret/caret';
import { editorCaretState } from './editor/ui/view/caret/state';
import { updateBlink } from './editor/ui/inline/text_field';
import { bindQuickInputFields } from './quick_input/fields';
import { inputFocus, type InputFocusTarget } from './input/focus';
import type { KeyInputEvent, TextInputHost, TextInputTarget } from '../hosts/common/input/text';
import { pointerHover } from './input/pointer/hover';
import { pointerCapture } from './input/pointer/capture';
import { PointerButton } from '../hosts/common/input/pointer_event';
import { WorkbenchSurfaceService } from './workbench/services/windows/service';
import type { WorkbenchSurface } from './workbench/services/windows/model';
import { Scrollbar } from './workbench/ui/scrollbar';
import { ScrollbarController } from './editor/ui/scrollbar_controller';
import { clearRuntimeErrorOverlay } from './editor/contrib/runtime_error/navigation';
import {
	rewrapRuntimeErrorOverlays,
	clearExecutionStopHighlights,
	setActiveRuntimeErrorOverlayForCurrentContext,
	setExecutionStopHighlightForCurrentContext,
	syncRuntimeErrorOverlayFromContext,
} from './runtime_error/navigation';
import { clearGotoHoverHighlight, getBuiltinIdentifiersSnapshot } from './editor/contrib/intellisense/engine';
import { resetSemanticProjects } from './editor/contrib/intellisense/semantic/workspace/state';
import { activeCodeEditor } from './editor/ui/code_editor_state';
import { editorTextModelService } from './editor/model/model_service';
import type { ResourceDiagnosticsService } from './workbench/services/diagnostics/resource_diagnostics';
import { applyLineJumpFieldText } from './workbench/contrib/code_editor/find/line_jump';
import { EditorSearchController, applySearchFieldText, startSearchJob } from './workbench/contrib/code_editor/find/search';
import { editorSearchState, lineJumpState } from './workbench/contrib/code_editor/find/widget_state';
import { renameController } from './workbench/contrib/code_editor/rename/controller';
import { CrossFileRenameManager } from './workbench/contrib/code_editor/rename/operations';
import { WorkspaceEditReviewPane } from './workbench/contrib/edit_review/editor_pane';
import { EditorCompletionController } from './workbench/contrib/code_editor/suggest/completion_controller';
import { handleEditorInput } from './input/keyboard/dispatch';
import { captureKeys } from './workbench/contrib/code_editor/input/keyboard/capture_keys';
import { editorInput } from './workbench/contrib/code_editor/input/keyboard/text_input';
import { handleTextEditorPointerInput, handleWorkbenchChromePointer, handleWorkbenchPanePointer } from './input/pointer/dispatch';
import { clearEditorPointerSelectionState, editorPointerState } from './input/pointer/state';
import { handleEditorWheelInput, handleWorkbenchChromeWheel, handleWorkbenchPaneWheel } from './input/pointer/wheel';
import {
	cancelWorkspaceAutosave,
	requestWorkspaceAutosave,
	runWorkspaceAutosaveTick,
	shutdownWorkspaceStorage,
} from './workbench/workspace/storage';
import { WorkspaceAutosaveChange } from './workbench/workspace/models';
import { getWorkbenchEditorBounds, getWorkbenchWorkArea, refreshWorkbenchLayout, type WorkbenchChromeLayout } from './workbench/common/layout';
import { BreakpointController } from './workbench/contrib/debugger/controller';
import { ActionPrompt } from './workbench/contrib/modal/action_prompt';
import { drawProblemsPanel, problemsPanel } from './workbench/contrib/problems/panel/controller';
import { ResourcePanelController } from './workbench/contrib/resources/panel/controller';
import { IdeCommandController } from './commands/controller';
import { initializeNavigationState } from './navigation/navigation_history';
import { EditorNavigationController } from './workbench/contrib/resources/navigation';
import { BehaviorLensController } from './workbench/contrib/behavior_lens/controller';
import type { StudioWorkbench } from './workbench/workbench';
import { ScenarioLabController } from './workbench/contrib/scenario_lab/controller';
import { editorChromeState } from './workbench/ui/chrome_state';
import { drawResourcePanel } from './workbench/render/resource_panel';
import { renderStatusBar } from './workbench/render/status_bar';
import { drawEditorGroupWatermark } from './workbench/render/editor_group_watermark';
import { renderTopBar } from './workbench/render/top_bar';
import { layoutTopBar } from './workbench/ui/top_bar/layout';
import { MenubarController } from './workbench/ui/top_bar/controller';
import type { ChromeRenderContext } from './workbench/render/chrome_context';
import { createResourceEditorResolver } from './workbench/contrib/resources/editor_contributions';
import type { ResourceEditorResolver } from './workbench/services/editor/resource_editor_resolver';
import { EditorGroupView } from './workbench/services/editor/editor_group';
import { CodeEditorPane } from './workbench/contrib/code_editor/editor_pane';
import { ResourceViewerEditorPane } from './workbench/contrib/resources/editor_pane';
import { BehaviorLensEditorPane } from './workbench/contrib/behavior_lens/editor_pane';
import { ScenarioLabEditorPane } from './workbench/contrib/scenario_lab/editor_pane';


type RenderRuntimeFaultOverlayOptions = {
	snapshot: FaultSnapshot;
	needsFlush: boolean;
	force?: boolean;
};

const EDITOR_TARGET_WIDTH = 384;
const EDITOR_TARGET_HEIGHT = 288;

export type CartEditor = TextInputHost & {
	readonly events: RuntimeEventHistory;
	readonly gte: RuntimeGteHistory;
	readonly gpu: RuntimeGpuHistory;
	builds: WorkspaceBuilds | undefined;
	projects: WorkspaceProjects | undefined;
	importFiles: ImportWorkspaceFiles | undefined;
	openPublishedBuild: ((artifact: string) => PublishedBuildOpenResult) | undefined;
	serverConnectionState: StudioServerConnectionState;
	serverConnectionDetail: string;
	retryServerConnection: (() => void) | undefined;
	readonly clipboard: Clipboard;
	readonly clipboardTarget: ClipboardTarget | undefined;
	readonly terminal: BiosTerminal;
	readonly assistant: AssistantConversation;
	readonly assistantCommands: AssistantChatCommands;
	readonly observedConversation: ObservedConversation;
	readonly tools: WorkspaceToolService;
	readonly diagnostics: ResourceDiagnosticsService;
	readonly codeDocuments: CodeDocumentProjections;
	readonly executionSuspended: boolean;
	readonly guestInputRecipient: InputRecipient | null;
	readonly isAvailable: boolean;
	readonly completion: EditorCompletionController;
	readonly resourcePanel: ResourcePanelController;
	readonly search: EditorSearchController;
	readonly breakpoints: BreakpointController;
	readonly commands: IdeCommandController;
	readonly runtimeTimeline: RuntimeTimelineControl;
	readonly gamePanel: GamePanel;
	readonly resourceEditors: ResourceEditorResolver;
	readonly editorGroup: EditorGroupView;
	readonly surfaces: WorkbenchSurfaceService;
	readonly paneSurface: WorkbenchSurface;
	readonly editorInputSerializers: EditorInputSerializers;
	readonly navigation: EditorNavigationController;
	readonly cartMaps: CartMapController;
	readonly sceneEditor: SceneEditorController;
	readonly animations: AnimationEditorController;
	readonly actorLab: ActorLabController;
	readonly actionPrompt: ActionPrompt;
	readonly quickInput: QuickInputController;
	readonly contextMenu: ContextMenuController;
	readonly menubar: MenubarController;
	readonly behaviorLens: BehaviorLensController;
	readonly aemEditor: AemEditorController;
	readonly luaPrograms: LuaProgramController;
	readonly actionStrings: ActionStringTester;
	readonly scenarioLab: ScenarioLabController;
	readonly play: PlayController;
	readonly crossFileRename: CrossFileRenameManager;
	isActive: boolean;
	readonly acceptsInput: boolean;
	readonly fontVariant: FontVariant;
	activate: () => void;
	deactivate: () => void;
	onDidChangeActive(listener: (active: boolean) => void): () => void;
	dispatchPointer: (event: PointerInputEvent) => void;
	dispatchWheel: (event: WheelInputEvent) => boolean;
	tickInput: () => void;
	update: (deltaSeconds: number) => void;
	draw: () => void;
	shutdown: () => Promise<void>;
	updateViewport: (viewport: Viewport) => void;
	setFontVariant: (variant: FontVariant) => void;
	showRuntimeErrorInChunk: (resource: ResourceIdentity, line: number, column: number, message: string, details?: RuntimeErrorDetails) => void;
	showRuntimeError: (line: number, column: number, message: string, details?: RuntimeErrorDetails, path?: string) => void;
	clearRuntimeErrorOverlay: typeof clearRuntimeErrorOverlay;
	renderFaultOverlay: () => void;
	renderRuntimeFaultOverlay: (options: RenderRuntimeFaultOverlayOptions) => boolean;
	handleRuntimeTaskError: (error: unknown, fallbackMessage: string) => void;
};

export class RuntimeCartEditor implements CartEditor {
	public readonly play: PlayController;
	public readonly terminal: BiosTerminal;
	public readonly runtimeTimeline: RuntimeTimelineControl;
	public readonly gamePanel: GamePanel;
	private readonly activeListeners = new Set<(active: boolean) => void>();
	private readonly pointerSnapshot: PointerInputSnapshot = { viewportX: 0, viewportY: 0, insideViewport: false, valid: false,
		pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: 0, modifiers: 0, spaceDown: false };
	private readonly wheelSnapshot: WheelInputSnapshot = { viewportX: 0, viewportY: 0, insideViewport: false, valid: false,
		modifiers: 0, deltaX: 0, deltaY: 0 };
	public get guestInputRecipient(): InputRecipient | null {
		if (!this.isActive) return this.input;
		const viewport = inputFocus.admittedTarget?.guestInput;
		return viewport === undefined ? null : viewport.recipient;
	}
	public get executionSuspended(): boolean {
		// Automatic authoring hold only; explicit transport pause has a separate host owner.
		return this.isActive && (this.actionPrompt.visible || this.quickInput.visible || this.contextMenu.visible
			|| !this.debuggerState.plans.workbenchExecutionRequested
			&& !(this.debuggerState.executionContext === 'workbench' && this.debuggerState.source.stop === undefined)
			&& !(this.editorGroup.panes.activePane?.runtimeTransport === this.commands.transport && this.editorGroup.panes.activePane.suspendsRuntime === false)
			&& inputFocus.target?.guestInput?.recipient !== this.input);
	}
	public readonly isAvailable: boolean;
	public readonly completion: EditorCompletionController;
	public readonly resourcePanel: ResourcePanelController;
	public readonly search: EditorSearchController;
	public readonly breakpoints: BreakpointController;
	public readonly commands: IdeCommandController;
	public readonly resourceEditors: ResourceEditorResolver;
	public readonly editorGroup: EditorGroupView;
	public readonly surfaces: WorkbenchSurfaceService;
	public readonly paneSurface: WorkbenchSurface;
	private readonly chromeScope = Symbol('workbench chrome');
	private readonly rootSurfaceBounds = { left: 0, top: 0,
		get right() { return editorViewState.viewportWidth; },
		get bottom() { return editorViewState.viewportHeight; },
	};
	private readonly unbindSurfaceAdmission: () => void;
	private readonly onSurfaceChange = (): void => {
		pointerHover.clear();
		const scope = pointerCapture.routeScope;
		if (scope !== undefined) {
			const route = this.surfaces.findByScope(scope);
			if (route === undefined || !this.surfaces.isAdmitted(route)) pointerCapture.cancelScope(scope);
		}
		inputFocus.notifyTargetChanged();
	};
	public readonly navigation: EditorNavigationController;
	public readonly cartMaps: CartMapController;
	public readonly sceneEditor: SceneEditorController;
	public readonly animations: AnimationEditorController;
	public readonly actorLab: ActorLabController;
	public readonly actionPrompt = new ActionPrompt(inputFocus, pointerCapture, () => this.surfaces.changed(),
		next => next !== null && this.surfaces.isInContext(next.scope.surfaceScope, this.actionPrompt.pointerScope));
	public readonly quickInput: QuickInputController;
	public readonly contextMenu: ContextMenuController;
	public readonly menubar: MenubarController;
	public readonly behaviorLens: BehaviorLensController;
	public readonly aemEditor: AemEditorController;
	public readonly luaPrograms: LuaProgramController;
	public readonly actionStrings: ActionStringTester;
	public readonly scenarioLab: ScenarioLabController;
	public readonly crossFileRename: CrossFileRenameManager;
	public readonly editorInputSerializers: EditorInputSerializers;
	public readonly clearRuntimeErrorOverlay = clearRuntimeErrorOverlay;
	private crtPostprocessingEnabledBeforeEditor: boolean | null = null;
	private readonly runtime: Runtime;
	private readonly presenter: VideoPresenter;
	private readonly display: EditorDisplay;
	private readonly input: Input;
	private readonly clock: HostClock;
	public readonly clipboard: Clipboard;
	private readonly sources: RuntimeSourceState;
	private readonly fault: RuntimeFaultState;
	private readonly guest: SuspendedGuestSession;
	private readonly debuggerState: RuntimeDebuggerState;
	private readonly overlayRenderer: OverlayRenderer;
	private readonly unsubscribeWorkspaceCursorMoved: () => void;
	private readonly unsubscribeTextModelChanged: () => void;
	private readonly unsubscribeDiagnosticsChanged: () => void;
	private readonly unbindHostInput: () => void;
	private readonly unbindEditorInputRetirement: () => void;
	private readonly unbindNavigation: () => void;
	private readonly unbindQuickInputFields: () => void;
	private readonly unbindProblemsPanel: () => void;
	private readonly unbindBreakpoints: () => void;
	private readonly unbindSourceStop: () => void;
	private readonly chromeRenderContext: ChromeRenderContext & WorkbenchChromeLayout = {
		get viewportWidth(): number { return editorViewState.viewportWidth; },
		get lineHeight(): number { return editorViewState.lineHeight; },
		get tabBarHeight(): number { return editorViewState.tabBarHeight; },
		measureText,
		drawText(text: string, x: number, y: number, z: number, color: number): void {
			const font = editorViewState.font;
			drawEditorText(font, text, x, y, z, color);
		},
	};

	public readonly assistant: AssistantConversation;
	public builds: WorkspaceBuilds | undefined;
	public projects: WorkspaceProjects | undefined;
	public importFiles: ImportWorkspaceFiles | undefined;
	public openPublishedBuild: ((artifact: string) => PublishedBuildOpenResult) | undefined;
	public serverConnectionState: StudioServerConnectionState = 'standalone';
	public serverConnectionDetail = 'No workspace server is configured.';
	public retryServerConnection: (() => void) | undefined;
	public readonly assistantCommands: AssistantChatCommands;
	public readonly observedConversation: ObservedConversation;
	public readonly tools: WorkspaceToolService;
	public readonly events: RuntimeEventHistory;
	public readonly gte: RuntimeGteHistory;
	public readonly gpu: RuntimeGpuHistory;
	public readonly diagnostics: ResourceDiagnosticsService;
	public readonly codeDocuments: CodeDocumentProjections;
	private readonly luaEvaluation: RuntimeLuaEvaluation;

	public constructor(
		private readonly workbench: StudioWorkbench,
		presenter: VideoPresenter,
		display: EditorDisplay,
		input: Input,
		audioOutput: HostAudioOutput,
		clock: HostClock,
		clipboard: Clipboard,
		logOutput: LogOutput,
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		fontVariant: FontVariant,
		overlayRenderer: OverlayRenderer,
		decodeImage: ImageDecoder,
		createGraphLayoutEngine: GraphLayoutEngineFactory,
		connectAssistant?: AssistantConnectionFactory,
		observeConversation?: ConversationObserverFactory,
	) {
		const { runtime, sources, fault, guest, debugger: debuggerState, events, gte, gpu, runtimeTasks, execution,
			rewind, scenarioRuns, play: playSessions, textFileSaves, hotResumes, boots, diagnostics, luaEvaluation,
			actorExecution, frameNavigation, debuggerExecution } = workbench;
		this.events = events; this.gte = gte; this.gpu = gpu;
		this.diagnostics = diagnostics;
		this.codeDocuments = new CodeDocumentProjections(editorTextModelService, {
			clock, maxHighlightCache: 512, semanticDebounceMs: 200, getBuiltinIdentifiers: getBuiltinIdentifiersSnapshot,
		});
		this.luaEvaluation = luaEvaluation;
		const behaviorSources = workbench.behaviorSources;
		this.terminal = new BiosTerminal(runtime, input, guest, debuggerState, runtimeTasks, execution, rewind, fault);
		this.tools = workbench.tools;
		this.tools.revealTestRun = run => this.scenarioLab.revealRun(run);
		this.assistant = new AssistantConversation(editorTextModelService, sources, this.tools, connectAssistant);
		this.observedConversation = new ObservedConversation(observeConversation);
		this.runtime = runtime;
		this.presenter = presenter;
		this.display = display;
		this.input = input;
		this.clock = clock;
		this.clipboard = clipboard;
		this.sources = sources;
		this.fault = fault;
		this.guest = guest;
		this.debuggerState = debuggerState;
		this.overlayRenderer = overlayRenderer;
		this.isAvailable = runtimeSourcesSupportIde(this.sources);
		this.commands = new IdeCommandController(
			this,
			sources,
			fault,
			debuggerState,
			hotResumes,
			boots,
			runtimeTasks,
			execution,
			rewind,
			overlayRenderer,
			runtime,
			audioOutput,
			clock,
			logOutput,
			scenarioRuns,
			textFileSaves,
			frameNavigation,
			debuggerExecution,
		);
		inputFocus.workbenchScope.commands = this.commands;
		const workArea = getWorkbenchWorkArea();
		this.editorGroup = new EditorGroupView({
			home: scope => new HomeEditorPane(this.commands, scope),
			play_session: scope => new PlayEditorPane(this.commands, this.contextMenu, this.navigation, scope),
			animation: scope => new AnimationEditorPane(this.animations, this.commands, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			host_error: scope => new HostErrorPane(scope),
			build_log: scope => new BuildLogPane(this.clipboard, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			rom_inspector: scope => new RomInspectorPane(this.commands, this.sources, this.navigation, this.quickInput, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			event_viewer: scope => new EventViewerPane(this.quickInput, this.commands, frameNavigation, this.contextMenu,
				this.surfaces, this.paneSurface, workArea, scope),
			gpu_debugger: scope => new GpuDebuggerPane(this.quickInput, this.commands, frameNavigation, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			gte_debugger: scope => new GteDebuggerPane(this.quickInput, this.commands, frameNavigation, this.contextMenu, this.sources, this.navigation, this.surfaces, this.paneSurface, workArea, scope),
			terminal: scope => new TerminalPane(this.terminal, input, presenter, scope),
			conversation_observer: scope => new ConversationObserverPane(decodeImage, this.surfaces, this.paneSurface, this.commands, scope),
			assistant: scope => new AssistantPane(this.clipboard, this.editorGroup, this.assistantCommands, decodeImage,
				this.surfaces, this.paneSurface, this.commands, this.contextMenu, workArea, scope),
			workspace_edit_review: scope => new WorkspaceEditReviewPane(this.editorGroup, this.quickInput, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			code_editor: () => new CodeEditorPane(
				this,
				this.clipboard,
				this.sources,
				this.guest,
				this.fault,
				this.runtime,
				this.debuggerState,
			),
			resource_view: scope => new ResourceViewerEditorPane(scope),
			aem_editor: scope => new AemEditorPane(this.aemEditor, this.commands, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			lua_program: scope => new LuaProgramEditorPane(this.luaPrograms, this.commands, this.actionStrings, frameNavigation, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			behavior_lens: scope => new BehaviorLensEditorPane(this.behaviorLens, this.commands, this.contextMenu, frameNavigation, this.surfaces, this.paneSurface, workArea, scope),
			actor_lab: scope => new ActorLabEditorPane(this.commands, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			game_view: scope => new GameViewEditorPane(this.commands, this.contextMenu, runtime, input, presenter, scope),
			cart_map: scope => new CartMapPane(this.cartMaps, this.commands, this.sources, this.surfaces, this.paneSurface, workArea, scope),
			scene_editor: scope => new SceneEditorPane(this.sceneEditor, this.commands, this.sources, this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
			scenario_lab: scope => new ScenarioLabEditorPane(
				this.scenarioLab,
				this.commands,
				this.contextMenu, this.surfaces, this.paneSurface, workArea, scope),
		}, this.commands);
		// The current Source widget is a single primary-group control, not a second group instance.
		this.editorGroup.bindInputScope(activeCodeEditor.focusTarget.scope);
		this.completion = new EditorCompletionController(sources, guest, fault, runtime);
		this.runtimeTimeline = new RuntimeTimelineControl(this.commands, () => this.editorGroup.panes.activePane?.focus());
		this.runtimeTimeline.focusScope.surfaceScope = this.chromeScope;
		this.resourcePanel = this.initialize(resourcePanelWidthRatio, viewport, fontVariant);
		this.surfaces = new WorkbenchSurfaceService(this.onSurfaceChange);
		this.contextMenu = new ContextMenuController(inputFocus, pointerCapture, this.attachContextMenuSession);
		this.menubar = new MenubarController(this.contextMenu, this.commands, this.chromeRenderContext);
		this.quickInput = new QuickInputController(this.contextMenu, () => this.surfaces.changed(),
			next => next !== null && this.surfaces.isInContext(next.scope.surfaceScope, this.quickInput.pointerScope));
		const chromeSurface = this.surfaces.attach({
			role: 'content', captureScope: this.chromeScope, isVisible: () => true,
			getBounds: () => this.rootSurfaceBounds, getClip: () => this.rootSurfaceBounds,
			draw: () => this.drawWorkbenchChrome(),
			handlePointer: snapshot => handleWorkbenchChromePointer(this, snapshot),
			handleWheel: event => handleWorkbenchChromeWheel(this, event),
			onRetire: () => pointerCapture.cancelScope(this.chromeScope),
		});
		this.runtimeTimeline.attach(this.surfaces, chromeSurface, workArea, this.contextMenu);
		this.surfaces.attach({
			role: 'content', captureScope: this.editorGroup.tabScope, isVisible: () => true,
			getBounds: () => this.editorGroup.tabStrip.layoutState.bounds,
			getClip: () => this.rootSurfaceBounds,
			draw: () => this.editorGroup.tabStrip.draw(this.chromeRenderContext),
			handlePointer: (snapshot, now) => this.editorGroup.tabStrip.handlePointer(snapshot, now),
			handleWheel: event => this.editorGroup.tabStrip.handleWheel(event),
			onRetire: () => pointerCapture.cancelScope(this.editorGroup.tabScope),
		});
		this.menubar.attach(this.surfaces, chromeSurface, workArea);
		this.paneSurface = this.surfaces.attach({
			role: 'content', captureScope: this.editorGroup.captureScope, isVisible: () => true,
			getBounds: getWorkbenchEditorBounds, getClip: getWorkbenchEditorBounds,
			draw: () => {
				const pane = this.editorGroup.panes.activePane;
				if (pane === null) drawEditorGroupWatermark(); else pane.draw();
			},
			handlePointer: (snapshot, now) => handleWorkbenchPanePointer(this, snapshot, now),
			handleWheel: event => handleWorkbenchPaneWheel(this, event),
			onRetire: () => pointerCapture.cancelScope(this.editorGroup.captureScope),
		});

		this.surfaces.attach({
			role: 'modal', blockedScope: null, captureScope: this.quickInput.pointerScope,
			isVisible: () => this.quickInput.visible, getBounds: () => this.quickInput.layout.bounds,
			getClip: () => this.rootSurfaceBounds, draw: () => this.quickInput.draw(),
			handlePointer: snapshot => this.quickInput.handlePointer(snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0),
			handleWheel: event => { this.quickInput.handleWheel(event.deltaY); return true; },
			onRetire: () => pointerCapture.cancelScope(this.quickInput.pointerScope),
		});
		this.surfaces.attach({
			role: 'modal', blockedScope: null, captureScope: this.actionPrompt.pointerScope,
			isVisible: () => this.actionPrompt.visible, getBounds: () => this.actionPrompt.view.bounds,
			getClip: () => this.rootSurfaceBounds, draw: () => this.actionPrompt.draw(),
			handlePointer: snapshot => this.actionPrompt.handlePointer(snapshot),
			onRetire: () => pointerCapture.cancelScope(this.actionPrompt.pointerScope),
		});
		this.resourcePanel.focusTarget.scope.surfaceScope = this.chromeScope;
		problemsPanel.focusTarget.scope.surfaceScope = this.chromeScope;
		this.resourceEditors = createResourceEditorResolver(
			this.sources,
		);

		this.unbindEditorInputRetirement = this.editorGroup.panes.onDidClearEditor(() => {
			if (this.actionPrompt.visible && this.editorOriginRetired(this.actionPrompt.invocationOrigin)) this.actionPrompt.close('cancel', false);
			if (this.quickInput.visible && this.editorOriginRetired(this.quickInput.invocationOrigin)) this.quickInput.hide(false);
			if (this.contextMenu.visible && this.editorOriginRetired(this.contextMenu.invocationOrigin)) this.contextMenu.hide(false);
		});
		this.gamePanel = new GamePanel(this.editorGroup.panes, this.commands, this.contextMenu, input, presenter);
		this.gamePanel.focusScope.surfaceScope = this.chromeScope;
		this.search = new EditorSearchController(this.sources, renameController);
		this.assistantCommands = new AssistantChatCommands(this.assistant, this.editorGroup, this.quickInput, this.clipboard);
		this.navigation = new EditorNavigationController(
			this.sources,
			this.resourcePanel,
			this.resourceEditors,
			this.editorGroup,
			this.search,
		);
		this.cartMaps = new CartMapController(this.sources, this.editorGroup, this.quickInput);
		this.sceneEditor = new SceneEditorController(this.sources, this.editorGroup, this.navigation);
		this.animations = new AnimationEditorController(this.sources, this.editorGroup, this.navigation, this.quickInput);
		this.actorLab = new ActorLabController(sources, guest, runtime.machine.cpu,
			this.quickInput, this.editorGroup, this.navigation, actorExecution, rewind, sources,
			{ kind: 'direct', presenter, recipient: input, transport: this.commands.transport });

		const behaviorRegistrations = behaviorSources.registrations;
		this.play = new PlayController(this, playSessions, scenarioRuns, sources);
		this.behaviorLens = new BehaviorLensController(
			this.sources,
			this.navigation,
			this.editorGroup,
			this.quickInput,
			behaviorSources,
			createGraphLayoutEngine,
			guest,
			rewind,
		);
		this.scenarioLab = new ScenarioLabController(
			this,
			this.navigation,
			this.editorGroup,
			behaviorRegistrations,
			scenarioRuns,
			this.play,
		);
		this.aemEditor = new AemEditorController(sources, this.editorGroup, this.quickInput);
		this.luaPrograms = new LuaProgramController(sources, guest, this.editorGroup, this.navigation, this.quickInput, rewind);
		this.actionStrings = new ActionStringTester(sources, clock, this.quickInput, scenarioRuns, this.scenarioLab);
		this.editorInputSerializers = {
			home: { serialize: () => '', deserialize: () => new HomeInput(workspaceState.projectRootPath) },
			animation: new AnimationInputSerializer(sources, this.animations),
			aem_editor: new AemEditorInputSerializer(sources),
			lua_program: new LuaProgramInputSerializer(sources, this.luaPrograms),
			event_viewer: { serialize: () => '', deserialize: () => new EventViewerInput(this.events) },
			terminal: { serialize: () => '', deserialize: () => new TerminalInput() },
			actor_lab: { serialize: () => '', deserialize: () => this.actorLab.resolveInput() },
			game_view: { serialize: () => '', deserialize: () => new GameViewInput() },
			code_editor: new CodeEditorInputSerializer(sources),
			behavior_lens: new BehaviorLensInputSerializer(sources, this.behaviorLens),
			cart_map: new CartMapInputSerializer(sources),
			scene_editor: new SceneEditorInputSerializer(sources, this.sceneEditor),
			scenario_lab: new ScenarioLabInputSerializer(this.scenarioLab),
			resource_view: new ResourceViewerInputSerializer(sources),
		};
		this.crossFileRename = new CrossFileRenameManager(this.sources);
		this.unbindQuickInputFields = bindQuickInputFields(
			this, this.sources,
		);
		this.unbindProblemsPanel = problemsPanel.focusTarget.bindKeyboard(
			input => problemsPanel.handleKeyboard(input, this.editorGroup),
		);
		this.breakpoints = new BreakpointController(debuggerState);
		this.unbindBreakpoints = debuggerState.breakpoints.onDidChange(() => requestWorkspaceAutosave(WorkspaceAutosaveChange.Breakpoints));
		this.unbindSourceStop = debuggerState.source.onDidChangeStop(stop => {
			if (stop === undefined) clearExecutionStopHighlights(this.editorGroup);
		});
		this.unbindNavigation = initializeNavigationState(this.editorGroup);
		this.initializeEditorGroup();
		this.unsubscribeWorkspaceCursorMoved = activeCodeEditor.onDidMoveCursor(() => {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
		});
		this.unsubscribeTextModelChanged = editorTextModelService.onDidChangeContent((model, event) => {
			if (model.mode === 'lua') {
				invalidateLuaCommentContextFromRow(model.buffer, event.startRow);
			}
			requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
			if (activeCodeEditor.model === model && editorSearchState.query.length > 0) {
				startSearchJob();
			}
		});
		const publishDiagnostics = () => {
			problemsPanel.setDiagnostics(diagnostics.diagnostics, diagnostics.coverage);
		};
		this.unsubscribeDiagnosticsChanged = diagnostics.onDidChange(publishDiagnostics);
		publishDiagnostics();
		this.unbindSurfaceAdmission = inputFocus.bindScopeAdmission(scope => {
			const surface = this.surfaces.findByScope(scope.surfaceScope);
			return surface !== undefined && this.surfaces.isAdmitted(surface);
		});
		problemsPanel.attach(this.surfaces, chromeSurface, workArea, this.commands);
		this.input.setEditingInput(this);
		this.unbindHostInput = input.onDidChangeEditingInputEnabled(() => {
			if (input.editingInputEnabled) pointerCapture.interrupt(input.pointerButtonsDown);
			inputFocus.notifyTargetChanged();
		});
	}

	public get isActive(): boolean { return editorRuntimeState.active; }
	public get acceptsInput(): boolean { return this.isActive && this.input.editingInputEnabled; }
	public get clipboardTarget(): ClipboardTarget | undefined {
		return this.acceptsInput ? inputFocus.admittedTarget?.clipboard : undefined;
	}
	public get textTarget(): TextInputTarget | undefined {
		return this.acceptsInput ? inputFocus.admittedTarget?.textInput : undefined;
	}
	public onDidChangeTarget(listener: () => void): () => void {
		const focus = inputFocus.onDidChangeTarget(listener);
		const active = this.onDidChangeActive(listener);
		return () => { focus(); active(); };
	}
	public dispatchKey(event: KeyInputEvent): boolean {
		if (this.input.capturesEditingKey(event)) { event.consumed = true; return true; }
		if (!this.isActive) return false;
		if (!this.acceptsInput) { event.consumed = true; return true; }
		this.pointerSnapshot.modifiers = event.modifiers;
		editorRuntimeState.currentTimeMs = this.clock.now();
		handleEditorInput(event, this);
		return event.consumed;
	}
	public dispatchPointer(event: PointerInputEvent): void {
		if (!this.acceptsInput) return;
		if (event.pressedButtons !== 0) this.menubar.cancelAlt();
		editorRuntimeState.currentTimeMs = event.timestamp;
		projectEditorPointerEvent(this.display, event, this.pointerSnapshot);
		if (event.cancelledButtons !== 0) pointerCapture.cancelButtons(event.cancelledButtons);
		handleTextEditorPointerInput(this.pointerSnapshot, event, this);
		// Selection and native focus must be published before this trusted gesture returns.
		if ((event.buttons | event.pressedButtons | event.releasedButtons) !== 0) inputFocus.notifyTargetChanged();
	}

	public cancelPointerInput(): void {
		pointerCapture.interrupt(this.input.pointerButtonsDown);
		clearEditorPointerSelectionState();
		editorPointerState.lastPointerSnapshot = null;
		this.pointerSnapshot.valid = false;
		this.pointerSnapshot.pressedButtons = 0;
		this.pointerSnapshot.justPressedButtons = 0;
		this.pointerSnapshot.justReleasedButtons = 0;
		pointerHover.clear();
	}

	public cancelInput(): void {
		this.menubar.cancelAlt();
		this.cancelPointerInput();
		inputFocus.cancelInput();
	}

	public dispatchWheel(event: WheelInputEvent): boolean {
		if (!this.isActive) return false;
		if (!this.acceptsInput) return true;
		editorRuntimeState.currentTimeMs = event.timestamp;
		projectEditorWheelEvent(this.display, event, this.wheelSnapshot);
		const view = activeCodeEditor.view;
		const row = view?.scrollRow, column = view?.scrollLeft;
		const consumed = handleEditorWheelInput(this, this.wheelSnapshot, event);
		if (view !== null && (row !== view.scrollRow || column !== view.scrollLeft)) {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
		}
		return consumed;
	}
	public get fontVariant(): FontVariant { return editorViewState.fontVariant; }

	public activate(): void {
		this.menubar.cancelAlt();
		const wasActive = this.isActive;
		const runtime = this.runtime;
		const activeSlot = runtime.machine.cpu.activeCartridgeSlot();
		if (!this.isAvailable || !blua32ToolingImageForDomain(this.sources.currentBlua32Media, activeSlot)?.symbols) {
			return;
		}
		editorInput.applyOverrides(this.input, true, captureKeys);
		this.input.setPointerAdmissionMode('routed');
		if (!wasActive) pointerCapture.interrupt(this.input.pointerButtonsDown);
		const activeTab = this.editorGroup.model.activeTab;
		if (activeTab !== null) this.editorGroup.activate(activeTab.id);
		const codeTabActive = activeTab?.kind === 'code_editor';
		editorCaretState.cursorVisible = codeTabActive;
		editorCaretState.blinkTimer = 0;
		editorRuntimeState.active = true;
		if (!wasActive) this.enterRenderTargets();
		this.diagnostics.setEnabled(true);
		this.overlayRenderer.active = true;
		setEditorFeedbackActive(true);
		editorPointerState.pointerSelecting = false;
		editorCaretState.cursorRevealSuspended = false;
		if (codeTabActive) {
			updateDesiredColumn();
		}
		this.search.closeSearch(false);
		lineJumpState.field.focusTarget.release();
		lineJumpState.visible = false;
		lineJumpState.value = '';
		if (codeTabActive) {
			syncRuntimeErrorOverlayFromContext(activeTab.context);
		}
		this.actionPrompt.close();
		if (codeTabActive && editorSearchState.query.length > 0) {
			startSearchJob();
		}
		if (codeTabActive) {
			ensureCursorVisible();
		}
		if (editorFeedbackState.message.visible
			&& editorFeedbackState.message.timer === Number.POSITIVE_INFINITY
			&& editorFeedbackState.deferredMessageDuration) {
			editorFeedbackState.message.timer = editorFeedbackState.deferredMessageDuration;
		}
		editorFeedbackState.deferredMessageDuration = null;
		if (editorViewState.dimCrtInEditor) {
			this.disableCrtPostprocessingForEditor();
		}
		if (this.fault.faultSnapshot && this.fault.hostFrameFailure === undefined) {
			const rendered = this.renderRuntimeFaultOverlay({
				snapshot: this.fault.faultSnapshot,
				needsFlush: this.fault.faultOverlayNeedsFlush,
				force: false,
			});
			if (rendered) {
				this.fault.faultOverlayNeedsFlush = false;
			}
		}
		if (!wasActive) for (const listener of this.activeListeners) listener(true);
	}

	public onDidChangeActive(listener: (active: boolean) => void): () => void {
		this.activeListeners.add(listener);
		return () => this.activeListeners.delete(listener);
	}

	public deactivate(): void {
		this.menubar.cancelAlt();
		pointerCapture.cancel();
		this.input.setPointerAdmissionMode('physical');
		this.guest.invalidate();
		pointerHover.clear();
		const wasActive = this.isActive;
		this.editorGroup.panes.clearEditor();
		editorRuntimeState.active = false;
		this.overlayRenderer.active = false;
		setEditorFeedbackActive(false);
		if (editorViewState.dimCrtInEditor) {
			this.restoreCrtPostprocessingFromEditor();
		}
		this.completion.closeSession();
		clearHoverTooltip();
		editorInput.applyOverrides(this.input, false, captureKeys);
		clearEditorPointerSelectionState();
		clearGotoHoverHighlight();
		editorViewState.scrollbarController.cancel();
		editorCaretState.cursorRevealSuspended = false;
		this.search.closeSearch(false);
		lineJumpState.field.focusTarget.release();
		lineJumpState.visible = false;
		this.actionPrompt.close();
		if (this.resourcePanel.refresh()) refreshWorkbenchLayout();
		this.diagnostics.setEnabled(false);
		editorRuntimeState.lastReportedSemanticError = null;
		if (wasActive) this.leaveRenderTargets();
		if (wasActive) for (const listener of this.activeListeners) listener(false);
	}

	public tickInput(): void {
		if (!this.acceptsInput) return;
		const playerInput = this.input.getPlayerInput(1);
		editorRuntimeState.currentTimeMs = this.clock.now();
		const codeView = activeCodeEditor.view;
		const scrollRow = codeView?.scrollRow;
		const scrollLeft = codeView?.scrollLeft;
		if (this.actionPrompt.visible) return;
		inputFocus.handleGamepad(playerInput);
		if (codeView !== null && (codeView.scrollRow !== scrollRow || codeView.scrollLeft !== scrollLeft)) {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.EditorSession);
		}
	}

	private readonly tabStripBounds = create_rect_bounds();
	private readonly tabStripLayoutContext = {
		get font() { return editorViewState.font.renderFont(); },
		get tabBarHeight() { return editorViewState.tabBarHeight; },
		get charAdvance() { return editorViewState.charAdvance; },
		measureText,
		measureTextRange,
	};

	private layoutEditorTabStrip(): void {
		write_rect_bounds(this.tabStripBounds, editorChromeState.menuBarHeight === 0 ? editorChromeState.menuButtonBounds.right : 0,
			editorChromeState.menuBarHeight, editorViewState.viewportWidth, 0);
		this.editorGroup.tabStrip.layout(this.tabStripBounds, this.tabStripLayoutContext);
		editorViewState.tabBarTotalHeight = this.editorGroup.tabStrip.layoutState.totalHeight;
	}

	public update(deltaSeconds: number): void {
		editorRuntimeState.currentTimeMs = this.clock.now();
		updateBlink(deltaSeconds);
		updateEditorMessage(deltaSeconds);
		layoutTopBar(this.chromeRenderContext, this.menubar.expanded);
		this.menubar.update();
		this.editorGroup.tabStrip.update(editorRuntimeState.currentTimeMs);
		this.layoutEditorTabStrip();
		const pane = this.editorGroup.panes.activePane;
		if (pane?.runtimeControlContext !== undefined) this.runtimeTimeline.setContext(pane.runtimeControlContext, pane.runtimeTransport);
		else this.runtimeTimeline.setContext(this.gamePanel.runtimeControlContext, this.gamePanel.runtimeTransport);
		editorChromeState.runtimeTimelineHeight = this.runtimeTimeline.height;
		let layoutChanged = refreshWorkbenchLayout();
		if (this.resourcePanel.refresh()) layoutChanged = refreshWorkbenchLayout() || layoutChanged;
		if (this.gamePanel.update()) layoutChanged = refreshWorkbenchLayout() || layoutChanged;
		if (layoutChanged) this.surfaces.changed();
		this.editorGroup.panes.layout(getWorkbenchEditorBounds());
		this.editorGroup.panes.activePane?.update(deltaSeconds);
		problemsPanel.update();
		this.runtimeTimeline.update();
		this.quickInput.update();
		this.actionPrompt.update();
		this.contextMenu.update();
		layoutContextMenu(this.contextMenu);
	}

	public updateViewport(viewport: Viewport): void {
		applyViewportSize(viewport);
		layoutTopBar(this.chromeRenderContext, this.menubar.expanded);
		this.menubar.update();
		this.layoutEditorTabStrip();
		refreshWorkbenchLayout();
		if (this.resourcePanel.refresh()) refreshWorkbenchLayout();
		if (this.gamePanel.update()) refreshWorkbenchLayout();
		problemsPanel.update();
		this.editorGroup.panes.layout(getWorkbenchEditorBounds());
		this.surfaces.changed();
	}

	public draw(): void {
		editorViewState.codeVerticalScrollbarVisible = false;
		editorViewState.codeHorizontalScrollbarVisible = false;
		api.fill_rect(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, 0, constants.COLOR_FRAME);

		this.surfaces.draw(api);
	}

	/** Main-pane replacement retires that input, not root chrome or sibling scopes. */
	private editorOriginRetired(origin: InputFocusTarget | null): boolean {
		return origin !== null && (origin.scope.surfaceScope === this.paneSurface.captureScope
			|| this.surfaces.findByScope(origin.scope.surfaceScope) === undefined);
	}

	/** Popup attachment lifetime is the source session, not the workbench root. */
	private readonly attachContextMenuSession = (lifetime: DisposableStore | undefined): void => {
		if (lifetime === undefined) { this.surfaces.changed(); return; }
		const origin = this.contextMenu.invocationOrigin;
		// Commands invoked without a control are explicitly root-chrome actions.
		// A control's declared scope must already have its real surface attached.
		const owner = this.surfaces.findByScope(origin === null ? this.chromeScope : origin.scope.surfaceScope)!;
		const presentationParent = this.surfaces.popupContext(owner);
		lifetime.add(this.surfaces.attach({
			role: 'transient', outsidePress: 'consume', captureScope: this.contextMenu.pointerScope,
			lifetimeOwner: owner, presentationParent,
			isVisible: () => this.contextMenu.visible, getBounds: () => this.contextMenu.model.bounds,
			getClip: presentationParent === undefined ? () => this.rootSurfaceBounds : presentationParent.getClip,
			draw: () => drawContextMenu(this.contextMenu),
			handlePointer: snapshot => { if (!this.menubar.handlePointer(snapshot)) this.contextMenu.handlePointer(snapshot); },
			handleWheel: event => { this.contextMenu.handleWheel(event.deltaY); return true; },
			onRetire: () => {
				// Session disposal already retires its own capture and presentation.
				if (lifetime.isDisposed) return;
				pointerCapture.cancelScope(this.contextMenu.pointerScope);
				this.contextMenu.hide();
			},
		}));
	};

	private drawWorkbenchChrome(): void {

		renderTopBar(this.chromeRenderContext, this.menubar);
		drawResourcePanel(this.resourcePanel);
		this.gamePanel.draw();
		this.runtimeTimeline.draw();
		drawProblemsPanel();
		let contextTarget = inputFocus.target;
		if (contextTarget === this.contextMenu.focusTarget) contextTarget = this.contextMenu.invocationOrigin;
		if (contextTarget === this.quickInput.field.focusTarget) contextTarget = this.quickInput.invocationOrigin;
		if (contextTarget === this.actionPrompt.focusTarget) contextTarget = this.actionPrompt.invocationOrigin;
		renderStatusBar(this.resourcePanel, this.fault, this.editorGroup.panes.activePane, this.luaEvaluation, this.serverConnectionState,
			contextTarget === null ? null : contextTarget.commandContext);
	}

	public async shutdown(): Promise<void> {
		inputFocus.workbenchScope.commands = undefined;
		this.unbindHostInput();
		this.unbindEditorInputRetirement();
		this.unbindSurfaceAdmission();
		this.surfaces.dispose();
		this.input.setEditingInput(undefined);
		this.assistant.dispose();
		this.observedConversation.dispose();
		this.unbindBreakpoints();
		this.unbindSourceStop();
		this.actionPrompt.dispose();
		this.terminal.discard();
		await this.workbench.shutdown();
		this.play.dispose();
		this.actorLab.dispose();
		this.unsubscribeDiagnosticsChanged();
		pointerHover.clear();
		pointerCapture.cancel();
		this.contextMenu.dispose();
		this.runtimeTimeline.dispose(); this.menubar.dispose();
		this.gamePanel.dispose();
		this.quickInput.dispose();
		this.unbindQuickInputFields();
		this.unbindProblemsPanel();
		problemsPanel.detach();
		this.completion.dispose();
		clearExecutionStopHighlights(this.editorGroup);
		if (this.isAvailable) {
			this.editorGroup.panes.clearEditor();
		}
		editorInput.applyOverrides(this.input, false, captureKeys);
		if (editorViewState.dimCrtInEditor) {
			this.restoreCrtPostprocessingFromEditor();
		}
		editorRuntimeState.active = false;
		setEditorFeedbackActive(false);
		this.input.setPointerAdmissionMode('physical');
		this.input.guestInputRecipient = this.input;
		requestWorkspaceAutosave(WorkspaceAutosaveChange.All);
		cancelWorkspaceAutosave();
		try {
			await runWorkspaceAutosaveTick();
		} finally {
			try {
				await shutdownWorkspaceStorage();
			} finally {
				this.editorGroup.dispose();
				this.unbindNavigation();
				editorViewState.layout.dispose();
				this.scenarioLab.dispose();
				this.unsubscribeWorkspaceCursorMoved();
				this.unsubscribeTextModelChanged();
				this.codeDocuments.dispose();
				editorTextModelService.clear();
			}
		}
		clearEditorPointerSelectionState();
		clearGotoHoverHighlight();
		editorCaretState.cursorRevealSuspended = false;
		this.search.closeSearch(true);
		lineJumpState.field.focusTarget.release();
		lineJumpState.visible = false;
		applyLineJumpFieldText('', true);
		this.resourcePanel.hide();
	}

	public setFontVariant(variant: FontVariant): void {
		if (!this.isAvailable) {
			return;
		}
		const previousVariant = editorViewState.fontVariant;
		const activeTab = this.editorGroup.panes.activePane?.input;
		if (activeTab?.kind === 'code_editor') {
			setFontVariant(variant, this.codeDocuments.get(activeTab.workingCopy));
		} else {
			configureFontVariant(variant);
		}
		this.resourcePanel.setFontMetrics(editorViewState.font);
		rewrapRuntimeErrorOverlays(this.editorGroup);
		if (editorViewState.fontVariant !== previousVariant) {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.Font);
		}
	}

	public showRuntimeErrorInChunk(resource: ResourceIdentity, line: number, column: number, message: string, details?: RuntimeErrorDetails): void {
		if (!editorRuntimeState.active) {
			this.activate();
		}
		void this.navigation.focusChunkSource(resource)
			.then(generation => {
				if (generation === this.editorGroup.panes.openGeneration) this.showRuntimeError(line, column, message, details, resource.path);
			})
			.catch(error => showEditorMessage(`Failed to open runtime source: ${String(error)}`, 'error', 4.0));
	}

	public showRuntimeError(line: number, column: number, message: string, details?: RuntimeErrorDetails, path: string = ''): void {
		if (!editorRuntimeState.active) {
			this.activate();
		}
		const applied = applyRuntimeErrorOverlay(line, column, message, details, path);
		setActiveRuntimeErrorOverlayForCurrentContext(this.editorGroup, applied.overlay);
		setExecutionStopHighlightForCurrentContext(this.editorGroup, applied.targetRow);
		showEditorMessage(applied.statusLine, 'error', 2.0);
	}

	public renderFaultOverlay(): void {
		const snapshot = this.fault.faultSnapshot;
		if (!snapshot) {
			return;
		}
		this.showRuntimeErrorInChunk(
			snapshot.resource,
			snapshot.line,
			snapshot.column,
			snapshot.message,
			snapshot.details
		);
	}

	public renderRuntimeFaultOverlay(options: RenderRuntimeFaultOverlayOptions): boolean {
		const { snapshot } = options;
		if (!editorRuntimeState.initialized) {
			return false;
		}
		if (!options.force && !options.needsFlush) {
			return false;
		}
		if (!snapshot) {
			return false;
		}
		this.showRuntimeErrorInChunk(
			snapshot.resource,
			snapshot.line,
			snapshot.column,
			snapshot.message,
			snapshot.details
		);
		return true;
	}

	public handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
		const errormsg = error instanceof Error ? error.message : String(error);
		this.activate();
		const message = `${fallbackMessage}: ${errormsg}`;
		showEditorMessage(message, 'error', 2.0);
	}

	private initialize(
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		fontVariant: FontVariant,
	): ResourcePanelController {
		editorViewState.fontVariant = fontVariant;
		constants.setIdeThemeVariant(constants.DEFAULT_THEME);
		editorRuntimeState.themeVariant = constants.getActiveIdeThemeVariant();
		editorRuntimeState.caseInsensitive = false;
		editorRuntimeState.uppercaseDisplay = true;
		setEditorCaseInsensitivity(editorRuntimeState.uppercaseDisplay);
		applyViewportSize(viewport);
		resetSemanticProjects(editorTextModelService);
		editorViewState.scrollbars = {
			codeVertical: new Scrollbar('vertical'),
			codeHorizontal: new Scrollbar('horizontal'),
			resourceVertical: new Scrollbar('vertical'),
			resourceHorizontal: new Scrollbar('horizontal'),
		};
		editorViewState.scrollbarController = new ScrollbarController(editorViewState.scrollbars, (kind, scroll) => applyScrollbarScroll(this, kind, scroll), pointerCapture);
		const resourcePanel = new ResourcePanelController(this, this.sources, {
			resourceVertical: editorViewState.scrollbars.resourceVertical,
			resourceHorizontal: editorViewState.scrollbars.resourceHorizontal,
		}, resourcePanelWidthRatio);
		if (!this.isAvailable) {
			configureFontVariant(editorViewState.fontVariant);
			resourcePanel.setFontMetrics(editorViewState.font);
			editorRuntimeState.initialized = false;
			return resourcePanel;
		}
		editorTextModelService.clear();
		configureFontVariant(editorViewState.fontVariant);
		resourcePanel.setFontMetrics(editorViewState.font);
		applySearchFieldText(editorSearchState.query, true);
		applyLineJumpFieldText(lineJumpState.value, true);
		this.completion.closeSession();
		this.completion.enterCommitsCompletion = false;
		problemsPanel.setDiagnostics(this.diagnostics.diagnostics, this.diagnostics.coverage);
		editorViewState.codeVerticalScrollbarVisible = false;
		editorViewState.codeHorizontalScrollbarVisible = false;
		editorViewState.cachedVisibleRowCount = 1;
		editorViewState.cachedContentWidth = 1;
		editorViewState.cachedMaxScrollLeft = 0;
		return resourcePanel;
	}

	private initializeEditorGroup(): void {
		if (!this.isAvailable) {
			return;
		}
		refreshWorkbenchLayout();
		this.editorGroup.panes.layout(getWorkbenchEditorBounds());
		this.editorGroup.clear();
		editorRuntimeState.initialized = true;
	}

	private disableCrtPostprocessingForEditor(): void {
		if (this.crtPostprocessingEnabledBeforeEditor !== null) {
			return;
		}
		this.crtPostprocessingEnabledBeforeEditor = this.presenter.crt_postprocessing_enabled;
		this.presenter.crt_postprocessing_enabled = false;
	}

	private restoreCrtPostprocessingFromEditor(): void {
		const enabled = this.crtPostprocessingEnabledBeforeEditor;
		if (enabled === null) {
			return;
		}
		this.presenter.crt_postprocessing_enabled = enabled;
		this.crtPostprocessingEnabledBeforeEditor = null;
	}

	private enterRenderTargets(): void {
		const presenter = this.presenter;
		presenter.setFixedRenderTargetSize(EDITOR_TARGET_WIDTH, EDITOR_TARGET_HEIGHT);
		this.overlayRenderer.setRenderingViewportType(presenter, 'viewport');
		this.updateViewport(this.overlayRenderer.viewportSize);
	}

	private leaveRenderTargets(): void {
		const presenter = this.presenter;
		presenter.useScanoutRenderTargetSize();
		this.overlayRenderer.setRenderingViewportType(presenter, 'viewport');
		this.updateViewport(this.overlayRenderer.viewportSize);
	}
}
