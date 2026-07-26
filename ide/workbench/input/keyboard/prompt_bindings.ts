import type { CartEditor } from '../../../cart_editor';
import { cycleTab } from '../../ui/tabs';
import { isCodeTabActive } from '../../ui/code_tab/contexts';
import { selectAllSingleCursor } from '../../../editor/editing/cursor/state';
import { revealCursor, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { resetBlink } from '../../../editor/render/caret';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import { isInlineWidgetFocused } from '../../../quick_input/inline_widget';
import { editorDocumentState } from '../../../editor/editing/document_state';

function handleCreateResourceBinding(editor: CartEditor): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyN')) {
		return false;
	}
	consumeIdeKey('KeyN');
	editor.commands.execute('createResource');
	return true;
}

function handleGlobalFindBinding(editor: CartEditor): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isShiftDown() || isAltDown() || !isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	editor.commands.execute('findGlobal');
	return true;
}

function handleLocalFindBinding(editor: CartEditor): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isShiftDown() || isAltDown() || !isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	editor.commands.execute('findLocal');
	return true;
}

function handleCycleTabBinding(editor: CartEditor): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('Tab')) {
		return false;
	}
	consumeIdeKey('Tab');
	cycleTab(editor.resourcePanel, isShiftDown() ? -1 : 1);
	return true;
}

function handleDefinitionAndReferenceBinding(editor: CartEditor): boolean {
	if (isInlineWidgetFocused() || !isKeyJustPressed('F12')) {
		return false;
	}
	consumeIdeKey('F12');
	if (isShiftDown()) {
		editor.commands.execute('referenceSearch');
		return true;
	}
	editor.commands.execute('goToDefinition');
	return true;
}

function handleSelectAllBinding(editor: CartEditor): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isInlineWidgetFocused() || !isCodeTabActive() || !isKeyJustPressed('KeyA')) {
		return false;
	}
	if (editor.resourcePanel.isFocused()) {
		return false;
	}
	consumeIdeKey('KeyA');
	const lastRowIndex = editorDocumentState.buffer.getLineCount() - 1;
	const lastColumn = editorDocumentState.buffer.getLineEndOffset(lastRowIndex) - editorDocumentState.buffer.getLineStartOffset(lastRowIndex);
	selectAllSingleCursor(editorDocumentState, lastRowIndex, lastColumn);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	return true;
}

function handleLineJumpBinding(editor: CartEditor): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyL')) {
		return false;
	}
	consumeIdeKey('KeyL');
	editor.commands.execute('lineJump');
	return true;
}

export function handleEditorPromptBindings(editor: CartEditor): boolean {
	return handleCreateResourceBinding(editor)
		|| handleGlobalFindBinding(editor)
		|| handleLocalFindBinding(editor)
		|| handleCycleTabBinding(editor)
		|| handleDefinitionAndReferenceBinding(editor)
		|| handleSelectAllBinding(editor)
		|| handleLineJumpBinding(editor);
}
