import { consoleCore } from '../../../../core/console';
import { CONTEXT_MENU_POINTER_CONSUME_PRIMARY, CONTEXT_MENU_POINTER_CONSUME_SECONDARY, CONTEXT_MENU_POINTER_IGNORED, handleEditorContextMenuPointerSession, openEditorContextMenuAtPointer } from './session';
import type { PointerSnapshot } from '../../../common/models';
import type { Runtime } from '../../../../machine/runtime/runtime';

export function handleEditorContextMenuPointer(
	runtime: Runtime,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	secondaryJustPressed: boolean,
	playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>
): boolean {
	const result = handleEditorContextMenuPointerSession(runtime, snapshot, justPressed, secondaryJustPressed);
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

export function openEditorContextMenuFromPointer(runtime: Runtime, snapshot: PointerSnapshot, playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>): boolean {
	if (!openEditorContextMenuAtPointer(runtime, snapshot)) {
		return false;
	}
	playerInput.consumeRawButton('pointer_secondary', 'pointer');
	return true;
}
