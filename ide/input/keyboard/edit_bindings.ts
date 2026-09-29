import { activeCodeEditor } from '../../editor/ui/code_editor_state';
import { jumpToNextMatch, jumpToPreviousMatch } from '../../workbench/contrib/code_editor/find/search';
import { notifyReadOnlyEdit } from '../../editor/ui/view/view';
import { toggleLineComments } from '../../editor/editing/line_comments';
import { applyDocumentFormatting } from '../../editor/editing/text_editing_and_selection';
import * as TextEditing from '../../editor/editing/text_editing_and_selection';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';
import { editorSearchState } from '../../workbench/contrib/code_editor/find/widget_state';
import type { PlayerInput } from '../../../hosts/common/input/player';

export function handleSearchNavigationKeybinding(playerInput: PlayerInput): boolean {
	if (editorSearchState.query.length === 0 || !isKeyJustPressed('F3', playerInput)) {
		return false;
	}
	consumeIdeKey('F3', playerInput);
	if (isShiftDown(playerInput)) {
		jumpToPreviousMatch();
	} else {
		jumpToNextMatch();
	}
	return true;
}

function handleEditableCodeBinding(playerInput: PlayerInput, code: string, matchesBinding: () => boolean, applyEdit: () => void): boolean {
	if (!matchesBinding()) {
		return false;
	}
	consumeIdeKey(code, playerInput);
	if (activeCodeEditor.model.readOnly) {
		notifyReadOnlyEdit();
		return true;
	}
	applyEdit();
	return true;
}

function handleToggleCommentBinding(playerInput: PlayerInput, code: string): boolean {
	return handleEditableCodeBinding(
		playerInput,
		code,
		() => (isCtrlDown(playerInput) || isMetaDown(playerInput)) && !isAltDown(playerInput) && isKeyJustPressed(code, playerInput),
		toggleLineComments,
	);
}

function handleIndentationBinding(playerInput: PlayerInput, code: string, applyEdit: () => void): boolean {
	return handleEditableCodeBinding(
		playerInput,
		code,
		() => isCtrlDown(playerInput) && isKeyJustPressed(code, playerInput),
		applyEdit,
	);
}

export function handleCodeFormattingKeybinding(playerInput: PlayerInput): boolean {
	if (!isAltDown(playerInput) || !isShiftDown(playerInput) || isCtrlDown(playerInput) || isMetaDown(playerInput) || !isKeyJustPressed('KeyF', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyF', playerInput);
	applyDocumentFormatting();
	return true;
}

export function handleEditorEditingBindings(
	playerInput: PlayerInput,
): boolean {
	return handleToggleCommentBinding(playerInput, 'Slash')
		|| handleToggleCommentBinding(playerInput, 'NumpadDivide')
		|| handleIndentationBinding(playerInput, 'BracketRight', TextEditing.indentSelectionOrLine)
		|| handleIndentationBinding(playerInput, 'BracketLeft', TextEditing.unindentSelectionOrLine);
}
