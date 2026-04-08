import { setCursorPosition } from './caret';
import { setSingleCursorSelectionAnchor } from './cursor_state';
import { focusEditorFromSearch } from './editor_search';
import { ide_state } from './ide_state';
import { clearReferenceHighlights } from './intellisense';
import { focusEditorFromLineJump } from './line_jump';
import { resetBlink } from './render/render_caret';
import { focusEditorFromResourceSearch } from './contrib/resources/resource_search';
import { focusEditorFromSymbolSearch } from './contrib/symbols/symbol_search_shared';

export function focusPrimaryEditorSurface(): void {
	clearReferenceHighlights();
	ide_state.resourcePanelFocused = false;
	focusEditorFromLineJump();
	focusEditorFromSearch();
	focusEditorFromResourceSearch();
	focusEditorFromSymbolSearch();
	ide_state.completion.closeSession();
}

export function focusEditorAtPosition(row: number, column: number): void {
	focusPrimaryEditorSurface();
	setSingleCursorSelectionAnchor(ide_state, row, column);
	setCursorPosition(row, column);
	resetBlink();
}
