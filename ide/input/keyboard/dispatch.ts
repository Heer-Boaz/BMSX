import type { CartEditor } from '../../cart_editor';
import { handleEditorCommandBindings, handleEscapeBinding } from './global_bindings';
import type { KeyInputEvent } from '../../../hosts/common/input/text';
import { handleWorkbenchTabInput } from '../../workbench/input/keyboard/tab_input';
import { inputFocus } from '../focus';
import type { WorkbenchSurface } from '../../workbench/services/windows/model';
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
	const surface = focused === null ? undefined : editor.surfaces.findByScope(focused.scope.surfaceScope);
	if (surface?.role === 'modal' || surface?.role === 'transient') {
		if (surface.role === 'modal' && surface.presentationParent != null
			&& handleWorkbenchTabInput(playerInput, editor.editorPanes)) return;
		focused!.handleKeyboard(playerInput);
		return;
	}
	if (pointerCapture.active && isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		pointerCapture.cancel();
		return;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		for (let current: WorkbenchSurface | null | undefined = surface; current != null; current = current.presentationParent) {
			if (current.role === 'window' || current.role === 'subwindow') {
				focused!.handleKeyboard(playerInput);
				return;
			}
		}
	}
	if (handleEscapeBinding(playerInput, editor.search)) {
		return;
	}
	if (handleEditorCommandBindings(playerInput, editor.commands)) {
		return;
	}
	if (handleWorkbenchTabInput(playerInput, editor.editorPanes)) {
		return;
	}
	if (isKeyJustPressed('Tab', playerInput) && !isCtrlDown(playerInput) && !isMetaDown(playerInput) && !isAltDown(playerInput)
		&& inputFocus.moveFocus(isShiftDown(playerInput))) {
		consumeIdeKey('Tab', playerInput);
		return;
	}
	focused?.handleKeyboard(playerInput);
}
