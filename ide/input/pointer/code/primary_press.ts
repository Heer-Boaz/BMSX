import { setCursorPosition } from '../../../editor/ui/view/caret/caret';
import { setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import { openDefinitionSearch } from '../../../workbench/contrib/code_editor/definitions/quick_access';
import type { PointerSnapshot } from '../../../common/models';
import * as TextEditing from '../../../editor/editing/text_editing_and_selection';
import * as constants from '../../../common/constants';
import { clearEditorPointerSelectionState } from '../state';
import type { CodeEditorPane } from '../../../workbench/contrib/code_editor/editor_pane';
import type { CodeEditorControl } from '../../../editor/ui/code_editor_control';

export function handleCodeAreaPrimaryPressPointer(
	pane: CodeEditorPane,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	bounds: CodeAreaBounds,
	now: number,
): boolean {
	const code = pane.code;
	if (!justPressed || !insideCodeArea) {
		return false;
	}
	const target = resolvePointerTextPosition(code, snapshot.viewportX, snapshot.viewportY, bounds);
	const targetRow = target.row;
	const targetColumn = target.column;
	const injected = target.injected;
	code.focusTarget.focus();
	if (gotoModifierActive && !injected && openDefinitionSearch(
		pane,
		targetRow,
		targetColumn,
	)) {
		clearEditorPointerSelectionState(code);
		return true;
	}
	if (registerCodePointerClick(code, targetRow, targetColumn, now)) {
		TextEditing.selectWordAtPosition(code, targetRow, targetColumn);
		code.pointer.pointerSelecting = false;
		return true;
	}
	setSingleCursorSelectionAnchor(code.view, targetRow, targetColumn);
	setCursorPosition(code, targetRow, targetColumn);
	code.beginPointerSelection(snapshot);
	return true;
}

function registerCodePointerClick(code: CodeEditorControl, row: number, column: number, now: number): boolean {
	const interval = now - code.pointer.lastPointerClickTimeMs;
	const sameRow = row === code.pointer.lastPointerClickRow;
	const columnDelta = Math.abs(column - code.pointer.lastPointerClickColumn);
	const doubleClick = code.pointer.lastPointerClickTimeMs > 0
		&& interval <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS
		&& sameRow
		&& columnDelta <= 2;
	code.pointer.lastPointerClickTimeMs = now;
	code.pointer.lastPointerClickRow = row;
	code.pointer.lastPointerClickColumn = column;
	return doubleClick;
}
