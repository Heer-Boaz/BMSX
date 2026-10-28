import type { EditorCommandRunner } from '../../../common/commands';
import type { CodeEditorControl } from '../../../editor/ui/code_editor_control';
import { selectAllSingleCursor } from '../../../editor/editing/cursor/state';
import { revealCursor, updateDesiredColumn } from '../../../editor/ui/view/caret/caret';
import { resetBlinkState } from '../../../editor/ui/view/caret/blink';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';

function handleLocalFindBinding(playerInput: KeyInputEvent, commands: EditorCommandRunner): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || isShiftDown(playerInput) || isAltDown(playerInput) || !isKeyJustPressed('KeyF', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyF', playerInput);
	commands.execute('findLocal');
	return true;
}

function handleDefinitionAndReferenceBinding(playerInput: KeyInputEvent, commands: EditorCommandRunner): boolean {
	if (!isKeyJustPressed('F12', playerInput)) {
		return false;
	}
	consumeIdeKey('F12', playerInput);
	if (isShiftDown(playerInput)) {
		commands.execute('referenceSearch');
		return true;
	}
	commands.execute('goToDefinition');
	return true;
}

function handleSelectAllBinding(code: CodeEditorControl, playerInput: KeyInputEvent): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || !isKeyJustPressed('KeyA', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyA', playerInput);
	const lastRowIndex = code.model.buffer.getLineCount() - 1;
	const lastColumn = code.model.buffer.getLineEndOffset(lastRowIndex) - code.model.buffer.getLineStartOffset(lastRowIndex);
	selectAllSingleCursor(code.view, lastRowIndex, lastColumn);
	updateDesiredColumn(code);
	resetBlinkState(code.caret);
	revealCursor(code);
	return true;
}

function handleLineJumpBinding(playerInput: KeyInputEvent, commands: EditorCommandRunner): boolean {
	if (!(isCtrlDown(playerInput) || isMetaDown(playerInput)) || !isKeyJustPressed('KeyL', playerInput)) {
		return false;
	}
	consumeIdeKey('KeyL', playerInput);
	commands.execute('lineJump');
	return true;
}

export function handleEditorPromptBindings(code: CodeEditorControl, playerInput: KeyInputEvent, commands: EditorCommandRunner): boolean {
	return handleLocalFindBinding(playerInput, commands)
		|| handleDefinitionAndReferenceBinding(playerInput, commands)
		|| handleSelectAllBinding(code, playerInput)
		|| handleLineJumpBinding(playerInput, commands);
}
