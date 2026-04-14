import { setCursorPosition } from '../../editor/ui/caret';
import { setSingleCursorSelectionAnchor } from '../../editor/editing/cursor_state';
import { focusEditorFromSearch } from '../../editor/contrib/find/editor_search';
import { resourcePanel } from '../contrib/resources/resource_panel_controller';
import { clearReferenceHighlights } from '../../editor/contrib/intellisense/intellisense';
import { focusEditorFromLineJump } from '../../editor/contrib/find/line_jump';
import { resetBlink } from '../../editor/render/render_caret';
import { focusEditorFromResourceSearch } from '../contrib/resources/resource_search';
import { focusEditorFromSymbolSearch } from '../../editor/contrib/symbols/symbol_search_shared';
import { editorDocumentState } from '../../editor/editing/editor_document_state';
import { completionController } from '../../editor/contrib/suggest/completion_controller';

export function focusPrimaryEditorSurface(): void {
	clearReferenceHighlights();
	resourcePanel.setFocused(false);
	focusEditorFromLineJump();
	focusEditorFromSearch();
	focusEditorFromResourceSearch();
	focusEditorFromSymbolSearch();
	completionController.closeSession();
}

export function focusEditorAtPosition(row: number, column: number): void {
	focusPrimaryEditorSurface();
	setSingleCursorSelectionAnchor(editorDocumentState, row, column);
	setCursorPosition(row, column);
	resetBlink();
}
