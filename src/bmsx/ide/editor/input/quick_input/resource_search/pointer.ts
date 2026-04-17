import { point_in_rect } from '../../../../../common/rect';
import * as constants from '../../../../common/constants';
import { closeSearch, processInlineFieldPointer } from '../../../contrib/find/search';
import { getResourceSearchBarBounds, resourceSearchEntryHeight, resourceSearchVisibleResultCount } from '../../../ui/view';
import type { PointerSnapshot } from '../../../../common/models';
import { applyResourceSearchSelection } from '../../../../workbench/contrib/resources/search';
import { ensureResourceSearchSelectionVisible } from '../../../../workbench/contrib/resources/search_catalog';
import { closeLineJump } from '../../../contrib/find/line_jump';
import { closeSymbolSearch } from '../../../contrib/symbols/shared';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';
import { editorViewState } from '../../../ui/view_state';
import { resourceSearchState } from '../../../../workbench/contrib/resources/widget_state';

export function handleResourceSearchPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getResourceSearchBarBounds();
	if (!resourceSearchState.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			resourceSearchState.active = false;
		}
		resourceSearchState.hoverIndex = -1;
		return false;
	}
	const fieldBottom = bounds.top + editorViewState.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	if (snapshot.viewportY < fieldBottom) {
		if (justPressed) {
			closeLineJump(false);
			closeSearch(false, true);
			closeSymbolSearch(false);
			resourceSearchState.visible = true;
			resourceSearchState.active = true;
			activateQuickInputField();
		}
		processInlineFieldPointer(resourceSearchState.field, quickInputTextLeft('FILE :'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
		finishQuickInputPointer(snapshot);
		return true;
	}
	const hoverIndex = resolveResourceSearchHoverIndex(snapshot.viewportY, fieldBottom);
	resourceSearchState.hoverIndex = hoverIndex;
	if (hoverIndex >= 0 && justPressed) {
		if (hoverIndex !== resourceSearchState.selectionIndex) {
			resourceSearchState.selectionIndex = hoverIndex;
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
	return resourceSearchState.displayOffset + indexWithin;
}
