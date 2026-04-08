import { point_in_rect } from '../../../utils/rect_operations';
import * as constants from '../constants';
import { closeSearch, processInlineFieldPointer } from '../editor_search';
import { getResourceSearchBarBounds, resourceSearchEntryHeight, resourceSearchVisibleResultCount } from '../editor_view';
import { ide_state } from '../ide_state';
import type { PointerSnapshot } from '../types';
import { applyResourceSearchSelection } from '../resource_search';
import { ensureResourceSearchSelectionVisible } from '../resource_search_catalog';
import { closeLineJump } from '../line_jump';
import { closeSymbolSearch } from '../symbol_search_shared';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

export function handleResourceSearchPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getResourceSearchBarBounds();
	if (!ide_state.resourceSearchVisible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			ide_state.resourceSearchActive = false;
		}
		ide_state.resourceSearchHoverIndex = -1;
		return false;
	}
	const fieldBottom = bounds.top + ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	if (snapshot.viewportY < fieldBottom) {
		if (justPressed) {
			closeLineJump(false);
			closeSearch(false, true);
			closeSymbolSearch(false);
			ide_state.resourceSearchVisible = true;
			ide_state.resourceSearchActive = true;
			activateQuickInputField();
		}
		processInlineFieldPointer(ide_state.resourceSearchField, quickInputTextLeft('FILE :'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
		finishQuickInputPointer(snapshot);
		return true;
	}
	const hoverIndex = resolveResourceSearchHoverIndex(snapshot.viewportY, fieldBottom);
	ide_state.resourceSearchHoverIndex = hoverIndex;
	if (hoverIndex >= 0 && justPressed) {
		if (hoverIndex !== ide_state.resourceSearchSelectionIndex) {
			ide_state.resourceSearchSelectionIndex = hoverIndex;
			ensureResourceSearchSelectionVisible();
		}
		applyResourceSearchSelection(hoverIndex);
		finishQuickInputPointer(snapshot);
		return true;
	}
	finishQuickInputPointer(snapshot);
	return true;
}

function resolveResourceSearchHoverIndex(pointerY: number, fieldBottom: number): number {
	const resultsStart = fieldBottom + constants.QUICK_OPEN_RESULT_SPACING;
	if (pointerY < resultsStart) {
		return -1;
	}
	const indexWithin = Math.floor((pointerY - resultsStart) / resourceSearchEntryHeight());
	const visibleCount = resourceSearchVisibleResultCount();
	if (indexWithin < 0 || indexWithin >= visibleCount) {
		return -1;
	}
	return ide_state.resourceSearchDisplayOffset + indexWithin;
}
