import { machineManager } from '../../../../core/machine_manager';
import { activeSearchMatchCount, applySearchSelection, jumpToNextMatch, jumpToPreviousMatch, searchPageSize, stepSearchSelection } from '../../../editor/contrib/find/search';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../keyboard/key_input';
import { redo, undo } from '../../../editor/editing/undo_controller';
import { save } from '../../../workbench/ui/code_tab/io';
import { openGlobalSearchMatch } from '../../../workbench/contrib/find/global_search_navigation';
import { editorSearchState } from '../../../editor/contrib/find/widget_state';
import type { Runtime } from '../../../../machine/runtime/runtime';

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

export function handleSearchInput(runtime: Runtime): void {
	const shiftDown = isShiftDown();
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	const altDown = isAltDown();
	if ((ctrlDown || metaDown) && shiftDown && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		machineManager.ideState.editor.search.openSearch(false, 'global');
		return;
	}
	if ((ctrlDown || metaDown) && !altDown && isKeyJustPressed('KeyF')) {
		consumeIdeKey('KeyF');
		machineManager.ideState.editor.search.openSearch(false, 'local');
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
		void save(runtime);
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
	});
	editorSearchState.query = editorSearchState.field.text;
	if (textChanged) {
		machineManager.ideState.editor.search.onSearchQueryChanged();
	}
}
