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
import { editorFeatureState } from '../../common/editor_feature_state';

export function openLineJump(): void {
	clearReferenceHighlights();
	closeSymbolSearch(false);
	closeResourceSearch(false);
	closeSearch(false, true);
	renameController.cancel();
	editorFeatureState.lineJump.visible = true;
	editorFeatureState.lineJump.active = true;
	applyLineJumpFieldText('', true);
	resetBlink();
}

export function closeLineJump(clearValue: boolean): void {
	editorFeatureState.lineJump.active = false;
	editorFeatureState.lineJump.visible = false;
	if (clearValue) {
		applyLineJumpFieldText('', true);
	}
	editorFeatureState.lineJump.field.selectionAnchor = null;
	editorFeatureState.lineJump.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromLineJump(): void {
	if (!editorFeatureState.lineJump.active && !editorFeatureState.lineJump.visible) {
		return;
	}
	editorFeatureState.lineJump.active = false;
	editorFeatureState.lineJump.visible = false;
	editorFeatureState.lineJump.field.selectionAnchor = null;
	editorFeatureState.lineJump.field.pointerSelecting = false;
	resetBlink();
}

export function applyLineJump(): void {
	if (editorFeatureState.lineJump.value.length === 0) {
		showEditorMessage('Enter a line number', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const target = Number.parseInt(editorFeatureState.lineJump.value, 10);
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
	editorFeatureState.lineJump.value = value;
	setFieldText(editorFeatureState.lineJump.field, value, moveCursorToEnd);
}
