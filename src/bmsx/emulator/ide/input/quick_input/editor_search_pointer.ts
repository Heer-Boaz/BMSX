import { point_in_rect } from '../../../../utils/rect_operations';
import * as constants from '../../constants';
import { applySearchSelection, ensureSearchSelectionVisible, processInlineFieldPointer } from '../../contrib/find/editor_search';
import { closeLineJump } from '../../contrib/find/line_jump';
import { getSearchBarBounds, searchResultEntryHeight, searchVisibleResultCount } from '../../browser/editor_view';
import { ide_state } from '../../ide_state';
import type { PointerSnapshot } from '../../types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

export function handleSearchPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getSearchBarBounds();
	if (!ide_state.searchVisible || !bounds) {
		ide_state.searchHoverIndex = -1;
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			ide_state.searchActive = false;
			ide_state.searchHoverIndex = -1;
		}
		return false;
	}
	const fieldBottom = bounds.top + ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	ide_state.searchHoverIndex = -1;
	if (snapshot.viewportY < fieldBottom) {
		if (justPressed) {
			closeLineJump(false);
			ide_state.searchVisible = true;
			ide_state.searchActive = true;
			activateQuickInputField();
		}
		const label = ide_state.searchScope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
		processInlineFieldPointer(ide_state.searchField, quickInputTextLeft(label), snapshot.viewportX, justPressed, snapshot.primaryPressed);
		finishQuickInputPointer(snapshot);
		return true;
	}
	const hoverIndex = resolveSearchHoverIndex(snapshot.viewportY, fieldBottom);
	ide_state.searchHoverIndex = hoverIndex;
	if (hoverIndex >= 0 && justPressed) {
		if (hoverIndex !== ide_state.searchCurrentIndex) {
			ide_state.searchCurrentIndex = hoverIndex;
			ensureSearchSelectionVisible();
			if (ide_state.searchScope === 'local') {
				applySearchSelection(hoverIndex, { preview: true });
			}
		}
		applySearchSelection(hoverIndex);
		finishQuickInputPointer(snapshot);
		return true;
	}
	finishQuickInputPointer(snapshot);
	return true;
}

function resolveSearchHoverIndex(pointerY: number, fieldBottom: number): number {
	const visibleResults = searchVisibleResultCount();
	if (visibleResults <= 0) {
		return -1;
	}
	const resultsStart = fieldBottom + constants.SEARCH_RESULT_SPACING;
	if (pointerY < resultsStart) {
		return -1;
	}
	const indexWithin = Math.floor((pointerY - resultsStart) / searchResultEntryHeight());
	if (indexWithin < 0 || indexWithin >= visibleResults) {
		return -1;
	}
	return ide_state.searchDisplayOffset + indexWithin;
}
