import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../keyboard/key_input';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { CodeEditorLineJump } from '../../../workbench/contrib/code_editor/find/line_jump';

export function handleLineJumpInput(input: KeyInputEvent, lineJump: CodeEditorLineJump): void {
	if ((isCtrlDown(input) || isMetaDown(input)) && isKeyJustPressed('KeyL', input)) {
		consumeIdeKey('KeyL', input);
		lineJump.open();
		return;
	}
	if (!isShiftDown(input) && (isKeyJustPressed('NumpadEnter', input) || isKeyJustPressed('Enter', input))) {
		consumeIdeKey('NumpadEnter', input); consumeIdeKey('Enter', input);
		lineJump.apply();
		return;
	}
	if (isKeyJustPressed('Escape', input)) {
		consumeIdeKey('Escape', input);
		lineJump.close(false);
		return;
	}
	applyInlineFieldEditing(input, lineJump.state.field);
}
