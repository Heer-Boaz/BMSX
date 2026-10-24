import { setCursorPosition } from '../../../editor/ui/view/caret/caret';
import { ensureSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { clearGotoHoverHighlight } from '../../../editor/contrib/intellisense/engine';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import type { PointerSnapshot } from '../../../common/models';
import { editorPointerState } from '../state';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import type { PointerCaptureTarget } from '../capture';

export interface CodeAreaSelectionTarget extends PointerCaptureTarget {
	beginPointerSelection(snapshot: PointerSnapshot): void;
}

export function handleCodeAreaSelectionPointer(snapshot: PointerSnapshot, bounds: CodeAreaBounds): void {
	if (!editorPointerState.pointerSelecting) {
		return;
	}
	clearGotoHoverHighlight();
	const target = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
	const targetRow = target.row;
	const targetColumn = target.column;
	ensureSingleCursorSelectionAnchor(activeCodeEditor.view, targetRow, targetColumn);
	setCursorPosition(targetRow, targetColumn);
}
