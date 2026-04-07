import { Runtime } from '../runtime';
import * as runtimeIde from '../runtime_ide';
import { $ } from '../../core/engine_core';
import { api } from '../overlay_api';
import * as constants from './constants';
import { activateCodeTab, getActiveCodeTabContext, isResourceViewActive, setActiveTab, storeActiveCodeTabContext } from './editor_tabs';
import { cancelGlobalSearchJob, startSearchJob } from './editor_search';
import { ide_state, captureKeys } from './ide_state';
import { bumpTextVersion } from './text_utils';
import { ensureCursorVisible } from './caret';
import { drawProblemsPanel } from './problems_panel';
import { renderTopBar, renderTopBarDropdown } from './render/render_top_bar';
import { renderTabBar } from './render/render_tab_bar';
import { renderCodeArea } from './render/render_code_area';
import { renderStatusBar } from './render/render_status_bar';
import { drawResourcePanel, drawResourceViewer } from './render/render_resource_panel';
import { drawActionPromptOverlay } from './render/render_prompt';
import {
	renderCreateResourceBar,
	renderLineJumpBar,
	renderRenameBar,
	renderSearchBar,
	renderSymbolSearchBar,
	renderResourceSearchBar,
} from './render/render_inline_bars';
import { renderRuntimeFaultOverlay } from './render/render_error_overlay';
import { handleEditorInput } from './input/editor_keyboard_dispatch';
import { handleActionPromptInput } from './input/action_prompt';
import { handleTextEditorPointerInput } from './input/editor_pointer_dispatch';
import { handleEditorWheelInput } from './input/editor_wheel_input';
import { updateBlink } from './inline_text_field';
import { stopWorkspaceAutosaveLoop, runWorkspaceAutosaveTick, initializeWorkspaceStorage } from './workspace_storage';
import { clearWorkspaceCachedSources } from '../workspace_cache';
import { clearBackgroundTasks } from './background_tasks';
import { clearGotoHoverHighlight } from './intellisense';
import { updateRuntimeErrorOverlay } from './runtime_error_overlay';
import { hideResourcePanel } from './editor_view';
import {
	applySearchFieldText,
	cancelSearchJob,
} from './editor_search';
import { clearExecutionStopHighlights, syncRuntimeErrorOverlayFromContext } from './runtime_error_navigation';
import { processDiagnosticsQueue } from './diagnostics_controller';
import { updateDesiredColumn } from './caret';
import { resetActionPromptState } from './input/action_prompt';
import { applyLineJumpFieldText } from './search_bars';
import { applyCreateResourceFieldText, closeCreateResourcePrompt } from './create_resource';

export function tickInput(): void {
	handleEditorWheelInput();
	handleTextEditorPointerInput();
	if (ide_state.pendingActionPrompt) {
		handleActionPromptInput();
		return;
	}
	handleEditorInput();
}

export function update(deltaSeconds: number): void {
	updateBlink(deltaSeconds);
	ide_state.updateMessage(deltaSeconds);
	updateRuntimeErrorOverlay(deltaSeconds);
	ide_state.completion.processPending(deltaSeconds);
	const semanticError = ide_state.layout.getLastSemanticError();
	if (semanticError && semanticError !== ide_state.lastReportedSemanticError) {
		ide_state.showMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
		ide_state.lastReportedSemanticError = semanticError;
	} else if (!semanticError && ide_state.lastReportedSemanticError !== null) {
		ide_state.lastReportedSemanticError = null;
	}
	if (ide_state.diagnosticsDirty) {
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
	if (ide_state.pendingActionPrompt) {
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
	if (ide_state.workspaceAutosaveEnabled) {
		stopWorkspaceAutosaveLoop();
		void runWorkspaceAutosaveTick();
	}
	ide_state.workspaceAutosaveEnabled = false;
	clearWorkspaceCachedSources();
	ide_state.workspaceAutosaveSignature = null;
	initializeWorkspaceStorage(null);
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.pointerAuxWasPressed = false;
	clearGotoHoverHighlight();
	ide_state.cursorRevealSuspended = false;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.searchMatches = [];
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	ide_state.searchCurrentIndex = -1;
	applySearchFieldText('', true);
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	applyLineJumpFieldText('', true);
	ide_state.createResourceActive = false;
	ide_state.createResourceVisible = false;
	applyCreateResourceFieldText('', true);
	ide_state.createResourceError = null;
	ide_state.createResourceWorking = false;
	resetActionPromptState();
	hideResourcePanel();
	activateCodeTab();
}

export function activateRuntimeEditor(): void {
	if (!Runtime.instance.hasProgramSymbols) {
		return;
	}
	ide_state.input.applyOverrides(true, captureKeys);
	if (ide_state.activeCodeTabContextId) {
		const existingTab = ide_state.tabs.find(candidate => candidate.id === ide_state.activeCodeTabContextId);
		if (existingTab) {
			setActiveTab(ide_state.activeCodeTabContextId);
		} else {
			activateCodeTab();
		}
	} else {
		activateCodeTab();
	}
	bumpTextVersion();
	ide_state.cursorVisible = true;
	ide_state.blinkTimer = 0;
	ide_state.active = true;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.cursorRevealSuspended = false;
	updateDesiredColumn();
	ide_state.selectionAnchor = null;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	ide_state.lineJumpValue = '';
	syncRuntimeErrorOverlayFromContext(getActiveCodeTabContext());
	resetActionPromptState();
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	if (ide_state.searchQuery.length === 0) {
		ide_state.searchMatches = [];
		ide_state.searchCurrentIndex = -1;
	} else {
		startSearchJob();
	}
	ensureCursorVisible();
	if (ide_state.message.visible && !Number.isFinite(ide_state.message.timer) && ide_state.deferredMessageDuration !== null) {
		ide_state.message.timer = ide_state.deferredMessageDuration;
	}
	ide_state.deferredMessageDuration = null;
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
	if (ide_state.dimCrtInEditor) {
		Runtime.instance.restoreCrtPostprocessingFromEditor();
	}
	ide_state.completion.closeSession();
	ide_state.input.applyOverrides(false, captureKeys);
	ide_state.selectionAnchor = null;
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = false;
	ide_state.pointerAuxWasPressed = false;
	ide_state.tabDragState = null;
	clearGotoHoverHighlight();
	ide_state.scrollbarController.cancel();
	ide_state.cursorRevealSuspended = false;
	ide_state.searchActive = false;
	ide_state.searchVisible = false;
	ide_state.lineJumpActive = false;
	ide_state.lineJumpVisible = false;
	resetActionPromptState();
	closeCreateResourcePrompt(false);
	hideResourcePanel();
	cancelSearchJob();
	cancelGlobalSearchJob();
	ide_state.globalSearchMatches = [];
	ide_state.searchDisplayOffset = 0;
	ide_state.searchHoverIndex = -1;
	ide_state.searchScope = 'local';
	clearBackgroundTasks();
	ide_state.diagnosticsTaskPending = false;
	ide_state.lastReportedSemanticError = null;
}

export function handleRuntimeTaskError(error: unknown, fallbackMessage: string): void {
	const errormsg = error instanceof Error ? error.message : String(error);
	$.paused = true;
	runtimeIde.activateEditor(Runtime.instance);
	const message = `${fallbackMessage}: ${errormsg}`;
	Runtime.instance.terminal.appendStderr(message);
	ide_state.showMessage(message, constants.COLOR_STATUS_ERROR, 2.0);
}
