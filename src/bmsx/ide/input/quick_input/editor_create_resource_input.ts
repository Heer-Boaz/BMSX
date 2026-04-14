import * as constants from '../../core/constants';
import { applyInlineFieldEditing } from '../../ui/inline_text_field';
import { resetBlink } from '../../render/render_caret';
import { textFromLines } from '../../text/source_text';
import { closeCreateResourcePrompt } from '../../contrib/resources/create_resource';
import { confirmCreateResourcePrompt, isValidCreateResourceCharacter } from '../../contrib/resources/create_resource_operation';
import { consumeIdeKey, isKeyJustPressed } from '../keyboard/key_input';
import { editorFeatureState } from '../../core/editor_feature_state';

export function handleCreateResourceInput(): void {
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeCreateResourcePrompt(true);
		return;
	}
	if (!editorFeatureState.createResource.working && (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter'))) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		void confirmCreateResourcePrompt();
		return;
	}
	if (editorFeatureState.createResource.working) {
		return;
	}
	const textChanged = applyInlineFieldEditing(editorFeatureState.createResource.field, {
		allowSpace: true,
		characterFilter: (value: string): boolean => isValidCreateResourceCharacter(value),
		maxLength: constants.CREATE_RESOURCE_MAX_PATH_LENGTH,
	});
	if (textChanged) {
		editorFeatureState.createResource.error = null;
		resetBlink();
	}
	editorFeatureState.createResource.path = textFromLines(editorFeatureState.createResource.field.lines);
}
