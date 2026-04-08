import { scheduleMicrotask } from '../../platform/platform';
import * as constants from './constants';
import { ide_state } from './ide_state';
import { clearReferenceHighlights } from './intellisense';
import { closeSearch } from './editor_search';
import { openResourceDescriptor } from './editor_tabs';
import { resetBlink } from './render/render_caret';
import { setFieldText } from './inline_text_field';
import { closeSymbolSearch } from './symbol_search_shared';
import { closeLineJump } from './line_jump';
import { refreshResourceCatalog, updateResourceSearchMatches } from './resource_search_catalog';

export function openResourceSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeSymbolSearch(false);
	ide_state.renameController.cancel();
	ide_state.resourceSearchVisible = true;
	ide_state.resourceSearchActive = true;
	applyResourceSearchFieldText(initialQuery, true);
	refreshResourceCatalog();
	updateResourceSearchMatches();
	ide_state.resourceSearchHoverIndex = -1;
	resetBlink();
}

export function closeResourceSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applyResourceSearchFieldText('', true);
	}
	ide_state.resourceSearchActive = false;
	ide_state.resourceSearchVisible = false;
	ide_state.resourceSearchMatches = [];
	ide_state.resourceSearchSelectionIndex = -1;
	ide_state.resourceSearchDisplayOffset = 0;
	ide_state.resourceSearchHoverIndex = -1;
	ide_state.resourceSearchField.selectionAnchor = null;
	ide_state.resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourceSearch(): void {
	if (!ide_state.resourceSearchActive && !ide_state.resourceSearchVisible) {
		return;
	}
	ide_state.resourceSearchActive = false;
	if (ide_state.resourceSearchQuery.length === 0) {
		ide_state.resourceSearchVisible = false;
		ide_state.resourceSearchMatches = [];
		ide_state.resourceSearchSelectionIndex = -1;
		ide_state.resourceSearchDisplayOffset = 0;
	}
	ide_state.resourceSearchField.selectionAnchor = null;
	ide_state.resourceSearchField.pointerSelecting = false;
	resetBlink();
}

export function applyResourceSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.resourceSearchMatches.length) {
		ide_state.showMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.resourceSearchMatches[index];
	closeResourceSearch(true);
	scheduleMicrotask(() => {
		openResourceDescriptor(match.entry.descriptor);
	});
}

export function applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.resourceSearchQuery = value;
	setFieldText(ide_state.resourceSearchField, value, moveCursorToEnd);
}
