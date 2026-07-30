import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import { closeSearch, processInlineFieldPointer } from '../../../workbench/contrib/code_editor/find/search';
import { getResourceSearchBarBounds, resourceSearchEntryHeight, resourceSearchVisibleResultCount } from '../../../workbench/common/layout';
import type { PointerSnapshot } from '../../../common/models';
import { applyResourceSearchSelection } from '../../../workbench/contrib/resources/search/index';
import { ensureResourceSearchSelectionVisible } from '../../../workbench/contrib/resources/search/catalog';
import { closeLineJump } from '../../../workbench/contrib/code_editor/find/line_jump';
import { closeSymbolSearch } from '../../../workbench/contrib/code_editor/symbols/shared';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';
import { editorViewState } from '../../../editor/ui/view/state';
import { resourceSearchState } from '../../../workbench/contrib/resources/widget_state';
import type { CartEditor } from '../../../cart_editor';
import type { MicrotaskQueue } from '../../../common/microtask_queue';

export function handleResourceSearchPointer(
	microtasks: MicrotaskQueue,
	editor: CartEditor,
	resourcePanel: ResourcePanelController,
	snapshot: PointerSnapshot,
	justPressed: boolean,
): boolean {
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
			activateQuickInputField(resourcePanel);
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
		applyResourceSearchSelection(microtasks, editor, hoverIndex);
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
