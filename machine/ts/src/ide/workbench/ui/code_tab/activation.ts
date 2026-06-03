// disable cross_layer_import_pattern -- code-tab activation owns the editor/workbench state handoff during tab switches, saves, and result navigation.
import type { CodeTabContext } from '../../../common/models';
import { editorDocumentState, restoreDocumentStateFromContext, storeDocumentStateInContext } from '../../../editor/editing/document_state';
import { editorDiagnosticsState } from '../../../editor/contrib/diagnostics/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { syncRuntimeErrorOverlayFromContext } from '../../../runtime_error/navigation';
import type { LuaDefinitionLocation } from '../../../../lua/semantic_contracts';
import type { Runtime } from '../../../../machine/runtime/runtime';
import { extractErrorMessage } from '../../../../lua/value';
import { ensureCursorVisible, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import { refreshActiveDiagnostics } from '../../../editor/contrib/diagnostics/controller';
import { markDiagnosticsDirty } from '../../../editor/contrib/diagnostics/analysis';
import { applyDefinitionSelection, clearGotoHoverHighlight, clearHoverTooltip, clearReferenceHighlights, requestSemanticRefresh, resolveDefinitionAt } from '../../../editor/contrib/intellisense/engine';
import { resetBlink } from '../../../editor/render/caret';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { editorPointerState } from '../../../input/pointer/state';
import { runtimeErrorState } from '../../../editor/contrib/runtime_error/state';
import { breakUndoSequence } from '../../../editor/editing/undo_controller';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { beginNavigationCapture, completeNavigation } from '../../../navigation/navigation_history';
import { showEditorMessage } from '../../../common/feedback_state';
import * as constants from '../../../common/constants';
import { focusChunkSource } from '../../contrib/resources/navigation';
import {
	findCodeTabContext,
	getActiveCodeTabContext,
	setTabDirty,
	setTabRuntimeSyncState,
	updateActiveContextDirtyFlag,
} from './contexts';
import { codeTabSessionState } from './session_state';
import { activateCodeTab, getActiveTabId, setActiveTab } from '../tabs';

export type CodeTabSelection = {
	row: number;
	startColumn: number;
	endColumn: number;
};

function setCodeTabDiagnosticsState(): void {
	const context = getActiveCodeTabContext();
	if (context.mode === 'lua') {
		const cached = editorDiagnosticsState.diagnosticsCache.get(context.id);
		const cachedVersion = cached?.version ?? -1;
		const cachedChunk = cached?.path;
		const path = context.descriptor.path;
		if (!cached || cachedVersion !== editorDocumentState.textVersion || cachedChunk !== path) {
			markDiagnosticsDirty(context.id);
		}
		return;
	}
	editorDiagnosticsState.dirtyDiagnosticContexts.delete(context.id);
	editorDiagnosticsState.diagnosticsCache.set(context.id, {
		contextId: context.id,
		path: context.descriptor.path,
		diagnostics: [],
		version: editorDocumentState.textVersion,
		source: getTextSnapshot(editorDocumentState.buffer),
	});
}

export function storeActiveCodeTabContext(): void {
	const context = getActiveCodeTabContext();
	storeDocumentStateInContext(context);
	context.scrollRow = editorViewState.scrollRow;
	context.scrollColumn = editorViewState.scrollColumn;
	context.runtimeErrorOverlay = runtimeErrorState.activeOverlay;
	context.executionStopRow = runtimeErrorState.executionStopRow;
	setTabDirty(context.id, context.dirty);
	setTabRuntimeSyncState(context.id, context.runtimeSyncState, context.runtimeSyncMessage);
}

export function captureActiveCodeTabSource(): string {
	const context = getActiveCodeTabContext();
	if (getActiveTabId() === context.id) {
		return getTextSnapshot(editorDocumentState.buffer);
	}
	return getTextSnapshot(context.buffer);
}

export function commitActiveCodeTabSave(context: CodeTabContext, source: string): void {
	editorDocumentState.dirty = false;
	editorDocumentState.savePointDepth = editorDocumentState.undoStack.length;
	context.savePointDepth = editorDocumentState.savePointDepth;
	breakUndoSequence();
	editorDocumentState.saveGeneration = editorDocumentState.saveGeneration + 1;
	context.lastSavedSource = source;
	context.saveGeneration = editorDocumentState.saveGeneration;
	editorDocumentState.lastSavedSource = source;
	updateActiveContextDirtyFlag();
}

export function setActiveCodeTabAppliedGeneration(context: CodeTabContext, appliedGeneration: number): void {
	editorDocumentState.appliedGeneration = appliedGeneration;
	context.appliedGeneration = appliedGeneration;
}

export function applyActiveCodeTabSelection(selection: CodeTabSelection): void {
	setSingleCursorPosition(editorDocumentState, selection.row, selection.startColumn);
	setSingleCursorSelectionAnchor(editorDocumentState, selection.row, selection.endColumn);
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	ensureCursorVisible();
	resetBlink();
}

export function activateCodeEditorTab(tabId: string, selection?: CodeTabSelection): void {
	codeTabSessionState.activeContextId = tabId;
	const context = getActiveCodeTabContext();
	codeTabSessionState.activeContextReadOnly = !!context.readOnly;
	restoreDocumentStateFromContext(context);
	editorViewState.scrollRow = context.scrollRow;
	editorViewState.scrollColumn = context.scrollColumn;
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.setCodeTabMode(context.mode);
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateAllHighlights();
	setCodeTabDiagnosticsState();
	context.dirty = editorDocumentState.dirty;
	setTabDirty(context.id, context.dirty);
	syncRuntimeErrorOverlayFromContext(context);
	requestSemanticRefresh(context);
	updateDesiredColumn();
	resetBlink();
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	if (selection) {
		applyActiveCodeTabSelection(selection);
	}
	refreshActiveDiagnostics();
}

export function tryGotoDefinitionAt(runtime: Runtime, row: number, column: number): boolean {
	const definition = resolveDefinitionAt(runtime, getActiveCodeTabContext(), row, column);
	if (!definition) {
		return false;
	}
	navigateToLuaDefinition(runtime, definition);
	return true;
}

export function navigateToLuaDefinition(runtime: Runtime, definition: LuaDefinitionLocation): void {
	const navigationCheckpoint = beginNavigationCapture();
	clearReferenceHighlights();
	let targetContextId: string = null;
	try {
		focusChunkSource(runtime, definition.path);
		const context = findCodeTabContext(definition.path);
		if (context) {
			targetContextId = context.id;
		}
	} catch (error) {
		const message = extractErrorMessage(error);
		showEditorMessage(`Failed to open definition: ${message}`, constants.COLOR_STATUS_ERROR, 3.2);
		return;
	}
	if (targetContextId) {
		setActiveTab(targetContextId);
	} else {
		activateCodeTab();
	}
	applyDefinitionSelection(definition.range);
	editorCaretState.cursorRevealSuspended = false;
	clearHoverTooltip();
	clearGotoHoverHighlight();
	completeNavigation(navigationCheckpoint);
}
