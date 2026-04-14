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
import { drawActionPromptOverlay } from '../../workbench/render/render_prompt';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorSessionState } from './editor_session_state';
import { editorViewState } from './editor_view_state';
import { editorFeatureState } from '../common/editor_feature_state';
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
import { resetActionPromptState } from '../input/overlays/action_prompt';
import { actionPromptState } from '../input/overlays/action_prompt_state';
import { applyLineJumpFieldText } from '../contrib/find/line_jump';
import { applyCreateResourceFieldText, closeCreateResourcePrompt } from '../../workbench/contrib/resources/create_resource';
import { editorPointerState } from '../input/pointer/editor_pointer_state';
import { editorCaretState } from './caret_state';
import { captureKeys } from '../input/keyboard/editor_capture_keys';
import { editorInput } from '../input/keyboard/editor_text_input';

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
	editorFeatureState.search.active = false;
	editorFeatureState.search.visible = false;
	cancelSearchJob();
	cancelGlobalSearchJob();
	editorFeatureState.search.matches = [];
	editorFeatureState.search.globalMatches = [];
	editorFeatureState.search.displayOffset = 0;
	editorFeatureState.search.hoverIndex = -1;
	editorFeatureState.search.scope = 'local';
	editorFeatureState.search.currentIndex = -1;
	applySearchFieldText('', true);
	editorFeatureState.lineJump.active = false;
	editorFeatureState.lineJump.visible = false;
	applyLineJumpFieldText('', true);
	editorFeatureState.createResource.active = false;
	editorFeatureState.createResource.visible = false;
	applyCreateResourceFieldText('', true);
	editorFeatureState.createResource.error = null;
	editorFeatureState.createResource.working = false;
	resetActionPromptState();
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
	editorFeatureState.search.active = false;
	editorFeatureState.search.visible = false;
	editorFeatureState.lineJump.active = false;
	editorFeatureState.lineJump.visible = false;
	editorFeatureState.lineJump.value = '';
	syncRuntimeErrorOverlayFromContext(getActiveCodeTabContext());
	resetActionPromptState();
	cancelSearchJob();
	cancelGlobalSearchJob();
	editorFeatureState.search.globalMatches = [];
	editorFeatureState.search.displayOffset = 0;
	editorFeatureState.search.hoverIndex = -1;
	editorFeatureState.search.scope = 'local';
	if (editorFeatureState.search.query.length === 0) {
		editorFeatureState.search.matches = [];
		editorFeatureState.search.currentIndex = -1;
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
	editorFeatureState.search.active = false;
	editorFeatureState.search.visible = false;
	editorFeatureState.lineJump.active = false;
	editorFeatureState.lineJump.visible = false;
	resetActionPromptState();
	closeCreateResourcePrompt(false);
	hideResourcePanel();
	cancelSearchJob();
	cancelGlobalSearchJob();
	editorFeatureState.search.globalMatches = [];
	editorFeatureState.search.displayOffset = 0;
	editorFeatureState.search.hoverIndex = -1;
	editorFeatureState.search.scope = 'local';
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
