import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { applySymbolSearchSelection } from '../../../editor/contrib/symbols/search/index';
import { moveSymbolSearchSelection, updateSymbolSearchMatches } from '../../../editor/contrib/symbols/search/catalog';
import { closeSymbolSearch, ensureSymbolSearchSelectionVisible } from '../../../editor/contrib/symbols/shared';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../../keyboard/key_input';
import { symbolSearchPageSize } from '../../../editor/ui/view/view';
import { symbolSearchState } from '../../../editor/contrib/symbols/search/state';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeNativeBridge } from '../../../runtime/native_bridge';

export function handleSymbolSearchInput(
	editor: CartEditor,
	sources: RuntimeSourceState,
	bridge: RuntimeNativeBridge,
): void {
	const shiftDown = isShiftDown();
	if (isKeyJustPressed('Enter')) {
		consumeIdeKey('Enter');
		if (shiftDown) {
			moveSymbolSearchSelection(-1);
			return;
		}
		if (symbolSearchState.selectionIndex >= 0) {
			applySymbolSearchSelection(editor, sources, symbolSearchState.selectionIndex);
		} else {
			showEditorMessage('No symbol selected', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (isKeyJustPressed('Escape')) {
		consumeIdeKey('Escape');
		closeSymbolSearch(true);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp')) {
		consumeIdeKey('ArrowUp');
		moveSymbolSearchSelection(-1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown')) {
		consumeIdeKey('ArrowDown');
		moveSymbolSearchSelection(1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp')) {
		consumeIdeKey('PageUp');
		moveSymbolSearchSelection(-symbolSearchPageSize());
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown')) {
		consumeIdeKey('PageDown');
		moveSymbolSearchSelection(symbolSearchPageSize());
		return;
	}
	if (isKeyJustPressed('Home')) {
		consumeIdeKey('Home');
		symbolSearchState.selectionIndex = symbolSearchState.matches.length > 0 ? 0 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End')) {
		consumeIdeKey('End');
		symbolSearchState.selectionIndex = symbolSearchState.matches.length > 0 ? symbolSearchState.matches.length - 1 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(symbolSearchState.field, {
		allowSpace: true,
	});
	symbolSearchState.query = symbolSearchState.field.text;
	if (textChanged) {
			updateSymbolSearchMatches(bridge);
	}
}
