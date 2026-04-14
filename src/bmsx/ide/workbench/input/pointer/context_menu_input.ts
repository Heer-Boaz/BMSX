import { $ } from '../../../../core/engine_core';
import { CONTEXT_MENU_POINTER_CONSUME_PRIMARY, CONTEXT_MENU_POINTER_CONSUME_SECONDARY, CONTEXT_MENU_POINTER_IGNORED, handleEditorContextMenuPointerSession, openEditorContextMenuAtPointer } from './context_menu_session';
import type { PointerSnapshot } from '../../../common/types';

export function handleEditorContextMenuPointer(
	snapshot: PointerSnapshot,
	justPressed: boolean,
	secondaryJustPressed: boolean,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	const result = handleEditorContextMenuPointerSession(snapshot, justPressed, secondaryJustPressed);
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

export function openEditorContextMenuFromPointer(snapshot: PointerSnapshot, playerInput: ReturnType<typeof $.input.getPlayerInput>): boolean {
	if (!openEditorContextMenuAtPointer(snapshot)) {
		return false;
	}
	playerInput.consumeRawButton('pointer_secondary', 'pointer');
	return true;
}
