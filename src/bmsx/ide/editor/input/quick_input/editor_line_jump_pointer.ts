import { point_in_rect } from '../../../../utils/rect_operations';
import { closeSearch, processInlineFieldPointer } from '../../contrib/find/editor_search';
import { getLineJumpBarBounds } from '../../ui/editor_view';
import type { PointerSnapshot } from '../../../common/types';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from './editor_quick_input_pointer_common';
import { lineJumpState } from '../../contrib/find/find_widget_state';

export function handleLineJumpPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
	const bounds = getLineJumpBarBounds();
	if (!lineJumpState.visible || !bounds) {
		return false;
	}
	const insideBar = point_in_rect(snapshot.viewportX, snapshot.viewportY, bounds);
	if (!insideBar) {
		if (justPressed) {
			lineJumpState.active = false;
		}
		return false;
	}
	if (justPressed) {
		closeSearch(false, true);
		lineJumpState.active = true;
		activateQuickInputField();
	}
	processInlineFieldPointer(lineJumpState.field, quickInputTextLeft('LINE #:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
