import { setCursorPosition } from '../../ui/caret';
import { ensureSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { handlePointerAutoScroll, resolvePointerColumn, resolvePointerRow } from '../../ui/editor_view';
import type { PointerSnapshot } from '../../core/types';
import { editorPointerState } from './editor_pointer_state';
import { editorDocumentState } from '../../editing/editor_document_state';

export function handleCodeAreaSelectionPointer(snapshot: PointerSnapshot): void {
	if (!editorPointerState.pointerSelecting || !snapshot.primaryPressed) {
		return;
	}
	clearGotoHoverHighlight();
	handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
	const targetRow = resolvePointerRow(snapshot.viewportY);
	const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
	ensureSingleCursorSelectionAnchor(editorDocumentState, targetRow, targetColumn);
	setCursorPosition(targetRow, targetColumn);
}
