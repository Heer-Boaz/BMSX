import { point_in_rect } from '../../../utils/rect_operations';
import * as constants from '../constants';
import { closeSearch, processInlineFieldPointer } from '../editor_search';
import { getSymbolSearchBarBounds, symbolSearchEntryHeight, symbolSearchVisibleResultCount } from '../editor_view';
import { ide_state } from '../ide_state';
import type { PointerSnapshot } from '../types';
import { applySymbolSearchSelection, closeLineJump, ensureSymbolSearchSelectionVisible } from '../search_bars';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

export function handleSymbolSearchPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getSymbolSearchBarBounds();
	if (!ide_state.symbolSearchVisible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			ide_state.symbolSearchActive = false;
		}
		ide_state.symbolSearchHoverIndex = -1;
		return false;
	}
	const fieldBottom = bounds.top + ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	if (snapshot.viewportY < fieldBottom) {
		if (justPressed) {
			closeLineJump(false);
			closeSearch(false, true);
			ide_state.symbolSearchVisible = true;
			ide_state.symbolSearchActive = true;
			activateQuickInputField();
		}
		const label = ide_state.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
		processInlineFieldPointer(ide_state.symbolSearchField, quickInputTextLeft(label), snapshot.viewportX, justPressed, snapshot.primaryPressed);
		finishQuickInputPointer(snapshot);
		return true;
	}
	const hoverIndex = resolveSymbolSearchHoverIndex(snapshot.viewportY, fieldBottom);
	ide_state.symbolSearchHoverIndex = hoverIndex;
	if (hoverIndex >= 0 && justPressed) {
		if (hoverIndex !== ide_state.symbolSearchSelectionIndex) {
			ide_state.symbolSearchSelectionIndex = hoverIndex;
			ensureSymbolSearchSelectionVisible();
		}
		applySymbolSearchSelection(hoverIndex);
		finishQuickInputPointer(snapshot);
		return true;
	}
	finishQuickInputPointer(snapshot);
	return true;
}

function resolveSymbolSearchHoverIndex(pointerY: number, fieldBottom: number): number {
	const entryHeight = symbolSearchEntryHeight();
	const resultsStart = fieldBottom + constants.SYMBOL_SEARCH_RESULT_SPACING;
	if (pointerY < resultsStart || entryHeight <= 0) {
		return -1;
	}
	const indexWithin = Math.floor((pointerY - resultsStart) / entryHeight);
	const visibleCount = symbolSearchVisibleResultCount();
	if (indexWithin < 0 || indexWithin >= visibleCount) {
		return -1;
	}
	return ide_state.symbolSearchDisplayOffset + indexWithin;
}
