import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { applySearchSelection, ensureSearchSelectionVisible, processInlineFieldPointer } from '../../../workbench/contrib/code_editor/find/search';
import { closeLineJump } from '../../../workbench/contrib/code_editor/find/line_jump';
import { getSearchBarBounds, searchResultEntryHeight, searchVisibleResultCount } from '../../../workbench/common/layout';
import type { PointerSnapshot } from '../../../common/models';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';
import { editorViewState } from '../../../editor/ui/view/state';
import { editorSearchState } from '../../../workbench/contrib/code_editor/find/widget_state';
import { openGlobalSearchMatch } from '../../../workbench/contrib/find/global_search_navigation';
import type { RuntimeSourceState } from '../../../runtime/sources';

function applySearchPointerSelection(
	resourcePanel: ResourcePanelController,
	sources: RuntimeSourceState,
	index: number,
	preview?: boolean,
): void {
	applySearchSelection(index, { preview });
	if (editorSearchState.scope !== 'global' || preview) {
		return;
	}
	const match = editorSearchState.globalMatches[editorSearchState.currentIndex];
	if (match) {
		openGlobalSearchMatch(resourcePanel, sources, match);
	}
}

export function handleSearchPointer(sources: RuntimeSourceState, resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getSearchBarBounds();
	if (!editorSearchState.visible || !bounds) {
		editorSearchState.hoverIndex = -1;
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			editorSearchState.active = false;
			editorSearchState.hoverIndex = -1;
		}
		return false;
	}
	const fieldBottom = bounds.top + editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	editorSearchState.hoverIndex = -1;
	if (snapshot.viewportY < fieldBottom) {
		if (justPressed) {
			closeLineJump(false);
			editorSearchState.visible = true;
			editorSearchState.active = true;
			activateQuickInputField(resourcePanel);
		}
		const label = editorSearchState.scope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
		processInlineFieldPointer(editorSearchState.field, quickInputTextLeft(label), snapshot.viewportX, justPressed, snapshot.primaryPressed);
		finishQuickInputPointer(snapshot);
		return true;
	}
	const hoverIndex = resolveSearchHoverIndex(snapshot.viewportY, fieldBottom);
	editorSearchState.hoverIndex = hoverIndex;
	if (hoverIndex >= 0 && justPressed) {
		if (hoverIndex !== editorSearchState.currentIndex) {
			editorSearchState.currentIndex = hoverIndex;
			ensureSearchSelectionVisible();
			if (editorSearchState.scope === 'local') {
					applySearchPointerSelection(resourcePanel, sources, hoverIndex, true);
			}
		}
		applySearchPointerSelection(resourcePanel, sources, hoverIndex);
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
	return editorSearchState.displayOffset + indexWithin;
}
