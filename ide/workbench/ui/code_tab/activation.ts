import type { CodeDocumentProjection } from '../../../editor/ui/code/document_projection';
import type { CodeEditorControl } from '../../../editor/ui/code_editor_control';
import type { ResourceIdentity } from '../../../common/resource';
import type { CodeTabContext } from './model';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import { ensureCursorVisible, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { resetBlinkState } from '../../../editor/ui/view/caret/blink';
import { clearEditorPointerSelectionState } from '../../../input/pointer/state';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import type { CodeEditorInput } from '../tab/model';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { CodeEditorPane } from '../../contrib/code_editor/editor_pane';

export function storeCodeTabContext(code: CodeEditorControl, context: CodeTabContext): void {
	context.runtimeErrorOverlay = code.runtimeError.activeOverlay;
	context.executionStopRow = code.runtimeError.executionStopRow;
}

export function applyActiveCodeTabSelection(code: CodeEditorControl, selection: EditorTextSelection): void {
	code.clearVisualCursor();
	setSingleCursorPosition(code.view, selection.row, selection.startColumn);
	setSingleCursorSelectionAnchor(code.view, selection.row, selection.endColumn);
	clearEditorPointerSelectionState(code);
	code.emitCursorMoved();
	ensureCursorVisible(code);
	resetBlinkState(code.caret);
}

export function activateCodeEditorTab(code: CodeEditorControl, tab: CodeEditorInput, document: CodeDocumentProjection): void {
	const context = tab.context;
	code.attach(context.model, context.view, document);
	code.runtimeError.activeOverlay = context.runtimeErrorOverlay;
	code.runtimeError.executionStopRow = context.executionStopRow;
	document.requestSemanticUpdate();
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	clearEditorPointerSelectionState(code);
}

export function navigateToLuaDefinition(pane: CodeEditorPane, resource: ResourceIdentity, definition: LuaDefinitionLocation): void {
	pane.code.references.clear();
	void pane.navigation.focusChunkSource(pane.group, resource, {
		row: definition.range.startLine - 1,
		startColumn: definition.range.startColumn - 1,
		endColumn: definition.range.startColumn - 1,
	});
	pane.hover.clear();
	pane.code.gotoHoverHighlight = null;
}
