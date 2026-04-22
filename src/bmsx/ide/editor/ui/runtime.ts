import { Runtime } from '../../../machine/runtime/runtime';
import * as workbenchMode from '../../runtime/workbench_mode';
import { $ } from '../../../core/engine';
import { api } from './view/overlay_api';
import * as constants from '../../common/constants';
import { activateCodeTab, findTabById, isResourceViewActive, setActiveTab } from '../../workbench/ui/tabs';
import { getActiveCodeTabContext, getActiveCodeTabContextId } from '../../workbench/ui/code_tab/contexts';
import { storeActiveCodeTabContext } from '../../workbench/ui/code_tab/activation';
import { cancelGlobalSearchJob, startSearchJob } from '../contrib/find/search';
import { editorRuntimeState } from '../common/runtime_state';
import { editorFeedbackState, setEditorFeedbackActive, showEditorMessage, updateEditorMessage } from '../../common/feedback_state';
import { bumpTextVersion } from '../common/text/runtime';
import { ensureCursorVisible } from './view/caret/caret';
import { drawProblemsPanel } from '../../workbench/contrib/problems/panel/controller';
import { renderTopBar, renderTopBarDropdown } from '../../workbench/render/top_bar';
import { renderTabBar } from '../../workbench/render/tab_bar';
import { renderCodeArea } from '../render/code_area/area';
import { renderStatusBar } from '../../workbench/render/status_bar';
import { drawResourcePanel, drawResourceViewer } from '../../workbench/render/resource_panel';
import { editorDocumentState } from '../editing/document_state';
import { editorViewState } from './view/state';
import { editorSearchState, lineJumpState } from '../contrib/find/widget_state';
import { renderInlineWidgets } from '../contrib/quick_input/inline_widget';
import { renderRuntimeFaultOverlay } from '../render/error_overlay';
import { handleEditorInput } from '../input/keyboard/dispatch';
import { closeBlockingWorkbenchModal, drawBlockingWorkbenchModal, handleBlockingWorkbenchModalInput, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';
import { handleTextEditorPointerInput } from '../input/pointer/dispatch';
import { handleEditorWheelInput } from '../input/pointer/wheel';
import { updateBlink } from './inline/text_field';
import { stopWorkspaceAutosaveLoop, runWorkspaceAutosaveTick, initializeWorkspaceStorage } from '../../workbench/workspace/storage';
import { workspaceState } from '../../workbench/workspace/state';
import { clearWorkspaceCachedSources } from '../../workspace/cache';
import { clearBackgroundTasks } from '../../common/background_tasks';
import { clearGotoHoverHighlight } from '../contrib/intellisense/engine';
import { updateRuntimeErrorOverlay } from '../contrib/runtime_error/overlay';
import { hideResourcePanel } from './view/view';
import {
	applySearchFieldText,
	cancelSearchJob,
} from '../contrib/find/search';
import { clearExecutionStopHighlights, syncRuntimeErrorOverlayFromContext } from '../../runtime/error/navigation';
import { processDiagnosticsQueue } from '../contrib/diagnostics/controller';
import { editorDiagnosticsState } from '../contrib/diagnostics/state';
import { updateDesiredColumn } from './view/caret/caret';
import { applyLineJumpFieldText } from '../contrib/find/line_jump';
import { applyCreateResourceFieldText, closeCreateResourcePrompt } from '../../workbench/contrib/resources/create';
import { createResourceState } from '../../workbench/contrib/resources/widget_state';
import { editorPointerState } from '../input/pointer/state';
import { editorCaretState } from './view/caret/state';
import { captureKeys } from '../input/keyboard/capture_keys';
import { editorInput } from '../input/keyboard/text_input';
import { completionController } from '../contrib/suggest/completion_controller';

let crtPostprocessingEnabledBeforeEditor: boolean | null = null;

function disableCrtPostprocessingForEditor(): void {
	if (crtPostprocessingEnabledBeforeEditor !== null) {
		return;
	}
	crtPostprocessingEnabledBeforeEditor = $.view.crt_postprocessing_enabled;
	$.view.crt_postprocessing_enabled = false;
}

function restoreCrtPostprocessingFromEditor(): void {
	const enabled = crtPostprocessingEnabledBeforeEditor;
	if (enabled === null) {
		return;
	}
	$.view.crt_postprocessing_enabled = enabled;
	crtPostprocessingEnabledBeforeEditor = null;
}

export function tickInput(): void {
	handleEditorWheelInput();
	handleTextEditorPointerInput();
	if (hasBlockingWorkbenchModal()) {
		handleBlockingWorkbenchModalInput();
		return;
	}
	handleEditorInput();
}

export function update(deltaSeconds: number): void {
	updateBlink(deltaSeconds);
	updateEditorMessage(deltaSeconds);
	updateRuntimeErrorOverlay(deltaSeconds);
	completionController.processPending(deltaSeconds);
	const semanticError = editorViewState.layout.getLastSemanticError();
	if (semanticError && semanticError !== editorRuntimeState.lastReportedSemanticError) {
		showEditorMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
		editorRuntimeState.lastReportedSemanticError = semanticError;
	} else if (!semanticError && editorRuntimeState.lastReportedSemanticError !== null) {
		editorRuntimeState.lastReportedSemanticError = null;
	}
	if (editorDiagnosticsState.diagnosticsDirty) {
		processDiagnosticsQueue(editorRuntimeState.clockNow());
	}
}

export function draw(): void {
	editorViewState.codeVerticalScrollbarVisible = false;
	editorViewState.codeHorizontalScrollbarVisible = false;
	api.fill_rect_color(0, 0, editorViewState.viewportWidth, editorViewState.viewportHeight, undefined, constants.COLOR_FRAME);

	renderTopBar();

	editorViewState.tabBarRowCount = renderTabBar();
	drawResourcePanel();
	if (isResourceViewActive()) {
		drawResourceViewer();
	} else {
		renderInlineWidgets();
		renderCodeArea();
	}
	drawProblemsPanel();
	renderStatusBar();
	renderTopBarDropdown();
	if (hasBlockingWorkbenchModal()) {
		drawBlockingWorkbenchModal();
	}
}

export function shutdownRuntimeEditor(): void {
	clearExecutionStopHighlights();
	storeActiveCodeTabContext();
	editorInput.applyOverrides(false, captureKeys);
	if (editorViewState.dimCrtInEditor) {
		restoreCrtPostprocessingFromEditor();
	}
	editorRuntimeState.active = false;
	setEditorFeedbackActive(false);
	if (workspaceState.autosaveEnabled) {
		stopWorkspaceAutosaveLoop();
		void runWorkspaceAutosaveTick();
	}
	workspaceState.autosaveEnabled = false;
	clearWorkspaceCachedSources();
	workspaceState.autosaveSignature = null;
	initializeWorkspaceStorage(null);
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
	editorSearchState.globalMatches = [];
	editorSearchState.displayOffset = 0;
	editorSearchState.hoverIndex = -1;
	editorSearchState.scope = 'local';
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
	hideResourcePanel();
	activateCodeTab();
}

export function activateRuntimeEditor(): void {
	if (!Runtime.instance.hasProgramSymbols) {
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
	editorSearchState.globalMatches = [];
	editorSearchState.displayOffset = 0;
	editorSearchState.hoverIndex = -1;
	editorSearchState.scope = 'local';
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
		disableCrtPostprocessingForEditor();
	}
	if (Runtime.instance.hasRuntimeFailed) {
		const rendered = renderRuntimeFaultOverlay({
			snapshot: Runtime.instance.faultSnapshot,
			luaRuntimeFailed: Runtime.instance.hasRuntimeFailed,
			needsFlush: Runtime.instance.doesFaultOverlayNeedFlush,
			force: false,
		});
		if (rendered) Runtime.instance.flushedFaultOverlay();
	}
}

export function deactivateRuntimeEditor(): void {
	storeActiveCodeTabContext();
	editorRuntimeState.active = false;
	setEditorFeedbackActive(false);
	if (editorViewState.dimCrtInEditor) {
		restoreCrtPostprocessingFromEditor();
	}
	completionController.closeSession();
	editorInput.applyOverrides(false, captureKeys);
	editorDocumentState.selectionAnchor = null;
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	editorPointerState.pointerAuxWasPressed = false;
	editorPointerState.tabDragState = null;
	clearGotoHoverHighlight();
	editorViewState.scrollbarController.cancel();
	editorCaretState.cursorRevealSuspended = false;
	editorSearchState.active = false;
	editorSearchState.visible = false;
	lineJumpState.active = false;
	lineJumpState.visible = false;
	closeBlockingWorkbenchModal();
	closeCreateResourcePrompt(false);
	hideResourcePanel();
	cancelSearchJob();
	cancelGlobalSearchJob();
	editorSearchState.globalMatches = [];
	editorSearchState.displayOffset = 0;
	editorSearchState.hoverIndex = -1;
	editorSearchState.scope = 'local';
	clearBackgroundTasks();
	editorDiagnosticsState.diagnosticsTaskPending = false;
	editorRuntimeState.lastReportedSemanticError = null;
}

export function handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
	const errormsg = error instanceof Error ? error.message : String(error);
	$.paused = true;
	workbenchMode.activateEditor(Runtime.instance);
	const message = `${fallbackMessage}: ${errormsg}`;
	Runtime.instance.terminal.appendStderr(message);
	showEditorMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
}
