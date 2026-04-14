import { Runtime } from '../../emulator/runtime';
import * as runtimeIde from '../../emulator/runtime_ide';
import { $ } from '../../core/engine_core';
import { api } from './view/overlay_api';
import * as constants from '../core/constants';
import { activateCodeTab, getActiveCodeTabContext, isResourceViewActive, setActiveTab, storeActiveCodeTabContext } from './editor_tabs';
import { cancelGlobalSearchJob, startSearchJob } from '../contrib/find/editor_search';
import { ide_state, captureKeys } from '../core/ide_state';
import { editorFeedbackState, setEditorFeedbackActive, showEditorMessage, updateEditorMessage } from '../core/editor_feedback_state';
import { bumpTextVersion } from '../core/text_utils';
import { ensureCursorVisible } from './caret';
import { drawProblemsPanel } from '../contrib/problems/problems_panel';
import { renderTopBar, renderTopBarDropdown } from '../render/render_top_bar';
import { renderTabBar } from '../render/render_tab_bar';
import { renderCodeArea } from '../render/render_code_area';
import { renderStatusBar } from '../render/render_status_bar';
import { drawResourcePanel, drawResourceViewer } from '../render/render_resource_panel';
import { drawActionPromptOverlay } from '../render/render_prompt';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorSessionState } from './editor_session_state';
import {
	renderCreateResourceBar,
	renderLineJumpBar,
	renderRenameBar,
	renderSearchBar,
	renderSymbolSearchBar,
	renderResourceSearchBar,
} from '../render/render_inline_bars';
import { renderRuntimeFaultOverlay } from '../render/render_error_overlay';
import { handleEditorInput } from '../input/keyboard/editor_keyboard_dispatch';
import { handleActionPromptInput } from '../input/overlays/action_prompt';
import { handleTextEditorPointerInput } from '../input/pointer/editor_pointer_dispatch';
import { handleEditorWheelInput } from '../input/pointer/editor_wheel_input';
import { updateBlink } from './inline_text_field';
import { stopWorkspaceAutosaveLoop, runWorkspaceAutosaveTick, initializeWorkspaceStorage } from '../core/workspace_storage';
import { workspaceState } from '../core/workspace_storage';
import { clearWorkspaceCachedSources } from '../../emulator/workspace_cache';
import { clearBackgroundTasks } from '../core/background_tasks';
import { clearGotoHoverHighlight } from '../contrib/intellisense/intellisense';
import { updateRuntimeErrorOverlay } from '../contrib/runtime_error/runtime_error_overlay';
import { hideResourcePanel } from './editor_view';
import {
	applySearchFieldText,
	cancelSearchJob,
} from '../contrib/find/editor_search';
import { clearExecutionStopHighlights, syncRuntimeErrorOverlayFromContext } from '../contrib/runtime_error/runtime_error_navigation';
import { processDiagnosticsQueue } from '../contrib/problems/diagnostics_controller';
import { editorDiagnosticsState } from '../contrib/problems/diagnostics_state';
import { updateDesiredColumn } from './caret';
import { resetActionPromptState } from '../input/overlays/action_prompt';
import { actionPromptState } from '../input/overlays/action_prompt_state';
import { applyLineJumpFieldText } from '../contrib/find/line_jump';
import { applyCreateResourceFieldText, closeCreateResourcePrompt } from '../contrib/resources/create_resource';
import { editorPointerState } from '../input/pointer/editor_pointer_state';
import { editorCaretState } from './caret_state';

export function tickInput(): void {
	handleEditorWheelInput();
	handleTextEditorPointerInput();
	if (actionPromptState.prompt) {
		handleActionPromptInput();
		return;
	}
	handleEditorInput();
}

export function update(deltaSeconds: number): void {
	updateBlink(deltaSeconds);
	updateEditorMessage(deltaSeconds);
	updateRuntimeErrorOverlay(deltaSeconds);
	ide_state.completion.processPending(deltaSeconds);
	const semanticError = ide_state.layout.getLastSemanticError();
	if (semanticError && semanticError !== ide_state.lastReportedSemanticError) {
		showEditorMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
		ide_state.lastReportedSemanticError = semanticError;
	} else if (!semanticError && ide_state.lastReportedSemanticError !== null) {
		ide_state.lastReportedSemanticError = null;
	}
	if (editorDiagnosticsState.diagnosticsDirty) {
		processDiagnosticsQueue(ide_state.clockNow());
	}
}

export function draw(): void {
	ide_state.codeVerticalScrollbarVisible = false;
	ide_state.codeHorizontalScrollbarVisible = false;
	api.fill_rect_color(0, 0, ide_state.viewportWidth, ide_state.viewportHeight, undefined, constants.COLOR_FRAME);

	renderTopBar();

	ide_state.tabBarRowCount = renderTabBar();
	drawResourcePanel();
	if (isResourceViewActive()) {
		drawResourceViewer();
	} else {
		renderCreateResourceBar();
		renderSearchBar();
		renderResourceSearchBar();
		renderSymbolSearchBar();
		renderRenameBar();
		renderLineJumpBar();
		renderCodeArea();
	}
	drawProblemsPanel();
	renderStatusBar();
	renderTopBarDropdown();
	if (actionPromptState.prompt) {
		drawActionPromptOverlay();
	}
}

export function shutdownRuntimeEditor(): void {
	clearExecutionStopHighlights();
	storeActiveCodeTabContext();
	ide_state.input.applyOverrides(false, captureKeys);
	if (ide_state.dimCrtInEditor) {
		Runtime.instance.restoreCrtPostprocessingFromEditor();
	}
	ide_state.active = false;
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
	ide_state.search.active = false;
	ide_state.search.visible = false;
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.search.matches = [];
	ide_state.search.globalMatches = [];
	ide_state.search.displayOffset = 0;
	ide_state.search.hoverIndex = -1;
	ide_state.search.scope = 'local';
	ide_state.search.currentIndex = -1;
	applySearchFieldText('', true);
	ide_state.lineJump.active = false;
	ide_state.lineJump.visible = false;
	applyLineJumpFieldText('', true);
	ide_state.createResource.active = false;
	ide_state.createResource.visible = false;
	applyCreateResourceFieldText('', true);
	ide_state.createResource.error = null;
	ide_state.createResource.working = false;
	resetActionPromptState();
	hideResourcePanel();
	activateCodeTab();
}

export function activateRuntimeEditor(): void {
	if (!Runtime.instance.hasProgramSymbols) {
		return;
	}
	ide_state.input.applyOverrides(true, captureKeys);
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
	ide_state.active = true;
	setEditorFeedbackActive(true);
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	editorCaretState.cursorRevealSuspended = false;
	updateDesiredColumn();
	editorDocumentState.selectionAnchor = null;
	ide_state.search.active = false;
	ide_state.search.visible = false;
	ide_state.lineJump.active = false;
	ide_state.lineJump.visible = false;
	ide_state.lineJump.value = '';
	syncRuntimeErrorOverlayFromContext(getActiveCodeTabContext());
	resetActionPromptState();
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.search.globalMatches = [];
	ide_state.search.displayOffset = 0;
	ide_state.search.hoverIndex = -1;
	ide_state.search.scope = 'local';
	if (ide_state.search.query.length === 0) {
		ide_state.search.matches = [];
		ide_state.search.currentIndex = -1;
	} else {
		startSearchJob();
	}
	ensureCursorVisible();
	if (editorFeedbackState.message.visible && !Number.isFinite(editorFeedbackState.message.timer) && editorFeedbackState.deferredMessageDuration !== null) {
		editorFeedbackState.message.timer = editorFeedbackState.deferredMessageDuration;
	}
	editorFeedbackState.deferredMessageDuration = null;
	if (ide_state.dimCrtInEditor) {
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
	ide_state.active = false;
	setEditorFeedbackActive(false);
	if (ide_state.dimCrtInEditor) {
		Runtime.instance.restoreCrtPostprocessingFromEditor();
	}
	ide_state.completion.closeSession();
	ide_state.input.applyOverrides(false, captureKeys);
	editorDocumentState.selectionAnchor = null;
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	editorPointerState.pointerAuxWasPressed = false;
	editorPointerState.tabDragState = null;
	clearGotoHoverHighlight();
	ide_state.scrollbarController.cancel();
	editorCaretState.cursorRevealSuspended = false;
	ide_state.search.active = false;
	ide_state.search.visible = false;
	ide_state.lineJump.active = false;
	ide_state.lineJump.visible = false;
	resetActionPromptState();
	closeCreateResourcePrompt(false);
	hideResourcePanel();
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.search.globalMatches = [];
	ide_state.search.displayOffset = 0;
	ide_state.search.hoverIndex = -1;
	ide_state.search.scope = 'local';
	clearBackgroundTasks();
	editorDiagnosticsState.diagnosticsTaskPending = false;
	ide_state.lastReportedSemanticError = null;
}

export function handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
	const errormsg = error instanceof Error ? error.message : String(error);
	$.paused = true;
	runtimeIde.activateEditor(Runtime.instance);
	const message = `${fallbackMessage}: ${errormsg}`;
	Runtime.instance.terminal.appendStderr(message);
	showEditorMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
}
