import { activeCodeEditor } from '../../editor/ui/code_editor_state';
import { jumpToNextMatch, jumpToPreviousMatch } from '../../workbench/contrib/code_editor/find/search';
import { notifyReadOnlyEdit } from '../../editor/ui/view/view';
import { toggleLineComments } from '../../editor/editing/line_comments';
import { applyDocumentFormatting, copySelectionToClipboard, cutLineToClipboard, cutSelectionToClipboard, pasteFromClipboard } from '../../editor/editing/text_editing_and_selection';
import * as TextEditing from '../../editor/editing/text_editing_and_selection';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';
import { editorSearchState } from '../../workbench/contrib/code_editor/find/widget_state';
import type { PlayerInput } from '../../../hosts/common/input/player';
import type { Clipboard } from '../../common/clipboard';

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

function handleCopyBinding(playerInput: PlayerInput, clipboard: Clipboard): boolean {
	if (!isCtrlDown(playerInput) || !isKeyJustPressed('KeyC', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyC', playerInput);
	void copySelectionToClipboard(clipboard);
	return true;
}

function handleCutBinding(playerInput: PlayerInput, clipboard: Clipboard): boolean {
	if (!isCtrlDown(playerInput) || !isKeyJustPressed('KeyX', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyX', playerInput);
	if (activeCodeEditor.model.readOnly) {
		if (TextEditing.hasSelection()) {
			void copySelectionToClipboard(clipboard);
		} else {
			notifyReadOnlyEdit();
		}
		return true;
	}
	if (TextEditing.hasSelection()) {
		void cutSelectionToClipboard(clipboard);
	} else {
		void cutLineToClipboard(clipboard);
	}
	return true;
}

function handlePasteBinding(playerInput: PlayerInput, clipboard: Clipboard): boolean {
	if (!isCtrlDown(playerInput) || isShiftDown(playerInput) || !isKeyJustPressed('KeyV', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyV', playerInput);
	if (activeCodeEditor.model.readOnly) {
		notifyReadOnlyEdit();
		return true;
	}
	pasteFromClipboard(clipboard);
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

export function handleEditorClipboardAndCommandBindings(
	playerInput: PlayerInput,
	clipboard: Clipboard,
): boolean {
	return handleCopyBinding(playerInput, clipboard)
		|| handleCutBinding(playerInput, clipboard)
		|| handlePasteBinding(playerInput, clipboard)
		|| handleToggleCommentBinding(playerInput, 'Slash')
		|| handleToggleCommentBinding(playerInput, 'NumpadDivide')
		|| handleIndentationBinding(playerInput, 'BracketRight', TextEditing.indentSelectionOrLine)
		|| handleIndentationBinding(playerInput, 'BracketLeft', TextEditing.unindentSelectionOrLine);
}
