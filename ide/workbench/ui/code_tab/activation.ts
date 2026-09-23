import type { CodeEditorNavigationSelection } from '../../contrib/code_editor/navigation_selection';
import type { ResourceDomain } from '../../../common/resource';
import type { CartEditor } from '../../../cart_editor';
import type { CodeTabContext } from './model';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import { editorViewState } from '../../../editor/ui/view/state';
import { syncRuntimeErrorOverlayFromContext } from '../../../runtime_error/navigation';
import type { LuaDefinitionLocation } from '../../../../toolchain/ts/lua/semantic_contracts';
import { ensureCursorVisible, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { clearGotoHoverHighlight, clearReferenceHighlights, requestSemanticRefresh } from '../../../editor/contrib/intellisense/engine';
import { clearHoverTooltip } from '../../../editor/contrib/hover/controller';
import { resetBlink } from '../../../editor/render/caret';
import { clearEditorPointerSelectionState } from '../../../input/pointer/state';
import { runtimeErrorState } from '../../../editor/contrib/runtime_error/state';
import { setSingleCursorPosition, setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import type { CodeEditorInput } from '../tab/model';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';

export function storeCodeTabContext(context: CodeTabContext): void {
	context.runtimeErrorOverlay = runtimeErrorState.activeOverlay;
	context.executionStopRow = runtimeErrorState.executionStopRow;
}

export function applyActiveCodeTabSelection(selection: EditorTextSelection): void {
	setSingleCursorPosition(activeCodeEditor.view, selection.row, selection.startColumn);
	setSingleCursorSelectionAnchor(activeCodeEditor.view, selection.row, selection.endColumn);
	clearEditorPointerSelectionState();
	ensureCursorVisible();
	resetBlink();
	activeCodeEditor.emitCursorMoved();
}

export function activateCodeEditorTab(tab: CodeEditorInput, selection?: EditorTextSelection, navigationSelection?: CodeEditorNavigationSelection): void {
	const context = tab.context;
	activeCodeEditor.attach(context.model, context.view);
	editorViewState.maxLineLengthDirty = true;
	editorViewState.layout.setDocumentMode(context.model.mode);
	editorViewState.layout.markVisualLinesDirty();
	editorViewState.layout.invalidateAllHighlights();
	syncRuntimeErrorOverlayFromContext(context);
	requestSemanticRefresh();
	updateDesiredColumn();
	resetBlink();
	clearEditorPointerSelectionState();
	if (selection) {
		applyActiveCodeTabSelection(selection);
	}
	navigationSelection?.restore(tab);
}

export function navigateToLuaDefinition(
	editor: CartEditor,
	domain: ResourceDomain,
	definition: LuaDefinitionLocation,
): void {
	clearReferenceHighlights();
	editor.navigation.focusChunkSourceForContext(
		domain,
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
