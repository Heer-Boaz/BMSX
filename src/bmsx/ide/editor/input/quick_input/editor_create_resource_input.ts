import * as constants from '../../../common/constants';
import { applyInlineFieldEditing } from '../../ui/inline_text_field';
import { resetBlink } from '../../render/render_caret';
import { textFromLines } from '../../text/source_text';
import { closeCreateResourcePrompt } from '../../../workbench/contrib/resources/create_resource';
import { confirmCreateResourcePrompt, isValidCreateResourceCharacter } from '../../../workbench/contrib/resources/create_resource_operation';
import { consumeIdeKey, isKeyJustPressed } from '../keyboard/key_input';
import { createResourceState } from '../../../workbench/contrib/resources/resource_widget_state';

export function handleCreateResourceInput(): void {
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeCreateResourcePrompt(true);
		return;
	}
	if (!createResourceState.working && (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter'))) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void confirmCreateResourcePrompt();
		return;
	}
	if (createResourceState.working) {
		return;
	}
	const textChanged = applyInlineFieldEditing(createResourceState.field, {
		allowSpace: true,
		characterFilter: (value: string): boolean => isValidCreateResourceCharacter(value),
		maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
	});
	if (textChanged) {
		createResourceState.error = null;
		resetBlink();
	}
	createResourceState.path = textFromLines(createResourceState.field.lines);
}
