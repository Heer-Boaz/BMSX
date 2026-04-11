import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { applyInlineFieldEditing } from '../../ui/inline_text_field';
import { applySymbolSearchSelection } from '../../contrib/symbols/symbol_search';
import { moveSymbolSearchSelection, updateSymbolSearchMatches } from '../../contrib/symbols/symbol_search_catalog';
import { closeSymbolSearch, ensureSymbolSearchSelectionVisible } from '../../contrib/symbols/symbol_search_shared';
import { textFromLines } from '../../text/source_text';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../keyboard/key_input';
import { symbolSearchPageSize } from '../../ui/editor_view';

export function handleSymbolSearchInput(): void {
	const shiftDown = isShiftDown();
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		if (shiftDown) {
			moveSymbolSearchSelection(-1);
			return;
		}
		if (ide_state.symbolSearch.selectionIndex >= 0) {
			applySymbolSearchSelection(ide_state.symbolSearch.selectionIndex);
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
		ide_state.symbolSearch.selectionIndex = ide_state.symbolSearch.matches.length > 0 ? 0 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		ide_state.symbolSearch.selectionIndex = ide_state.symbolSearch.matches.length > 0 ? ide_state.symbolSearch.matches.length - 1 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(ide_state.symbolSearch.field, {
		allowSpace: true,
		characterFilter: undefined,
		maxLength: null,
	});
	ide_state.symbolSearch.query = textFromLines(ide_state.symbolSearch.field.lines);
	if (textChanged) {
		updateSymbolSearchMatches();
	}
}
