import * as constants from '../../core/constants';
import { showEditorMessage } from '../../core/editor_feedback_state';
import { applyInlineFieldEditing } from '../../ui/inline_text_field';
import { applyResourceSearchSelection, closeResourceSearch, focusEditorFromResourceSearch } from '../../contrib/resources/resource_search';
import { applyLineJumpFieldText, openLineJump } from '../../contrib/find/line_jump';
import { textFromLines } from '../../text/source_text';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../keyboard/key_input';
import { resourceSearchWindowCapacity } from '../../ui/editor_view';
import { ensureResourceSearchSelectionVisible, moveResourceSearchSelection, updateResourceSearchMatches } from '../../contrib/resources/resource_search_catalog';
import { openGlobalSymbolSearch, openSymbolSearch } from '../../contrib/symbols/symbol_search';
import { editorFeatureState } from '../../core/editor_feature_state';

export function handleResourceSearchInput(): void {
	const shiftDown = isShiftDown();
	if (isKeyJustPressed('Enter') || isKeyJustPressed('NumpadEnter')) {
		consumeIdeKey('Enter');
		consumeIdeKey('NumpadEnter');
		if (shiftDown) {
			moveResourceSearchSelection(-1);
			return;
		}
		if (editorFeatureState.resourceSearch.selectionIndex >= 0) {
			applyResourceSearchSelection(editorFeatureState.resourceSearch.selectionIndex);
			return;
		}
		const trimmed = editorFeatureState.resourceSearch.query.trim();
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
		editorFeatureState.resourceSearch.selectionIndex = editorFeatureState.resourceSearch.matches.length > 0 ? 0 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		editorFeatureState.resourceSearch.selectionIndex = editorFeatureState.resourceSearch.matches.length > 0 ? editorFeatureState.resourceSearch.matches.length - 1 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(editorFeatureState.resourceSearch.field, {
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	editorFeatureState.resourceSearch.query = textFromLines(editorFeatureState.resourceSearch.field.lines);
	if (!textChanged) {
		return;
	}
	if (editorFeatureState.resourceSearch.query.startsWith('@')) {
		const query = editorFeatureState.resourceSearch.query.slice(1).trimStart();
		closeResourceSearch(true);
		openSymbolSearch(query);
		return;
	}
	if (editorFeatureState.resourceSearch.query.startsWith('#')) {
		const query = editorFeatureState.resourceSearch.query.slice(1).trimStart();
		closeResourceSearch(true);
		openGlobalSymbolSearch(query);
		return;
	}
	if (editorFeatureState.resourceSearch.query.startsWith(':')) {
		const query = editorFeatureState.resourceSearch.query.slice(1).trimStart();
		closeResourceSearch(true);
		openLineJump();
		if (query.length > 0) {
			applyLineJumpFieldText(query, true);
			editorFeatureState.lineJump.value = query;
		}
		return;
	}
	updateResourceSearchMatches();
}
