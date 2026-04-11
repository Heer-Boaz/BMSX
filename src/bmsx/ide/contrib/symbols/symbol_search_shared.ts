import { ide_state } from '../../core/ide_state';
import { clampQuickInputDisplayOffset } from '../../navigation/quick_input_navigation';
import { resetBlink } from '../../render/render_caret';
import { setFieldText } from '../../ui/inline_text_field';
import { symbolSearchPageSize } from '../../ui/editor_view';
import type { SymbolSearchResult } from '../../core/types';

export function closeSymbolSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applySymbolSearchFieldText('', true);
	}
	ide_state.symbolSearch.active = false;
	ide_state.symbolSearch.visible = false;
	ide_state.symbolSearch.global = false;
	ide_state.symbolSearch.mode = 'symbols';
	ide_state.symbolSearch.referenceCatalog = [];
	ide_state.symbolSearch.matches = [];
	ide_state.symbolSearch.selectionIndex = -1;
	ide_state.symbolSearch.displayOffset = 0;
	ide_state.symbolSearch.hoverIndex = -1;
	ide_state.symbolSearch.field.selectionAnchor = null;
	ide_state.symbolSearch.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromSymbolSearch(): void {
	if (!ide_state.symbolSearch.active && !ide_state.symbolSearch.visible) {
		return;
	}
	ide_state.symbolSearch.active = false;
	if (ide_state.symbolSearch.query.length === 0) {
		ide_state.symbolSearch.visible = false;
		ide_state.symbolSearch.matches = [];
		ide_state.symbolSearch.selectionIndex = -1;
		ide_state.symbolSearch.displayOffset = 0;
	}
	ide_state.symbolSearch.field.selectionAnchor = null;
	ide_state.symbolSearch.field.pointerSelecting = false;
	resetBlink();
}

export function applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.symbolSearch.query = value;
	setFieldText(ide_state.symbolSearch.field, value, moveCursorToEnd);
}

export function getActiveSymbolSearchMatch(): SymbolSearchResult {
	if (!ide_state.symbolSearch.visible || ide_state.symbolSearch.matches.length === 0) {
		return null;
	}
	let index = ide_state.symbolSearch.hoverIndex;
	if (index < 0 || index >= ide_state.symbolSearch.matches.length) {
		index = ide_state.symbolSearch.selectionIndex;
	}
	if (index < 0 || index >= ide_state.symbolSearch.matches.length) {
		return null;
	}
	return ide_state.symbolSearch.matches[index];
}

export function ensureSymbolSearchSelectionVisible(): void {
	ide_state.symbolSearch.displayOffset = clampQuickInputDisplayOffset(
		ide_state.symbolSearch.selectionIndex,
		ide_state.symbolSearch.displayOffset,
		ide_state.symbolSearch.matches.length,
		symbolSearchPageSize()
	);
}
