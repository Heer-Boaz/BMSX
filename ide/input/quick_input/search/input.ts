import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, isKeyDown } from '../../keyboard/key_input';
import type { EditorSearchController } from '../../../workbench/contrib/code_editor/find/search';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';

type SearchSelectionOptions = {
	preview?: boolean;
	keepSearchActive?: boolean;
};

function stepSearchSelectionFromInput(search: EditorSearchController, delta: number,
	options?: SearchSelectionOptions & { wrap?: boolean }): void {
	search.stepSearchSelection(delta, options);
	if (!options?.preview) search.openSelectedGlobalMatch();
}

export function handleSearchInput(
	playerInput: KeyInputEvent,
	search: EditorSearchController,
): void {
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		search.closeSearch(false);
		return;
	}
	const shiftDown = isShiftDown(playerInput);
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	const altDown = isAltDown(playerInput);
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressed('KeyF', playerInput)) {
		consumeIdeKey('KeyF', playerInput);
		search.switchScope('global');
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('KeyF', playerInput)) {
		consumeIdeKey('KeyF', playerInput);
		search.switchScope('local');
		return;
	}
	const hasResults = search.activeSearchMatchCount() > 0;
	const previewLocal = search.state.scope === 'local';
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		if (hasResults) {
			stepSearchSelectionFromInput(search, shiftDown ? -1 : 1, { wrap: true, keepSearchActive: true });
		} else if (shiftDown) {
			search.jumpToPreviousMatch();
		} else {
			search.jumpToNextMatch();
		}
		return;
	}
	if (isKeyJustPressed('F3', playerInput)) {
		consumeIdeKey('F3', playerInput);
		if (shiftDown) {
			search.jumpToPreviousMatch();
		} else {
			search.jumpToNextMatch();
		}
		return;
	}
	if (hasResults) {
		if (isKeyDown('ArrowUp', playerInput)) {
			consumeIdeKey('ArrowUp', playerInput);
			stepSearchSelectionFromInput(search, -1, { preview: previewLocal });
			return;
		}
		if (isKeyDown('ArrowDown', playerInput)) {
			consumeIdeKey('ArrowDown', playerInput);
			stepSearchSelectionFromInput(search, 1, { preview: previewLocal });
			return;
		}
		if (isKeyDown('PageUp', playerInput)) {
			consumeIdeKey('PageUp', playerInput);
			stepSearchSelectionFromInput(search, -search.searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyDown('PageDown', playerInput)) {
			consumeIdeKey('PageDown', playerInput);
			stepSearchSelectionFromInput(search, search.searchPageSize(), { preview: previewLocal });
			return;
		}

	}
	applyInlineFieldEditing(playerInput, search.state.field);
}
