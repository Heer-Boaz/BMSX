import type { CartEditor } from '../../cart_editor';
import { setCursorPosition } from '../../editor/ui/view/caret/caret';
import { setSingleCursorSelectionAnchor } from '../../editor/editing/cursor/state';
import { focusEditorFromSearch } from '../contrib/code_editor/find/search';
import { clearReferenceHighlights } from '../../editor/contrib/intellisense/engine';
import { focusEditorFromLineJump } from '../contrib/code_editor/find/line_jump';
import { resetBlink } from '../../editor/render/caret';
import { focusEditorFromResourceSearch } from '../contrib/resources/search/index';
import { focusEditorFromSymbolSearch } from '../contrib/code_editor/symbols/shared';
import { activeCodeEditor } from '../../editor/ui/code_editor_state';

export function focusPrimaryEditorSurface(editor: CartEditor): void {
	clearReferenceHighlights();
	editor.resourcePanel.setFocused(false);
	focusEditorFromLineJump();
	focusEditorFromSearch();
	focusEditorFromResourceSearch();
	focusEditorFromSymbolSearch();
	editor.completion.closeSession();
}

export function focusEditorAtPosition(editor: CartEditor, row: number, column: number): void {
	focusPrimaryEditorSurface(editor);
	setSingleCursorSelectionAnchor(activeCodeEditor.view, row, column);
	setCursorPosition(row, column);
	resetBlink();
}
