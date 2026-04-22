import { $ } from '../../../../../core/engine';
import { setCursorPosition } from '../../../ui/view/caret/caret';
import { setSingleCursorSelectionAnchor } from '../../../editing/cursor/state';
import { focusPrimaryEditorSurface } from '../../../../workbench/ui/focus';
import { resolvePointerTextPosition } from '../../../ui/view/view';
import type { CodeAreaBounds } from '../../../ui/view/view';
import { executeEditorGoToDefinitionAt } from '../../commands/symbol_navigation';
import type { PointerSnapshot } from '../../../../common/models';
import * as TextEditing from '../../../editing/text_editing_and_selection';
import * as constants from '../../../../common/constants';
import { editorPointerState, resetPointerClickTracking } from '../state';
import { editorDocumentState } from '../../../editing/document_state';

export function handleCodeAreaPrimaryPressPointer(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	bounds: CodeAreaBounds
): boolean {
	if (!justPressed || !insideCodeArea) {
		return false;
	}
	focusPrimaryEditorSurface();
	const target = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
	const targetRow = target.row;
	const targetColumn = target.column;
	if (gotoModifierActive && executeEditorGoToDefinitionAt(targetRow, targetColumn)) {
		editorPointerState.pointerSelecting = false;
		editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		return true;
	}
	if (registerCodePointerClick(targetRow, targetColumn)) {
		TextEditing.selectWordAtPosition(targetRow, targetColumn);
		editorPointerState.pointerSelecting = false;
		return false;
	}
	setSingleCursorSelectionAnchor(editorDocumentState, targetRow, targetColumn);
	setCursorPosition(targetRow, targetColumn);
	editorPointerState.pointerSelecting = true;
	return false;
}

function registerCodePointerClick(row: number, column: number): boolean {
	const now = $.platform.clock.now();
	const interval = now - editorPointerState.lastPointerClickTimeMs;
	const sameRow = row === editorPointerState.lastPointerClickRow;
	const columnDelta = Math.abs(column - editorPointerState.lastPointerClickColumn);
	const doubleClick = editorPointerState.lastPointerClickTimeMs > 0
		&& interval <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS
		&& sameRow
		&& columnDelta <= 2;
	editorPointerState.lastPointerClickTimeMs = now;
	editorPointerState.lastPointerClickRow = row;
	editorPointerState.lastPointerClickColumn = column;
	return doubleClick;
}
