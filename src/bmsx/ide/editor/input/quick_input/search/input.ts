import { activeSearchMatchCount, applySearchSelection, jumpToNextMatch, jumpToPreviousMatch, onSearchQueryChanged, openSearch, searchPageSize, stepSearchSelection } from '../../../contrib/find/search';
import { applyInlineFieldEditing } from '../../../ui/inline_text_field';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../keyboard/key_input';
import { redo, undo } from '../../../editing/undo_controller';
import { save } from '../../../../workbench/ui/code_tab/io';
import { openGlobalSearchMatch } from '../../../../workbench/contrib/find/global_search_navigation';
import { editorSearchState } from '../../../contrib/find/widget_state';

type SearchSelectionOptions = {
	preview?: boolean;
	keepSearchActive?: boolean;
};

function openSelectedGlobalMatch(options?: SearchSelectionOptions): void {
	if (editorSearchState.scope !== 'global' || options?.preview) {
		return;
	}
	const match = editorSearchState.globalMatches[editorSearchState.currentIndex];
	if (match) {
		openGlobalSearchMatch(match);
	}
}

function applySearchSelectionFromInput(index: number, options?: SearchSelectionOptions): void {
	applySearchSelection(index, options);
	openSelectedGlobalMatch(options);
}

function stepSearchSelectionFromInput(delta: number, options?: SearchSelectionOptions & { wrap?: boolean }): void {
	stepSearchSelection(delta, options);
	openSelectedGlobalMatch(options);
}

export function handleSearchInput(): void {
	const shiftDown = isShiftDown();
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const altDown = isAltDown();
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		openSearch(false, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		openSearch(false, 'local');
		return;
	}
	if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyZ')) {
		consumeIdeKey('KeyZ');
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyY')) {
		consumeIdeKey('KeyY');
		redo();
		return;
	}
	if (ctrlDown && isKeyJustPressed('KeyS')) {
		consumeIdeKey('KeyS');
		void save();
		return;
	}
	const hasResults = activeSearchMatchCount() > 0;
	const previewLocal = editorSearchState.scope === 'local';
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		if (hasResults) {
			stepSearchSelectionFromInput(shiftDown ? -1 : 1, { wrap: true, keepSearchActive: true });
		} else if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (isKeyJustPressed('F3')) {
		consumeIdeKey('F3');
		if (shiftDown) {
			jumpToPreviousMatch();
		} else {
			jumpToNextMatch();
		}
		return;
	}
	if (hasResults) {
		if (shouldRepeatKeyFromPlayer('ArrowUp')) {
			consumeIdeKey('ArrowUp');
			stepSearchSelectionFromInput(-1, { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('ArrowDown')) {
			consumeIdeKey('ArrowDown');
			stepSearchSelectionFromInput(1, { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('PageUp')) {
			consumeIdeKey('PageUp');
			stepSearchSelectionFromInput(-searchPageSize(), { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('PageDown')) {
			consumeIdeKey('PageDown');
			stepSearchSelectionFromInput(searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyJustPressed('Home')) {
			consumeIdeKey('Home');
			applySearchSelectionFromInput(0, { preview: true, keepSearchActive: true });
			return;
		}
		if (isKeyJustPressed('End')) {
			consumeIdeKey('End');
			applySearchSelectionFromInput(activeSearchMatchCount() - 1, { preview: true, keepSearchActive: true });
			return;
		}
	}
	const textChanged = applyInlineFieldEditing(editorSearchState.field, {
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	editorSearchState.query = editorSearchState.field.text;
	if (textChanged) {
		onSearchQueryChanged();
	}
}
