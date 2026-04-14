import { scheduleMicrotask } from '../../../platform/platform';
import * as constants from '../../core/constants';
import { ide_state } from '../../core/ide_state';
import { showEditorMessage } from '../../core/editor_feedback_state';
import { clearReferenceHighlights } from '../intellisense/intellisense';
import { closeSearch } from '../find/editor_search';
import { openResourceDescriptor } from '../../ui/editor_tabs';
import { resetBlink } from '../../render/render_caret';
import { setFieldText } from '../../ui/inline_text_field';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';
import { closeLineJump } from '../find/line_jump';
import { refreshResourceCatalog, updateResourceSearchMatches } from './resource_search_catalog';

export function openResourceSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeSymbolSearch(false);
	ide_state.renameController.cancel();
	ide_state.resourceSearch.visible = true;
	ide_state.resourceSearch.active = true;
	applyResourceSearchFieldText(initialQuery, true);
	refreshResourceCatalog();
	updateResourceSearchMatches();
	ide_state.resourceSearch.hoverIndex = -1;
	resetBlink();
}

export function closeResourceSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applyResourceSearchFieldText('', true);
	}
	ide_state.resourceSearch.active = false;
	ide_state.resourceSearch.visible = false;
	ide_state.resourceSearch.matches = [];
	ide_state.resourceSearch.selectionIndex = -1;
	ide_state.resourceSearch.displayOffset = 0;
	ide_state.resourceSearch.hoverIndex = -1;
	ide_state.resourceSearch.field.selectionAnchor = null;
	ide_state.resourceSearch.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourceSearch(): void {
	if (!ide_state.resourceSearch.active && !ide_state.resourceSearch.visible) {
		return;
	}
	ide_state.resourceSearch.active = false;
	if (ide_state.resourceSearch.query.length === 0) {
		ide_state.resourceSearch.visible = false;
		ide_state.resourceSearch.matches = [];
		ide_state.resourceSearch.selectionIndex = -1;
		ide_state.resourceSearch.displayOffset = 0;
	}
	ide_state.resourceSearch.field.selectionAnchor = null;
	ide_state.resourceSearch.field.pointerSelecting = false;
	resetBlink();
}

export function applyResourceSearchSelection(index: number): void {
	if (index < 0 || index >= ide_state.resourceSearch.matches.length) {
		showEditorMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = ide_state.resourceSearch.matches[index];
	closeResourceSearch(true);
	scheduleMicrotask(() => {
		openResourceDescriptor(match.entry.descriptor);
	});
}

export function applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	ide_state.resourceSearch.query = value;
	setFieldText(ide_state.resourceSearch.field, value, moveCursorToEnd);
}
