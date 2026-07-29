import type { Input } from '../../../../../../machine/ts/input/manager';
import { insertText } from '../../../../../editor/editing/text_editing_and_selection';
import { handleEditorBreakpointInput } from '../../../../../input/keyboard/debug_input';
import { handleEditorNavigationKeys } from './navigation_input';
import { handleEditorEditingKeys } from './editing_input';
import { handleEditorCharacterInput } from './character_input';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown } from '../../../../../input/keyboard/key_input';
import type { CartEditor } from '../../../../../cart_editor';
import type { PlayerInput } from '../../../../../../machine/ts/input/player';

export class InputController {
	public handleEditorInput(playerInput: PlayerInput, editor: CartEditor): void {
		if (handleEditorBreakpointInput(playerInput, editor.breakpoints)) {
			return;
		}
		handleEditorNavigationKeys(playerInput, editor.navigation);
		handleEditorEditingKeys(playerInput);
		const ctrlDown = isCtrlDown(playerInput);
		const metaDown = isMetaDown(playerInput);
		const altDown = isAltDown(playerInput);
		if (ctrlDown || metaDown || altDown) {
			return;
		}
		handleEditorCharacterInput(playerInput);
		if (isKeyJustPressed('Space', playerInput)) {
			insertText(' ');
			consumeIdeKey('Space', playerInput);
		}
	}

	public applyOverrides(input: Input, active: boolean, captureKeys: readonly string[]): void {
		input.debugHotkeysPaused = active;
		for (let i = 0; i < captureKeys.length; i += 1) {
			input.setKeyboardCapture(captureKeys[i], active);
		}
	}
}

export const editorInput = new InputController();
