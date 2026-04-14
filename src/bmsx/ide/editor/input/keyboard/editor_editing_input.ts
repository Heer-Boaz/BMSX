import { insertText } from '../../editing/text_editing_and_selection';
import * as TextEditing from '../../editing/text_editing_and_selection';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from './key_input';

export function handleEditorEditingKeys(): void {
	const ctrlDown = isCtrlDown();
	const shiftDown = isShiftDown();
	if (isKeyJustPressed('Tab')) {
		consumeIdeKey('Tab');
		if (shiftDown) {
			TextEditing.unindentSelectionOrLine();
		} else {
			insertText('\t');
		}
		return;
	}
	if (shouldRepeatKeyFromPlayer('Backspace')) {
		consumeIdeKey('Backspace');
		if (ctrlDown) {
			TextEditing.deleteWordBackward();
		} else if (!TextEditing.deleteSelectionIfPresent()) {
			TextEditing.backspace();
		}
		return;
	}
	if (shouldRepeatKeyFromPlayer('Delete')) {
		consumeIdeKey('Delete');
		if (shiftDown && !ctrlDown) {
			TextEditing.deleteActiveLines();
		} else if (ctrlDown) {
			TextEditing.deleteWordForward();
		} else if (!TextEditing.deleteSelectionIfPresent()) {
			TextEditing.deleteForward();
		}
		return;
	}
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		TextEditing.insertLineBreak();
	}
}
