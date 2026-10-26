import { activeSearchMatchCount, jumpToNextMatch, jumpToPreviousMatch, searchPageSize, stepSearchSelection } from '../../../workbench/contrib/code_editor/find/search';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, isKeyDown } from '../../keyboard/key_input';
import { openGlobalSearchMatch } from '../../../workbench/contrib/find/global_search_navigation';
import { editorSearchState } from '../../../workbench/contrib/code_editor/find/widget_state';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';

type SearchSelectionOptions = {
	preview?: boolean;
	keepSearchActive?: boolean;
};

function openSelectedGlobalMatch(
	editor: CartEditor,
	sources: RuntimeSourceState,
	options?: SearchSelectionOptions,
): void {
	if (editorSearchState.scope !== 'global' || options?.preview) {
		return;
	}
	const match = editorSearchState.globalMatches[editorSearchState.currentIndex];
	if (match) {
		openGlobalSearchMatch(editor.editorGroup, sources, match);
	}
}

function stepSearchSelectionFromInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	delta: number,
	options?: SearchSelectionOptions & { wrap?: boolean },
): void {
	stepSearchSelection(delta, options);
	openSelectedGlobalMatch(editor, sources, options);
}

export function handleSearchInput(
	playerInput: KeyInputEvent,
	editor: CartEditor,
	sources: RuntimeSourceState,
): void {
	const search = editor.search;
	const shiftDown = isShiftDown(playerInput);
	const ctrlDown = isCtrlDown(playerInput);
	const metaDown = isMetaDown(playerInput);
	const altDown = isAltDown(playerInput);
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressed('KeyF', playerInput)) {
		consumeIdeKey('KeyF', playerInput);
		search.openSearch(false, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('KeyF', playerInput)) {
		consumeIdeKey('KeyF', playerInput);
		search.openSearch(false, 'local');
		return;
	}
	const hasResults = activeSearchMatchCount() > 0;
	const previewLocal = editorSearchState.scope === 'local';
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		if (hasResults) {
			stepSearchSelectionFromInput(editor, sources, shiftDown ? -1 : 1, { wrap: true, keepSearchActive: true });
		} else if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (isKeyJustPressed('F3', playerInput)) {
		consumeIdeKey('F3', playerInput);
		if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (hasResults) {
		if (isKeyDown('ArrowUp', playerInput)) {
			consumeIdeKey('ArrowUp', playerInput);
			stepSearchSelectionFromInput(editor, sources, -1, { preview: previewLocal });
			return;
		}
		if (isKeyDown('ArrowDown', playerInput)) {
			consumeIdeKey('ArrowDown', playerInput);
			stepSearchSelectionFromInput(editor, sources, 1, { preview: previewLocal });
			return;
		}
		if (isKeyDown('PageUp', playerInput)) {
			consumeIdeKey('PageUp', playerInput);
			stepSearchSelectionFromInput(editor, sources, -searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyDown('PageDown', playerInput)) {
			consumeIdeKey('PageDown', playerInput);
			stepSearchSelectionFromInput(editor, sources, searchPageSize(), { preview: previewLocal });
			return;
		}

	}
	applyInlineFieldEditing(playerInput, editorSearchState.field);
}
