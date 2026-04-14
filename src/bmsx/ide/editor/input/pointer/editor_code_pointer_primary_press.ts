import { $ } from '../../../../core/engine_core';
import { setCursorPosition } from '../../ui/caret';
import { setSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { focusPrimaryEditorSurface } from '../../../workbench/ui/focus';
import { resolvePointerColumn, resolvePointerRow } from '../../ui/editor_view';
import { executeEditorGoToDefinitionAt } from '../commands/editor_symbol_navigation_commands';
import type { PointerSnapshot } from '../../../common/types';
import * as TextEditing from '../../editing/text_editing_and_selection';
import * as constants from '../../../common/constants';
import { editorPointerState, resetPointerClickTracking } from './editor_pointer_state';
import { editorDocumentState } from '../../editing/editor_document_state';

export function handleCodeAreaPrimaryPressPointer(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	insideCodeArea: boolean,
	gotoModifierActive: boolean
): boolean {
	if (!justPressed || !insideCodeArea) {
		return false;
	}
	focusPrimaryEditorSurface();
	const targetRow = resolvePointerRow(snapshot.viewportY);
	const targetColumn = resolvePointerColumn(targetRow, snapshot.viewportX);
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
