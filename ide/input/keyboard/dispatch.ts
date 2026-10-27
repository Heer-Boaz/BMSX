import type { CartEditor } from '../../cart_editor';
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
	if (playerInput.down && !playerInput.consumed) focused?.activate();
	if (focused === null && (editor.surfaces.topBlockingSurface !== null || inputFocus.target !== null)) {
		editor.keybindings.cancel();
		editor.menubar.cancelAlt();
		// A blocked retained focus is not permission to dispatch root shortcuts.
		playerInput.consumed = true;
		return;
	}
	if (focused?.guestInput !== undefined) {
		editor.keybindings.cancel();
		editor.menubar.cancelAlt();
		focused!.handleKeyboard(playerInput);
		return;
	}
	const commands = inputFocus.commandRunner;
	if (editor.keybindings.inChordMode && editor.keybindings.handle(playerInput, commands, focused)) return;
	// A modifier used by a captured pointer gesture is not an Alt-only menu gesture.
	if (pointerCapture.active) editor.menubar.cancelAlt();
	else if (editor.menubar.handleKeyboard(playerInput, focused)) return;
	if (handleClipboardBindings(playerInput, editor.clipboard, focused)) return;
	if (pointerCapture.active && isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		pointerCapture.cancel();
		return;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		focused?.handleKeyboard(playerInput);
		return;
	}
	if (!editor.keybindings.inChordMode && editor.keybindings.handle(playerInput, commands, focused)) return;
	if (isKeyJustPressed('Tab', playerInput) && !isCtrlDown(playerInput) && !isMetaDown(playerInput) && !isAltDown(playerInput)
		&& inputFocus.moveFocus(isShiftDown(playerInput))) {
		consumeIdeKey('Tab', playerInput);
		return;
	}
	focused?.handleKeyboard(playerInput);
}
