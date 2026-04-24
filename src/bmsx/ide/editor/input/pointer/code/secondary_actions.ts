import { engineCore } from '../../../../../core/engine';
import { toggleBreakpointForEditorRow } from '../../../../workbench/contrib/debugger/controller';
import { resolvePointerRow } from '../../../ui/view/view';
import type { CodeAreaBounds } from '../../../ui/view/view';
import { openEditorContextMenuFromPointer } from '../../../../workbench/input/pointer/context_menu/input';
import type { PointerSnapshot } from '../../../../common/models';
import { editorPointerState, resetPointerClickTracking } from '../state';

export function handleCodeAreaSecondaryPointer(
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	inGutter: boolean,
	pointerSecondaryJustPressed: boolean,
	playerInput: ReturnType<typeof engineCore.input.getPlayerInput>
): boolean {
	if (!pointerSecondaryJustPressed || !insideCodeArea || inGutter || !openEditorContextMenuFromPointer(snapshot, playerInput)) {
		return false;
	}
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	return true;
}

export function handleCodeAreaGutterPointer(snapshot: PointerSnapshot, justPressed: boolean, inGutter: boolean, bounds: CodeAreaBounds): boolean {
	if (!justPressed || !inGutter) {
		return false;
	}
	const targetRow = resolvePointerRow(snapshot.viewportY, bounds);
	if (!toggleBreakpointForEditorRow(targetRow)) {
		return false;
	}
	editorPointerState.pointerSelecting = false;
	editorPointerState.pointerPrimaryWasPressed = snapshot.primaryPressed;
	resetPointerClickTracking();
	return true;
}
