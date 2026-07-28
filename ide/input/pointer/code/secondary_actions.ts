import type { PlayerInput } from '../../../../machine/ts/input/player';
import type { BreakpointController } from '../../../workbench/contrib/debugger/controller';
import { resolvePointerRow } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import { openEditorContextMenuFromPointer } from '../context_menu/input';
import type { PointerSnapshot } from '../../../common/models';
import { stopPointerSelectionAndResetClicks } from '../state';

export function handleCodeAreaSecondaryPointer(
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	inGutter: boolean,
	pointerSecondaryJustPressed: boolean,
	playerInput: PlayerInput
): boolean {
	if (!pointerSecondaryJustPressed || !insideCodeArea || inGutter || !openEditorContextMenuFromPointer(snapshot, playerInput)) {
		return false;
	}
	stopPointerSelectionAndResetClicks(snapshot);
	return true;
}

export function handleCodeAreaGutterPointer(
	breakpoints: BreakpointController,
	snapshot: PointerSnapshot,
	justPressed: boolean,
	inGutter: boolean,
	bounds: CodeAreaBounds,
): boolean {
	if (!justPressed || !inGutter) {
		return false;
	}
	const targetRow = resolvePointerRow(snapshot.viewportY, bounds);
	if (!breakpoints.toggleBreakpointForEditorRow(targetRow)) {
		return false;
	}
	stopPointerSelectionAndResetClicks(snapshot);
	return true;
}
