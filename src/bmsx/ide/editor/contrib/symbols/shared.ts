import { clampQuickInputDisplayOffset } from '../../navigation/quick_input_navigation';
import { resetBlink } from '../../render/caret';
import { setFieldText } from '../../ui/inline_text_field';
import { symbolSearchPageSize } from '../../ui/view/view';
import type { SymbolSearchResult } from '../../../common/models';
import { symbolSearchState } from './search_state';

export function closeSymbolSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applySymbolSearchFieldText('', true);
	}
	symbolSearchState.active = false;
	symbolSearchState.visible = false;
	symbolSearchState.global = false;
	symbolSearchState.mode = 'symbols';
	symbolSearchState.referenceCatalog = [];
	symbolSearchState.matches = [];
	symbolSearchState.selectionIndex = -1;
	symbolSearchState.displayOffset = 0;
	symbolSearchState.hoverIndex = -1;
	symbolSearchState.field.selectionAnchor = null;
	symbolSearchState.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromSymbolSearch(): void {
	if (!symbolSearchState.active && !symbolSearchState.visible) {
		return;
	}
	symbolSearchState.active = false;
	if (symbolSearchState.query.length === 0) {
		symbolSearchState.visible = false;
		symbolSearchState.matches = [];
		symbolSearchState.selectionIndex = -1;
		symbolSearchState.displayOffset = 0;
	}
	symbolSearchState.field.selectionAnchor = null;
	symbolSearchState.field.pointerSelecting = false;
	resetBlink();
}

export function applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	symbolSearchState.query = value;
	setFieldText(symbolSearchState.field, value, moveCursorToEnd);
}

export function getActiveSymbolSearchMatch(): SymbolSearchResult {
	if (!symbolSearchState.visible || symbolSearchState.matches.length === 0) {
		return null;
	}
	let index = symbolSearchState.hoverIndex;
	if (index < 0 || index >= symbolSearchState.matches.length) {
		index = symbolSearchState.selectionIndex;
	}
	if (index < 0 || index >= symbolSearchState.matches.length) {
		return null;
	}
	return symbolSearchState.matches[index];
}

export function ensureSymbolSearchSelectionVisible(): void {
	symbolSearchState.displayOffset = clampQuickInputDisplayOffset(
		symbolSearchState.selectionIndex,
		symbolSearchState.displayOffset,
		symbolSearchState.matches.length,
		symbolSearchPageSize()
	);
}
