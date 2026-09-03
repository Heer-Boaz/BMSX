import { insertText } from '../../../../../editor/editing/text_editing_and_selection';
import * as TextEditing from '../../../../../editor/editing/text_editing_and_selection';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../../../input/keyboard/key_input';
import type { PlayerInput } from '../../../../../../hosts/common/input/player';

export function handleEditorEditingKeys(playerInput: PlayerInput): void {
	const ctrlDown = isCtrlDown(playerInput);
	const shiftDown = isShiftDown(playerInput);
	if (isKeyJustPressed('Tab', playerInput)) {
		consumeIdeKey('Tab', playerInput);
		if (shiftDown) {
			TextEditing.unindentSelectionOrLine();
		} else {
			insertText('\t');
		}
		return;
	}
	if (shouldRepeatKeyFromPlayer('Backspace', playerInput)) {
		consumeIdeKey('Backspace', playerInput);
		if (ctrlDown) {
			TextEditing.deleteWordBackward();
		} else {
			TextEditing.backspace();
		}
		return;
	}
	if (shouldRepeatKeyFromPlayer('Delete', playerInput)) {
		consumeIdeKey('Delete', playerInput);
		if (shiftDown && !ctrlDown) {
			TextEditing.deleteActiveLines();
		} else if (ctrlDown) {
			TextEditing.deleteWordForward();
		} else {
			TextEditing.deleteForward();
		}
		return;
	}
	if (isKeyJustPressed('Enter', playerInput) || isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		TextEditing.insertLineBreak();
	}
}
