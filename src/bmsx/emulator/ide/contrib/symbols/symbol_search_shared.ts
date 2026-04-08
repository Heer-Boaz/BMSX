import { ide_state } from '../../core/ide_state';
import { clampQuickInputDisplayOffset } from '../../navigation/quick_input_navigation';
import { resetBlink } from '../../render/render_caret';
import { setFieldText } from '../../browser/inline_text_field';
import { symbolSearchPageSize } from '../../browser/editor_view';
import type { SymbolSearchResult } from '../../core/types';

export function closeSymbolSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applySymbolSearchFieldText('', true);
	}
	ide_state.symbolSearchActive = false;
	ide_state.symbolSearchVisible = false;
	ide_state.symbolSearchGlobal = false;
	ide_state.symbolSearchMode = 'symbols';
	ide_state.referenceCatalog = [];
	ide_state.symbolSearchMatches = [];
	ide_state.symbolSearchSelectionIndex = -1;
	ide_state.symbolSearchDisplayOffset = 0;
	ide_state.symbolSearchHoverIndex = -1;
	ide_state.symbolSearchField.selectionAnchor = null;
	ide_state.symbolSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromSymbolSearch(): void {
	if (!ide_state.symbolSearchActive && !ide_state.symbolSearchVisible) {
		return;
	}
	ide_state.symbolSearchActive = false;
	if (ide_state.symbolSearchQuery.length === 0) {
		ide_state.symbolSearchVisible = false;
		ide_state.symbolSearchMatches = [];
		ide_state.symbolSearchSelectionIndex = -1;
		ide_state.symbolSearchDisplayOffset = 0;
	}
	ide_state.symbolSearchField.selectionAnchor = null;
	ide_state.symbolSearchField.pointerSelecting = false;
	resetBlink();
}

export function applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.symbolSearchQuery = value;
	setFieldText(ide_state.symbolSearchField, value, moveCursorToEnd);
}

export function getActiveSymbolSearchMatch(): SymbolSearchResult {
	if (!ide_state.symbolSearchVisible || ide_state.symbolSearchMatches.length === 0) {
		return null;
	}
	let index = ide_state.symbolSearchHoverIndex;
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		index = ide_state.symbolSearchSelectionIndex;
	}
	if (index < 0 || index >= ide_state.symbolSearchMatches.length) {
		return null;
	}
	return ide_state.symbolSearchMatches[index];
}

export function ensureSymbolSearchSelectionVisible(): void {
	ide_state.symbolSearchDisplayOffset = clampQuickInputDisplayOffset(
		ide_state.symbolSearchSelectionIndex,
		ide_state.symbolSearchDisplayOffset,
		ide_state.symbolSearchMatches.length,
		symbolSearchPageSize()
	);
}
