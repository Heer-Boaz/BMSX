import type { RuntimeSourceState } from '../../../runtime/sources';
import type { CartEditor } from '../../../cart_editor';
import type { CodeTabContext } from './model';
import { editorDocumentState, restoreDocumentStateFromContext, storeDocumentStateInContext } from '../../../editor/editing/document_state';
import { editorDiagnosticsState } from '../../../editor/contrib/diagnostics/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { syncRuntimeErrorOverlayFromContext } from '../../../runtime_error/navigation';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import { ensureCursorVisible, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { refreshActiveDiagnostics } from '../../contrib/code_editor/diagnostics/controller';
import { markDiagnosticsDirty } from '../../../editor/contrib/diagnostics/state';
import { clearGotoHoverHighlight, clearReferenceHighlights, requestSemanticRefresh } from '../../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../../editor/contrib/hover/controller';
import { resetBlink } from '../../../editor/render/caret';
import { getTextSnapshot } from '../../../editor/text/source_text';
import { editorPointerState } from '../../../input/pointer/state';
import { runtimeErrorState } from '../../../editor/contrib/runtime_error/state';
import { breakUndoSequence } from '../../../editor/editing/undo_controller';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import {
	resolveRuntimeLuaSource,
} from '../../../runtime/sources';
import { SYSTEM_RESOURCE_DOMAIN, type ResourceDomain } from '../../../common/resource';
import {
	getActiveCodeTabContext,
	setContextRuntimeSyncState,
	setTabDirty,
	setTabRuntimeSyncState,
	updateActiveContextDirtyFlag,
} from './contexts';
import { codeTabSessionState } from './session_state';
import { getActiveTabId } from '../tabs';

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
	switch (context.mode) {
		case 'lua': {
			const cached = editorDiagnosticsState.diagnosticsCache.get(context.id);
			const path = context.resource.path;
			if (!cached || cached.version !== editorDocumentState.textVersion || cached.path !== path) {
				markDiagnosticsDirty(context.id);
			}
			return;
		}
		case 'aem':
			editorDiagnosticsState.dirtyDiagnosticContexts.delete(context.id);
			editorDiagnosticsState.diagnosticsCache.set(context.id, {
				contextId: context.id,
				path: context.resource.path,
				diagnostics: [],
				version: editorDocumentState.textVersion,
				source: getTextSnapshot(editorDocumentState.buffer),
			});
			return;
	}
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

export function capturePendingLuaCodeTabSources(sources: RuntimeSourceState): LuaCodeTabSourceSnapshot[] {
	const snapshots: LuaCodeTabSourceSnapshot[] = [];
	for (const context of codeTabSessionState.contexts.values()) {
		switch (context.mode) {
			case 'lua':
				break;
			case 'aem':
				continue;
		}
		const source = getTextSnapshot(context.buffer);
		const match = resolveRuntimeLuaSource(sources, context.resource)!;
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
			domain: context.resource.domain,
			path: context.resource.path,
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
	const activeContext = getActiveCodeTabContext();
	switch (activeContext.mode) {
		case 'lua':
			editorDocumentState.appliedGeneration = activeContext.appliedGeneration;
			return;
		case 'aem':
			return;
	}
}

export function applyActiveCodeTabSelection(selection: CodeTabSelection): void {
	setSingleCursorPosition(editorDocumentState, selection.row, selection.startColumn);
	setSingleCursorSelectionAnchor(editorDocumentState, selection.row, selection.endColumn);
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	ensureCursorVisible();
	resetBlink();
	editorDocumentState.emitCursorMoved();
}

export function activateCodeEditorTab(tabId: string, selection?: CodeTabSelection): void {
	codeTabSessionState.activeContextId = tabId;
	const context = getActiveCodeTabContext();
	restoreDocumentStateFromContext(context);
	editorViewState.scrollRow = context.scrollRow;
	editorViewState.scrollColumn = context.scrollColumn;
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.setDocumentMode(context.mode);
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateAllHighlights();
	setCodeTabDiagnosticsState();
	context.dirty = editorDocumentState.dirty;
	setTabDirty(context.id, context.dirty);
	syncRuntimeErrorOverlayFromContext(context);
	requestSemanticRefresh();
	updateDesiredColumn();
	resetBlink();
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	if (selection) {
		applyActiveCodeTabSelection(selection);
	}
	refreshActiveDiagnostics();
}

export function navigateToLuaDefinition(
	editor: CartEditor,
	definition: LuaDefinitionLocation,
): void {
	clearReferenceHighlights();
	const activeDomain = getActiveCodeTabContext().resource.domain;
	editor.navigation.focusChunkSourceForContext(
		activeDomain,
		definition.path,
		{
			row: definition.range.startLine - 1,
			startColumn: definition.range.startColumn - 1,
			endColumn: definition.range.startColumn - 1,
		},
	);
	clearHoverTooltip();
	clearGotoHoverHighlight();
}
