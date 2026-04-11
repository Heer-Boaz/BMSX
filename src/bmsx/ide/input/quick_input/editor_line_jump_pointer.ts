import { point_in_rect } from '../../../utils/rect_operations';
import { closeSearch, processInlineFieldPointer } from '../../contrib/find/editor_search';
import { getLineJumpBarBounds } from '../../ui/editor_view';
import { ide_state } from '../../core/ide_state';
import type { PointerSnapshot } from '../../core/types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';

export function handleLineJumpPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getLineJumpBarBounds();
	if (!ide_state.lineJump.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			ide_state.lineJump.active = false;
		}
		return false;
	}
	if (justPressed) {
		closeSearch(false, true);
		ide_state.lineJump.active = true;
		activateQuickInputField();
	}
	processInlineFieldPointer(ide_state.lineJump.field, quickInputTextLeft('LINE #:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
