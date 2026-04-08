import { ide_state } from '../ide_state';
import { applyInlineFieldEditing } from '../inline_text_field';
import { applyLineJump, closeLineJump, openLineJump } from '../search_bars';
import { textFromLines } from '../text/source_text';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';

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
	const textChanged = applyInlineFieldEditing(ide_state.lineJumpField, {
		allowSpace: false,
		characterFilter: digitFilter,
		maxLength: 6,
	});
	ide_state.lineJumpValue = textFromLines(ide_state.lineJumpField.lines);
	if (textChanged) {
		return;
	}
}
