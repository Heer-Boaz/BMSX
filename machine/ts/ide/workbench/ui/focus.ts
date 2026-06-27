import { machineManager } from '../../../core/machine_manager';
import { setCursorPosition } from '../../editor/ui/view/caret/caret';
import { setSingleCursorSelectionAnchor } from '../../editor/editing/cursor/state';
import { focusEditorFromSearch } from '../../editor/contrib/find/search';
import { clearReferenceHighlights } from '../../editor/contrib/intellisense/engine';
import { focusEditorFromLineJump } from '../../editor/contrib/find/line_jump';
import { resetBlink } from '../../editor/render/caret';
import { focusEditorFromResourceSearch } from '../contrib/resources/search';
import { focusEditorFromSymbolSearch } from '../../editor/contrib/symbols/shared';
import { editorDocumentState } from '../../editor/editing/document_state';

export function focusPrimaryEditorSurface(): void {
	clearReferenceHighlights();
	machineManager.ideState.editor.resourcePanel.setFocused(false);
	focusEditorFromLineJump();
	focusEditorFromSearch();
	focusEditorFromResourceSearch();
	focusEditorFromSymbolSearch();
	machineManager.ideState.editor.completion.closeSession();
}

export function focusEditorAtPosition(row: number, column: number): void {
	focusPrimaryEditorSurface();
	setSingleCursorSelectionAnchor(editorDocumentState, row, column);
	setCursorPosition(row, column);
	resetBlink();
}
