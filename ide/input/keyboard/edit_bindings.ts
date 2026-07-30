import type { IdeCommandController } from '../../commands/controller';
import { jumpToNextMatch, jumpToPreviousMatch } from '../../workbench/contrib/code_editor/find/search';
import { closeActiveTab } from '../../workbench/ui/tabs';
import { isCodeTabActive, isEditableCodeTab, isReadOnlyCodeTab } from '../../workbench/ui/code_tab/contexts';
import { notifyReadOnlyEdit } from '../../editor/ui/view/view';
import { toggleLineComments } from '../../editor/editing/line_comments';
import { redo, undo } from '../../editor/editing/undo_controller';
import { applyDocumentFormatting, copySelectionToClipboard, cutLineToClipboard, cutSelectionToClipboard, pasteFromClipboard } from '../../editor/editing/text_editing_and_selection';
import * as TextEditing from '../../editor/editing/text_editing_and_selection';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from './key_input';
import { isInlineWidgetFocused } from '../../quick_input/inline_widget';
import { editorSearchState } from '../../workbench/contrib/code_editor/find/widget_state';
import type { RuntimeSourceState } from '../../runtime/sources';
import type { ResourcePanelController } from '../../workbench/contrib/resources/panel/controller';
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

function handleUndoBinding(playerInput: PlayerInput): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || !shouldRepeatKeyFromPlayer('KeyZ', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyZ', playerInput);
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	if (isShiftDown(playerInput)) {
		redo();
	} else {
		undo();
	}
	return true;
}

function handleRedoBinding(playerInput: PlayerInput): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || !shouldRepeatKeyFromPlayer('KeyY', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyY', playerInput);
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	redo();
	return true;
}

function handleCloseTabBinding(
	playerInput: PlayerInput,
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || !isKeyJustPressed('KeyW', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyW', playerInput);
	closeActiveTab(resourcePanel, sources);
	return true;
}

function handleSaveBinding(playerInput: PlayerInput, commands: IdeCommandController): boolean {
	if (!isCtrlDown(playerInput) || isShiftDown(playerInput) || !isKeyJustPressed('KeyS', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyS', playerInput);
	if (isReadOnlyCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	commands.execute('save');
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
	if (isReadOnlyCodeTab()) {
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

function handlePasteBinding(playerInput: PlayerInput): boolean {
	if (!isCtrlDown(playerInput) || isShiftDown(playerInput) || !isKeyJustPressed('KeyV', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyV', playerInput);
	if (isReadOnlyCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	pasteFromClipboard();
	return true;
}

function handleEditableCodeBinding(playerInput: PlayerInput, code: string, matchesBinding: () => boolean, applyEdit: () => void): boolean {
	if (!matchesBinding()) {
		return false;
	}
	consumeIdeKey(code, playerInput);
	if (!isEditableCodeTab()) {
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
	if (!isCodeTabActive() || editorSearchState.active || isInlineWidgetFocused()) {
		return false;
	}
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
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	commands: IdeCommandController,
): boolean {
	return handleUndoBinding(playerInput)
		|| handleRedoBinding(playerInput)
		|| handleCloseTabBinding(playerInput, resourcePanel, sources)
		|| handleSaveBinding(playerInput, commands)
		|| handleCopyBinding(playerInput, clipboard)
		|| handleCutBinding(playerInput, clipboard)
		|| handlePasteBinding(playerInput)
		|| handleToggleCommentBinding(playerInput, 'Slash')
		|| handleToggleCommentBinding(playerInput, 'NumpadDivide')
		|| handleIndentationBinding(playerInput, 'BracketRight', TextEditing.indentSelectionOrLine)
		|| handleIndentationBinding(playerInput, 'BracketLeft', TextEditing.unindentSelectionOrLine);
}
