import { consoleCore } from '../../../../core/console';
import { toggleBreakpointForEditorRow } from '../../../workbench/contrib/debugger/controller';
import type { Runtime } from '../../../../machine/runtime/runtime';
import { resolvePointerRow } from '../../../editor/ui/view/view';
import type { CodeAreaBounds } from '../../../editor/ui/view/view';
import { openEditorContextMenuFromPointer } from '../context_menu/input';
import type { PointerSnapshot } from '../../../common/models';
import { stopPointerSelectionAndResetClicks } from '../state';

export function handleCodeAreaSecondaryPointer(
	runtime: Runtime,
	snapshot: PointerSnapshot,
	insideCodeArea: boolean,
	inGutter: boolean,
	pointerSecondaryJustPressed: boolean,
	playerInput: ReturnType<typeof consoleCore.input.getPlayerInput>
): boolean {
	if (!pointerSecondaryJustPressed || !insideCodeArea || inGutter || !openEditorContextMenuFromPointer(runtime, snapshot, playerInput)) {
		return false;
	}
	stopPointerSelectionAndResetClicks(snapshot);
	return true;
}

export function handleCodeAreaGutterPointer(runtime: Runtime, snapshot: PointerSnapshot, justPressed: boolean, inGutter: boolean, bounds: CodeAreaBounds): boolean {
	if (!justPressed || !inGutter) {
		return false;
	}
	const targetRow = resolvePointerRow(snapshot.viewportY, bounds);
	if (!toggleBreakpointForEditorRow(runtime, targetRow)) {
		return false;
	}
	stopPointerSelectionAndResetClicks(snapshot);
	return true;
}
