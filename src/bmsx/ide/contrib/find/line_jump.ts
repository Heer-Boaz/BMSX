import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { showEditorMessage } from '../../core/editor_feedback_state';
import { clearReferenceHighlights } from '../intellisense/intellisense';
import { closeSearch } from './editor_search';
import { resetBlink } from '../../render/render_caret';
import { setFieldText } from '../../ui/inline_text_field';
import { beginNavigationCapture, completeNavigation } from '../../navigation/navigation_history';
import { setCursorPosition } from '../../ui/caret';
import { breakUndoSequence } from '../../editing/undo_controller';
import * as TextEditing from '../../editing/text_editing_and_selection';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';
import { closeResourceSearch } from '../resources/resource_search';
import { editorDocumentState } from '../../editing/editor_document_state';

export function openLineJump(): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeSearch(false, true);
	ide_state.renameController.cancel();
	ide_state.lineJump.visible = true;
	ide_state.lineJump.active = true;
	applyLineJumpFieldText('', true);
	resetBlink();
}

export function closeLineJump(clearValue: boolean): void {
	ide_state.lineJump.active = false;
	ide_state.lineJump.visible = false;
	if (clearValue) {
		applyLineJumpFieldText('', true);
	}
	ide_state.lineJump.field.selectionAnchor = null;
	ide_state.lineJump.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromLineJump(): void {
	if (!ide_state.lineJump.active && !ide_state.lineJump.visible) {
		return;
	}
	ide_state.lineJump.active = false;
	ide_state.lineJump.visible = false;
	ide_state.lineJump.field.selectionAnchor = null;
	ide_state.lineJump.field.pointerSelecting = false;
	resetBlink();
}

export function applyLineJump(): void {
	if (ide_state.lineJump.value.length === 0) {
		showEditorMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const target = Number.parseInt(ide_state.lineJump.value, 10);
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
	ide_state.lineJump.value = value;
	setFieldText(ide_state.lineJump.field, value, moveCursorToEnd);
}
