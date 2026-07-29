import * as constants from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import { applyInlineFieldEditing } from '../../../editor/ui/inline/text_field';
import { applyResourceSearchSelection, closeResourceSearch, focusEditorFromResourceSearch } from '../../../workbench/contrib/resources/search/index';
import { applyLineJumpFieldText, openLineJump } from '../../../workbench/contrib/code_editor/find/line_jump';
import { consumeIdeKey, isKeyJustPressed, isShiftDown, shouldRepeatKeyFromPlayer } from '../../keyboard/key_input';
import { resourceSearchWindowCapacity } from '../../../workbench/common/layout';
import { ensureResourceSearchSelectionVisible, moveResourceSearchSelection, updateResourceSearchMatches } from '../../../workbench/contrib/resources/search/catalog';
import { openGlobalSymbolSearch, openSymbolSearch } from '../../../workbench/contrib/code_editor/symbols/search/index';
import { lineJumpState } from '../../../workbench/contrib/code_editor/find/widget_state';
import { resourceSearchState } from '../../../workbench/contrib/resources/widget_state';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RenameController } from '../../../workbench/contrib/code_editor/rename/controller';
import type { CartEditor } from '../../../cart_editor';
import type { PlayerInput } from '../../../../machine/ts/input/player';
import type {
	ClipboardService,
	MicrotaskQueue,
} from '../../../../machine/ts/platform/platform';

export function handleResourceSearchInput(
	playerInput: PlayerInput,
	clipboard: ClipboardService,
	microtasks: MicrotaskQueue,
	editor: CartEditor,
	bridge: RuntimeLuaTooling,
	rename: RenameController,
): void {
	const shiftDown = isShiftDown(playerInput);
	if (isKeyJustPressed('Enter', playerInput) || isKeyJustPressed('NumpadEnter', playerInput)) {
		consumeIdeKey('Enter', playerInput);
		consumeIdeKey('NumpadEnter', playerInput);
		if (shiftDown) {
			moveResourceSearchSelection(-1);
			return;
		}
		if (resourceSearchState.selectionIndex >= 0) {
			applyResourceSearchSelection(microtasks, editor, resourceSearchState.selectionIndex);
			return;
		}
		const trimmed = resourceSearchState.query.trim();
		if (trimmed.length === 0) {
			closeResourceSearch(true);
			focusEditorFromResourceSearch();
		} else {
			showEditorMessage('No resource selected', constants.COLOR_STATUS_WARNING, 1.5);
		}
		return;
	}
	if (isKeyJustPressed('Escape', playerInput)) {
		consumeIdeKey('Escape', playerInput);
		closeResourceSearch(true);
		focusEditorFromResourceSearch();
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowUp', playerInput)) {
		consumeIdeKey('ArrowUp', playerInput);
		moveResourceSearchSelection(-1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('ArrowDown', playerInput)) {
		consumeIdeKey('ArrowDown', playerInput);
		moveResourceSearchSelection(1);
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageUp', playerInput)) {
		consumeIdeKey('PageUp', playerInput);
		moveResourceSearchSelection(-resourceSearchWindowCapacity());
		return;
	}
	if (shouldRepeatKeyFromPlayer('PageDown', playerInput)) {
		consumeIdeKey('PageDown', playerInput);
		moveResourceSearchSelection(resourceSearchWindowCapacity());
		return;
	}
	if (isKeyJustPressed('Home', playerInput)) {
		consumeIdeKey('Home', playerInput);
		resourceSearchState.selectionIndex = resourceSearchState.matches.length > 0 ? 0 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	if (isKeyJustPressed('End', playerInput)) {
		consumeIdeKey('End', playerInput);
		resourceSearchState.selectionIndex = resourceSearchState.matches.length > 0 ? resourceSearchState.matches.length - 1 : -1;
		ensureResourceSearchSelectionVisible();
		return;
	}
	const textChanged = applyInlineFieldEditing(playerInput, clipboard, resourceSearchState.field, {
		allowSpace: true,
	});
	resourceSearchState.query = resourceSearchState.field.text;
	if (!textChanged) {
		return;
	}
	const prefix = resourceSearchState.query.charAt(0);
	if (prefix === '@') {
		const query = resourceSearchState.query.slice(1).trimStart();
		closeResourceSearch(true);
			openSymbolSearch(bridge, rename, query);
		return;
	}
	if (prefix === '#') {
		const query = resourceSearchState.query.slice(1).trimStart();
		closeResourceSearch(true);
			openGlobalSymbolSearch(bridge, rename, query);
		return;
	}
	if (prefix === ':') {
		const query = resourceSearchState.query.slice(1).trimStart();
		closeResourceSearch(true);
		openLineJump();
		if (query.length > 0) {
			applyLineJumpFieldText(query, true);
			lineJumpState.value = query;
		}
		return;
	}
	updateResourceSearchMatches();
}
