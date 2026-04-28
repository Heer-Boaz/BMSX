import { setCursorPosition } from '../../editor/ui/view/caret/caret';
import { setSingleCursorSelectionAnchor } from '../../editor/editing/cursor/state';
import { focusEditorFromSearch } from '../../editor/contrib/find/search';
import { clearReferenceHighlights } from '../../editor/contrib/intellisense/engine';
import { focusEditorFromLineJump } from '../../editor/contrib/find/line_jump';
import { resetBlink } from '../../editor/render/caret';
import { focusEditorFromResourceSearch } from '../contrib/resources/search';
import { focusEditorFromSymbolSearch } from '../../editor/contrib/symbols/shared';
import { editorDocumentState } from '../../editor/editing/document_state';
import type { Runtime } from '../../../machine/runtime/runtime';

export function focusPrimaryEditorSurface(runtime: Runtime): void {
	clearReferenceHighlights();
	runtime.editor.resourcePanel.setFocused(false);
	focusEditorFromLineJump();
	focusEditorFromSearch();
	focusEditorFromResourceSearch();
	focusEditorFromSymbolSearch();
	runtime.editor.completion.closeSession();
}

export function focusEditorAtPosition(runtime: Runtime, row: number, column: number): void {
	focusPrimaryEditorSurface(runtime);
	setSingleCursorSelectionAnchor(editorDocumentState, row, column);
	setCursorPosition(row, column);
	resetBlink();
}
