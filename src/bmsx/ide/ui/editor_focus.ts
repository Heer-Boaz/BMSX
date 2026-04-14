import { setCursorPosition } from './caret';
import { setSingleCursorSelectionAnchor } from '../editing/cursor_state';
import { focusEditorFromSearch } from '../contrib/find/editor_search';
import { ide_state } from '../core/ide_state';
import { clearReferenceHighlights } from '../contrib/intellisense/intellisense';
import { focusEditorFromLineJump } from '../contrib/find/line_jump';
import { resetBlink } from '../render/render_caret';
import { focusEditorFromResourceSearch } from '../contrib/resources/resource_search';
import { focusEditorFromSymbolSearch } from '../contrib/symbols/symbol_search_shared';
import { editorDocumentState } from '../editing/editor_document_state';

export function focusPrimaryEditorSurface(): void {
	clearReferenceHighlights();
	ide_state.resourcePanel.setFocused(false);
	focusEditorFromLineJump();
	focusEditorFromSearch();
	focusEditorFromResourceSearch();
	focusEditorFromSymbolSearch();
	ide_state.completion.closeSession();
}

export function focusEditorAtPosition(row: number, column: number): void {
	focusPrimaryEditorSurface();
	setSingleCursorSelectionAnchor(editorDocumentState, row, column);
	setCursorPosition(row, column);
	resetBlink();
}
