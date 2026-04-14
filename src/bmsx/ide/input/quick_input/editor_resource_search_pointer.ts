import { point_in_rect } from '../../../utils/rect_operations';
import * as constants from '../../core/constants';
import { closeSearch, processInlineFieldPointer } from '../../contrib/find/editor_search';
import { getResourceSearchBarBounds, resourceSearchEntryHeight, resourceSearchVisibleResultCount } from '../../ui/editor_view';
import type { PointerSnapshot } from '../../core/types';
import { applyResourceSearchSelection } from '../../contrib/resources/resource_search';
import { ensureResourceSearchSelectionVisible } from '../../contrib/resources/resource_search_catalog';
import { closeLineJump } from '../../contrib/find/line_jump';
import { closeSymbolSearch } from '../../contrib/symbols/symbol_search_shared';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';
import { editorViewState } from '../../ui/editor_view_state';
import { editorFeatureState } from '../../core/editor_feature_state';

export function handleResourceSearchPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getResourceSearchBarBounds();
	if (!editorFeatureState.resourceSearch.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			editorFeatureState.resourceSearch.active = false;
		}
		editorFeatureState.resourceSearch.hoverIndex = -1;
		return false;
	}
	const fieldBottom = bounds.top + editorViewState.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
	if (snapshot.viewportY < fieldBottom) {
		if (justPressed) {
			closeLineJump(false);
			closeSearch(false, true);
			closeSymbolSearch(false);
			editorFeatureState.resourceSearch.visible = true;
			editorFeatureState.resourceSearch.active = true;
			activateQuickInputField();
		}
		processInlineFieldPointer(editorFeatureState.resourceSearch.field, quickInputTextLeft('FILE :'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
		finishQuickInputPointer(snapshot);
		return true;
	}
	const hoverIndex = resolveResourceSearchHoverIndex(snapshot.viewportY, fieldBottom);
	editorFeatureState.resourceSearch.hoverIndex = hoverIndex;
	if (hoverIndex >= 0 && justPressed) {
		if (hoverIndex !== editorFeatureState.resourceSearch.selectionIndex) {
			editorFeatureState.resourceSearch.selectionIndex = hoverIndex;
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
	return editorFeatureState.resourceSearch.displayOffset + indexWithin;
}
