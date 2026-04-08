import { $ } from '../../../../core/engine_core';
import { ide_state } from '../../core/ide_state';
import { toggleBreakpointForEditorRow } from '../../contrib/debugger/ide_debugger';
import { resetPointerClickTracking, resolvePointerRow } from '../../browser/editor_view';
import { openEditorContextMenuFromPointer } from './editor_context_menu_input';
import type { PointerSnapshot } from '../../core/types';

export function handleCodeAreaSecondaryPointer(
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	inGutter: boolean,
	pointerSecondaryJustPressed: boolean,
	playerInput: ReturnType<typeof $.input.getPlayerInput>
): boolean {
	if (!pointerSecondaryJustPressed || !insideCodeArea || inGutter || !openEditorContextMenuFromPointer(snapshot, playerInput)) {
		return false;
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	return true;
}

export function handleCodeAreaGutterPointer(snapshot: PointerSnapshot, justPressed: boolean, inGutter: boolean): boolean {
	if (!justPressed || !inGutter) {
		return false;
	}
	const targetRow = resolvePointerRow(snapshot.viewportY);
	if (!toggleBreakpointForEditorRow(targetRow)) {
		return false;
	}
	ide_state.pointerSelecting = false;
	ide_state.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	return true;
}
