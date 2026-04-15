import { editorDocumentState, restoreDocumentStateFromContext, storeDocumentStateInContext } from '../../editor/editing/editor_document_state';
import { editorDiagnosticsState } from '../../editor/contrib/diagnostics/diagnostics_state';
import { editorSessionState } from '../../editor/ui/editor_session_state';
import { editorViewState } from '../../editor/ui/editor_view_state';
import { syncRuntimeErrorOverlayFromContext } from '../../editor/contrib/runtime_error/runtime_error_navigation';
import { updateDesiredColumn } from '../../editor/ui/caret';
import { refreshActiveDiagnostics } from '../../editor/contrib/diagnostics/diagnostics_controller';
import { markDiagnosticsDirty } from '../../editor/contrib/diagnostics/diagnostics';
import { requestSemanticRefresh } from '../../editor/contrib/intellisense/intellisense';
import { resetBlink } from '../../editor/render/render_caret';
import { getTextSnapshot } from '../../editor/text/source_text';
import { editorPointerState } from '../../editor/input/pointer/editor_pointer_state';
import { runtimeErrorState } from '../../editor/contrib/runtime_error/runtime_error_state';
import {
	getActiveCodeTabContext,
	setTabDirty,
	setTabRuntimeSyncState,
} from './code_tab_contexts';

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

export function activateCodeEditorTab(tabId: string): void {
	editorSessionState.activeCodeTabContextId = tabId;
	const context = getActiveCodeTabContext();
	editorSessionState.activeContextReadOnly = context.readOnly === true;
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
	refreshActiveDiagnostics();
}
