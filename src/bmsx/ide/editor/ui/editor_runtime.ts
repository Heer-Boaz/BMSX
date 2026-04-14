import { Runtime } from '../../../emulator/runtime';
import * as runtimeIde from '../../../emulator/runtime_ide';
import { $ } from '../../../core/engine_core';
import { api } from './view/overlay_api';
import * as constants from '../../common/constants';
import { activateCodeTab, getActiveCodeTabContext, isResourceViewActive, setActiveTab, storeActiveCodeTabContext } from '../../workbench/ui/tabs';
import { cancelGlobalSearchJob, startSearchJob } from '../contrib/find/editor_search';
import { editorRuntimeState } from '../common/editor_runtime_state';
import { editorFeedbackState, setEditorFeedbackActive, showEditorMessage, updateEditorMessage } from '../../workbench/common/feedback_state';
import { bumpTextVersion } from '../common/text_runtime';
import { ensureCursorVisible } from './caret';
import { drawProblemsPanel } from '../../workbench/contrib/problems/problems_panel';
import { renderTopBar, renderTopBarDropdown } from '../../workbench/render/render_top_bar';
import { renderTabBar } from '../../workbench/render/render_tab_bar';
import { renderCodeArea } from '../render/render_code_area';
import { renderStatusBar } from '../../workbench/render/render_status_bar';
import { drawResourcePanel, drawResourceViewer } from '../../workbench/render/render_resource_panel';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorSessionState } from './editor_session_state';
import { editorViewState } from './editor_view_state';
import { editorFeatureState } from '../common/editor_feature_state';
import { editorSearchState, lineJumpState } from '../contrib/find/find_widget_state';
import { renderInlineWidgets } from '../contrib/quick_input/inline_widget';
import { renderRuntimeFaultOverlay } from '../render/render_error_overlay';
import { handleEditorInput } from '../input/keyboard/editor_keyboard_dispatch';
import { closeBlockingWorkbenchModal, drawBlockingWorkbenchModal, handleBlockingWorkbenchModalInput, hasBlockingWorkbenchModal } from '../../workbench/contrib/modal/blocking_modal';
import { handleTextEditorPointerInput } from '../input/pointer/editor_pointer_dispatch';
import { handleEditorWheelInput } from '../input/pointer/editor_wheel_input';
import { updateBlink } from './inline_text_field';
import { stopWorkspaceAutosaveLoop, runWorkspaceAutosaveTick, initializeWorkspaceStorage } from '../../workbench/common/workspace_storage';
import { workspaceState } from '../../workbench/common/workspace_storage';
import { clearWorkspaceCachedSources } from '../../../emulator/workspace_cache';
import { clearBackgroundTasks } from '../../common/background_tasks';
import { clearGotoHoverHighlight } from '../contrib/intellisense/intellisense';
import { updateRuntimeErrorOverlay } from '../contrib/runtime_error/runtime_error_overlay';
import { hideResourcePanel } from './editor_view';
import {
	applySearchFieldText,
	cancelSearchJob,
} from '../contrib/find/editor_search';
import { clearExecutionStopHighlights, syncRuntimeErrorOverlayFromContext } from '../contrib/runtime_error/runtime_error_navigation';
import { processDiagnosticsQueue } from '../contrib/diagnostics/diagnostics_controller';
import { editorDiagnosticsState } from '../contrib/diagnostics/diagnostics_state';
import { updateDesiredColumn } from './caret';
import { applyLineJumpFieldText } from '../contrib/find/line_jump';
import { applyCreateResourceFieldText, closeCreateResourcePrompt } from '../../workbench/contrib/resources/create_resource';
import { createResourceState } from '../../workbench/contrib/resources/resource_widget_state';
import { editorPointerState } from '../input/pointer/editor_pointer_state';
import { editorCaretState } from './caret_state';
import { captureKeys } from '../input/keyboard/editor_capture_keys';
import { editorInput } from '../input/keyboard/editor_text_input';

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
	editorFeatureState.completion.processPending(deltaSeconds);
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
		Runtime.instance.restoreCrtPostprocessingFromEditor();
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
	if (editorSessionState.activeCodeTabContextId) {
		const existingTab = editorSessionState.tabs.find(candidate => candidate.id === editorSessionState.activeCodeTabContextId);
		if (existingTab) {
			setActiveTab(editorSessionState.activeCodeTabContextId);
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
		Runtime.instance.disableCrtPostprocessingForEditor();
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
		Runtime.instance.restoreCrtPostprocessingFromEditor();
	}
	editorFeatureState.completion.closeSession();
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
	runtimeIde.activateEditor(Runtime.instance);
	const message = `${fallbackMessage}: ${errormsg}`;
	Runtime.instance.terminal.appendStderr(message);
	showEditorMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
}
