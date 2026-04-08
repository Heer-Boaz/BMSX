import { $ } from '../../../../core/engine_core';
import { insertText } from '../../text_editing_and_selection';
import { handleEditorDebuggerInput } from './editor_debug_input';
import { handleEditorNavigationKeys } from './editor_navigation_input';
import { handleEditorEditingKeys } from './editor_editing_input';
import { handleEditorCharacterInput } from './editor_character_input';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown } from './key_input';

export class InputController {
	public handleEditorInput(): void {
		if (handleEditorDebuggerInput()) {
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
		const input = $.input;
		input.debugHotkeysPaused = active;
		for (let i = 0; i < captureKeys.length; i += 1) {
			input.setKeyboardCapture(captureKeys[i], active);
		}
	}
}
