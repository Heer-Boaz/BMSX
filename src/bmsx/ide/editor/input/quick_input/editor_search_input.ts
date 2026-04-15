import { activeSearchMatchCount, applySearchSelection, jumpToNextMatch, jumpToPreviousMatch, onSearchQueryChanged, openSearch, searchPageSize, stepSearchSelection } from '../../contrib/find/editor_search';
import { applyInlineFieldEditing } from '../../ui/inline_text_field';
import { textFromLines } from '../../text/source_text';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../keyboard/key_input';
import { redo, undo } from '../../editing/undo_controller';
import { save } from '../../../workbench/ui/code_tab_io';
import { editorSearchState } from '../../contrib/find/find_widget_state';

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
			stepSearchSelection(shiftDown ? -1 : 1, { wrap: true, keepSearchActive: true });
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
			stepSearchSelection(-1, { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('ArrowDown')) {
			consumeIdeKey('ArrowDown');
			stepSearchSelection(1, { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('PageUp')) {
			consumeIdeKey('PageUp');
			stepSearchSelection(-searchPageSize(), { preview: previewLocal });
			return;
		}
		if (shouldRepeatKeyFromPlayer('PageDown')) {
			consumeIdeKey('PageDown');
			stepSearchSelection(searchPageSize(), { preview: previewLocal });
			return;
		}
		if (isKeyJustPressed('Home')) {
			consumeIdeKey('Home');
			applySearchSelection(0, { preview: true, keepSearchActive: true });
			return;
		}
		if (isKeyJustPressed('End')) {
			consumeIdeKey('End');
			applySearchSelection(activeSearchMatchCount() - 1, { preview: true, keepSearchActive: true });
			return;
		}
	}
	const textChanged = applyInlineFieldEditing(editorSearchState.field, {
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	editorSearchState.query = textFromLines(editorSearchState.field.lines);
	if (textChanged) {
		onSearchQueryChanged();
	}
}
