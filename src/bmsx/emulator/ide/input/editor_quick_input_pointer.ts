import { point_in_rect } from '../../../utils/rect_operations';
import * as constants from '../constants';
import { resetBlink } from '../render/render_caret';
import { applySearchSelection, closeSearch, ensureSearchSelectionVisible, processInlineFieldPointer } from '../editor_search';
import { getCreateResourceBarBounds, getLineJumpBarBounds, getRenameBarBounds, getResourceSearchBarBounds, getSearchBarBounds, getSymbolSearchBarBounds, resourceSearchEntryHeight, resourceSearchVisibleResultCount, searchResultEntryHeight, searchVisibleResultCount, symbolSearchEntryHeight, symbolSearchVisibleResultCount } from '../editor_view';
import { ide_state } from '../ide_state';
import type { PointerSnapshot } from '../types';
import { measureText } from '../text_utils';
import { clearHoverTooltip, clearGotoHoverHighlight } from '../intellisense';
import { applyResourceSearchSelection, applySymbolSearchSelection, closeLineJump, closeSymbolSearch, ensureResourceSearchSelectionVisible, ensureSymbolSearchSelectionVisible } from '../search_bars';

export function handleQuickInputPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const createResourceBounds = getCreateResourceBarBounds();
	if (ide_state.createResourceVisible && createResourceBounds) {
		const insideCreateBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, createResourceBounds);
		if (insideCreateBar) {
			if (justPressed) {
				ide_state.createResourceActive = true;
				ide_state.cursorVisible = true;
				resetBlink();
				ide_state.resourcePanelFocused = false;
			}
			const label = 'NEW FILE:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.createResourceField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return true;
		}
		if (justPressed) {
			ide_state.createResourceActive = false;
		}
	}
	const resourceSearchBounds = getResourceSearchBarBounds();
	if (ide_state.resourceSearchVisible && resourceSearchBounds) {
		const insideResourceSearch = point_in_rect(snapshot.viewportX, snapshot.viewportY, resourceSearchBounds);
		if (insideResourceSearch) {
			const baseHeight = ide_state.lineHeight + constants.QUICK_OPEN_BAR_MARGIN_Y * 2;
			const fieldBottom = resourceSearchBounds.top + baseHeight;
			const resultsStart = fieldBottom + constants.QUICK_OPEN_RESULT_SPACING;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					closeSearch(false, true);
					closeSymbolSearch(false);
					ide_state.resourceSearchVisible = true;
					ide_state.resourceSearchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = 'FILE :';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.resourceSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return true;
			}
			const rowHeight = resourceSearchEntryHeight();
			const visibleCount = resourceSearchVisibleResultCount();
			let hoverIndex = -1;
			if (snapshot.viewportY >= resultsStart) {
				const relative = snapshot.viewportY - resultsStart;
				const indexWithin = Math.floor(relative / rowHeight);
				if (indexWithin >= 0 && indexWithin < visibleCount) {
					hoverIndex = ide_state.resourceSearchDisplayOffset + indexWithin;
				}
			}
			ide_state.resourceSearchHoverIndex = hoverIndex;
			if (hoverIndex >= 0 && justPressed) {
				if (hoverIndex !== ide_state.resourceSearchSelectionIndex) {
					ide_state.resourceSearchSelectionIndex = hoverIndex;
					ensureResourceSearchSelectionVisible();
				}
				applyResourceSearchSelection(hoverIndex);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return true;
			}
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return true;
		}
		if (justPressed) {
			ide_state.resourceSearchActive = false;
		}
		ide_state.resourceSearchHoverIndex = -1;
	}
	const symbolBounds = getSymbolSearchBarBounds();
	if (ide_state.symbolSearchVisible && symbolBounds) {
		const insideSymbol = point_in_rect(snapshot.viewportX, snapshot.viewportY, symbolBounds);
		if (insideSymbol) {
			const baseHeight = ide_state.lineHeight + constants.SYMBOL_SEARCH_BAR_MARGIN_Y * 2;
			const fieldBottom = symbolBounds.top + baseHeight;
			const resultsStart = fieldBottom + constants.SYMBOL_SEARCH_RESULT_SPACING;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					closeSearch(false, true);
					ide_state.symbolSearchVisible = true;
					ide_state.symbolSearchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = ide_state.symbolSearchGlobal ? 'SYMBOL #:' : 'SYMBOL @:';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.symbolSearchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return true;
			}
			const visibleCount = symbolSearchVisibleResultCount();
			let hoverIndex = -1;
			if (snapshot.viewportY >= resultsStart) {
				const relative = snapshot.viewportY - resultsStart;
				const entryHeight = symbolSearchEntryHeight();
				const indexWithin = entryHeight > 0 ? Math.floor(relative / entryHeight) : -1;
				if (indexWithin >= 0 && indexWithin < visibleCount) {
					hoverIndex = ide_state.symbolSearchDisplayOffset + indexWithin;
				}
			}
			ide_state.symbolSearchHoverIndex = hoverIndex;
			if (hoverIndex >= 0 && justPressed) {
				if (hoverIndex !== ide_state.symbolSearchSelectionIndex) {
					ide_state.symbolSearchSelectionIndex = hoverIndex;
					ensureSymbolSearchSelectionVisible();
				}
				applySymbolSearchSelection(hoverIndex);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return true;
			}
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return true;
		}
		if (justPressed) {
			ide_state.symbolSearchActive = false;
		}
		ide_state.symbolSearchHoverIndex = -1;
	}

	const renameBounds = getRenameBarBounds();
	if (ide_state.renameController.isVisible() && renameBounds) {
		const insideRename = point_in_rect(snapshot.viewportX, snapshot.viewportY, renameBounds);
		if (insideRename) {
			if (justPressed) {
				ide_state.resourcePanelFocused = false;
				ide_state.cursorVisible = true;
				resetBlink();
			}
			const label = 'RENAME:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.renameController.getField(), textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return true;
		}
		if (justPressed) {
			ide_state.renameController.cancel();
		}
	}

	const lineJumpBounds = getLineJumpBarBounds();
	if (ide_state.lineJumpVisible && lineJumpBounds) {
		const insideLineJump = point_in_rect(snapshot.viewportX, snapshot.viewportY, lineJumpBounds);
		if (insideLineJump) {
			if (justPressed) {
				closeSearch(false, true);
				ide_state.lineJumpActive = true;
				resetBlink();
			}
			const label = 'LINE #:';
			const labelX = 4;
			const textLeft = labelX + measureText(label + ' ');
			processInlineFieldPointer(ide_state.lineJumpField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
			ide_state.pointerSelecting = false;
			ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
			clearHoverTooltip();
			clearGotoHoverHighlight();
			return true;
		}
		if (justPressed) {
			ide_state.lineJumpActive = false;
		}
	}
	const searchBounds = getSearchBarBounds();
	if (ide_state.searchVisible && searchBounds) {
		const insideSearch = point_in_rect(snapshot.viewportX, snapshot.viewportY, searchBounds);
		const baseHeight = ide_state.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
		const fieldBottom = searchBounds.top + baseHeight;
		const visibleResults = searchVisibleResultCount();
		if (insideSearch) {
			ide_state.searchHoverIndex = -1;
			if (snapshot.viewportY < fieldBottom) {
				if (justPressed) {
					closeLineJump(false);
					ide_state.searchVisible = true;
					ide_state.searchActive = true;
					ide_state.resourcePanelFocused = false;
					ide_state.cursorVisible = true;
					resetBlink();
				}
				const label = ide_state.searchScope === 'global' ? 'SEARCH ALL:' : 'SEARCH:';
				const labelX = 4;
				const textLeft = labelX + measureText(label + ' ');
				processInlineFieldPointer(ide_state.searchField, textLeft, snapshot.viewportX, justPressed, snapshot.primaryPressed);
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return true;
			}
			if (visibleResults > 0) {
				const resultsStart = fieldBottom + constants.SEARCH_RESULT_SPACING;
				const rowHeight = searchResultEntryHeight();
				let hoverIndex = -1;
				if (snapshot.viewportY >= resultsStart) {
					const relative = snapshot.viewportY - resultsStart;
					const indexWithin = Math.floor(relative / rowHeight);
					if (indexWithin >= 0 && indexWithin < visibleResults) {
						hoverIndex = ide_state.searchDisplayOffset + indexWithin;
					}
				}
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
					ide_state.pointerSelecting = false;
					ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
					clearHoverTooltip();
					clearGotoHoverHighlight();
					return true;
				}
				ide_state.pointerSelecting = false;
				ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
				clearHoverTooltip();
				clearGotoHoverHighlight();
				return true;
			}
		} else if (justPressed) {
			ide_state.searchActive = false;
			ide_state.searchHoverIndex = -1;
		}
	} else {
		ide_state.searchHoverIndex = -1;
	}
	return false;
}
