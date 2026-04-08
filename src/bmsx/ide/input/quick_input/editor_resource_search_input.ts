import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { applyInlineFieldEditing } from '../../ui/inline_text_field';
import { applyResourceSearchSelection, closeResourceSearch, focusEditorFromResourceSearch } from '../../contrib/resources/resource_search';
import { applyLineJumpFieldText, openLineJump } from '../../contrib/find/line_jump';
import { textFromLines } from '../../text/source_text';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../keyboard/key_input';
import { resourceSearchWindowCapacity } from '../../ui/editor_view';
import { ensureResourceSearchSelectionVisible, moveResourceSearchSelection, updateResourceSearchMatches } from '../../contrib/resources/resource_search_catalog';
import { openGlobalSymbolSearch, openSymbolSearch } from '../../contrib/symbols/symbol_search';

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
