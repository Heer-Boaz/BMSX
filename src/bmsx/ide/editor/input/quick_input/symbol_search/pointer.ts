import { point_in_rect } from '../../../../../common/rect';
import * as constants from '../../../../common/constants';
import { closeSearch, processInlineFieldPointer } from '../../../contrib/find/search';
import { getSymbolSearchBarBounds, symbolSearchEntryHeight, symbolSearchVisibleResultCount } from '../../../ui/view/view';
import type { PointerSnapshot } from '../../../../common/models';
import { closeLineJump } from '../../../contrib/find/line_jump';
import { applySymbolSearchSelection } from '../../../contrib/symbols/search';
import { ensureSymbolSearchSelectionVisible } from '../../../contrib/symbols/shared';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';
import { editorViewState } from '../../../ui/view/state';
import { symbolSearchState } from '../../../contrib/symbols/search/state';

export function handleSymbolSearchPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getSymbolSearchBarBounds();
	if (!symbolSearchState.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			symbolSearchState.active = false;
		}
		symbolSearchState.hoverIndex = -1;
		return false;
	}
	const fieldBottom = bounds.top + editorViewState.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
	if (snapshot.viewportY < fieldBottom) {
		if (justPressed) {
			closeLineJump(false);
			closeSearch(false, true);
			symbolSearchState.visible = true;
			symbolSearchState.active = true;
			activateQuickInputField();
		}
		const label = symbolSearchState.global ? 'SYMBOL #:' : 'SYMBOL @:';
		processInlineFieldPointer(symbolSearchState.field, quickInputTextLeft(label), snapshot.viewportX, justPressed, snapshot.primaryPressed);
		finishQuickInputPointer(snapshot);
		return true;
	}
	const hoverIndex = resolveSymbolSearchHoverIndex(snapshot.viewportY, fieldBottom);
	symbolSearchState.hoverIndex = hoverIndex;
	if (hoverIndex >= 0 && justPressed) {
		if (hoverIndex !== symbolSearchState.selectionIndex) {
			symbolSearchState.selectionIndex = hoverIndex;
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
	return symbolSearchState.displayOffset + indexWithin;
}
