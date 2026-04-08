import { ide_state } from '../../core/ide_state';
import { setCursorPosition } from '../../ui/caret';
import { ensureSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { clearGotoHoverHighlight } from '../../contrib/intellisense/intellisense';
import { handlePointerAutoScroll, resolvePointerColumn, resolvePointerRow } from '../../ui/editor_view';
import type { PointerSnapshot } from '../../core/types';

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
