import { jumpToNextMatch, jumpToPreviousMatch } from '../../contrib/find/editor_search';
import { isCodeTabActive, isEditableCodeTab, isReadOnlyCodeTab, closeActiveTab } from '../../ui/editor_tabs';
import { notifyReadOnlyEdit } from '../../ui/editor_view';
import { toggleLineComments } from '../../editing/line_comments';
import { redo, undo } from '../../editing/undo_controller';
import { applyDocumentFormatting, copySelectionToClipboard, cutLineToClipboard, cutSelectionToClipboard, pasteFromClipboard } from '../../editing/text_editing_and_selection';
import * as TextEditing from '../../editing/text_editing_and_selection';
import { executeEditorCommand } from '../commands/editor_commands';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from './key_input';
import { isInlineFieldFocused } from '../quick_input/editor_quick_input';
import { runEditorKeyHandlers, type EditorKeyHandler } from './editor_binding_utils';
import { editorFeatureState } from '../../core/editor_feature_state';

export function handleSearchNavigationKeybinding(): boolean {
	if (editorFeatureState.search.query.length === 0 || !isKeyJustPressed('F3')) {
		return false;
	}
	consumeIdeKey('F3');
	if (isShiftDown()) {
		jumpToPreviousMatch();
	} else {
		jumpToNextMatch();
	}
	return true;
}

function handleUndoBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !shouldRepeatKeyFromPlayer('KeyZ')) {
		return false;
	}
	consumeIdeKey('KeyZ');
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	if (isShiftDown()) {
		redo();
	} else {
		undo();
	}
	return true;
}

function handleRedoBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !shouldRepeatKeyFromPlayer('KeyY')) {
		return false;
	}
	consumeIdeKey('KeyY');
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	redo();
	return true;
}

function handleCloseTabBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyW')) {
		return false;
	}
	consumeIdeKey('KeyW');
	closeActiveTab();
	return true;
}

function handleSaveBinding(): boolean {
	if (!isCtrlDown() || isShiftDown() || !isKeyJustPressed('KeyS')) {
		return false;
	}
	consumeIdeKey('KeyS');
	if (isReadOnlyCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	executeEditorCommand('save');
	return true;
}

function handleCopyBinding(): boolean {
	if (!isCtrlDown() || !isKeyJustPressed('KeyC')) {
		return false;
	}
	consumeIdeKey('KeyC');
	void copySelectionToClipboard();
	return true;
}

function handleCutBinding(): boolean {
	if (!isCtrlDown() || !isKeyJustPressed('KeyX')) {
		return false;
	}
	consumeIdeKey('KeyX');
	if (isReadOnlyCodeTab()) {
		if (TextEditing.hasSelection()) {
			void copySelectionToClipboard();
		} else {
			notifyReadOnlyEdit();
		}
		return true;
	}
	if (TextEditing.hasSelection()) {
		void cutSelectionToClipboard();
	} else {
		void cutLineToClipboard();
	}
	return true;
}

function handlePasteBinding(): boolean {
	if (!isCtrlDown() || isShiftDown() || !isKeyJustPressed('KeyV')) {
		return false;
	}
	consumeIdeKey('KeyV');
	if (isReadOnlyCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	pasteFromClipboard();
	return true;
}

function handleToggleCommentBindingSlash(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isAltDown() || !isKeyJustPressed('Slash')) {
		return false;
	}
	consumeIdeKey('Slash');
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	toggleLineComments();
	return true;
}

function handleToggleCommentBindingNumpad(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isAltDown() || !isKeyJustPressed('NumpadDivide')) {
		return false;
	}
	consumeIdeKey('NumpadDivide');
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	toggleLineComments();
	return true;
}

function handleIndentBinding(): boolean {
	if (!isCtrlDown() || !isKeyJustPressed('BracketRight')) {
		return false;
	}
	consumeIdeKey('BracketRight');
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	TextEditing.indentSelectionOrLine();
	return true;
}

function handleUnindentBinding(): boolean {
	if (!isCtrlDown() || !isKeyJustPressed('BracketLeft')) {
		return false;
	}
	consumeIdeKey('BracketLeft');
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	TextEditing.unindentSelectionOrLine();
	return true;
}

export function handleCodeFormattingKeybinding(): boolean {
	if (!isCodeTabActive() || editorFeatureState.search.active || isInlineFieldFocused()) {
		return false;
	}
	if (!isAltDown() || !isShiftDown() || isCtrlDown() || isMetaDown() || !isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	applyDocumentFormatting();
	return true;
}

const editorClipboardAndCommandKeyHandlers: readonly EditorKeyHandler[] = [
	handleUndoBinding,
	handleRedoBinding,
	handleCloseTabBinding,
	handleSaveBinding,
	handleCopyBinding,
	handleCutBinding,
	handlePasteBinding,
	handleToggleCommentBindingSlash,
	handleToggleCommentBindingNumpad,
	handleIndentBinding,
	handleUnindentBinding,
];

export function handleEditorClipboardAndCommandBindings(): boolean {
	return runEditorKeyHandlers(editorClipboardAndCommandKeyHandlers);
}
