import { scheduleMicrotask } from '../../../platform/platform';
import * as constants from '../../core/constants';
import { renameController } from '../rename/rename_controller';
import { showEditorMessage } from '../../core/editor_feedback_state';
import { clearReferenceHighlights } from '../intellisense/intellisense';
import { closeSearch } from '../find/editor_search';
import { openResourceDescriptor } from '../../ui/editor_tabs';
import { resetBlink } from '../../render/render_caret';
import { setFieldText } from '../../ui/inline_text_field';
import { closeSymbolSearch } from '../symbols/symbol_search_shared';
import { closeLineJump } from '../find/line_jump';
import { refreshResourceCatalog, updateResourceSearchMatches } from './resource_search_catalog';
import { editorFeatureState } from '../../core/editor_feature_state';

export function openResourceSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeSymbolSearch(false);
	renameController.cancel();
	editorFeatureState.resourceSearch.visible = true;
	editorFeatureState.resourceSearch.active = true;
	applyResourceSearchFieldText(initialQuery, true);
	refreshResourceCatalog();
	updateResourceSearchMatches();
	editorFeatureState.resourceSearch.hoverIndex = -1;
	resetBlink();
}

export function closeResourceSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applyResourceSearchFieldText('', true);
	}
	editorFeatureState.resourceSearch.active = false;
	editorFeatureState.resourceSearch.visible = false;
	editorFeatureState.resourceSearch.matches = [];
	editorFeatureState.resourceSearch.selectionIndex = -1;
	editorFeatureState.resourceSearch.displayOffset = 0;
	editorFeatureState.resourceSearch.hoverIndex = -1;
	editorFeatureState.resourceSearch.field.selectionAnchor = null;
	editorFeatureState.resourceSearch.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourceSearch(): void {
	if (!editorFeatureState.resourceSearch.active && !editorFeatureState.resourceSearch.visible) {
		return;
	}
	editorFeatureState.resourceSearch.active = false;
	if (editorFeatureState.resourceSearch.query.length === 0) {
		editorFeatureState.resourceSearch.visible = false;
		editorFeatureState.resourceSearch.matches = [];
		editorFeatureState.resourceSearch.selectionIndex = -1;
		editorFeatureState.resourceSearch.displayOffset = 0;
	}
	editorFeatureState.resourceSearch.field.selectionAnchor = null;
	editorFeatureState.resourceSearch.field.pointerSelecting = false;
	resetBlink();
}

export function applyResourceSearchSelection(index: number): void {
	if (index < 0 || index >= editorFeatureState.resourceSearch.matches.length) {
		showEditorMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = editorFeatureState.resourceSearch.matches[index];
	closeResourceSearch(true);
	scheduleMicrotask(() => {
		openResourceDescriptor(match.entry.descriptor);
	});
}

export function applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	editorFeatureState.resourceSearch.query = value;
	setFieldText(editorFeatureState.resourceSearch.field, value, moveCursorToEnd);
}
