import { scheduleMicrotask } from '../../../../../platform/platform';
import * as constants from '../../../../common/constants';
import { renameController } from '../../../../editor/contrib/rename/controller';
import { showEditorMessage } from '../../../../common/feedback_state';
import { clearReferenceHighlights } from '../../../../editor/contrib/intellisense/engine';
import { closeSearch } from '../../../../editor/contrib/find/search';
import { openResourceDescriptor } from '../navigation';
import { resetBlink } from '../../../../editor/render/caret';
import { setFieldText } from '../../../../editor/ui/inline/text_field';
import { closeSymbolSearch } from '../../../../editor/contrib/symbols/shared';
import { closeLineJump } from '../../../../editor/contrib/find/line_jump';
import { refreshResourceCatalog, updateResourceSearchMatches } from './catalog';
import { resourceSearchState } from '../widget_state';

export function openResourceSearch(initialQuery: string = ''): void {
	clearReferenceHighlights();
	closeSearch(false, true);
	closeLineJump(false);
	closeSymbolSearch(false);
	renameController.cancel();
	resourceSearchState.visible = true;
	resourceSearchState.active = true;
	applyResourceSearchFieldText(initialQuery, true);
	refreshResourceCatalog();
	updateResourceSearchMatches();
	resourceSearchState.hoverIndex = -1;
	resetBlink();
}

export function closeResourceSearch(clearQuery: boolean): void {
	if (clearQuery) {
		applyResourceSearchFieldText('', true);
	}
	resourceSearchState.active = false;
	resourceSearchState.visible = false;
	resourceSearchState.matches = [];
	resourceSearchState.selectionIndex = -1;
	resourceSearchState.displayOffset = 0;
	resourceSearchState.hoverIndex = -1;
	resourceSearchState.field.selectionAnchor = null;
	resourceSearchState.field.pointerSelecting = false;
	resetBlink();
}

export function focusEditorFromResourceSearch(): void {
	if (!resourceSearchState.active && !resourceSearchState.visible) {
		return;
	}
	resourceSearchState.active = false;
	if (resourceSearchState.query.length === 0) {
		resourceSearchState.visible = false;
		resourceSearchState.matches = [];
		resourceSearchState.selectionIndex = -1;
		resourceSearchState.displayOffset = 0;
	}
	resourceSearchState.field.selectionAnchor = null;
	resourceSearchState.field.pointerSelecting = false;
	resetBlink();
}

export function applyResourceSearchSelection(index: number): void {
	if (index < 0 || index >= resourceSearchState.matches.length) {
		showEditorMessage('Resource not found', constants.COLOR_STATUS_WARNING, 1.5);
		return;
	}
	const match = resourceSearchState.matches[index];
	closeResourceSearch(true);
	scheduleMicrotask(() => {
		openResourceDescriptor(match.entry.descriptor);
	});
}

export function applyResourceSearchFieldText(value: string, moveCursorToEnd: boolean): void {
	resourceSearchState.query = value;
	setFieldText(resourceSearchState.field, value, moveCursorToEnd);
}
