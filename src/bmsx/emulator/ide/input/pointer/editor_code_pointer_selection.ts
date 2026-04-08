import { ide_state } from '../../ide_state';
import { setCursorPosition } from '../../caret';
import { ensureSingleCursorSelectionAnchor } from '../../cursor_state';
import { clearGotoHoverHighlight } from '../../intellisense';
import { handlePointerAutoScroll, resolvePointerColumn, resolvePointerRow } from '../../editor_view';
import type { PointerSnapshot } from '../../types';

export function handleCodeAreaSelectionPointer(snapshot: PointerSnapshot): void {
	if (!ide_state.pointerSelecting || !snapshot.primaryPressed) {
		return;
	}
	clearGotoHoverHighlight();
	handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
	const targetRow = resolvePointerRow(snapshot.viewportY);
	const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
	ensureSingleCursorSelectionAnchor(ide_state, targetRow, targetColumn);
	setCursorPosition(targetRow, targetColumn);
}
