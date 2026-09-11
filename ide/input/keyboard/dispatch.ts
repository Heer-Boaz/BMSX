import type { RuntimeSourceState } from '../../runtime/sources';
import type { CartEditor } from '../../cart_editor';
import { handleEditorCommandBindings, handleEscapeBinding } from './global_bindings';
import type { PlayerInput } from '../../../hosts/common/input/player';
import { handleWorkbenchTabInput } from '../../workbench/input/keyboard/tab_input';
import { inputFocus } from '../focus';
import { pointerCapture } from '../pointer/capture';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from './key_input';

export function handleEditorInput(
	playerInput: PlayerInput,
	editor: CartEditor,
	sources: RuntimeSourceState,
): void {
	if (editor.contextMenu.visible && editor.contextMenu.handleKeyboard(playerInput)) {
		return;
	}
	if (pointerCapture.active && isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		pointerCapture.cancel();
		return;
	}
	if (!editor.quickInput.visible && !editor.contextMenu.visible && handleEscapeBinding(playerInput)) {
		return;
	}
	if (handleEditorCommandBindings(playerInput, editor.commands)) {
		return;
	}
	if (handleWorkbenchTabInput(playerInput, editor.editorPanes, sources)) {
		return;
	}
	if (isKeyJustPressed('Tab', playerInput) && !isCtrlDown(playerInput) && !isMetaDown(playerInput) && !isAltDown(playerInput)
		&& inputFocus.moveFocus(isShiftDown(playerInput))) {
		consumeIdeKey('Tab', playerInput);
		return;
	}
	if (!editor.contextMenu.visible) inputFocus.handleKeyboard(playerInput);
}
