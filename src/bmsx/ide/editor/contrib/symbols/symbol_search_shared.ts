import { clampQuickInputDisplayOffset } from '../../navigation/quick_input_navigation';
import { resetBlink } from '../../render/render_caret';
import { setFieldText } from '../../ui/inline_text_field';
import { symbolSearchPageSize } from '../../ui/editor_view';
import type { SymbolSearchResult } from '../../../common/types';
import { editorFeatureState } from '../../common/editor_feature_state';

export function closeSymbolSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applySymbolSearchFieldText('', true);
	}
	editorFeatureState.symbolSearch.active = false;
	editorFeatureState.symbolSearch.visible = false;
	editorFeatureState.symbolSearch.global = false;
	editorFeatureState.symbolSearch.mode = 'symbols';
	editorFeatureState.symbolSearch.referenceCatalog = [];
	editorFeatureState.symbolSearch.matches = [];
	editorFeatureState.symbolSearch.selectionIndex = -1;
	editorFeatureState.symbolSearch.displayOffset = 0;
	editorFeatureState.symbolSearch.hoverIndex = -1;
	editorFeatureState.symbolSearch.field.selectionAnchor = null;
	editorFeatureState.symbolSearch.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromSymbolSearch(): void {
	if (!editorFeatureState.symbolSearch.active && !editorFeatureState.symbolSearch.visible) {
		return;
	}
	editorFeatureState.symbolSearch.active = false;
	if (editorFeatureState.symbolSearch.query.length === 0) {
		editorFeatureState.symbolSearch.visible = false;
		editorFeatureState.symbolSearch.matches = [];
		editorFeatureState.symbolSearch.selectionIndex = -1;
		editorFeatureState.symbolSearch.displayOffset = 0;
	}
	editorFeatureState.symbolSearch.field.selectionAnchor = null;
	editorFeatureState.symbolSearch.field.pointerSelecting = false;
	resetBlink();
}

export function applySymbolSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	editorFeatureState.symbolSearch.query = value;
	setFieldText(editorFeatureState.symbolSearch.field, value, moveCursorToEnd);
}

export function getActiveSymbolSearchMatch(): SymbolSearchResult {
	if (!editorFeatureState.symbolSearch.visible || editorFeatureState.symbolSearch.matches.length === 0) {
		return null;
	}
	let index = editorFeatureState.symbolSearch.hoverIndex;
	if (index < 0 || index >= editorFeatureState.symbolSearch.matches.length) {
		index = editorFeatureState.symbolSearch.selectionIndex;
	}
	if (index < 0 || index >= editorFeatureState.symbolSearch.matches.length) {
		return null;
	}
	return editorFeatureState.symbolSearch.matches[index];
}

export function ensureSymbolSearchSelectionVisible(): void {
	editorFeatureState.symbolSearch.displayOffset = clampQuickInputDisplayOffset(
		editorFeatureState.symbolSearch.selectionIndex,
		editorFeatureState.symbolSearch.displayOffset,
		editorFeatureState.symbolSearch.matches.length,
		symbolSearchPageSize()
	);
}
