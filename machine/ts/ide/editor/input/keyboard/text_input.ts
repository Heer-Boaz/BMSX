import { machineManager } from '../../../../core/machine_manager';
import type { Runtime } from '../../../../machine/runtime/runtime';
import { insertText } from '../../editing/text_editing_and_selection';
import { handleEditorDebuggerInput } from '../../../input/keyboard/debug_input';
import { handleEditorNavigationKeys } from './navigation_input';
import { handleEditorEditingKeys } from './editing_input';
import { handleEditorCharacterInput } from './character_input';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown } from '../../../input/keyboard/key_input';

export class InputController {
	public handleEditorInput(runtime: Runtime): void {
		if (handleEditorDebuggerInput(runtime)) {
			return;
		}
		handleEditorNavigationKeys();
		handleEditorEditingKeys();
		const ctrlDown = isCtrlDown();
		const metaDown = isMetaDown();
		const altDown = isAltDown();
		if (ctrlDown || metaDown || altDown) {
			return;
		}
		handleEditorCharacterInput();
		if (isKeyJustPressed('Space')) {
			insertText(' ');
			consumeIdeKey('Space');
		}
	}

	public applyOverrides(active: boolean, captureKeys: readonly string[]): void {
		const input = machineManager.input;
		input.debugHotkeysPaused = active;
		for (let i = 0; i < captureKeys.length; i += 1) {
			input.setKeyboardCapture(captureKeys[i], active);
		}
	}
}

export const editorInput = new InputController();
