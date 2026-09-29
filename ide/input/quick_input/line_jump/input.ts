import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { applyLineJump, closeLineJump, openLineJump } from '../../../workbench/contrib/code_editor/find/line_jump';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../keyboard/key_input';
import { lineJumpState } from '../../../workbench/contrib/code_editor/find/widget_state';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { EditorSearchController } from '../../../workbench/contrib/code_editor/find/search';

export function handleLineJumpInput(playerInput: PlayerInput, search: EditorSearchController): void {
	const shiftDown = isShiftDown(playerInput);
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyL', playerInput)) {
		consumeIdeKey('KeyL', playerInput);
		openLineJump(search);
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
	applyInlineFieldEditing(playerInput, lineJumpState.field);
}
