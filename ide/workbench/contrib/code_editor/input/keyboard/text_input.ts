import type { Input } from '../../../../../../hosts/common/input/manager';
import { handleEditorBreakpointInput } from '../../../../../input/keyboard/debug_input';
import { handleEditorNavigationKeys } from './navigation_input';
import { handleEditorEditingKeys } from './editing_input';
import type { CartEditor } from '../../../../../cart_editor';
import type { KeyInputEvent } from '../../../../../../hosts/common/input/text';

export class InputController {
	public handleEditorInput(playerInput: KeyInputEvent, editor: CartEditor): void {
		if (handleEditorBreakpointInput(playerInput, editor.breakpoints)) {
			return;
		}
		handleEditorNavigationKeys(playerInput);
		handleEditorEditingKeys(playerInput);
	}

	public applyOverrides(input: Input, active: boolean, captureKeys: readonly string[]): void {
		input.debugHotkeysPaused = active;
		for (let i = 0; i < captureKeys.length; i += 1) {
			input.setKeyboardCapture(captureKeys[i], active);
		}
	}
}

export const editorInput = new InputController();
