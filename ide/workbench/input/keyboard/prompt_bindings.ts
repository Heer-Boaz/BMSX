import type { CartEditor } from '../../../cart_editor';
import { isCodeTabActive } from '../../ui/tabs';
import { selectAllSingleCursor } from '../../../editor/editing/cursor/state';
import { revealCursor, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../editor/render/caret';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import { isInlineWidgetFocused } from '../../../quick_input/inline_widget';
import { editorDocumentState } from '../../../editor/editing/document_state';
import type { PlayerInput } from '../../../../hosts/common/input/player';

function handleCreateResourceBinding(playerInput: PlayerInput, editor: CartEditor): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || !isKeyJustPressed('KeyN', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyN', playerInput);
	editor.commands.execute('createResource');
	return true;
}

function handleGlobalFindBinding(playerInput: PlayerInput, editor: CartEditor): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || !isShiftDown(playerInput) || isAltDown(playerInput) || !isKeyJustPressed('KeyF', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyF', playerInput);
	editor.commands.execute('findGlobal');
	return true;
}

function handleLocalFindBinding(playerInput: PlayerInput, editor: CartEditor): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || isShiftDown(playerInput) || isAltDown(playerInput) || !isKeyJustPressed('KeyF', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyF', playerInput);
	editor.commands.execute('findLocal');
	return true;
}

function handleDefinitionAndReferenceBinding(playerInput: PlayerInput, editor: CartEditor): boolean {
	if (isInlineWidgetFocused() || !isKeyJustPressed('F12', playerInput)) {
		return false;
	}
	consumeIdeKey('F12', playerInput);
	if (isShiftDown(playerInput)) {
		editor.commands.execute('referenceSearch');
		return true;
	}
	editor.commands.execute('goToDefinition');
	return true;
}

function handleSelectAllBinding(playerInput: PlayerInput, editor: CartEditor): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || isInlineWidgetFocused() || !isCodeTabActive() || !isKeyJustPressed('KeyA', playerInput)) {
		return false;
	}
	if (editor.resourcePanel.isFocused()) {
		return false;
	}
	consumeIdeKey('KeyA', playerInput);
	const lastRowIndex = editorDocumentState.buffer.getLineCount() - 1;
	const lastColumn = editorDocumentState.buffer.getLineEndOffset(lastRowIndex) - editorDocumentState.buffer.getLineStartOffset(lastRowIndex);
	selectAllSingleCursor(editorDocumentState, lastRowIndex, lastColumn);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	return true;
}

function handleLineJumpBinding(playerInput: PlayerInput, editor: CartEditor): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || !isKeyJustPressed('KeyL', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyL', playerInput);
	editor.commands.execute('lineJump');
	return true;
}

export function handleEditorPromptBindings(playerInput: PlayerInput, editor: CartEditor): boolean {
	return handleCreateResourceBinding(playerInput, editor)
		|| handleGlobalFindBinding(playerInput, editor)
		|| handleLocalFindBinding(playerInput, editor)
		|| handleDefinitionAndReferenceBinding(playerInput, editor)
		|| handleSelectAllBinding(playerInput, editor)
		|| handleLineJumpBinding(playerInput, editor);
}
