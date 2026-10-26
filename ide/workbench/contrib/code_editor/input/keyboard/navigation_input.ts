import type { CodeEditorControl } from '../../../../../editor/ui/code_editor_control';
import * as TextEditing from '../../../../../editor/editing/text_editing_and_selection';
import { moveCursorDown, moveCursorEnd, moveCursorHome, moveCursorLeft, moveCursorRight, moveCursorUp, pageDown, pageUp } from '../../../../../editor/ui/view/caret/caret';
import { consumeIdeKey, isAltDown, isShiftDown, isKeyDown } from '../../../../../input/keyboard/key_input';
import type { KeyInputEvent } from '../../../../../../hosts/common/input/text';

export function handleEditorNavigationKeys(code: CodeEditorControl, playerInput: KeyInputEvent): void {
	const shiftDown = isShiftDown(playerInput);
	const altDown = isAltDown(playerInput);
	if (altDown) {
		handleEditorAltNavigation(code, playerInput, shiftDown);
		return;
	}
	if (isKeyDown('ArrowLeft', playerInput)) {
		consumeIdeKey('ArrowLeft', playerInput);
		moveCursorLeft(code, playerInput);
		return;
	}
	if (isKeyDown('ArrowRight', playerInput)) {
		consumeIdeKey('ArrowRight', playerInput);
		moveCursorRight(code, playerInput);
		return;
	}
	if (isKeyDown('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		moveCursorUp(code, playerInput);
		return;
	}
	if (isKeyDown('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		moveCursorDown(code, playerInput);
		return;
	}
	if (isKeyDown('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		moveCursorHome(code, playerInput);
		return;
	}
	if (isKeyDown('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		moveCursorEnd(code, playerInput);
		return;
	}
	if (isKeyDown('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		pageDown(code, playerInput);
		return;
	}
	if (isKeyDown('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		pageUp(code, playerInput);
	}
}

function handleEditorAltNavigation(code: CodeEditorControl, playerInput: KeyInputEvent, shiftDown: boolean): void {
	let movedAlt = false;
	if (isKeyDown('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		if (shiftDown) {
			TextEditing.copySelectionLines(code, -1);
		} else {
			TextEditing.moveSelectionLines(code, -1);
		}
		movedAlt = true;
	}
	if (isKeyDown('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		if (shiftDown) {
			TextEditing.copySelectionLines(code, 1);
		} else {
			TextEditing.moveSelectionLines(code, 1);
		}
		movedAlt = true;
	}
	if (movedAlt) {
		return;
	}
}
