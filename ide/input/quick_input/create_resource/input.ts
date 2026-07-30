import * as constants from '../../../common/constants';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { resetBlink } from '../../../editor/render/caret';
import { closeCreateResourcePrompt } from '../../../workbench/contrib/resources/create/index';
import { confirmCreateResourcePrompt, isValidCreateResourceCharacter } from '../../../workbench/contrib/resources/create/operation';
import { consumeIdeKey, isKeyJustPressed } from '../../keyboard/key_input';
import { createResourceState } from '../../../workbench/contrib/resources/widget_state';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { CartEditor } from '../../../cart_editor';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { Clipboard } from '../../../common/clipboard';
import type { HostClock } from '../../../../hosts/common/clock';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';

export function handleCreateResourceInput(
	playerInput: PlayerInput,
	clipboard: Clipboard,
	storage: KeyValueStorage,
	clock: HostClock,
	editor: CartEditor,
	sources: RuntimeSourceState,
): void {
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		closeCreateResourcePrompt(true);
		return;
	}
	if (!createResourceState.working && (isKeyJustPressed('Enter', playerInput) || isKeyJustPressed('NumpadEnter', playerInput))) {
		consumeIdeKey('Enter', playerInput);
		consumeIdeKey('NumpadEnter', playerInput);
		void confirmCreateResourcePrompt(storage, clock, editor, sources);
		return;
	}
	if (createResourceState.working) {
		return;
	}
	const textChanged = applyInlineFieldEditing(playerInput, clipboard, createResourceState.field, {
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
