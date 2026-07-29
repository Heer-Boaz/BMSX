import type { HostAudioOutput } from '../hosts/common/audio_output';
import type { GateGroup } from '../machine/ts/common/taskgate';
import type { Input } from '../machine/ts/input/manager';
import type { Runtime } from '../machine/ts/machine/runtime/runtime';
import type {
	ClipboardService,
	HostClock,
	LogOutput,
	MicrotaskQueue,
	StorageService,
} from '../machine/ts/platform/platform';
import type { VideoPresenter } from '../machine/ts/render/video_presenter';
import { runtimeSourcesSupportIde, type RuntimeSourceState } from './runtime/sources';
import { blua32ToolingImageForDomain } from '../machine/ts/rompack/tooling/blua32_media';
import type { Viewport } from './common/viewport';
import { api } from './runtime/overlay_api';
import * as constants from './common/constants';
import type { CodeTabMode, FaultSnapshot, RuntimeErrorDetails } from './common/models';
import type { RuntimeFaultState } from './runtime/fault_state';
import type { RuntimeLuaTooling } from './runtime/lua_tooling';
import type { RuntimeDebuggerState } from './runtime/debugger_state';
import type { OverlayRenderer } from './runtime/overlay_renderer';
import { showEditorMessage, updateEditorMessage, setEditorFeedbackActive, editorFeedbackState } from './common/feedback_state';
import { clearBackgroundTasks, runBackgroundTasks } from './common/background_tasks';
import { editorRuntimeState } from './editor/common/runtime_state';
import { bumpTextVersion } from './editor/common/text/runtime';
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
import { resetSemanticWorkspaces } from './editor/contrib/intellisense/semantic/workspace/state';
import { updateRuntimeErrorOverlay } from './editor/contrib/runtime_error/overlay';
import { editorDocumentState } from './editor/editing/document_state';
import { clearSingleCursorSelection } from './editor/editing/cursor/state';
import { editorDiagnosticsState } from './editor/contrib/diagnostics/state';
import { processDiagnosticsQueue } from './editor/contrib/diagnostics/controller';
import { applyLineJumpFieldText } from './editor/contrib/find/line_jump';
import { EditorSearchController, applySearchFieldText, cancelGlobalSearchJob, cancelSearchJob, startSearchJob } from './editor/contrib/find/search';
import { editorSearchState, lineJumpState } from './editor/contrib/find/widget_state';
import { renameController } from './editor/contrib/rename/controller';
import { CrossFileRenameManager } from './editor/contrib/rename/operations';
import { EditorCompletionController } from './editor/contrib/suggest/completion_controller';
import { symbolSearchState } from './editor/contrib/symbols/search/state';
import { applySymbolSearchFieldText } from './editor/contrib/symbols/shared';
import { renderInlineWidgets } from './quick_input/inline_widget';
import { handleEditorInput } from './input/keyboard/dispatch';
import { captureKeys } from './editor/input/keyboard/capture_keys';
import { editorInput } from './editor/input/keyboard/text_input';
import { handleTextEditorPointerInput } from './input/pointer/dispatch';
import { clearEditorPointerSelectionState, editorPointerState } from './input/pointer/state';
import { handleEditorWheelInput } from './input/pointer/wheel';
import { getActiveCodeTabContext, getActiveCodeTabContextId, createEntryTabContext } from './workbench/ui/code_tab/contexts';
import { storeActiveCodeTabContext } from './workbench/ui/code_tab/activation';
import {
	cancelWorkspaceAutosave,
	requestWorkspaceAutosave,
	runWorkspaceAutosaveTick,
	shutdownWorkspaceStorage,
} from './workbench/workspace/storage';
import { WorkspaceAutosaveChange } from './workbench/workspace/models';
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
import { editorChromeState } from './workbench/ui/chrome_state';
import { activateCodeTab, findTabById, initializeTabs, isResourceViewActive, setActiveTab } from './workbench/ui/tabs';
import { drawResourcePanel, drawResourceViewer } from './workbench/render/resource_panel';
import { renderEditorContextMenu } from './workbench/render/context_menu';
import { renderStatusBar } from './workbench/render/status_bar';
import { renderTabBar } from './workbench/render/tab_bar';
import { renderTopBar, renderTopBarDropdown } from './workbench/render/top_bar';
import type { ChromeRenderContext } from './workbench/render/chrome_context';


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
	showRuntimeErrorInChunk: (path: string, line: number, column: number, message: string, details?: RuntimeErrorDetails) => void;
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
	private readonly input: Input;
	private readonly storage: StorageService;
	private readonly clock: HostClock;
	private readonly clipboard: ClipboardService;
	private readonly microtasks: MicrotaskQueue;
	private readonly sources: RuntimeSourceState;
	private readonly fault: RuntimeFaultState;
	private readonly luaTooling: RuntimeLuaTooling;
	private readonly debuggerState: RuntimeDebuggerState;
	private readonly overlayRenderer: OverlayRenderer;
	private readonly unsubscribeWorkspaceCursorMoved: () => void;
	private readonly unsubscribeWorkspaceTextMutated: () => void;
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
		input: Input,
		audioOutput: HostAudioOutput,
		storage: StorageService,
		clock: HostClock,
		clipboard: ClipboardService,
		microtasks: MicrotaskQueue,
		logOutput: LogOutput,
		resourcePanelWidthRatio: number,
		viewport: Viewport,
		fontVariant: Parameters<typeof setFontVariant>[1],
		sources: RuntimeSourceState,
		fault: RuntimeFaultState,
		luaTooling: RuntimeLuaTooling,
		debuggerState: RuntimeDebuggerState,
		luaGate: GateGroup,
		overlayRenderer: OverlayRenderer,
	) {
		this.runtime = runtime;
		this.presenter = presenter;
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
			luaGate,
			overlayRenderer,
			runtime,
			input,
			audioOutput,
			microtasks,
			storage,
			clock,
			logOutput,
		);
		this.completion = new EditorCompletionController(luaTooling, fault, runtime);
		this.resourcePanel = this.initialize(resourcePanelWidthRatio, viewport, fontVariant);
		this.navigation = new EditorNavigationController(
			this,
			this.sources,
			this.resourcePanel,
			storage,
		);
		this.crossFileRename = new CrossFileRenameManager(this.sources);
		this.search = new EditorSearchController(this.sources, renameController);
		this.breakpoints = new BreakpointController(debuggerState);
		this.clearNativeMemberCompletionCache = clearNativeMemberCompletionCache;
		this.unsubscribeWorkspaceCursorMoved = editorDocumentState.onCursorMoved(() => {
			if (editorDocumentState.dirty) {
				requestWorkspaceAutosave(WorkspaceAutosaveChange.ActiveEditor);
			}
		});
		this.unsubscribeWorkspaceTextMutated = editorDocumentState.onTextMutated(() => {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.DirtyFiles);
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
		const activeContextId = getActiveCodeTabContextId();
		if (activeContextId) {
			const existingTab = findTabById(activeContextId);
			if (existingTab) {
				setActiveTab(this.resourcePanel, activeContextId);
			} else {
				activateCodeTab(this.resourcePanel);
			}
		} else {
			activateCodeTab(this.resourcePanel);
		}
		bumpTextVersion();
		editorCaretState.cursorVisible = true;
		editorCaretState.blinkTimer = 0;
		this.enterRenderTargets();
		editorRuntimeState.active = true;
		this.overlayRenderer.active = true;
		setEditorFeedbackActive(true);
		editorPointerState.pointerSelecting = false;
		editorPointerState.pointerPrimaryWasPressed = false;
		editorCaretState.cursorRevealSuspended = false;
		updateDesiredColumn();
		editorDocumentState.selectionAnchor = null;
		editorSearchState.active = false;
		editorSearchState.visible = false;
		lineJumpState.active = false;
		lineJumpState.visible = false;
		lineJumpState.value = '';
		syncRuntimeErrorOverlayFromContext(getActiveCodeTabContext());
		closeBlockingWorkbenchModal();
		cancelSearchJob();
		cancelGlobalSearchJob();
		this.resetGlobalSearchView();
		if (editorSearchState.query.length === 0) {
			editorSearchState.matches = [];
			editorSearchState.currentIndex = -1;
		} else {
			startSearchJob();
		}
		ensureCursorVisible();
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
		storeActiveCodeTabContext();
		editorRuntimeState.active = false;
		this.overlayRenderer.active = false;
		setEditorFeedbackActive(false);
		if (editorViewState.dimCrtInEditor) {
			this.restoreCrtPostprocessingFromEditor();
		}
		this.completion.closeSession();
		editorInput.applyOverrides(this.input, false, captureKeys);
		clearSingleCursorSelection(editorDocumentState);
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
		const scrollRow = editorViewState.scrollRow;
		const scrollColumn = editorViewState.scrollColumn;
		const breakpointRevision = this.breakpoints.revision;
		handleEditorWheelInput(this, playerInput);
		handleTextEditorPointerInput(
			this.presenter.surface,
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
		if ((editorViewState.scrollRow !== scrollRow
			|| editorViewState.scrollColumn !== scrollColumn)
			&& editorDocumentState.dirty) {
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
		updateRuntimeErrorOverlay(deltaSeconds);
		this.completion.processPending(deltaSeconds);
		const semanticError = editorViewState.layout.getLastSemanticError();
		if (semanticError && semanticError !== editorRuntimeState.lastReportedSemanticError) {
			showEditorMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
			editorRuntimeState.lastReportedSemanticError = semanticError;
		} else if (!semanticError && editorRuntimeState.lastReportedSemanticError) {
			editorRuntimeState.lastReportedSemanticError = null;
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
		this.syncResourcePanelViewport();
		refreshViewportLayout();
	}

	public draw(): void {
		editorViewState.codeVerticalScrollbarVisible = false;
		editorViewState.codeHorizontalScrollbarVisible = false;
		api.fill_rect(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, 0, constants.COLOR_FRAME);

		renderTopBar(this.commands, this.chromeRenderContext);

		editorViewState.tabBarRowCount = renderTabBar(this.chromeRenderContext);
		drawResourcePanel(this.resourcePanel);
		if (isResourceViewActive()) {
			drawResourceViewer();
		} else {
			renderInlineWidgets();
			const resourcePanel = this.resourcePanel;
			const problemsPanelHasFocus = problemsPanel.isVisible && problemsPanel.isFocused;
			const cursorActive = !(editorSearchState.active || lineJumpState.active || resourcePanel.isFocused() || createResourceState.active || problemsPanelHasFocus);
			const codeAreaViewport = renderCodeArea(
				this.completion,
				cursorActive,
				getBreakpointsForChunk(
					this.debuggerState,
					getActiveCodeTabContext().resource.path,
				),
			);
			renderEditorContextMenu(codeAreaViewport);
		}
		drawProblemsPanel();
		renderStatusBar(this.resourcePanel, this.fault);
		renderTopBarDropdown(this.commands, this.chromeRenderContext);
		if (hasBlockingWorkbenchModal()) {
			drawBlockingWorkbenchModal();
		}
	}

	public async shutdown(): Promise<void> {
		this.completion.dispose();
		clearExecutionStopHighlights();
		if (this.isAvailable) {
			storeActiveCodeTabContext();
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
				this.unsubscribeWorkspaceTextMutated();
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
		if (this.isAvailable) {
			activateCodeTab(this.resourcePanel);
		}
	}

	public setFontVariant(variant: Parameters<typeof setFontVariant>[1]): void {
		if (!this.isAvailable) {
			return;
		}
		const previousVariant = editorViewState.fontVariant;
		const activeContext = getActiveCodeTabContext();
		let activeCodeTabMode: CodeTabMode | null = null;
		if (activeContext) {
			activeCodeTabMode = activeContext.mode;
		}
		setFontVariant(this.clock, variant, activeCodeTabMode, getActiveCodeTabContextId());
		this.resourcePanel.setFontMetrics(editorViewState.lineHeight, editorViewState.charAdvance);
		if (editorViewState.fontVariant !== previousVariant) {
			requestWorkspaceAutosave(WorkspaceAutosaveChange.Font);
		}
	}

	public showRuntimeErrorInChunk(path: string, line: number, column: number, message: string, details?: RuntimeErrorDetails): void {
		if (!editorRuntimeState.active) {
			this.activate();
		}
		this.navigation.focusChunkSourceForContext(
			this.runtime.machine.cpu.activeCartridgeSlot(),
			path,
		);
		this.showRuntimeError(line, column, message, details, path);
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
			snapshot.path,
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
			snapshot.path,
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
		editorDocumentState.preMutationSource = null;
		applyViewportSize(viewport);
		resetSemanticWorkspaces();
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
		const initialContext = createEntryTabContext(this.sources);
		configureFontVariant(this.clock, editorViewState.fontVariant, initialContext.mode);
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
		editorDocumentState.desiredColumn = editorDocumentState.cursorColumn;
		assertMonospace();
		editorDocumentState.lastSavedSource = '';
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
