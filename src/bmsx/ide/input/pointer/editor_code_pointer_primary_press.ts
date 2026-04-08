import { $ } from '../../../core/engine_core';
import { ide_state } from '../../core/ide_state';
import { setCursorPosition } from '../../ui/caret';
import { setSingleCursorSelectionAnchor } from '../../editing/cursor_state';
import { focusPrimaryEditorSurface } from '../../ui/editor_focus';
import { resolvePointerColumn, resolvePointerRow, resetPointerClickTracking } from '../../ui/editor_view';
import { executeEditorGoToDefinitionAt } from '../commands/editor_symbol_navigation_commands';
import type { PointerSnapshot } from '../../core/types';
import * as TextEditing from '../../editing/text_editing_and_selection';
import * as constants from '../../core/constants';

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
		ide_state.pointerSelecting = false;
		ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
		resetPointerClickTracking();
		return true;
	}
	if (registerCodePointerClick(targetRow, targetColumn)) {
		TextEditing.selectWordAtPosition(targetRow, targetColumn);
		ide_state.pointerSelecting = false;
		return false;
	}
	setSingleCursorSelectionAnchor(ide_state, targetRow, targetColumn);
	setCursorPosition(targetRow, targetColumn);
	ide_state.pointerSelecting = true;
	return false;
}

function registerCodePointerClick(row: number, column: number): boolean {
	const now = $.platform.clock.now();
	const interval = now - ide_state.lastPointerClickTimeMs;
	const sameRow = row === ide_state.lastPointerClickRow;
	const columnDelta = Math.abs(column - ide_state.lastPointerClickColumn);
	const doubleClick = ide_state.lastPointerClickTimeMs > 0
		&& interval <= constants.DOUBLE_CLICK_MAX_INTERVAL_MS
		&& sameRow
		&& columnDelta <= 2;
	ide_state.lastPointerClickTimeMs = now;
	ide_state.lastPointerClickRow = row;
	ide_state.lastPointerClickColumn = column;
	return doubleClick;
}
