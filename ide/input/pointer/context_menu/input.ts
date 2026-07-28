import type { PlayerInput } from '../../../../machine/ts/input/player';
import { CONTEXT_MENU_POINTER_CONSUME_PRIMARY, CONTEXT_MENU_POINTER_CONSUME_SECONDARY, CONTEXT_MENU_POINTER_IGNORED, handleEditorContextMenuPointerSession, openEditorContextMenuAtPointer } from './session';
import type { PointerSnapshot } from '../../../common/models';
import type { CartEditor } from '../../../cart_editor';
import type { ClipboardService } from '../../../../machine/ts/platform/platform';

export function handleEditorContextMenuPointer(
	clipboard: ClipboardService,
	editor: CartEditor,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	secondaryJustPressed: boolean,
	playerInput: PlayerInput
): boolean {
	const result = handleEditorContextMenuPointerSession(
		clipboard,
		editor,
		snapshot,
		justPressed,
		secondaryJustPressed,
	);
	if (result === CONTEXT_MENU_POINTER_IGNORED) {
		return false;
	}
	if (result === CONTEXT_MENU_POINTER_CONSUME_PRIMARY) {
		playerInput.consumeRawButton('pointer_primary', 'pointer');
		return true;
	}
	if (result === CONTEXT_MENU_POINTER_CONSUME_SECONDARY) {
		playerInput.consumeRawButton('pointer_secondary', 'pointer');
		return true;
	}
	return true;
}

export function openEditorContextMenuFromPointer(snapshot: PointerSnapshot, playerInput: PlayerInput): boolean {
	if (!openEditorContextMenuAtPointer(snapshot)) {
		return false;
	}
	playerInput.consumeRawButton('pointer_secondary', 'pointer');
	return true;
}
