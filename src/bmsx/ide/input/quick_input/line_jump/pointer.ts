import { point_in_rect } from '../../../../common/rect';
import { closeSearch, processInlineFieldPointer } from '../../../editor/contrib/find/search';
import { getLineJumpBarBounds } from '../../../editor/ui/view/view';
import type { PointerSnapshot } from '../../../common/models';
import { activateQuickInputField, finishQuickInputPointer, quickInputTextLeft } from '../pointer/common';
import { lineJumpState } from '../../../editor/contrib/find/widget_state';
import type { ResourcePanelController } from '../../../workbench/contrib/resources/panel/controller';

export function handleLineJumpPointer(resourcePanel: ResourcePanelController, snapshot: PointerSnapshot, justPressed: boolean): boolean {
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
		activateQuickInputField(resourcePanel);
	}
	processInlineFieldPointer(lineJumpState.field, quickInputTextLeft('LINE #:'), snapshot.viewportX, justPressed, snapshot.primaryPressed);
	finishQuickInputPointer(snapshot);
	return true;
}
