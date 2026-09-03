import type { HostAudioOutput } from '../hosts/common/audio_output';
import type { Input } from '../hosts/common/input/manager';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import type { Clipboard } from './common/clipboard';
import type { HostClock } from '../hosts/common/clock';
import type { LogOutput } from '../hosts/common/log';
import type { MicrotaskQueue } from './common/microtask_queue';
import type { KeyValueStorage } from './workspace/key_value_storage';
import type { VideoPresenter } from '../machine/ts/render/video_presenter';
import { runtimeSourcesSupportIde, type RuntimeSourceState } from './runtime/sources';
import { blua32ToolingImageForDomain } from '../toolchain/ts/rompack/blua32_media';
import type { EditorDisplay, Viewport } from './common/viewport';
import { api } from './runtime/overlay_api';
import * as constants from './common/constants';
import type { FaultSnapshot, RuntimeErrorDetails, RuntimeFaultState } from './runtime/fault_state';
import type { ResourceIdentity } from './common/resource';
import type { RuntimeLuaTooling } from './runtime/lua_tooling';
import type { RuntimeDebuggerState } from './runtime/debugger_state';
import type { OverlayRenderer } from './runtime/overlay_renderer';
import type { RuntimeTaskQueue } from './runtime/task_queue';
import { showEditorMessage, updateEditorMessage, setEditorFeedbackActive, editorFeedbackState } from './common/feedback_state';
import { clearBackgroundTasks, runBackgroundTasks } from './common/background_tasks';
import { editorRuntimeState } from './editor/common/runtime_state';
import { invalidateLuaCommentContextFromRow } from './common/text';
import { assertMonospace, measureText } from './editor/common/text/layout';
import { applyRuntimeErrorOverlay } from './editor/render/error_overlay';
import { drawEditorText, setEditorCaseInsensitivity } from './editor/render/text_renderer';
import { renderCodeArea } from './editor/render/code_area/area';
import {
	applyViewportSize,
	configureFontVariant,
	refreshViewportLayout,
	setFontVariant,
} from './editor/ui/view/view';
import { editorViewState } from './editor/ui/view/state';
import { ensureCursorVisible, updateDesiredColumn } from './editor/ui/view/caret/caret';
import { editorCaretState } from './editor/ui/view/caret/state';
import { updateBlink, createInlineTextField } from './editor/ui/inline/text_field';
import { Scrollbar, ScrollbarController } from './editor/ui/scrollbar';
import { clearRuntimeErrorOverlay } from './editor/contrib/runtime_error/navigation';
import {
	clearAllRuntimeErrorOverlays,
	clearExecutionStopHighlights,
	setActiveRuntimeErrorOverlayForCurrentContext,
	setExecutionStopHighlightForCurrentContext,
	syncRuntimeErrorOverlayFromContext,
} from './runtime_error/navigation';
import { clearGotoHoverHighlight, clearNativeMemberCompletionCache } from './editor/contrib/intellisense/engine';
import { referenceState } from './editor/contrib/references/state';
import { resetSemanticProjects } from './editor/contrib/intellisense/semantic/workspace/state';
import { activeCodeEditor } from './editor/ui/code_editor_state';
import { editorTextModelService } from './editor/model/model_service';
import { clearSingleCursorSelection } from './editor/editing/cursor/state';
import { editorDiagnosticsState, markDiagnosticsDirty } from './editor/contrib/diagnostics/state';
import { processDiagnosticsQueue } from './workbench/contrib/code_editor/diagnostics/controller';
import { applyLineJumpFieldText } from './workbench/contrib/code_editor/find/line_jump';
import { EditorSearchController, applySearchFieldText, cancelGlobalSearchJob, cancelSearchJob, startSearchJob } from './workbench/contrib/code_editor/find/search';
import { editorSearchState, lineJumpState } from './workbench/contrib/code_editor/find/widget_state';
import { renameController } from './workbench/contrib/code_editor/rename/controller';
import { CrossFileRenameManager } from './workbench/contrib/code_editor/rename/operations';
import { EditorCompletionController } from './workbench/contrib/code_editor/suggest/completion_controller';
import { symbolSearchState } from './workbench/contrib/code_editor/symbols/search/state';
import { applySymbolSearchFieldText } from './workbench/contrib/code_editor/symbols/shared';
import { renderInlineWidgets } from './quick_input/inline_widget';
import { handleEditorInput } from './input/keyboard/dispatch';
import { captureKeys } from './workbench/contrib/code_editor/input/keyboard/capture_keys';
import { editorInput } from './workbench/contrib/code_editor/input/keyboard/text_input';
import { handleTextEditorPointerInput } from './input/pointer/dispatch';
import { clearEditorPointerSelectionState, editorPointerState } from './input/pointer/state';
import { handleEditorWheelInput } from './input/pointer/wheel';
import {
	clearCodeEditorInputs,
	findCodeTabContext,
	retainEntryTabContext,
} from './workbench/ui/code_tab/contexts';
import { storeCodeTabContext } from './workbench/ui/code_tab/activation';
import {
	cancelWorkspaceAutosave,
	requestWorkspaceAutosave,
	runWorkspaceAutosaveTick,
	shutdownWorkspaceStorage,
} from './workbench/workspace/storage';
import { WorkspaceAutosaveChange } from './workbench/workspace/models';
import { refreshWorkbenchLayout } from './workbench/common/layout';
import { BreakpointController, getBreakpointsForChunk } from './workbench/contrib/debugger/controller';
import { closeBlockingWorkbenchModal, drawBlockingWorkbenchModal, handleBlockingWorkbenchModalInput, hasBlockingWorkbenchModal } from './workbench/contrib/modal/blocking_modal';
import { drawProblemsPanel, problemsPanel } from './workbench/contrib/problems/panel/controller';
import { ResourcePanelController } from './workbench/contrib/resources/panel/controller';
import { applyCreateResourceFieldText, closeCreateResourcePrompt } from './workbench/contrib/resources/create/index';
import { createResourceState, resourceSearchState } from './workbench/contrib/resources/widget_state';
import { applyResourceSearchFieldText } from './workbench/contrib/resources/search/index';
import { IdeCommandController } from './commands/controller';
import { initializeNavigationState } from './navigation/navigation_history';
import { EditorNavigationController } from './workbench/contrib/resources/navigation';
import { BehaviorLensController } from './workbench/contrib/behavior_lens/controller';
import { BehaviorRegistrationIndex } from './workbench/contrib/behavior_lens/registration_index';
import { drawBehaviorLens } from './workbench/contrib/behavior_lens/render';
import { ScenarioLabController } from './workbench/contrib/scenario_lab/controller';
import { drawScenarioLab } from './workbench/contrib/scenario_lab/render';
import type { ScenarioRunService } from './workbench/contrib/scenario_lab/run_service';
import type { ScenarioTestCollection } from './testing/scenario/test_collection';
import { editorChromeState } from './workbench/ui/chrome_state';
import { getActiveTab, getActiveTabId, initializeTabs, setActiveTab } from './workbench/ui/tabs';
import { drawResourcePanel, drawResourceViewer } from './workbench/render/resource_panel';
import { renderEditorContextMenu } from './workbench/render/context_menu';
import { renderStatusBar } from './workbench/render/status_bar';
import { renderTabBar } from './workbench/render/tab_bar';
import { renderTopBar, renderTopBarDropdown } from './workbench/render/top_bar';
import type { ChromeRenderContext } from './workbench/render/chrome_context';
import { createResourceEditorResolver } from './workbench/contrib/resources/editor_contributions';


type RenderRuntimeFaultOverlayOptions = {
	snapshot: FaultSnapshot;
	needsFlush: boolean;
	force?: boolean;
};

const EDITOR_TARGET_WIDTH = 384;
const EDITOR_TARGET_HEIGHT = 288;

export type CartEditor = {
	readonly blocksRuntimePipeline: true;
	readonly isAvailable: boolean;
	readonly completion: EditorCompletionController;
	readonly resourcePanel: ResourcePanelController;
	readonly search: EditorSearchController;
	readonly breakpoints: BreakpointController;
	readonly commands: IdeCommandController;
	readonly navigation: EditorNavigationController;
	readonly behaviorLens: BehaviorLensController;
	readonly scenarioLab: ScenarioLabController;
	readonly crossFileRename: CrossFileRenameManager;
	isActive: boolean;
	readonly fontVariant: Parameters<typeof setFontVariant>[1];
	activate: () => void;
	deactivate: () => void;
	tickInput: () => void;
	update: (deltaSeconds: number) => void;
	draw: () => void;
	shutdown: () => Promise<void>;
	updateViewport: (viewport: Viewport) => void;
	setFontVariant: (variant: Parameters<typeof setFontVariant>[1]) => void;
	showRuntimeErrorInChunk: (resource: ResourceIdentity, line: number, column: number, message: string, details?: RuntimeErrorDetails) => void;
	showRuntimeError: (line: number, column: number, message: string, details?: RuntimeErrorDetails, path?: string) => void;
	clearRuntimeErrorOverlay: typeof clearRuntimeErrorOverlay;
	clearAllRuntimeErrorOverlays: typeof clearAllRuntimeErrorOverlays;
	renderFaultOverlay: () => void;
	renderRuntimeFaultOverlay: (options: RenderRuntimeFaultOverlayOptions) => boolean;
	clearNativeMemberCompletionCache: () => void;
	handleRuntimeTaskError: (error: unknown, fallbackMessage: string) => void;
};

export class RuntimeCartEditor implements CartEditor {
	public readonly blocksRuntimePipeline = true;
	public readonly isAvailable: boolean;
	public readonly completion: EditorCompletionController;
	public readonly resourcePanel: ResourcePanelController;
	public readonly search: EditorSearchController;
	public readonly breakpoints: BreakpointController;
	public readonly commands: IdeCommandController;
	public readonly navigation: EditorNavigationController;
	public readonly behaviorLens: BehaviorLensController;
	public readonly scenarioLab: ScenarioLabController;
	public readonly crossFileRename: CrossFileRenameManager;
	public readonly clearRuntimeErrorOverlay = clearRuntimeErrorOverlay;
	public readonly clearAllRuntimeErrorOverlays = clearAllRuntimeErrorOverlays;
	public readonly clearNativeMemberCompletionCache: () => void;
	private crtPostprocessingEnabledBeforeEditor: boolean | null = null;
	private editorRenderTargetBaselineActive = false;
	private editorRenderTargetBaselineWidth = 0;
	private editorRenderTargetBaselineHeight = 0;
	private readonly runtime: Runtime;
	private readonly presenter: VideoPresenter;
	private readonly display: EditorDisplay;
	private readonly input: Input;
	private readonly storage: KeyValueStorage;
	private readonly clock: HostClock;
	private readonly clipboard: Clipboard;
	private readonly microtasks: MicrotaskQueue;
	private readonly sources: RuntimeSourceState;
	private readonly fault: RuntimeFaultState;
	private readonly luaTooling: RuntimeLuaTooling;
	private readonly debuggerState: RuntimeDebuggerState;
	private readonly overlayRenderer: OverlayRenderer;
	private readonly unsubscribeWorkspaceCursorMoved: () => void;
	private readonly unsubscribeTextModelChanged: () => void;
	private readonly chromeRenderContext: ChromeRenderContext = {
		get viewportWidth(): number { return editorViewState.viewportWidth; },
		get headerHeight(): number { return editorViewState.headerHeight; },
		get lineHeight(): number { return editorViewState.lineHeight; },
		get tabBarHeight(): number { return editorViewState.tabBarHeight; },
		measureText,
		drawText(text: string, x: number, y: number, z: number, color: number): void {
			const font = editorViewState.font;
			drawEditorText(font, text, x, y, z, color);
		},
	};

	public constructor(
		runtime: Runtime,
		presenter: VideoPresenter,
		display: EditorDisplay,
		input: Input,
		audioOutput: HostAudioOutput,
		storage: KeyValueStorage,
		clock: HostClock,
		clipboard: Clipboard,
		microtasks: MicrotaskQueue,
		logOutput: LogOutput,
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		fontVariant: Parameters<typeof setFontVariant>[1],
		sources: RuntimeSourceState,
		fault: RuntimeFaultState,
		luaTooling: RuntimeLuaTooling,
		debuggerState: RuntimeDebuggerState,
		runtimeTasks: RuntimeTaskQueue,
		overlayRenderer: OverlayRenderer,
		scenarioTests: ScenarioTestCollection,
		scenarioRuns: ScenarioRunService,
	) {
		this.runtime = runtime;
		this.presenter = presenter;
		this.display = display;
		this.input = input;
		this.storage = storage;
		this.clock = clock;
		this.clipboard = clipboard;
		this.microtasks = microtasks;
		this.sources = sources;
		this.fault = fault;
		this.luaTooling = luaTooling;
		this.debuggerState = debuggerState;
		this.overlayRenderer = overlayRenderer;
		this.isAvailable = runtimeSourcesSupportIde(this.sources);
		this.commands = new IdeCommandController(
			this,
			sources,
			fault,
			luaTooling,
			debuggerState,
			input,
			runtimeTasks,
			overlayRenderer,
			runtime,
			audioOutput,
			storage,
			clock,
			logOutput,
		);
		this.completion = new EditorCompletionController(luaTooling, fault, runtime);
		this.resourcePanel = this.initialize(resourcePanelWidthRatio, viewport, fontVariant);
		const resourceEditorResolver = createResourceEditorResolver(
			storage,
			this,
			this.sources,
			this.resourcePanel,
		);
		this.navigation = new EditorNavigationController(
			this.sources,
			this.resourcePanel,
			resourceEditorResolver,
		);
		this.behaviorLens = new BehaviorLensController(
			this.sources,
			this.navigation,
			this.resourcePanel,
		);
		this.scenarioLab = new ScenarioLabController(
			this,
			this.sources,
			this.navigation,
			this.resourcePanel,
			new BehaviorRegistrationIndex(this.sources),
			scenarioTests,
			scenarioRuns,
			this.runtime,
			this.overlayRenderer,
			audioOutput,
		);
		this.crossFileRename = new CrossFileRenameManager(this.sources);
		this.search = new EditorSearchController(this.sources, renameController);
		this.breakpoints = new BreakpointController(debuggerState);
		this.clearNativeMemberCompletionCache = clearNativeMemberCompletionCache;
		this.unsubscribeWorkspaceCursorMoved = activeCodeEditor.onDidMoveCursor(() => {
			if (activeCodeEditor.model.dirty) {
				requestWorkspaceAutosave(WorkspaceAutosaveChange.ActiveEditor);
			}
		});
		this.unsubscribeTextModelChanged = editorTextModelService.onDidChangeContent((model, event) => {
			const context = findCodeTabContext(model.resource);
			if (model.mode === 'lua') {
				invalidateLuaCommentContextFromRow(model.buffer, event.startRow);
			}
			if (context !== null && model.mode === 'lua') {
				markDiagnosticsDirty(context.id);
			}
			requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
			if (activeCodeEditor.model === model && editorSearchState.query.length > 0) {
				startSearchJob();
			}
		});
	}

	public get isActive(): boolean { return editorRuntimeState.active; }
	public get fontVariant(): Parameters<typeof setFontVariant>[1] { return editorViewState.fontVariant; }

	public activate(): void {
		const runtime = this.runtime;
		const activeSlot = runtime.machine.cpu.activeCartridgeSlot();
		if (!this.isAvailable || !blua32ToolingImageForDomain(this.sources.currentBlua32Media, activeSlot)?.symbols) {
			return;
		}
		editorInput.applyOverrides(this.input, true, captureKeys);
		setActiveTab(this.resourcePanel, getActiveTabId());
		const activeTab = getActiveTab();
		const codeTabActive = activeTab.kind === 'code_editor';
		editorCaretState.cursorVisible = codeTabActive;
		editorCaretState.blinkTimer = 0;
		this.enterRenderTargets();
		editorRuntimeState.active = true;
		this.overlayRenderer.active = true;
		setEditorFeedbackActive(true);
		editorPointerState.pointerSelecting = false;
		editorPointerState.pointerPrimaryWasPressed = false;
		editorCaretState.cursorRevealSuspended = false;
		if (codeTabActive) {
			updateDesiredColumn();
			activeCodeEditor.view.selectionAnchor = null;
		}
		editorSearchState.active = false;
		editorSearchState.visible = false;
		lineJumpState.active = false;
		lineJumpState.visible = false;
		lineJumpState.value = '';
		if (codeTabActive) {
			syncRuntimeErrorOverlayFromContext(activeTab.context);
		}
		closeBlockingWorkbenchModal();
		cancelSearchJob();
		cancelGlobalSearchJob();
		this.resetGlobalSearchView();
		if (editorSearchState.query.length === 0) {
			editorSearchState.matches = [];
			editorSearchState.currentIndex = -1;
		} else if (codeTabActive) {
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
		if (this.fault.faultSnapshot) {
			const rendered = this.renderRuntimeFaultOverlay({
				snapshot: this.fault.faultSnapshot,
				needsFlush: this.fault.faultOverlayNeedsFlush,
				force: false,
			});
			if (rendered) {
				this.fault.faultOverlayNeedsFlush = false;
			}
		}
	}

	public deactivate(): void {
		const activeTab = getActiveTab();
		if (activeTab.kind === 'code_editor') {
			storeCodeTabContext(activeTab.context);
		}
		editorRuntimeState.active = false;
		this.overlayRenderer.active = false;
		setEditorFeedbackActive(false);
		if (editorViewState.dimCrtInEditor) {
			this.restoreCrtPostprocessingFromEditor();
		}
		this.completion.closeSession();
		editorInput.applyOverrides(this.input, false, captureKeys);
		clearSingleCursorSelection(activeCodeEditor.view);
		clearEditorPointerSelectionState();
		editorChromeState.tabDragState = null;
		clearGotoHoverHighlight();
		editorViewState.scrollbarController.cancel();
		editorCaretState.cursorRevealSuspended = false;
		editorSearchState.active = false;
		editorSearchState.visible = false;
		lineJumpState.active = false;
		lineJumpState.visible = false;
		closeBlockingWorkbenchModal();
		closeCreateResourcePrompt(false);
		this.resourcePanel.hide();
		editorChromeState.resourcePanelResizing = false;
		cancelSearchJob();
		cancelGlobalSearchJob();
		this.resetGlobalSearchView();
		clearBackgroundTasks();
		editorDiagnosticsState.diagnosticsTaskPending = false;
		editorRuntimeState.lastReportedSemanticError = null;
		this.leaveRenderTargets();
	}

	public tickInput(): void {
		const runtime = this.runtime;
		const playerInput = this.input.getPlayerInput(1);
		editorRuntimeState.currentTimeMs = this.clock.now();
		const scrollRow = activeCodeEditor.view.scrollRow;
		const scrollColumn = activeCodeEditor.view.scrollColumn;
		const breakpointRevision = this.breakpoints.revision;
		handleEditorWheelInput(this, playerInput);
		handleTextEditorPointerInput(
			this.display,
			playerInput,
			editorRuntimeState.currentTimeMs,
			this.clipboard,
			this.microtasks,
			this,
			this.sources,
			this.luaTooling,
			this.fault,
			runtime,
		);
		if (hasBlockingWorkbenchModal()) {
			handleBlockingWorkbenchModalInput(
				playerInput,
				this,
			);
			return;
		}
		handleEditorInput(
			playerInput,
			this.clipboard,
			this.microtasks,
			this.storage,
			this.clock,
			this,
			this.sources,
			this.luaTooling,
		);
		let workspaceChanges = WorkspaceAutosaveChange.None;
		if (this.breakpoints.revision !== breakpointRevision) {
			workspaceChanges |= WorkspaceAutosaveChange.Breakpoints;
		}
		if ((activeCodeEditor.view.scrollRow !== scrollRow
			|| activeCodeEditor.view.scrollColumn !== scrollColumn)
			&& activeCodeEditor.model.dirty) {
			workspaceChanges |= WorkspaceAutosaveChange.ActiveEditor;
		}
		if (workspaceChanges) {
			requestWorkspaceAutosave(workspaceChanges);
		}
	}

	public update(deltaSeconds: number): void {
		editorRuntimeState.currentTimeMs = this.clock.now();
		runBackgroundTasks(this.clock);
		updateBlink(deltaSeconds);
		updateEditorMessage(deltaSeconds);
		const activeTab = getActiveTab();
		switch (activeTab.kind) {
			case 'behavior_lens':
				this.behaviorLens.updateView(activeTab.view);
				break;
			case 'scenario_lab':
				this.scenarioLab.updateView(activeTab.view);
				break;
			case 'code_editor': {
				this.completion.processPending(deltaSeconds);
				const semanticError = editorViewState.layout.getLastSemanticError();
				if (semanticError && semanticError !== editorRuntimeState.lastReportedSemanticError) {
					showEditorMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
					editorRuntimeState.lastReportedSemanticError = semanticError;
				} else if (!semanticError && editorRuntimeState.lastReportedSemanticError) {
					editorRuntimeState.lastReportedSemanticError = null;
				}
				break;
			}
			case 'resource_view':
				break;
		}
		if (editorDiagnosticsState.diagnosticsDirty) {
			processDiagnosticsQueue(
				this.luaTooling,
				this.clock,
				editorRuntimeState.currentTimeMs,
			);
		}
	}

	public updateViewport(viewport: Viewport): void {
		applyViewportSize(viewport);
		refreshWorkbenchLayout();
		this.syncResourcePanelViewport();
		refreshViewportLayout();
	}

	public draw(): void {
		editorViewState.codeVerticalScrollbarVisible = false;
		editorViewState.codeHorizontalScrollbarVisible = false;
		api.fill_rect(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, 0, constants.COLOR_FRAME);

		renderTopBar(this.commands, this.chromeRenderContext);

		editorViewState.tabBarRowCount = renderTabBar(this.chromeRenderContext);
		refreshWorkbenchLayout();
		drawResourcePanel(this.resourcePanel);
		const activeTab = getActiveTab();
		switch (activeTab.kind) {
			case 'resource_view':
				drawResourceViewer(activeTab.resource);
				break;
			case 'behavior_lens':
				drawBehaviorLens(activeTab.view);
				break;
			case 'scenario_lab':
				drawScenarioLab(activeTab.view, this.commands);
				break;
			case 'code_editor': {
				renderInlineWidgets();
				const resourcePanel = this.resourcePanel;
				const problemsPanelHasFocus = problemsPanel.isVisible && problemsPanel.isFocused;
				const cursorActive = !(editorSearchState.active || lineJumpState.active || resourcePanel.isFocused() || createResourceState.active || problemsPanelHasFocus);
				const renameActive = renameController.isActive();
				const codeAreaViewport = renderCodeArea(
					this.completion,
					this.completion.getInlineCompletionPreview(),
					cursorActive,
					getBreakpointsForChunk(
						this.debuggerState,
						activeTab.context.model.resource,
					),
					renameActive ? renameController.getHighlightMatches() : referenceState.getMatches(),
					renameActive ? renameController.getActiveIndex() : referenceState.getActiveIndex(),
					editorSearchState.matches,
					editorSearchState.currentIndex,
					editorSearchState.scope === 'local' && editorSearchState.query.length > 0,
				);
				renderEditorContextMenu(codeAreaViewport);
				break;
			}
		}
		drawProblemsPanel();
		renderStatusBar(this.resourcePanel, this.fault);
		renderTopBarDropdown(this.chromeRenderContext);
		if (hasBlockingWorkbenchModal()) {
			drawBlockingWorkbenchModal();
		}
	}

	public async shutdown(): Promise<void> {
		this.completion.dispose();
		this.scenarioLab.dispose();
		clearExecutionStopHighlights();
		const activeTab = getActiveTab();
		if (this.isAvailable && activeTab.kind === 'code_editor') {
			storeCodeTabContext(activeTab.context);
		}
		editorInput.applyOverrides(this.input, false, captureKeys);
		if (editorViewState.dimCrtInEditor) {
			this.restoreCrtPostprocessingFromEditor();
		}
		editorRuntimeState.active = false;
		setEditorFeedbackActive(false);
		requestWorkspaceAutosave(WorkspaceAutosaveChange.All);
		cancelWorkspaceAutosave();
		try {
			await runWorkspaceAutosaveTick();
		} finally {
			try {
				await shutdownWorkspaceStorage();
			} finally {
				this.unsubscribeWorkspaceCursorMoved();
				this.unsubscribeTextModelChanged();
			}
		}
		clearEditorPointerSelectionState();
		clearGotoHoverHighlight();
		editorCaretState.cursorRevealSuspended = false;
		editorSearchState.active = false;
		editorSearchState.visible = false;
		cancelSearchJob();
		cancelGlobalSearchJob();
		editorSearchState.matches = [];
		this.resetGlobalSearchView();
		editorSearchState.currentIndex = -1;
		applySearchFieldText('', true);
		lineJumpState.active = false;
		lineJumpState.visible = false;
		applyLineJumpFieldText('', true);
		createResourceState.active = false;
		createResourceState.visible = false;
		applyCreateResourceFieldText('', true);
		createResourceState.error = null;
		createResourceState.working = false;
		closeBlockingWorkbenchModal();
		this.resourcePanel.hide();
		editorChromeState.resourcePanelResizing = false;
	}

	public setFontVariant(variant: Parameters<typeof setFontVariant>[1]): void {
		if (!this.isAvailable) {
			return;
		}
		const previousVariant = editorViewState.fontVariant;
		const activeTab = getActiveTab();
		if (activeTab.kind === 'code_editor') {
			setFontVariant(
				this.clock,
				variant,
				activeTab.context.model.mode,
				activeTab.id,
			);
		} else {
			configureFontVariant(this.clock, variant, null);
		}
		this.resourcePanel.setFontMetrics(editorViewState.lineHeight, editorViewState.charAdvance);
		if (editorViewState.fontVariant !== previousVariant) {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.Font);
		}
	}

	public showRuntimeErrorInChunk(resource: ResourceIdentity, line: number, column: number, message: string, details?: RuntimeErrorDetails): void {
		if (!editorRuntimeState.active) {
			this.activate();
		}
		this.navigation.focusChunkSource(resource);
		this.showRuntimeError(line, column, message, details, resource.path);
	}

	public showRuntimeError(line: number, column: number, message: string, details?: RuntimeErrorDetails, path: string = ''): void {
		if (!editorRuntimeState.active) {
			this.activate();
		}
		const applied = applyRuntimeErrorOverlay(line, column, message, details, path);
		setActiveRuntimeErrorOverlayForCurrentContext(applied.overlay);
		setExecutionStopHighlightForCurrentContext(applied.targetRow);
		showEditorMessage(applied.statusLine, constants.COLOR_STATUS_ERROR, 2.0);
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
		showEditorMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
	}

	private resetGlobalSearchView(): void {
		editorSearchState.globalMatches = [];
		editorSearchState.displayOffset = 0;
		editorSearchState.hoverIndex = -1;
		editorSearchState.scope = 'local';
	}

	private initialize(
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		fontVariant: Parameters<typeof setFontVariant>[1],
	): ResourcePanelController {
		editorViewState.fontVariant = fontVariant;
		constants.setIdeThemeVariant(constants.DEFAULT_THEME);
		editorRuntimeState.themeVariant = constants.getActiveIdeThemeVariant();
		editorRuntimeState.caseInsensitive = false;
		editorRuntimeState.uppercaseDisplay = true;
		setEditorCaseInsensitivity(editorRuntimeState.uppercaseDisplay);
		applyViewportSize(viewport);
		resetSemanticProjects();
		editorViewState.scrollbars = {
			codeVertical: new Scrollbar('codeVertical', 'vertical'),
			codeHorizontal: new Scrollbar('codeHorizontal', 'horizontal'),
			resourceVertical: new Scrollbar('resourceVertical', 'vertical'),
			resourceHorizontal: new Scrollbar('resourceHorizontal', 'horizontal'),
			viewerVertical: new Scrollbar('viewerVertical', 'vertical'),
		};
		editorViewState.scrollbarController = new ScrollbarController(editorViewState.scrollbars);
		const resourcePanel = new ResourcePanelController(this, this.sources, {
			resourceVertical: editorViewState.scrollbars.resourceVertical,
			resourceHorizontal: editorViewState.scrollbars.resourceHorizontal,
		}, resourcePanelWidthRatio);
		if (!this.isAvailable) {
			configureFontVariant(this.clock, editorViewState.fontVariant, null);
			resourcePanel.setFontMetrics(editorViewState.lineHeight, editorViewState.charAdvance);
			editorRuntimeState.initialized = false;
			return resourcePanel;
		}
		clearCodeEditorInputs();
		editorTextModelService.clear();
		const initialContext = retainEntryTabContext(this.sources);
		configureFontVariant(this.clock, editorViewState.fontVariant, initialContext.model.mode);
		resourcePanel.setFontMetrics(editorViewState.lineHeight, editorViewState.charAdvance);
		editorSearchState.field = createInlineTextField();
		symbolSearchState.field = createInlineTextField();
		resourceSearchState.field = createInlineTextField();
		lineJumpState.field = createInlineTextField();
		createResourceState.field = createInlineTextField();
		applySearchFieldText(editorSearchState.query, true);
		applySymbolSearchFieldText(symbolSearchState.query, true);
		applyResourceSearchFieldText(resourceSearchState.query, true);
		applyLineJumpFieldText(lineJumpState.value, true);
		applyCreateResourceFieldText(createResourceState.path, true);
		this.completion.closeSession();
		this.completion.enterCommitsCompletion = false;
		problemsPanel.setDiagnostics(editorDiagnosticsState.diagnostics);
		editorViewState.codeVerticalScrollbarVisible = false;
		editorViewState.codeHorizontalScrollbarVisible = false;
		editorViewState.cachedVisibleRowCount = 1;
		editorViewState.cachedVisibleColumnCount = 1;
		editorViewState.cachedMaxScrollColumn = 0;
		initializeTabs(initialContext);
		resourcePanel.queuePendingSelection(null);
		editorChromeState.resourcePanelResizing = false;
		activeCodeEditor.view.desiredColumn = activeCodeEditor.view.cursorColumn;
		assertMonospace();
		initializeNavigationState();
		editorRuntimeState.initialized = true;
		return resourcePanel;
	}

	private syncResourcePanelViewport(): void {
		const resourcePanel = this.resourcePanel;
		if (!resourcePanel.visible) {
			return;
		}
		const bounds = resourcePanel.getBounds();
		if (!bounds) {
			resourcePanel.hide();
			editorChromeState.resourcePanelResizing = false;
			return;
		}
		resourcePanel.clampHScroll();
		resourcePanel.ensureSelectionVisible();
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
		if (this.editorRenderTargetBaselineActive) {
			return;
		}
		const presenter = this.presenter;
		this.editorRenderTargetBaselineWidth = presenter.viewportSize.x;
		this.editorRenderTargetBaselineHeight = presenter.viewportSize.y;
		this.editorRenderTargetBaselineActive = true;
		presenter.setRenderTargetSize(EDITOR_TARGET_WIDTH, EDITOR_TARGET_HEIGHT);
		this.overlayRenderer.setRenderingViewportType(presenter, 'viewport');
		this.updateViewport(this.overlayRenderer.viewportSize);
	}

	private leaveRenderTargets(): void {
		if (!this.editorRenderTargetBaselineActive) {
			return;
		}
		const presenter = this.presenter;
		presenter.setRenderTargetSize(
			this.editorRenderTargetBaselineWidth,
			this.editorRenderTargetBaselineHeight,
		);
		this.overlayRenderer.setRenderingViewportType(presenter, 'viewport');
		this.updateViewport(this.overlayRenderer.viewportSize);
		this.editorRenderTargetBaselineActive = false;
	}
}
