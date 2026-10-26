import { setCursorPosition } from '../../../editor/ui/view/caret/caret';
import { ensureSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import type { PointerSnapshot } from '../../../common/models';
import type { CodeEditorControl } from '../../../editor/ui/code_editor_control';
import type { PointerCaptureTarget } from '../capture';

export interface CodeAreaSelectionTarget extends PointerCaptureTarget {
	beginPointerSelection(snapshot: PointerSnapshot): void;
}

export function handleCodeAreaSelectionPointer(code: CodeEditorControl, snapshot: PointerSnapshot, bounds: CodeAreaBounds): void {
	if (!code.pointer.pointerSelecting) {
		return;
	}
	code.gotoHoverHighlight = null;
	const target = resolvePointerTextPosition(code, snapshot.viewportX, snapshot.viewportY, bounds);
	const targetRow = target.row;
	const targetColumn = target.column;
	ensureSingleCursorSelectionAnchor(code.view, targetRow, targetColumn);
	setCursorPosition(code, targetRow, targetColumn);
}
