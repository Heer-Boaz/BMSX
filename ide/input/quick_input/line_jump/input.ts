import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { applyLineJump, closeLineJump, openLineJump } from '../../../workbench/contrib/code_editor/find/line_jump';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../keyboard/key_input';
import { lineJumpState } from '../../../workbench/contrib/code_editor/find/widget_state';
import type { PlayerInput } from '../../../../machine/ts/input/player';
import type { ClipboardService } from '../../../../machine/ts/platform/platform';

export function handleLineJumpInput(playerInput: PlayerInput, clipboard: ClipboardService): void {
	const shiftDown = isShiftDown(playerInput);
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyL', playerInput)) {
		consumeIdeKey('KeyL', playerInput);
		openLineJump();
		return;
	}
	if (!shiftDown && (isKeyJustPressed('NumpadEnter', playerInput) || isKeyJustPressed('Enter', playerInput))) {
		consumeIdeKey('NumpadEnter', playerInput);
		consumeIdeKey('Enter', playerInput);
		applyLineJump();
		return;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		closeLineJump(false);
		return;
	}
	const digitFilter = (value: string): boolean => value >= '0' && value <= '9';
	const textChanged = applyInlineFieldEditing(playerInput, clipboard, lineJumpState.field, {
		allowSpace: false,
		characterFilter: digitFilter,
		maxLength: 6,
	});
	lineJumpState.value = lineJumpState.field.text;
	if (textChanged) {
		return;
	}
}
