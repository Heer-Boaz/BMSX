import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { applyInlineFieldEditing } from '../../ui/inline_text_field';
import { resetBlink } from '../../render/render_caret';
import { textFromLines } from '../../text/source_text';
import { closeCreateResourcePrompt } from '../../contrib/resources/create_resource';
import { confirmCreateResourcePrompt, isValidCreateResourceCharacter } from '../../contrib/resources/create_resource_operation';
import { consumeIdeKey, isKeyJustPressed } from '../keyboard/key_input';

export function handleCreateResourceInput(): void {
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeCreateResourcePrompt(true);
		return;
	}
	if (!ide_state.createResource.working && (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter'))) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void confirmCreateResourcePrompt();
		return;
	}
	if (ide_state.createResource.working) {
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.createResource.field, {
		allowSpace: true,
		characterFilter: (value: string): boolean => isValidCreateResourceCharacter(value),
		maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
	});
	if (textChanged) {
		ide_state.createResource.error = null;
		resetBlink();
	}
	ide_state.createResource.path = textFromLines(ide_state.createResource.field.lines);
}
