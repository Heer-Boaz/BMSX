import { setCursorPosition } from '../../../editor/ui/view/caret/caret';
import { ensureSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { clearGotoHoverHighlight } from '../../../editor/contrib/intellisense/engine';
import { handlePointerAutoScroll, resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from '../state';
import { editorDocumentState } from '../../../editor/editing/document_state';

export function handleCodeAreaSelectionPointer(snapshot: PointerSnapshot, bounds: CodeAreaBounds): void {
	if (!editorPointerState.pointerSelecting || !snapshot.primaryPressed) {
		return;
	}
	clearGotoHoverHighlight();
	handlePointerAutoScroll(snapshot.viewportX, snapshot.viewportY, bounds);
	const target = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
	const targetRow = target.row;
	const targetColumn = target.column;
	ensureSingleCursorSelectionAnchor(editorDocumentState, targetRow, targetColumn);
	setCursorPosition(targetRow, targetColumn);
}
