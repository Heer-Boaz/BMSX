import { setCursorPosition } from '../../../editor/ui/view/caret/caret';
import { setSingleCursorSelectionAnchor } from '../../../editor/editing/cursor/state';
import { focusPrimaryEditorSurface } from '../../../workbench/ui/focus';
import { resolvePointerTextPosition } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import { openDefinitionSearch } from '../../../workbench/contrib/code_editor/definitions/search/index';
import { renameController } from '../../../workbench/contrib/code_editor/rename/controller';
import type { PointerSnapshot } from '../../../common/models';
import * as TextEditing from '../../../editor/editing/text_editing_and_selection';
import * as constants from '../../../common/constants';
import { editorPointerState, stopPointerSelectionAndResetClicks } from '../state';
import { activeCodeEditor } from '../../../editor/ui/code_editor_state';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';

export function handleCodeAreaPrimaryPressPointer(
	editor: CartEditor,
	bridge: RuntimeLuaTooling,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	insideCodeArea: boolean,
	gotoModifierActive: boolean,
	bounds: CodeAreaBounds,
	now: number,
): boolean {
	if (!justPressed || !insideCodeArea) {
		return false;
	}
	focusPrimaryEditorSurface(editor);
	const target = resolvePointerTextPosition(snapshot.viewportX, snapshot.viewportY, bounds);
	const targetRow = target.row;
	const targetColumn = target.column;
	if (gotoModifierActive && openDefinitionSearch(
		bridge,
		renameController,
		editor,
		targetRow,
		targetColumn,
	)) {
		stopPointerSelectionAndResetClicks(snapshot);
		return true;
	}
	if (registerCodePointerClick(targetRow, targetColumn, now)) {
		TextEditing.selectWordAtPosition(targetRow, targetColumn);
		editorPointerState.pointerSelecting = false;
		return false;
	}
	setSingleCursorSelectionAnchor(activeCodeEditor.view, targetRow, targetColumn);
	setCursorPosition(targetRow, targetColumn);
	editorPointerState.pointerSelecting = true;
	return false;
}

function registerCodePointerClick(row: number, column: number, now: number): boolean {
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
