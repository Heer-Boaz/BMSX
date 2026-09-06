import type { CartEditor } from '../../../cart_editor';
import type { CodeTabContext } from './model';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
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
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import type { CodeEditorInput } from '../tab/model';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';

function setCodeTabDiagnosticsState(context: CodeTabContext): void {
	const model = context.model;
	switch (model.mode) {
		case 'lua': {
			const cached = editorDiagnosticsState.diagnosticsCache.get(context.id);
			const path = model.resource.path;
			if (!cached || cached.version !== model.version || cached.path !== path) {
				markDiagnosticsDirty(context.id);
			}
			return;
		}
		case 'aem':
			editorDiagnosticsState.dirtyDiagnosticContexts.delete(context.id);
			editorDiagnosticsState.diagnosticsCache.set(context.id, {
				contextId: context.id,
				path: model.resource.path,
				diagnostics: [],
				version: model.version,
				source: getTextSnapshot(model.buffer),
			});
			return;
	}
}

export function storeCodeTabContext(context: CodeTabContext): void {
	context.runtimeErrorOverlay = runtimeErrorState.activeOverlay;
	context.executionStopRow = runtimeErrorState.executionStopRow;
}

export function applyActiveCodeTabSelection(selection: EditorTextSelection): void {
	setSingleCursorPosition(activeCodeEditor.view, selection.row, selection.startColumn);
	setSingleCursorSelectionAnchor(activeCodeEditor.view, selection.row, selection.endColumn);
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = false;
	ensureCursorVisible();
	resetBlink();
	activeCodeEditor.emitCursorMoved();
}

export function activateCodeEditorTab(tab: CodeEditorInput, selection?: EditorTextSelection): void {
	const context = tab.context;
	activeCodeEditor.attach(context.model, context.view);
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.setDocumentMode(context.model.mode);
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateAllHighlights();
	setCodeTabDiagnosticsState(context);
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
	const activeDomain = activeCodeEditor.model.resource.domain;
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
