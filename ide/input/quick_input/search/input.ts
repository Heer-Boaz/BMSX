import { activeSearchMatchCount, applySearchSelection, jumpToNextMatch, jumpToPreviousMatch, searchPageSize, stepSearchSelection } from '../../../editor/contrib/find/search';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../keyboard/key_input';
import { redo, undo } from '../../../editor/editing/undo_controller';
import { openGlobalSearchMatch } from '../../../workbench/contrib/find/global_search_navigation';
import { editorSearchState } from '../../../editor/contrib/find/widget_state';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { PlayerInput } from '../../../../machine/ts/input/player';
import type { ClipboardService } from '../../../../machine/ts/platform/platform';

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
	playerInput: PlayerInput,
	clipboard: ClipboardService,
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
	if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyZ', playerInput)) {
		consumeIdeKey('KeyZ', playerInput);
		if (shiftDown) {
			redo();
		} else {
			undo();
		}
		return;
	}
	if ((ctrlDown || metaDown) && shouldRepeatKeyFromPlayer('KeyY', playerInput)) {
		consumeIdeKey('KeyY', playerInput);
		redo();
		return;
	}
	if (ctrlDown && isKeyJustPressed('KeyS', playerInput)) {
		consumeIdeKey('KeyS', playerInput);
		editor.commands.execute('save');
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
		if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
			consumeIdeKey('ArrowUp', playerInput);
			stepSearchSelectionFromInput(editor, sources, -1, { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
			consumeIdeKey('ArrowDown', playerInput);
			stepSearchSelectionFromInput(editor, sources, 1, { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('PageUp', playerInput)) {
			consumeIdeKey('PageUp', playerInput);
			stepSearchSelectionFromInput(editor, sources, -searchPageSize(), { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('PageDown', playerInput)) {
			consumeIdeKey('PageDown', playerInput);
			stepSearchSelectionFromInput(editor, sources, searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyJustPressed('Home', playerInput)) {
			consumeIdeKey('Home', playerInput);
			applySearchSelectionFromInput(editor, sources, 0, { preview: true, keepSearchActive: true });
			return;
		}
		if (isKeyJustPressed('End', playerInput)) {
			consumeIdeKey('End', playerInput);
			applySearchSelectionFromInput(editor, sources, activeSearchMatchCount() - 1, { preview: true, keepSearchActive: true });
			return;
		}
	}
	const textChanged = applyInlineFieldEditing(playerInput, clipboard, editorSearchState.field, {
		allowSpace: true,
	});
	editorSearchState.query = editorSearchState.field.text;
	if (textChanged) {
		search.onSearchQueryChanged();
	}
}
