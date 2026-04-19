import { setCursorPosition } from '../../ui/caret';
import { ensureSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { clearGotoHoverHighlight } from '../../contrib/intellisense/engine';
import { handlePointerAutoScroll, resolvePointerTextPosition } from '../../ui/view';
import type { CodeAreaBounds } from '../../ui/view';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from './state';
import { editorDocumentState } from '../../editing/document_state';

export function handleCodeAreaSelectionPointer(snapshot: PointerSnapshot, bounds: CodeAreaBounds): void {
	if (!editorPointerState.pointerSelecting || !snapshot.primaryPressed) {
		return;
	}
	clearGotoHoverHighlight();
	handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY);
	const target = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
	const targetRow = target.row;
	const targetColumn = target.column;
	ensureSingleCursorSelectionAnchor(editorDocumentState, targetRow, targetColumn);
	setCursorPosition(targetRow, targetColumn);
}
