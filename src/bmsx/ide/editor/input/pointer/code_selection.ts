import { setCursorPosition } from '../../ui/caret';
import { ensureSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { clearGotoHoverHighlight } from '../../contrib/intellisense/engine';
import { handlePointerAutoScroll, resolvePointerColumn, resolvePointerRow } from '../../ui/view';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from './state';
import { editorDocumentState } from '../../editing/document_state';

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
