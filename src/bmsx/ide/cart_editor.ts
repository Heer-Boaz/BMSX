import { consoleCore } from '../core/console';
import type { Runtime } from '../machine/runtime/runtime';
import type { Viewport } from '../rompack/format';
import { resolveLuaSourceRecordFromRegistries } from '../machine/program/sources';
import { api } from './runtime/overlay_api';
import * as constants from './common/constants';
import type { CodeTabMode, FaultSnapshot, RuntimeErrorDetails } from './common/models';
import { showEditorMessage, updateEditorMessage, setEditorFeedbackActive, editorFeedbackState } from './common/feedback_state';
import { clearBackgroundTasks } from './common/background_tasks';
import { editorRuntimeState } from './editor/common/runtime_state';
import { clearWorkspaceDirtyBuffers } from './workbench/workspace/autosave';
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
import { resetSemanticWorkspace } from './editor/contrib/intellisense/semantic/workspace/state';
import { updateRuntimeErrorOverlay } from './editor/contrib/runtime_error/overlay';
import { getTextSnapshot } from './editor/text/source_text';
import { editorDocumentState } from './editor/editing/document_state';
import { editorDiagnosticsState } from './editor/contrib/diagnostics/state';
import { processDiagnosticsQueue } from './editor/contrib/diagnostics/controller';
import { applyLineJumpFieldText } from './editor/contrib/find/line_jump';
import { EditorSearchController, applySearchFieldText, cancelGlobalSearchJob, cancelSearchJob, startSearchJob } from './editor/contrib/find/search';
import { editorSearchState, lineJumpState } from './editor/contrib/find/widget_state';
import { renameController } from './editor/contrib/rename/controller';
import { EditorCompletionController } from './editor/contrib/suggest/completion_controller';
import { symbolSearchState } from './editor/contrib/symbols/search/state';
import { applySymbolSearchFieldText } from './editor/contrib/symbols/shared';
import { renderInlineWidgets } from './quick_input/inline_widget';
import { handleEditorInput } from './input/keyboard/dispatch';
import { captureKeys } from './editor/input/keyboard/capture_keys';
import { editorInput } from './editor/input/keyboard/text_input';
import { handleTextEditorPointerInput } from './input/pointer/dispatch';
import { editorPointerState } from './input/pointer/state';
import { handleEditorWheelInput } from './input/pointer/wheel';
import { findCodeTabContext, getActiveCodeTabContext, getActiveCodeTabContextId, createEntryTabContext } from './workbench/ui/code_tab/contexts';
import { storeActiveCodeTabContext } from './workbench/ui/code_tab/activation';
import { buildDirtyFilePath, hasWorkspaceStorage } from './workbench/workspace/io';
import { initializeWorkspaceStorage, runWorkspaceAutosaveTick, stopWorkspaceAutosaveLoop } from './workbench/workspace/storage';
import { workspaceState } from './workbench/workspace/state';
import { workspaceSourceCache } from './workspace/cache';
import { DebuggerUiController, getBreakpointsForChunk } from './workbench/contrib/debugger/controller';
import { closeBlockingWorkbenchModal, drawBlockingWorkbenchModal, handleBlockingWorkbenchModalInput, hasBlockingWorkbenchModal } from './workbench/contrib/modal/blocking_modal';
import { drawProblemsPanel, problemsPanel } from './workbench/contrib/problems/panel/controller';
import { ResourcePanelController } from './workbench/contrib/resources/panel/controller';
import { applyCreateResourceFieldText, closeCreateResourcePrompt } from './workbench/contrib/resources/create';
import { createResourceState, resourceSearchState } from './workbench/contrib/resources/widget_state';
import { applyResourceSearchFieldText } from './workbench/contrib/resources/search';
import { IdeCommandController } from './commands/controller';
import {
	activateNavigationEntryContext,
	applyNavigationEntryPosition,
	completeNavigationHistoryJump,
	initializeNavigationState,
	takeBackwardNavigationEntry,
	takeForwardNavigationEntry,
	withNavigationCaptureSuspended,
	type NavigationHistoryEntry,
} from './navigation/navigation_history';
import { focusChunkSource } from './workbench/contrib/resources/navigation';
import { editorChromeState } from './workbench/ui/chrome_state';
import { tabSessionState } from './workbench/ui/tab/session_state';
import { activateCodeTab, findTabById, initializeTabs, isResourceViewActive, setActiveTab } from './workbench/ui/tabs';
import { drawResourcePanel, drawResourceViewer } from './workbench/render/resource_panel';
import { renderEditorContextMenu } from './workbench/render/context_menu';
import { renderStatusBar } from './workbench/render/status_bar';
import { renderTabBar } from './workbench/render/tab_bar';
import { renderTopBar, renderTopBarDropdown } from './workbench/render/top_bar';
import type { ChromeRenderContext } from './workbench/render/chrome_context';

type RenderRuntimeFaultOverlayOptions = {
	snapshot: FaultSnapshot;
	luaRuntimeFailed: boolean;
	needsFlush: boolean;
	force?: boolean;
};

export type CartEditor = {
	readonly blocksRuntimePipeline: true;
	readonly completion: EditorCompletionController;
	readonly resourcePanel: ResourcePanelController;
	readonly search: EditorSearchController;
	readonly debugger: DebuggerUiController;
	readonly commands: IdeCommandController;
	readonly navigation: EditorNavigationController;
	isActive: boolean;
	activate: () => void;
	deactivate: () => void;
	tickInput: () => void;
	update: (deltaSeconds: number) => void;
	draw: () => void;
	shutdown: () => void;
	updateViewport: (viewport: Viewport) => void;
	setFontVariant: (variant: Parameters<typeof setFontVariant>[1]) => void;
	showRuntimeErrorInChunk: (path: string, line: number, column: number, message: string, details?: RuntimeErrorDetails) => void;
	showRuntimeError: (line: number, column: number, message: string, details?: RuntimeErrorDetails, path?: string) => void;
	clearRuntimeErrorOverlay: typeof clearRuntimeErrorOverlay;
	clearAllRuntimeErrorOverlays: typeof clearAllRuntimeErrorOverlays;
	getSourceForChunk: (path: string) => string;
	clearWorkspaceDirtyBuffers: () => ReturnType<typeof clearWorkspaceDirtyBuffers>;
	renderFaultOverlay: () => void;
	renderRuntimeFaultOverlay: (options: RenderRuntimeFaultOverlayOptions) => boolean;
	clearNativeMemberCompletionCache: () => void;
	handleRuntimeTaskError: (error: unknown, fallbackMessage: string) => void;
};

export function getSourceForChunk(runtime: Runtime, path: string): string {
	const asset = resolveLuaSourceRecordFromRegistries(path, [
		runtime.activeLuaSources,
		runtime.cartLuaSources,
		runtime.systemLuaSources,
	]);
	const context = findCodeTabContext(asset.source_path);
	if (context) {
		if (context.id === getActiveCodeTabContext().id && context.id === tabSessionState.activeTabId) {
			return getTextSnapshot(editorDocumentState.buffer);
		}
		return getTextSnapshot(context.buffer);
	}
	if (hasWorkspaceStorage()) {
		const dirtyPath = buildDirtyFilePath(asset.source_path);
		const dirtyCached = workspaceSourceCache.get(dirtyPath);
		if (dirtyCached !== undefined) {
			return dirtyCached;
		}
	}
	return asset.src;
}

class RuntimeCartEditor implements CartEditor {
	public readonly blocksRuntimePipeline = true;
	public readonly completion: EditorCompletionController;
	public readonly resourcePanel: ResourcePanelController;
	public readonly search: EditorSearchController;
	public readonly debugger: DebuggerUiController;
	public readonly commands: IdeCommandController;
	public readonly navigation: EditorNavigationController;
	public readonly clearRuntimeErrorOverlay = clearRuntimeErrorOverlay;
	public readonly clearAllRuntimeErrorOverlays = clearAllRuntimeErrorOverlays;
	public readonly clearNativeMemberCompletionCache: () => void;
	private crtPostprocessingEnabledBeforeEditor: boolean | null = null;
	private readonly runtime: Runtime;
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

	public constructor(runtime: Runtime, viewport: Viewport) {
		this.runtime = runtime;
		this.commands = new IdeCommandController(runtime);
		this.navigation = new EditorNavigationController(runtime);
		this.completion = new EditorCompletionController(runtime);
		this.resourcePanel = this.initialize(viewport);
		this.search = new EditorSearchController(runtime, renameController);
		this.debugger = new DebuggerUiController(runtime);
		this.clearNativeMemberCompletionCache = () => clearNativeMemberCompletionCache(runtime);
	}

	public get isActive(): boolean { return editorRuntimeState.active; }

	public activate(): void {
		const runtime = this.runtime;
		if (!runtime.hasProgramSymbols) {
			return;
		}
		editorInput.applyOverrides(true, captureKeys);
		const activeContextId = getActiveCodeTabContextId();
		if (activeContextId) {
			const existingTab = findTabById(activeContextId);
			if (existingTab) {
				setActiveTab(activeContextId);
			} else {
				activateCodeTab();
			}
		} else {
			activateCodeTab();
		}
		bumpTextVersion();
		editorCaretState.cursorVisible = true;
		editorCaretState.blinkTimer = 0;
		editorRuntimeState.active = true;
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
		if (editorFeedbackState.message.visible && !Number.isFinite(editorFeedbackState.message.timer) && editorFeedbackState.deferredMessageDuration !== null) {
			editorFeedbackState.message.timer = editorFeedbackState.deferredMessageDuration;
		}
		editorFeedbackState.deferredMessageDuration = null;
		if (editorViewState.dimCrtInEditor) {
			this.disableCrtPostprocessingForEditor();
		}
		if (runtime.hasRuntimeFailed) {
			const rendered = this.renderRuntimeFaultOverlay({
				snapshot: runtime.workbenchFaultState.faultSnapshot,
				luaRuntimeFailed: runtime.hasRuntimeFailed,
				needsFlush: runtime.workbenchFaultState.faultOverlayNeedsFlush,
				force: false,
			});
			if (rendered) {
				runtime.workbenchFaultState.faultOverlayNeedsFlush = false;
			}
		}
	}

	public deactivate(): void {
		storeActiveCodeTabContext();
		editorRuntimeState.active = false;
		setEditorFeedbackActive(false);
		if (editorViewState.dimCrtInEditor) {
			this.restoreCrtPostprocessingFromEditor();
		}
		this.runtime.editor.completion.closeSession();
		editorInput.applyOverrides(false, captureKeys);
		editorDocumentState.selectionAnchor = null;
		editorPointerState.pointerSelecting = false;
		editorPointerState.pointerPrimaryWasPressed = false;
		editorPointerState.pointerAuxWasPressed = false;
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
		this.runtime.editor.resourcePanel.hide();
		editorChromeState.resourcePanelResizing = false;
		cancelSearchJob();
		cancelGlobalSearchJob();
		this.resetGlobalSearchView();
		clearBackgroundTasks();
		editorDiagnosticsState.diagnosticsTaskPending = false;
		editorRuntimeState.lastReportedSemanticError = null;
	}

	public tickInput(): void {
		const runtime = this.runtime;
		handleEditorWheelInput(runtime);
		handleTextEditorPointerInput(runtime);
		if (hasBlockingWorkbenchModal()) {
			handleBlockingWorkbenchModalInput(runtime);
			return;
		}
		handleEditorInput(runtime);
	}

	public update(deltaSeconds: number): void {
		const runtime = this.runtime;
		updateBlink(deltaSeconds);
		updateEditorMessage(deltaSeconds);
		updateRuntimeErrorOverlay(deltaSeconds);
		runtime.editor.completion.processPending(deltaSeconds);
		const semanticError = editorViewState.layout.getLastSemanticError();
		if (semanticError && semanticError !== editorRuntimeState.lastReportedSemanticError) {
			showEditorMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
			editorRuntimeState.lastReportedSemanticError = semanticError;
		} else if (!semanticError && editorRuntimeState.lastReportedSemanticError !== null) {
			editorRuntimeState.lastReportedSemanticError = null;
		}
		if (editorDiagnosticsState.diagnosticsDirty) {
			processDiagnosticsQueue(runtime, editorRuntimeState.clockNow());
		}
	}

	public updateViewport(viewport: Viewport): void {
		applyViewportSize(viewport);
		this.syncResourcePanelViewport();
		refreshViewportLayout();
	}

	public draw(): void {
		const runtime = this.runtime;
		editorViewState.codeVerticalScrollbarVisible = false;
		editorViewState.codeHorizontalScrollbarVisible = false;
		api.fill_rect(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, 0, constants.COLOR_FRAME);

		renderTopBar(runtime.editor.commands, this.chromeRenderContext);

		editorViewState.tabBarRowCount = renderTabBar(this.chromeRenderContext);
		drawResourcePanel(runtime.editor.resourcePanel);
		if (isResourceViewActive()) {
			drawResourceViewer();
		} else {
			renderInlineWidgets();
			const resourcePanel = runtime.editor.resourcePanel;
			const problemsPanelHasFocus = problemsPanel.isVisible && problemsPanel.isFocused;
			const cursorActive = !(editorSearchState.active || lineJumpState.active || resourcePanel.isFocused() || createResourceState.active || problemsPanelHasFocus);
			const codeAreaViewport = renderCodeArea(
				runtime.editor.completion,
				cursorActive,
				getBreakpointsForChunk(getActiveCodeTabContext().descriptor.path),
			);
			renderEditorContextMenu(codeAreaViewport);
		}
		drawProblemsPanel();
		renderStatusBar(runtime);
		renderTopBarDropdown(runtime.editor.commands, this.chromeRenderContext);
		if (hasBlockingWorkbenchModal()) {
			drawBlockingWorkbenchModal();
		}
	}

	public shutdown(): void {
		this.debugger.dispose();
		this.completion.dispose();
		clearExecutionStopHighlights();
		storeActiveCodeTabContext();
		editorInput.applyOverrides(false, captureKeys);
		if (editorViewState.dimCrtInEditor) {
			this.restoreCrtPostprocessingFromEditor();
		}
		editorRuntimeState.active = false;
		setEditorFeedbackActive(false);
		if (workspaceState.autosaveEnabled) {
			stopWorkspaceAutosaveLoop();
			void runWorkspaceAutosaveTick(this.runtime);
		}
		workspaceState.autosaveEnabled = false;
		workspaceSourceCache.clear();
		workspaceState.autosaveSignature = null;
		initializeWorkspaceStorage(this.runtime, null);
		editorPointerState.pointerSelecting = false;
		editorPointerState.pointerPrimaryWasPressed = false;
		editorPointerState.pointerAuxWasPressed = false;
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
		this.runtime.editor.resourcePanel.hide();
		editorChromeState.resourcePanelResizing = false;
		activateCodeTab();
	}

	public setFontVariant(variant: Parameters<typeof setFontVariant>[1]): void {
		const runtime = this.runtime;
		const activeContext = getActiveCodeTabContext();
		let activeCodeTabMode: CodeTabMode | null = null;
		if (activeContext) {
			activeCodeTabMode = activeContext.mode;
		}
		setFontVariant(runtime, variant, activeCodeTabMode, getActiveCodeTabContextId());
		this.resourcePanel.setFontMetrics(editorViewState.lineHeight, editorViewState.charAdvance);
	}

	public showRuntimeErrorInChunk(path: string, line: number, column: number, message: string, details?: RuntimeErrorDetails): void {
		if (!editorRuntimeState.active) {
			this.activate();
		}
		focusChunkSource(this.runtime, path);
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

	public getSourceForChunk(path: string): string {
		const runtime = this.runtime;
		return getSourceForChunk(runtime, path);
	}

	public clearWorkspaceDirtyBuffers(): ReturnType<typeof clearWorkspaceDirtyBuffers> {
		const runtime = this.runtime;
		return clearWorkspaceDirtyBuffers(runtime);
	}

	public renderFaultOverlay(): void {
		const snapshot = this.runtime.workbenchFaultState.faultSnapshot;
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
		if (!options.force && (!options.luaRuntimeFailed || !options.needsFlush)) {
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
		consoleCore.paused = true;
		this.activate();
		const message = `${fallbackMessage}: ${errormsg}`;
		this.runtime.terminal.appendStderr(message);
		showEditorMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
	}

	private resetGlobalSearchView(): void {
		editorSearchState.globalMatches = [];
		editorSearchState.displayOffset = 0;
		editorSearchState.hoverIndex = -1;
		editorSearchState.scope = 'local';
	}

	private initialize(viewport: Viewport): ResourcePanelController {
		const runtime = this.runtime;
		editorViewState.fontVariant = runtime.activeIdeFontVariant;
		constants.setIdeThemeVariant(constants.DEFAULT_THEME);
		editorRuntimeState.themeVariant = constants.getActiveIdeThemeVariant();
		editorRuntimeState.caseInsensitive = false;
		editorRuntimeState.uppercaseDisplay = true;
		setEditorCaseInsensitivity(editorRuntimeState.uppercaseDisplay);
		editorDocumentState.preMutationSource = null;
		applyViewportSize(viewport);
		editorRuntimeState.clockNow = runtime.clock.now;
		resetSemanticWorkspace();
		editorViewState.scrollbars = {
			codeVertical: new Scrollbar('codeVertical', 'vertical'),
			codeHorizontal: new Scrollbar('codeHorizontal', 'horizontal'),
			resourceVertical: new Scrollbar('resourceVertical', 'vertical'),
			resourceHorizontal: new Scrollbar('resourceHorizontal', 'horizontal'),
			viewerVertical: new Scrollbar('viewerVertical', 'vertical'),
		};
		editorViewState.scrollbarController = new ScrollbarController(editorViewState.scrollbars);
		const resourcePanel = new ResourcePanelController(runtime, {
			resourceVertical: editorViewState.scrollbars.resourceVertical,
			resourceHorizontal: editorViewState.scrollbars.resourceHorizontal,
		});
		initializeWorkspaceStorage(runtime, runtime.cartProjectRootPath ?? runtime.systemProjectRootPath);
		const initialContext = createEntryTabContext(runtime);
		configureFontVariant(runtime, editorViewState.fontVariant, initialContext.mode);
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
		initializeTabs(initialContext, resourcePanel);
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
		this.crtPostprocessingEnabledBeforeEditor = consoleCore.view.crt_postprocessing_enabled;
		consoleCore.view.crt_postprocessing_enabled = false;
	}

	private restoreCrtPostprocessingFromEditor(): void {
		const enabled = this.crtPostprocessingEnabledBeforeEditor;
		if (enabled === null) {
			return;
		}
		consoleCore.view.crt_postprocessing_enabled = enabled;
		this.crtPostprocessingEnabledBeforeEditor = null;
	}
}

export class EditorNavigationController {
	public constructor(private readonly runtime: Runtime) {
	}

	public goBackward(): void {
		const target = takeBackwardNavigationEntry();
		if (!target) {
			return;
		}
		this.openHistoryEntry(target);
	}

	public goForward(): void {
		const target = takeForwardNavigationEntry();
		if (!target) {
			return;
		}
		this.openHistoryEntry(target);
	}

	private openHistoryEntry(target: NavigationHistoryEntry): void {
		withNavigationCaptureSuspended(() => {
			if (!activateNavigationEntryContext(target)) {
				focusChunkSource(this.runtime, target.path);
				activateNavigationEntryContext(target);
			}
			applyNavigationEntryPosition(target);
		});
		completeNavigationHistoryJump(target);
	}
}

export function createCartEditor(runtime: Runtime, viewport: Viewport): CartEditor {
	return new RuntimeCartEditor(runtime, viewport);
}
