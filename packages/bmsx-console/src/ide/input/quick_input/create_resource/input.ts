import * as constants from '../../../common/constants';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { resetBlink } from '../../../editor/render/caret';
import { closeCreateResourcePrompt } from '../../../workbench/contrib/resources/create';
import { confirmCreateResourcePrompt, isValidCreateResourceCharacter } from '../../../workbench/contrib/resources/create/operation';
import type { Runtime } from '../../../../machine/runtime/runtime';
import { consumeIdeKey, isKeyJustPressed } from '../../keyboard/key_input';
import { createResourceState } from '../../../workbench/contrib/resources/widget_state';

export function handleCreateResourceInput(runtime: Runtime): void {
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeCreateResourcePrompt(true);
		return;
	}
	if (!createResourceState.working && (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter'))) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void confirmCreateResourcePrompt(runtime);
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
	createResourceState.path = createResourceState.field.text;
}
