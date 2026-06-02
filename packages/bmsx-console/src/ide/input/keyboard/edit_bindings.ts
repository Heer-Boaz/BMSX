import { jumpToNextMatch, jumpToPreviousMatch } from '../../editor/contrib/find/search';
import { closeActiveTab } from '../../workbench/ui/tabs';
import { isCodeTabActive, isEditableCodeTab, isReadOnlyCodeTab } from '../../workbench/ui/code_tab/contexts';
import { notifyReadOnlyEdit } from '../../editor/ui/view/view';
import { toggleLineComments } from '../../editor/editing/line_comments';
import { redo, undo } from '../../editor/editing/undo_controller';
import { applyDocumentFormatting, copySelectionToClipboard, cutLineToClipboard, cutSelectionToClipboard, pasteFromClipboard } from '../../editor/editing/text_editing_and_selection';
import * as TextEditing from '../../editor/editing/text_editing_and_selection';
import type { Runtime } from '../../../machine/runtime/runtime';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from './key_input';
import { isInlineWidgetFocused } from '../../quick_input/inline_widget';
import { editorSearchState } from '../../editor/contrib/find/widget_state';

export function handleSearchNavigationKeybinding(): boolean {
	if (editorSearchState.query.length === 0 || !isKeyJustPressed('F3')) {
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

function handleCloseTabBinding(runtime: Runtime): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyW')) {
		return false;
	}
	consumeIdeKey('KeyW');
	closeActiveTab(runtime);
	return true;
}

function handleSaveBinding(runtime: Runtime): boolean {
	if (!isCtrlDown() || isShiftDown() || !isKeyJustPressed('KeyS')) {
		return false;
	}
	consumeIdeKey('KeyS');
	if (isReadOnlyCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	runtime.editor.commands.execute('save');
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

function handleEditableCodeBinding(code: string, matchesBinding: () => boolean, applyEdit: () => void): boolean {
	if (!matchesBinding()) {
		return false;
	}
	consumeIdeKey(code);
	if (!isEditableCodeTab()) {
		notifyReadOnlyEdit();
		return true;
	}
	applyEdit();
	return true;
}

function handleToggleCommentBinding(code: string): boolean {
	return handleEditableCodeBinding(
		code,
		() => (isCtrlDown() || isMetaDown()) && !isAltDown() && isKeyJustPressed(code),
		toggleLineComments,
	);
}

function handleIndentationBinding(code: string, applyEdit: () => void): boolean {
	return handleEditableCodeBinding(
		code,
		() => isCtrlDown() && isKeyJustPressed(code),
		applyEdit,
	);
}

export function handleCodeFormattingKeybinding(): boolean {
	if (!isCodeTabActive() || editorSearchState.active || isInlineWidgetFocused()) {
		return false;
	}
	if (!isAltDown() || !isShiftDown() || isCtrlDown() || isMetaDown() || !isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	applyDocumentFormatting();
	return true;
}

export function handleEditorClipboardAndCommandBindings(runtime: Runtime): boolean {
	return handleUndoBinding()
		|| handleRedoBinding()
		|| handleCloseTabBinding(runtime)
		|| handleSaveBinding(runtime)
		|| handleCopyBinding()
		|| handleCutBinding()
		|| handlePasteBinding()
		|| handleToggleCommentBinding('Slash')
		|| handleToggleCommentBinding('NumpadDivide')
		|| handleIndentationBinding('BracketRight', TextEditing.indentSelectionOrLine)
		|| handleIndentationBinding('BracketLeft', TextEditing.unindentSelectionOrLine);
}
