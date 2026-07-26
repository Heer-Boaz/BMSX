import { activeSearchMatchCount, applySearchSelection, jumpToNextMatch, jumpToPreviousMatch, searchPageSize, stepSearchSelection } from '../../../editor/contrib/find/search';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../keyboard/key_input';
import { redo, undo } from '../../../editor/editing/undo_controller';
import { save } from '../../../workbench/ui/code_tab/io';
import { openGlobalSearchMatch } from '../../../workbench/contrib/find/global_search_navigation';
import { editorSearchState } from '../../../editor/contrib/find/widget_state';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeSourceState } from '../../../runtime/sources';

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
		openGlobalSearchMatch(editor.resourcePanel, sources, match);
	}
}

function applySearchSelectionFromInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	index: number,
	options?: SearchSelectionOptions,
): void {
	applySearchSelection(index, options);
	openSelectedGlobalMatch(editor, sources, options);
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
	editor: CartEditor,
	sources: RuntimeSourceState,
	runtime: Runtime,
): void {
	const search = editor.search;
	const shiftDown = isShiftDown();
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const altDown = isAltDown();
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		search.openSearch(false, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		search.openSearch(false, 'local');
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
		void save(editor, sources, runtime);
		return;
	}
	const hasResults = activeSearchMatchCount() > 0;
	const previewLocal = editorSearchState.scope === 'local';
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		if (hasResults) {
			stepSearchSelectionFromInput(editor, sources, shiftDown ? -1 : 1, { wrap: true, keepSearchActive: true });
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
			stepSearchSelectionFromInput(editor, sources, -1, { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('ArrowDown')) {
			consumeIdeKey('ArrowDown');
			stepSearchSelectionFromInput(editor, sources, 1, { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('PageUp')) {
			consumeIdeKey('PageUp');
			stepSearchSelectionFromInput(editor, sources, -searchPageSize(), { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('PageDown')) {
			consumeIdeKey('PageDown');
			stepSearchSelectionFromInput(editor, sources, searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyJustPressed('Home')) {
			consumeIdeKey('Home');
			applySearchSelectionFromInput(editor, sources, 0, { preview: true, keepSearchActive: true });
			return;
		}
		if (isKeyJustPressed('End')) {
			consumeIdeKey('End');
			applySearchSelectionFromInput(editor, sources, activeSearchMatchCount() - 1, { preview: true, keepSearchActive: true });
			return;
		}
	}
	const textChanged = applyInlineFieldEditing(editorSearchState.field, {
		allowSpace: true,
	});
	editorSearchState.query = editorSearchState.field.text;
	if (textChanged) {
		search.onSearchQueryChanged();
	}
}
