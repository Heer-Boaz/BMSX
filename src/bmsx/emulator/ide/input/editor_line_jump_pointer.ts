import { point_in_rect } from '../../../utils/rect_operations';
import { closeSearch, processInlineFieldPointer } from '../editor_search';
import { getLineJumpBarBounds } from '../editor_view';
import { ide_state } from '../ide_state';
import type { PointerSnapshot } from '../types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

export function handleLineJumpPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getLineJumpBarBounds();
	if (!ide_state.lineJumpVisible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			ide_state.lineJumpActive = false;
		}
		return false;
	}
	if (justPressed) {
		closeSearch(false, true);
		ide_state.lineJumpActive = true;
		activateQuickInputField();
	}
	processInlineFieldPointer(ide_state.lineJumpField, quickInputTextLeft('LINE #:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
