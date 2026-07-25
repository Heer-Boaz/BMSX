import { runtimeWorkbenchState } from '../../../runtime/workbench_state';
// disable cross_layer_import_pattern -- code-tab activation owns the editor/workbench state handoff during tab switches, saves, and result navigation.
import type { CodeTabContext } from '../../../common/models';
import { editorDocumentState, restoreDocumentStateFromContext, storeDocumentStateInContext } from '../../../editor/editing/document_state';
import { editorDiagnosticsState } from '../../../editor/contrib/diagnostics/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { syncRuntimeErrorOverlayFromContext } from '../../../runtime_error/navigation';
import type { LuaDefinitionLocation } from '../../../../machine/ts/lua/semantic_contracts';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import { extractErrorMessage } from '../../../../machine/ts/lua/value';
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
import {
	resolveRuntimeLuaSource,
	resolveRuntimeLuaSourceForContext,
} from '../../../runtime/sources';
import { SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../../../common/resource';
import { focusChunkSource } from '../../contrib/resources/navigation';
import {
	findCodeTabContext,
	getActiveCodeTabContext,
	setContextRuntimeSyncState,
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

export type LuaCodeTabSourceSnapshot = {
	contextId: string;
	generation: number;
	domain: ResourceDomain;
	path: string;
	source: string;
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

export function capturePendingLuaCodeTabSources(): LuaCodeTabSourceSnapshot[] {
	const snapshots: LuaCodeTabSourceSnapshot[] = [];
	const sources = runtimeWorkbenchState.sources;
	for (const context of codeTabSessionState.contexts.values()) {
		if (context.mode !== 'lua') {
			continue;
		}
		const source = getTextSnapshot(context.buffer);
		const match = resolveRuntimeLuaSource(sources, context.descriptor)!;
		const installedSources = match.domain === SYSTEM_RESOURCE_DOMAIN
			? sources.systemInstalledBlua32Sources
			: sources.cartridgeSlots[match.domain]!.installedBlua32Sources;
		if (context.saveGeneration === context.appliedGeneration
			&& source === installedSources.get(match.record.module_path)) {
			continue;
		}
		snapshots.push({
			contextId: context.id,
			generation: context.saveGeneration,
			domain: context.descriptor.domain,
			path: context.descriptor.path,
			source,
		});
	}
	return snapshots;
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

export function markLuaCodeTabsAppliedToRuntime(snapshots: ReadonlyArray<LuaCodeTabSourceSnapshot>): void {
	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = snapshots[index];
		const context = codeTabSessionState.contexts.get(snapshot.contextId);
		if (!context) {
			continue;
		}
		context.appliedGeneration = snapshot.generation;
		setContextRuntimeSyncState(
			context,
			context.saveGeneration === snapshot.generation ? 'synced' : 'runtime_update_pending',
			null,
		);
	}
	const activeContext = codeTabSessionState.contexts.get(codeTabSessionState.activeContextId);
	if (activeContext?.mode === 'lua') {
		editorDocumentState.appliedGeneration = activeContext.appliedGeneration;
	}
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

export function gotoDefinitionAt(runtime: Runtime, row: number, column: number): boolean {
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
		const activeDomain = getActiveCodeTabContext().descriptor.domain;
		const source = resolveRuntimeLuaSourceForContext(
			runtimeWorkbenchState.sources,
			activeDomain,
			definition.path,
		)!;
		const identity = { domain: source.domain, path: source.record.source_path };
		focusChunkSource(runtime, identity);
		const context = findCodeTabContext(identity);
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
