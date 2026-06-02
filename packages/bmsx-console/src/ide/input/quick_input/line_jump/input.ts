import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { applyLineJump, closeLineJump, openLineJump } from '../../../editor/contrib/find/line_jump';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../keyboard/key_input';
import { lineJumpState } from '../../../editor/contrib/find/widget_state';

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
	lineJumpState.value = lineJumpState.field.text;
	if (textChanged) {
		return;
	}
}
