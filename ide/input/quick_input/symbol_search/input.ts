import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { applySymbolSearchSelection } from '../../../workbench/contrib/code_editor/symbols/search/index';
import { moveSymbolSearchSelection, updateSymbolSearchMatches } from '../../../workbench/contrib/code_editor/symbols/search/catalog';
import { closeSymbolSearch, ensureSymbolSearchSelectionVisible } from '../../../workbench/contrib/code_editor/symbols/shared';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../../keyboard/key_input';
import { symbolSearchPageSize } from '../../../workbench/common/layout';
import { symbolSearchState } from '../../../workbench/contrib/code_editor/symbols/search/state';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { Clipboard } from '../../../common/clipboard';
import type { MicrotaskQueue } from '../../../common/microtask_queue';

export function handleSymbolSearchInput(
	playerInput: PlayerInput,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	editor: CartEditor,
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
			applySymbolSearchSelection(microtasks, editor, symbolSearchState.selectionIndex);
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
