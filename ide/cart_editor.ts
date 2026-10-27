import { CodeDocumentProjections } from './editor/ui/code/document_projections';
import { WorkbenchInteraction } from './workbench/services/execution/interaction';
import { EditorCloseController } from './workbench/services/editor/editor_close';
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
import { WORKBENCH_TEXT_EDITOR_ID } from './workbench/contrib/code_editor/editor_input';
import { CodeEditorInputSerializer } from './workbench/contrib/code_editor/editor_serializer';
import { BehaviorLensInputSerializer } from './workbench/contrib/behavior_lens/editor_serializer';
import { SceneEditorInputSerializer } from './workbench/contrib/scene_editor/editor_serializer';
import { ScenarioLabInputSerializer } from './workbench/contrib/scenario_lab/editor_serializer';
import { ResourceViewerInputSerializer } from './workbench/contrib/resources/editor_serializer';
import { ContextMenuController } from './workbench/services/context_menu/controller';
import { drawContextMenu, layoutContextMenu } from './workbench/services/context_menu/render';
import type { GraphLayoutEngineFactory } from './workbench/services/graph_layout/engine';
import { SceneEditorController } from './workbench/contrib/scene_editor/controller';
import { QuickInputController } from './workbench/services/quick_input/controller';
import { SceneEditorPane } from './workbench/contrib/scene_editor/editor_pane';
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
import { drawEditorText, setEditorCaseInsensitivity } from './editor/render/text_renderer';
import {
	applyViewportSize,
	configureFontVariant,
} from './editor/ui/view/configuration';
import { editorViewState } from './editor/ui/view/state';
import { updateBlink } from './editor/ui/inline/text_field';
import { inputFocus, InputFocusScope } from './input/focus';
import type { KeyInputEvent, TextInputHost, TextInputTarget } from '../hosts/common/input/text';
import { pointerHover } from './input/pointer/hover';
import { pointerCapture } from './input/pointer/capture';
import { PointerButton } from '../hosts/common/input/pointer_event';
import { WorkbenchSurfaceService } from './workbench/services/windows/service';
import { Scrollbar } from './workbench/ui/scrollbar';
import { focusCapturedRuntimeSource, clearExecutionStopHighlights } from './runtime_error/navigation';
import { getBuiltinIdentifiersSnapshot } from './editor/contrib/intellisense/engine';
import { resetSemanticProjects } from './editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from './editor/model/model_service';
import type { ResourceDiagnosticsService } from './workbench/services/diagnostics/resource_diagnostics';
import { CrossFileRenameManager } from './workbench/contrib/code_editor/rename/operations';
import { WorkspaceEditReviewPane } from './workbench/contrib/edit_review/editor_pane';
import { handleEditorInput } from './input/keyboard/dispatch';
import { captureKeys } from './workbench/contrib/code_editor/input/keyboard/capture_keys';
import { applyEditorInputOverrides } from './workbench/contrib/code_editor/input/keyboard/text_input';
import { handleTextEditorPointerInput, handleWorkbenchChromePointer } from './input/pointer/dispatch';
import { handleEditorWheelInput, handleWorkbenchChromeWheel } from './input/pointer/wheel';
import {
	cancelWorkspaceAutosave,
	requestWorkspaceAutosave,
	runWorkspaceAutosaveTick,
	shutdownWorkspaceStorage,
} from './workbench/workspace/storage';
import { WorkspaceAutosaveChange } from './workbench/workspace/models';
import { getWorkbenchEditorBounds, getWorkbenchWorkArea, refreshWorkbenchLayout, statusAreaHeight, type WorkbenchChromeLayout } from './workbench/common/layout';
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
import { renderTopBar } from './workbench/render/top_bar';
import { layoutTopBar } from './workbench/ui/top_bar/layout';
import { MenubarController } from './workbench/ui/top_bar/controller';
import type { ChromeRenderContext } from './workbench/render/chrome_context';
import { createResourceEditorResolver } from './workbench/contrib/resources/editor_contributions';
import type { ResourceEditorResolver } from './workbench/services/editor/resource_editor_resolver';
import { EditorParts } from './workbench/services/editor/editor_parts';
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
	openPublishedBuild: ((requestId: string) => PublishedBuildOpenResult) | undefined;
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
	readonly interaction: WorkbenchInteraction;
	readonly guestInputRecipient: InputRecipient | null;
	readonly isAvailable: boolean;
	readonly resourcePanel: ResourcePanelController;
	readonly breakpoints: BreakpointController;
	readonly commands: IdeCommandController;
	readonly gamePanel: GamePanel;
	readonly resourceEditors: ResourceEditorResolver;
	readonly editorParts: EditorParts;
	readonly editorClose: EditorCloseController;
	readonly surfaces: WorkbenchSurfaceService;
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
	renderFaultOverlay: () => void;
	renderRuntimeFaultOverlay: (options: RenderRuntimeFaultOverlayOptions) => boolean;
	handleRuntimeTaskError: (error: unknown, fallbackMessage: string) => void;
};

export class RuntimeCartEditor implements CartEditor {
	public readonly play: PlayController;
	public readonly terminal: BiosTerminal;
	public readonly gamePanel: GamePanel;
	public readonly interaction: WorkbenchInteraction;
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
	public readonly isAvailable: boolean;
	public readonly resourcePanel: ResourcePanelController;
	public readonly breakpoints: BreakpointController;
	public readonly commands: IdeCommandController;
	public readonly resourceEditors: ResourceEditorResolver;
	public readonly editorParts: EditorParts;
	public readonly editorClose: EditorCloseController;
	public readonly surfaces: WorkbenchSurfaceService;
	private readonly chromeScope = Symbol('workbench chrome');
	private readonly resourceResizeScope = Symbol('resource panel resize');
	private readonly resourceVerticalScope = Symbol('resource panel vertical scrollbar');
	private readonly resourceHorizontalScope = Symbol('resource panel horizontal scrollbar');
	private readonly problemsResizeScope = Symbol('problems panel resize');
	private readonly rootSurfaceBounds = { left: 0, top: 0,
		get right() { return editorViewState.viewportWidth; },
		get bottom() { return editorViewState.viewportHeight; },
	};
	private readonly unbindSurfaceAdmission: () => void;
	private readonly onSurfaceChange = (): void => {
		const pointer = this.pointerSnapshot;
		const hit = pointer.valid && pointer.insideViewport ? this.surfaces.hitTest(pointer.viewportX, pointer.viewportY) : null;
		pointerHover.reconcileRoute(hit !== null && this.surfaces.isAdmitted(hit) ? hit.captureScope : undefined);
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
	public readonly actionPrompt: ActionPrompt;
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
	private readonly unsubscribeTextModelChanged: () => void;
	private readonly unsubscribeDiagnosticsChanged: () => void;
	private readonly unbindHostInput: () => void;
	private readonly unbindNavigation: () => void;
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
	public openPublishedBuild: ((requestId: string) => PublishedBuildOpenResult) | undefined;
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
			actorExecution, frameNavigation } = workbench;
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
		this.interaction = new WorkbenchInteraction(inputFocus, workbench.transport);
		this.commands = new IdeCommandController(
			this,
			sources,
			fault,
			debuggerState,
			hotResumes,
			boots,
			runtimeTasks,
			execution,
			overlayRenderer,
			workbench.transport,
			workbench.runTargets,
			clock,
			logOutput,
			textFileSaves,
		);
		inputFocus.workbenchScope.commands = this.commands;
		const workArea = getWorkbenchWorkArea();
		this.resourcePanel = this.initialize(resourcePanelWidthRatio, viewport, fontVariant);
		this.surfaces = new WorkbenchSurfaceService(this.onSurfaceChange);
		this.contextMenu = new ContextMenuController(inputFocus, pointerCapture, this.attachContextMenuSession);
		this.menubar = new MenubarController(this.contextMenu, this.commands, this.chromeRenderContext);
		this.quickInput = new QuickInputController(this.contextMenu, () => this.surfaces.changed(),
			next => next !== null && this.surfaces.isInContext(next.scope.surfaceScope, this.quickInput.pointerScope),
			{ scope: inputFocus.workbenchScope, bounds: this.rootSurfaceBounds, kind: 'workspace' });
		this.actionPrompt = new ActionPrompt(inputFocus, pointerCapture, () => this.surfaces.changed(),
			next => next !== null && this.surfaces.isInContext(next.scope.surfaceScope, this.actionPrompt.pointerScope),
			{ scope: inputFocus.workbenchScope, bounds: this.rootSurfaceBounds, kind: 'workspace' });
		const chromeSurface = this.surfaces.attach({
			role: 'content', captureScope: this.chromeScope, isVisible: () => true,
			getBounds: () => this.rootSurfaceBounds, getClip: () => this.rootSurfaceBounds,
			draw: () => this.drawWorkbenchChrome(),
			handlePointer: snapshot => handleWorkbenchChromePointer(this, snapshot),
			handleWheel: event => handleWorkbenchChromeWheel(this, event),
			onRetire: () => pointerCapture.cancelScope(this.chromeScope),
		});

		this.editorParts = new EditorParts({
			surfaces: this.surfaces, owner: chromeSurface, scope: inputFocus.workbenchScope, workArea,
			commands: this.commands, contextMenu: this.contextMenu, renderContext: this.chromeRenderContext,
			layoutMain: () => this.layoutMainEditor(),
			focusReturn: this.resourcePanel.focusTarget, factories: {
			home: group => new HomeEditorPane(this.commands, group.focusScope),
			play_session: group => new PlayEditorPane(this.commands, this.contextMenu, this.navigation, group, group.focusScope),
			animation: group => new AnimationEditorPane(this.animations, this.commands, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope, this.editorParts.partForGroup(group).quickInput),
			host_error: group => new HostErrorPane(group.focusScope),
			build_log: group => new BuildLogPane(this.clipboard, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope),
			rom_inspector: group => new RomInspectorPane(this.commands, this.sources, this.navigation, this.editorParts.partForGroup(group).quickInput, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope),
			event_viewer: group => new EventViewerPane(this.editorParts.partForGroup(group).quickInput, this.commands, frameNavigation, this.contextMenu,
				this.surfaces, group.paneSurface, group.workArea, group.focusScope),
			gpu_debugger: group => new GpuDebuggerPane(this.editorParts.partForGroup(group).quickInput, this.commands, frameNavigation, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope),
			gte_debugger: group => new GteDebuggerPane(this.editorParts.partForGroup(group).quickInput, this.commands, frameNavigation, this.contextMenu, this.sources, this.navigation, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope),
			terminal: group => new TerminalPane(this.terminal, input, presenter, group.focusScope, workbench.transport),
			conversation_observer: group => new ConversationObserverPane(decodeImage, this.surfaces, group.paneSurface, this.commands, group.focusScope),
			assistant: group => new AssistantPane(this.clipboard, group, this.assistantCommands, decodeImage,
				this.surfaces, group.paneSurface, this.commands, this.contextMenu, group.workArea, group.focusScope),
			workspace_edit_review: group => new WorkspaceEditReviewPane(group, this.editorParts.partForGroup(group).quickInput, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope),
			code_editor: group => new CodeEditorPane(
				group.focusScope,
				group,
				this,
				this.clipboard,
				this.sources,
				this.guest,
				this.fault,
				this.runtime,
				this.debuggerState,
				this.clock,
			),
			resource_view: group => new ResourceViewerEditorPane(group.focusScope),
			aem_editor: group => new AemEditorPane(this.aemEditor, this.commands, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope, this.editorParts.partForGroup(group).quickInput),
			lua_program: group => new LuaProgramEditorPane(this.luaPrograms, this.commands, this.actionStrings, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope, this.editorParts.partForGroup(group).quickInput),
			behavior_lens: group => new BehaviorLensEditorPane(this.behaviorLens, this.commands, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope, this.editorParts.partForGroup(group).quickInput),
			actor_lab: group => new ActorLabEditorPane(this.commands, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope),
			game_view: group => new GameViewEditorPane(this.commands, this.contextMenu, runtime, input, presenter, group.focusScope),
			cart_map: group => new CartMapPane(this.cartMaps, this.commands, this.sources, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope),
			scene_editor: group => new SceneEditorPane(this.sceneEditor, this.commands, this.sources, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, this.editorParts, group.focusScope),
			scenario_lab: group => new ScenarioLabEditorPane(
				this.scenarioLab,
				this.commands,
				this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope),
		}, closeEditors: (targets, origin, prompt) => this.editorClose.close(targets, origin, prompt),
		});
		this.editorClose = new EditorCloseController(this.editorParts.groups, textFileSaves, this.actionPrompt, editorTextModelService);
		this.surfaces.attach({
			role: 'content', lifetimeOwner: chromeSurface, presentationParent: chromeSurface, captureScope: this.resourceResizeScope,
			isVisible: () => this.resourcePanel.isVisible(), getBounds: () => this.resourcePanel.resizeBounds,
			getClip: () => this.rootSurfaceBounds, draw() {},
			handlePointer: snapshot => {
				if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) this.resourcePanel.beginResize(snapshot);
			},
			onRetire: () => pointerCapture.cancelTarget(this.resourcePanel),
		});
		this.surfaces.attach({
			role: 'content', lifetimeOwner: chromeSurface, presentationParent: chromeSurface, captureScope: this.problemsResizeScope,
			isVisible: () => problemsPanel.isVisible, getBounds: () => problemsPanel.resizeBounds,
			getClip: () => this.rootSurfaceBounds, draw() {},
			handlePointer: snapshot => {
				if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0) problemsPanel.beginResize(snapshot);
			},
			onRetire: () => pointerCapture.cancelTarget(problemsPanel),
		});
		this.surfaces.attach({
			role: 'content', lifetimeOwner: chromeSurface, presentationParent: chromeSurface, captureScope: this.resourceVerticalScope,
			isVisible: () => this.resourcePanel.isVisible() && this.resourcePanel.resourceVertical.isVisible(),
			getBounds: () => this.resourcePanel.resourceVertical.getTrack(), getClip: () => this.rootSurfaceBounds, draw() {},
			handlePointer: snapshot => { this.resourcePanel.handleScrollbarPointer(snapshot); },
			handleWheel: event => handleWorkbenchChromeWheel(this, event),
			onRetire: () => pointerCapture.cancelScope(this.resourceVerticalScope),
		});
		this.surfaces.attach({
			role: 'content', lifetimeOwner: chromeSurface, presentationParent: chromeSurface, captureScope: this.resourceHorizontalScope,
			isVisible: () => this.resourcePanel.isVisible() && this.resourcePanel.resourceHorizontal.isVisible(),
			getBounds: () => this.resourcePanel.resourceHorizontal.getTrack(), getClip: () => this.rootSurfaceBounds, draw() {},
			handlePointer: snapshot => { this.resourcePanel.handleScrollbarPointer(snapshot); },
			handleWheel: event => handleWorkbenchChromeWheel(this, event),
			onRetire: () => pointerCapture.cancelScope(this.resourceHorizontalScope),
		});
		this.menubar.attach(this.surfaces, chromeSurface, workArea);
		this.surfaces.attach({
			role: 'modal', blockedScope: null, presentationParent: null, captureScope: this.quickInput.pointerScope,
			isVisible: () => this.quickInput.visible, getBounds: () => this.quickInput.layout.bounds,
			getClip: () => this.rootSurfaceBounds, draw: () => this.quickInput.draw(),
			handlePointer: snapshot => this.quickInput.handlePointer(snapshot, (snapshot.justPressedButtons & PointerButton.Primary) !== 0),
			handleWheel: event => { this.quickInput.handleWheel(event.deltaY); return true; },
			onRetire: () => pointerCapture.cancelScope(this.quickInput.pointerScope),
		});
		this.surfaces.attach({
			role: 'modal', blockedScope: null, presentationParent: null, captureScope: this.actionPrompt.pointerScope,
			isVisible: () => this.actionPrompt.visible, getBounds: () => this.actionPrompt.view.bounds,
			getClip: () => this.rootSurfaceBounds, draw: () => this.actionPrompt.draw(),
			handlePointer: snapshot => this.actionPrompt.handlePointer(snapshot),
			onRetire: () => pointerCapture.cancelScope(this.actionPrompt.pointerScope),
		});
		this.resourcePanel.focusTarget.scope.surfaceScope = this.chromeScope;
		problemsPanel.focusTarget.scope.surfaceScope = this.chromeScope;
		this.resourceEditors = createResourceEditorResolver(
			this.sources.catalog,
		);

		this.gamePanel = new GamePanel(this.editorParts.main.group.panes, this.commands, this.contextMenu, input, presenter,
			new InputFocusScope(this.chromeScope, this.editorParts.main.scope));
		this.assistantCommands = new AssistantChatCommands(this.assistant, this.editorParts.main.group, this.quickInput, this.clipboard);
		this.navigation = new EditorNavigationController(
			this.sources.catalog,
			this.resourcePanel,
			this.resourceEditors,
		);
		this.cartMaps = new CartMapController(this.sources.catalog);
		this.sceneEditor = new SceneEditorController(this.sources.catalog, this.navigation);
		this.animations = new AnimationEditorController(this.sources.catalog, this.navigation);
		this.actorLab = new ActorLabController(sources, guest, runtime.machine.cpu,
			this.quickInput, this.editorParts.main.group, this.navigation, actorExecution, rewind, sources,
			{ kind: 'direct', presenter, recipient: input, transport: this.commands.transport });

		const behaviorRegistrations = behaviorSources.registrations;
		this.play = new PlayController(this, playSessions, scenarioRuns, sources);
		this.behaviorLens = new BehaviorLensController(
			this.sources,
			this.navigation,
			behaviorSources,
			createGraphLayoutEngine,
			guest,
			rewind,
			workbench.transport,
		);
		this.scenarioLab = new ScenarioLabController(
			this,
			this.navigation,
			this.editorParts.main.group,
			behaviorRegistrations,
			scenarioRuns,
			this.play,
		);
		this.aemEditor = new AemEditorController(sources, guest, runtime, runtimeTasks);
		this.luaPrograms = new LuaProgramController(sources, guest, this.navigation, rewind, workbench.transport);
		this.actionStrings = new ActionStringTester(sources.catalog, clock, this.quickInput, scenarioRuns, this.scenarioLab);
		this.editorInputSerializers = {
			home: { serialize: () => '', deserialize: () => new HomeInput(workspaceState.context) },
			animation: new AnimationInputSerializer(sources.catalog, this.animations),
			aem_editor: new AemEditorInputSerializer(sources.catalog),
			lua_program: new LuaProgramInputSerializer(sources.catalog, this.luaPrograms),
			event_viewer: { serialize: () => '', deserialize: () => new EventViewerInput(this.events) },
			terminal: { serialize: () => '', deserialize: () => new TerminalInput() },
			actor_lab: { serialize: () => '', deserialize: () => this.actorLab.resolveInput() },
			game_view: { serialize: () => '', deserialize: () => new GameViewInput() },
			code_editor: new CodeEditorInputSerializer(sources.catalog),
			behavior_lens: new BehaviorLensInputSerializer(sources.catalog, this.behaviorLens),
			cart_map: new CartMapInputSerializer(sources.catalog),
			scene_editor: new SceneEditorInputSerializer(sources.catalog, this.sceneEditor),
			scenario_lab: new ScenarioLabInputSerializer(this.scenarioLab),
			resource_view: new ResourceViewerInputSerializer(sources.catalog),
		};
		this.crossFileRename = new CrossFileRenameManager(this.sources.catalog);
		this.unbindProblemsPanel = problemsPanel.focusTarget.bindKeyboard(
			input => problemsPanel.handleKeyboard(input, this.editorParts),
		);
		this.breakpoints = new BreakpointController(debuggerState);
		this.unbindBreakpoints = debuggerState.breakpoints.onDidChange(() => requestWorkspaceAutosave(WorkspaceAutosaveChange.Breakpoints));
		this.unbindSourceStop = debuggerState.source.onDidChangeStop(stop => {
			if (stop === undefined) for (const group of this.editorParts.groups) clearExecutionStopHighlights(group);
		});
		this.unbindNavigation = initializeNavigationState(this.editorParts.main.group);
		this.initializeEditorGroup();
		this.unsubscribeTextModelChanged = editorTextModelService.onDidChangeContent((model, event) => {
			if (model.mode === 'lua') {
				invalidateLuaCommentContextFromRow(model.buffer, event.startRow);
			}
			requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
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
		pointerHover.dispatchModifiers(event.modifiers);
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
		handleTextEditorPointerInput(this.pointerSnapshot, event, this.surfaces);
		// Selection and native focus must be published before this trusted gesture returns.
		if ((event.buttons | event.pressedButtons | event.releasedButtons) !== 0) inputFocus.notifyTargetChanged();
	}

	public cancelPointerInput(): void {
		pointerCapture.interrupt(this.input.pointerButtonsDown);
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
		return handleEditorWheelInput(this.surfaces, this.wheelSnapshot, event);
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
		applyEditorInputOverrides(this.input, true, captureKeys);
		this.input.setPointerAdmissionMode('routed');
		if (!wasActive) pointerCapture.interrupt(this.input.pointerButtonsDown);
		for (const group of this.editorParts.groups) {
			const activeTab = group.model.activeTab;
			if (activeTab !== null) group.activate(activeTab.id, undefined, undefined, true);
		}
		this.editorParts.activePart.focus();
		editorRuntimeState.active = true;
		this.interaction.setActive(true);
		if (!wasActive) this.enterRenderTargets();
		this.diagnostics.setEnabled(true);
		this.overlayRenderer.active = true;
		setEditorFeedbackActive(true);
		this.actionPrompt.close();
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
		this.interaction.setActive(false);
		this.menubar.cancelAlt();
		pointerCapture.cancel();
		this.input.setPointerAdmissionMode('physical');
		this.guest.invalidate();
		pointerHover.clear();
		const wasActive = this.isActive;
		this.editorParts.suspend();
		for (const group of this.editorParts.groups) group.panes.clearEditor();
		editorRuntimeState.active = false;
		this.overlayRenderer.active = false;
		setEditorFeedbackActive(false);
		if (editorViewState.dimCrtInEditor) {
			this.restoreCrtPostprocessingFromEditor();
		}
		applyEditorInputOverrides(this.input, false, captureKeys);
		this.actionPrompt.close();
		if (this.resourcePanel.refresh()) refreshWorkbenchLayout();
		this.diagnostics.setEnabled(false);
		if (wasActive) this.leaveRenderTargets();
		if (wasActive) for (const listener of this.activeListeners) listener(false);
	}

	public tickInput(): void {
		if (!this.acceptsInput) return;
		const playerInput = this.input.getPlayerInput(1);
		editorRuntimeState.currentTimeMs = this.clock.now();
		if (this.actionPrompt.visible) return;
		inputFocus.handleGamepad(playerInput);
	}

	private readonly tabStripBounds = create_rect_bounds();
	private readonly mainTimelineBounds = create_rect_bounds();
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
		const strip = this.editorParts.main.group.tabStrip;
		if (strip.needsLayout) strip.layout(this.tabStripBounds, this.tabStripLayoutContext);
		editorViewState.tabBarTotalHeight = strip.layoutState.totalHeight;
	}

	private layoutMainPart(): void {
		const bottom = editorViewState.viewportHeight - statusAreaHeight();
		write_rect_bounds(this.mainTimelineBounds, 0, bottom - this.editorParts.main.timeline.height, editorViewState.viewportWidth, bottom);
		this.editorParts.main.layoutMain(getWorkbenchEditorBounds(), this.mainTimelineBounds);
	}

	private layoutMainEditor(): void {
		this.layoutEditorTabStrip();
		editorChromeState.runtimeTimelineHeight = this.editorParts.main.timeline.height;
		let layoutChanged = refreshWorkbenchLayout();
		if (this.resourcePanel.refresh()) layoutChanged = refreshWorkbenchLayout() || layoutChanged;
		if (this.gamePanel.update()) layoutChanged = refreshWorkbenchLayout() || layoutChanged;
		if (layoutChanged) this.surfaces.changed();
		this.layoutMainPart();
	}

	public update(deltaSeconds: number): void {
		editorRuntimeState.currentTimeMs = this.clock.now();
		updateBlink(deltaSeconds);
		updateEditorMessage(deltaSeconds);
		layoutTopBar(this.chromeRenderContext, this.menubar.expanded);
		this.menubar.update();
		this.editorParts.main.group.tabStrip.update(editorRuntimeState.currentTimeMs);
		this.layoutMainEditor();
		this.editorParts.update(deltaSeconds);
		problemsPanel.update();
		this.quickInput.update();
		this.actionPrompt.update();
		this.contextMenu.update();
		layoutContextMenu(this.contextMenu);
	}

	public updateViewport(viewport: Viewport): void {
		applyViewportSize(viewport);
		layoutTopBar(this.chromeRenderContext, this.menubar.expanded);
		this.menubar.update();
		this.layoutMainEditor();
		problemsPanel.update();
		this.surfaces.changed();
	}

	public draw(): void {
		api.fill_rect(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, 0, constants.COLOR_FRAME);

		this.surfaces.draw(api);
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
		drawProblemsPanel();
		let contextTarget = inputFocus.target;
		if (contextTarget === this.contextMenu.focusTarget) contextTarget = this.contextMenu.invocationOrigin;
		if (contextTarget === this.quickInput.field.focusTarget) contextTarget = this.quickInput.invocationOrigin;
		if (contextTarget === this.actionPrompt.focusTarget) contextTarget = this.actionPrompt.invocationOrigin;
		renderStatusBar(this.resourcePanel, this.fault, this.editorParts.main.group.panes.activePane, this.luaEvaluation, this.serverConnectionState,
			contextTarget === null ? null : contextTarget.commandContext);
	}

	public async shutdown(): Promise<void> {
		this.interaction.dispose();
		this.editorClose.dispose();
		inputFocus.workbenchScope.commands = undefined;
		this.unbindHostInput();
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
		this.menubar.dispose();
		this.gamePanel.dispose();
		this.quickInput.dispose();
		this.unbindProblemsPanel();
		problemsPanel.detach();
		if (this.isAvailable) {
			this.editorParts.main.group.panes.clearEditor();
		}
		applyEditorInputOverrides(this.input, false, captureKeys);
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
				this.editorParts.dispose();
				this.unbindNavigation();
				this.scenarioLab.dispose();
				this.unsubscribeTextModelChanged();
				this.codeDocuments.dispose();
				editorTextModelService.clear();
				this.sources.catalog.dispose();
			}
		}
		this.resourcePanel.hide();
	}

	public setFontVariant(variant: FontVariant): void {
		if (!this.isAvailable) {
			return;
		}
		const previousVariant = editorViewState.fontVariant;
		configureFontVariant(variant);
		this.resourcePanel.setFontMetrics(editorViewState.font);
		if (editorViewState.fontVariant !== previousVariant) {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.Font);
		}
	}

	public showRuntimeErrorInChunk(resource: ResourceIdentity, line: number, column: number, message: string, details?: RuntimeErrorDetails): void {
		if (!editorRuntimeState.active) {
			this.activate();
		}
		const group = this.editorParts.documentDestination(this.editorParts.activeGroup, { resource, editorId: WORKBENCH_TEXT_EDITOR_ID });
		if (details !== undefined) {
			const frame = details.luaStack.find(frame => frame.kind === 'source')!;
			void focusCapturedRuntimeSource(this.navigation, group, this.sources.catalog, resource, details.sources.get(frame)!)
				.then(receipt => {
					if (receipt === undefined || receipt.generation !== group.panes.openGeneration
						|| receipt.model.version !== receipt.version || editorTextModelService.get(resource) !== receipt.model) return;
					const pane = group.panes.getPane('code_editor') as CodeEditorPane;
					pane.showRuntimeError(line, column, message, details, resource.path);
				})
				.catch(error => showEditorMessage(`Failed to open runtime source: ${String(error)}`, 'error', 4.0));
			return;
		}
		void this.navigation.focusChunkSource(group, resource)
			.then(generation => {
				if (generation !== group.panes.openGeneration) return;
				const pane = group.panes.getPane('code_editor') as CodeEditorPane;
				pane.showRuntimeError(line, column, message, details, resource.path);
			})
			.catch(error => showEditorMessage(`Failed to open runtime source: ${String(error)}`, 'error', 4.0));
	}

	public renderFaultOverlay(): void {
		const snapshot = this.fault.faultSnapshot;
		if (!snapshot) {
			return;
		}
		if (snapshot.resource === undefined) {
			showEditorMessage(snapshot.message, 'error', 4.0);
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
		if (snapshot.resource === undefined) {
			showEditorMessage(snapshot.message, 'error', 4.0);
			return true;
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
		const resourcePanel = new ResourcePanelController(this, this.sources.catalog, {
			resourceVertical: new Scrollbar('vertical'),
			resourceHorizontal: new Scrollbar('horizontal'),
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
		problemsPanel.setDiagnostics(this.diagnostics.diagnostics, this.diagnostics.coverage);
		return resourcePanel;
	}

	private initializeEditorGroup(): void {
		if (!this.isAvailable) {
			return;
		}
		refreshWorkbenchLayout();
		this.layoutMainPart();
		this.editorParts.main.group.clear();
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
