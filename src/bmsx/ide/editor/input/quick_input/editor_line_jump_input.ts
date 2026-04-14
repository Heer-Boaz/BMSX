import { applyInlineFieldEditing } from '../../ui/inline_text_field';
import { applyLineJump, closeLineJump, openLineJump } from '../../contrib/find/line_jump';
import { textFromLines } from '../../text/source_text';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../keyboard/key_input';
import { lineJumpState } from '../../contrib/find/find_widget_state';

export function handleLineJumpInput(): void {
	const shiftDown = isShiftDown();
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyL')) {
		consumeIdeKey('KeyL');
		openLineJump();
		return;
	}
	if (!shiftDown && (isKeyJustPressed('NumpadEnter') || isKeyJustPressed('Enter'))) {
		consumeIdeKey('NumpadEnter');
		consumeIdeKey('Enter');
		applyLineJump();
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeLineJump(false);
		return;
	}
	const digitFilter = (value: string): boolean => value >= '0' && value <= '9';
	const textChanged = applyInlineFieldEditing(lineJumpState.field, {
		allowSpace: false,
		characterFilter: digitFilter,
		maxLength: 6,
	});
	lineJumpState.value = textFromLines(lineJumpState.field.lines);
	if (textChanged) {
		return;
	}
}
