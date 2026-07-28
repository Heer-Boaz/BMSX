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
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { PlayerInput } from '../../../../machine/ts/input/player';
import type { ClipboardService } from '../../../../machine/ts/platform/platform';

export function handleSymbolSearchInput(
	playerInput: PlayerInput,
	clipboard: ClipboardService,
	editor: CartEditor,
	sources: RuntimeSourceState,
	bridge: RuntimeLuaTooling,
): void {
	const shiftDown = isShiftDown(playerInput);
	if (isKeyJustPressed('Enter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
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
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		closeSymbolSearch(true);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		moveSymbolSearchSelection(-1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		moveSymbolSearchSelection(1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		moveSymbolSearchSelection(-symbolSearchPageSize());
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		moveSymbolSearchSelection(symbolSearchPageSize());
		return;
	}
	if (isKeyJustPressed('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		symbolSearchState.selectionIndex = symbolSearchState.matches.length > 0 ? 0 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		symbolSearchState.selectionIndex = symbolSearchState.matches.length > 0 ? symbolSearchState.matches.length - 1 : -1;
		ensureSymbolSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(playerInput, clipboard, symbolSearchState.field, {
		allowSpace: true,
	});
	symbolSearchState.query = symbolSearchState.field.text;
	if (textChanged) {
			updateSymbolSearchMatches(bridge);
	}
}
