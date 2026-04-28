import { consoleCore } from '../../../../core/console';
import { setCursorPosition } from '../../../editor/ui/view/caret/caret';
import { setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { focusPrimaryEditorSurface } from '../../../workbench/ui/focus';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import { tryGotoDefinitionAt } from '../../../editor/contrib/intellisense/engine';
import type { PointerSnapshot } from '../../../common/models';
import * as TextEditing from '../../../editor/editing/text_editing_and_selection';
import * as constants from '../../../common/constants';
import { editorPointerState, stopPointerSelectionAndResetClicks } from '../state';
import { editorDocumentState } from '../../../editor/editing/document_state';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function handleCodeAreaPrimaryPressPointer(
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	bounds: CodeAreaBounds
): boolean {
	if (!justPressed || !insideCodeArea) {
		return false;
	}
	focusPrimaryEditorSurface(runtime);
	const target = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
	const targetRow = target.row;
	const targetColumn = target.column;
	if (gotoModifierActive && tryGotoDefinitionAt(runtime, targetRow, targetColumn)) {
		stopPointerSelectionAndResetClicks(snapshot);
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
	const now = consoleCore.platform.clock.now();
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
