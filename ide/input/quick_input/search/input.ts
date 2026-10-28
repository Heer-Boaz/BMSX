import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, isKeyDown } from '../../keyboard/key_input';
import type { EditorSearchController } from '../../../workbench/contrib/code_editor/find/search';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';

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
	if ((ctrlDown || metaDown) && !shiftDown && !altDown && isKeyJustPressed('KeyF', playerInput)) {
		consumeIdeKey('KeyF', playerInput);
		search.focus();
		return;
	}
	const hasResults = search.activeSearchMatchCount() > 0;
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		if (hasResults) {
			search.stepSearchSelection(shiftDown ? -1 : 1, { wrap: true, keepSearchActive: true });
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
			search.stepSearchSelection(-1, { preview: true });
			return;
		}
		if (isKeyDown('ArrowDown', playerInput)) {
			consumeIdeKey('ArrowDown', playerInput);
			search.stepSearchSelection(1, { preview: true });
			return;
		}
		if (isKeyDown('PageUp', playerInput)) {
			consumeIdeKey('PageUp', playerInput);
			search.stepSearchSelection(-search.searchPageSize(), { preview: true });
			return;
		}
		if (isKeyDown('PageDown', playerInput)) {
			consumeIdeKey('PageDown', playerInput);
			search.stepSearchSelection(search.searchPageSize(), { preview: true });
			return;
		}

	}
	applyInlineFieldEditing(playerInput, search.state.field);
}
