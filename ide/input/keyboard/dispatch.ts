import type { CartEditor } from '../../cart_editor';
import { handleEditorCommandBindings, handleEscapeBinding } from './global_bindings';
import type { KeyInputEvent } from '../../../hosts/common/input/text';
import { inputFocus } from '../focus';
import { handleClipboardBindings } from '../clipboard';
import { pointerCapture } from '../pointer/capture';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';

export function handleEditorInput(
	playerInput: KeyInputEvent,
	editor: CartEditor,
): void {
	const focused = inputFocus.admittedTarget;
	if (focused === null && (editor.surfaces.topBlockingSurface !== null || inputFocus.target !== null)) {
		// A blocked retained focus is not permission to dispatch root shortcuts.
		playerInput.consumed = true;
		return;
	}
	if (focused?.guestInput !== undefined) {
		focused!.handleKeyboard(playerInput);
		return;
	}
	if (handleClipboardBindings(playerInput, editor.clipboard, editor.clipboardTarget)) return;
	const commands = inputFocus.commandRunner;
	if (pointerCapture.active && isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		pointerCapture.cancel();
		return;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		focused?.handleKeyboard(playerInput);
		if (!playerInput.consumed && commands !== undefined) handleEscapeBinding(playerInput, editor.search);
		return;
	}
	if (handleEditorCommandBindings(playerInput, commands, focused)) return;
	if (isKeyJustPressed('Tab', playerInput) && !isCtrlDown(playerInput) && !isMetaDown(playerInput) && !isAltDown(playerInput)
		&& inputFocus.moveFocus(isShiftDown(playerInput))) {
		consumeIdeKey('Tab', playerInput);
		return;
	}
	focused?.handleKeyboard(playerInput);
}
