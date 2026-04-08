import * as constants from '../constants';
import { ide_state } from '../ide_state';
import { applyInlineFieldEditing } from '../inline_text_field';
import { resetBlink } from '../render/render_caret';
import { textFromLines } from '../text/source_text';
import { closeCreateResourcePrompt, confirmCreateResourcePrompt, isValidCreateResourceCharacter } from '../create_resource';
import { consumeIdeKey, isKeyJustPressed } from './key_input';

export function handleCreateResourceInput(): void {
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeCreateResourcePrompt(true);
		return;
	}
	if (!ide_state.createResourceWorking && (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter'))) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void confirmCreateResourcePrompt();
		return;
	}
	if (ide_state.createResourceWorking) {
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.createResourceField, {
		allowSpace: true,
		characterFilter: (value: string): boolean => isValidCreateResourceCharacter(value),
		maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
	});
	if (textChanged) {
		ide_state.createResourceError = null;
		resetBlink();
	}
	ide_state.createResourcePath = textFromLines(ide_state.createResourceField.lines);
}
