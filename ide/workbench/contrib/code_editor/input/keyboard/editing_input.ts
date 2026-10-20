import { activeCodeEditor } from '../../../../../editor/ui/code_editor_state';
import { insertText } from '../../../../../editor/editing/text_editing_and_selection';
import * as TextEditing from '../../../../../editor/editing/text_editing_and_selection';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isShiftDown, isKeyDown } from '../../../../../input/keyboard/key_input';
import type { KeyInputEvent } from '../../../../../../hosts/common/input/text';

export function handleEditorEditingKeys(playerInput: KeyInputEvent): void {
	const ctrlDown = isCtrlDown(playerInput);
	const shiftDown = isShiftDown(playerInput);
	if (isKeyJustPressed('Tab', playerInput)) {
		consumeIdeKey('Tab', playerInput);
		if (shiftDown) {
			TextEditing.unindentSelectionOrLine();
		} else {
			insertText(activeCodeEditor.model.language.indentationUnit);
		}
		return;
	}
	if (isKeyDown('Backspace', playerInput)) {
		consumeIdeKey('Backspace', playerInput);
		if (ctrlDown) {
			TextEditing.deleteWordBackward();
		} else {
			TextEditing.backspace();
		}
		return;
	}
	if (isKeyDown('Delete', playerInput)) {
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
