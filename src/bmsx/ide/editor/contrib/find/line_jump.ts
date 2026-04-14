import * as constants from '../../../common/constants';
import { renameController } from '../rename/rename_controller';
import { showEditorMessage } from '../../../workbench/common/feedback_state';
import { clearReferenceHighlights } from '../intellisense/intellisense';
import { closeSearch } from './editor_search';
import { resetBlink } from '../../render/render_caret';
import { setFieldText } from '../../ui/inline_text_field';
import { beginNavigationCapture, completeNavigation } from '../../navigation/navigation_history';
import { setCursorPosition } from '../../ui/caret';
import { breakUndoSequence } from '../../editing/undo_controller';
import * as TextEditing from '../../editing/text_editing_and_selection';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';
import { closeResourceSearch } from '../../../workbench/contrib/resources/resource_search';
import { editorDocumentState } from '../../editing/editor_document_state';
import { lineJumpState } from './find_widget_state';

export function openLineJump(): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeSearch(false, true);
	renameController.cancel();
	lineJumpState.visible = true;
	lineJumpState.active = true;
	applyLineJumpFieldText('', true);
	resetBlink();
}

export function closeLineJump(clearValue: boolean): void {
	lineJumpState.active = false;
	lineJumpState.visible = false;
	if (clearValue) {
		applyLineJumpFieldText('', true);
	}
	lineJumpState.field.selectionAnchor = null;
	lineJumpState.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromLineJump(): void {
	if (!lineJumpState.active && !lineJumpState.visible) {
		return;
	}
	lineJumpState.active = false;
	lineJumpState.visible = false;
	lineJumpState.field.selectionAnchor = null;
	lineJumpState.field.pointerSelecting = false;
	resetBlink();
}

export function applyLineJump(): void {
	if (lineJumpState.value.length === 0) {
		showEditorMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const target = Number.parseInt(lineJumpState.value, 10);
	const lineCount = editorDocumentState.buffer.getLineCount();
	if (!Number.isFinite(target) || target < 1 || target > lineCount) {
		showEditorMessage(`Line must be between 1 and ${lineCount}`, constants.COLOR_STATUS_WARNING, 1.8);
		return;
	}
	const navigationCheckpoint = beginNavigationCapture();
	setCursorPosition(target - 1, 0);
	TextEditing.clearSelection();
	breakUndoSequence();
	closeLineJump(true);
	showEditorMessage(`Jumped to line ${target}`, constants.COLOR_STATUS_SUCCESS, 1.5);
	completeNavigation(navigationCheckpoint);
}

export function applyLineJumpFieldText(value: string, moveCursorToEnd: boolean): void {
	lineJumpState.value = value;
	setFieldText(lineJumpState.field, value, moveCursorToEnd);
}
