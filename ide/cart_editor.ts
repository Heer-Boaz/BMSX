import { CodeDocumentProjections } from './editor/ui/code/document_projections';
import { WorkbenchInteraction } from './workbench/services/execution/interaction';
import { MainWorkspace } from './workbench/main_workspace';
import { WorkbenchRegionNavigation } from './workbench/region_navigation';
import { drawWorkbenchSplit } from './workbench/render/split_view';
import type { MainWorkspaceClient, MainWorkspaceRegionSurfaces } from './workbench/common/main_workspace_client';
import type { SerializedPrimaryClient } from './workbench/common/main_workspace_serialization';
import type { FontVariant } from '../machine/ts/render/shared/bmsx_font';
import { HomeInput } from './workbench/contrib/home/editor_input';
import { HomeEditorPane } from './workbench/contrib/home/editor_pane';
import { measureHomeEditor } from './workbench/contrib/home/layout';
import { measureUnconstrainedEditor } from './workbench/services/editor/editor_pane';
import { measureSourceEditor } from './workbench/contrib/code_editor/constraints';
import { measureAnimationEditorConstraints } from './workbench/contrib/animation/layout';
import { measureAemEditor } from './workbench/contrib/aem/constraints';
import { measureLuaProgramEditor } from './workbench/contrib/lua_program/constraints';
import { measureBehaviorLensEditor } from './workbench/contrib/behavior_lens/layout';
import { measureScenarioLabEditor } from './workbench/contrib/scenario_lab/layout';
import { measureCartMapEditor } from './workbench/contrib/cart_maps/layout';
import { measureSceneEditor } from './workbench/contrib/scene_editor/layout';
import { measureEventViewerEditor } from './workbench/contrib/events/layout';
import { measureRomInspectorEditor } from './workbench/contrib/rom_inspector/constraints';
import { measureGteDebuggerEditor } from './workbench/contrib/gte_debugger/constraints';
import { measureGpuDebuggerEditor } from './workbench/contrib/gpu_debugger/constraints';
import { measureResourceViewerEditor } from './workbench/contrib/resources/constraints';
import { measureHostErrorEditor } from './workbench/contrib/host_error/constraints';
import { measureWorkspaceEditReviewEditor } from './workbench/contrib/edit_review/constraints';
import { measureBuildLogEditor } from './workbench/contrib/builds/constraints';
import { measureTranscriptEditor } from './workbench/contrib/assistant/constraints';
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
import { BuildOutputs } from './workbench/contrib/builds/output';
import { BuildOutputActivity } from './workbench/contrib/builds/activity';
import { chooseBuildOutput } from './workbench/contrib/builds/commands';
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
import { ProjectContentIndex } from './workbench/contrib/resources/panel/content_index';
import { GameViewInput } from './workbench/contrib/game_view/editor_input';
import { GameViewEditorPane } from './workbench/contrib/game_view/editor_pane';
import { GamePanel } from './workbench/contrib/game_view/game_panel';
import { ActorLabEditorPane } from './workbench/contrib/actor_lab/editor_pane';
import type { EditorInputSerializers } from './workbench/services/editor/editor_serialization';
import { WORKBENCH_TEXT_EDITOR_ID } from './workbench/contrib/code_editor/editor_input';
import { CodeEditorInputSerializer } from './workbench/contrib/code_editor/editor_serializer';
import { BehaviorLensInputSerializer } from './workbench/contrib/behavior_lens/editor_serializer';
import { CallHierarchyPane } from './workbench/contrib/call_hierarchy/editor_pane';
import { WorkspaceSearchPane, measureWorkspaceSearchInput } from './workbench/contrib/workspace_search/editor_pane';
import { SceneEditorInputSerializer } from './workbench/contrib/scene_editor/editor_serializer';
import type { WorkspaceDirectoryModel } from './workspace/directory_model';
import { ScenarioLabInputSerializer } from './workbench/contrib/scenario_lab/editor_serializer';
import { ResourceViewerInputSerializer } from './workbench/contrib/resources/editor_serializer';
import { ContextMenuController } from './workbench/services/context_menu/controller';
import { drawContextMenu, layoutContextMenu } from './workbench/services/context_menu/render';
import type { GraphLayoutEngineFactory } from './workbench/services/graph_layout/engine';
import { SceneEditorController } from './workbench/contrib/scene_editor/controller';
import type { SceneAuthoredSubject } from './workbench/contrib/scene_editor/authoring_context';
import { createScenePrimaryClient, type ScenePrimaryClientOptions } from './workbench/contrib/scene_editor/primary_client';
import { restoreScenePrimaryClient } from './workbench/contrib/scene_editor/primary_serialization';
import type { RestoreScenePrimaryBookmark } from './workbench/contrib/scene_editor/primary_location';
import type { EditorTextModel } from './editor/model/text_model';
import type { InputFocusTarget } from './input/focus';
import { saveTextFileFromCommand } from './commands/source_save';
import { createProjectRunCommand } from './commands/run_source';
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
import { measureText } from './editor/common/text/layout';
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
import { getWorkbenchEditorBounds, getWorkbenchWorkArea, refreshWorkbenchLayout, type WorkbenchChromeLayout } from './workbench/common/layout';
import { BreakpointController } from './workbench/contrib/debugger/controller';
import { ActionPrompt } from './workbench/contrib/modal/action_prompt';
import { ProblemsPanelController } from './workbench/contrib/problems/panel/controller';
import { ResourcePanelController } from './workbench/contrib/resources/panel/controller';
import { IdeCommandController } from './commands/controller';
import { initializeNavigationState } from './navigation/navigation_history';
import { EditorNavigationController } from './workbench/contrib/resources/navigation';
import { BehaviorLensController } from './workbench/contrib/behavior_lens/controller';
import type { StudioWorkbench } from './workbench/workbench';
import { ScenarioLabController } from './workbench/contrib/scenario_lab/controller';
import { drawResourcePanel } from './workbench/render/resource_panel';
import { WorkbenchWindowStatus } from './workbench/ui/window/status';
import { EditorCommandKeybindingController } from './input/keyboard/global_bindings';
import { WorkbenchStatusBar } from './workbench/ui/status_bar/control';
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
	readonly directories: WorkspaceDirectoryModel | undefined;
	readonly events: RuntimeEventHistory;
	readonly gte: RuntimeGteHistory;
	readonly gpu: RuntimeGpuHistory;
	builds: WorkspaceBuilds | undefined;
	readonly buildOutputs: BuildOutputs | undefined;
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
	readonly isClosing: boolean;
	readonly resourcePanel: ResourcePanelController;
	readonly breakpoints: BreakpointController;
	readonly commands: IdeCommandController;
	readonly keybindings: EditorCommandKeybindingController;
	readonly gamePanel: GamePanel;
	readonly resourceEditors: ResourceEditorResolver;
	readonly editorParts: EditorParts;
	readonly mainWorkspace: MainWorkspace;
	readonly regionNavigation: WorkbenchRegionNavigation;
	readonly statusBar: WorkbenchStatusBar;
	readonly problems: ProblemsPanelController;
	readonly buildOutput: BuildOutputActivity;
	readonly surfaces: WorkbenchSurfaceService;
	readonly editorInputSerializers: EditorInputSerializers;
	readonly navigation: EditorNavigationController;
	readonly cartMaps: CartMapController;
	readonly sceneEditor: SceneEditorController;
	openSceneInMain(model: EditorTextModel, subject: SceneAuthoredSubject, origin: InputFocusTarget): Promise<boolean>;
	restorePrimaryClient(record: SerializedPrimaryClient, regions: MainWorkspaceRegionSurfaces, scope: InputFocusScope, isCurrent: () => boolean): Promise<MainWorkspaceClient | undefined>;
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
	public get directories(): WorkspaceDirectoryModel | undefined { return this.workbench.directories; }
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
	private shutdownOperation: Promise<void> | undefined;
	public get isClosing(): boolean { return this.shutdownOperation !== undefined; }
	public readonly isAvailable: boolean;
	public readonly resourcePanel: ResourcePanelController;
	public readonly breakpoints: BreakpointController;
	public readonly commands: IdeCommandController;
	public readonly keybindings: EditorCommandKeybindingController;
	public readonly resourceEditors: ResourceEditorResolver;
	public readonly editorParts: EditorParts;
	public readonly mainWorkspace: MainWorkspace;
	public readonly regionNavigation: WorkbenchRegionNavigation;
	public readonly statusBar: WorkbenchStatusBar;
	public readonly problems: ProblemsPanelController;
	public readonly buildOutput: BuildOutputActivity;
	private readonly scenePrimaryOptions: Omit<ScenePrimaryClientOptions, 'regions' | 'scope'>;
	private readonly windowStatus: WorkbenchWindowStatus;
	public readonly surfaces: WorkbenchSurfaceService;
	private readonly chromeScope = Symbol('workbench chrome');
	private readonly resourceVerticalScope = Symbol('resource panel vertical scrollbar');
	private readonly resourceHorizontalScope = Symbol('resource panel horizontal scrollbar');
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
	private readonly unbindWorkspaceModels: () => void;
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
	private buildsValue: WorkspaceBuilds | undefined;
	private buildOutputsValue: BuildOutputs | undefined;
	public get buildOutputs(): BuildOutputs | undefined { return this.buildOutputsValue; }
	public get builds(): WorkspaceBuilds | undefined { return this.buildsValue; }
	public set builds(builds: WorkspaceBuilds | undefined) {
		if (this.buildsValue === builds) return;
		const previous = this.buildOutputsValue;
		this.buildsValue = builds;
		this.buildOutputsValue = builds === undefined ? undefined : new BuildOutputs(builds);
		previous?.dispose();
	}
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
		this.tools.revealTestRun = run => this.scenarioLab.revealRun(run, this.editorParts.activeGroup);
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
		this.keybindings = new EditorCommandKeybindingController(inputFocus, clock);
		inputFocus.workbenchScope.commands = this.commands;
		this.resourcePanel = this.initialize(resourcePanelWidthRatio, viewport, fontVariant,
			new ProjectContentIndex(editorTextModelService, sources.catalog, behaviorSources.registrations, workbench.sceneSources));
		refreshWorkbenchLayout();
		const workArea = getWorkbenchWorkArea();
		this.surfaces = new WorkbenchSurfaceService(this.onSurfaceChange);
		this.contextMenu = new ContextMenuController(inputFocus, pointerCapture, this.rootSurfaceBounds, this.attachContextMenuSession);
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

		this.mainWorkspace = new MainWorkspace(this.surfaces, chromeSurface, inputFocus.workbenchScope, this.commands,
			() => this.layoutMainEditor(), () => this.editorParts.activate(this.editorParts.main, this.mainWorkspace),
			focus => { if (focus) this.editorParts.main.focus(); else this.editorParts.activate(this.editorParts.main); },
			() => this.editorParts.main.activeGroup, this.contextMenu, workArea);
		this.editorParts = new EditorParts({
			surfaces: this.surfaces, owner: chromeSurface, scope: inputFocus.workbenchScope, workArea,
			mainPresentation: this.mainWorkspace,
			workingCopyConsumers: () => this.mainWorkspace.workingCopyConsumers(),
			commands: this.commands, contextMenu: this.contextMenu, renderContext: this.chromeRenderContext,
			layoutMain: () => this.layoutMainEditor(),
			focusReturn: this.resourcePanel.focusTarget, contributions: {
			home: { create: group => new HomeEditorPane(this.commands, group.focusScope), measure: measureHomeEditor },
			play_session: { create: group => new PlayEditorPane(this.commands, this.play, this.contextMenu, this.navigation, group,
				this.editorParts.partForGroup(group).quickInput, group.focusScope), measure: measureUnconstrainedEditor },
			animation: { create: group => new AnimationEditorPane(this.animations, this.commands, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope, this.editorParts.partForGroup(group).quickInput, this.navigation), measure: measureAnimationEditorConstraints },
			host_error: { create: group => new HostErrorPane(group.focusScope), measure: measureHostErrorEditor },
			call_hierarchy: { create: group => new CallHierarchyPane(group, this.commands, this.sources.catalog, this.contextMenu, this.surfaces, group.workArea), measure: measureUnconstrainedEditor },
			workspace_search: { create: group => new WorkspaceSearchPane(group, this.commands, this.sources.catalog, this.contextMenu, this.surfaces, group.workArea), measure: measureWorkspaceSearchInput },
			build_log: { create: group => new BuildLogPane(this.clipboard, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope), measure: measureBuildLogEditor },
			rom_inspector: { create: group => new RomInspectorPane(this.commands, this.sources, this.navigation, this.editorParts.partForGroup(group).quickInput, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope), measure: measureRomInspectorEditor },
			event_viewer: { create: group => new EventViewerPane(this.editorParts.partForGroup(group).quickInput, this.commands, frameNavigation, this.contextMenu,
				this.surfaces, group.paneSurface, group.workArea, group.focusScope), measure: measureEventViewerEditor },
			gpu_debugger: { create: group => new GpuDebuggerPane(this.editorParts.partForGroup(group).quickInput, this.commands, frameNavigation, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope), measure: measureGpuDebuggerEditor },
			gte_debugger: { create: group => new GteDebuggerPane(this.editorParts.partForGroup(group).quickInput, this.commands, frameNavigation, this.contextMenu, this.sources, this.navigation, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope), measure: measureGteDebuggerEditor },
			terminal: { create: group => new TerminalPane(this.terminal, input, presenter, group.focusScope, workbench.transport), measure: measureUnconstrainedEditor },
			conversation_observer: { create: group => new ConversationObserverPane(decodeImage, this.surfaces, group.paneSurface, this.commands, group.focusScope), measure: measureTranscriptEditor },
			assistant: { create: group => new AssistantPane(this.clipboard, group, this.editorParts.partForGroup(group).quickInput, this.assistantCommands, decodeImage,
				this.surfaces, group.paneSurface, this.commands, this.contextMenu, group.workArea, group.focusScope), measure: measureTranscriptEditor },
			workspace_edit_review: { create: group => new WorkspaceEditReviewPane(group, this.editorParts.partForGroup(group).quickInput, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope), measure: measureWorkspaceEditReviewEditor },
			code_editor: { create: group => new CodeEditorPane(
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
			), measure: measureSourceEditor },
			resource_view: { create: group => new ResourceViewerEditorPane(group.focusScope, this.commands, this.contextMenu), measure: measureResourceViewerEditor },
			aem_editor: { create: group => new AemEditorPane(this.aemEditor, this.commands, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope, this.editorParts.partForGroup(group).quickInput), measure: measureAemEditor },
			lua_program: { create: group => new LuaProgramEditorPane(this.luaPrograms, this.commands, this.actionStrings, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope, this.editorParts.partForGroup(group).quickInput), measure: measureLuaProgramEditor },
			behavior_lens: { create: group => new BehaviorLensEditorPane(this.behaviorLens, this.commands, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group, group.focusScope, this.editorParts.partForGroup(group).quickInput), measure: measureBehaviorLensEditor },
			actor_lab: { create: group => new ActorLabEditorPane(this.commands, this.contextMenu, this.surfaces, group.paneSurface, group.workArea,
				group, this.editorParts.partForGroup(group).quickInput, group.focusScope), measure: measureUnconstrainedEditor },
			game_view: { create: group => new GameViewEditorPane(this.commands, this.contextMenu, runtime, input, presenter, group.focusScope), measure: measureUnconstrainedEditor },
			cart_map: { create: group => new CartMapPane(this.cartMaps, this.commands, this.sources, this.surfaces, group.paneSurface, group.workArea, group.focusScope, this.contextMenu), measure: measureCartMapEditor },
			scene_editor: { create: group => new SceneEditorPane(this.commands, this.sources, this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group.focusScope), measure: measureSceneEditor },
			scenario_lab: { create: group => new ScenarioLabEditorPane(
				this.scenarioLab,
				this.commands,
				this.contextMenu, this.surfaces, group.paneSurface, group.workArea, group,
				this.editorParts.partForGroup(group).quickInput, group.focusScope), measure: measureScenarioLabEditor },
		}, saves: textFileSaves, models: editorTextModelService, prompt: this.actionPrompt,
		});
		this.windowStatus = new WorkbenchWindowStatus(this.editorParts, this.commands, this.surfaces, chromeSurface, this.rootSurfaceBounds);
		this.statusBar = new WorkbenchStatusBar(this.surfaces, chromeSurface, this.commands, this.quickInput, this.clipboard, workArea);
		this.regionNavigation = new WorkbenchRegionNavigation(this.resourcePanel, this.mainWorkspace, this.editorParts.main, this.statusBar, this.surfaces);
		this.resourcePanel.focusTarget.scope.statusSource = this.resourcePanel;
		this.unbindWorkspaceModels = editorTextModelService.onWillClear(() => this.mainWorkspace.reset());

		this.surfaces.attach({
			role: 'content', lifetimeOwner: chromeSurface, presentationParent: chromeSurface, captureScope: this.resourcePanel.sash.focusTarget.scope.surfaceScope,
			isVisible: () => this.resourcePanel.isVisible(), getBounds: () => this.resourcePanel.resizeBounds,
			getClip: () => this.rootSurfaceBounds,
			draw: () => drawWorkbenchSplit(this.resourcePanel.split, this.resourcePanel.sash.hovered || this.resourcePanel.sash.focusTarget.hasFocus),
			handlePointer: snapshot => { this.resourcePanel.sash.handlePointer(snapshot); },
			onRetire: () => this.resourcePanel.retireResize(),
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
			handleWheel: event => { this.actionPrompt.handleWheel(event); return true; },
			onRetire: () => pointerCapture.cancelScope(this.actionPrompt.pointerScope),
		});
		this.resourcePanel.focusTarget.scope.surfaceScope = this.chromeScope;
		this.resourceEditors = createResourceEditorResolver(
			this.sources.catalog,
		);

		this.gamePanel = new GamePanel(this.editorParts.main, this.editorParts.mainArea, this.commands, this.contextMenu, input, presenter,
			new InputFocusScope(Symbol('game companion'), this.editorParts.main.scope), this.surfaces);
		this.assistantCommands = new AssistantChatCommands(this.assistant, this.clipboard);
		this.navigation = new EditorNavigationController(
			this.sources.catalog,
			this.resourceEditors,
			this.editorParts,
		);
		this.cartMaps = new CartMapController(this.sources.catalog);
		this.sceneEditor = new SceneEditorController(this.sources.catalog, workbench.sceneSources);
		this.animations = new AnimationEditorController(this.sources.catalog);
		this.actorLab = new ActorLabController(sources, guest, runtime.machine.cpu,
			this.editorParts, this.navigation, actorExecution, rewind, sources,
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
			this.actorLab,
		);
		this.scenarioLab = new ScenarioLabController(
			this,
			this.navigation,
			behaviorRegistrations,
			scenarioRuns,
			this.play,
		);
		this.aemEditor = new AemEditorController(sources, guest, runtime, runtimeTasks, this.actorLab);
		this.luaPrograms = new LuaProgramController(sources, guest, rewind, workbench.transport);
		this.actionStrings = new ActionStringTester(sources.catalog, clock, scenarioRuns, this.scenarioLab);
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
		this.scenePrimaryOptions = {
			commands: this.commands, sources: this.sources, saves: textFileSaves, contextMenu: this.contextMenu, surfaces: this.surfaces,
			workArea: getWorkbenchWorkArea(), main: this.mainWorkspace,
			focusReturn: this.editorParts.main.focusTarget,
			restoreNavigation: this.restoreSceneNavigation,
			createProjectRunCommand: (model, target, isRetained) => createProjectRunCommand(this, sources, boots, runtimeTasks, workbench.runTargets, model, target, isRetained),
			save: copy => { void saveTextFileFromCommand(this.workbench.textFileSaves, copy, this, this.sources); },
		};
		this.crossFileRename = new CrossFileRenameManager(this.sources.catalog);
		this.problems = this.mainWorkspace.activities.register({ id: 'problems', command: 'problems' }, context =>
			new ProblemsPanelController(this.editorParts, this.commands, this.surfaces, context.surface, workArea, context.scope, context.focusReturn));
		this.buildOutput = this.mainWorkspace.activities.register({ id: 'builds.output', command: 'builds.output' }, context =>
			new BuildOutputActivity(this.clipboard, this.contextMenu, this.surfaces, context.surface, workArea, context.scope, context.focusReturn,
				{ isEnabled: () => this.builds !== undefined, run: () => chooseBuildOutput(this) }));
		this.mainWorkspace.activities.initialize('problems');
		this.problems.setDiagnostics(diagnostics.diagnostics, diagnostics.coverage);
		this.breakpoints = new BreakpointController(debuggerState);
		this.unbindBreakpoints = debuggerState.breakpoints.onDidChange(() => requestWorkspaceAutosave(WorkspaceAutosaveChange.Breakpoints));
		this.unbindSourceStop = debuggerState.source.onDidChangeStop(stop => {
			if (stop === undefined) for (const group of this.editorParts.groups) clearExecutionStopHighlights(group);
		});
		this.unbindNavigation = initializeNavigationState(this.editorParts.main.activeGroup);
		this.initializeEditorGroup();
		this.unsubscribeTextModelChanged = editorTextModelService.onDidChangeContent((model, event) => {
			if (model.mode === 'lua') {
				invalidateLuaCommentContextFromRow(model.buffer, event.startRow);
			}
			requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
		});
		const publishDiagnostics = () => {
			this.problems.setDiagnostics(diagnostics.diagnostics, diagnostics.coverage);
		};
		this.unsubscribeDiagnosticsChanged = diagnostics.onDidChange(publishDiagnostics);
		publishDiagnostics();
		this.unbindSurfaceAdmission = inputFocus.bindScopeAdmission(scope => {
			const surface = this.surfaces.findByScope(scope.surfaceScope);
			return surface !== undefined && this.surfaces.isFocusAdmitted(surface);
		});
		this.input.setEditingInput(this);
		this.unbindHostInput = input.onDidChangeEditingInputEnabled(() => {
			if (input.editingInputEnabled) pointerCapture.interrupt(input.pointerButtonsDown);
			inputFocus.notifyTargetChanged();
		});
	}

	public get isActive(): boolean { return editorRuntimeState.active; }
	public get acceptsInput(): boolean { return !this.isClosing && this.isActive && this.input.editingInputEnabled; }
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
		pointerCapture.dispatchModifiers(event.modifiers, this.clock.now());
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
		this.keybindings.cancel();
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

	public openSceneInMain(model: EditorTextModel, subject: SceneAuthoredSubject, origin: InputFocusTarget): Promise<boolean> {
		return this.mainWorkspace.openPrimary((regions, scope) => createScenePrimaryClient(model, this.workbench.sceneSources,
			subject, { ...this.scenePrimaryOptions, regions, scope }), this.editorParts.closeController, origin);
	}

	private readonly restoreSceneNavigation: RestoreScenePrimaryBookmark = (bookmark, options) =>
		this.mainWorkspace.openPrimary((regions, scope) => {
			const subject = bookmark.resolve(this.workbench.sceneSources);
			return subject === undefined ? undefined : createScenePrimaryClient(bookmark.model, this.workbench.sceneSources,
				subject, { ...this.scenePrimaryOptions, regions, scope }, bookmark.view);
		}, this.editorParts.closeController, inputFocus.target, { ...options, recordNavigation: false });

	public restorePrimaryClient(record: SerializedPrimaryClient, regions: MainWorkspaceRegionSurfaces, scope: InputFocusScope,
		isCurrent: () => boolean): Promise<MainWorkspaceClient | undefined> {
		switch (record.kind) {
			case 'scene': return restoreScenePrimaryClient(record.value, editorTextModelService, this.sources.catalog,
				this.workbench.sceneSources, { ...this.scenePrimaryOptions, regions, scope }, isCurrent);
		}
	}

	public activate(): void {
		if (this.isClosing) return;
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
			if (activeTab !== null) group.activate(activeTab.id, { preserveFocus: true });
		}
		this.mainWorkspace.resume();
		const focused = inputFocus.admittedTarget;
		if (focused === null || focused.guestInput !== undefined) {
			if (this.editorParts.activePart === this.editorParts.main) this.mainWorkspace.focusTarget.focus();
			else this.editorParts.activePart.focus();
		}
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
		this.keybindings.cancel();
		this.interaction.setActive(false);
		this.menubar.cancelAlt();
		pointerCapture.cancel();
		this.input.setPointerAdmissionMode('physical');
		this.guest.invalidate();
		pointerHover.clear();
		const wasActive = this.isActive;
		this.editorParts.suspend();
		this.mainWorkspace.suspend();
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

	private layoutMainEditor(): void {
		let layoutChanged = refreshWorkbenchLayout();
		if (this.resourcePanel.refresh()) layoutChanged = refreshWorkbenchLayout() || layoutChanged;
		const part = this.editorParts.main, bounds = getWorkbenchEditorBounds();
		part.prepareLayout();
		const minimum = part.minimumClientWidth(bounds.bottom - bounds.top);
		layoutChanged = this.mainWorkspace.layout(bounds, minimum, part.minimumClientHeight) || layoutChanged;
		const finalMinimum = part.minimumClientWidth(this.mainWorkspace.regionLayout.viewport.bottom - this.mainWorkspace.regionLayout.viewport.top);
		if (finalMinimum !== minimum) layoutChanged = this.mainWorkspace.layout(bounds, finalMinimum, part.minimumClientHeight) || layoutChanged;
		this.gamePanel.prepareLayout(this.mainWorkspace.documentBounds);
		layoutChanged = part.layoutPrepared(this.mainWorkspace.documentBounds) || layoutChanged;
		this.mainWorkspace.layoutClients();
		this.gamePanel.update();
		if (layoutChanged) this.surfaces.changed();
	}

	public update(deltaSeconds: number): void {
		editorRuntimeState.currentTimeMs = this.clock.now();
		updateBlink(deltaSeconds);
		updateEditorMessage(deltaSeconds);
		layoutTopBar(this.chromeRenderContext, this.menubar.expanded);
		this.menubar.update();
		this.layoutMainEditor();
		this.resourcePanel.update(editorRuntimeState.currentTimeMs);
		this.editorParts.update(deltaSeconds);
		this.mainWorkspace.update();
		this.windowStatus.update(inputFocus.admittedTarget?.guestInput !== undefined, this.fault.hostFrameFailure !== undefined);
		this.statusBar.update(this.fault, this.luaEvaluation, this.serverConnectionState, this.windowStatus.width, this.keybindings.pendingLabel);
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
		this.windowStatus.update(inputFocus.admittedTarget?.guestInput !== undefined, this.fault.hostFrameFailure !== undefined);
		this.statusBar.update(this.fault, this.luaEvaluation, this.serverConnectionState, this.windowStatus.width, this.keybindings.pendingLabel);
		this.surfaces.changed();
	}

	public draw(): void {
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
		const area = presentationParent === undefined ? this.rootSurfaceBounds : presentationParent.getClip();
		this.contextMenu.layout(area);
		lifetime.add(this.surfaces.attach({
			role: 'transient', outsidePress: 'consume', captureScope: this.contextMenu.pointerScope,
			lifetimeOwner: owner, presentationParent,
			isVisible: () => this.contextMenu.visible, getBounds: () => this.contextMenu.model.bounds,
			getClip: () => area,
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
		api.fill_rect(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, 0, constants.COLOR_FRAME);
		renderTopBar(this.chromeRenderContext, this.menubar);
		drawResourcePanel(this.resourcePanel);
		this.statusBar.draw();
	}

	public shutdown(): Promise<void> {
		if (this.shutdownOperation !== undefined) return this.shutdownOperation;
		const completion = Promise.withResolvers<void>();
		// Publish terminal admission before retiring controls can call back into this frontend.
		this.shutdownOperation = completion.promise;
		void this.close().then(completion.resolve, completion.reject);
		return completion.promise;
	}

	private async close(): Promise<void> {
		inputFocus.workbenchScope.retireContext();
		this.deactivate();
		this.input.setEditingInput(undefined);
		this.keybindings.dispose();
		this.interaction.dispose();
		this.editorParts.closeController.dispose();
		inputFocus.workbenchScope.commands = undefined;
		this.unbindHostInput();
		this.unbindWorkspaceModels();
		this.statusBar.dispose();
		this.windowStatus.dispose();
		this.builds = undefined;
		try {
			await this.workbench.shutdown();
			requestWorkspaceAutosave(WorkspaceAutosaveChange.All);
			cancelWorkspaceAutosave();
			try {
				await runWorkspaceAutosaveTick();
			} finally {
				await shutdownWorkspaceStorage();
			}
		} finally {
			this.mainWorkspace.dispose();
			this.surfaces.dispose();
			this.unbindSurfaceAdmission();
			this.assistant.dispose();
			this.observedConversation.dispose();
			this.unbindBreakpoints();
			this.unbindSourceStop();
			this.actionPrompt.dispose();
			this.terminal.discard();
			this.play.dispose();
			this.actorLab.dispose();
			this.unsubscribeDiagnosticsChanged();
			pointerHover.clear();
			pointerCapture.cancel();
			this.contextMenu.dispose();
			this.menubar.dispose();
			this.gamePanel.dispose();
			this.quickInput.dispose();
			this.input.guestInputRecipient = this.input;
			this.editorParts.dispose();
			this.unbindNavigation();
			this.scenarioLab.dispose();
			this.unsubscribeTextModelChanged();
			this.codeDocuments.dispose();
			editorTextModelService.clear();
			this.sources.catalog.dispose();
			this.resourcePanel.dispose();
		}
	}

	public setFontVariant(variant: FontVariant): void {
		if (!this.isAvailable) {
			return;
		}
		const previousVariant = editorViewState.fontVariant;
		configureFontVariant(variant);
		this.resourcePanel.setFontMetrics(editorViewState.font);
		this.layoutMainEditor();
		if (editorViewState.fontVariant !== previousVariant) {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.Font);
		}
	}

	public showRuntimeErrorInChunk(resource: ResourceIdentity, line: number, column: number, message: string, details?: RuntimeErrorDetails): void {
		if (!editorRuntimeState.active) {
			this.activate();
		}
		const group = this.editorParts.editorDestination(this.editorParts.activeGroup, { resource, editorId: WORKBENCH_TEXT_EDITOR_ID });
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
		content: ProjectContentIndex,
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
		}, resourcePanelWidthRatio, content, this.clock);
		if (!this.isAvailable) {
			configureFontVariant(editorViewState.fontVariant);
			resourcePanel.setFontMetrics(editorViewState.font);
			editorRuntimeState.initialized = false;
			return resourcePanel;
		}
		editorTextModelService.clear();
		configureFontVariant(editorViewState.fontVariant);
		resourcePanel.setFontMetrics(editorViewState.font);
		return resourcePanel;
	}

	private initializeEditorGroup(): void {
		if (!this.isAvailable) {
			return;
		}
		this.layoutMainEditor();
		this.editorParts.main.clear();
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
