import * as constants from '../../../../common/constants';
import { showEditorMessage } from '../../../../common/feedback_state';
import { applyInlineFieldEditing } from '../../../ui/inline_text_field';
import { applyResourceSearchSelection, closeResourceSearch, focusEditorFromResourceSearch } from '../../../../workbench/contrib/resources/search';
import { applyLineJumpFieldText, openLineJump } from '../../../contrib/find/line_jump';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../../keyboard/key_input';
import { resourceSearchWindowCapacity } from '../../../ui/view/view';
import { ensureResourceSearchSelectionVisible, moveResourceSearchSelection, updateResourceSearchMatches } from '../../../../workbench/contrib/resources/search_catalog';
import { openGlobalSymbolSearch, openSymbolSearch } from '../../../contrib/symbols/search';
import { lineJumpState } from '../../../contrib/find/widget_state';
import { resourceSearchState } from '../../../../workbench/contrib/resources/widget_state';

export function handleResourceSearchInput(): void {
	const shiftDown = isShiftDown();
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		if (shiftDown) {
			moveResourceSearchSelection(-1);
			return;
		}
		if (resourceSearchState.selectionIndex >= 0) {
			applyResourceSearchSelection(resourceSearchState.selectionIndex);
			return;
		}
		const trimmed = resourceSearchState.query.trim();
		if (trimmed.length === 0) {
			closeResourceSearch(true);
			focusEditorFromResourceSearch();
		} else {
			showEditorMessage('No resource selected', constants.COLOR_STATUS_WARNING, 1.5);
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
		resourceSearchState.selectionIndex = resourceSearchState.matches.length > 0 ? 0 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		resourceSearchState.selectionIndex = resourceSearchState.matches.length > 0 ? resourceSearchState.matches.length - 1 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(resourceSearchState.field, {
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	resourceSearchState.query = resourceSearchState.field.text;
	if (!textChanged) {
		return;
	}
	if (resourceSearchState.query.startsWith('@')) {
		const query = resourceSearchState.query.slice(1).trimStart();
		closeResourceSearch(true);
		openSymbolSearch(query);
		return;
	}
	if (resourceSearchState.query.startsWith('#')) {
		const query = resourceSearchState.query.slice(1).trimStart();
		closeResourceSearch(true);
		openGlobalSymbolSearch(query);
		return;
	}
	if (resourceSearchState.query.startsWith(':')) {
		const query = resourceSearchState.query.slice(1).trimStart();
		closeResourceSearch(true);
		openLineJump();
		if (query.length > 0) {
			applyLineJumpFieldText(query, true);
			lineJumpState.value = query;
		}
		return;
	}
	updateResourceSearchMatches();
}
