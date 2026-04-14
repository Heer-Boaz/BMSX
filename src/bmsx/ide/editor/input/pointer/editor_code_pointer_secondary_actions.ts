import { $ } from '../../../../core/engine_core';
import { toggleBreakpointForEditorRow } from '../../../workbench/contrib/debugger/ide_debugger';
import { resolvePointerRow } from '../../ui/editor_view';
import { openEditorContextMenuFromPointer } from '../../../workbench/input/pointer/context_menu_input';
import type { PointerSnapshot } from '../../../common/types';
import { editorPointerState, resetPointerClickTracking } from './editor_pointer_state';

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
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
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
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	return true;
}
