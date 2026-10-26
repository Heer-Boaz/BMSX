import { pointerHover } from '../../pointer/hover';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import * as constants from '../../../common/constants';
import type { EditorSearchController } from '../../../workbench/contrib/code_editor/find/search';
import type { SourceInlineBars } from '../../../workbench/contrib/code_editor/inline_bar/source_inline_bars';
import type { PointerSnapshot } from '../../../common/models';

function applySearchPointerSelection(find: EditorSearchController, index: number, preview = false): void {
	find.applySearchSelection(index, { preview });
	if (!preview) find.openSelectedGlobalMatch();
}

export function handleSearchPointer(find: EditorSearchController, bars: SourceInlineBars,
	snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const state = find.state, bounds = bars.searchBounds;
	if (!state.visible || bounds === null) { state.hoverIndex = -1; return false; }
	if (!snapshot.valid || !snapshot.insideViewport || !point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds)) {
		pointerHover.release(find.searchHover);
		if (justPressed) { state.field.focusTarget.release(); state.hoverIndex = -1; }
		return false;
	}
	const fieldBottom = bounds.top + find.code.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	state.hoverIndex = -1;
	if (snapshot.viewportY < fieldBottom) {
		if (justPressed) {
			find.focus();
		}
		find.fieldPointer.handlePointer(snapshot, justPressed);
		return true;
	}
	pointerHover.visit(find.searchHover);
	const resultsStart = fieldBottom + constants.SEARCH_RESULT_SPACING;
	if (snapshot.viewportY < resultsStart) return true;
	const indexWithin = Math.trunc((snapshot.viewportY - resultsStart) / bars.searchResultEntryHeight);
	if (indexWithin >= bars.visibleSearchResults) return true;
	const hoverIndex = state.displayOffset + indexWithin;
	state.hoverIndex = hoverIndex;
	if (justPressed) {
		if (hoverIndex !== state.currentIndex) {
			state.currentIndex = hoverIndex;
			find.ensureSearchSelectionVisible();
			if (state.scope === 'local') applySearchPointerSelection(find, hoverIndex, true);
		}
		applySearchPointerSelection(find, hoverIndex);
	}
	return true;
}
