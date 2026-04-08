import { ide_state } from '../../core/ide_state';
import { cycleTab, isCodeTabActive } from '../../ui/editor_tabs';
import { selectAllSingleCursor } from '../../editing/cursor_state';
import { revealCursor, updateDesiredColumn } from '../../ui/caret';
import { resetBlink } from '../../render/render_caret';
import { executeEditorCommand } from '../commands/editor_commands';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';
import { isInlineFieldFocused } from '../quick_input/editor_quick_input';
import { runEditorKeyHandlers, type EditorKeyHandler } from './editor_binding_utils';

function handleCreateResourceBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyN')) {
		return false;
	}
	consumeIdeKey('KeyN');
	executeEditorCommand('createResource');
	return true;
}

function handleGlobalFindBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isShiftDown() || isAltDown() || !isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	executeEditorCommand('findGlobal');
	return true;
}

function handleLocalFindBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isShiftDown() || isAltDown() || !isKeyJustPressed('KeyF')) {
		return false;
	}
	consumeIdeKey('KeyF');
	executeEditorCommand('findLocal');
	return true;
}

function handleCycleTabBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('Tab')) {
		return false;
	}
	consumeIdeKey('Tab');
	cycleTab(isShiftDown() ? -1 : 1);
	return true;
}

function handleDefinitionAndReferenceBinding(): boolean {
	if (isInlineFieldFocused() || !isKeyJustPressed('F12')) {
		return false;
	}
	consumeIdeKey('F12');
	if (isShiftDown()) {
		executeEditorCommand('referenceSearch');
		return true;
	}
	executeEditorCommand('goToDefinition');
	return true;
}

function handleRenameBinding(): boolean {
	if (isInlineFieldFocused() || !isCodeTabActive() || !isKeyJustPressed('F2')) {
		return false;
	}
	consumeIdeKey('F2');
	executeEditorCommand('rename');
	return true;
}

function handleSelectAllBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || isInlineFieldFocused() || ide_state.resourcePanelFocused || !isCodeTabActive() || !isKeyJustPressed('KeyA')) {
		return false;
	}
	consumeIdeKey('KeyA');
	const lastRowIndex = Math.max(0, ide_state.buffer.getLineCount() - 1);
	const lastColumn = ide_state.buffer.getLineEndOffset(lastRowIndex) - ide_state.buffer.getLineStartOffset(lastRowIndex);
	selectAllSingleCursor(ide_state, lastRowIndex, lastColumn);
	updateDesiredColumn();
	resetBlink();
	revealCursor();
	return true;
}

function handleLineJumpBinding(): boolean {
	if (!(isCtrlDown() || isMetaDown()) || !isKeyJustPressed('KeyL')) {
		return false;
	}
	consumeIdeKey('KeyL');
	executeEditorCommand('lineJump');
	return true;
}

const editorPromptKeyHandlers: readonly EditorKeyHandler[] = [
	handleCreateResourceBinding,
	handleGlobalFindBinding,
	handleLocalFindBinding,
	handleCycleTabBinding,
	handleDefinitionAndReferenceBinding,
	handleRenameBinding,
	handleSelectAllBinding,
	handleLineJumpBinding,
];

export function handleEditorPromptBindings(): boolean {
	return runEditorKeyHandlers(editorPromptKeyHandlers);
}
