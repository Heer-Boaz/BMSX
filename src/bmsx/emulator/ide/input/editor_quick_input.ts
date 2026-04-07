import * as constants from '../constants';
import { ide_state } from '../ide_state';
import { activeSearchMatchCount, applySearchSelection, jumpToNextMatch, jumpToPreviousMatch, onSearchQueryChanged, openSearch, searchPageSize, stepSearchSelection } from '../editor_search';
import { applyInlineFieldEditing } from '../inline_text_field';
import { applyLineJump, applyLineJumpFieldText, applyResourceSearchSelection, applySymbolSearchSelection, closeLineJump, closeResourceSearch, closeSymbolSearch, ensureResourceSearchSelectionVisible, ensureSymbolSearchSelectionVisible, focusEditorFromResourceSearch, moveResourceSearchSelection, moveSymbolSearchSelection, openGlobalSymbolSearch, openLineJump, openSymbolSearch, updateResourceSearchMatches, updateSymbolSearchMatches } from '../search_bars';
import { textFromLines } from '../text/source_text';
import { consumeIdeKey, isAltDown, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from './key_input';
import { redo, undo } from '../undo_controller';
import { save } from '../editor_tabs';
import { resourceSearchWindowCapacity, symbolSearchPageSize } from '../editor_view';

export function isInlineFieldFocused(): boolean {
	return ide_state.searchActive
		|| ide_state.symbolSearchActive
		|| ide_state.resourceSearchActive
		|| ide_state.lineJumpActive
		|| ide_state.createResourceActive
		|| ide_state.renameController.isActive();
}

export function handleSymbolSearchInput(): void {
	const shiftDown = isShiftDown();
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		if (shiftDown) {
			moveSymbolSearchSelection(-1);
			return;
		}
		if (ide_state.symbolSearchSelectionIndex >= 0) {
			applySymbolSearchSelection(ide_state.symbolSearchSelectionIndex);
		} else {
			ide_state.showMessage('No symbol selected', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeSymbolSearch(true);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		moveSymbolSearchSelection(-1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		moveSymbolSearchSelection(1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp')) {
		consumeIdeKey('PageUp');
		moveSymbolSearchSelection(-symbolSearchPageSize());
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		moveSymbolSearchSelection(symbolSearchPageSize());
		return;
	}
	if (isKeyJustPressed('Home')) {
		consumeIdeKey('Home');
		ide_state.symbolSearchSelectionIndex = ide_state.symbolSearchMatches.length > 0 ? 0 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		ide_state.symbolSearchSelectionIndex = ide_state.symbolSearchMatches.length > 0 ? ide_state.symbolSearchMatches.length - 1 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.symbolSearchField, {
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.symbolSearchQuery = textFromLines(ide_state.symbolSearchField.lines);
	if (textChanged) {
		updateSymbolSearchMatches();
	}
}

export function handleResourceSearchInput(): void {
	const shiftDown = isShiftDown();
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		if (shiftDown) {
			moveResourceSearchSelection(-1);
			return;
		}
		if (ide_state.resourceSearchSelectionIndex >= 0) {
			applyResourceSearchSelection(ide_state.resourceSearchSelectionIndex);
			return;
		}
		const trimmed = ide_state.resourceSearchQuery.trim();
		if (trimmed.length === 0) {
			closeResourceSearch(true);
			focusEditorFromResourceSearch();
		} else {
			ide_state.showMessage('No resource selected', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeResourceSearch(true);
		focusEditorFromResourceSearch();
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		moveResourceSearchSelection(-1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		moveResourceSearchSelection(1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp')) {
		consumeIdeKey('PageUp');
		moveResourceSearchSelection(-resourceSearchWindowCapacity());
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		moveResourceSearchSelection(resourceSearchWindowCapacity());
		return;
	}
	if (isKeyJustPressed('Home')) {
		consumeIdeKey('Home');
		ide_state.resourceSearchSelectionIndex = ide_state.resourceSearchMatches.length > 0 ? 0 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		ide_state.resourceSearchSelectionIndex = ide_state.resourceSearchMatches.length > 0 ? ide_state.resourceSearchMatches.length - 1 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.resourceSearchField, {
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.resourceSearchQuery = textFromLines(ide_state.resourceSearchField.lines);
	if (!textChanged) {
		return;
	}
	if (ide_state.resourceSearchQuery.startsWith('@')) {
		const query = ide_state.resourceSearchQuery.slice(1).trimStart();
		closeResourceSearch(true);
		openSymbolSearch(query);
		return;
	}
	if (ide_state.resourceSearchQuery.startsWith('#')) {
		const query = ide_state.resourceSearchQuery.slice(1).trimStart();
		closeResourceSearch(true);
		openGlobalSymbolSearch(query);
		return;
	}
	if (ide_state.resourceSearchQuery.startsWith(':')) {
		const query = ide_state.resourceSearchQuery.slice(1).trimStart();
		closeResourceSearch(true);
		openLineJump();
		if (query.length > 0) {
			applyLineJumpFieldText(query, true);
			ide_state.lineJumpValue = query;
		}
		return;
	}
	updateResourceSearchMatches();
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
	const previewLocal = ide_state.searchScope === 'local';
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
	const textChanged = applyInlineFieldEditing(ide_state.searchField, {
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.searchQuery = textFromLines(ide_state.searchField.lines);
	if (textChanged) {
		onSearchQueryChanged();
	}
}

export function handleLineJumpInput(): void {
	const shiftDown = isShiftDown();
	const ctrlDown = isCtrlDown();
	const metaDown = isMetaDown();
	if ((ctrlDown || metaDown) && isKeyJustPressed('KeyL')) {
		consumeIdeKey('KeyL');
		openLineJump();
		return;
	}
	if (!shiftDown && (isKeyJustPressed('NumpadEnter') || isKeyJustPressed('Enter'))) {
		consumeIdeKey('NumpadEnter');
		consumeIdeKey('Enter');
		applyLineJump();
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeLineJump(false);
		return;
	}
	const digitFilter = (value: string): boolean => value >= '0' && value <= '9';
	const textChanged = applyInlineFieldEditing(ide_state.lineJumpField, {
		allowSpace: false,
		characterFilter: digitFilter,
		maxLength: 6,
	});
	ide_state.lineJumpValue = textFromLines(ide_state.lineJumpField.lines);
	if (textChanged) {
		return;
	}
}
